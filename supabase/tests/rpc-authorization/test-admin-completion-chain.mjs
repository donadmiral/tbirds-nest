import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions, loadLiveSchema } from './live-schema-fixture.mjs';
import { captureMusicState } from './non-music-release-assertions.mjs';

const root = new URL('../../../', import.meta.url);
const qaMode = process.env.PLATINUM_QA_ADMIN_UPGRADE === '1';
const productionCandidatePath = 'supabase/migrations/20261029224550_admin_operations_completion.sql';
const candidatePath = qaMode ? 'supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql' : productionCandidatePath;
const qa = qaMode ? await import('./qa-admin-baseline.mjs') : null;
const signatures = ['public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)',
  'public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)', 'public.triniti_admin_deletion_requests(uuid,uuid,integer)'];
const changedPublic = ['triniti_platinum_admin_command', 'triniti_admin_provision', 'triniti_admin_deletion_requests',
  'update_comment_count', 'sync_post_comment_count', 'sync_post_comments_count',
  ...(qaMode ? ['admin_support_triage_read','admin_support_triage_update'] : [])];
const db = new PGlite({ extensions });
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const value = async (sql, args = []) => Object.values(await one(sql, args) || {})[0];
const actors = Object.fromEntries(['owner','support','market','auditor','member','other','outsider'].map(n => [n,randomUUID()]));
const sessions = Object.fromEntries(Object.keys(actors).map(n => [n,randomUUID()]));
let candidate, beforeState, afterState, postflight, qaCatalog, appliedUnits = 0;
const evidence = { statement:'Established public identity and independent evidence for review.', links:['https://example.test/identity'] };

async function as(role, user, sql, args = [], claims = {}) {
  assert.ok(['service_role','authenticated','anon'].includes(role));
  await db.exec('savepoint request');
  try {
    await db.exec(`set local role ${role}`);
    await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",
      [user || '', claims.role || role, JSON.stringify({ sub:user,role,aal:'aal1',...claims })]);
    const result = await value(sql,args);
    await db.exec('reset role');
    await q("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
    await db.exec('release savepoint request');
    return result;
  } catch(error) {
    await db.exec('rollback to savepoint request; release savepoint request');
    throw error;
  }
}
const staff = (sql,args=[]) => as('service_role',null,sql,args);
const command = (operation,payload={},options={}) => staff('select public.triniti_platinum_admin_command($1,$2,$3,$4,$5)',
  [options.actor ?? actors.owner,options.session ?? sessions.owner,options.key ?? randomUUID(),operation,payload]);
const provision = (kind,payload,phase,key=randomUUID(),options={}) => staff('select public.triniti_admin_provision($1,$2,$3,$4,$5,$6)',
  [options.actor ?? actors.owner,options.session ?? sessions.owner,key,kind,payload,phase]);
const deletionQueue = (options={}) => staff('select public.triniti_admin_deletion_requests($1,$2,$3)',
  [options.actor ?? actors.owner,options.session ?? sessions.owner,options.page ?? 1]);
const insert = async (table,fields) => {
  assert.match(table,/^[a-z_]+$/);
  const names=Object.keys(fields);names.forEach(n=>assert.match(n,/^[a-z_]+$/));
  return value(`insert into public.${table}(${names.join(',')}) values(${names.map((_,i)=>'$'+(i+1)).join(',')}) returning id`,Object.values(fields));
};
const makeApplication = (user=actors.member,extra={}) => insert('verification_applications',
  {applicant_id:user,tier:'public_figure',category:'education',evidence,...extra});
const mockAuthCreated = (job,overrides={}) => q('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)',
  [job.auth_user_id,overrides.email ?? job.email,overrides.metadata ?? {triniti_provision_id:job.provision_id}]);
const staffPayload = () => ({email:`new-${randomUUID()}@example.test`,role:'support_agent',password_digest:'a'.repeat(64)});
const businessApplication = (username='test_company') => insert('business_applications',
  {applicant_id:actors.member,company_name:'Synthetic Company',description:'Education services',contact_email:'member@example.test',desired_username:username,category:'education'});

