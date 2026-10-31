import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {source} from './deployed-media-baseline.mjs';
import {loadBusinessAuthBaseline} from './business-auth-fixture.mjs';
const db=new PGlite({extensions});
const ids={owner:randomUUID(),recipient:randomUUID()},sessions={owner:randomUUID(),recipient:randomUUID()};
const nonce='a'.repeat(64),key='synthetic-qa-service-credential-never-used-with-a-provider';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await q(sql,args))[0]||{})[0];
async function as(role,name,sql,args=[],header=key){
 await db.exec('savepoint request');
 try{
  await db.exec(`set local row_security=on;set local role ${role}`);
  const claims={role,sub:ids[name]||null,session_id:sessions[name]||null,is_anonymous:false};
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true),set_config('request.headers',$4,true)",[claims.sub||'',role,JSON.stringify(claims),JSON.stringify({authorization:`Bearer ${header}`})]);
  const result=await value(sql,args);await db.exec('reset role;set local row_security=on');
  await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true),set_config('request.headers','{}',true)");
  await db.exec('release savepoint request');return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const install=(hash=nonce,credential=key,header=key)=>as('service_role',null,'select public.install_qa_notification_dispatch_credential($1,$2)',[hash,credential],header);
const arm=()=>q("update notification_delivery.settings set project_origin='https://uaulhuelcfkjwojtymmw.supabase.co',ordinary_handler_sha256=$1,call_handler_sha256=$2,setup_nonce_digest=decode($3,'hex'),setup_armed_at=clock_timestamp()-interval '1 second',setup_expires_at=clock_timestamp()+interval '9 minutes' where singleton",['b'.repeat(64),'c'.repeat(64),nonce]);
const notification=(type='system')=>value("insert into public.notifications(recipient_id,actor_id,type,message) values($1,$2,$3,'Synthetic queue fixture') returning id",[ids.recipient,ids.owner,type]);
const call=()=>as('authenticated','owner',"insert into public.call_sessions(initiator_id,receiver_id,call_type,status) values($1,$2,'voice','ringing') returning id",[ids.owner,ids.recipient]);
before(async()=>{
 await loadBusinessAuthBaseline(db,true);
 const baseline=JSON.parse(await source('supabase/tests/rpc-authorization/notification-call-baseline-20261031.json'));
 for(const f of baseline.functions)await db.exec(f.definition);
 for(const definition of baseline.triggers){const name=/CREATE TRIGGER (\w+)/.exec(definition)[1];await db.exec(`drop trigger if exists ${name} on public.call_sessions;${definition}`);}
 for(const name of ['20261031004936_notification_preferences_and_call_push_authorization','20261031005240_notification_call_dispatch_deduplication','20261031010104_notification_dispatch_current_authorization'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 await db.exec(`create role supabase_functions_admin;create table net._http_response(id bigint);
 grant usage on schema net to public;
 grant all on table net.http_request_queue,net._http_response to public;`);
 await db.exec(await source('supabase/ops/provider-review/20261031012101_pg_net_private_dispatch_queues.sql'));
 await db.exec(`create table notification_delivery.fixture_http_requests(id bigint generated always as identity primary key,url text,body jsonb,headers jsonb,timeout_ms integer);
 create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$declare result bigint;begin insert into notification_delivery.fixture_http_requests(url,body,headers,timeout_ms) values(http_post.url,http_post.body,http_post.headers,http_post.timeout_milliseconds) returning id into result;return result;end$$;`);
 await db.exec(await source('supabase/migrations/20261031010711_notification_dispatch_hooks.sql'));
 await q("insert into vault.secrets(name,secret) values('project_url','https://uaulhuelcfkjwojtymmw.supabase.co')");
 await db.exec(await source('supabase/ops/qa/notification-dispatch-setup/20261031010712_qa_notification_dispatch_credential_installer.sql'));
 for(const[name,id]of Object.entries(ids)){
  await q('insert into auth.users(id,email) values($1,$2)',[id,`queue-${name}@example.invalid`]);
  await q("update public.profiles set username=$1,account_type='personal' where id=$2",[`queue_${name}`,id]);
  await q("insert into auth.sessions(id,user_id,aal,created_at) values($1,$2,'aal1',clock_timestamp())",[sessions[name],id]);
 }
 await db.exec("select set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims','{}',false)");
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db.close());

test('pg_net hardening denies app queue/response access while preserving trusted operators',async()=>{
 for(const table of ['http_request_queue','_http_response']){
  for(const role of ['anon','authenticated']){
   assert.equal(await value(`select has_table_privilege($1,'net.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,[role]),false);
   await assert.rejects(as(role,'owner',`select count(*)::int from net.${table}`),/permission denied/);
  }
  for(const role of ['service_role','supabase_functions_admin']){
   assert.equal(await as(role,null,`insert into net.${table}(id) values(7) returning id`),7);
   assert.equal(await as(role,null,`select count(*)::int from net.${table}`),1);
   await as(role,null,`delete from net.${table} where id=7 returning id`);
  }
 }
});

test('new hooks remain disabled and never enqueue historical or unconfigured events',async()=>{
 assert.equal(await value('select enabled from notification_delivery.settings'),false);await notification();await call();assert.equal(await value('select count(*)::int from notification_delivery.outbox'),0);assert.equal(await value('select count(*)::int from notification_delivery.fixture_http_requests'),0);
});
test('settings, outbox and setup helper expose no client privilege',async()=>{
 for(const table of ['settings','outbox'])for(const role of ['anon','authenticated','service_role'])assert.equal(await value(`select has_table_privilege($1,'notification_delivery.${table}','select,insert,update,delete')`,[role]),false);
 for(const role of ['anon','authenticated'])await assert.rejects(as(role,'owner','select public.install_qa_notification_dispatch_credential($1,$2)',[nonce,key]),/permission denied/);
 for(const role of ['anon','authenticated','service_role'])await assert.rejects(as(role,'owner','select notification_delivery.enqueue(null,null)'),/permission denied/);
});
test('a missing, wrong or expired nonce cannot store a key or activate hooks',async()=>{
 await assert.rejects(install(),/NONCE_EXPIRED_OR_INVALID/);await arm();await assert.rejects(install('d'.repeat(64)),/NONCE_EXPIRED_OR_INVALID/);
 await q("update notification_delivery.settings set setup_armed_at=clock_timestamp()-interval '2 minutes',setup_expires_at=clock_timestamp()-interval '1 minute'");await assert.rejects(install(),/NONCE_EXPIRED_OR_INVALID/);
 assert.equal(await value("select count(*)::int from vault.secrets where name='notification_dispatch_service_key'"),0);assert.equal(await value('select enabled from notification_delivery.settings'),false);
});
test('the setup project and both deployed-handler readbacks must be explicitly pinned',async()=>{
 await arm();await q('update notification_delivery.settings set call_handler_sha256=null');await assert.rejects(install(),/TARGET_OR_READBACK_REQUIRED/);
 await arm();await q("update notification_delivery.settings set project_origin='https://prlkikhckbifseosbukl.supabase.co'");await assert.rejects(install(),/TARGET_OR_READBACK_REQUIRED/);
});
test('the stored key must be the exact service credential authenticating the RPC',async()=>{
 await arm();await assert.rejects(install(nonce,key,'different-header-key'),/CREDENTIAL_IDENTITY_MISMATCH/);await assert.rejects(install(nonce,'too-short','too-short'),/CREDENTIAL_INVALID/);
 await assert.rejects(install(nonce,key+' space',key+' space'),/CREDENTIAL_INVALID/);assert.equal(await value('select enabled from notification_delivery.settings'),false);
});
test('setup atomically stores one key and enables only the exact prepared QA hooks once',async()=>{
 await arm();assert.deepEqual(await install(),{installed:true,project_ref:'uaulhuelcfkjwojtymmw',ordinary:true,calls:true});
 assert.equal(await value("select count(*)::int from vault.secrets where name='notification_dispatch_service_key' and secret=$1",[key]),1);assert.equal(await value('select enabled and setup_used_at is not null from notification_delivery.settings'),true);
 await assert.rejects(install(),/QA_SETUP_UNAVAILABLE/);assert.equal(await value("select count(*)::int from vault.secrets where name='notification_dispatch_service_key'"),1);
});
test('an existing credential is never overwritten or silently reused',async()=>{
 await arm();await q("insert into vault.secrets(name,secret) values('notification_dispatch_service_key','existing-synthetic-key')");await assert.rejects(install(),/CREDENTIAL_ALREADY_PRESENT/);assert.equal(await value("select secret from vault.secrets where name='notification_dispatch_service_key'"),'existing-synthetic-key');assert.equal(await value('select enabled from notification_delivery.settings'),false);
});
test('ordinary events queue only the stored ID at the QA endpoint with the installed service header',async()=>{
 await arm();await install();const id=await notification();const row=(await q('select url,body,headers,timeout_ms from notification_delivery.fixture_http_requests'))[0];
 assert.equal(row.url,'https://uaulhuelcfkjwojtymmw.supabase.co/functions/v1/send-push-notification');assert.deepEqual(row.body,{record:{id}});assert.deepEqual(row.headers,{'Content-Type':'application/json',Authorization:`Bearer ${key}`});assert.equal(row.timeout_ms,10000);assert.equal(await value("select state from notification_delivery.outbox where notification_id=$1",[id]),'queued');
});
test('call enqueue uses the deployed callId contract and never also sends ordinary incoming-call push',async()=>{
 await arm();await install();const id=await call();const rows=await q('select url,body from notification_delivery.fixture_http_requests');assert.equal(rows.length,1);assert.equal(rows[0].url,'https://uaulhuelcfkjwojtymmw.supabase.co/functions/v1/send-voip-push');assert.deepEqual(rows[0].body,{callId:id});
 await notification('incoming_call');assert.equal(await value('select count(*)::int from notification_delivery.fixture_http_requests'),1);
});
test('atomic group creation queues one call and completes its invitation set before commit',async()=>{
 await arm();await install();const conversation=await value("insert into public.conversations(user_1,is_group) values($1,true) returning id",[ids.owner]);await q('insert into public.conversation_members(conversation_id,user_id) values($1,$2),($1,$3)',[conversation,ids.owner,ids.recipient]);
 const id=await as('authenticated','owner','select public.start_group_call($1,false)',[conversation]);assert.equal(await value('select count(*)::int from notification_delivery.fixture_http_requests'),1);assert.equal(await value('select count(*)::int from public.call_participants where call_session_id=$1',[id]),2);assert.equal(await value('select count(*)::int from notification_delivery.outbox where call_id=$1',[id]),1);
});
test('operator pause affects only future events and does not replay skipped history',async()=>{
 const old=await notification();await arm();await install();assert.equal(await value('select count(*)::int from notification_delivery.outbox where notification_id=$1',[old]),0);
 await q('update notification_delivery.settings set enabled=false');const skipped=await notification();await q('update notification_delivery.settings set enabled=true');assert.equal(await value('select count(*)::int from notification_delivery.outbox where notification_id=$1',[skipped]),0);
});
test('a queue failure preserves the application event and records only a non-sensitive code',async()=>{
 await arm();await install();await db.exec("create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$begin raise exception 'Synthetic queue failure';end$$");const id=await notification();assert.equal(await value('select count(*)::int from public.notifications where id=$1',[id]),1);assert.deepEqual((await q('select state,error_code,request_id from notification_delivery.outbox where notification_id=$1',[id]))[0],{state:'failed',error_code:'P0001',request_id:null});
});
test('outbox uniqueness prevents accidental replay and event erasure removes its metadata',async()=>{
 await arm();await install();const id=await notification();await q('select notification_delivery.enqueue($1,null)',[id]);assert.equal(await value('select count(*)::int from notification_delivery.fixture_http_requests'),1);await q('delete from public.notifications where id=$1',[id]);assert.equal(await value('select count(*)::int from notification_delivery.outbox'),0);
});
