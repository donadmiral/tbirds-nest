import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test as nodeTest} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';
import {readCandidate} from './migration-source.mjs';

const db=new PGlite({extensions}),qaMode=process.env.PLATINUM_QA_STAFF_SHELLS==='1';
const candidate='supabase/migrations/20261030012831_staff_social_shells.sql';
const ids=Object.fromEntries(['owner','member','legacy'].map(name=>[name,randomUUID()]));
const sessions=Object.fromEntries(Object.keys(ids).map(name=>[name,randomUUID()]));
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await q(sql,args))[0]||{})[0];
const passed=[];let migration,preflight,postflight,originalProvision,originalGuard,preservedBefore,preservedAfter,legacyReservation;
const test=(name,fn)=>nodeTest(name,async()=>{await fn();passed.push(name);});
async function as(role,actor,sql,args=[],session=null){
 await db.exec('savepoint request');
 try{
  await db.exec(`set local role ${role}`);
  const claims={role,sub:actor,session_id:session,aal:'aal1'};
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[actor||'',role,JSON.stringify(claims)]);
  const result=await value(sql,args);await db.exec('reset role');
  await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
  await db.exec('release savepoint request');return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const svc=(sql,args=[])=>as('service_role',null,sql,args);
const provision=(kind,payload,phase,key,options={})=>svc('select public.triniti_admin_provision($1,$2,$3,$4,$5,$6)',
 [options.actor??ids.owner,options.session??sessions.owner,key,kind,payload,phase]);
async function reserve(role='support_agent'){
 const key=randomUUID(),payload={email:`staff-${randomUUID()}@example.test`,role,password_digest:'a'.repeat(64)};
 return {key,payload,job:await provision('staff',payload,'reserve',key)};
}
const createAuth=(job,{email=job.email,metadata={triniti_provision_id:job.provision_id}}={})=>q('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)',[job.auth_user_id,email,metadata]);
const finish=r=>provision('staff',r.payload,'finish',r.key);
const profile=id=>value('select (select to_jsonb(p) from public.profiles p where id=$1)',[id]);
const countStaff=id=>value('select count(*)::int from public.admin_users where user_id=$1',[id]);
async function preserve(){
 return {
  auth:await q('select to_jsonb(u) row from auth.users u order by id'),profiles:await q('select to_jsonb(p) row from public.profiles p order by id'),
  sessions:await q('select to_jsonb(s) row from auth.sessions s order by id'),staff:await q('select to_jsonb(s) row from public.admin_users s order by user_id'),
  storage:await q('select to_jsonb(o) row from storage.objects o order by id'),buckets:await q('select to_jsonb(b) row from storage.buckets b order by id'),
  provisions:await q('select to_jsonb(p) row from admin_ops.provisions p order by command_key'),
  policy:qaMode?await q('select to_jsonb(p) row from admin_ops.single_owner_qa_policy p'):null,
  functions:await q(`select n.nspname,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','auth','storage','admin_ops','account_erasure')
   and p.prokind='f' and p.proname not in('triniti_admin_provision','assert_writable','enforce_staff_social_shell') order by n.nspname,signature`),
 };
}

before(async()=>{
 await loadDeployedMediaBaseline(db);await db.exec(await readCandidate());
 await db.exec(await source('supabase/migrations/20261029224550_admin_operations_completion.sql'));
 if(qaMode){
  await(await import('./qa-admin-baseline.mjs')).installQaAdminBaseline(db);
  await(await import('./qa-media-baseline.mjs')).installQaMediaBaseline(db);
  await db.exec(await source('supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql'));
  await db.exec(await source('supabase/ops/qa/20261029233915_qa_media_completion_forward.sql'));
  for(const name of ['20261029224812_account_storage_erasure','20261029231321_account_erasure_admin_review_queue'])await db.exec(await source(`supabase/migrations/${name}.sql`));
  await(await import('./qa-database-hardening-baseline.mjs')).installQaHardeningAclBaseline(db);
  await db.exec(await source('supabase/ops/qa/20261029235400_qa_database_access_hardening_forward.sql'));
  await db.exec('revoke all on function public.upsert_link_preview(text,text,text,text,text) from public,postgres,anon,authenticated,service_role;grant execute on function public.upsert_link_preview(text,text,text,text,text) to postgres,public,anon,authenticated,service_role');
 }else{
  for(const name of ['20261029224812_account_storage_erasure','20261029224813_private_media_cutover_compatibility','20261029231321_account_erasure_admin_review_queue','20261029231440_bounded_media_delivery'])await db.exec(await source(`supabase/migrations/${name}.sql`));
  for(const name of ['notify_push_notification','notify_voip_ring','notify_voip_ring_1to1','notify_voip_ring_session'])await db.exec(`create function public.${name}() returns trigger language plpgsql security definer set search_path=public as $$begin return new;end$$;revoke all on function public.${name}() from public,postgres,anon,authenticated,service_role;grant execute on function public.${name}() to public,postgres,anon,authenticated,service_role`);
  await db.exec(await source('supabase/migrations/20261029234214_database_access_hardening.sql'));
 }
 // Match the inspected managed service role instead of granting extra policies.
 await db.exec('alter role service_role bypassrls');
 for(const name of ['20261030000331_link_preview_verified_cache','20261030005241_account_erasure_operator_review','20261030010250_account_erasure_admin_restore_guard'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 await db.exec("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims','{}',false);begin");
 for(const [name,id]of Object.entries(ids)){
  await q('insert into auth.users(id,email) values($1,$2)',[id,`shell-${name}@example.test`]);
  await q('update public.profiles set username=$1,full_name=$1 where id=$2',[`shell_${name}`,id]);
  await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);
 }
 await q("insert into public.admin_users(user_id,role) values($1,'super_admin'),($2,'support_agent')",[ids.owner,ids.legacy]);
 legacyReservation=await reserve();await createAuth(legacyReservation.job);
 assert.equal((await profile(legacyReservation.job.auth_user_id)).deactivated_at,null,'The original Auth-create path exposes an active personal profile before the patch');
 await finish(legacyReservation);
 await db.exec('commit');
 assert.equal(await value("select md5(pg_get_functiondef('public.handle_new_user()'::regprocedure))"),'02467b6f2fcb8a6928cdaebe097e6bbc','Use the real deployed Auth-created profile trigger');
 assert.equal(await value("select md5(pg_get_triggerdef(oid)) from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created'"),'786e53a33077b3a68f1ec248e238d18a');
 originalProvision=await value("select pg_get_functiondef('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)'::regprocedure)");
 originalGuard=await value("select pg_get_functiondef('account_erasure.assert_writable(uuid)'::regprocedure)");
 preflight=await value(await source('supabase/ops/check-staff-social-shells-preflight.sql'));
 for(const [name,result]of Object.entries(preflight))if(name!=='data_counts')assert.equal(result,true,name);
 preservedBefore=await preserve();migration=await source(candidate);await db.exec(migration);preservedAfter=await preserve();
 postflight=await value(await source('supabase/ops/check-staff-social-shells-postflight.sql'));
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
after(async()=>{
 if(process.env.STAFF_SHELL_GATE_OUTPUT&&passed.length===16)await writeFile(process.env.STAFF_SHELL_GATE_OUTPUT,JSON.stringify({candidate,sha256:createHash('sha256').update(migration).digest('hex'),qaMode,testsPassed:passed.length,tests:passed,preflight,postflight,existingDataAndPoliciesPreserved:true,authProfileTriggerMatchedHostedQA:true,verifiedAt:new Date().toISOString()},null,2)+'\n');
 await db.close();
});

test('forward migration preserves every existing account, session, staff policy, provider trigger and unrelated function',async()=>{
 assert.deepEqual(preservedAfter,preservedBefore);
 assert.equal(postflight.registry.rows,0);assert.equal(postflight.registry.rls,true);
 for(const fn of postflight.functions){assert.equal(fn.owner,'postgres');assert.equal(fn.anon_execute,false);assert.equal(fn.authenticated_execute,false);}
 assert.equal((await profile(ids.owner)).deactivated_at,null);assert.equal((await profile(ids.legacy)).deactivated_at,null);
});

test('reservation marks only its fresh UUID, then the real Auth trigger creates an already hidden shell',async()=>{
 const r=await reserve(),id=r.job.auth_user_id;
 assert.equal(await profile(id),null);
 assert.equal(await value('select count(*)::int from admin_ops.staff_social_shells where user_id=$1 and command_key=$2 and provision_id=$3',[id,r.key,r.job.provision_id]),1);
 await createAuth(r.job);
 const shell=await profile(id);assert.ok(shell.deactivated_at);assert.equal(shell.profile_visibility,'private');assert.equal(shell.push_token,null);
 assert.equal(await countStaff(id),0,'Reservation and Auth creation alone cannot grant a staff role');
 assert.equal(await as('authenticated',ids.member,'select count(*)::int from public.profiles where id=$1',[id],sessions.member),0);
 assert.equal(await value('select banned_until from auth.users where id=$1',[id]),null);
});

test('pending staff cannot reactivate the shell or perform social posts, follows, presence, and RPC writes',async()=>{
 const r=await reserve(),id=r.job.auth_user_id;await createAuth(r.job);
 const operations=[
  ['update public.profiles set deactivated_at=null where id=$1',[id]],
  ["insert into public.posts(user_id,body,scope) values($1,'Forbidden staff post','global') returning id",[id]],
  ['insert into public.follows(follower_id,following_id) values($1,$2) returning follower_id',[id,ids.member]],
  ['update public.user_presence set is_online=true where user_id=$1',[id]],
  ['select public.save_push_token($1,$2)', [id,'ExponentPushToken[staff-shell]']],
 ];
 for(const [sql,args]of operations)await assert.rejects(as('authenticated',id,sql,args),/STAFF_SOCIAL_WRITES_DISABLED/);
 assert.ok((await profile(id)).deactivated_at);
});

test('user and service-owned Storage upload attempts cannot give a reserved staff shell social media',async()=>{
 const r=await reserve(),id=r.job.auth_user_id;await createAuth(r.job);
 const sql="insert into storage.objects(bucket_id,name,owner_id,owner) values('avatars',$1,$2,$3) returning id",args=[`${id}/avatar.jpg`,id,id];
 await assert.rejects(as('authenticated',id,sql,args),/STAFF_SOCIAL_WRITES_DISABLED/);
 await assert.rejects(db.query(sql,args),/STAFF_SOCIAL_WRITES_DISABLED/);
});

test('finish grants the reviewed role while preserving hidden profile and valid AAL1/AAL2 staff operations',async()=>{
 const r=await reserve(),id=r.job.auth_user_id;await createAuth(r.job);const stamp=(await profile(id)).deactivated_at;
 assert.equal((await finish(r)).complete,true);assert.equal(await countStaff(id),1);assert.equal((await profile(id)).deactivated_at,stamp);
 const session=randomUUID();await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[session,id]);
 for(const aal of ['aal1','aal2']){
  await q('update auth.sessions set aal=$1 where id=$2',[aal,session]);
  assert.equal(await svc('select public.triniti_admin_session_check($1,$2)',[id,session]),true);
  assert.equal(await svc('select admin_ops.require_session($1,$2,$3)',[id,session,'support']),'support_agent');
 }
 await assert.rejects(svc('select admin_ops.require_session($1,$2,$3)',[id,session,'staff_manage']),/ADMIN_PERMISSION_DENIED/);
 assert.equal(await value('select banned_until from auth.users where id=$1',[id]),null);
});

test('finished staff can operate the support desk through the protected server while social writes stay disabled',async()=>{
 const r=await reserve(),id=r.job.auth_user_id;await createAuth(r.job);await finish(r);
 const session=randomUUID();await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[session,id]);
 const ticket=await value("insert into public.support_tickets(user_id,subject) values($1,'Staff isolation fixture') returning id",[ids.member]);
 const result=await svc('select public.triniti_platinum_admin_command($1,$2,$3,$4,$5)',[id,session,randomUUID(),'sendTicketReply',{tid:ticket,body:'A staff reply from the protected operations server.'}]);
 assert.equal(result.success,true);
 await assert.rejects(as('authenticated',id,"insert into public.posts(user_id,body,scope) values($1,'Not a social account','global') returning id",[id],session),/STAFF_SOCIAL_WRITES_DISABLED/);
});

test('expired and revoked staff sessions still fail independently of shell deactivation',async()=>{
 const r=await reserve(),id=r.job.auth_user_id;await createAuth(r.job);await finish(r);
 const session=randomUUID();await q("insert into auth.sessions(id,user_id,aal,not_after) values($1,$2,'aal1',now()-interval '1 second')",[session,id]);
 assert.equal(await svc('select public.triniti_admin_session_check($1,$2)',[id,session]),false);
 await assert.rejects(svc('select admin_ops.require_session($1,$2,$3)',[id,session,'support']),/ACTIVE_ADMIN_SESSION_REQUIRED/);
 await q('delete from auth.sessions where id=$1',[session]);
 await assert.rejects(svc('select admin_ops.require_session($1,$2,$3)',[id,session,'support']),/ACTIVE_ADMIN_SESSION_REQUIRED/);
});

test('wrong provider metadata cannot create an active profile or finish a staff reservation',async()=>{
 const r=await reserve(),id=r.job.auth_user_id;await createAuth(r.job,{metadata:{triniti_provision_id:randomUUID()}});
 assert.equal(await profile(id),null);
 await assert.rejects(finish(r),/PROVISION_IDENTITY_MISMATCH/);assert.equal(await countStaff(id),0);
 await assert.rejects(as('authenticated',id,"insert into public.profiles(id,email) values($1,$2) returning id",[id,r.job.email]),/STAFF_SOCIAL_WRITES_DISABLED/);
 await q('update auth.users set raw_app_meta_data=$1 where id=$2',[{triniti_provision_id:r.job.provision_id},id]);
 assert.equal((await finish(r)).complete,true);assert.ok((await profile(id)).deactivated_at);
});

test('a failed finish leaves the provider-created profile hidden, grants no staff access, and can retry its reservation',async()=>{
 const r=await reserve(),id=r.job.auth_user_id;await createAuth(r.job);
 await db.exec(`create function public.staff_shell_test_failure() returns trigger language plpgsql as $$begin if new.action='inviteStaff' then raise exception 'SYNTHETIC_AUDIT_FAILURE';end if;return new;end$$;
  create trigger staff_shell_test_failure before insert on public.admin_audit_log for each row execute function public.staff_shell_test_failure()`);
 await assert.rejects(finish(r),/SYNTHETIC_AUDIT_FAILURE/);
 assert.equal(await countStaff(id),0);assert.ok((await profile(id)).deactivated_at);
 assert.equal(await value('select completed_at from admin_ops.provisions where command_key=$1',[r.key]),null);
 await db.exec('drop trigger staff_shell_test_failure on public.admin_audit_log;drop function public.staff_shell_test_failure()');
 assert.equal((await finish(r)).complete,true);
});

test('replays do not duplicate shell markers, roles, audit entries, or reset the original deactivation time',async()=>{
 const r=await reserve(),id=r.job.auth_user_id;await createAuth(r.job);const first=await finish(r),stamp=(await profile(id)).deactivated_at;
 assert.deepEqual(await finish(r),first);assert.equal((await provision('staff',r.payload,'reserve',r.key)).complete,true);
 assert.equal(await value('select count(*)::int from admin_ops.staff_social_shells where user_id=$1',[id]),1);
 assert.equal(await countStaff(id),1);assert.equal((await profile(id)).deactivated_at,stamp);
 assert.equal(await value("select count(*)::int from public.admin_audit_log where action='inviteStaff' and target_id=$1",[id]),1);
 await q('delete from auth.sessions where id=$1',[sessions.owner]);
 await assert.rejects(finish(r),/ACTIVE_ADMIN_SESSION_REQUIRED/);
});

test('service metadata edits work, but service or ordinary admin restoration cannot activate a staff social profile',async()=>{
 const r=await reserve(),id=r.job.auth_user_id;await createAuth(r.job);await finish(r);
 await q("update public.profiles set full_name='Operations colleague' where id=$1",[id]);
 assert.equal((await profile(id)).full_name,'Operations colleague');
 await assert.rejects(svc('update public.profiles set deactivated_at=null where id=$1 returning id',[id]),/STAFF_SOCIAL_PROFILE_REQUIRED/);
 await assert.rejects(svc('select public.triniti_platinum_admin_command($1,$2,$3,$4,$5)',[ids.owner,sessions.owner,randomUUID(),'restoreUser',{id}]),/STAFF_SOCIAL_PROFILE_REQUIRED/);
 await q('update public.admin_users set active=false where user_id=$1',[id]);
 await assert.rejects(as('authenticated',id,'update public.profiles set deactivated_at=null where id=$1',[id]),/STAFF_SOCIAL_WRITES_DISABLED/);
});

test('business provisioning stays an active delegated profile and does not acquire a staff marker',async()=>{
 const application=await value("insert into public.business_applications(applicant_id,company_name,description,contact_email,desired_username,category) values($1,'Synthetic Business','Only a fixture','business@example.test','shell_business','education') returning id",[ids.member]);
 const key=randomUUID(),job=await provision('business',{id:application},'reserve',key);await createAuth(job);
 assert.equal((await profile(job.auth_user_id)).deactivated_at,null);
 assert.equal((await provision('business',{id:application},'finish',key)).complete,true);
 const business=await profile(job.auth_user_id);assert.equal(business.deactivated_at,null);assert.equal(business.account_type,'business');
 assert.equal(await value('select count(*)::int from admin_ops.staff_social_shells where user_id=$1',[job.auth_user_id]),0);
 assert.equal(await value("select role from public.business_members where business_id=$1 and member_id=$2",[job.auth_user_id,ids.member]),'owner');
 assert.equal(await as('authenticated',ids.member,"select public.can_act_as($1)",[job.auth_user_id],sessions.member),true);
 assert.equal(await countStaff(job.auth_user_id),0);
});

test('existing staff, existing member writes and an older completed reservation retain their original state',async()=>{
 assert.equal(await svc('select public.triniti_admin_session_check($1,$2)',[ids.owner,sessions.owner]),true);
 assert.equal(await as('authenticated',ids.member,"insert into public.posts(user_id,body,scope) values($1,'An ordinary member still posts','global') returning user_id",[ids.member],sessions.member),ids.member);
 assert.equal(await value('select count(*)::int from admin_ops.staff_social_shells where user_id=any($1::uuid[])',[[ids.owner,ids.legacy,legacyReservation.job.auth_user_id]]),0);
 assert.equal((await finish(legacyReservation)).complete,true);
 assert.equal((await profile(legacyReservation.job.auth_user_id)).deactivated_at,null,'Do not retroactively convert a completed reservation/profile');
 assert.equal((await profile(ids.owner)).deactivated_at,null);assert.equal((await profile(ids.legacy)).deactivated_at,null);
});

test('shell records and trigger functions deny direct app and service access',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  for(const sql of ['select * from admin_ops.staff_social_shells','delete from admin_ops.staff_social_shells','truncate admin_ops.staff_social_shells'])await assert.rejects(as(role,ids.member,sql),/permission denied/);
  for(const signature of ['account_erasure.assert_writable(uuid)','admin_ops.enforce_staff_social_shell()'])assert.equal(await value('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 }
 for(const role of ['anon','authenticated'])assert.equal(await value('select has_function_privilege($1,\'public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)\',\'execute\')',[role]),false);
 assert.equal(await value("select has_function_privilege('service_role','public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)','execute')"),true);
});

test('ordinary account-erasure and missing-identity fences remain effective after adding the staff boundary',async()=>{
 await db.exec("update account_erasure.worker set secret_digest=extensions.digest('synthetic-staff-shell-worker','sha256'),last_seen_at=clock_timestamp()");
 await as('authenticated',ids.member,'select public.request_account_erasure($1,$2)',[randomUUID(),'c'.repeat(64)],sessions.member);
 await assert.rejects(as('authenticated',ids.member,"update public.profiles set full_name='Cannot bypass erasure' where id=$1",[ids.member],sessions.member),/ACCOUNT_ERASURE_IN_PROGRESS/);
 const missing=randomUUID();
 await assert.rejects(as('authenticated',missing,'insert into public.follows(follower_id,following_id) values($1,$2)',[missing,ids.owner]),/ACCOUNT_ERASURE_IDENTITY_UNAVAILABLE/);
});

test('repeat application, unexpected grants and unfinished legacy staff setup fail closed at preflight',async()=>{
 const guard=migration.match(/do \$preflight\$[\s\S]*?end \$preflight\$;/)[0];
 await assert.rejects(as('postgres',null,guard),/STAFF_SHELL_TARGET_ALREADY_EXISTS/);
 await db.exec('drop trigger enforce_staff_social_shell on public.profiles;drop function admin_ops.enforce_staff_social_shell();drop table admin_ops.staff_social_shells');
 await db.exec(originalProvision);await db.exec(originalGuard);
 await db.exec('grant execute on function public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text) to authenticated');
 await assert.rejects(as('postgres',null,guard),/STAFF_SHELL_BASELINE_DRIFT/);
 assert.equal(await value("select to_regclass('admin_ops.staff_social_shells')"),null);
 await db.exec('revoke execute on function public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text) from authenticated');
 await reserve();
 await assert.rejects(as('postgres',null,guard),/STAFF_SHELL_PENDING_STAFF_REVIEW_REQUIRED/);
});
