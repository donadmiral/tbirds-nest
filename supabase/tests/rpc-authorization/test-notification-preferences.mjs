import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {source} from './deployed-media-baseline.mjs';
import {loadBusinessAuthBaseline} from './business-auth-fixture.mjs';

const db=new PGlite({extensions});
const bound=process.env.NOTIFICATION_BUSINESS_FIXTURE==='1';
const candidate='supabase/migrations/20261031004936_notification_preferences_and_call_push_authorization.sql';
const dedupCandidate='supabase/migrations/20261031005240_notification_call_dispatch_deduplication.sql';
const originCandidate='supabase/migrations/20261031010104_notification_dispatch_current_authorization.sql';
const ids=Object.fromEntries(['owner','other','stranger','business'].map(name=>[name,randomUUID()]));
const sessions=Object.fromEntries(Object.keys(ids).map(name=>[name,randomUUID()]));
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await q(sql,args))[0]||{})[0];
let beforeRows,afterRows,migration;
async function as(name,sql,args=[],role='authenticated',extra={}){
 await db.exec('savepoint request');
 try{
  // Captured legacy membership helpers SET LOCAL row_security=off. Hosted
  // PostgREST starts a new transaction per HTTP request; this savepoint-based
  // fixture must restore that request default between simulated requests.
  await db.exec(`set local row_security=on;set local role ${role}`);
  const claims={sub:ids[name]||null,role,session_id:sessions[name]||null,is_anonymous:false,...extra};
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[claims.sub||'',role,JSON.stringify(claims)]);
  const result=await value(sql,args);await db.exec('reset role;set local row_security=on');
  await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
  await db.exec('release savepoint request');return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const set=(key,enabled,name='owner',extra={})=>as(name,'select public.set_notification_preference($1,$2)',[key,enabled],'authenticated',extra);
const authorize=(call,name='owner',extra={})=>as(name,'select public.authorize_call_push($1)',[call],'authenticated',extra);
const badge=(name='owner')=>as(null,'select public.get_notification_badge_count($1)',[ids[name]||randomUUID()],'service_role');
const claim=(id,recipient='other')=>as(null,'select public.claim_call_push_dispatch($1,$2)',[id,ids[recipient]||randomUUID()],'service_role');
const dispatchAllowed=(id,recipient='other')=>as(null,'select public.call_push_dispatch_allowed($1,$2)',[id,ids[recipient]||randomUUID()],'service_role');
async function call(options={}){
 return as(options.initiator||'owner',"insert into public.call_sessions(initiator_id,receiver_id,conversation_id,is_group_call,call_type,status) values($1,$2,$3,$4,'voice','ringing') returning id",[ids[options.initiator||'owner'],options.group?null:ids[options.receiver||'other'],options.conversation||null,options.group||false],options.manual?'service_role':'authenticated',options.claims||{});
}
const dm=()=>value('insert into public.conversations(user_1,user_2) values($1,$2) returning id',[ids.owner,ids.other]);
async function group(){
 const id=await value("insert into public.conversations(user_1,is_group,group_name) values($1,true,'Synthetic QA group') returning id",[ids.owner]);
 await q("insert into public.conversation_members(conversation_id,user_id,last_read_at) values($1,$2,now()-interval '1 hour'),($1,$3,now()-interval '1 hour')",[id,ids.owner,ids.other]);return id;
}
const message=(conversation,receiver='owner',sender='other')=>value("insert into public.messages(conversation_id,sender_id,receiver_id,text) values($1,$2,$3,'Synthetic unread fixture') returning id",[conversation,ids[sender],receiver?ids[receiver]:null]);

before(async()=>{
 await loadBusinessAuthBaseline(db,true);
 const callBaseline=JSON.parse(await source('supabase/tests/rpc-authorization/notification-call-baseline-20261031.json'));
 for(const f of callBaseline.functions){await db.exec(f.definition);assert.equal(await value('select md5(pg_get_functiondef(to_regprocedure($1)))',[`public.${f.signature}`]),f.md5);}
 for(const definition of callBaseline.triggers){const name=/CREATE TRIGGER (\w+)/.exec(definition)[1];await db.exec(`drop trigger if exists ${name} on public.call_sessions;${definition}`);}
 if(bound)await db.exec(await source('supabase/migrations/20261030034752_business_bound_auth_sessions.sql'));
 for(const [name,id]of Object.entries(ids)){
  await q('insert into auth.users(id,email) values($1,$2)',[id,`notification-${name}@example.invalid`]);
  await q("update public.profiles set username=$1,account_type=$2,notif_prefs=$3,notif_messages=false,notif_connections=false,notif_jobs=true where id=$4",[`notification_${name}`,name==='business'?'business':'personal',JSON.stringify({like:false,comments:true,legacy_test:true}),id]);
  await q("insert into auth.sessions(id,user_id,aal,created_at) values($1,$2,'aal1',clock_timestamp())",[sessions[name],id]);
 }
 beforeRows=await q('select to_jsonb(p) row from public.profiles p order by id');
 migration=await source(candidate);await db.exec(migration);await db.exec(await source(dedupCandidate));await db.exec(await source(originCandidate));
 afterRows=await q('select to_jsonb(p) row from public.profiles p order by id');
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
after(async()=>{
 if(process.env.NOTIFICATION_GATE_OUTPUT)await writeFile(process.env.NOTIFICATION_GATE_OUTPUT,JSON.stringify({candidate,sha256:createHash('sha256').update(migration).digest('hex'),businessBoundFixture:bound,hostedWrites:false,verifiedAt:new Date().toISOString(),scope:'Exact QA baseline plus optional real business SQL migration; local Auth/session/Storage fixtures. No provider push is sent.'},null,2)+'\n');
 await db.close();
});

test('installation preserves all profiles and explicitly scopes every new function',async()=>{
 assert.deepEqual(afterRows,beforeRows);
 const rows=await q("select p.proname,p.proconfig,pg_get_userbyid(p.proowner) owner,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') app,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.oid=any(array['public.set_notification_preference(text,boolean)'::regprocedure,'public.authorize_call_push(uuid)'::regprocedure,'public.get_notification_badge_count(uuid)'::regprocedure])");
 assert.equal(rows.length,3);for(const f of rows){assert.equal(f.owner,'postgres');assert.deepEqual(f.proconfig,['search_path=""']);assert.equal(f.anon,false);assert.equal(f.app,f.proname!=='get_notification_badge_count');assert.equal(f.service,f.proname==='get_notification_badge_count');}
});
test('a preference write changes only the authenticated owner and preserves legacy values',async()=>{
 const other=await value('select notif_prefs from public.profiles where id=$1',[ids.other]);
 assert.deepEqual(await set('messages',true),{like:false,comments:true,legacy_test:true,messages:true});
 assert.deepEqual(await value('select notif_prefs from public.profiles where id=$1',[ids.other]),other);
 assert.deepEqual((await q('select notif_messages,notif_connections,notif_jobs from public.profiles where id=$1',[ids.owner]))[0],{notif_messages:false,notif_connections:false,notif_jobs:true});
});
test('the persisted master switch preserves individual categories through off and on',async()=>{
 await set('messages',true);await set('calls',false);const off=await set('all',false),on=await set('all',true);
 assert.equal(off.all,false);assert.deepEqual(on,{...off,all:true});assert.equal(on.messages,true);assert.equal(on.calls,false);
});
test('successive patches to independent keys merge onto current server state',async()=>{
 await set('likes',true);await set('jobs',false);const result=await set('account',true);assert.equal(result.likes,true);assert.equal(result.jobs,false);assert.equal(result.account,true);assert.equal(result.comments,true);
});
test('all twelve whitelisted keys accept exact booleans and return the full document',async()=>{
 for(const key of ['all','messages','message_reactions','calls','likes','comments','mentions','followers','updates','jobs','payments','account'])assert.equal((await set(key,false))[key],false);
});
test('unknown keys, null values and missing identity cannot mutate preferences',async()=>{
 for(const [key,enabled]of [['__proto__',true],['recipient_id',true],['messages',null],[null,true]])await assert.rejects(set(key,enabled),/INVALID_NOTIFICATION_PREFERENCE/);
 await assert.rejects(as(null,'select public.set_notification_preference($1,$2)',['all',false]),/MEDIA_SESSION_REQUIRED/);
});
test('anon and service roles cannot call owner preference or call authorization contracts',async()=>{
 for(const role of ['anon','service_role'])for(const sql of ["select public.set_notification_preference('all',false)",'select public.authorize_call_push(null)'])await assert.rejects(as('owner',sql,[],role),/permission denied/);
});
test('forged, anonymous, expired and revoked Auth sessions cannot authorize a preference write',async()=>{
 for(const extra of [{session_id:randomUUID()},{session_id:sessions.other},{session_id:'not-a-uuid'},{is_anonymous:true}])await assert.rejects(set('all',false,'owner',extra),/MEDIA_SESSION_REQUIRED/);
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessions.owner]);await assert.rejects(set('all',false),/MEDIA_SESSION_REQUIRED/);
 await q('delete from auth.sessions where id=$1',[sessions.owner]);await assert.rejects(set('all',false),/MEDIA_SESSION_REQUIRED/);
});
test('banned, deleted and deactivated identities fail closed',async()=>{
 await q("update auth.users set banned_until='infinity' where id=$1",[ids.owner]);await assert.rejects(set('all',false),/MEDIA_SESSION_REQUIRED/);
 await q('update auth.users set banned_until=null,deleted_at=now() where id=$1',[ids.owner]);await assert.rejects(set('all',false),/MEDIA_SESSION_REQUIRED/);
 await q('update auth.users set deleted_at=null where id=$1',[ids.owner]);await q('update public.profiles set deactivated_at=now() where id=$1',[ids.owner]);await assert.rejects(set('all',false),/ACTIVE_PROFILE_REQUIRED/);
});
test('business identities without a valid binding cannot change settings or authorize calls',async()=>{
 await assert.rejects(set('all',false,'business'),/BUSINESS_SESSION_REQUIRED/);await assert.rejects(call({initiator:'business'}),/BUSINESS_SESSION_REQUIRED|row-level security/);
});
test('a live active initiator can authorize an unexpired direct call only for its own call id',async()=>{
 const id=await call();assert.equal(await authorize(id),true);assert.equal(await authorize(id,'other'),false);assert.equal(await authorize(id,'stranger'),false);assert.equal(await authorize(randomUUID()),false);
});
test('call authorization independently rejects anonymous, expired and mismatched sessions',async()=>{
 const id=await call();for(const extra of [{session_id:randomUUID()},{session_id:sessions.other},{is_anonymous:true}])await assert.rejects(authorize(id,'owner',extra),/MEDIA_SESSION_REQUIRED/);
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessions.owner]);await assert.rejects(authorize(id),/MEDIA_SESSION_REQUIRED/);
});
test('non-ringing, ended, expired, missing-expiry, future and artificially extended calls are denied',async()=>{
 const id=await call();
 // Only this synthetic negative-case fixture bypasses the independent
 // lifecycle trigger so old/malformed persisted rows can be checked without
 // waiting ninety seconds. The production trigger is never changed.
 await db.exec('alter table public.call_sessions disable trigger call_session_lifecycle_guard');
 for(const status of ['active','ended','missed','declined']){await q('update public.call_sessions set status=$1 where id=$2',[status,id]);assert.equal(await authorize(id),false);}
 await q("update public.call_sessions set status='ringing',ended_at=now() where id=$1",[id]);assert.equal(await authorize(id),false);
 await q("update public.call_sessions set ended_at=null,expires_at=now()-interval '1 second' where id=$1",[id]);assert.equal(await authorize(id),false);
 await q('update public.call_sessions set expires_at=null where id=$1',[id]);assert.equal(await authorize(id),false);
 await q("update public.call_sessions set expires_at='infinity',created_at=now()+interval '1 minute' where id=$1",[id]);assert.equal(await authorize(id),false);
 await q("update public.call_sessions set created_at=now()-interval '91 seconds' where id=$1",[id]);assert.equal(await authorize(id),false);
 await db.exec('alter table public.call_sessions enable trigger call_session_lifecycle_guard');
});
test('direct conversation calls require exact membership and receiver pairing, including null-member cases',async()=>{
 const conversation=await dm(),id=await call({conversation});assert.equal(await authorize(id),true);
 await q('update public.conversations set user_2=$1 where id=$2',[ids.stranger,conversation]);assert.equal(await authorize(id),false);
 await q('update public.conversations set user_1=$1,user_2=null where id=$2',[ids.other,conversation]);assert.equal(await authorize(id),false);
});
test('group calls require current conversation membership and matching group shape',async()=>{
 const conversation=await group(),id=await call({conversation,group:true});assert.equal(await authorize(id),true);
 await q('delete from public.conversation_members where conversation_id=$1 and user_id=$2',[conversation,ids.owner]);assert.equal(await authorize(id),false);
 await assert.rejects(call({group:true}),/current group membership/);
 await assert.rejects(call({conversation}),/participants do not match/);
});
test('direct calls cannot ring a blocked, deactivated or deleted receiver',async()=>{
 const id=await call();await q('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[ids.other,ids.owner]);assert.equal(await authorize(id),false);
 await q('delete from public.blocked_users where blocker_id=$1',[ids.other]);await q('update public.profiles set deactivated_at=now() where id=$1',[ids.other]);assert.equal(await authorize(id),false);
 await q('update public.profiles set deactivated_at=null where id=$1',[ids.other]);await q('update auth.users set deleted_at=now() where id=$1',[ids.other]);assert.equal(await authorize(id),false);
});
test('badge aggregation is service-only and returns zero for unknown or inactive recipients',async()=>{
 for(const role of ['anon','authenticated'])await assert.rejects(as('owner','select public.get_notification_badge_count($1)',[ids.other],role),/permission denied/);
 assert.equal(await badge(),0);assert.equal(await badge('unknown'),0);await q('update public.profiles set deactivated_at=now() where id=$1',[ids.owner]);assert.equal(await badge(),0);
});
test('the badge counts unread direct messages and excludes read, deleted and self messages',async()=>{
 const conversation=await dm();await message(conversation);const read=await message(conversation),deleted=await message(conversation);await message(conversation,'other','owner');
 await q('update public.messages set read_at=now() where id=$1',[read]);await q('update public.messages set deleted_at=now() where id=$1',[deleted]);assert.equal(await badge(),1);
});
test('group badges use current membership and last-read time without double counting a receiver field',async()=>{
 const conversation=await group();await message(conversation);await message(conversation,null);const old=await message(conversation,null);await q("update public.messages set created_at=now()-interval '2 hours' where id=$1",[old]);
 assert.equal(await badge(),2);await q('delete from public.conversation_members where conversation_id=$1 and user_id=$2',[conversation,ids.owner]);assert.equal(await badge(),0);
});
test('malformed legacy preference containers normalize while other profiles remain untouched',async()=>{
 await q("update public.profiles set notif_prefs='[]'::jsonb where id=$1",[ids.owner]);assert.deepEqual(await set('all',false),{all:false});
});
test('a second application fails instead of replacing a possibly changed contract',async()=>{
 await assert.rejects(db.exec(migration),/NOTIFICATION_CONTRACT_ALREADY_EXISTS/);await db.exec('rollback;begin');
});
test('dispatch claims are private and executable only by the service role',async()=>{
 assert.equal(await value("select relrowsecurity from pg_class where oid='notification_delivery.call_push_dispatches'::regclass"),true);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await value("select has_table_privilege($1,'notification_delivery.call_push_dispatches','select,insert,update,delete')",[role]),false);
 for(const role of ['anon','authenticated'])await assert.rejects(as('owner','select public.claim_call_push_dispatch(null,null)',[],role),/permission denied/);
});
test('one recipient is claimed at most once despite duplicate or uncertain provider attempts',async()=>{
 const id=await call();assert.equal(await claim(id),true);assert.equal(await claim(id),false);assert.equal(await claim(id,'owner'),false);assert.equal(await claim(id,'stranger'),false);
 assert.equal(await value('select count(*)::int from notification_delivery.call_push_dispatches'),1);
});
test('group claims require both current membership and an outstanding invitation',async()=>{
 const conversation=await group(),id=await call({conversation,group:true});assert.equal(await claim(id),false);
 await q("insert into public.call_participants(call_session_id,user_id,status) values($1,$2,'invited')",[id,ids.other]);assert.equal(await claim(id),true);
 const another=await call({conversation,group:true});await q("insert into public.call_participants(call_session_id,user_id,status) values($1,$2,'joined')",[another,ids.other]);assert.equal(await claim(another),false);
 await q("update public.call_participants set status='invited' where call_session_id=$1 and user_id=$2",[another,ids.other]);await q('delete from public.conversation_members where conversation_id=$1 and user_id=$2',[conversation,ids.other]);assert.equal(await claim(another),false);
});
test('a dispatch cannot claim an ended call, inactive recipient or blocked relationship',async()=>{
 const id=await call();await q("update public.call_sessions set status='ended' where id=$1",[id]);assert.equal(await claim(id),false);
 const live=await call();await q('update public.profiles set deactivated_at=now() where id=$1',[ids.other]);assert.equal(await claim(live),false);
 await q('update public.profiles set deactivated_at=null where id=$1',[ids.other]);await q('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[ids.other,ids.owner]);assert.equal(await claim(live),false);
});
test('call deletion and the recipient foreign key cascade private deduplication records',async()=>{
 const first=await call();assert.equal(await claim(first),true);await q('delete from public.call_sessions where id=$1',[first]);assert.equal(await value('select count(*)::int from notification_delivery.call_push_dispatches'),0);
 // Isolate this new FK from older call-receiver SET NULL/lifecycle triggers;
 // full hosted Auth erasure has its own ordered cleanup acceptance gate.
 const second=await call();await q('insert into notification_delivery.call_push_dispatches(call_id,recipient_id) values($1,$2)',[second,ids.stranger]);await q('delete from public.profiles where id=$1',[ids.stranger]);assert.equal(await value('select count(*)::int from notification_delivery.call_push_dispatches'),0);
});
test('call provenance is private, exact and captured from the real request session',async()=>{
 const id=await call();assert.deepEqual((await q('select call_id,user_id,session_id from notification_delivery.call_origins where call_id=$1',[id]))[0],{call_id:id,user_id:ids.owner,session_id:sessions.owner});
 for(const role of ['anon','authenticated','service_role'])assert.equal(await value("select has_table_privilege($1,'notification_delivery.call_origins','select,insert,update,delete')",[role]),false);
 for(const role of ['anon','authenticated'])await assert.rejects(as('owner','select public.call_push_dispatch_allowed($1,$2)',[id,ids.other],role),/permission denied/);
});
test('authenticated call creation rejects missing, forged, anonymous and revoked sessions before persisting',async()=>{
 for(const claims of [{session_id:null},{session_id:randomUUID()},{session_id:sessions.other},{is_anonymous:true}])await assert.rejects(call({claims}),/MEDIA_SESSION_REQUIRED/);
 await q('delete from auth.sessions where id=$1',[sessions.owner]);await assert.rejects(call(),/MEDIA_SESSION_REQUIRED/);assert.equal(await value('select count(*)::int from notification_delivery.call_origins'),0);
});
test('group RPC creation captures the exact owner session and every current invitation',async()=>{
 const conversation=await group(),id=await as('owner','select public.start_group_call($1,false)',[conversation]);assert.equal(await dispatchAllowed(id),true);assert.equal(await claim(id),true);
 assert.equal(await value('select session_id from notification_delivery.call_origins where call_id=$1',[id]),sessions.owner);
});
test('privileged manual calls retain their insert path but cannot dispatch without provenance',async()=>{
 const id=await call({manual:true});assert.equal(await dispatchAllowed(id),false);assert.equal(await claim(id),false);assert.equal(await value('select count(*)::int from notification_delivery.call_origins'),0);
});
test('a committed claim does not authorize a later removed group member or departed participant',async()=>{
 const conversation=await group(),id=await as('owner','select public.start_group_call($1,false)',[conversation]);assert.equal(await claim(id),true);
 await q('delete from public.conversation_members where conversation_id=$1 and user_id=$2',[conversation,ids.other]);assert.equal(await dispatchAllowed(id),false);
 await q('insert into public.conversation_members(conversation_id,user_id) values($1,$2)',[conversation,ids.other]);await q("update public.call_participants set status='left',left_at=now() where call_session_id=$1 and user_id=$2",[id,ids.other]);assert.equal(await dispatchAllowed(id),false);
});
test('post-claim blocks, bans, ended calls and initiating-session revocation remain denied',async()=>{
 const id=await call();assert.equal(await claim(id),true);assert.equal(await dispatchAllowed(id),true);
 await q('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[ids.other,ids.owner]);assert.equal(await dispatchAllowed(id),false);await q('delete from public.blocked_users where blocker_id=$1',[ids.other]);
 await q("update auth.users set banned_until='infinity' where id=$1",[ids.other]);assert.equal(await dispatchAllowed(id),false);await q('update auth.users set banned_until=null where id=$1',[ids.other]);
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessions.owner]);assert.equal(await dispatchAllowed(id),false);await q('update auth.sessions set not_after=null where id=$1',[sessions.owner]);
 await q('delete from auth.sessions where id=$1',[sessions.owner]);assert.equal(await dispatchAllowed(id),false);assert.equal(await value('select count(*)::int from notification_delivery.call_origins'),0);
 await q("update public.call_sessions set status='ended' where id=$1",[id]);assert.equal(await dispatchAllowed(id),false);
});
test('a real bound business session works until device revocation',{skip:!bound},async()=>{
 // SQL fixture of the actual four-contract flow; hosted token issuance remains
 // a separate acceptance gate and no real device or provider is contacted.
 await q('delete from auth.sessions where id=$1',[sessions.business]);
 await q("insert into public.business_members(business_id,member_id,role) values($1,$2,'owner')",[ids.business,ids.owner]);
 const proof='a'.repeat(64),device=randomUUID();
 const grant=await as(null,'select public.triniti_business_owner_access($1,$2,null,$3,$4,$5,true,$6)',[ids.owner,sessions.owner,device,proof,'Synthetic notification device',ids.business],'service_role');assert.equal(grant.allowed,true);
 await q("insert into auth.sessions(id,user_id,aal,created_at) values($1,$2,'aal1',clock_timestamp())",[sessions.business,ids.business]);
 assert.equal((await as(null,'select public.triniti_business_finish_signin($1,$2,$3,$4)',[grant.grant_id,ids.business,sessions.business,proof],'service_role')).success,true);
 assert.equal((await set('all',true,'business')).all,true);const id=await call({initiator:'business'});assert.equal(await authorize(id,'business'),true);assert.equal(await dispatchAllowed(id),true);assert.equal(await claim(id),true);
 await q("update public.business_devices set status='pending' where business_id=$1 and device_id=$2",[ids.business,device]);assert.equal(await dispatchAllowed(id),false);await assert.rejects(authorize(id,'business'),/MEDIA_SESSION_REQUIRED/);await assert.rejects(set('all',false,'business'),/MEDIA_SESSION_REQUIRED/);
});
