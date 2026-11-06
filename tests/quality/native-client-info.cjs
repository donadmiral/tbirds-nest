const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient, processLock } = require('@supabase/supabase-js');

test('native prepared-cursor opt-in preserves existing client info through the installed SDK', async () => {
  let configured;
  const requests = [];
  const modules = {
    'react-native-url-polyfill/auto': {},
    'react-native': { Platform: { OS: 'ios' }, AppState: { addEventListener() {} } },
    '@react-native-async-storage/async-storage': { default: {} },
    '@supabase/supabase-js': { processLock, createClient: (...args) => { configured = args; return {}; } },
    '../../shared/authFetch': { createAuthDeadlineFetch: (_url, next) => next },
    '../../shared/networkActivity': { reportNetworkActivity() {} },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../src/services/supabase.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, {
    exports: {}, require(name) { assert.ok(name in modules, name); return modules[name]; },
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://native-client-info.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key' } },
    __DEV__: false, AbortController, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      requests.push({ url: String(url), headers: new Headers(init.headers) });
      return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    },
  });
  const [url, key, options] = configured;
  assert.deepEqual(Object.keys(options.global.headers), ['x-client-info'], 'Opt-in reuses the existing CORS-allowed header');
  assert.equal(options.global.headers['x-client-info'], 'PlatinumCircles-nest-mobile platinum-cache/1');
  const client = createClient(url, key, { ...options,
    auth: { ...options.auth, storage: undefined, autoRefreshToken: false, persistSession: false } });
  try {
    const result = await client.rpc('get_feed', { p_mode: 'for_you', p_limit: 20 });
    assert.equal(result.error, null);
    assert.equal(requests.length, 1);
    const info = requests[0].headers.get('x-client-info');
    assert.match(info, /supabase-js-[^/]+\/\d+\.\d+\.\d+/);
    assert.match(info, /PlatinumCircles-nest-mobile/);
    assert.equal(info.match(/platinum-cache\/1/g)?.length, 1);
  } finally { await client.auth.stopAutoRefresh(); }
});
