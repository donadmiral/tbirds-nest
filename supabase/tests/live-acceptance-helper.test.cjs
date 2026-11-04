const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { mkdtemp, writeFile, chmod, symlink, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { webcrypto } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const helper = import(pathToFileURL(path.join(__dirname, '../ops/live-release-20261103/verify-live-secrets.mjs')).href);
const projectRef = 'syntheticprojectonly';
const environment = {
  LIVE_DAILY_WEBHOOK_SECRET: Buffer.alloc(32, 91).toString('base64'),
  LIVE_PLAYBACK_SIGNER_SECRET: 'synthetic-signer-canary-never-log-123456789',
  LIVE_CDN_SIGNING_KEY: Buffer.alloc(32, 77).toString('base64'),
  LIVE_CDN_KEY_ID: 'synthetic1', LIVE_HLS_CDN_ORIGIN: 'https://synthetic-live.invalid',
};
function load(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../functions', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Request, Response, Headers, URL, AbortSignal, TextEncoder, TextDecoder,
    Uint8Array, Date, crypto: webcrypto, atob, btoa, require(name) { if (name in imports) return imports[name]; throw Error(name); } });
  return module.exports;
}
const provider = load('live-core/provider.ts');
const acknowledgement = load('_shared/dailyCommandAcknowledgement.ts');
const { createLiveHandler } = load('live-core/handler.ts', {
  './provider.ts': provider, '../_shared/dailyCommandAcknowledgement.ts': acknowledgement,
});
const { createLiveSigner } = load('live-sign/handler.ts');
const noStore = { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store' };
function deployedHandlers({ signingKey = environment.LIVE_CDN_SIGNING_KEY } = {}) {
  let sideEffects = 0;
  const forbidden = () => { sideEffects++; throw Error('No provider, database, or auth operation is allowed'); };
  const webhook = createLiveHandler('webhook', { caller: forbidden, service: { rpc: forbidden }, fetch: forbidden,
    config: { webhookSecret: environment.LIVE_DAILY_WEBHOOK_SECRET } });
  const signer = createLiveSigner({ secret: environment.LIVE_PLAYBACK_SIGNER_SECRET, signingKey,
    keyId: environment.LIVE_CDN_KEY_ID, cdnOrigin: environment.LIVE_HLS_CDN_ORIGIN });
  const requests = [];
  return { requests, sideEffects: () => sideEffects, fetchImpl: async (url, init) => {
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, `https://${projectRef}.supabase.co`);
    const request = new Request(url, init);
    requests.push({ endpoint: endpoint.pathname, body: JSON.parse(init.body) });
    if (endpoint.pathname === '/functions/v1/live-provider-webhook') {
      assert.deepEqual(JSON.parse(init.body), { test: 'test' });
      return webhook(request);
    }
    assert.equal(endpoint.pathname, '/functions/v1/live-sign');
    return signer(request);
  } };
}
function safeReceipt(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const name of ['LIVE_DAILY_WEBHOOK_SECRET', 'LIVE_PLAYBACK_SIGNER_SECRET', 'LIVE_CDN_SIGNING_KEY']) {
    assert.equal(text.includes(environment[name]), false, `${name} must not appear`);
  }
  assert.equal(text.includes('https://'), false, 'No endpoint or signed URL belongs in the receipt');
  assert.equal(text.includes('/_live/'), false, 'No capability belongs in the receipt');
  return text;
}

test('ten safe acceptance probes exercise actual deployed contracts without application or provider effects', async () => {
  const { loadConfiguration, runAcceptance } = await helper, mock = deployedHandlers();
  const receipt = await runAcceptance(await loadConfiguration({ projectRef }, environment), mock);
  assert.equal(receipt.ok, true); assert.equal(receipt.passed, 10); assert.equal(receipt.total, 10);
  assert.deepEqual(receipt.probes.map(item => item.status), [200, 401, 401, 200, 401, 401, 400, 400, 400, 400]);
  assert.equal(mock.sideEffects(), 0); assert.equal(mock.requests.length, 10);
  safeReceipt(receipt);
});

test('a different deployed CDN key fails capability verification without printing the capability', async () => {
  const { loadConfiguration, runAcceptance } = await helper;
  const receipt = await runAcceptance(await loadConfiguration({ projectRef }, environment), deployedHandlers({ signingKey: 'wrong-deployed-key-'.repeat(4) }));
  assert.equal(receipt.ok, false); assert.equal(receipt.passed, 9);
  assert.equal(receipt.probes[3].error, 'UNEXPECTED_RESPONSE'); safeReceipt(receipt);
});

