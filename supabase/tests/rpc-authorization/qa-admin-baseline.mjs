import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const root = new URL('../../../', import.meta.url);
const fixtureId = randomUUID(), sessionId = randomUUID(), key = randomUUID();
export const qaBaseline = JSON.parse(await readFile(new URL('docs/quality/QA_ADMIN_BASELINE_20261029.json', root), 'utf8')).catalog;
export const qaPreflightQuery = await readFile(new URL('supabase/ops/check-qa-admin-completion-preflight.sql', root), 'utf8');
const value = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0];
const qualified = name => name.startsWith('admin_ops.') ? name : `public.${name}`;

// Install only catalog definitions obtained through the read-only QA query.
// No hosted rows, credentials, reservations, or account data enter this fixture.
export async function restoreQaFunctionBaseline(db) {
  for (const fn of qaBaseline.functions) {
    await db.exec(fn.definition);
    const signature = qualified(fn.signature);
    await db.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role`);
    if (/(?:^\{|,)=X\/postgres(?:,|})/.test(fn.acl))
      await db.exec(`grant execute on function ${signature} to public`);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      if (fn.acl.includes(`${role}=X/postgres`)) await db.exec(`grant execute on function ${signature} to ${role}`);
    }
  }
}

export async function installQaAdminBaseline(db) {
  const source = await readFile(new URL('supabase/migrations/20261025073213_single_owner_qa_access.sql', root), 'utf8');
  const boundary = source.indexOf('create or replace function admin_ops.require_session');
  assert.ok(boundary > 0);
  // Keep the exact current session helper. Later QA migrations already replaced
  // the historical session/finance definitions below this boundary.
  await db.exec(source.slice(0, boundary) + '\ncommit;');
  // QA's older triage foreign key retains its original NO ACTION behavior.
  // Reconstruct it exactly; the forward delta must not rewrite this policy.
  await db.exec('alter table admin_ops.support_triage drop constraint support_triage_assigned_to_fkey; alter table admin_ops.support_triage add constraint support_triage_assigned_to_fkey foreign key(assigned_to) references public.admin_users(user_id)');
  await restoreQaFunctionBaseline(db);
  await db.query('insert into auth.users(id,email) values($1,$2)', [fixtureId, 'qa-preservation@example.test']);
  await db.query("insert into public.profiles(id,username,full_name,email) values($1,'qa_preservation','Synthetic QA preservation','qa-preservation@example.test') on conflict(id) do update set username=excluded.username", [fixtureId]);
  await db.query("insert into public.admin_users(user_id,role) values($1,'super_admin')", [fixtureId]);
  await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')", [sessionId, fixtureId]);
  await db.query("insert into admin_ops.single_owner_qa_policy(owner_id,enabled,reason) values($1,true,'Synthetic preservation fixture')", [fixtureId]);
  await db.query("insert into admin_ops.commands(command_key,actor_id,operation,payload,result) values($1,$2,'syntheticPreservedReceipt','{}','{\"success\":true}')", [key, fixtureId]);
  await db.query("insert into storage.objects(bucket_id,name,owner,owner_id,version) select 'post-media','synthetic-qa/'||n::text,$1::uuid,($1::uuid)::text,'fixture-version' from generate_series(1,15) n", [fixtureId]);
  const actual = await value(db, qaPreflightQuery);
  assert.deepEqual(actual, qaBaseline, 'The complete inspected QA admin catalog and 1/1/1/15 synthetic counts must match before the forward upgrade');
  return actual;
}

export async function captureQaPreservation(db) {
  const rows = {};
  for (const table of ['commands', 'deletion_requests', 'provisions', 'removals', 'single_owner_qa_policy', 'support_triage'])
    rows[table] = (await db.query(`select to_jsonb(t) row from admin_ops.${table} t order by to_jsonb(t)::text`)).rows;
  rows.objects = (await db.query('select to_jsonb(t) row from storage.objects t order by id')).rows;
  rows.privateFunctions = (await db.query("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p where pronamespace=to_regnamespace('admin_ops') and proname not in ('guard_removed_content','validate_verification_evidence') order by 1")).rows;
  return rows;
}

// Remove only the locally generated preservation fixtures after comparing
// before/after state, so the existing 34 behavior cases keep their actor model.
export async function cleanQaPreservationFixture(db) {
  await db.query('delete from admin_ops.single_owner_qa_policy where owner_id=$1', [fixtureId]);
  await db.query('delete from admin_ops.commands where command_key=$1', [key]);
  await db.query('delete from storage.objects where owner=$1', [fixtureId]);
  await db.query('delete from public.admin_users where user_id=$1', [fixtureId]);
  await db.query('delete from auth.sessions where id=$1', [sessionId]);
  await db.query('delete from public.profiles where id=$1', [fixtureId]);
  await db.query('delete from auth.users where id=$1', [fixtureId]);
}