async function protectedState() {
  return {
    music:await captureMusicState(db),
    functions:await q(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition,p.proacl::text acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','storage','creator_finance','marketplace_ops')
      and p.prokind='f' and not(p.proname=any($1)) order by n.nspname,p.proname,args`,[changedPublic]),
    buckets:await q('select to_jsonb(b) row from storage.buckets b order by id'),
    finance:await q('select to_jsonb(p) row from creator_finance.program p'),
    providers:await q('select to_jsonb(p) row from creator_finance.providers p'),
    roles:await q('select rolname,rolconfig,rolsuper,rolbypassrls from pg_roles order by rolname'),
    staff:await q('select to_jsonb(a) row from public.admin_users a order by user_id'),
    auth:await q('select to_jsonb(u) row from auth.users u order by id'),
    profiles:await q('select to_jsonb(p) row from public.profiles p order by id'),
    sessions:await q('select to_jsonb(s) row from auth.sessions s order by id'),
    qaPreservation:qa ? await qa.captureQaPreservation(db) : null,
  };
}

before(async () => {
  await loadLiveSchema(db);
  await db.exec("alter table auth.users add column if not exists created_at timestamptz default now(); alter table storage.objects add column if not exists version text; alter table storage.objects add column if not exists user_metadata jsonb; grant usage on schema auth to authenticated; insert into storage.buckets(id,name,public) values('chat-media','chat-media',true),('chat-files','chat-files',true),('post-media','post-media',true),('story-media','story-media',true),('media','media',true),('avatars','avatars',true),('market-media','market-media',true);");
  for(const manifestPath of ['supabase/ops/production-rollout-20261029.json','supabase/ops/parity-rollout-20261029.json']) {
    const manifest=JSON.parse(await readFile(new URL(manifestPath,root),'utf8'));
    for(const unit of manifest.units) {
      const sources=[];
      for(const file of unit.files) {
        const sql=await readFile(new URL(file.path,root),'utf8');
        assert.equal(createHash('sha256').update(sql).digest('hex'),file.sha256,file.path);sources.push(sql);
      }
      await db.exec(sources.join('\n'));appliedUnits++;
    }
  }
  assert.equal(appliedUnits,25);
  for(const name of ['20261025073234_applicant_self_service_quality','20261029190200_comment_author_highlights',
    '20261023185734_redacted_client_diagnostics','20261029213000_admin_support_review_contracts']) {
    await db.exec(await readFile(new URL(`supabase/migrations/${name}.sql`,root),'utf8'));
  }
  const expected=JSON.parse(await readFile(new URL('docs/quality/ADMIN_COMPLETION_PREFLIGHT_20261029.json',root),'utf8'));
  const local=await value(await readFile(new URL('supabase/ops/check-admin-completion-preflight.sql',root),'utf8'));
  assert.deepEqual(local,expected.preflight,'Current deployed definitions, 212 column prerequisites, constraints and ACL policies must match fresh production metadata');
  if (qa) {
    await db.exec(await readFile(new URL(productionCandidatePath,root),'utf8'));
    await qa.installQaAdminBaseline(db);
  }
  beforeState=await protectedState();
  candidate=await readFile(new URL(candidatePath,root),'utf8');
  await db.exec(candidate);
  afterState=await protectedState();
  postflight=await value(await readFile(new URL('supabase/ops/check-admin-completion-postflight.sql',root),'utf8'));
  if (qa) {
    const installed=await value(qa.qaPreflightQuery);
    qaCatalog=installed;
    const sameStructure=({functions,preserved_counts,...structure})=>structure;
    assert.deepEqual(sameStructure(installed),sameStructure(qa.qaBaseline),'QA tables, constraints, indexes, policies and guard triggers are preserved');
    const gate=JSON.parse(await readFile(new URL('docs/quality/ADMIN_COMPLETION_GATE_20261029.json',root),'utf8')).postflight;
    for(const fn of [...gate.functions,...gate.preserved_support_review_functions])
      assert.equal(installed.functions.find(f=>f.signature===fn.signature)?.md5,fn.md5,fn.signature);
  }
  if(process.env.ADMIN_COMPLETION_CATALOG_OUTPUT) await writeFile(process.env.ADMIN_COMPLETION_CATALOG_OUTPUT,JSON.stringify({
    candidate:candidatePath,sha256:createHash('sha256').update(candidate).digest('hex'),baselineUnits:25,appliedQualityFixes:4,
    localPreflightMatchesProduction:true,localPreflightMatchesQA:qaMode,postflight,...(qaMode?{qaCatalog}:{}),
  },null,2)+'\n');
  if (qa) await qa.cleanQaPreservationFixture(db);
  await db.exec("select set_config('request.jwt.claim.role','service_role',false); begin");
  for(const [name,id] of Object.entries(actors)) {
    await q('insert into auth.users(id,email) values($1,$2)',[id,`${name}@example.test`]);
    await q('insert into public.profiles(id,username,full_name,email) values($1,$2,$3,$4) on conflict(id) do update set username=excluded.username,full_name=excluded.full_name,email=excluded.email',
      [id,`complete_${name}`,`Synthetic ${name}`,`${name}@example.test`]);
    await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);
  }
  for(const [name,role] of [['owner','super_admin'],['support','support_agent'],['market','market_reviewer'],['auditor','auditor_readonly']]) {
    await q('insert into public.admin_users(user_id,role) values($1,$2)',[actors[name],role]);
  }
  await db.exec('commit');
});
beforeEach(async()=>db.exec('begin'));
afterEach(async()=>db.exec('rollback'));
after(async()=>db.close());

test('forward candidate matches the deployed chain, preserves unrelated state and enables only reviewed contracts',async()=>{
  assert.deepEqual(afterState,beforeState);
  assert.equal(postflight.native_session_check_md5,'ba2e1c694288129ee94d8b6d06746eef');
  assert.equal(postflight.support_commands_available,true);
  assert.equal(postflight.verification_status_write_denied,true);
  assert.equal(postflight.triggers.length,8);assert.ok(postflight.triggers.every(t=>t.enabled==='O'));
  assert.deepEqual(postflight.private_tables.map(t=>t.name),['commands','deletion_requests','provisions','removals',...(qaMode?['single_owner_qa_policy']:[]),'support_triage']);
  assert.ok(postflight.private_tables.every(t=>t.rls&&!t.anon_access&&!t.authenticated_access&&!t.service_direct_access));
  assert.ok(postflight.functions.every(f=>!f.anon_execute&&!f.authenticated_execute&&JSON.stringify(f.config)==='["search_path=\\"\\""]'));
  for(const f of postflight.functions) {
    const serviceEntry=/^(admin_ops\.require_session|triniti_platinum_admin_command|triniti_admin_provision|triniti_admin_deletion_requests)\(/.test(f.signature);
    assert.equal(f.service_execute,serviceEntry,f.signature);
  }
  const baselineReceipt=JSON.parse(await readFile(new URL('docs/quality/ADMIN_SUPPORT_REVIEW_POSTFLIGHT_20261029.json',root),'utf8'));
  for(const f of postflight.preserved_support_review_functions) {
    const old=baselineReceipt.postflight.functions.find(x=>x.signature.replace(/^public\./,'')===f.signature);
    assert.equal(f.md5,old.definition_md5);
  }
  const ticket=await insert('support_tickets',{user_id:actors.member,subject:'Restored capability'});
  const triage=await staff('select public.admin_support_triage_read($1)',[[ticket]]);
  assert.equal(triage.length,1);
  assert.equal(triage[0].support_commands_available,true);
});

test('a repeated deployment refuses to overwrite installed target contracts',async()=>{
  const guard=candidate.match(/do \$preflight\$[\s\S]*?end \$preflight\$;/)[0];
  if(qaMode) await assert.rejects(db.exec(guard),/QA_ADMIN_DEFINITION_OR_GRANT_DRIFT/);
  else await assert.rejects(staff(guard),/ADMIN_COMPLETION_TARGET_ALREADY_EXISTS/);
});

if (qaMode) {
  test('QA upgrade rejects unexpected function execution grants before replacing any contract',async()=>{
    await qa.restoreQaFunctionBaseline(db);
    await db.exec('grant execute on function public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text) to authenticated');
    await assert.rejects(db.exec(candidate.match(/do \$preflight\$[\s\S]*?end \$preflight\$;/)[0]),/QA_ADMIN_DEFINITION_OR_GRANT_DRIFT/);
  });
  test('QA upgrade rejects unexpected private table schema before replacing any contract',async()=>{
    await qa.restoreQaFunctionBaseline(db);
    await db.exec('alter table admin_ops.provisions add column unexpected_fixture text');
    await assert.rejects(db.exec(candidate.match(/do \$preflight\$[\s\S]*?end \$preflight\$;/)[0]),/QA_ADMIN_STRUCTURE_DRIFT/);
  });
}

test('the three public APIs are service-only and app callers cannot forge a privileged role',async()=>{
  for(const signature of signatures) {
    assert.equal(await value("select has_function_privilege('service_role',to_regprocedure($1),'EXECUTE')",[signature]),true);
    for(const role of ['anon','authenticated']) assert.equal(await value("select has_function_privilege($1,to_regprocedure($2),'EXECUTE')",[role,signature]),false);
  }
  for(const role of ['anon','authenticated']) {
    for(const [sql,args] of [
      ['select public.triniti_platinum_admin_command($1,$2,$3,$4,$5)',[actors.owner,sessions.owner,randomUUID(),'publishAnnouncement',{title:'Forged',body:'Forged'}]],
      ['select public.triniti_admin_provision($1,$2,$3,$4,$5,$6)',[actors.owner,sessions.owner,randomUUID(),'staff',staffPayload(),'reserve']],
      ['select public.triniti_admin_deletion_requests($1,$2,1)',[actors.owner,sessions.owner]],
    ]) await assert.rejects(as(role,actors.owner,sql,args,{role:'service_role',aal:'aal2'}),/permission denied/);
  }
});

test('all new private tables deny direct reads and mutations even to the service role',async()=>{
  for(const role of ['anon','authenticated','service_role']) {
    for(const name of ['provisions','deletion_requests','removals']) {
      for(const operation of [`select * from admin_ops.${name}`,`delete from admin_ops.${name}`])
        await assert.rejects(as(role,actors.owner,operation),/permission denied/);
    }
  }
});

test('current AAL1 and AAL2 staff sessions work while unknown and revoked identities are denied',async()=>{
  for(const aal of ['aal1','aal2']) {
    await q('update auth.sessions set aal=$1 where id=$2',[aal,sessions.owner]);
    assert.equal((await command('publishAnnouncement',{title:aal,body:'Valid current staff session'})).success,true);
  }
  for(const option of [{actor:actors.member},{session:sessions.member},{session:randomUUID()}])
    await assert.rejects(command('publishAnnouncement',{title:'Denied',body:'Denied'},option),/ACTIVE_ADMIN_SESSION_REQUIRED/);
  for(const sql of ["update auth.sessions set aal='aal0' where id=$1",'update auth.sessions set aal=null where id=$1',
    "update auth.sessions set not_after=now()-interval '1 second' where id=$1",'delete from auth.sessions where id=$1']) {
    await db.exec('savepoint invalid_session');await q(sql,[sessions.owner]);
    await assert.rejects(command('publishAnnouncement',{title:'Denied',body:'Denied'}),/ACTIVE_ADMIN_SESSION_REQUIRED/);
    await db.exec('rollback to savepoint invalid_session; release savepoint invalid_session');
  }
  for(const sql of ['update public.admin_users set active=false where user_id=$1','update auth.users set deleted_at=now() where id=$1',
    "update auth.users set banned_until=now()+interval '1 day' where id=$1"]) {
    await db.exec('savepoint invalid_account');await q(sql,[actors.owner]);
    await assert.rejects(command('publishAnnouncement',{title:'Denied',body:'Denied'}),/ACTIVE_ADMIN_SESSION_REQUIRED/);
    await db.exec('rollback to savepoint invalid_account; release savepoint invalid_account');
  }
});

test('all 11 roles match all 15 frontend action permissions and unknown permissions fail closed',async()=>{
  const {default:ts}=await import('../../../admin-web/node_modules/typescript/lib/typescript.js');
  const source=await readFile(new URL('../../../admin-web/lib/permissions.ts',import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const permissions=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  const names=['verification','user_moderate','post_moderate','market_moderate','report_post','report_listing','report_user','support','ads','system','business_manage','organization_manage','staff_manage','account_delete','comment_delete'];
  assert.equal(permissions.STAFF_ROLES.size,11);
  for(const role of permissions.STAFF_ROLES) {
    await q('update public.admin_users set role=$1 where user_id=$2',[role,actors.owner]);
    for(const permission of [...names,'forged_permission']) {
      const check=()=>staff('select admin_ops.require_session($1,$2,$3)',[actors.owner,sessions.owner,permission]);
      if(permissions.canPerform(role,permission)) assert.equal(await check(),role);
      else await assert.rejects(check(),/ADMIN_PERMISSION_DENIED/);
    }
  }
});

test('commands validate operation, field names, field types, payload size and target identity',async()=>{
  await assert.rejects(command('nonexistent',{}),/UNKNOWN_ADMIN_OPERATION/);
  for(const payload of [{title:'Good',body:'Good',role:'super_admin'},{title:4,body:'Good'},['bad'],{title:'a'.repeat(33000),body:'Good'}])
    await assert.rejects(command('publishAnnouncement',payload),/INVALID_COMMAND/);
  await assert.rejects(command('suspendUser',{id:randomUUID(),reason:'Reviewed restriction'}),/TARGET_NOT_FOUND/);
});

test('identical commands produce one result and audit; changed, cross-operation and cross-actor replays are denied',async()=>{
  const key=randomUUID(),payload={title:'Idempotent notice',body:'One notice and one audit'};
  const first=await command('publishAnnouncement',payload,{key});
  assert.deepEqual(await command('publishAnnouncement',payload,{key}),first);
  assert.equal(await value("select count(*)::int from public.announcements where title='Idempotent notice'"),1);
  assert.equal(await value('select count(*)::int from admin_ops.commands where command_key=$1',[key]),1);
  assert.equal(await value("select count(*)::int from public.admin_audit_log where action='publishAnnouncement'"),1);
  await assert.rejects(command('publishAnnouncement',{...payload,title:'Changed'},{key}),/COMMAND_KEY_REUSED/);
  await assert.rejects(command('retireAnnouncement',{id:first.target_id},{key}),/COMMAND_KEY_REUSED/);
  await q("update public.admin_users set role='platform_admin' where user_id=$1",[actors.support]);
  await assert.rejects(command('publishAnnouncement',payload,{key,actor:actors.support,session:sessions.support}),/COMMAND_KEY_REUSED/);
  await q('delete from auth.sessions where id=$1',[sessions.owner]);
  await assert.rejects(command('publishAnnouncement',payload,{key}),/ACTIVE_ADMIN_SESSION_REQUIRED/);
});

test('audit failure rolls back the action and receipt, allowing an identical successful retry',async()=>{
  await db.exec("create function public.admin_completion_fail_audit() returns trigger language plpgsql as $$begin raise exception 'AUDIT_UNAVAILABLE'; end$$; create trigger admin_completion_fail_audit before insert on public.admin_audit_log for each row execute function public.admin_completion_fail_audit();");
  const key=randomUUID(),payload={title:'Atomic notice',body:'Rollback on audit failure'};
  await assert.rejects(command('publishAnnouncement',payload,{key}),/AUDIT_UNAVAILABLE/);
  assert.equal(await value("select count(*)::int from public.announcements where title='Atomic notice'"),0);
  assert.equal(await value('select count(*)::int from admin_ops.commands where command_key=$1',[key]),0);
  await db.exec('drop trigger admin_completion_fail_audit on public.admin_audit_log; drop function public.admin_completion_fail_audit();');
  assert.equal((await command('publishAnnouncement',payload,{key})).success,true);
});

test('verification approval validates evidence and review basis, rejects self approval and synchronizes revocation',async()=>{
  const id=await makeApplication();
  await assert.rejects(command('approveApplication',{id}),/VERIFICATION_REVIEW_BASIS_REQUIRED/);
  assert.equal(await value('select is_verified from public.profiles where id=$1',[actors.member]),false);
  await command('approveApplication',{id,reason:'Independent identity evidence checked and ownership confirmed.'});
  assert.equal(await value('select verified_tier from public.profiles where id=$1',[actors.member]),'public_figure');
  await assert.rejects(command('rejectApplication',{id,reason:'Already decided'}),/APPLICATION_NOT_PENDING/);
  await command('revokeVerification',{id:actors.member});
  assert.equal(await value('select status from public.verification_applications where id=$1',[id]),'revoked');
  assert.equal(await value('select revoked_at is not null from public.verification_applications where id=$1',[id]),true);
  const self=await makeApplication(actors.owner);
  await assert.rejects(command('approveApplication',{id:self,reason:'Self review must not be accepted by this operation.'}),/VERIFICATION_REVIEW_BASIS_REQUIRED/);
  const rejected=await makeApplication(actors.other);
  await command('rejectApplication',{id:rejected,reason:'Evidence could not be confirmed.'});
  assert.equal(await value('select status from public.verification_applications where id=$1',[rejected]),'rejected');
});

test('applicants cannot forge badges, decisions or another account application and evidence stays private',async()=>{
  const fields={applicant_id:actors.member,tier:'public_figure',category:'education',evidence};
  const id=await as('authenticated',actors.member,'insert into public.verification_applications(applicant_id,tier,category,evidence) values($1,$2,$3,$4) returning id',Object.values(fields));
  assert.equal(await as('authenticated',actors.other,'select count(*)::int from public.verification_applications where id=$1',[id]),0);
  assert.equal(await as('authenticated',actors.member,'select count(*)::int from public.verification_applications where id=$1',[id]),1);
  await assert.rejects(as('authenticated',actors.member,"update public.profiles set is_verified=true,verified_tier='official' where id=$1",[actors.member],{role:'service_role'}),/VERIFICATION_STAFF_REVIEW_REQUIRED/);
  await assert.rejects(as('authenticated',actors.member,"update public.verification_applications set status='approved' where id=$1",[id]),/permission denied/);
  await assert.rejects(as('authenticated',actors.member,'insert into public.verification_applications(applicant_id,tier,category,evidence,status) values($1,$2,$3,$4,$5)',[actors.other,'public_figure','education',evidence,'approved']),/VERIFICATION_STAFF_REVIEW_REQUIRED|row-level security/);
});

test('verification submissions reject duplicate pending requests and malformed evidence',async()=>{
  await makeApplication();
  await assert.rejects(staff('insert into public.verification_applications(applicant_id,tier,category,evidence) values($1,$2,$3,$4)',[actors.member,'public_figure','education',evidence]),/VERIFICATION_ALREADY_PENDING/);
  for(const bad of [{}, {...evidence,links:['javascript:alert(1)']},{...evidence,links:[]},{...evidence,statement:'short'}]) {
    await assert.rejects(as('authenticated',actors.other,'insert into public.verification_applications(applicant_id,tier,category,evidence) values($1,$2,$3,$4)',[actors.other,'public_figure','education',bad]),/VERIFICATION_/);
  }
});

test('verification evidence rejects backslashes before a misleading URL can enter the review queue',async()=>{
  const malformed={...evidence,links:['https://example.test\\redirect']};
  await assert.rejects(as('authenticated',actors.other,'insert into public.verification_applications(applicant_id,tier,category,evidence) values($1,$2,$3,$4)',
    [actors.other,'public_figure','education',malformed]),/VERIFICATION_EVIDENCE_URL_INVALID/);
  assert.equal(await value('select count(*)::int from public.verification_applications where applicant_id=$1',[actors.other]),0);
});

test('suspension revokes sessions, restoration and bounded strikes work, active staff are protected',async()=>{
  await command('suspendUser',{id:actors.member,reason:'Reviewed policy violation'});
  assert.equal(await value('select count(*)::int from auth.sessions where user_id=$1',[actors.member]),0);
  assert.equal(await value('select banned_until::text from auth.users where id=$1',[actors.member]),'infinity');
  await command('restoreUser',{id:actors.member});
  assert.equal(await value('select banned_until from auth.users where id=$1',[actors.member]),null);
  await command('issueStrike',{uid:actors.member,level:'restrict',days:'7',reason:'Reviewed repeated spam'});
  assert.equal(await value('select restricted_until>now() from public.profiles where id=$1',[actors.member]),true);
  await command('liftRestriction',{uid:actors.member});
  await command('issueStrike',{uid:actors.member,level:'warn',reason:'Warning issued'});
  await assert.rejects(command('issueStrike',{uid:actors.member,level:'restrict',days:'91',reason:'Outside allowed range'}),/INVALID_RESTRICTION_DAYS/);
  await assert.rejects(command('suspendUser',{id:actors.owner,reason:'Active staff protected'}),/ACTIVE_STAFF_DELETION_FORBIDDEN/);
});

test('reported removals bind the exact target and report decisions use valid states',async()=>{
  const pid=await insert('posts',{user_id:actors.member}),other=await insert('posts',{user_id:actors.other});
  const rid=await insert('post_reports',{reporter_id:actors.other,post_id:pid,reason:'spam'});
  await assert.rejects(command('removeReportedPost',{rid,pid:other}),/REPORT_TARGET_MISMATCH/);
  await command('removeReportedPost',{rid,pid});
  assert.equal(await value('select count(*)::int from public.posts where id=$1',[pid]),0);
  assert.equal(await value("select count(*)::int from admin_ops.removals where kind='post' and content_id=$1",[pid]),1);
  const dismiss=await insert('post_reports',{reporter_id:actors.member,post_id:other,reason:'spam'});
  await command('dismissReport',{rid:dismiss,table:'post_reports'});
  const ur=await insert('user_reports',{reporter_id:actors.member,reported_id:actors.other,reason:'spam'});
  await command('resolveUserReport',{rid:ur,outcome:'actioned'});
  assert.equal(await value('select status from public.user_reports where id=$1',[ur]),'closed');
});

test('reporters cannot submit a pre-resolved report or impersonate its resolver',async()=>{
  await assert.rejects(as('authenticated',actors.member,"insert into public.user_reports(reporter_id,reported_id,reason,status,resolved_by) values($1,$2,'spam','closed',$1)",[actors.member,actors.other]),/row-level security/);
});

test('listing removal retains order history and owners cannot restore, delete or reuse moderated identities',async()=>{
  const lid=await insert('marketplace_listings',{seller_id:actors.member,title:'Synthetic listing',price:12});
  const rid=await insert('listing_reports',{listing_id:lid,reporter_id:actors.other,reason:'spam'});
  await command('removeReportedListing',{rid,lid});
  assert.equal(await value('select status from public.marketplace_listings where id=$1',[lid]),'removed');
  for(const claims of [{},{role:'service_role'}]) {
    await assert.rejects(as('authenticated',actors.member,"update public.marketplace_listings set status='available',hidden_at=null where id=$1",[lid],claims),/CONTENT_REMOVED_BY_MODERATOR/);
    await assert.rejects(as('authenticated',actors.member,'delete from public.marketplace_listings where id=$1',[lid],claims),/CONTENT_REMOVED_BY_MODERATOR/);
  }
  const second=await insert('marketplace_listings',{seller_id:actors.member,title:'Second listing',price:20});
  await command('adminRemoveListing',{lid:second});
  const dismiss=await insert('listing_reports',{listing_id:second,reporter_id:actors.other,reason:'spam'});
  await command('dismissReport',{rid:dismiss,table:'listing_reports'});
});

test('post, comment and story removals run with safe trigger search paths and prevent reused IDs',async()=>{
  const pid=await insert('posts',{user_id:actors.member});
  const cid=await insert('post_comments',{user_id:actors.member,post_id:pid,body:'Synthetic comment'});
  assert.equal(Number(await value('select comments_count from public.posts where id=$1',[pid])),1);
  await command('adminRemoveComment',{cid});
  assert.equal(Number(await value('select comments_count from public.posts where id=$1',[pid])),0);
  await command('adminRemovePost',{pid});
  const sid=await insert('stories',{user_id:actors.member,media_url:'https://example.test/story',media_type:'image'});
  await command('adminRemoveStory',{sid});
  assert.equal(await value('select count(*)::int from admin_ops.removals'),3);
  await assert.rejects(as('authenticated',actors.member,'insert into public.posts(id,user_id) values($1,$2)',[pid,actors.member]),/CONTENT_REMOVED_BY_MODERATOR/);
});

test('support replies are once-only and solve/reopen transitions clear resolution metadata',async()=>{
  const tid=await insert('support_tickets',{user_id:actors.member,subject:'Synthetic help request'}),key=randomUUID();
  const options={key,actor:actors.support,session:sessions.support};
  await command('sendTicketReply',{tid,body:'A synthetic support reply'},options);
  await command('sendTicketReply',{tid,body:'A synthetic support reply'},options);
  assert.equal(await value('select count(*)::int from public.support_messages where ticket_id=$1',[tid]),1);
  await command('resolveTicket',{rid:tid},{actor:actors.support,session:sessions.support});
  assert.equal(await value('select status from public.support_tickets where id=$1',[tid]),'solved');
  await command('setTicketStatus',{tid,status:'open'},{actor:actors.support,session:sessions.support});
  assert.equal(await value('select resolved_at from public.support_tickets where id=$1',[tid]),null);
  await assert.rejects(command('sendTicketReply',{tid,body:' '}),/INVALID_REPLY/);
});

test('campaign review cannot forge funding or bypass allowed review states',async()=>{
  const id=await insert('studio_campaigns',{owner_id:actors.member,name:'Synthetic ad',budget:100,status:'submitted'});
  await assert.rejects(command('approveCampaign',{id,paid_amount:'100',payment_ref:'forged'}),/INVALID_COMMAND_FIELD/);
  await command('approveCampaign',{id});
  const row=await one('select status,paid_amount from public.studio_campaigns where id=$1',[id]);
  assert.equal(row.status,'approved');assert.equal(Number(row.paid_amount),0);
  await assert.rejects(command('rejectCampaign',{id,reason:'Already reviewed'}),/APPLICATION_NOT_PENDING/);
  await command('adminEndCampaign',{id});
  const rejected=await insert('studio_campaigns',{owner_id:actors.member,name:'Rejected ad',status:'submitted'});
  await command('rejectCampaign',{id:rejected,reason:'Reviewed content is not eligible.'});
});

test('last-super-admin protection and role changes retain active staff safety and session revocation',async()=>{
  await assert.rejects(command('setStaffRole',{uid:actors.owner,role:'support_agent'}),/LAST_SUPER_ADMIN/);
  await assert.rejects(command('deactivateStaff',{uid:actors.owner}),/LAST_SUPER_ADMIN/);
  await command('setStaffRole',{uid:actors.support,role:'analyst'});
  await command('deactivateStaff',{uid:actors.support});
  assert.equal(await value('select active from public.admin_users where user_id=$1',[actors.support]),false);
  assert.equal(await value('select count(*)::int from auth.sessions where user_id=$1',[actors.support]),0);
});

test('feature flags, announcements and blocked words validate and mutate the intended records',async()=>{
  await q("insert into public.feature_flags(key) values('completion_fixture')");
  await command('toggleFlag',{key:'completion_fixture',to:'off'});
  assert.equal(await value("select enabled from public.feature_flags where key='completion_fixture'"),false);
  await assert.rejects(command('toggleFlag',{key:'completion_fixture',to:'maybe'}),/INVALID_FLAG_VALUE/);
  const notice=await command('publishAnnouncement',{title:'Notice',body:'Synthetic service announcement'});
  await command('retireAnnouncement',{id:notice.target_id});
  assert.equal(await value('select active from public.announcements where id=$1',[notice.target_id]),false);
  await command('addBlockedWord',{word:'  SYNTHETIC_SPAM  '});await command('removeBlockedWord',{word:'synthetic_spam'});
});

test('organization transfer and archive update ownership and revoke delegations atomically',async()=>{
  const id=await insert('organizations',{kind:'business',name:'Synthetic organization'});
  const client=await insert('organizations',{kind:'business',name:'Synthetic client'});
  await q("insert into public.org_memberships(org_id,user_id,role) values($1,$2,'owner')",[id,actors.member]);
  await command('adminTransferOwnership',{id,username:'@complete_other'});
  assert.equal(await value('select role from public.org_memberships where org_id=$1 and user_id=$2',[id,actors.other]),'owner');
  assert.equal(await value('select role from public.org_memberships where org_id=$1 and user_id=$2',[id,actors.member]),'admin');
  await q("insert into public.org_delegations(principal_org_id,client_org_id,scopes,granted_by) values($1,$2,array['content.publish'],$3)",[id,client,actors.owner]);
  assert.equal(await value('select count(*)::int from public.org_delegations where principal_org_id=$1',[id]),1);
  await command('archiveOrganization',{id});assert.ok(await value('select archived_at from public.organizations where id=$1',[id]));
  assert.equal(await value('select count(*)::int from public.org_delegations where principal_org_id=$1 or client_org_id=$1',[id]),0);
  await command('restoreOrganization',{id});assert.equal(await value('select archived_at from public.organizations where id=$1',[id]),null);
  assert.ok(client);
});

test('business rejection needs a pending application and cannot race reserved provisioning',async()=>{
  const id=await businessApplication();
  await assert.rejects(command('rejectBusinessApplication',{id,reason:''}),/REASON_REQUIRED/);
  await provision('business',{id},'reserve');
  await assert.rejects(command('rejectBusinessApplication',{id,reason:'Second reviewer decision'}),/APPLICATION_PROVISIONING/);
  const rejected=await businessApplication('rejected_company');
  await command('rejectBusinessApplication',{id:rejected,reason:'Registration evidence could not be confirmed.'});
});

test('staff provisioning reserves only a new identity and finishes exactly once after trusted provider confirmation',async()=>{
  const key=randomUUID(),payload=staffPayload();
  const job=await provision('staff',payload,'reserve',key);
  assert.equal((await provision('staff',payload,'reserve',key)).auth_user_id,job.auth_user_id);
  assert.equal(await value('select count(*)::int from auth.users where id=$1',[job.auth_user_id]),0);
  await assert.rejects(provision('staff',payload,'finish',key),/PROVISION_IDENTITY_MISMATCH/);
  await mockAuthCreated(job,{metadata:{triniti_provision_id:randomUUID()}});
  await assert.rejects(provision('staff',payload,'finish',key),/PROVISION_IDENTITY_MISMATCH/);
  await q('update auth.users set raw_app_meta_data=$2 where id=$1',[job.auth_user_id,{triniti_provision_id:job.provision_id}]);
  assert.equal((await provision('staff',payload,'finish',key)).complete,true);
  assert.equal((await provision('staff',payload,'finish',key)).complete,true);
  assert.equal(await value('select role from public.admin_users where user_id=$1',[job.auth_user_id]),'support_agent');
  assert.equal(await value("select count(*)::int from public.admin_audit_log where action='inviteStaff' and target_id=$1",[job.auth_user_id]),1);
});

test('provisioning rejects changed payloads, other actors, existing emails and unreserved finish',async()=>{
  const key=randomUUID(),payload=staffPayload();await provision('staff',payload,'reserve',key);
  await assert.rejects(provision('staff',{...payload,role:'super_admin'},'finish',key),/COMMAND_KEY_REUSED/);
  await q("update public.admin_users set role='super_admin' where user_id=$1",[actors.support]);
  await assert.rejects(provision('staff',payload,'reserve',key,{actor:actors.support,session:sessions.support}),/COMMAND_KEY_REUSED/);
  await assert.rejects(provision('staff',{...staffPayload(),email:'member@example.test'},'reserve'),/EMAIL_ALREADY_IN_USE/);
  await assert.rejects(provision('staff',staffPayload(),'finish'),/PROVISION_NOT_RESERVED/);
});

test('business provisioning uses delegated identity, protects application snapshot, bans direct sign-in and preserves owner email',async()=>{
  const id=await businessApplication(),key=randomUUID();
  const job=await provision('business',{id},'reserve',key);
  assert.notEqual(job.email,'member@example.test');assert.match(job.email,/@accounts\.platinumcircles\.invalid$/);
  await mockAuthCreated(job);
  await db.exec('savepoint changed_application');
  await q("update public.business_applications set desired_username='changed_company' where id=$1",[id]);
  await assert.rejects(provision('business',{id},'finish',key),/APPLICATION_CHANGED/);
  await db.exec('rollback to savepoint changed_application; release savepoint changed_application');
  assert.equal((await provision('business',{id},'finish',key)).complete,true);
  assert.equal(await value('select role from public.business_members where business_id=$1 and member_id=$2',[job.auth_user_id,actors.member]),'owner');
  assert.equal(await value('select banned_until::text from auth.users where id=$1',[job.auth_user_id]),'infinity');
  assert.equal(await value('select email from auth.users where id=$1',[actors.member]),'member@example.test');
});

test('provisioning audit failure keeps the reservation resumable and does not grant a partial staff role',async()=>{
  const key=randomUUID(),payload=staffPayload(),job=await provision('staff',payload,'reserve',key);await mockAuthCreated(job);
  await db.exec("create function public.admin_completion_fail_audit() returns trigger language plpgsql as $$begin raise exception 'AUDIT_UNAVAILABLE'; end$$; create trigger admin_completion_fail_audit before insert on public.admin_audit_log for each row execute function public.admin_completion_fail_audit();");
  await assert.rejects(provision('staff',payload,'finish',key),/AUDIT_UNAVAILABLE/);
  assert.equal(await value('select count(*)::int from public.admin_users where user_id=$1',[job.auth_user_id]),0);
  assert.equal(await value('select completed_at from admin_ops.provisions where command_key=$1',[key]),null);
  await db.exec('drop trigger admin_completion_fail_audit on public.admin_audit_log; drop function public.admin_completion_fail_audit();');
  assert.equal((await provision('staff',payload,'finish',key)).complete,true);
});

test('deletion requests preserve Auth and financial history, revoke sessions and block unreviewed restoration',async()=>{
  await q("insert into creator_finance.ledger(user_id,currency,amount_minor,from_bucket,to_bucket,source_ref,idempotency_key) values($1,'USD',1234,'funding','pending','completion-retention','completion-retention')",[actors.member]);
  await assert.rejects(command('adminDeleteAccount',{id:actors.member,reason:'Intentional synthetic request',confirm:'NO'}),/DELETE_CONFIRMATION_REQUIRED/);
  const result=await command('adminDeleteAccount',{id:actors.member,reason:'Intentional synthetic request',confirm:'DELETE'});
  assert.equal(result.deletion_status,'retention_review');
  assert.equal(await value('select count(*)::int from auth.users where id=$1',[actors.member]),1);
  assert.equal(await value('select count(*)::int from auth.sessions where user_id=$1',[actors.member]),0);
  assert.equal(Number(await value('select amount_minor from creator_finance.ledger where user_id=$1',[actors.member])),1234);
  const queue=await deletionQueue();assert.equal(queue.total,1);assert.equal(queue.rows[0].user_id,actors.member);
  assert.equal(queue.rows[0].status,'retention_review');
  await assert.rejects(command('restoreUser',{id:actors.member}),/DELETION_REVIEW_REQUIRED/);
  await assert.rejects(command('liftRestriction',{uid:actors.member}),/DELETION_REVIEW_REQUIRED/);
});

test('deletion queue is bounded and super-admin only; account owners must transfer ownership first',async()=>{
  await assert.rejects(deletionQueue({actor:actors.support,session:sessions.support}),/ADMIN_PERMISSION_DENIED/);
  await assert.rejects(deletionQueue({page:0}),/INVALID_PAGE/);
  await assert.rejects(deletionQueue({page:10001}),/INVALID_PAGE/);
  const id=await insert('organizations',{kind:'business',name:'Owned organization'});
  await q("insert into public.org_memberships(org_id,user_id,role) values($1,$2,'owner')",[id,actors.member]);
  await assert.rejects(command('adminDeleteAccount',{id:actors.member,reason:'Synthetic request',confirm:'DELETE'}),/TRANSFER_ORGANIZATION_OWNERSHIP_FIRST/);
});

test('business provisioning rechecks every reviewed field before assigning a verified identity',async()=>{
  const id=await businessApplication(),key=randomUUID(),job=await provision('business',{id},'reserve',key);
  await mockAuthCreated(job);
  for(const [field,next] of [['company_name','Different company'],['description','Different reviewed description'],['category','finance'],['contact_email','changed@example.test']]) {
    await db.exec('savepoint changed_business');
    await q(`update public.business_applications set ${field}=$1 where id=$2`,[next,id]);
    await assert.rejects(provision('business',{id},'finish',key),/APPLICATION_CHANGED/);
    assert.equal(await value('select count(*)::int from public.business_members where business_id=$1',[job.auth_user_id]),0);
    await db.exec('rollback to savepoint changed_business; release savepoint changed_business');
  }
  assert.equal((await provision('business',{id},'finish',key)).complete,true);
});

test('business provisioning denies banned/deleted owners both at reservation and completion',async()=>{
  const id=await businessApplication();
  for(const sql of ["update auth.users set banned_until=now()+interval '1 day' where id=$1",'update auth.users set deleted_at=now() where id=$1']) {
    await db.exec('savepoint inactive_owner');await q(sql,[actors.member]);
    await assert.rejects(provision('business',{id},'reserve'),/BUSINESS_OWNER_REQUIRED/);
    await db.exec('rollback to savepoint inactive_owner; release savepoint inactive_owner');
  }
  const key=randomUUID(),job=await provision('business',{id},'reserve',key);await mockAuthCreated(job);
  await q("update auth.users set banned_until=now()+interval '1 day' where id=$1",[actors.member]);
  await assert.rejects(provision('business',{id},'finish',key),/BUSINESS_OWNER_REQUIRED/);
});

test('a provider-created identity that has been banned cannot gain a new staff role',async()=>{
  const key=randomUUID(),payload=staffPayload(),job=await provision('staff',payload,'reserve',key);
  await mockAuthCreated(job);
  await q("update auth.users set banned_until=now()+interval '1 day' where id=$1",[job.auth_user_id]);
  await assert.rejects(provision('staff',payload,'finish',key),/PROVISION_IDENTITY_MISMATCH/);
  assert.equal(await value('select count(*)::int from public.admin_users where user_id=$1',[job.auth_user_id]),0);
});

test('organization ownership cannot be transferred to a banned or deleted Auth identity',async()=>{
  const id=await insert('organizations',{kind:'business',name:'Synthetic owned organization'});
  await q("insert into public.org_memberships(org_id,user_id,role) values($1,$2,'owner')",[id,actors.member]);
  for(const sql of ["update auth.users set banned_until=now()+interval '1 day' where id=$1",'update auth.users set deleted_at=now() where id=$1']) {
    await db.exec('savepoint invalid_new_owner');await q(sql,[actors.other]);
    await assert.rejects(command('adminTransferOwnership',{id,username:'complete_other'}),/TARGET_NOT_FOUND/);
    await db.exec('rollback to savepoint invalid_new_owner; release savepoint invalid_new_owner');
  }
  assert.equal(await value('select role from public.org_memberships where org_id=$1 and user_id=$2',[id,actors.member]),'owner');
});
