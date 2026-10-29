import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions, loadLiveSchema } from './live-schema-fixture.mjs';

const db = new PGlite({ extensions });
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const actor = randomUUID(), member = randomUUID(), other = randomUUID(), session = randomUUID();
const evidence = { statement: 'I represent this public profile and its published work.', links: ['https://example.com/profile'] };
const command = async (op, payload, key = randomUUID()) => q('select public.triniti_platinum_admin_command($1,$2,$3,$4,$5)', [actor, session, key, op, payload]);
const reject = (fn, message) => assert.rejects(fn, error => error.message.includes(message));
let cases = 0;
const test = async (name, fn) => { await fn(); cases++; console.log('PASS', name); };
const asMember = async fn => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${member}',false); select set_config('request.jwt.claim.role','authenticated',false);`);
  try { return await fn(); }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false);"); }
};
try {
  await loadLiveSchema(db);
  await db.exec("select set_config('request.jwt.claim.role','service_role',false);");
  const directory = new URL('../../migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => /^202610(22|23)\d+.*\.sql$/.test(name)).sort()) {
    await db.exec(await readFile(new URL(name, directory), 'utf8'));
  }
  await db.exec(await readFile(new URL('20261025073232_verification_integrity.sql', directory), 'utf8'));
  for (const [id, name] of [[actor,'reviewer'],[member,'applicant'],[other,'other']]) {
    await q('insert into auth.users(id,email) values($1,$2)', [id,`${name}@example.test`]);
    await q('insert into public.profiles(id,username,full_name,email) values($1,$2,$2,$3) on conflict(id) do update set username=excluded.username,full_name=excluded.full_name', [id,name,`${name}@example.test`]);
  }
  await q("insert into public.admin_users(user_id,role) values($1,'super_admin')", [actor]);
  await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal2')", [session,actor]);
  // Managed Supabase grants are not included in the schema snapshot.
  await db.exec('grant usage on schema public,auth to authenticated; grant select,update,insert on public.profiles to authenticated; grant execute on function auth.uid() to authenticated;');

  await test('profile flags and tier cannot be self-awarded or inserted', async () => {
    await asMember(async () => {
      await reject(() => q('update public.profiles set is_verified=true where id=$1', [member]), 'VERIFICATION_STAFF_REVIEW_REQUIRED');
      await reject(() => q("update public.profiles set verified_tier='official' where id=$1", [member]), 'VERIFICATION_STAFF_REVIEW_REQUIRED');
      await reject(() => q("insert into public.profiles(id,username,is_verified) values($1,'forged',true)", [randomUUID()]), 'VERIFICATION_STAFF_REVIEW_REQUIRED');
      await q("update public.profiles set bio='Normal profile edits still work.' where id=$1", [member]);
    });
  });
  await test('security-definer helper cannot turn a client into a verification reviewer', async () => {
    await db.exec(`create function public.test_forge_verification(p_id uuid) returns void language sql security definer set search_path='' as $$update public.profiles set is_verified=true where id=p_id$$; grant execute on function public.test_forge_verification(uuid) to authenticated;`);
    await asMember(() => reject(() => q('select public.test_forge_verification($1)', [member]), 'VERIFICATION_STAFF_REVIEW_REQUIRED'));
  });
  await test('applicants cannot forge decision fields or supply invalid evidence', async () => {
    await asMember(async () => {
      for (const [column,value] of [['status','approved'],['reviewer_id',actor],['decision_reason','I approved myself'],['decided_at','2026-10-25']]) {
        await reject(() => q(`insert into public.verification_applications(applicant_id,tier,category,evidence,${column}) values($1,'public_figure','Educator',$2,$3)`, [member,evidence,value]), 'VERIFICATION_STAFF_REVIEW_REQUIRED');
      }
      for (const links of [[],['javascript:alert(1)'],['https://user:password@example.com'],['https://example.com/a b'],[{}]]) {
        await reject(() => q("insert into public.verification_applications(applicant_id,tier,category,evidence) values($1,'public_figure','Educator',$2)", [member,{...evidence,links}]), 'VERIFICATION_EVIDENCE');
      }
      await reject(() => q("insert into public.verification_applications(applicant_id,tier,category,evidence) values($1,'business','Business',$2)", [member,evidence]), 'VERIFICATION_ACCOUNT_TYPE_MISMATCH');
    });
  });
  let id;
  await test('one pending application per account; applicant can read only their own evidence', async () => {
    id = await asMember(async () => (await q("insert into public.verification_applications(applicant_id,tier,category,evidence) values($1,'public_figure','Educator',$2) returning id", [member,evidence]))[0].id);
    await q("insert into public.verification_applications(applicant_id,tier,category,evidence) values($1,'public_figure','Educator',$2)", [other,evidence]);
    await asMember(async () => {
      await reject(() => q("insert into public.verification_applications(applicant_id,tier,category,evidence) values($1,'public_figure','Educator',$2)", [member,evidence]), 'VERIFICATION_ALREADY_PENDING');
      assert.equal((await q('select * from public.verification_applications')).length, 1);
      await reject(() => q("update public.verification_applications set status='approved' where id=$1", [id]), 'permission denied');
    });
  });
  await test('invalid approval rolls back profile grant, decision and audit together', async () => {
    await reject(() => command('approveApplication', {id}), 'VERIFICATION_REVIEW_BASIS_REQUIRED');
    assert.equal((await q('select is_verified from public.profiles where id=$1', [member]))[0].is_verified, false);
    assert.equal((await q('select status from public.verification_applications where id=$1', [id]))[0].status, 'submitted');
    assert.equal((await q("select id from public.admin_audit_log where action='approveApplication' and target_id=$1", [id])).length, 0);
  });
  await test('reviewed approval is atomic, audited and idempotent', async () => {
    const key = randomUUID(), payload = {id,reason:'Confirmed profile control and published institutional record independently.'};
    await command('approveApplication', payload, key);
    await command('approveApplication', payload, key);
    assert.equal((await q('select is_verified from public.profiles where id=$1', [member]))[0].is_verified, true);
    assert.equal((await q('select status from public.verification_applications where id=$1', [id]))[0].status, 'approved');
    assert.equal((await q("select id from public.admin_audit_log where action='approveApplication' and target_id=$1", [id])).length, 1);
    await asMember(() => reject(() => q("update public.profiles set username='somebody_else' where id=$1", [member]), 'Verified identity changes require support review.'));
  });
  await test('revocation clears badge and updates application in the same transaction', async () => {
    await command('revokeVerification', {id:member,reason:'Identity assertion no longer supported by independent evidence.'});
    const profile = (await q('select is_verified,verified_tier,verified_category from public.profiles where id=$1',[member]))[0];
    assert.deepEqual(profile, {is_verified:false,verified_tier:null,verified_category:null});
    const application = (await q('select status,revoked_at,reviewer_id from public.verification_applications where id=$1',[id]))[0];
    assert.equal(application.status, 'revoked'); assert.ok(application.revoked_at); assert.equal(application.reviewer_id, actor);
    await asMember(() => q("insert into public.verification_applications(applicant_id,tier,category,evidence) values($1,'public_figure','Educator',$2)", [member,evidence]));
  });
  await test('impersonation reports enter the queue privately and cannot self-resolve', async () => {
    await asMember(async () => {
      await reject(() => q("insert into public.user_reports(reporter_id,reported_id,reason,status) values($1,$2,'impersonation','closed')",[member,other]), 'row-level security');
      await q("insert into public.user_reports(reporter_id,reported_id,reason,details) values($1,$2,'impersonation','Pretending to be an official account.')", [member,other]);
      assert.equal((await q('select status from public.user_reports'))[0].status,'open');
    });
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`);
    try { assert.equal((await q('select * from public.user_reports')).length,0); }
    finally { await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false);"); }
  });
  console.log(`${cases} verification integrity database scenarios passed`);
} catch (error) { console.error(error.message, error.where || '', error.query || ''); process.exitCode = 1; } finally { await db.close(); }
