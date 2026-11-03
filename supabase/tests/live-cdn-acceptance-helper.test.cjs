const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { mkdtemp, writeFile, symlink, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { webcrypto, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const helper = import(pathToFileURL(path.join(__dirname, '../ops/live-release-20261103/verify-live-cdn.mjs')).href);
const projectRef = 'syntheticprojectonly';
const environment = {
  LIVE_DAILY_WEBHOOK_SECRET: Buffer.alloc(32, 91).toString('base64'),
  LIVE_PLAYBACK_SIGNER_SECRET: 'synthetic-signer-canary-never-log-123456789',
  LIVE_CDN_SIGNING_KEY: Buffer.alloc(32, 77).toString('base64'),
  LIVE_CDN_KEY_ID: 'synthetic1', LIVE_HLS_CDN_ORIGIN: 'https://synthetic-live.invalid',
};
const configuration = { projectRef, config: environment };
const clock = Date.now(), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const session = '7e197237-1881-4007-ac87-5690ba18451f', instance = '76b31882-76b2-40ba-bd76-37bc3c3a34df';
const prefix = 'live/' + session + '/' + instance + '/';
const content = new Map([
  ['master.m3u8', Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nmedia.m3u8\n')],
  ['media.m3u8', Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3.0,\nsegment000.ts\n#EXT-X-ENDLIST\n')],
  ['segment000.ts', Buffer.from(Array.from({ length: 256 }, (_, i) => i))],
]);
const fixture = { schema_version: 1, purpose: 'isolated_cdn_acceptance', session_id: session, instance_id: instance,
  bucket: 'synthetic-live-acceptance-only', region: 'us-east-2', prefix, entrypoint: prefix + 'master.m3u8',
  files: Array.from(content, ([name, bytes]) => ({ relative_path: name, storage_path: prefix + name, size: bytes.length,
    sha256: hash(bytes), range_0_31_sha256: hash(bytes.subarray(0, 32)) })) };

function actualHandlers() {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../functions/live-sign/handler.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Request, Response, Headers, URL, TextEncoder, TextDecoder,
    Uint8Array, Date, crypto: webcrypto });
  const signer = module.exports.createLiveSigner({ secret: environment.LIVE_PLAYBACK_SIGNER_SECRET,
    signingKey: environment.LIVE_CDN_SIGNING_KEY, keyId: environment.LIVE_CDN_KEY_ID,
    cdnOrigin: environment.LIVE_HLS_CDN_ORIGIN }, () => clock);
  const edgeSource = fs.readFileSync(path.join(__dirname, '../../infrastructure/live/viewer-request.js'), 'utf8')
    .replace("import cf from 'cloudfront';", '');
  const edge = vm.runInNewContext(edgeSource + '\nhandler;', {
    Date: class extends Date { static now() { return clock; } },
    cf: { kvs: () => ({ get: async key => {
      if (key !== 'signing:' + environment.LIVE_CDN_KEY_ID) throw Error('missing synthetic key');
      return environment.LIVE_CDN_SIGNING_KEY;
    } }) },
    require(name) { assert.equal(name, 'crypto'); return require('node:crypto'); },
  });
  return { signer, edge };
}

function mockDelivery(options = {}) {
  const { signer, edge } = actualHandlers(), requests = [], cache = new Set(), authenticatedPaths = [];
  return { requests, authenticatedPaths, fetchImpl: async (url, init) => {
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    assert.ok(init.signal instanceof AbortSignal);
    const endpoint = new URL(url), headers = new Headers(init.headers);
    requests.push({ host: endpoint.hostname, path: endpoint.pathname, method: init.method });
    if (endpoint.hostname === projectRef + '.supabase.co') {
      assert.equal(headers.has('origin'), false);
      assert.equal(endpoint.pathname, '/functions/v1/live-sign');
      assert.equal(headers.get('authorization'), 'Bearer ' + environment.LIVE_PLAYBACK_SIGNER_SECRET);
      const result = await signer(new Request(url, init));
      return options.signerResponse ? options.signerResponse(result) : result;
    }
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('cookie'), false);
    if (endpoint.hostname.endsWith('.amazonaws.com')) {
      assert.equal(headers.has('origin'), false);
      assert.equal(endpoint.hostname, fixture.bucket + '.s3.us-east-2.amazonaws.com');
      assert.equal(endpoint.pathname, '/' + fixture.entrypoint);
      return new Response('AccessDenied', { status: options.openS3 ? 200 : 403 });
    }
    assert.equal(endpoint.origin, environment.LIVE_HLS_CDN_ORIGIN);
    if (!options.allowMissingOrigin) assert.equal(headers.get('origin'), 'https://platinumcircles.app');
    const request = { method: init.method, uri: endpoint.pathname, querystring: {},
      headers: Object.fromEntries(Array.from(headers, ([key, value]) => [key, { value }])) };
    const result = await edge({ request });
    if (result.statusCode) {
      return new Response(result.statusCode === 204 ? null : result.body || '', {
        status: result.statusCode === 403 && options.failOpen ? 200 : result.statusCode,
        headers: Object.fromEntries(Object.entries(result.headers).map(([key, value]) => [key, value.value])),
      });
    }
    authenticatedPaths.push(result.uri);
    assert.equal(result.uri.startsWith('/' + prefix), true);
    const name = result.uri.slice(prefix.length + 1);
    let bytes = content.get(name);
    assert.ok(bytes, 'Only exact uploaded fixture assets can reach the mocked origin');
    if (options.tamperSegment && name.endsWith('.ts')) bytes = Buffer.alloc(bytes.length, 8);
    const responseHeaders = { 'content-length': String(bytes.length), 'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=1',
      'x-amz-cf-pop': 'TEST1-P1', 'x-cache': cache.has(result.uri) && !options.allMisses ? 'Hit from cloudfront' : 'Miss from cloudfront' };
    if (headers.has('origin')) responseHeaders['access-control-allow-origin'] = '*';
    cache.add(result.uri);
    if (headers.get('range') && !options.ignoreRange) {
      assert.equal(headers.get('range'), 'bytes=0-31');
      responseHeaders['content-range'] = 'bytes 0-31/' + bytes.length;
      responseHeaders['content-length'] = '32';
      return new Response(bytes.subarray(0, 32), { status: 206, headers: responseHeaders });
    }
    return new Response(init.method === 'HEAD' ? null : bytes, { status: 200, headers: responseHeaders });
  } };
}
function safeReceipt(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const name of ['LIVE_DAILY_WEBHOOK_SECRET', 'LIVE_PLAYBACK_SIGNER_SECRET', 'LIVE_CDN_SIGNING_KEY']) {
    assert.equal(text.includes(environment[name]), false, name + ' must not appear');
  }
  assert.equal(text.includes('https://'), false);
  assert.equal(text.includes('/_live/'), false);
  assert.equal(text.includes('synthetic-live.invalid'), false);
}
const run = async (mock = mockDelivery(), extra = {}) => (await helper).runCdnAcceptance(configuration, fixture, {
  fetchImpl: mock.fetchImpl, now: () => clock, ...extra,
});