test('network errors, malicious response bodies, and unknown CLI arguments cannot enter output', async () => {
  const { loadConfiguration, runAcceptance, main } = await helper;
  const configuration = await loadConfiguration({ projectRef }, environment);
  const canary = environment.LIVE_PLAYBACK_SIGNER_SECRET + ' https://attacker.invalid/_live/secret';
  const network = await runAcceptance(configuration, { fetchImpl: async () => { throw Error(canary); } });
  assert.ok(network.probes.every(item => item.error === 'REQUEST_FAILED')); safeReceipt(network);
  const malicious = await runAcceptance(configuration, { fetchImpl: async () => Response.json({ error: canary }, { headers: noStore }) });
  assert.equal(malicious.ok, false); safeReceipt(malicious);
  let output = '', calls = 0;
  const exit = await main(['--unknown-' + canary], { environment, write: text => { output += text; }, fetchImpl: async () => { calls++; } });
  assert.equal(exit, 2); assert.equal(calls, 0); assert.equal(JSON.parse(output).error, 'INVALID_ARGUMENTS'); safeReceipt(output);
});

test('redirect and oversized responses fail closed, including an untrusted content-length header', async () => {
  const { loadConfiguration, runAcceptance } = await helper;
  const configuration = await loadConfiguration({ projectRef }, environment);
  const redirect = await runAcceptance(configuration, { fetchImpl: async () => new Response(null, { status: 302,
    headers: { Location: 'https://attacker.invalid/' + environment.LIVE_PLAYBACK_SIGNER_SECRET } }) });
  assert.ok(redirect.probes.every(item => item.error === 'UNEXPECTED_REDIRECT')); safeReceipt(redirect);
  for (const headers of [noStore, { ...noStore, 'Content-Length': '9999999' }]) {
    const receipt = await runAcceptance(configuration, { fetchImpl: async () => new Response('x'.repeat(20_000), { headers }) });
    assert.equal(receipt.probes[0].error, 'RESPONSE_TOO_LARGE'); safeReceipt(receipt);
  }
});

test('the deadline bounds fetch and response-body stalls without surfacing raw exceptions', async () => {
  const { loadConfiguration, runAcceptance } = await helper;
  const configuration = await loadConfiguration({ projectRef }, environment);
  for (const fetchImpl of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }), { headers: noStore })]) {
    const receipt = await runAcceptance(configuration, { fetchImpl, timeoutMs: 5 });
    assert.equal(receipt.probes[0].error, 'TIMEOUT'); assert.equal(receipt.ok, false); safeReceipt(receipt);
  }
});

test('protected file mode and symlink checks reject unsafe inputs before any probe', async () => {
  const { loadConfiguration } = await helper;
  const directory = await mkdtemp(path.join(tmpdir(), 'live-acceptance-synthetic-'));
  try {
    const filename = path.join(directory, 'operator.env'), linked = path.join(directory, 'linked.env');
    await writeFile(filename, Object.entries(environment).map(([name, value]) => `${name}=${value}`).join('\n'), { mode: 0o600 });
    const configuration = await loadConfiguration({ projectRef, envFile: filename }, {});
    assert.deepEqual(configuration.config, environment);
    await chmod(filename, 0o644);
    await assert.rejects(loadConfiguration({ projectRef, envFile: filename }, environment), /UNSAFE_SECRET_FILE/);
    await chmod(filename, 0o600); await symlink(filename, linked);
    await assert.rejects(loadConfiguration({ projectRef, envFile: linked }, environment), /SECRET_FILE_UNREADABLE/);
    await writeFile(filename, 'x'.repeat(32_769));
    await assert.rejects(loadConfiguration({ projectRef, envFile: filename }, environment), /SECRET_FILE_TOO_LARGE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('configuration rejects arbitrary target URLs, malformed secrets, and partial files without environment fallback', async () => {
  const { loadConfiguration, main } = await helper;
  await assert.rejects(loadConfiguration({ projectRef: 'https://attacker.invalid' }, environment), /INVALID_PROJECT_REF/);
  await assert.rejects(loadConfiguration({ projectRef }, { ...environment, LIVE_DAILY_WEBHOOK_SECRET: 'not-base64' }), /INVALID_LIVE_DAILY_WEBHOOK_SECRET/);
  await assert.rejects(loadConfiguration({ projectRef }, { ...environment, LIVE_CDN_KEY_ID: 'Invalid' }), /INVALID_LIVE_CDN_KEY_ID/);
  await assert.rejects(loadConfiguration({ projectRef }, { ...environment, LIVE_HLS_CDN_ORIGIN: 'https://synthetic-live.invalid/path' }), /INVALID_LIVE_HLS_CDN_ORIGIN/);
  const directory = await mkdtemp(path.join(tmpdir(), 'live-acceptance-synthetic-'));
  try {
    const filename = path.join(directory, 'partial.env');
    await writeFile(filename, `LIVE_CDN_KEY_ID=synthetic1\n`, { mode: 0o600 });
    await assert.rejects(loadConfiguration({ projectRef, envFile: filename }, environment), /MISSING_LIVE_DAILY_WEBHOOK_SECRET/);
  } finally { await rm(directory, { recursive: true, force: true }); }
  let output = '', calls = 0;
  assert.equal(await main(['--help'], { write: text => { output += text; }, fetchImpl: async () => { calls++; } }), 0);
  assert.match(output, /Usage:/); assert.equal(calls, 0);
});
