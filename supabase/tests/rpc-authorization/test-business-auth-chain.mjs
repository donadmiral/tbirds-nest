import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test as nodeTest} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {source} from './deployed-media-baseline.mjs';
import {loadBusinessAuthBaseline} from './business-auth-fixture.mjs';

const db=new PGlite({extensions}),qaMode=process.env.PLATINUM_QA_BUSINESS_AUTH==='1';
const candidate='supabase/migrations/20261030034752_business_bound_auth_sessions.sql';
const ids=Object.fromEntries(['owner','stranger','staff','business','other_business','banned_business'].map(n=>[n,randomUUID()]));
const personalSessions=Object.fromEntries(['owner','stranger','staff'].map(n=>[n,randomUUID()]));
const hash=s=>createHash('sha256').update(s).digest('hex'),proof=hash('synthetic-device-proof');
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await q(sql,args))[0]||{})[0];
let migration,beforeRows,afterRows,metadata,baselineAnonProfiles,sessionCutoverRejected=false,existingHookRejected=false,registered=0;const passed=[];
const test=(name,fn)=>{registered++;nodeTest(name,async()=>{await fn();passed.push(name);});};
async function as(user,session,sql,args=[],role='authenticated',extra={}){
 await db.exec('savepoint request');
 try{
  await db.exec(`set local role ${role}`);
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[user||'',role,JSON.stringify({sub:user||null,session_id:session||null,role,is_anonymous:false,...extra})]);
  const result=await value(sql,args);await db.exec('reset role');
  await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
  await db.exec('release savepoint request');return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const svc=(sql,args=[])=>as(null,null,sql,args,'service_role');
const owner=(bootstrap=false,device=randomUUID(),user=ids.owner,session=personalSessions.owner,business=ids.business)=>svc('select public.triniti_business_owner_access($1,$2,null,$3,$4,$5,$6,$7)',[user,session,device,proof,'Synthetic test device',bootstrap,business]);
const finish=(grant,sid,deviceProof=proof)=>svc('select public.triniti_business_finish_signin($1,$2,$3,$4)',[grant.grant_id,grant.business_id,sid,deviceProof]);
const check=(handle,code,device,deviceProof=proof)=>svc('select public.triniti_business_signin_check($1,$2,$3,$4,$5)',[handle,hash(code),device,deviceProof,'Synthetic test device']);
const allowed=(user,sid)=>as(user,sid,'select public.business_session_allowed()');
async function issue(grant){const sid=randomUUID();await q("insert into auth.sessions(id,user_id,aal,created_at) values($1,$2,'aal1',clock_timestamp())",[sid,grant.business_id]);return{sid,result:await finish(grant,sid)};}
async function bootstrap(){const device=randomUUID(),grant=await owner(true,device);assert.equal(grant.allowed,true,JSON.stringify(grant));return{...await issue(grant),grant,device};}
async function member(role='editor',boot=null){
 boot??=await bootstrap();const id=randomUUID(),device=randomUUID(),code='SYNTHETIC-TEAM-CODE';
 await q('insert into public.business_access_members(id,business_id,display_name,role,code_hash) values($1,$2,$3,$4,$5)',[id,ids.business,'Synthetic member',role,hash(code)]);
 return{...boot,id,memberDevice:device,code};
}
async function memberSession(boot=null){const m=await member('editor',boot);assert.equal((await check('guard_business',m.code,m.memberDevice)).error,'DEVICE_APPROVAL_REQUIRED');await q("update public.business_devices set status='approved' where business_id=$1 and device_id=$2",[ids.business,m.memberDevice]);const grant=await check('guard_business',m.code,m.memberDevice);return{...m,memberGrant:grant,memberSession:await issue(grant)};}
async function rows(){return{users:await q('select to_jsonb(t) row from auth.users t order by id'),profiles:await q('select to_jsonb(t) row from public.profiles t order by id'),sessions:await q('select to_jsonb(t) row from auth.sessions t order by id'),objects:await q('select to_jsonb(t) row from storage.objects t order by id'),buckets:await q('select to_jsonb(t) row from storage.buckets t order by id')};}

before(async()=>{
 await loadBusinessAuthBaseline(db,qaMode);
 for(const [name,id]of Object.entries(ids)){
  await q('insert into auth.users(id,email) values($1,$2)',[id,`guard-${name}@example.invalid`]);
  await q('update public.profiles set username=$1,full_name=$1,account_type=$2 where id=$3',[`guard_${name}`,name.includes('business')?'business':'personal',id]);
 }
 for(const [name,sid]of Object.entries(personalSessions))await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sid,ids[name]]);
 await q("insert into public.admin_users(user_id,role) values($1,'super_admin')",[ids.staff]);
 await q("update auth.sessions set aal='aal2' where id=$1",[personalSessions.staff]);
 await q("insert into public.business_members(business_id,member_id,role) values($1,$2,'owner'),($3,$2,'owner')",[ids.business,ids.owner,ids.banned_business]);
 await q("update auth.users set banned_until='infinity' where id=$1",[ids.banned_business]);
 await db.exec('begin');baselineAnonProfiles=await as(null,null,"select count(*)::int from public.profiles where account_type='business'",[],'anon');await db.exec('rollback');
 migration=await source(candidate);beforeRows=await rows();
 await db.exec('begin');await q('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',[randomUUID(),ids.business]);
 await assert.rejects(db.exec(migration),/BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED/);await db.exec('rollback');sessionCutoverRejected=true;
 await db.exec("begin;alter role authenticator set pgrst.db_pre_request='public.existing_custom_guard'");
 await assert.rejects(db.exec(migration),/BUSINESS_AUTH_EXISTING_REQUEST_HOOK_REVIEW/);await db.exec('rollback');existingHookRejected=true;
 await db.exec(migration);afterRows=await rows();
 metadata={functions:await q("select p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.proconfig,md5(pg_get_functiondef(p.oid)) hash,has_function_privilege('anon',p.oid,'execute') anon_execute,has_function_privilege('authenticated',p.oid,'execute') app_execute,has_function_privilege('service_role',p.oid,'execute') service_execute from pg_proc p where p.pronamespace='business_auth'::regnamespace or p.proname in('business_session_allowed','business_auth_request_guard','triniti_business_signin_check','triniti_business_owner_access','triniti_business_finish_signin','triniti_business_cancel_signin') order by 1"),tables:await q("select c.relname,c.relrowsecurity,(select count(*)::int from pg_policy p where p.polrelid=c.oid) policies,has_table_privilege('authenticated',c.oid,'select,insert,update,delete') app_access,has_table_privilege('service_role',c.oid,'select,insert,update,delete') service_access from pg_class c where c.relnamespace='business_auth'::regnamespace and relkind='r' order by 1"),guardedTables:await value("select count(*)::int from pg_policy where polname='business_session_required'")};
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
after(async()=>{if(process.env.BUSINESS_AUTH_GATE_OUTPUT&&passed.length===registered)await writeFile(process.env.BUSINESS_AUTH_GATE_OUTPUT,JSON.stringify({candidate,sha256:hash(migration),qaMode,testsPassed:passed.length,tests:passed,allPassed:true,metadata,existingRowsPreserved:true,verifiedAt:new Date().toISOString(),fixture:'Local SQL provider-contract fixture; real hosted Auth token issuance is a separate acceptance step.'},null,2)+'\n');await db.close();});

test('installation preserves existing Auth, profiles, sessions, objects and bucket privacy',()=>assert.deepEqual(afterRows,beforeRows));
test('cutover aborts before touching an existing business session or replacing a custom request hook',()=>{assert.equal(sessionCutoverRejected,true);assert.equal(existingHookRejected,true);});
test('seven internal tables and every helper are private; only four provider contracts allow service execution',()=>{
 assert.equal(metadata.tables.length,7);for(const t of metadata.tables){assert.equal(t.relrowsecurity,true);assert.equal(t.policies,0);assert.equal(t.app_access,false);assert.equal(t.service_access,false);}
 for(const f of metadata.functions){assert.equal(f.owner,'postgres');assert.deepEqual(f.proconfig,['search_path=""']);const guard=f.signature.startsWith('business_session_allowed')||f.signature.startsWith('business_auth_request_guard');assert.equal(f.anon_execute,guard);assert.equal(f.app_execute,guard);assert.equal(f.service_execute,guard||f.signature.startsWith('triniti_business_'));}
 assert.ok(metadata.guardedTables>100);
});
test('personal, staff and anonymous sessions retain the existing request and RLS behavior',async()=>{
 for(const name of ['owner','stranger','staff']){assert.equal(await allowed(ids[name],personalSessions[name]),true);await as(ids[name],personalSessions[name],'select public.business_auth_request_guard()');}
 assert.equal(await as(null,null,'select public.business_session_allowed()',[],'anon'),true);
 assert.equal(await as(null,null,"select count(*)::int from public.profiles where account_type='business'",[],'anon'),baselineAnonProfiles);
});
test('a business token without an actual bound session fails request hook and direct RLS',async()=>{
 const sid=randomUUID();await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,ids.business]);
 assert.equal(await allowed(ids.business,sid),false);await assert.rejects(as(ids.business,sid,'select public.business_auth_request_guard()'),/BUSINESS_SESSION_REQUIRED/);
 assert.equal(await as(ids.business,sid,'select count(*)::int from public.profiles'),0);
 assert.equal(await as(ids.business,sid,'select public.studio_role()'),null);
 await assert.rejects(as(ids.business,sid,'select public.studio_newsroom_list()'),/WORKFLOW_ACTIVE_SESSION_REQUIRED/);
});
test('owner bootstrap is explicit, current personal ownership is required and one seat is created',async()=>{
 assert.equal((await owner()).error,'OWNER_BOOTSTRAP_REQUIRED');assert.equal(await value('select count(*)::int from public.business_access_members'),0);
 assert.equal((await owner(true,randomUUID(),ids.stranger,personalSessions.stranger)).error,'ACTIVE_OWNER_SESSION_REQUIRED');
 const b=await bootstrap();assert.equal(b.result.role,'owner');assert.equal(await allowed(ids.business,b.sid),true);
 assert.equal(await value('select count(*)::int from business_auth.owner_seats'),1);assert.equal(await value("select count(*)::int from public.business_devices where status='approved'"),1);
 const again=await owner(false,b.device);assert.equal(again.member_id,b.result.member_id);assert.equal(await value('select count(*)::int from public.business_access_members'),1);
});
test('owner launch rejects substituted, deleted, expired, deactivated and banned personal sessions',async()=>{
 assert.equal((await owner(true,randomUUID(),ids.owner,personalSessions.stranger)).error,'ACTIVE_OWNER_SESSION_REQUIRED');
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[personalSessions.owner]);assert.equal((await owner(true)).error,'ACTIVE_OWNER_SESSION_REQUIRED');
 await q('update auth.sessions set not_after=null where id=$1',[personalSessions.owner]);await q('update public.profiles set deactivated_at=now() where id=$1',[ids.owner]);assert.equal((await owner(true)).error,'ACTIVE_OWNER_SESSION_REQUIRED');
});
test('previously banned or deactivated businesses remain unavailable and are never enabled',async()=>{
 assert.equal((await owner(true,randomUUID(),ids.owner,personalSessions.owner,ids.banned_business)).error,'BUSINESS_ACCOUNT_UNAVAILABLE');
 assert.equal(await value('select banned_until::text from auth.users where id=$1',[ids.banned_business]),'infinity');
 await q('update public.profiles set deactivated_at=now() where id=$1',[ids.business]);assert.equal((await owner(true)).error,'BUSINESS_ACCOUNT_UNAVAILABLE');
});
test('ordinary member devices are pending and need explicit approval before a grant exists',async()=>{
 const m=await member();assert.equal((await check('guard_business',m.code,m.memberDevice)).error,'DEVICE_APPROVAL_REQUIRED');
 assert.equal(await value('select count(*)::int from business_auth.grants'),1);
 const device=await value('select id from public.business_devices where device_id=$1',[m.memberDevice]);
 await as(ids.business,m.sid,'select public.studio_set_device($1,$2)',[device,'approve']);
 const grant=await check('guard_business',m.code,m.memberDevice);assert.equal(grant.allowed,true);assert.equal(grant.member_id,m.id);
 const result=await issue(grant);assert.equal(result.result.role,'editor');assert.equal(await allowed(ids.business,result.sid),true);
});
test('first owner consent does not auto-approve subsequent or previously pending devices',async()=>{
 const b=await bootstrap(),device=randomUUID();assert.equal((await owner(true,device)).error,'DEVICE_APPROVAL_REQUIRED');
 assert.equal((await owner(true,device)).error,'DEVICE_APPROVAL_REQUIRED');assert.equal(await value("select count(*)::int from public.business_devices where status='approved'"),1);
});
test('device ID knowledge and forged proof cannot take over an approved or pending device',async()=>{
 const m=await memberSession();assert.equal((await check('guard_business',m.code,m.memberDevice,hash('forged'))).error,'ACCESS_REJECTED');
 const grant=await check('guard_business',m.code,m.memberDevice);const sid=randomUUID();await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,ids.business]);
 await assert.rejects(finish(grant,sid,hash('forged')),/BUSINESS_GRANT_REJECTED/);assert.equal(await allowed(ids.business,sid),false);
});
test('inactive seats and rotated codes cannot request or finish stale grants',async()=>{
 const m=await memberSession();const grant=await check('guard_business',m.code,m.memberDevice);await q('update public.business_access_members set code_hash=$1 where id=$2',[hash('NEW-CODE'),m.id]);
 assert.equal((await check('guard_business',m.code,m.memberDevice)).error,'ACCESS_REJECTED');assert.equal(await allowed(ids.business,m.memberSession.sid),false);
 const sid=randomUUID();await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,ids.business]);await assert.rejects(finish(grant,sid),/BUSINESS_GRANT_EXPIRED|BUSINESS_MEMBER_REVOKED/);
 await q('update public.business_access_members set active=false where id=$1',[m.id]);assert.equal((await check('guard_business','NEW-CODE',m.memberDevice)).error,'ACCESS_REJECTED');
});
test('a short-lived grant is single-use, exact-session retry is idempotent and expiry rejects',async()=>{
 const b=await bootstrap();assert.equal((await finish(b.grant,b.sid)).success,true);assert.equal(await value('select count(*)::int from public.business_signin_log'),1);
 const sid=randomUUID();await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,ids.business]);await assert.rejects(finish(b.grant,sid),/BUSINESS_GRANT_EXPIRED/);
 const grant=await owner(false,b.device);await q("update business_auth.grants set expires_at=clock_timestamp()-interval '1 second' where id=$1",[grant.grant_id]);await assert.rejects(finish(grant,sid),/BUSINESS_GRANT_EXPIRED/);
});
test('finish requires a newly issued real Auth session for the exact business',async()=>{
 const grant=await owner(true);await assert.rejects(finish(grant,personalSessions.owner),/BUSINESS_SESSION_MISMATCH/);
 const old=randomUUID();await q("insert into auth.sessions(id,user_id,created_at) values($1,$2,now()-interval '1 hour')",[old,ids.business]);await assert.rejects(finish(grant,old),/BUSINESS_SESSION_MISMATCH/);
 const foreign=randomUUID();await q('insert into auth.sessions(id,user_id) values($1,$2)',[foreign,ids.other_business]);await assert.rejects(finish(grant,foreign),/BUSINESS_SESSION_MISMATCH/);
});
test('session expiry is bounded by 24 hours and the actual personal owner session',async()=>{
 await q("update auth.sessions set not_after=now()+interval '20 minutes' where id=$1",[personalSessions.owner]);const b=await bootstrap();
 assert.equal(await value('select s.not_after<=p.not_after from auth.sessions s cross join auth.sessions p where s.id=$1 and p.id=$2',[b.sid,personalSessions.owner]),true);
 const m=await memberSession(b);assert.equal(await value("select not_after<=clock_timestamp()+interval '24 hours' from auth.sessions where id=$1",[m.memberSession.sid]),true);
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[m.memberSession.sid]);assert.equal(await allowed(ids.business,m.memberSession.sid),false);
});
test('refresh preserves the same actual session binding and a forged replacement session fails',async()=>{
 const b=await bootstrap();assert.equal(await allowed(ids.business,b.sid),true);
 assert.equal(await as(ids.business,b.sid,'select public.business_session_allowed()',[],'authenticated',{exp:Math.floor(Date.now()/1000)+7200,user_metadata:{role:'owner'}}),true);
 assert.equal(await allowed(ids.business,randomUUID()),false);assert.equal(await allowed(ids.other_business,b.sid),false);
});
test('member and device revocation delete real Auth sessions and prevent current JWT reads',async()=>{
 const m=await memberSession();await q('update public.business_access_members set active=false where id=$1',[m.id]);
 assert.equal(await value('select count(*)::int from auth.sessions where id=$1',[m.memberSession.sid]),0);assert.equal(await allowed(ids.business,m.memberSession.sid),false);
 await q("update public.business_devices set status='pending' where device_id=$1",[m.device]);assert.equal(await value('select count(*)::int from auth.sessions where id=$1',[m.sid]),0);assert.equal((await owner(false,m.device)).error,'DEVICE_BLOCKED');
});
test('removed devices stay blocked until an owner explicitly approves them again',async()=>{
 const m=await memberSession();const device=await value('select id from public.business_devices where device_id=$1',[m.memberDevice]);
 await as(ids.business,m.sid,'select public.studio_set_device($1,$2)',[device,'remove']);assert.equal((await check('guard_business',m.code,m.memberDevice)).error,'DEVICE_BLOCKED');
 await as(ids.business,m.sid,'select public.studio_set_device($1,$2)',[device,'approve']);assert.equal((await check('guard_business',m.code,m.memberDevice)).allowed,true);
});
test('personal sign-out deletes dependent business Auth sessions and bindings',async()=>{
 const b=await bootstrap();await q('delete from auth.sessions where id=$1',[personalSessions.owner]);assert.equal(await value('select count(*)::int from auth.sessions where id=$1',[b.sid]),0);assert.equal(await value('select count(*)::int from public.studio_session_members where session_id=$1',[b.sid]),0);assert.equal(await allowed(ids.business,b.sid),false);
});
test('ownership transfer revokes former owner access and only the current owner can bootstrap',async()=>{
 const b=await bootstrap();await q('update public.business_members set member_id=$1 where business_id=$2 and member_id=$3',[ids.stranger,ids.business,ids.owner]);
 assert.equal(await allowed(ids.business,b.sid),false);assert.equal((await owner(false,b.device)).error,'ACTIVE_OWNER_SESSION_REQUIRED');
 const next=await owner(true,randomUUID(),ids.stranger,personalSessions.stranger);assert.equal(next.error,'DEVICE_APPROVAL_REQUIRED');
 assert.equal(await value('select active from public.business_access_members where id=$1',[b.result.member_id]),false);
});
test('a bound seat cannot be replaced with another access code or direct session-table writes',async()=>{
 const m=await memberSession();await assert.rejects(as(ids.business,m.sid,'select public.studio_bind_member($1)',[m.code]),/BUSINESS_SEAT_SWITCH_REQUIRES_SIGNIN/);
 assert.equal((await as(ids.business,m.memberSession.sid,'select public.studio_bind_member($1)',[m.code])).member_id,m.id);
 await assert.rejects(as(ids.business,m.memberSession.sid,'update public.studio_session_members set member_id=$1 where session_id=$2',[m.result.member_id,m.memberSession.sid]),/permission denied/);
});
test('business profile reclassification and missing profile cannot escape the guard',async()=>{
 const b=await bootstrap();await q("update public.profiles set account_type='personal' where id=$1",[ids.business]);assert.equal(await allowed(ids.business,b.sid),false);
 assert.equal(await value('select count(*)::int from business_auth.accounts where business_id=$1',[ids.business]),1);
});
test('failed exchange cleanup only revokes its own fresh business session and expires its grant',async()=>{
 const b=await bootstrap();await svc('select public.triniti_business_cancel_signin($1,$2,$3)',[b.grant.grant_id,ids.business,personalSessions.owner]);assert.equal(await value('select count(*)::int from auth.sessions where id=$1',[personalSessions.owner]),1);
 await svc('select public.triniti_business_cancel_signin($1,$2,$3)',[b.grant.grant_id,ids.business,b.sid]);assert.equal(await value('select count(*)::int from auth.sessions where id=$1',[b.sid]),0);
});
test('rate limiting persists denied attempts and never grants an inactive or guessed seat',async()=>{
 const device=randomUUID();for(let n=0;n<12;n++)assert.equal((await check('guard_business','WRONG-CODE',device)).error,'ACCESS_REJECTED');assert.equal((await check('guard_business','WRONG-CODE',device)).error,'TRY_LATER');assert.equal(await value('select count(*)::int from business_auth.grants'),0);
});
test('app users and anonymous callers cannot invoke any provider contract or read device secrets',async()=>{
 for(const role of ['anon','authenticated']){await assert.rejects(as(ids.owner,personalSessions.owner,'select public.triniti_business_signin_check($1,$2,$3,$4,$5)',['guard_business',hash('x'),randomUUID(),proof,'x'],role),/permission denied/);await assert.rejects(as(ids.owner,personalSessions.owner,'select * from business_auth.device_keys',[],role),/permission denied/);}
});
test('media service redemption checks current business owner binding even when its own Auth session survives',async()=>{
 const b=await bootstrap(),bucket='post-media',path=`${ids.business}/guard-proof.jpg`,url=`https://example.supabase.co/storage/v1/object/public/${bucket}/${path}`;
 await q('insert into storage.objects(bucket_id,name,owner,owner_id,version) values($1,$2,$3::uuid,$3::uuid::text,$4)',[bucket,path,ids.business,randomUUID()]);
 const tickets=await as(ids.business,b.sid,"select jsonb_agg(t) from public.issue_content_media_delivery(null,$1) t",[[url]]);assert.ok(tickets?.length);
 const ticket=tickets[0],redeem=()=>svc('select public.resolve_media_delivery($1,$2,$3)',[ticket.token,ticket.bucket_id,ticket.object_path]);
 assert.ok(await redeem());
 // Expiring the principal has no delete trigger; the business Auth session
 // still exists. The byte proxy must check the live principal binding too.
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[personalSessions.owner]);
 assert.equal(await value('select count(*)::int from auth.sessions where id=$1',[b.sid]),1);assert.equal(await redeem(),null);
 assert.equal(await value('select auth.uid()'),null);
});
test('the actual reserve/create/finish contract supports an explicit bound owner launch with a synthetic provider',async()=>{
 const admin=ids.staff;
 const adminSession=await value('select id from auth.sessions where user_id=$1 limit 1',[admin]);
 const application=await value("insert into public.business_applications(applicant_id,company_name,description,contact_email,desired_username,category) values($1,'Synthetic Company','Synthetic provider contract','qa@example.invalid','guard_provisioned','education') returning id",[ids.owner]);
 const key=randomUUID(),args=[admin,adminSession,key,'business',{id:application}];
 const job=await svc('select public.triniti_admin_provision($1,$2,$3,$4,$5,$6)',[...args,'reserve']);
 assert.match(job.email,/@accounts\.platinumcircles\.invalid$/);
 await assert.rejects(svc('select public.triniti_admin_provision($1,$2,$3,$4,$5,$6)',[...args,'finish']),/PROVISION_IDENTITY_MISMATCH/);
 // This emulates Auth Admin createUser confirmation only in the isolated local
 // fixture. It does not establish hosted Auth/provider acceptance.
 await q('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)',[job.auth_user_id,job.email,{triniti_provision_id:job.provision_id}]);
 assert.equal((await svc('select public.triniti_admin_provision($1,$2,$3,$4,$5,$6)',[...args,'finish'])).complete,true);
 assert.equal(await value('select banned_until from auth.users where id=$1',[job.auth_user_id]),null);
 const device=randomUUID(),launch=[ids.owner,personalSessions.owner,application,device,proof,'Synthetic approved owner'];
 assert.equal((await svc('select public.triniti_business_owner_access($1,$2,$3,$4,$5,$6)',launch)).error,'OWNER_BOOTSTRAP_REQUIRED');
 const grant=await svc('select public.triniti_business_owner_access($1,$2,$3,$4,$5,$6,true)',launch);
 const issued=await issue(grant);assert.equal(issued.result.role,'owner');assert.equal(await allowed(job.auth_user_id,issued.sid),true);
});
