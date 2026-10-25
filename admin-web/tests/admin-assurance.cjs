const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const QA = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const admin = { id: 'owner', sessionId: 'native-session', role: 'super_admin', email: 'owner@example.test', aal: 'aal1' };
function load(url = QA, response = { data: true, error: null }) {
  const calls = [], module = { exports: {} };
  const rpc = async (...args) => { calls.push(args); if (response instanceof Error) throw response; return response; };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/adminAssurance.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, exports: module.exports, process: { env: { NEXT_PUBLIC_SUPABASE_URL: url } },
    require: name => name === 'server-only' ? {} : name === './supabaseAdmin' ? { serviceClient: () => ({ rpc }) } : (() => { throw new Error(name); })() });
  return { check: module.exports.canAccessOperations, calls };
}
test('AAL2 keeps the normal policy without a database exception lookup', async () => {
  const { check, calls } = load(undefined, new Error('offline'));
  assert.equal(await check({ ...admin, aal: 'aal2' }), true);
  assert.equal(calls.length, 0);
});
test('AAL1 exception is limited to the exact isolated QA project', async () => {
  for (const url of ['', 'https://production.supabase.co', QA + '/', QA + '.evil.test']) {
    const { check, calls } = load(url);
    assert.equal(await check(admin), false);
    assert.equal(calls.length, 0);
  }
});
test('QA checks the validated owner and native session against the service-only database policy', async () => {
  const { check, calls } = load();
  assert.equal(await check(admin), true);
  assert.equal(JSON.stringify(calls), JSON.stringify([['triniti_admin_single_owner_access', { p_actor_id: admin.id, p_session_id: admin.sessionId }]]));
});
test('missing policy, false responses and service failures fail closed', async () => {
  for (const response of [{ data: false }, { data: null }, { data: 'true' }, { data: true, error: { message: 'denied' } }, new Error('offline')]) {
    assert.equal(await load(QA, response).check(admin), false);
  }
});
test('an absent or unrecognized assurance level cannot use the exception', async () => {
  const { check, calls } = load();
  for (const aal of [undefined, '', 'aal3']) assert.equal(await check({ ...admin, aal }), false);
  assert.equal(calls.length, 0);
});
