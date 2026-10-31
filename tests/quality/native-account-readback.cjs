const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { OWNER, PEER, createFixture } = require('../native/backend-fixture.cjs');
const root = path.resolve(__dirname, '../..');
const env = { EXPO_PUBLIC_APP_ENV: 'qa', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key' };

function reader(environment = env) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'tests/native/account-readback.cjs'), 'utf8'), {
    module, exports: module.exports, process: { env: environment }, require: () => ({ OWNER }),
  });
  return module.exports.readSavedAccount;
}

function store() {
  const values = new Map(), calls = [];
  let failWrites = false;
  const session = { user: { id: OWNER }, refresh_token: 'synthetic-account-readback-value' };
  const SecureStore = {
    async getItemAsync(key) { calls.push('get'); return values.get(key) ?? null; },
    async setItemAsync(key, value) { calls.push('set'); if (failWrites) throw new Error('synthetic write failure'); values.set(key, value); },
    async deleteItemAsync(key) { calls.push('delete'); values.delete(key); },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/stores/accountsStore.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, console: { log() {} }, require: name => {
    if (name === 'zustand') return require('zustand');
    if (name === 'expo-secure-store') return SecureStore;
    if (name === 'react-native') return { Platform: { OS: 'ios' }, DevSettings: {} };
    if (name === '../services/supabase') return { supabase: { auth: { async getSession() { return { data: { session } }; } } } };
    throw new Error('Unexpected account-store dependency: ' + name);
  } });
  return { accountsStore: module.exports.useAccountsStore, authStore: { getState: () => ({ session }) },
    session, values, calls, failWrites: () => { failWrites = true; } };
}

test('QA readback runs the unchanged production account save and reload path, returning no stored contents', async () => {
  const h = store(); await h.accountsStore.getState().remember(h.session);
  h.accountsStore.setState({ accounts: [], currentId: null }); h.calls.length = 0;
  const result = await reader()(h);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { passed: true, reloaded: true, accountCount: 1 });
  assert.deepEqual(h.calls, ['get', 'get'], 'init reads the keychain index and then its account item');
  assert.equal(h.accountsStore.getState().accounts[0].refresh_token, h.session.refresh_token);
  assert.equal(JSON.stringify(result).includes(OWNER), false);
  assert.equal(JSON.stringify(result).includes(h.session.refresh_token), false);
});

test('an account left only in memory after a caught storage-write failure cannot pass readback', async () => {
  const h = store(); h.failWrites(); await h.accountsStore.getState().remember(h.session);
  assert.equal(h.accountsStore.getState().accounts.length, 1);
  const result = await reader()(h);
  assert.equal(result.passed, false); assert.equal(result.accountCount, 0); assert.equal(result.reloaded, true);
});

test('persisted refresh contents must match the active synthetic session', async () => {
  const h = store(); await h.accountsStore.getState().remember(h.session);
  for (const [key, value] of h.values) if (!Array.isArray(JSON.parse(value))) {
    h.values.set(key, JSON.stringify({ ...JSON.parse(value), refresh_token: 'different-synthetic-value' }));
  }
  assert.equal((await reader()(h)).passed, false);
});

test('a session changing during readback cannot pass for the previous account', async () => {
  const h = store(); await h.accountsStore.getState().remember(h.session);
  let reads = 0;
  h.authStore.getState = () => ({ session: ++reads === 1 ? h.session : { ...h.session, user: { id: PEER } } });
  assert.equal((await reader()(h)).passed, false);
});

test('production configuration and a different actor are rejected before storage reads', async () => {
  const h = store();
  await assert.rejects(reader({ ...env, EXPO_PUBLIC_APP_ENV: 'production' })(h), /isolated native QA fixture/);
  h.authStore.getState = () => ({ session: { ...h.session, user: { id: PEER } } });
  await assert.rejects(reader()(h), /synthetic owner/);
  assert.equal(h.calls.length, 0);
});

test('fixture readback receipts retain only booleans and a count even if extra fields are supplied', () => {
  const fixture = createFixture();
  fixture.recordAccountReadback({ passed: true, reloaded: true, accountCount: 1, token: 'do-not-retain', key: 'do-not-retain', id: OWNER });
  assert.deepEqual(fixture.receipt.accountReadbacks, [{ passed: true, reloaded: true, accountCount: 1 }]);
  assert.equal(JSON.stringify(fixture.receipt).includes('do-not-retain'), false);
  assert.equal(JSON.stringify(fixture.receipt).includes(OWNER), false);
});