test('fifteen bounded CDN probes use actual signer and viewer authorization implementations', async () => {
  const mock = mockDelivery(), receipt = await run(mock);
  assert.equal(receipt.ok, true); assert.equal(receipt.passed, 15); assert.equal(receipt.total, 15);
  assert.equal(receipt.provider_broadcast_verified, false); assert.equal(receipt.measured_capacity_verified, false);
  assert.equal(mock.requests.length, 18, 'One signer, three fixture reads, five delivery reads, and nine denials');
  assert.equal(mock.requests.filter(item => item.host === projectRef + '.supabase.co').length, 1);
  assert.equal(mock.authenticatedPaths.filter(value => value.endsWith('.ts')).length, 5);
  assert.ok(receipt.probes.slice(-9).every(item => item.status === 403));
  const scopeRequests = mock.requests.filter(item => item.path.includes('/_live/')).slice(-7);
  assert.ok(scopeRequests.filter(item => item.method === 'GET').every(item => item.path.endsWith(fixture.entrypoint)),
    'Wrong scope probes must target an existing uploaded object, so a missing object cannot create a false pass');
  safeReceipt(receipt);
});

test('an altered signer URL fails closed before any CDN request', async () => {
  const mock = mockDelivery({ signerResponse: async response => {
    const body = await response.json();
    body.url = 'https://attacker.invalid/' + environment.LIVE_PLAYBACK_SIGNER_SECRET;
    return Response.json(body, { headers: response.headers });
  } });
  const receipt = await run(mock);
  assert.equal(receipt.ok, false); assert.equal(receipt.total, 1); assert.equal(mock.requests.length, 1);
  assert.equal(receipt.probes[0].error, 'INVALID_SIGNER_RESPONSE'); safeReceipt(receipt);
});

test('CDN requests model browser Origin and still reject a response without the required CORS header', async () => {
  const mock = mockDelivery({ allowMissingOrigin: true });
  const receipt = await run({ fetchImpl: async (url, init) => {
    const headers = { ...init.headers };
    delete headers.Origin;
    return mock.fetchImpl(url, { ...init, headers });
  } });
  assert.equal(receipt.ok, false); assert.equal(receipt.total, 2);
  assert.equal(receipt.probes[1].error, 'CORS_MISMATCH'); safeReceipt(receipt);
});

test('fixture hashes, range delivery, and actual shared-cache evidence are required', async () => {
  const tampered = await run(mockDelivery({ tamperSegment: true }));
  assert.equal(tampered.ok, false); assert.equal(tampered.total, 2);
  assert.equal(tampered.probes[1].error, 'ASSET_HASH_MISMATCH'); safeReceipt(tampered);
  const ranged = await run(mockDelivery({ ignoreRange: true }));
  assert.equal(ranged.probes.find(item => item.name === 'segment_range').ok, false); safeReceipt(ranged);
  const misses = await run(mockDelivery({ allMisses: true }));
  assert.equal(misses.probes.find(item => item.name === 'shared_cache_across_capabilities').error, 'CACHE_NOT_SHARED');
  safeReceipt(misses);
});

