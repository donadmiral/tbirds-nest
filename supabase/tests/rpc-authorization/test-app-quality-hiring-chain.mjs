import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions, loadLiveSchema } from './live-schema-fixture.mjs';

// Validate the missing applicant contract on exactly the installed production
// chain. No provider, production row, or live notification is touched here.
const root = new URL('../../../', import.meta.url);
const db = new PGlite({ extensions });
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await query(sql, args))[0];
let phase = 'load baseline';
const as = async (userId, sql, args = [], role = 'authenticated') => {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",
      [userId || '', role, JSON.stringify({ sub: userId, role, aal: 'aal1' })]);
    const rows = await query(sql, args); await db.exec('commit'); return rows;
  } catch (error) { await db.exec('rollback'); throw error; }
};
try {
  await loadLiveSchema(db);
  await db.exec("alter table auth.users add column if not exists created_at timestamptz default now(); alter table storage.objects add column if not exists version text; alter table storage.objects add column if not exists user_metadata jsonb; grant usage on schema auth to authenticated; insert into storage.buckets(id,name,public) values('chat-media','chat-media',true),('chat-files','chat-files',true),('post-media','post-media',true),('story-media','story-media',true),('media','media',true),('avatars','avatars',true),('market-media','market-media',true);");
  for (const manifestPath of ['supabase/ops/production-rollout-20261029.json', 'supabase/ops/parity-rollout-20261029.json']) {
    const manifest = JSON.parse(await readFile(new URL(manifestPath, root), 'utf8'));
    for (const unit of manifest.units) {
      phase = unit.name;
      const sources = [];
      for (const file of unit.files) {
        const sql = await readFile(new URL(file.path, root), 'utf8');
        assert.equal(createHash('sha256').update(sql).digest('hex'), file.sha256);
        sources.push(sql);
      }
      await db.exec(sources.join('\n'));
    }
  }
  const applicant = randomUUID(), employer = randomUUID(), stranger = randomUUID();
  for (const id of [applicant, employer, stranger]) {
    await query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.test`]);
    await query('insert into public.profiles(id,username,full_name,email) values($1,$2,$3,$4) on conflict(id) do nothing',
      [id, `quality_${id.replaceAll('-', '')}`, 'Synthetic applicant', `${id}@example.test`]);
  }
  phase = 'reproduce missing function on deployed baseline';
  await assert.rejects(() => as(applicant, 'select public.my_application_page()'), /does not exist/);
  const communityAcl = await query("select c.relname,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('communities','community_members') order by c.relname");
  phase = 'apply only applicant self service';
  await db.exec(await readFile(new URL('supabase/migrations/20261025073234_applicant_self_service_quality.sql', root), 'utf8'));
  assert.equal((await as(applicant, 'select public.my_application_page() page'))[0].page.applications.length, 0);
  await assert.rejects(() => as(null, 'select public.my_application_page()', [], 'anon'), /permission denied/);
  await assert.rejects(() => as(null, 'select public.my_application_page()'), /Authentication required/);
  phase = 'exercise real application guards';
  const job = (await one("insert into public.jobs(posted_by,title,company,description) values($1,'Quality role','Synthetic employer','Local test only') returning id", [employer])).id;
  const application = (await as(applicant, 'insert into public.job_applications(job_id,applicant_id) values($1,$2) returning *', [job, applicant]))[0];
  assert.equal((await as(applicant, 'select public.my_application_page() page'))[0].page.applications[0].id, application.id);
  assert.equal((await as(stranger, 'select public.my_application_page() page'))[0].page.applications.length, 0);
  await assert.rejects(() => as(stranger, 'select public.withdraw_job_application($1,$2,$3)', [application.id, application.status, application.updated_at]), /Not your application/);
  await assert.rejects(() => as(employer, 'select public.withdraw_job_application($1,$2,$3)', [application.id, application.status, application.updated_at]), /Not your application/);
  await assert.rejects(() => as(applicant, 'select public.withdraw_job_application($1,$2,$3)', [application.id, 'interview', application.updated_at]), /Application changed/);
  const withdrawn = (await as(applicant, 'select public.withdraw_job_application($1,$2,$3) app', [application.id, application.status, application.updated_at]))[0].app;
  assert.equal(withdrawn.status, 'withdrawn');
  const retry = (await as(applicant, 'select public.withdraw_job_application($1,$2,$3) app', [application.id, application.status, application.updated_at]))[0].app;
  assert.equal(retry.updated_at, withdrawn.updated_at);
  assert.equal((await one('select count(*)::int n from public.job_application_events where application_id=$1', [application.id])).n, 1);
  assert.equal((await one("select count(*)::int n from public.notifications where data->>'application_id'=$1 and data->>'status'='withdrawn'", [application.id])).n, 1);
  await assert.rejects(() => as(applicant, 'delete from public.job_applications where id=$1', [application.id]), /permission denied/);
  await assert.rejects(() => as(applicant, "update public.job_applications set status='hired' where id=$1", [application.id]), /cannot be reopened|not permitted|Cannot/);
  assert.deepEqual(await query("select c.relname,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('communities','community_members') order by c.relname"), communityAcl);
  phase = 'community selector uses existing authenticated API';
  assert.ok(Array.isArray(await as(applicant, 'select * from public.get_communities_page(null,100,0,now())')));
  await assert.rejects(() => as(applicant, 'select community_id from public.community_members where user_id=auth.uid()'), /permission denied/);
  phase = 'redacted diagnostic migration on current production chain';
  await db.exec(await readFile(new URL('supabase/migrations/20261023185734_redacted_client_diagnostics.sql', root), 'utf8'));
  const diagnostic = { category: 'TypeError', source: 'render', platform: 'ios', appVersion: '1.1.0', fatal: true, message: 'must-not-be-stored', stack: 'must-not-be-stored', user_id: stranger, token: 'must-not-be-stored' };
  await assert.rejects(() => as(null, 'select public.report_client_error($1)', [diagnostic], 'anon'), /permission denied/);
  await assert.rejects(() => as(null, 'select public.report_client_error($1)', [diagnostic]), /Authentication required/);
  assert.equal((await as(applicant, 'select public.report_client_error($1) accepted', [diagnostic]))[0].accepted, true);
  const stored = await one('select user_id,message,stack,context,platform,app_version from public.client_errors where user_id=$1', [applicant]);
  assert.equal(stored.user_id, applicant); assert.equal(stored.message, 'TypeError'); assert.equal(stored.stack, null); assert.equal(stored.platform, 'ios'); assert.equal(stored.app_version, '1.1.0');
  assert.deepEqual(stored.context, { version: 1, source: 'render', fatal: true });
  assert.ok(!JSON.stringify(stored).includes('must-not-be-stored'));
  assert.equal((await as(applicant, 'select public.report_client_error($1) accepted', [diagnostic]))[0].accepted, false, 'same report deduplicates');
  assert.equal((await as(applicant, 'select public.report_client_error($1) accepted', [{ message: 'x'.repeat(2200) }]))[0].accepted, false);
  for (const role of ['anon','authenticated']) {
    await assert.rejects(() => as(applicant, 'select * from public.client_errors', [], role), /permission denied/);
    await assert.rejects(() => as(applicant, "insert into public.client_errors(message) values('raw')", [], role), /permission denied/);
  }
  for (const category of ['Error','RangeError','ReferenceError','SyntaxError','URIError','EvalError','AbortError','TimeoutError','NetworkError']) {
    assert.equal((await as(applicant, 'select public.report_client_error($1) accepted', [{ ...diagnostic, category }]))[0].accepted, true);
  }
  assert.equal((await as(applicant, 'select public.report_client_error($1) accepted', [{ ...diagnostic, category: 'StorageError' }]))[0].accepted, false, 'server budget limits account to ten reports');
  assert.equal((await as(stranger, 'select public.report_client_error($1) accepted', [diagnostic]))[0].accepted, true, 'budgets are account-scoped');
  console.log(JSON.stringify({ success: true, candidate: '20261023185734_redacted_client_diagnostics', checks: ['production chain compiles', 'anonymous denied', 'signed-out denied', 'identity derived from auth', 'raw message stack and arbitrary fields discarded', 'accepted fields preserved', 'duplicate report suppressed', 'oversized report rejected', 'direct reads and writes denied', 'ten per ten-minute server budget', 'account-scoped budget'] }));
  phase = 'comment author highlights on deployed baseline';
  await db.exec(await readFile(new URL('supabase/migrations/20261029190200_comment_author_highlights.sql', root), 'utf8'));
  const post = (await one("insert into public.posts(user_id,content,audience) values($1,'Pin test','everyone') returning id", [employer])).id;
  const comment = async (body, parent = null) => (await as(applicant, 'insert into public.post_comments(post_id,user_id,body,parent_comment_id) values($1,$2,$3,$4) returning id', [post, applicant, body, parent]))[0].id;
  const first = await comment('First'), second = await comment('Second'), reply = await comment('Reply', first), hidden = await comment('Hidden'), spam = await comment('Spam');
  await query('update public.post_comments set hidden_at=now() where id=$1', [hidden]);
  await query('update public.post_comments set is_spam=true where id=$1', [spam]);
  const pin = async (user, id, value = true) => (await as(user, 'select public.set_comment_pinned($1,$2) result', [id,value]))[0].result.pinned_comment_id;
  await assert.rejects(() => as(null, 'select public.set_comment_pinned($1,true)', [first], 'anon'), /permission denied/);
  await assert.rejects(() => pin(null, first), /Not authenticated/);
  await assert.rejects(() => pin(applicant, first), /Only the post author/);
  await assert.rejects(() => pin(stranger, first), /Only the post author/);
  assert.equal(await pin(employer, first), first);
  assert.equal((await as(stranger, 'select comment_id from public.post_comment_pins where post_id=$1', [post]))[0].comment_id, first);
  assert.equal(await pin(employer, second), second);
  assert.equal((await one('select count(*)::int n from public.post_comment_pins where post_id=$1', [post])).n, 1);
  assert.equal(await pin(employer, first, false), second, 'A stale unpin must not remove the new pin');
  assert.equal(await pin(employer, second, false), null);
  await assert.rejects(() => pin(employer, reply), /top-level/);
  await assert.rejects(() => pin(employer, hidden), /Unhide and approve/);
  await assert.rejects(() => pin(employer, spam), /Unhide and approve/);
  await assert.rejects(() => as(employer, 'insert into public.post_comment_pins(post_id,comment_id,pinned_by) values($1,$2,$3)', [post,first,employer]), /permission denied/);
  await assert.rejects(() => as(employer, 'delete from public.post_comment_pins where post_id=$1', [post]), /permission denied/);
  await pin(employer, first);
  await query('update public.post_comments set hidden_at=now() where id=$1', [first]);
  assert.equal((await as(stranger, 'select * from public.post_comment_pins where post_id=$1', [post])).length, 0);
  assert.equal((await as(employer, 'select * from public.post_comment_pins where post_id=$1', [post])).length, 1);
  await query('update public.post_comments set hidden_at=null where id=$1', [first]);
  await as(employer, 'insert into public.comment_reactions(comment_id,user_id,value) values($1,$2,1)', [first,employer]);
  assert.equal((await as(stranger, 'select comment_id from public.comment_reactions where user_id=$1 and comment_id=$2 and value=1', [employer,first]))[0].comment_id, first);
  await as(applicant, 'delete from public.post_comments where id=$1', [first]);
  assert.equal((await one('select count(*)::int n from public.post_comment_pins where post_id=$1', [post])).n, 0);
  await pin(employer, second);
  const staff = randomUUID();
  await query('insert into auth.users(id,email) values($1,$2)', [staff, `${staff}@example.test`]);
  await query('insert into public.profiles(id,username,full_name,email) values($1,$2,$3,$4) on conflict(id) do nothing', [staff, `staff_${staff.replaceAll('-', '')}`, 'Synthetic staff', `${staff}@example.test`]);
  await query('update public.post_comment_pins set pinned_by=$1 where post_id=$2', [staff,post]);
  await query('delete from public.profiles where id=$1', [staff]);
  assert.equal((await one('select pinned_by from public.post_comment_pins where post_id=$1', [post])).pinned_by, null);
  await as(employer, 'delete from public.posts where id=$1', [post]);
  assert.equal((await one('select count(*)::int n from public.post_comment_pins where post_id=$1', [post])).n, 0);
  const attribution = await one("select a.attnotnull, c.confdeltype from pg_attribute a join pg_constraint c on c.conrelid=a.attrelid and a.attnum=any(c.conkey) where a.attrelid='public.post_comment_pins'::regclass and a.attname='pinned_by' and c.contype='f'");
  assert.equal(attribution.attnotnull, false); assert.equal(attribution.confdeltype, 'n');
  console.log(JSON.stringify({ success: true, candidate: '20261029190200_comment_author_highlights', checks: ['anonymous denied', 'signed-out denied', 'commenter and stranger denied', 'post author pins', 'visible pin readable', 'replacement is singular', 'stale unpin preserves newer pin', 'unpin succeeds', 'reply hidden and spam denied', 'direct writes denied', 'hidden pin not disclosed', 'author reaction readable', 'comment cascade cleanup', 'post cascade cleanup', 'pinner deletion cannot block account removal'] }));
  console.log(JSON.stringify({ success: true, baselineUnits: 25, candidate: '20261025073234_applicant_self_service_quality', checks: ['missing RPC reproduced', 'migration compiles on current production chain', 'authenticated applicant page', 'anonymous denied', 'signed-out denied', 'stranger isolation', 'employer cannot withdraw', 'concurrency conflict', 'withdrawal succeeds through existing guards', 'idempotent retry', 'one audit event', 'one notification receipt', 'direct delete denied', 'closed state protected', 'community ACLs unchanged', 'community directory RPC available'] }));
} catch (error) { console.error('FAILED PHASE:', phase); throw error; }
finally { await db.close(); }
