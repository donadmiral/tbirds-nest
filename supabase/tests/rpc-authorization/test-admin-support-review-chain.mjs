import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions, loadLiveSchema } from './live-schema-fixture.mjs';
import { captureMusicState } from './non-music-release-assertions.mjs';

const root = new URL('../../../', import.meta.url);
const candidatePath = 'supabase/migrations/20261029213000_admin_support_review_contracts.sql';
const signatures = [
  'public.admin_support_triage_read(uuid[])',
  'public.admin_support_triage_update(uuid,uuid,uuid,uuid,integer,uuid,text,text,boolean,text)',
  'public.admin_seller_review_reports(uuid,uuid,timestamp with time zone,uuid,text)',
  'public.moderate_seller_review(uuid,uuid,uuid,uuid,text,text,integer)',
];
const publicNames = ['admin_support_triage_read', 'admin_support_triage_update', 'admin_seller_review_reports', 'moderate_seller_review'];
const db = new PGlite({ extensions });
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const value = async (sql, args = []) => Object.values(await one(sql, args) || {})[0];
const actors = Object.fromEntries(['owner', 'support', 'market', 'auditor', 'buyer', 'seller', 'reporter'].map(name => [name, randomUUID()]));
const sessions = Object.fromEntries(Object.keys(actors).map(name => [name, randomUUID()]));
let ticket, listing, order, review, report, beforeState, afterState, candidate, appliedUnits = 0;

