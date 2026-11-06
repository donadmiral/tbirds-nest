const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function load(name, imports, runtime = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/services', name + '.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: key => imports[key], URL, setTimeout, clearTimeout, AbortController, ...runtime });
  return exports;
}

const { transferChunks, STORAGE_CHUNK_BYTES: chunk } = load('resumableUpload', { buffer: { Buffer } });
const input = { baseUrl: 'https://project.supabase.co', path: 'member/🎥.mp4', bucket: 'post-media', mime: 'video/mp4' };
const resource = '/storage/v1/upload/resumable/test-id';
const reply = (status, headers = {}) => ({ status, headers: new Headers(headers) });

test('native upload streams a 12 MiB video over loopback and recovers an acknowledged chunk after a lost response', async t => {
  const source = Buffer.alloc(chunk * 2 + 13);
  for (let i = 0; i < source.length; i++) source[i] = i % 251;
  const accepted = [], reads = [], methods = [], assertions = [];
  let size = 0, closed = 0;
  const server = http.createServer(async (req, res) => {
    try {
      methods.push(req.method);
      assert.equal(req.headers.authorization, 'Bearer member-token');
      assert.equal(req.headers['tus-resumable'], '1.0.0');
      assert.equal(req.headers['x-upsert'], 'false');
      if (req.method === 'POST') {
        assert.equal(req.url, '/storage/v1/upload/resumable');
        assert.equal(Number(req.headers['upload-length']), source.length);
        assert.ok(req.headers['upload-metadata'].includes('objectName ' + Buffer.from(input.path).toString('base64')));
        res.writeHead(201, { Location: resource }).end();
      } else if (req.method === 'HEAD') {
        res.writeHead(200, { 'Upload-Offset': String(size) }).end();
      } else {
        assert.equal(req.method, 'PATCH'); assert.equal(req.url, resource);
        assert.equal(Number(req.headers['upload-offset']), size);
        for await (const data of req) { accepted.push(data); size += data.length; }
        if (size === chunk) req.socket.destroy();
        else res.writeHead(204, { 'Upload-Offset': String(size) }).end();
      }
    } catch (error) { assertions.push(error); res.writeHead(400).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  class File {
    size = source.length;
    open() {
      return { offset: 0, readBytes(length) { reads.push([this.offset, length]); return source.subarray(this.offset, this.offset + length); }, close() { closed++; } };
    }
  }
  const adapter = load('uploadNativeFile', {
    'expo-file-system': { File }, 'expo/fetch': { fetch },
    './resumableUpload': { transferChunks, STORAGE_CHUNK_BYTES: chunk },
    './supabase': { SUPABASE_URL: 'http://127.0.0.1:' + server.address().port, SUPABASE_ANON_KEY: 'public-key' },
  });
  await adapter.uploadNativeFile({ ...input, uri: 'file:///cache/video.mp4', filename: 'video.mp4', upsert: false, token: async () => 'member-token' });
  assert.deepEqual(assertions, []);
  assert.deepEqual(methods, ['POST', 'PATCH', 'HEAD', 'PATCH', 'PATCH']);
  assert.deepEqual(reads, [[0, chunk], [chunk, chunk], [chunk * 2, 13]]);
  assert.deepEqual(Buffer.concat(accepted), source);
  assert.equal(closed, 1);
});

test('a foreign session URL never receives a follow-up credential', async () => {
  const calls = [];
  await assert.rejects(transferChunks({ ...input, size: 10, request: async url => {
    calls.push(url); return reply(201, { Location: 'https://foreign.example' + resource });
  } }), /unexpected upload location/);
  assert.deepEqual(calls, ['https://project.storage.supabase.co/storage/v1/upload/resumable']);
});

test('unconfirmed bytes, invalid offsets and policy denials cannot complete an upload', async () => {
  for (const [response, message] of [[reply(204), /invalid upload offset/], [reply(204, { 'Upload-Offset': '42' }), /invalid upload offset/], [reply(403), /HTTP 403/]]) {
    let ops = 0;
    await assert.rejects(transferChunks({ ...input, size: 10, read: (_, n) => Buffer.alloc(n),
      request: async () => ++ops === 1 ? reply(201, { Location: resource }) : response }), message);
    assert.equal(ops, 2);
  }
});

test('continuous failures stop after four bounded waits and one session creation', async () => {
  const methods = [], waits = [];
  await assert.rejects(transferChunks({ ...input, size: 9, read: (_, n) => Buffer.alloc(n),
    request: async (_, method) => { methods.push(method); return method === 'POST' ? reply(201, { Location: resource }) : reply(503); },
  }, async ms => waits.push(ms)), /interrupted/);
  assert.deepEqual(methods, ['POST','PATCH','HEAD','HEAD','HEAD','HEAD']);
  assert.deepEqual(waits, [750, 1500, 3000, 6000]);
});

test('chat transfers use refreshed credentials only for their initiating account', async () => {
  let session = { user: { id: 'sender' }, access_token: 'original' };
  let transportCalls = 0;
  const service = load('mediaService', {
    './supabase': { SUPABASE_URL: 'https://fixture.invalid', supabase: { auth: { getSession: async () => ({ data: { session } }) } } },
    './devicePermissions': {}, 'expo-image-picker': {}, '../stores/settingsStore': {}, 'expo-video-thumbnails': {},
    '../utils/sniffMedia': {}, '../utils/uploadSafe': {},
    './uploadNativeFile': { uploadNativeFile: async ({ token, upsert, bucket }) => {
      transportCalls++;
      assert.equal(upsert, false); assert.equal(bucket, 'chat-files');
      assert.equal(await token(), 'original');
      session = { user: { id: 'sender' }, access_token: 'refreshed' };
      assert.equal(await token(), 'refreshed');
      session = { user: { id: 'other-account' }, access_token: 'other' };
      await assert.rejects(token(), /account that started/);
    } },
  });
  const send = () => service.uploadDocument('sender', { name: 'document.pdf', uri: 'file:///cache/document.pdf' });
  await assert.rejects(send(), /account that started/);
  session = null;
  await assert.rejects(send(), /Sign in/);
  assert.equal(transportCalls, 1);
});
