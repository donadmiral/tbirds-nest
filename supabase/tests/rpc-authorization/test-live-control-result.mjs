import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const root = new URL('../../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('real PostgreSQL broadcast completion regression and guarded migration', async t => {
 const db = new PGlite();
 try {
  await db.exec(`create schema auth; create schema live_streams;
   create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
   create table live_streams.controls(id uuid primary key,session_id uuid,action text,payload jsonb,status text,lease_id uuid,lease_until timestamptz,result jsonb,updated_at timestamptz);
   create table live_streams.provider_sessions(session_id uuid primary key,active_scene jsonb,published_participants jsonb,error text);`);
  const original = await read('supabase/migrations/20261103000609_live_portable_control_plane.sql');
  const match = original.match(/create or replace function live_streams\.finish_control\([\s\S]*?as\s+(\$[a-zA-Z0-9_]*\$)[\s\S]*?\1\s*;/i);
  assert.ok(match, 'Must exercise the actual original database function, not a rewritten substitute');
  await db.exec(match[0]);
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  const make = async (action='start') => {
   const id=randomUUID(),session=randomUUID(),lease=randomUUID();
   await db.query("insert into live_streams.provider_sessions(session_id) values($1)",[session]);
   await db.query("insert into live_streams.controls(id,session_id,action,payload,status,lease_id,lease_until) values($1,$2,$3,'{\"scene\":{\"preset\":\"host\"}}','processing',$4,now()+interval '45 seconds')",[id,session,action,lease]);
   return {id,session,lease};
  };
  const finish = (c,accepted,error=null,published=[]) => db.query('select live_streams.finish_control($1,$2,$3,$4,$5) as result',[c.id,c.lease,accepted,error,JSON.stringify(published)]);
  await t.test('old production function reproduces the actual ambiguous-column failure', async()=>{
   await assert.rejects(finish(await make(),false,'provider_rejected'),e=>e.code==='42702'&&/ambiguous/.test(e.message));
  });
  for(const version of ['20261103224955','20261103225142']) await db.exec(await read(`supabase/migrations/${version}_live_control_result_unambiguous.sql`));
  await t.test('accepted start persists confirmation without claiming media is live',async()=>{
   const c=await make(),result=(await finish(c,true)).rows[0].result;
   assert.deepEqual(result,{ok:true,session_id:c.session,state:'starting'});
   const row=(await db.query('select status,result,lease_until from live_streams.controls where id=$1',[c.id])).rows[0];
   assert.equal(row.status,'accepted');assert.deepEqual(row.result,result);assert.equal(row.lease_until,null);
  });
  await t.test('provider rejection persists its failure instead of leaving processing',async()=>{
   const c=await make(),result=(await finish(c,false,'PROVIDER_REJECTED_400')).rows[0].result;
   assert.equal(result.ok,false);assert.equal(result.state,'unconfirmed');
   const row=(await db.query('select status,result,lease_until from live_streams.controls where id=$1',[c.id])).rows[0];
   assert.equal(row.status,'failed');assert.deepEqual(row.result,result);assert.equal(row.lease_until,null);
   assert.equal((await db.query('select error from live_streams.provider_sessions where session_id=$1',[c.session])).rows[0].error,'PROVIDER_REJECTED_400');
  });
  await t.test('accepted stop remains ending until provider confirmation',async()=>{
   assert.equal((await finish(await make('stop'),true)).rows[0].result.state,'ending');
  });
  await t.test('accepted scene keeps the exact selected participant allowlist',async()=>{
   const c=await make('scene'),published=[{session_id:randomUUID(),provider_identity:randomUUID()}];
   assert.equal((await finish(c,true,null,published)).rows[0].result.state,'live');
   assert.deepEqual((await db.query('select published_participants from live_streams.provider_sessions where session_id=$1',[c.session])).rows[0].published_participants,published);
  });
  await t.test('wrong lease is rejected',async()=>{
   const c=await make();await assert.rejects(finish({...c,lease:randomUUID()},true),/CONTROL_LEASE_EXPIRED/);
  });
  await t.test('a second completion cannot overwrite an accepted operation',async()=>{
   const c=await make();await finish(c,true);await assert.rejects(finish(c,false,'late_failure'),/CONTROL_LEASE_EXPIRED/);
  });
  await t.test('non-service callers cannot finalize a broadcast',async()=>{
   const c=await make();await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
   await assert.rejects(finish(c,true),/SERVICE_REQUIRED/);
   await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  });
  await t.test('reapplying both hosted versions preserves the repaired definition',async()=>{
   const before=(await db.query("select pg_get_functiondef('live_streams.finish_control(uuid,uuid,boolean,text,jsonb)'::regprocedure) as value")).rows[0].value;
   for(const version of ['20261103224955','20261103225142']) await db.exec(await read(`supabase/migrations/${version}_live_control_result_unambiguous.sql`));
   assert.equal((await db.query("select pg_get_functiondef('live_streams.finish_control(uuid,uuid,boolean,text,jsonb)'::regprocedure) as value")).rows[0].value,before);
  });
 } finally { await db.close(); }
});
