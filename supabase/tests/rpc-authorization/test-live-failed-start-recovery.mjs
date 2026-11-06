import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('failed-start recovery enforces provider identity, stale leases and absence of any confirmed broadcast', async t => {
 const db=new PGlite();
 try {
  await db.exec(`create schema auth;create schema live_streams;create role anon;create role authenticated;create role service_role;
   create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
   create table live_streams.sessions(id uuid primary key,host_id uuid,state text,started_at timestamptz,ended_at timestamptz,updated_at timestamptz,replay_available boolean default false);
   create table live_streams.provider_sessions(session_id uuid primary key,room_name text,instance_id uuid,playback_path text,published_participants jsonb,error text);
   create table live_streams.provider_outbox(id uuid primary key,session_id uuid,action text,state text,lease_id uuid,lease_until timestamptz,last_error text);
   create table live_streams.provider_events(session_id uuid,event_type text);
   create table live_streams.controls(session_id uuid,status text,lease_until timestamptz,updated_at timestamptz,result jsonb);
   create table live_streams.stage_grants(session_id uuid,revoked_at timestamptz);
   create table live_streams.audit(session_id uuid,actor_id uuid,action text,reason text,payload jsonb);
   create table live_streams.broadcasts(session_id uuid,event text,payload jsonb);
   create function live_streams.session_json(p_id uuid) returns jsonb language sql as $$select to_jsonb(s) from live_streams.sessions s where id=p_id$$;
   create function live_streams.broadcast(p_id uuid,p_event text,p_payload jsonb) returns void language sql as $$insert into live_streams.broadcasts values(p_id,p_event,p_payload)$$;`);
  await db.exec(await readFile(new URL('../../migrations/20261104022700_live_failed_start_recovery.sql',import.meta.url),'utf8'));
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  const make=async()=>{
   const session=randomUUID(),host=randomUUID(),instance=randomUUID(),id=randomUUID(),lease=randomUUID(),room='pc-live-'+session.replaceAll('-','');
   await db.query("insert into live_streams.sessions(id,host_id,state,updated_at) values($1,$2,'ending',now()-interval '5 minutes')",[session,host]);
   await db.query("insert into live_streams.provider_sessions values($1,$2,$3,null,'[]','PROVIDER_OPERATION_UNCONFIRMED')",[session,room,instance]);
   await db.query("insert into live_streams.provider_outbox values($1,$2,'stop','leased',$3,now()+interval '60 seconds','provider_operation_unconfirmed')",[id,session,lease]);
   return{session,host,instance,id,lease,room};
  };
  const context=async c=>(await db.query('select public.live_failed_start_recovery_context($1,$2) as value',[c.id,c.lease])).rows[0].value;
  const begin=async(c,time=new Date().toISOString())=>(await db.query('select public.live_begin_failed_start_recovery($1,$2,$3,$4,$5) as value',[c.id,c.lease,c.instance,c.room,time])).rows[0].value;
  const finish=async(c,time=new Date().toISOString())=>(await db.query('select public.live_finish_failed_start_recovery($1,$2,$3,$4,$5) as value',[c.id,c.lease,c.instance,c.room,time])).rows[0].value;
  await t.test('public and authenticated callers receive no execute grant',async()=>{
   for(const role of ['anon','authenticated'])for(const fn of ['public.live_failed_start_recovery_context(uuid,uuid)','public.live_begin_failed_start_recovery(uuid,uuid,uuid,text,timestamp with time zone)','public.live_finish_failed_start_recovery(uuid,uuid,uuid,text,timestamp with time zone)']){
    assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',[role,fn,'execute'])).rows[0].allowed,false);
   }
   const c=await make();await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
   await assert.rejects(context(c),/SERVICE_REQUIRED/);await assert.rejects(begin(c),/SERVICE_REQUIRED/);await assert.rejects(finish(c),/SERVICE_REQUIRED/);
   await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  });
  await t.test('only a stale ending job with the current lease and exact canonical room qualifies',async()=>{
   const c=await make();assert.deepEqual(await context(c),{eligible:true,session_id:c.session,room_name:c.room,instance_id:c.instance,recovery_started:false});
   assert.equal((await context({...c,lease:randomUUID()})).eligible,false);
   const cases=[
    "update live_streams.sessions set state='live' where id=$1",
    'update live_streams.sessions set updated_at=now() where id=$1',
    'update live_streams.sessions set started_at=now() where id=$1',
    "update live_streams.provider_sessions set playback_path='live/recorded/master.m3u8' where session_id=$1",
    "update live_streams.provider_sessions set room_name='pc-live-other' where session_id=$1",
    "insert into live_streams.provider_events values($1,'streaming.started')",
    "insert into live_streams.controls(session_id,status,lease_until) values($1,'processing',now()+interval '1 minute')",
    "update live_streams.provider_outbox set lease_until=now()-interval '1 second' where session_id=$1",
   ];
   for(const sql of cases){const candidate=await make();await db.query(sql,[candidate.session]);assert.equal((await context(candidate)).eligible,false,sql);}
  });
  await t.test('wrong instance, room, stale proof and a newly arrived provider event prevent completion',async()=>{
   const c=await make();await assert.rejects(finish(c),/RECOVERY_NOT_AVAILABLE/);
   await assert.rejects(begin({...c,instance:randomUUID()}),/RECOVERY_NOT_AVAILABLE/);
   await assert.rejects(begin(c,new Date(Date.now()-60000).toISOString()),/INVALID_RECOVERY_EVIDENCE/);
   await begin(c);await assert.rejects(finish({...c,instance:randomUUID()}),/RECOVERY_NOT_AVAILABLE/);
   await assert.rejects(finish({...c,room:'pc-live-'+randomUUID().replaceAll('-','')}),/RECOVERY_NOT_AVAILABLE/);
   await assert.rejects(finish(c,new Date(Date.now()-60000).toISOString()),/INVALID_RECOVERY_EVIDENCE/);
   await db.query("insert into live_streams.provider_events values($1,'streaming.started')",[c.session]);
   await assert.rejects(finish(c),/RECOVERY_NOT_AVAILABLE/);
   assert.equal((await db.query('select state from live_streams.sessions where id=$1',[c.session])).rows[0].state,'ending');
  });
  await t.test('recovery evidence survives a new lease but cannot cross a room or instance boundary',async()=>{
   const c=await make();await begin(c);assert.equal((await context(c)).recovery_started,true);
   const next={...c,lease:randomUUID()};await db.query('update live_streams.provider_outbox set lease_id=$2 where id=$1',[c.id,next.lease]);
   assert.equal((await context(c)).eligible,false);assert.equal((await context(next)).recovery_started,true);
   await db.query('update live_streams.provider_sessions set instance_id=$2 where session_id=$1',[c.session,randomUUID()]);
   assert.equal((await context(next)).recovery_started,false);
   await assert.rejects(finish(next),/RECOVERY_NOT_AVAILABLE/);
   const wrongRoom=await make();await db.query("insert into live_streams.audit(session_id,action,payload) values($1,'provider_failed_start_recovery_started',$2)",
    [wrongRoom.session,JSON.stringify({instance_id:wrongRoom.instance,room_name:'another-room',no_current_call:true})]);
   assert.equal((await context(wrongRoom)).recovery_started,false);
  });
  await t.test('confirmed room retirement cancels a failed start atomically without a fake event or replay',async()=>{
   const c=await make();await db.query("insert into live_streams.controls(session_id,status,lease_until) values($1,'processing',now()-interval '1 minute')",[c.session]);
   await db.query('insert into live_streams.stage_grants values($1,null)',[c.session]);
   await begin(c);const result=await finish(c);assert.deepEqual(result,{ok:true,session_id:c.session,state:'cancelled'});
   const s=(await db.query('select * from live_streams.sessions where id=$1',[c.session])).rows[0];
   assert.equal(s.state,'cancelled');assert.equal(s.started_at,null);assert.ok(s.ended_at);assert.equal(s.replay_available,false);
   assert.equal((await db.query('select state from live_streams.provider_outbox where id=$1',[c.id])).rows[0].state,'done');
   assert.equal((await db.query('select status from live_streams.controls where session_id=$1',[c.session])).rows[0].status,'failed');
   assert.ok((await db.query('select revoked_at from live_streams.stage_grants where session_id=$1',[c.session])).rows[0].revoked_at);
   assert.equal((await db.query('select count(*)::int n from live_streams.provider_events where session_id=$1',[c.session])).rows[0].n,0);
   const receipt=(await db.query("select action,payload from live_streams.audit where session_id=$1 and action='provider_failed_start_recovered'",[c.session])).rows[0];
   assert.equal(receipt.action,'provider_failed_start_recovered');assert.equal(receipt.payload.room_retired,true);assert.equal(receipt.payload.room_absence_confirmed,true);
   assert.equal((await db.query('select payload from live_streams.broadcasts where session_id=$1',[c.session])).rows[0].payload.session.state,'cancelled');
   await assert.rejects(finish(c),/RECOVERY_NOT_AVAILABLE/);
  });
 }finally{await db.close();}
});
