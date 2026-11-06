import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline, source } from './deployed-media-baseline.mjs';
const db = new PGlite({ extensions });
const actors = Object.fromEntries(['host','viewer','stranger','business'].map(n => [n,randomUUID()]));
const sessions = Object.fromEntries(Object.keys(actors).map(n => [n,randomUUID()]));
const value = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0] || {})[0];
async function as(role,name,sql,args=[]) {
 await db.exec('savepoint request');
 try {
  await db.exec(`set local role ${role}`);
  const claims={sub:actors[name]||null,role,session_id:sessions[name]||null,is_anonymous:false};
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[claims.sub||'',role,JSON.stringify(claims)]);
  const result=await value(sql,args);await db.exec('reset role;release savepoint request');return result;
 } catch(error) {await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const command=(name,action,id,payload={},request=randomUUID()) => as('authenticated',name,'select public.live_command($1,$2,$3,$4)',[action,id,JSON.stringify(payload),request]);
const create=async(audience='public') => (await command('host','create',null,{title:'Synthetic Live',topic:'gaming',audience,recording_enabled:true})).session_id;
before(async()=>{
 await loadDeployedMediaBaseline(db);
 await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false;');
 try {await db.exec(await source('supabase/migrations/20261103000609_live_portable_control_plane.sql'));}
 catch(error){throw new Error(error.message);}
 for(const [name,id] of Object.entries(actors)){
  await db.query('insert into auth.users(id,email) values($1,$2)',[id,`live-${name}@example.test`]);
  await db.query("insert into public.profiles(id,username,email,full_name,profile_visibility,account_type) values($1,$2,$3,$2,'public',$4) on conflict(id) do update set username=excluded.username,profile_visibility='public',account_type=excluded.account_type",[id,`live_${name}`,`live-${name}@example.test`,name==='business'?'business':'personal']);
  await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);
 }
});
after(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
test('portable installation keeps delivery and provider controls disabled and private tables inaccessible',async()=>{
 const settings=await value('select to_jsonb(s) from live_streams.settings s');
 assert.equal(settings.stage_enabled,false);assert.equal(settings.delivery_enabled,false);assert.equal(settings.recording_enabled,false);
 await assert.rejects(as('anon',null,'select public.live_directory()'),/permission denied/);
 await assert.rejects(as('authenticated','host','select count(*) from live_streams.sessions'),/permission denied/);
 const result=await as('authenticated','host','select public.live_directory()');assert.equal(result.capabilities.create,true);assert.equal(result.items.length,0);
});
test('creation is idempotent, forbids credentials and never claims broadcast before provider readiness',async()=>{
 const key=randomUUID(),payload={title:'First broadcast',topic:'news'};
 const first=await command('host','create',null,payload,key),again=await command('host','create',null,payload,key);
 assert.equal(first.session_id,again.session_id);assert.equal(again.duplicate,true);
 await assert.rejects(command('host','create',null,{...payload,title:'Changed'},key),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(command('host','create',null,{...payload,rtmp_url:'rtmp://synthetic.invalid'}),/INVALID_COMMAND_FIELD/);
 await assert.rejects(as('authenticated','host','select public.live_provider_access($1,\'stage\')',[first.session_id]),/PROVIDER_NOT_READY/);
});
test('followers and invite audiences recheck relationship and session revocation',async()=>{
 const id=await create('followers');await db.query("update live_streams.sessions set state='live' where id=$1",[id]);
 assert.equal(await value('select live_streams.can_view($1,$2)',[id,actors.viewer]),false);
 await db.query('insert into public.follows(follower_id,following_id) values($1,$2)',[actors.viewer,actors.host]);
 assert.equal(await value('select live_streams.can_view($1,$2)',[id,actors.viewer]),true);
 await db.query('delete from public.follows where follower_id=$1 and following_id=$2',[actors.viewer,actors.host]);
 assert.equal(await value('select live_streams.can_view($1,$2)',[id,actors.viewer]),false);
 await db.query('delete from auth.sessions where id=$1',[sessions.host]);
 await assert.rejects(command('host','update',id,{title:'Revoked'}),/AUTH_REQUIRED/);
});
test('business publishing requires an active session-bound editor and uses installed stronger guards',async()=>{
 await assert.rejects(command('business','create',null,{title:'Business Live',topic:'business'}),/AUTH_REQUIRED/);
 const member=await value("insert into public.business_access_members(business_id,display_name,role,code_hash,active) values($1,'Synthetic editor','editor','synthetic-not-a-credential',true) returning id",[actors.business]);
 await db.query('insert into public.studio_session_members(session_id,business_id,member_id) values($1,$2,$3)',[sessions.business,actors.business,member]);
 assert.equal((await command('business','create',null,{title:'Business Live',topic:'business'})).ok,true);
 await db.exec("create schema business_auth;create table business_auth.accounts(business_id uuid);create function business_auth.session_allowed(uuid,uuid) returns boolean language sql as $$select false$$;");
 await assert.rejects(command('business','create',null,{title:'Guarded',topic:'business'}),/AUTH_REQUIRED/);
});
test('provider events are service-only, idempotent and ordered; confirmed end produces replay',async()=>{
 const id=await create();await db.query("update live_streams.sessions set state='starting' where id=$1",[id]);
 const instance=await value('select instance_id from live_streams.provider_sessions where session_id=$1',[id]);
 const t=new Date(Date.now()-2000).toISOString(),event=randomUUID(),digest='a'.repeat(64);
 const sql='select public.live_provider_event($1,$2,$3,$4,$5)',args=[event,instance,'streaming.started',t,digest];
 await assert.rejects(as('authenticated','viewer',sql,args),/permission denied/);
 assert.equal((await as('service_role',null,sql,args)).ok,true);
 assert.equal(await value('select state from live_streams.sessions where id=$1',[id]),'live');
 assert.equal((await as('service_role',null,sql,args)).duplicate,true);
 const end=await as('service_role',null,sql,[randomUUID(),instance,'streaming.ended',new Date(Date.now()-1000).toISOString(),'b'.repeat(64)]);assert.equal(end.ok,true);
 const replay=await value('select to_jsonb(s) from live_streams.sessions s where id=$1',[id]);assert.equal(replay.state,'ended');assert.equal(replay.replay_available,true);
 assert.equal((await as('service_role',null,sql,[randomUUID(),instance,'streaming.started',t,'c'.repeat(64)])).ignored,true);
});
test('maintenance bearer ticks are single-use and never reusable by clients',async()=>{
 const token='pc_live_'+'d'.repeat(64);
 await db.exec('update live_streams.worker_settings set enabled=true,project_origin=\'https://abcdefghijklmnopqrst.supabase.co\'');
 await db.query("insert into live_streams.worker_ticks(digest,expires_at) values(extensions.digest($1,'sha256'),clock_timestamp()+interval '1 minute')",[token]);
 await assert.rejects(as('authenticated','host','select public.validate_live_worker_tick_v1($1)',[token]),/permission denied/);
 assert.equal(await as('service_role',null,'select public.validate_live_worker_tick_v1($1)',[token]),true);
 assert.equal(await as('service_role',null,'select public.validate_live_worker_tick_v1($1)',[token]),false);
});
