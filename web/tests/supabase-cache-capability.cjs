const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sdk = require('@supabase/ssr');
function load(file, imports = {}, extra = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => imports[name], Headers, Request, Response, URL, AbortController, setTimeout, clearTimeout,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anonymous-key' } }, ...extra });
  return module.exports;
}
const helper = load('lib/supabase/cacheCapabilityFetch.ts');

test('cache capability appends once and preserves SDK versions, custom tokens and request options', async () => {
  const headers = new Headers({ 'X-Client-Info': 'supabase-ssr/0.12.4 createBrowserClient custom/2', apikey: 'anon', 'content-type': 'application/json' });
  const signal = new AbortController().signal, init = { method: 'POST', headers, body: '{}', signal };
  let received;
  const fetcher = helper.cacheCapabilityFetch(async (input, options) => { received = { input, options }; return new Response('[]'); });
  await fetcher('https://project.supabase.co/rest/v1/rpc/get_feed', init);
  assert.equal(received.options.headers.get('x-client-info'), 'supabase-ssr/0.12.4 createBrowserClient custom/2 platinum-cache/1');
  assert.equal(received.options.headers.get('apikey'), 'anon'); assert.equal(received.options.body, '{}'); assert.equal(received.options.signal, signal);
  assert.equal(headers.get('x-client-info'), 'supabase-ssr/0.12.4 createBrowserClient custom/2');
  await fetcher(received.input, received.options);
  assert.equal(received.options.headers.get('x-client-info').match(/platinum-cache\/1/g).length, 1);
  assert.deepEqual([...received.options.headers.keys()].sort(), [...headers.keys()].sort());
});

test('Request headers survive and a different capability version is not mistaken for the exact token', async () => {
  const request = new Request('https://project.supabase.co/rest/v1/posts', { headers: { 'x-client-info': 'custom/1 platinum-cache/10', authorization: 'Bearer test' } });
  let received;
  await helper.cacheCapabilityFetch(async (_input, init) => { received = init; return new Response('[]'); })(request);
  assert.equal(received.headers.get('x-client-info'), 'custom/1 platinum-cache/10 platinum-cache/1');
  assert.equal(received.headers.get('authorization'), 'Bearer test');
  assert.equal(request.headers.get('x-client-info'), 'custom/1 platinum-cache/10');
});

for (const [file, expected] of [['client.ts','createBrowserClient'], ['server.ts','createServerClient']]) {
  test(`actual installed SSR ${expected} sends its own version and the cache capability`, async () => {
    const calls = [];
    const transport = async (input, init) => { calls.push({ input: String(input), headers: new Headers(init.headers) }); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); };
    const auth = load('../shared/authFetch.ts');
    const factory = load('lib/supabase/' + file, { '@supabase/ssr': sdk, './cacheCapabilityFetch': helper,
      '../../../shared/authFetch': auth, 'next/headers': { cookies: async () => ({ getAll: () => [], set() {} }) } }, { fetch: transport });
    const client = await factory.createClient();
    const result = await client.rpc('get_feed', { p_mode: 'for_you', p_limit: 20 });
    assert.equal(result.error, null); assert.equal(calls.length, 1);
    const info = calls[0].headers.get('x-client-info');
    assert.match(info, new RegExp('^supabase-ssr/[^ ]+ ' + expected + ' platinum-cache/1$'));
    assert.equal(calls[0].headers.get('apikey'), 'test-anonymous-key');
    client.auth.stopAutoRefresh();
  });
}
