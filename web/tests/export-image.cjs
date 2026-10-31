const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/export-images', name));
function load({ fetcher = fetch, timers = { setTimeout, clearTimeout } } = {}) {
  const modules = new Map();
  function source(name) {
    name=path.resolve(name);
    if (modules.has(name)) return modules.get(name);
    const exported = {}, code = ts.transpileModule(fs.readFileSync(name + '.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    modules.set(name, exported);
    vm.runInNewContext(code, { exports: exported, require: dependency => source(path.resolve(path.dirname(name),dependency)),
      Uint8Array, DataView, Blob, AbortController, Error, ...timers, fetch: fetcher });
    return exported;
  }
  return source(path.join(root,'lib','exportImage'));
}
const inspector = load();
const unsupported = /Animated image files and GIFs cannot be exported/;
const invalid = /could not be checked safely/;
function pngChunk(name, data) {
  const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length); chunk.write(name, 4); data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4); return chunk;
}
function webpChunk(name, data) {
  const chunk = Buffer.alloc(8 + data.length + (data.length & 1)); chunk.write(name); chunk.writeUInt32LE(data.length, 4); data.copy(chunk, 8); return chunk;
}
function webp(chunks) {
  const header = Buffer.from('RIFF0000WEBP'), body = Buffer.concat([header, ...chunks]); body.writeUInt32LE(body.length - 8, 4); return body;
}

test('real static PNG and WebP remain supported, including nonzero byte offsets', () => {
  for (const name of ['static.png', 'static.webp']) {
    const bytes = fixture(name), padded = Buffer.concat([Buffer.from('prefix'), bytes, Buffer.from('suffix')]);
    assert.doesNotThrow(() => inspector.assertStaticExportImage(padded.subarray(6, 6 + bytes.length)));
  }
});
test('real APNG, animated WebP and both GIF versions are refused by their bytes', () => {
  for (const name of ['animated.png', 'animated.webp', 'animated.gif', 'static.gif']) assert.throws(() => inspector.assertStaticExportImage(fixture(name)), unsupported, name);
});
test('animation-like text in static PNG/WebP metadata is not treated as an animation chunk', () => {
  const png = fixture('static.png');
  assert.doesNotThrow(() => inspector.assertStaticExportImage(Buffer.concat([png.subarray(0, 33), pngChunk('tEXt', Buffer.from('Comment\0acTL ANIM ANMF')), png.subarray(33)])));
  assert.doesNotThrow(() => inspector.assertStaticExportImage(webp([fixture('static.webp').subarray(12), webpChunk('XMP ', Buffer.from('ANIM ANMF acTL'))])));
});
test('WebP animation flags and frame chunks are refused even without other animation metadata', () => {
  const flags = Buffer.alloc(10); flags[0] = 2;
  for (const chunk of [webpChunk('VP8X', flags), webpChunk('ANIM', Buffer.alloc(6)), webpChunk('ANMF', Buffer.alloc(16))]) {
    assert.throws(() => inspector.assertStaticExportImage(webp([chunk, fixture('static.webp').subarray(12)])), unsupported);
  }
});
test('PNG frame chunks cannot masquerade as static when the animation-control chunk is absent', () => {
  const png = fixture('static.png');
  for (const type of ['fcTL', 'fdAT']) assert.throws(() => inspector.assertStaticExportImage(Buffer.concat([png.subarray(0, 33), pngChunk(type, Buffer.alloc(26)), png.subarray(33)])), unsupported);
});
test('truncated or oversized container chunks fail closed instead of skipping unknown bytes', () => {
  const pngLength = Buffer.from(fixture('static.png')); pngLength.writeUInt32BE(0xffffffff, 8);
  const webpLength = Buffer.from(fixture('static.webp')); webpLength.writeUInt32LE(0xffffffff, 16);
  const webpRiff = Buffer.from(fixture('static.webp')); webpRiff.writeUInt32LE(1000, 4);
  for (const bytes of [fixture('static.png').subarray(0, -1), pngLength, fixture('static.webp').subarray(0, -1), webpLength, webpRiff]) {
    assert.throws(() => inspector.assertStaticExportImage(bytes), invalid);
  }
});
test('untrusted MIME labels and ordinary photo filenames cannot hide animated bytes', async () => {
  for (const name of ['animated.png', 'animated.webp', 'animated.gif']) {
    const guard = load({ fetcher: async () => new Response(fixture(name), { headers: { 'Content-Type': 'image/jpeg' } }) });
    await assert.rejects(guard.fetchStaticExportImage('https://synthetic.invalid/photo.jpg', new AbortController().signal), unsupported);
  }
});
test('data and blob URLs receive the same byte inspection as remote image assets', async () => {
  const bytes = fixture('animated.png'), data = 'data:image/png;base64,' + bytes.toString('base64');
  await assert.rejects(inspector.fetchStaticExportImage(data, new AbortController().signal), unsupported);
  const url = URL.createObjectURL(new Blob([fixture('animated.webp')], { type: 'image/webp' }));
  try { await assert.rejects(inspector.fetchStaticExportImage(url, new AbortController().signal), unsupported); }
  finally { URL.revokeObjectURL(url); }
});
test('the declared size is rejected before opening a response reader', async () => {
  let read = false, aborted = false;
  const guard = load({ fetcher: async (_url, { signal }) => {
    signal.addEventListener('abort', () => { aborted = true; });
    const response = new Response('x', { headers: { 'Content-Length': String(inspector.EXPORT_IMAGE_MAX_BYTES + 1) } });
    response.body.getReader = () => { read = true; throw Error('must not read'); }; return response;
  } });
  await assert.rejects(guard.fetchStaticExportImage('https://synthetic.invalid/large.png', new AbortController().signal), /32 MB/);
  assert.equal(read, false); assert.equal(aborted, true);
});
test('streamed bytes enforce the size cap even when Content-Length is missing or dishonest', async () => {
  for (const headers of [{}, { 'Content-Length': '1' }]) {
    let cancelled = false;
    const guard = load({ fetcher: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(inspector.EXPORT_IMAGE_MAX_BYTES + 1)); },
      cancel() { cancelled = true; },
    }), { headers }) });
    await assert.rejects(guard.fetchStaticExportImage('https://synthetic.invalid/large.png', new AbortController().signal), /32 MB/);
    assert.equal(cancelled, true);
  }
});
test('cancelling a partially received image cancels the reader and produces no accepted blob', async () => {
  let cancelled = false, reading; const started = new Promise(resolve => { reading = resolve; });
  const guard = load({ fetcher: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(fixture('static.png').subarray(0, 8)); },
    pull() { reading(); }, cancel() { cancelled = true; },
  })) });
  const controller = new AbortController(), pending = guard.fetchStaticExportImage('https://synthetic.invalid/slow.png', controller.signal);
  await started; controller.abort(new Error('Synthetic image cancellation'));
  await assert.rejects(pending, /Synthetic image cancellation/); assert.equal(cancelled, true);
});
test('the overall image deadline aborts a stalled fetch', async () => {
  const timers = new Map(); let next = 0, aborted = false;
  const guard = load({ timers: { setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) },
    fetcher: (_url, { signal }) => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); } });
  const pending = guard.fetchStaticExportImage('https://synthetic.invalid/stalled.png', new AbortController().signal);
  timers.values().next().value(); await assert.rejects(pending, /took too long/);
  assert.equal(aborted, true); assert.equal(timers.size, 0);
});
