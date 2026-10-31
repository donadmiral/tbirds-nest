// Execute the real native screen with synthetic Auth/Linking adapters. Auth
// credentials must reach their provider operation, never the console sink.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');
const flush = async () => { for (let index = 0; index < 32; index++) await Promise.resolve(); };
const secrets = {
  access: 'synthetic-access-credential',
  refresh: 'synthetic-refresh-credential',
  code: 'synthetic-exchange-code',
  hash: 'synthetic-verification-hash',
  email: 'private-person@example.invalid',
  type: 'synthetic-untrusted-verification-type',
};
const providerFailure = new Error(Object.values(secrets).join(' '));
function harness(options = {}) {
  const logs = [], calls = [], effects = [], state = [];
  let cursor = 0, warmListener;
  const authOperation = name => async argument => {
    calls.push({ name, argument });
    if (options.providerThrows) throw providerFailure;
    return { error: options.providerRejects ? providerFailure : null };
  };
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    setSession: authOperation('setSession'),
    verifyOtp: authOperation('verifyOtp'),
    exchangeCodeForSession: authOperation('exchangeCodeForSession'),
    signOut: async () => ({ error: null }),
  };
  const store = {
    isPasswordRecovery: Boolean(options.recoveryUrl), recoveryUrl: options.recoveryUrl || null, session: null,
    setPasswordRecovery() {}, setRecoveryUrl() {}, markRecoveryConsumed() {},
  };
  const useAuthStore = selector => selector(store);
  useAuthStore.getState = () => store;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useEffect(effect) { effects.push(effect); },
  };
  const native = Object.fromEntries(['View', 'Text', 'TextInput', 'TouchableOpacity', 'ActivityIndicator', 'KeyboardAvoidingView'].map(name => [name, name]));
  native.Platform = { OS: 'ios' };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
  const imports = {
    react, 'react/jsx-runtime': runtime, 'react-native': native,
    '../../theme/useTheme': { themedSheet: factory => factory({ surface: { hairline: '#ddd' } }) },
    'expo-linking': {
      getInitialURL: async () => { if (options.initialThrows) throw providerFailure; return options.initialUrl || null; },
      addEventListener: (_, listener) => { warmListener = listener; return { remove() { warmListener = undefined; } }; },
    },
    '@expo/vector-icons': { Feather: 'Feather' },
    'react-native-flash-message': { showMessage() {} },
    '../../services/supabase': { supabase: { auth } },
    '../../services/authService': { authService: { updatePassword: async () => {} } },
    '../../stores/authStore': { useAuthStore },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, 'src/screens/auth/AuthCallbackScreen.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) { assert.ok(name in imports, 'Unexpected import: ' + name); return imports[name]; },
    console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(name => [name, (...values) => logs.push({ name, values })])),
    URLSearchParams: options.parserThrows ? class { constructor() { throw providerFailure; } } : URLSearchParams,
    setTimeout: () => 1, clearTimeout() {},
  });
  module.exports.default({ navigation: { reset() {} } });
  const cleanups = effects.map(effect => effect());
  return { logs, calls, warm: url => warmListener({ url }), cleanup: () => cleanups.forEach(cleanup => cleanup?.()) };
}
function assertPrivateLogs(run, url) {
  assert.ok(run.logs.length > 0, 'the real screen produced diagnostic events');
  for (const entry of run.logs) {
    assert.equal(entry.values.length, 1, 'diagnostic events contain only one fixed label');
    assert.equal(typeof entry.values[0], 'string');
  }
  const output = JSON.stringify(run.logs);
  for (const secret of [...Object.values(secrets), url]) if (secret) assert.equal(output.includes(secret), false, 'auth data must not reach any console method');
}

test('cold PKCE callback sends its code to Auth without logging the URL, code, or email', async () => {
  const url = `platinumcircles://auth/callback?code=${secrets.code}&email=${secrets.email}`;
  const run = harness({ initialUrl: url }); await flush();
  assert.equal(run.calls.find(call => call.name === 'exchangeCodeForSession').argument, secrets.code);
  assertPrivateLogs(run, url); run.cleanup();
});

test('stored bearer recovery and provider rejections never log credentials or provider error text', async () => {
  const url = `platinumcircles://auth/callback#access_token=${secrets.access}&refresh_token=${secrets.refresh}`;
  const run = harness({ recoveryUrl: url, providerRejects: true }); await flush();
  const call = run.calls.find(value => value.name === 'setSession');
  assert.equal(call.argument.access_token, secrets.access); assert.equal(call.argument.refresh_token, secrets.refresh);
  assertPrivateLogs(run, url); run.cleanup();
});

test('warm verification callback never logs its token or untrusted type parameter', async () => {
  const url = `platinumcircles://auth/callback?token=${secrets.hash}&type=${secrets.type}&email=${secrets.email}`;
  const run = harness({ providerRejects: true }); await flush(); await run.warm(url);
  const call = run.calls.find(value => value.name === 'verifyOtp');
  assert.equal(call.argument.token_hash, secrets.hash); assert.equal(call.argument.type, secrets.type);
  assertPrivateLogs(run, url); run.cleanup();
});

test('parser, provider and initial-link exceptions remain private while error paths execute', async () => {
  const url = `platinumcircles://auth/callback?code=${secrets.code}#access_token=${secrets.access}&refresh_token=${secrets.refresh}`;
  for (const failure of [{ parserThrows: true }, { providerThrows: true }, { initialThrows: true }]) {
    const run = harness({ initialUrl: url, ...failure }); await flush();
    assertPrivateLogs(run, url); run.cleanup();
  }
});