// Each request runs through real PostgreSQL role grants and the real session
// validator. Savepoints recover expected denials without losing the outer case.
async function as(role, user, sql, args = [], claims = {}) {
  assert.ok(['service_role', 'authenticated', 'anon'].includes(role));
  await db.exec('savepoint request');
  try {
    await db.exec(`set local role ${role}`);
    await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",
      [user || '', role, JSON.stringify({ sub: user, role, aal: 'aal1', ...claims })]);
    const result = await value(sql, args);
    await db.exec('reset role');
    await q("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
    await db.exec('release savepoint request');
    return result;
  } catch (error) {
    await db.exec('rollback to savepoint request; release savepoint request');
    throw error;
  }
}
const staff = (sql, args = []) => as('service_role', null, sql, args);
const triageRead = (ids = [ticket]) => staff('select public.admin_support_triage_read($1)', [ids]);
const triage = (overrides = {}) => {
  const p = { actor: actors.support, session: sessions.support, key: randomUUID(), ticket, version: 0,
    assigned: actors.support, priority: 'urgent', queue: 'safety', escalated: true, reason: 'Reviewed support request', ...overrides };
  return staff('select public.admin_support_triage_update($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [p.actor, p.session, p.key, p.ticket, p.version, p.assigned, p.priority, p.queue, p.escalated, p.reason]);
};
const reports = (overrides = {}) => {
  const p = { actor: actors.market, session: sessions.market, beforeAt: null, beforeId: null, status: 'open', ...overrides };
  return staff('select public.admin_seller_review_reports($1,$2,$3,$4,$5)', [p.actor, p.session, p.beforeAt, p.beforeId, p.status]);
};
const moderate = (overrides = {}) => {
  const p = { actor: actors.market, session: sessions.market, key: randomUUID(), report, action: 'hide', reason: 'Reviewed report evidence', version: 1, ...overrides };
  return staff('select public.moderate_seller_review($1,$2,$3,$4,$5,$6,$7)', [p.actor, p.session, p.key, p.report, p.action, p.reason, p.version]);
};
const sellerPage = () => as('authenticated', actors.reporter, 'select public.seller_review_page($1)', [actors.seller]);

async function protectedState() {
  return {
    music: await captureMusicState(db),
    functions: await q(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,
      pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','auth','storage','creator_finance','marketplace_ops') and p.prokind='f'
      and not(p.proname=any($1)) order by n.nspname,p.proname,args`, [publicNames]),
    relations: await q(`select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relacl::text acl
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','storage','creator_finance','marketplace_ops')
      and c.relname<>'support_messages_latest_idx' order by n.nspname,c.relname`),
    policies: await q("select * from pg_policies where schemaname<>'admin_ops' order by schemaname,tablename,policyname"),
    buckets: await q('select to_jsonb(b) row from storage.buckets b order by id'),
    finance: await q('select to_jsonb(p) row from creator_finance.program p'),
    providers: await q('select to_jsonb(p) row from creator_finance.providers p'),
    roles: await q('select rolname,rolconfig,rolsuper,rolbypassrls from pg_roles order by rolname'),
    staff: await q('select to_jsonb(a) row from public.admin_users a order by user_id'),
    auth: await q('select to_jsonb(u) row from auth.users u order by id'),
  };
}

before(async () => {
  await loadLiveSchema(db);
  await db.exec("alter table auth.users add column if not exists created_at timestamptz default now(); alter table storage.objects add column if not exists version text; alter table storage.objects add column if not exists user_metadata jsonb; grant usage on schema auth to authenticated; insert into storage.buckets(id,name,public) values('chat-media','chat-media',true),('chat-files','chat-files',true),('post-media','post-media',true),('story-media','story-media',true),('media','media',true),('avatars','avatars',true),('market-media','market-media',true);");
  for (const manifestPath of ['supabase/ops/production-rollout-20261029.json', 'supabase/ops/parity-rollout-20261029.json']) {
    const manifest = JSON.parse(await readFile(new URL(manifestPath, root), 'utf8'));
    for (const unit of manifest.units) {
      const sources = [];
      for (const file of unit.files) {
        const sql = await readFile(new URL(file.path, root), 'utf8');
        assert.equal(createHash('sha256').update(sql).digest('hex'), file.sha256, file.path);
        sources.push(sql);
      }
      await db.exec(sources.join('\n'));
      appliedUnits++;
    }
  }
  assert.equal(appliedUnits, 25);
  for (const name of ['20261025073234_applicant_self_service_quality', '20261029190200_comment_author_highlights', '20261023185734_redacted_client_diagnostics']) {
    await db.exec(await readFile(new URL(`supabase/migrations/${name}.sql`, root), 'utf8'));
  }
  assert.equal(await value("select to_regnamespace('admin_ops')::text"), null);
  for (const signature of signatures) assert.equal(await value('select to_regprocedure($1)::text', [signature]), null);
  const livePreflight = JSON.parse(await readFile(new URL('docs/quality/ADMIN_SUPPORT_REVIEW_PREFLIGHT_20261029.json', root),'utf8'));
  const localPreflight = await value(await readFile(new URL('supabase/ops/check-admin-support-review-preflight.sql', root),'utf8'));
  assert.deepEqual(localPreflight, livePreflight.preflight, 'Candidate prerequisites and native session definition must match the fresh production catalog read');
  beforeState = await protectedState();
  candidate = await readFile(new URL(candidatePath, root), 'utf8');
  await db.exec(candidate);
  afterState = await protectedState();
  if (process.env.ADMIN_CONTRACT_CATALOG_OUTPUT) {
    await writeFile(process.env.ADMIN_CONTRACT_CATALOG_OUTPUT, JSON.stringify({
      candidate: candidatePath, sha256: createHash('sha256').update(candidate).digest('hex'),
      baselineUnits: appliedUnits, appliedQualityFixes: 3, localPreflightMatchesProduction: true,
      functions: await q(`select n.nspname schema,p.proname name,p.oid::regprocedure::text signature,
        md5(pg_get_functiondef(p.oid)) definition_md5,p.prosecdef security_definer,p.proconfig config,p.proacl::text acl
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where (n.nspname='public' and p.proname=any($1)) or (n.nspname='admin_ops' and p.proname='require_session')
        order by n.nspname,p.proname`, [publicNames]),
    }, null, 2)+'\n');
  }
  await db.exec("select set_config('request.jwt.claim.role','service_role',false); begin");
  for (const [name, id] of Object.entries(actors)) {
    await q('insert into auth.users(id,email) values($1,$2)', [id, `${name}@example.test`]);
    await q('insert into public.profiles(id,username,full_name,email) values($1,$2,$3,$4) on conflict(id) do update set username=excluded.username,full_name=excluded.full_name,email=excluded.email',
      [id, `contract_${name}`, `Contract ${name}`, `${name}@example.test`]);
    await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')", [sessions[name], id]);
  }
  for (const [name, role] of [['owner','super_admin'], ['support','support_agent'], ['market','market_reviewer'], ['auditor','auditor_readonly']]) {
    await q('insert into public.admin_users(user_id,role) values($1,$2)', [actors[name], role]);
  }
  ticket = await value("insert into public.support_tickets(user_id,subject,created_at) values($1,'Synthetic request',now()-interval '2 days') returning id", [actors.buyer]);
  listing = await value("insert into public.marketplace_listings(seller_id,title,price,currency,status) values($1,'Synthetic purchase',25,'USD','available') returning id", [actors.seller]);
  order = await value("insert into marketplace_ops.orders(request_key,buyer_id,seller_id,listing_id,title,quantity,unit_minor,delivery_minor,total_minor,currency,fulfilment,status,reservation,completed_at) values($1,$2,$3,$4,'Synthetic purchase',1,2500,0,2500,'USD','pickup','completed','committed',now()) returning id", [randomUUID(), actors.buyer, actors.seller, listing]);
  review = await as('authenticated', actors.buyer, 'select public.submit_seller_review($1,$2,5,$3)', [actors.buyer, order, 'Synthetic purchase review']);
  report = await as('authenticated', actors.reporter, "select public.report_seller_review($1,$2,'other','Please review this rating')", [actors.reporter, review]);
  await db.exec('commit');
});
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback'));
after(async () => db.close());

test('candidate applies over all 25 deployed units plus three narrow fixes and preserves unrelated state', async () => {
  assert.deepEqual(afterState, beforeState);
  const postflight = await value(await readFile(new URL('supabase/ops/check-admin-support-review-postflight.sql', root),'utf8'));
  for (const fn of postflight.functions) {
    assert.equal(fn.exists && fn.security_definer && fn.service_execute,true);
    assert.equal(fn.anon_execute || fn.authenticated_execute,false);
    assert.deepEqual(fn.config,['search_path=""']);
  }
  for (const table of postflight.private_tables) {
    assert.equal(table.exists && table.rls,true);
    assert.equal(table.anon_access || table.authenticated_access || table.service_direct_access,false);
  }
  assert.ok(Object.values(postflight.held_contracts_absent).every(Boolean));
  assert.equal(postflight.assignee_delete_sets_null,true);
  assert.equal(postflight.native_session_check_md5,'ba2e1c694288129ee94d8b6d06746eef');
  assert.equal(postflight.support_commands_available,false);
  assert.deepEqual((await q("select relname from pg_class where relnamespace='admin_ops'::regnamespace and relkind='r' order by relname")).map(row => row.relname), ['commands','support_triage']);
  assert.deepEqual((await q("select proname from pg_proc where pronamespace='admin_ops'::regnamespace order by proname")).map(row => row.proname), ['require_session']);
  for (const name of ['triniti_platinum_admin_command','triniti_admin_provision','triniti_admin_deletion_requests']) {
    assert.equal(await value("select count(*)::int from pg_proc where pronamespace='public'::regnamespace and proname=$1", [name]), 0);
  }
  assert.match(candidate, /begin;[\s\S]*notify pgrst, 'reload schema';\s*commit;\s*$/);
});

test('all four APIs are service-only; app roles cannot forge claims or read/write private receipts', async () => {
  for (const signature of [...signatures, 'admin_ops.require_session(uuid,uuid,text)']) {
    for (const role of ['anon','authenticated']) assert.equal(await value("select has_function_privilege($1,to_regprocedure($2),'EXECUTE')", [role,signature]), false);
    assert.equal(await value("select has_function_privilege('service_role',to_regprocedure($1),'EXECUTE')", [signature]), true);
    assert.equal(await value('select prosecdef from pg_proc where oid=to_regprocedure($1)', [signature]), true);
  }
  for (const role of ['anon','authenticated']) {
    for (const [sql,args] of [
      ['select public.admin_support_triage_read($1)', [[ticket]]],
      ['select public.admin_support_triage_update($1,$2,$3,$4,0,$1,$5,$6,true,$7)', [actors.support,sessions.support,randomUUID(),ticket,'urgent','safety','Reviewed request']],
      ['select public.admin_seller_review_reports($1,$2)', [actors.market,sessions.market]],
      ['select public.moderate_seller_review($1,$2,$3,$4,$5,$6,1)', [actors.market,sessions.market,randomUUID(),report,'hide','Reviewed evidence']],
    ]) await assert.rejects(as(role, actors.owner, sql, args, {role:'service_role',aal:'aal2'}), /permission denied/);
  }
  for (const role of ['anon','authenticated','service_role']) {
    for (const sql of ['select * from admin_ops.commands', 'select * from admin_ops.support_triage',
      "insert into admin_ops.commands(command_key,actor_id,operation,payload) values(gen_random_uuid(),gen_random_uuid(),'forged','{}')",
      "update admin_ops.support_triage set priority='low'", 'delete from admin_ops.commands']) {
      await assert.rejects(as(role, actors.owner, sql), /permission denied/);
    }
  }
});

test('real valid AAL1 and AAL2 native sessions execute authorized triage and review reads', async () => {
  assert.equal(await staff('select public.triniti_admin_session_check($1,$2)', [actors.support,sessions.support]), true);
  for (const [index, aal] of ['aal1','aal2'].entries()) {
    await q('update auth.sessions set aal=$1 where id=any($2)', [aal,[sessions.support,sessions.market]]);
    assert.equal((await triage({version:index})).version, index+1);
    assert.equal((await reports()).rows[0].id, report);
  }
});

test('session spoofing, missing session, invalid AAL, expiry, revocation and account restrictions deny mutation', async () => {
  for (const args of [{actor:null},{session:null},{actor:actors.buyer},{session:sessions.buyer},{session:randomUUID()}]) {
    await assert.rejects(triage(args), /ACTIVE_ADMIN_SESSION_REQUIRED/);
  }
  for (const statement of [
    "update auth.sessions set aal='aal0' where id=$1",
    'update auth.sessions set aal=null where id=$1',
    "update auth.sessions set not_after=now()-interval '1 second' where id=$1",
    'delete from auth.sessions where id=$1',
  ]) {
    await db.exec('savepoint invalid_session');
    await q(statement,[sessions.support]);
    await assert.rejects(triage(), /ACTIVE_ADMIN_SESSION_REQUIRED/);
    await db.exec('rollback to savepoint invalid_session; release savepoint invalid_session');
  }
  for (const statement of [
    'update public.admin_users set active=false where user_id=$1',
    'update auth.users set deleted_at=now() where id=$1',
    "update auth.users set banned_until=now()+interval '1 hour' where id=$1",
  ]) {
    await db.exec('savepoint invalid_account');
    await q(statement,[actors.support]);
    await assert.rejects(triage(), /ACTIVE_ADMIN_SESSION_REQUIRED/);
    await db.exec('rollback to savepoint invalid_account; release savepoint invalid_account');
  }
  assert.equal(await value('select count(*)::int from admin_ops.commands'), 0);
  assert.equal(await value('select count(*)::int from public.admin_audit_log'), 0);
});

test('both permission maps match all current frontend roles and reject unrelated operations', async () => {
  const {default:ts} = await import('../../../admin-web/node_modules/typescript/lib/typescript.js');
  const source = await readFile(new URL('admin-web/lib/permissions.ts', root), 'utf8');
  const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const permissions = await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  for (const role of permissions.STAFF_ROLES) {
    await q('update public.admin_users set role=$1 where user_id=$2',[role,actors.support]);
    for (const permission of ['support','report_listing']) {
      const call = () => staff('select admin_ops.require_session($1,$2,$3)',[actors.support,sessions.support,permission]);
      if (permissions.canPerform(role,permission)) assert.equal(await call(),role);
      else await assert.rejects(call(),/ADMIN_PERMISSION_DENIED/);
    }
  }
  await assert.rejects(staff('select admin_ops.require_session($1,$2,$3)',[actors.owner,sessions.owner,'staff_manage']),/ADMIN_PERMISSION_DENIED/);
  await assert.rejects(triage({actor:actors.market,session:sessions.market}),/ADMIN_PERMISSION_DENIED/);
  await assert.rejects(reports({actor:actors.auditor,session:sessions.auditor}),/ADMIN_PERMISSION_DENIED/);
});

test('triage updates audit once, retry identically, reject changed/stale data and invalid assignees', async () => {
  const key = randomUUID();
  const first = await triage({key});
  assert.equal(first.version,1);
  assert.deepEqual(await triage({key}),first);
  assert.equal(await value("select count(*)::int from public.admin_audit_log where action='supportTriage'"),1);
  await assert.rejects(triage({key,priority:'high'}),/COMMAND_CONFLICT/);
  await assert.rejects(triage(),/TRIAGE_CHANGED/);
  for (const assigned of [actors.auditor,actors.market,actors.buyer,randomUUID()]) await assert.rejects(triage({version:1,assigned}),/INVALID_ASSIGNEE/);
  await q('update public.admin_users set active=false where user_id=$1',[actors.owner]);
  await assert.rejects(triage({version:1,assigned:actors.owner}),/INVALID_ASSIGNEE/);
  await assert.rejects(triage({version:1,priority:'invalid'}),/INVALID_TRIAGE/);
  await assert.rejects(triage({version:1,reason:'x'}),/INVALID_TRIAGE/);
  assert.equal((await triage({version:1,assigned:null})).version,2);
});

test('triage audit failure rolls back assignment and receipt and permits a clean retry', async () => {
  const key = randomUUID();
  await db.exec("create function public.fail_candidate_audit() returns trigger language plpgsql as $$begin raise exception 'AUDIT_UNAVAILABLE'; end$$; create trigger fail_candidate_audit before insert on public.admin_audit_log for each row execute function public.fail_candidate_audit();");
  await assert.rejects(triage({key}),/AUDIT_UNAVAILABLE/);
  assert.equal(await value('select count(*)::int from admin_ops.support_triage'),0);
  assert.equal(await value('select count(*)::int from admin_ops.commands'),0);
  await db.exec('drop trigger fail_candidate_audit on public.admin_audit_log');
  assert.equal((await triage({key})).version,1);
});

test('deleting an assigned staff identity unassigns the case while preserving ticket and triage', async () => {
  await triage({assigned:actors.owner});
  assert.equal((await triageRead())[0].assigned_to,actors.owner);
  await q('delete from auth.users where id=$1',[actors.owner]);
  assert.equal(await value('select count(*)::int from public.admin_users where user_id=$1',[actors.owner]),0);
  assert.equal(await value('select count(*)::int from public.support_tickets where id=$1',[ticket]),1);
  const rows=await triageRead();
  assert.equal(rows.length,1);
  assert.equal(rows[0].assigned_to,null);
  assert.equal(rows[0].assigned_name,null);
  assert.equal(rows[0].priority,'urgent');
  assert.equal(rows[0].version,1);
  assert.equal(await value('select count(*)::int from admin_ops.support_triage where ticket_id=$1',[ticket]),1);
  assert.equal(await value("select confdeltype from pg_constraint where conrelid='admin_ops.support_triage'::regclass and confrelid='public.admin_users'::regclass"),'n');
});

test('triage read is bounded and deadline responds to member/staff messages', async () => {
  assert.equal((await triageRead())[0].support_commands_available,false);
  assert.deepEqual(await triageRead(Array(101).fill(ticket)),[]);
  assert.deepEqual(await triageRead(null),[]);
  await triage();
  let row = (await triageRead())[0];
  assert.equal(row.assigned_name,'Contract support');
  assert.ok(Date.parse(row.response_due_at)<Date.now());
  await q("insert into public.support_messages(ticket_id,sender,body) values($1,'ops','Synthetic reply')",[ticket]);
  assert.equal((await triageRead())[0].response_due_at,null);
  await q("insert into public.support_messages(ticket_id,sender,body,created_at) values($1,'member','Synthetic reply',now()+interval '1 second')",[ticket]);
  assert.ok(Date.parse((await triageRead())[0].response_due_at)>Date.now());
  await q("update public.support_tickets set status='solved' where id=$1",[ticket]);
  assert.equal((await triageRead())[0].response_due_at,null);
});

test('support command capability uses exact read-only signature and ACL metadata, never invokes a command', async () => {
  assert.equal((await triageRead())[0].support_commands_available,false);
  await db.exec("create function public.triniti_platinum_admin_command(uuid,uuid,uuid,text) returns jsonb language plpgsql as $$begin raise exception 'MUST_NOT_INVOKE';end$$;");
  assert.equal((await triageRead())[0].support_commands_available,false);
  await db.exec("create function public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb) returns jsonb language plpgsql as $$begin raise exception 'MUST_NOT_INVOKE';end$$; revoke all on function public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;");
  assert.equal((await triageRead())[0].support_commands_available,false);
  await db.exec('grant execute on function public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb) to service_role');
  assert.equal((await triageRead())[0].support_commands_available,true);
});

test('review queue validates status/cursors and paginates stable tied timestamps without duplicates', async () => {
  assert.equal((await reports()).rows[0].id,report);
  await assert.rejects(reports({status:'invalid'}),/INVALID_STATUS/);
  await assert.rejects(reports({beforeAt:new Date().toISOString()}),/INVALID_CURSOR/);
  await q("insert into public.seller_review_reports(review_id,reporter_id,reason,review_version,created_at) select null,$1,'other',1,now()-interval '1 minute' from generate_series(1,52)",[actors.reporter]);
  const page1=await reports();
  assert.equal(page1.rows.length,50);assert.equal(page1.has_more,true);
  const page2=await reports({beforeAt:page1.next_cursor.created_at,beforeId:page1.next_cursor.id});
  assert.equal(page2.rows.length,3);assert.equal(page2.has_more,false);
  assert.equal(new Set([...page1.rows,...page2.rows].map(row=>row.id)).size,53);
});

test('review hide/restore changes public visibility and ratings, audits once and preserves identical retries', async () => {
  const key=randomUUID();
  assert.equal((await sellerPage()).summary.review_count,1);
  const first=await moderate({key});
  assert.deepEqual(await moderate({key}),first);
  assert.equal((await sellerPage()).rows.length,0);
  assert.equal((await sellerPage()).summary.review_count,0);
  assert.equal(await value("select count(*)::int from public.admin_audit_log where action='seller_review_hide'"),1);
  await assert.rejects(moderate({key,reason:'Different reason'}),/COMMAND_KEY_REUSED/);
  await assert.rejects(moderate(),/REPORT_ALREADY_RESOLVED/);
  await moderate({action:'restore'});
  assert.equal((await sellerPage()).rows[0].id,review);
  assert.equal((await sellerPage()).summary.review_count,1);
  assert.equal((await reports({status:'all'})).rows[0].status,'restored');
});

test('review edits make stale moderation fail; authorized updated version succeeds', async () => {
  await as('authenticated',actors.buyer,'select public.submit_seller_review($1,$2,4,$3)',[actors.buyer,order,'Updated purchase review']);
  await assert.rejects(moderate(),/REVIEW_CHANGED_REFRESH/);
  assert.equal(await value('select count(*)::int from admin_ops.commands'),0);
  assert.equal(await value('select moderation_status from public.seller_reviews where id=$1',[review]),'visible');
  await moderate({version:2});
  assert.equal(await value('select moderation_status from public.seller_reviews where id=$1',[review]),'hidden');
  await assert.rejects(as('authenticated',actors.buyer,'select public.submit_seller_review($1,$2,5,$3)',[actors.buyer,order,'Try to restore']),/REVIEW_UNDER_MODERATION/);
});

test('review audit failure rolls back review/report/receipt together and retry succeeds', async () => {
  const key=randomUUID();
  await db.exec("create function public.fail_candidate_audit() returns trigger language plpgsql as $$begin raise exception 'AUDIT_UNAVAILABLE'; end$$; create trigger fail_candidate_audit before insert on public.admin_audit_log for each row execute function public.fail_candidate_audit();");
  await assert.rejects(moderate({key}),/AUDIT_UNAVAILABLE/);
  assert.equal(await value('select moderation_status from public.seller_reviews where id=$1',[review]),'visible');
  assert.equal(await value('select status from public.seller_review_reports where id=$1',[report]),'open');
  assert.equal(await value('select count(*)::int from admin_ops.commands'),0);
  await db.exec('drop trigger fail_candidate_audit on public.admin_audit_log');
  await moderate({key});
  assert.equal(await value('select status from public.seller_review_reports where id=$1',[report]),'hidden');
});

test('deleted review reports can be dismissed without recreating a target', async () => {
  await q('delete from public.seller_reviews where id=$1',[review]);
  await assert.rejects(moderate(),/REVIEW_UNAVAILABLE/);
  await assert.rejects(moderate({action:'restore'}),/REVIEW_UNAVAILABLE/);
  await moderate({action:'dismiss',version:null});
  assert.equal(await value('select review_id from public.seller_review_reports where id=$1',[report]),null);
  assert.equal(await value('select status from public.seller_review_reports where id=$1',[report]),'dismissed');
});

test('receipt replay cannot bypass a revoked session or cross actor/operation boundaries', async () => {
  const key=randomUUID();
  await triage({key});
  await assert.rejects(moderate({key}),/COMMAND_KEY_REUSED/);
  await assert.rejects(triage({key,actor:actors.owner,session:sessions.owner}),/COMMAND_CONFLICT/);
  await q('delete from auth.sessions where id=$1',[sessions.support]);
  await assert.rejects(triage({key}),/ACTIVE_ADMIN_SESSION_REQUIRED/);
  const reviewKey=randomUUID();
  await moderate({key:reviewKey});
  await assert.rejects(moderate({key:reviewKey,actor:actors.owner,session:sessions.owner}),/COMMAND_KEY_REUSED/);
  await q('delete from auth.sessions where id=$1',[sessions.market]);
  await assert.rejects(moderate({key:reviewKey}),/ACTIVE_ADMIN_SESSION_REQUIRED/);
});