test('fail-open CDN and public S3 responses fail the negative acceptance checks', async () => {
  const openEdge = await run(mockDelivery({ failOpen: true }));
  assert.equal(openEdge.ok, false); assert.equal(openEdge.passed, 7);
  assert.ok(openEdge.probes.slice(-9, -1).every(item => item.error === 'UNEXPECTED_HTTP_STATUS'));
  const openS3 = await run(mockDelivery({ openS3: true }));
  assert.equal(openS3.ok, false); assert.equal(openS3.passed, 14);
  assert.equal(openS3.probes.at(-1).name, 'unauthenticated_s3_denied');
  safeReceipt(openEdge); safeReceipt(openS3);
});

test('network, redirect, malicious payload, and oversized responses stay redacted', async () => {
  const canary = environment.LIVE_PLAYBACK_SIGNER_SECRET + ' https://attacker.invalid/_live/secret';
  const cases = [
    { fetchImpl: async () => { throw Error(canary); }, expected: 'REQUEST_FAILED' },
    { fetchImpl: async () => new Response(null, { status: 302, headers: { Location: canary } }), expected: 'UNEXPECTED_REDIRECT' },
    { fetchImpl: async () => Response.json({ url: canary }, { headers: {
      'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store' } }), expected: 'INVALID_SIGNER_RESPONSE' },
    { fetchImpl: async () => new Response('x'.repeat(20_000)), expected: 'RESPONSE_TOO_LARGE' },
    { fetchImpl: async () => new Response('small', { headers: { 'Content-Length': '999999999' } }), expected: 'RESPONSE_TOO_LARGE' },
  ];
  for (const item of cases) {
    const receipt = await run(item);
    assert.equal(receipt.total, 1); assert.equal(receipt.probes[0].error, item.expected); safeReceipt(receipt);
  }
});

test('deadlines stop fetch and response-body stalls and cancel the stalled reader', async () => {
  let canceled = false;
  const cases = [
    { fetchImpl: () => new Promise(() => {}) },
    { fetchImpl: async () => new Response(new ReadableStream({ start() {}, cancel() { canceled = true; } })) },
  ];
  for (const item of cases) {
    const receipt = await run(item, { timeoutMs: 5 });
    assert.equal(receipt.total, 1); assert.equal(receipt.probes[0].error, 'TIMEOUT'); safeReceipt(receipt);
  }
  assert.equal(canceled, true);
});

test('fixture metadata cannot select arbitrary URLs, traversal, duplicate objects, or excessive reads', async () => {
  const { validateFixture, runCdnAcceptance } = await helper;
  assert.deepEqual(validateFixture({ ...fixture, untrusted_url: 'https://attacker.invalid/' }), fixture);
  const changes = [
    value => { value.bucket = 'bucket.attacker.invalid'; },
    value => { value.entrypoint = 'https://attacker.invalid/file'; },
    value => { value.session_id = value.session_id.toUpperCase(); },
    value => { value.files[0].relative_path = '../master.m3u8'; },
    value => { value.files.push(value.files[0]); },
    value => { value.files[0].size = 4_000_000; },
    value => { value.files[0].sha256 = 'bad'; },
  ];
  for (const change of changes) {
    const value = structuredClone(fixture); change(value);
    let calls = 0;
    await assert.rejects(runCdnAcceptance(configuration, value, { fetchImpl: async () => { calls++; } }), /INVALID_FIXTURE/);
    assert.equal(calls, 0);
  }
});

test('fixture loading rejects symlinks and oversized files; CLI error and help never access the network', async () => {
  const { loadFixture, main } = await helper, directory = await mkdtemp(path.join(tmpdir(), 'live-cdn-synthetic-'));
  try {
    const filename = path.join(directory, 'fixture.json'), linked = path.join(directory, 'linked.json');
    await writeFile(filename, JSON.stringify(fixture));
    assert.deepEqual(await loadFixture(filename), fixture);
    await symlink(filename, linked);
    await assert.rejects(loadFixture(linked), /FIXTURE_FILE_UNREADABLE/);
    await writeFile(filename, 'x'.repeat(65_537));
    await assert.rejects(loadFixture(filename), /INVALID_FIXTURE/);
    let output = '', calls = 0;
    const write = text => { output += text; }, fetchImpl = async () => { calls++; };
    assert.equal(await main(['--unknown-' + environment.LIVE_PLAYBACK_SIGNER_SECRET], { write, fetchImpl }), 2);
    assert.equal(JSON.parse(output).error, 'INVALID_ARGUMENTS'); safeReceipt(output);
    output = '';
    assert.equal(await main(['--help'], { write, fetchImpl }), 0);
    assert.match(output, /15 bounded probes/); assert.equal(calls, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
