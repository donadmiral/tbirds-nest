const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const OWNER = '10000000-0000-4000-8000-000000000001', OTHER = '10000000-0000-4000-8000-000000000002';
const SESSION = '20000000-0000-4000-8000-000000000001', OTHER_SESSION = '20000000-0000-4000-8000-000000000002';
let db;
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await rows(sql, args))[0] || {})[0];
const permitted = (actor = OWNER, session = SESSION) => scalar('select public.triniti_admin_single_owner_access($1,$2)', [actor, session]);
const operation = (permission = 'system', actor = OWNER, session = SESSION) => scalar('select admin_ops.require_session($1,$2,$3)', [actor, session, permission]);
const finance = () => scalar('select creator_finance.require_staff($1,$2)', [OWNER, SESSION]);
async function denies(fn, pattern) {
  await db.exec('savepoint refusal');
  try { await assert.rejects(fn, pattern); } finally { await db.exec('rollback to savepoint refusal'); }
}
async function enable(owner = OWNER) {
  await rows('insert into admin_ops.single_owner_qa_policy(owner_id,enabled,reason) values($1,true,$2)', [owner, 'Authorized sole owner QA access']);
}
test.before(async () => {
  const { extensions, loadLiveSchema } = await import('./rpc-authorization/live-schema-fixture.mjs');
  db = new PGlite({ extensions });
  await loadLiveSchema(db);
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  const dir = path.join(__dirname, '../migrations');
  for (const file of fs.readdirSync(dir).filter(n => /^202610(22|23)\d+.*\.sql$/.test(n)).sort()) await db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
  await db.exec(fs.readFileSync(path.join(dir, '20261025073213_single_owner_qa_access.sql'), 'utf8'));
  for (const [id, email] of [[OWNER, 'owner@example.test'], [OTHER, 'other@example.test']]) {
    await rows('insert into auth.users(id,email) values($1,$2)', [id, email]);
    await rows('insert into public.profiles(id,email,username) values($1,$2,$3) on conflict(id) do nothing', [id, email, email.split('@')[0]]);
  }
  await rows("insert into public.admin_users(user_id,role) values($1,'super_admin')", [OWNER]);
  await rows("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1'),($3,$4,'aal1')", [SESSION, OWNER, OTHER_SESSION, OTHER]);
});
test.beforeEach(async () => db.exec('begin'));
test.afterEach(async () => db.exec('rollback'));
test.after(async () => db?.close());
test('new migration defaults to requiring MFA and accepts normal AAL2', async () => {
  assert.equal(await permitted(), false);
  await denies(() => operation(), /ACTIVE_ADMIN_SESSION_REQUIRED/);
  await denies(() => finance(), /MFA_REQUIRED/);
  await rows("update auth.sessions set aal='aal2' where id=$1", [SESSION]);
  assert.equal(await operation(), 'super_admin');
  await finance();
});
test('explicit sole owner AAL1 can execute a real audited idempotent command', async () => {
  await enable();
  assert.equal(await permitted(), true);
  assert.equal(await operation(), 'super_admin');
  await finance();
  const financeDesk = await scalar('select public.creator_finance_admin_snapshot($1,$2)', [OWNER, SESSION]);
  assert.ok(Array.isArray(financeDesk.enrollments));
  assert.ok(Array.isArray(financeDesk.payouts));
  const commandKey = '30000000-0000-4000-8000-000000000001';
  const invoke = () => scalar('select public.triniti_platinum_admin_command($1,$2,$3,$4,$5)', [OWNER, SESSION, commandKey, 'publishAnnouncement', { title: 'Owner QA', body: 'Audited operation' }]);
  const first = await invoke(), replay = await invoke();
  assert.equal(first.target_id, replay.target_id);
  assert.equal(await scalar("select count(*)::int from public.admin_audit_log where admin_id=$1 and action='publishAnnouncement'", [OWNER]), 1);
  assert.equal(await scalar('select count(*)::int from admin_ops.commands where command_key=$1', [commandKey]), 1);
});
test('wrong configured owner and disabled policy cannot relax MFA', async () => {
  await enable(OTHER);
  assert.equal(await permitted(), false);
  await denies(() => operation(), /ACTIVE_ADMIN_SESSION_REQUIRED/);
  await rows('update admin_ops.single_owner_qa_policy set owner_id=$1,enabled=false', [OWNER]);
  assert.equal(await permitted(), false);
});
test('another active staff member retires the policy until explicitly reconfigured', async () => {
  await enable();
  await rows("insert into public.admin_users(user_id,role) values($1,'support_agent')", [OTHER]);
  assert.equal(await permitted(), false);
  assert.equal(await scalar('select enabled from admin_ops.single_owner_qa_policy'), false);
  assert.equal(await scalar("select count(*)::int from public.admin_audit_log where action='singleOwnerModeRetired'"), 1);
  await rows('update public.admin_users set active=false where user_id=$1', [OTHER]);
  assert.equal(await permitted(), false);
  await denies(() => operation(), /ACTIVE_ADMIN_SESSION_REQUIRED/);
});
test('inactive extra staff does not block owner mode, but reactivation retires it', async () => {
  await rows("insert into public.admin_users(user_id,role,active) values($1,'support_agent',false)", [OTHER]);
  await enable();
  assert.equal(await permitted(), true);
  await rows('update public.admin_users set active=true where user_id=$1', [OTHER]);
  assert.equal(await permitted(), false);
});
test('ordinary role retains its own permissions and cannot become an MFA-exempt owner', async () => {
  await enable();
  await rows("update public.admin_users set role='support_agent' where user_id=$1", [OWNER]);
  assert.equal(await permitted(), false);
  assert.equal(await scalar('select enabled from admin_ops.single_owner_qa_policy'), false);
  await rows("update auth.sessions set aal='aal2' where id=$1", [SESSION]);
  assert.equal(await operation('support'), 'support_agent');
  await denies(() => operation('system'), /ADMIN_PERMISSION_DENIED/);
  // A manually misconfigured policy cannot grant the ordinary role owner access.
  await rows('update admin_ops.single_owner_qa_policy set enabled=true');
  assert.equal(await permitted(), false);
  await denies(() => finance(), /ACTIVE_FINANCE_SESSION_REQUIRED/);
});
test('owner mode cannot bypass native-session ownership, expiry, revocation or account restrictions', async () => {
  await enable();
  assert.equal(await permitted(OWNER, OTHER_SESSION), false);
  await denies(() => operation('system', OWNER, OTHER_SESSION), /ACTIVE_ADMIN_SESSION_REQUIRED/);
  await rows("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [SESSION]);
  assert.equal(await permitted(), false);
  await denies(() => finance(), /ACTIVE_FINANCE_SESSION_REQUIRED/);
  await rows('update auth.sessions set not_after=null where id=$1', [SESSION]);
  await rows("update auth.users set banned_until=now()+interval '1 hour' where id=$1", [OWNER]);
  assert.equal(await permitted(), false);
  await rows('update auth.users set banned_until=null,deleted_at=now() where id=$1', [OWNER]);
  assert.equal(await permitted(), false);
  await rows('update auth.users set deleted_at=null where id=$1', [OWNER]);
  await rows('delete from auth.sessions where id=$1', [SESSION]);
  assert.equal(await permitted(), false);
  await denies(() => operation(), /ACTIVE_ADMIN_SESSION_REQUIRED/);
});
test('deactivating the configured owner permanently retires the exception', async () => {
  await enable();
  await rows('update public.admin_users set active=false where user_id=$1', [OWNER]);
  assert.equal(await permitted(), false);
  await rows('update public.admin_users set active=true where user_id=$1', [OWNER]);
  assert.equal(await permitted(), false);
});
test('policy is hidden and immutable to clients and the server service role', async () => {
  await enable();
  for (const role of ['anon', 'authenticated', 'service_role']) {
    // Savepoints let denied statements roll back without ending this test transaction.
    for (const sql of ['select * from admin_ops.single_owner_qa_policy', 'update admin_ops.single_owner_qa_policy set enabled=false']) {
      await db.exec('savepoint denied');
      await db.exec('set local role ' + role);
      await assert.rejects(db.exec(sql), /permission denied/);
      await db.exec('rollback to savepoint denied');
    }
    if (role !== 'service_role') {
      await db.exec('savepoint denied');
      await db.exec('set local role ' + role);
      await assert.rejects(permitted(), /permission denied/);
      await db.exec('rollback to savepoint denied');
    }
  }
  await db.exec('set local role service_role');
  assert.equal(await permitted(), true);
});
