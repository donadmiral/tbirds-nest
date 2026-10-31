import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {source} from './deployed-media-baseline.mjs';
import {loadBusinessAuthBaseline} from './business-auth-fixture.mjs';
const db=new PGlite({extensions});
const ids={owner:randomUUID(),recipient:randomUUID()},sessions={owner:randomUUID(),recipient:randomUUID()};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await q(sql,args))[0]||{})[0];
async function as(role,name,sql,args=[]){
 await db.exec('savepoint request');
 try{
  await db.exec(`set local row_security=on;set local role ${role}`);
  const claims={role,sub:ids[name]||null,session_id:sessions[name]||null,is_anonymous:false};
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[claims.sub||'',role,JSON.stringify(claims)]);
  const result=await value(sql,args);await db.exec('reset role;set local row_security=on');
  await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
  await db.exec('release savepoint request');return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const activate=()=>q("update notification_delivery.event_settings set enabled=true,project_origin='https://uaulhuelcfkjwojtymmw.supabase.co',dispatcher_sha256=$1,ordinary_handler_sha256=$1,call_handler_sha256=$1 where singleton",['a'.repeat(64)]);
const notification=(type='system')=>value("insert into public.notifications(recipient_id,actor_id,type,message) values($1,$2,$3,'Synthetic event fixture') returning id",[ids.recipient,ids.owner,type]);
const call=()=>as('authenticated','owner',"insert into public.call_sessions(initiator_id,receiver_id,call_type,status) values($1,$2,'voice','ringing') returning id",[ids.owner,ids.recipient]);
const queued=async()=> (await q('select body from net.http_request_queue order by id desc limit 1'))[0].body;
const claim=(body)=>as('service_role',null,'select public.claim_notification_event_dispatch($1,$2)',[body.jobId,body.token]);
const finish=(body,claimId,state)=>as('service_role',null,'select public.finish_notification_event_dispatch($1,$2,$3)',[body.jobId,claimId,state]);
const allowed=(body,claimId)=>as('service_role',null,'select public.notification_event_dispatch_allowed($1,$2)',[body.jobId,claimId]);
before(async()=>{
 await loadBusinessAuthBaseline(db,true);
 const baseline=JSON.parse(await source('supabase/tests/rpc-authorization/notification-call-baseline-20261031.json'));
 for(const f of baseline.functions)await db.exec(f.definition);
 for(const definition of baseline.triggers){const name=/CREATE TRIGGER (\w+)/.exec(definition)[1];await db.exec(`drop trigger if exists ${name} on public.call_sessions;${definition}`);}
 for(const name of ['20261031004936_notification_preferences_and_call_push_authorization','20261031005240_notification_call_dispatch_deduplication','20261031010104_notification_dispatch_current_authorization'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 await db.exec(`alter table net.http_request_queue add column url text,add column body jsonb,add column headers jsonb,add column timeout_ms integer;
 create sequence net.fixture_requests;
 alter table net.http_request_queue alter column id set default nextval('net.fixture_requests');
 grant usage on schema net to public;grant all on net.http_request_queue to public;
 create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$declare result bigint;begin insert into net.http_request_queue(url,body,headers,timeout_ms) values(http_post.url,http_post.body,http_post.headers,http_post.timeout_milliseconds) returning id into result;return result;end$$;`);
 await db.exec(await source('supabase/ops/qa/notification-event-dispatch/20261031022749_notification_event_dispatch_capabilities.sql'));
 for(const[name,id]of Object.entries(ids)){
  await q('insert into auth.users(id,email) values($1,$2)',[id,`event-${name}@example.invalid`]);
  await q("update public.profiles set username=$1,account_type='personal' where id=$2",[`event_${name}`,id]);
  await q("insert into auth.sessions(id,user_id,aal,created_at) values($1,$2,'aal1',clock_timestamp())",[sessions[name],id]);
 }
 await db.exec("select set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims','{}',false)");
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db.close());

test('installation is disabled and does not replay historical events',async()=>{
 const old=await notification();await call();assert.equal(await value('select count(*)::int from notification_delivery.event_jobs'),0);
 await activate();assert.equal(await value('select count(*)::int from notification_delivery.event_jobs where notification_id=$1',[old]),0);
});
test('private jobs remain inaccessible even though the provider queue stays readable',async()=>{
 for(const table of ['event_jobs','event_settings'])for(const role of ['anon','authenticated','service_role'])assert.equal(await value(`select has_table_privilege($1,'notification_delivery.${table}','select,insert,update,delete')`,[role]),false);
 assert.equal(await as('authenticated','owner','select count(*)::int from net.http_request_queue'),0);
 for(const role of ['anon','authenticated']){
  await assert.rejects(as(role,'owner','select public.claim_notification_event_dispatch($1,$2)',[randomUUID(),'a'.repeat(64)]),/permission denied/);
  await assert.rejects(as(role,'owner','select public.finish_notification_event_dispatch($1,$2,$3)',[randomUUID(),randomUUID(),'accepted']),/permission denied/);
  await assert.rejects(as(role,'owner','select public.notification_event_dispatch_allowed($1,$2)',[randomUUID(),randomUUID()]),/permission denied/);
 }
});
test('queued data contains only an opaque job and one short-lived event capability',async()=>{
 await activate();const id=await notification();const body=await queued();
 assert.deepEqual(Object.keys(body).sort(),['jobId','token']);assert.match(body.token,/^[a-f0-9]{64}$/);
 const row=(await q('select url,headers from net.http_request_queue'))[0];
 assert.equal(row.url,'https://uaulhuelcfkjwojtymmw.supabase.co/functions/v1/dispatch-notification-event');assert.deepEqual(row.headers,{'Content-Type':'application/json'});
 assert.equal(await value('select timeout_ms from net.http_request_queue'),45000);
 assert.equal(await value('select expires_at-created_at<=interval \'2 minutes\' from notification_delivery.event_jobs'),true);
 assert.equal(await value("select encode(token_digest,'hex') from notification_delivery.event_jobs"),createHash('sha256').update(body.token).digest('hex'));
 const result=await claim(body);assert.equal(result.kind,'notification');assert.equal(result.eventId,id);
});
test('an observed token cannot select another event, recipient, body or SQL operation',async()=>{
 await activate();const first=await notification(),a=await queued();const second=await notification(),b=await queued();assert.notEqual(first,second);
 assert.equal(await claim({...a,jobId:b.jobId}),null);assert.equal(await claim({...a,token:'b'.repeat(64)}),null);
 const visible=await as('authenticated','owner','select body from net.http_request_queue where body->>\'jobId\'=$1',[a.jobId]);
 const canonical=await claim(visible);assert.equal(canonical.eventId,first);assert.equal(Object.keys(canonical).sort().join(','),'claimId,eventId,kind');
 assert.equal(await claim(a),null);
});
test('atomic claim and completion fence duplicate requests and stale acknowledgements',async()=>{
 await activate();await notification();const body=await queued(),result=await claim(body);assert.ok(result);assert.equal(await claim(body),null);
 assert.equal(await finish(body,randomUUID(),'accepted'),false);assert.equal(await finish(body,result.claimId,'invented'),false);
 assert.equal(await finish(body,result.claimId,'unknown'),true);assert.equal(await finish(body,result.claimId,'accepted'),false);assert.equal(await claim(body),null);
 assert.equal(await value('select state from notification_delivery.event_jobs'),'unknown');
});
test('expired and paused event capabilities do not dispatch',async()=>{
 await activate();await notification();const body=await queued();
 await q("update notification_delivery.event_jobs set created_at=clock_timestamp()-interval '3 minutes',expires_at=clock_timestamp()-interval '1 minute'");assert.equal(await claim(body),null);
 await notification();const next=await queued();await q('update notification_delivery.event_settings set enabled=false where singleton');assert.equal(await claim(next),null);
});
test('legacy mode enabled after enqueue prevents claiming and after claim prevents forwarding',async()=>{
 await activate();await notification();const body=await queued();
 await db.exec('create table notification_delivery.settings(singleton boolean,enabled boolean);insert into notification_delivery.settings values(true,true)');assert.equal(await claim(body),null);
 await q('update notification_delivery.settings set enabled=false where singleton');const result=await claim(body);assert.ok(result);assert.equal(await allowed(body,result.claimId),true);
 await q('update notification_delivery.settings set enabled=true where singleton');assert.equal(await allowed(body,result.claimId),false);
});
test('pause and expiry after claim prevent a fresh forward but do not prevent final acknowledgement',async()=>{
 await activate();await notification();const body=await queued(),result=await claim(body);
 await q('update notification_delivery.event_settings set enabled=false where singleton');assert.equal(await allowed(body,result.claimId),false);assert.equal(await finish(body,result.claimId,'skipped'),true);
 await activate();await notification();const next=await queued(),nextClaim=await claim(next);await q("update notification_delivery.event_jobs set created_at=clock_timestamp()-interval '3 minutes',expires_at=clock_timestamp()-interval '1 minute' where id=$1",[next.jobId]);assert.equal(await allowed(next,nextClaim.claimId),false);
});
test('deleted notifications and deactivated recipients cannot consume a capability',async()=>{
 await activate();const id=await notification(),body=await queued();await q('delete from public.notifications where id=$1',[id]);assert.equal(await claim(body),null);assert.equal(await value('select count(*)::int from notification_delivery.event_jobs'),0);
 await notification();const next=await queued();await q('update public.profiles set deactivated_at=clock_timestamp() where id=$1',[ids.recipient]);assert.equal(await claim(next),null);
});
test('canceled calls and revoked initiating sessions cannot consume a capability',async()=>{
 await activate();const id=await call(),body=await queued();await q("update public.call_sessions set status='ended' where id=$1",[id]);assert.equal(await claim(body),null);
 await call();const next=await queued();await q('delete from auth.sessions where id=$1',[sessions.owner]);assert.equal(await claim(next),null);
});
test('ringing calls map only to the canonical call and never ordinary incoming-call pushes',async()=>{
 await activate();const id=await call(),body=await queued();const claimed=await claim(body);assert.equal(claimed.kind,'call');assert.equal(claimed.eventId,id);
 await notification('incoming_call');assert.equal(await value('select count(*)::int from net.http_request_queue'),1);
});
test('current call authorization still rejects a session revoked after the event claim',async()=>{
 await activate();const id=await call();assert.ok(await claim(await queued()));
 assert.equal(await as('service_role',null,'select public.call_push_dispatch_allowed($1,$2)',[id,ids.recipient]),true);
 await q('delete from auth.sessions where id=$1',[sessions.owner]);
 assert.equal(await as('service_role',null,'select public.call_push_dispatch_allowed($1,$2)',[id,ids.recipient]),false);
});
test('group call insertion commits invitations together before one queued call is consumed',async()=>{
 await activate();const conversation=await value('insert into public.conversations(user_1,is_group) values($1,true) returning id',[ids.owner]);await q('insert into public.conversation_members(conversation_id,user_id) values($1,$2),($1,$3)',[conversation,ids.owner,ids.recipient]);
 const id=await as('authenticated','owner','select public.start_group_call($1,false)',[conversation]);assert.equal(await value('select count(*)::int from net.http_request_queue'),1);assert.equal(await value('select count(*)::int from public.call_participants where call_session_id=$1',[id]),2);assert.equal((await claim(await queued())).eventId,id);
});
test('outbox uniqueness prevents re-enqueue and existing legacy mode prevents double dispatch',async()=>{
 await activate();const id=await notification();await q('select notification_delivery.enqueue_event($1,null)',[id]);assert.equal(await value('select count(*)::int from net.http_request_queue'),1);
 await db.exec('create table notification_delivery.settings(singleton boolean,enabled boolean);insert into notification_delivery.settings values(true,true)');await notification();assert.equal(await value('select count(*)::int from net.http_request_queue'),1);
});
test('queue failure preserves the app event and cannot produce a usable failed capability',async()=>{
 await activate();await db.exec("create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$begin raise exception 'Synthetic private text';end$$");const id=await notification();assert.equal(await value('select count(*)::int from public.notifications where id=$1',[id]),1);
 assert.deepEqual((await q('select state,error_code,request_id from notification_delivery.event_jobs'))[0],{state:'failed',error_code:'P0001',request_id:null});
});
test('operator retention is bounded, keeps recent jobs and preserves canonical notifications',async()=>{
 await activate();const old=await notification();await q("update notification_delivery.event_jobs set created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()-interval '8 days'+interval '2 minutes'");
 await notification();assert.equal(await value('select notification_delivery.cleanup_event_jobs(1)'),1);
 assert.equal(await value('select count(*)::int from notification_delivery.event_jobs'),1);assert.equal(await value('select count(*)::int from public.notifications where id=$1',[old]),1);
 for(const role of ['anon','authenticated','service_role'])await assert.rejects(as(role,'owner','select notification_delivery.cleanup_event_jobs(1)'),/permission denied/);
 await assert.rejects(as('postgres',null,'select notification_delivery.cleanup_event_jobs(501)'),/EVENT_RETENTION_LIMIT/);
});
