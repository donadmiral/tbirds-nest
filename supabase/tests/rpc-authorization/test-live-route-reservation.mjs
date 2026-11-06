import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const source=path=>readFile(new URL(path,import.meta.url),'utf8');
const migration=await source('../../migrations/20261104025930_reserve_live_route_username.sql');
// Exact deployed production function. Its fingerprint is an intentional install gate.
const original=`CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_username is not null
     and length(trim(p_username)) between 3 and 30
     and trim(p_username) ~ '^[a-z0-9_]+$'
     and not exists (select 1 from profiles where lower(username) = lower(trim(p_username)));
$function$
`;
const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create table public.profiles(id uuid primary key,username text,full_name text);
  grant select,insert,update on public.profiles to authenticated;`);
 await db.exec(original);
 await db.exec('grant execute on function public.is_username_available(text) to anon,authenticated,service_role');
 await db.query("insert into public.profiles values($1,'existing_person','Existing person')",[randomUUID()]);
 assert.equal(await value(db,"select md5(pg_get_functiondef('public.is_username_available(text)'::regprocedure))"),'dca1048f7c4ce81e552d3992f07e1e11');
 return db;
}
async function rollback(db,fn){
 await db.exec('begin');
 try{return await fn();}finally{await db.exec('rollback');}
}

test('live route installs narrowly against the exact legacy production baseline',async t=>{
 const db=await fixture();
 try{
  const snapshot=()=>value(db,'select jsonb_agg(to_jsonb(p) order by id) from public.profiles p');
  const beforeRows=await snapshot();
  const metadata=()=>value(db,`select jsonb_build_object('oid',oid,'owner',pg_get_userbyid(proowner),
   'acl',proacl::text,'search_path',proconfig,'security_definer',prosecdef,'volatility',provolatile)
   from pg_proc where oid='public.is_username_available(text)'::regprocedure`);
  const beforeMetadata=await metadata();
  const inputs=[null,'','ab','UPPER','new_user','live',' live ','LiVe','existing_person','watch','studio','bad-name'];
  const availability=async()=>Promise.all(inputs.map(input=>value(db,'select public.is_username_available($1)',[input])));
  const beforeAvailability=await availability();

  await t.test('an unknown availability definition aborts without installing a guard',async()=>{
   await rollback(db,async()=>{
    await db.exec(original.replace('between 3 and 30','between 3 and 31'));
    await assert.rejects(db.exec(migration),/LIVE_ROUTE_RESERVATION_BASELINE_DRIFT/);
   });
   assert.equal(await value(db,"select to_regprocedure('public.guard_live_route_username()')"),null);
  });
  await t.test('unexpected route schema or existing guard aborts instead of overwriting it',async()=>{
   for(const setup of [
    'create schema app_routes',
    'create function public.guard_live_route_username() returns trigger language plpgsql as $$begin return new;end$$',
   ])await rollback(db,async()=>{
    await db.exec(setup);await assert.rejects(db.exec(migration),/LIVE_ROUTE_RESERVATION_BASELINE_DRIFT/);
   });
  });
  await t.test('an existing normalized live handle aborts and preserves all identities',async()=>{
   for(const handle of ['live',' LiVe '])await rollback(db,async()=>{
    await db.query('update public.profiles set username=$1',[handle]);
    await assert.rejects(db.exec(migration),/LIVE_ROUTE_RESERVATION_EXISTING_HANDLE_COLLISION/);
   });
   assert.deepEqual(await snapshot(),beforeRows);
  });
  await t.test('unfinished business provisions are checked when their table exists',async()=>{
   await rollback(db,async()=>{
    await db.exec(`create schema admin_ops;
     create table admin_ops.provisions(kind text,completed_at timestamptz,snapshot jsonb);
     insert into admin_ops.provisions values('business',null,'{"desired_username":" LIVE "}');`);
    await assert.rejects(db.exec(migration),/LIVE_ROUTE_RESERVATION_PENDING_REVIEW/);
   });
   assert.equal(await value(db,"select to_regnamespace('admin_ops')"),null);
  });
  await t.test('installation preserves rows, original RPC metadata and all unrelated expressions',async()=>{
   const beforeDefinition=await value(db,"select pg_get_functiondef('public.is_username_available(text)'::regprocedure)");
   await db.exec(migration);
   assert.deepEqual(await snapshot(),beforeRows);
   assert.deepEqual(await metadata(),beforeMetadata);
   assert.equal(await value(db,"select to_regnamespace('app_routes')"),null);
   assert.equal(await value(db,"select to_regnamespace('admin_ops')"),null);
   const anchor='     and not exists (select 1 from profiles where lower(username) = lower(trim(p_username)));';
   assert.equal(await value(db,"select pg_get_functiondef('public.is_username_available(text)'::regprocedure)"),
    beforeDefinition.replace(anchor,"     and lower(trim(p_username)) <> 'live'\n"+anchor));
  });
  await t.test('availability changes only live and retains prior caller access',async()=>{
   const after=await availability();
   for(let index=0;index<inputs.length;index++)assert.equal(after[index],
    inputs[index]?.trim().toLowerCase()==='live'?false:beforeAvailability[index],String(inputs[index]));
   for(const role of ['anon','authenticated','service_role'])await rollback(db,async()=>{
    await db.exec(`set local role ${role}`);
    assert.equal(await value(db,"select public.is_username_available('live')"),false);
    assert.equal(await value(db,"select public.is_username_available('watch')"),true);
   });
  });
  await t.test('direct authenticated inserts and renames cannot bypass the live guard',async()=>{
   for(const handle of ['live',' LIVE '])for(const insert of [true,false])await rollback(db,async()=>{
    await db.exec('set local role authenticated');
    await assert.rejects(insert
     ?db.query('insert into public.profiles(id,username) values($1,$2)',[randomUUID(),handle])
     :db.query('update public.profiles set username=$1',[handle]),/That username is reserved for an app page/);
   });
   assert.deepEqual(await snapshot(),beforeRows);
  });
  await t.test('ordinary profile edits, unchanged handles and other route names retain their behavior',async()=>{
   await rollback(db,async()=>{
    await db.exec('set local role authenticated');
    await db.exec("update public.profiles set username=username,full_name='Updated person'");
    await db.query("insert into public.profiles(id,username) values($1,'watch')",[randomUUID()]);
    assert.equal(await value(db,'select count(*)::int from public.profiles'),2);
   });
   assert.deepEqual(await snapshot(),beforeRows);
  });
  await t.test('new trigger function is private and does not elevate caller privileges',async()=>{
   const guard=await value(db,`select jsonb_build_object('owner',pg_get_userbyid(proowner),'config',proconfig,
    'definer',prosecdef,'anon',has_function_privilege('anon',oid,'execute'),
    'app',has_function_privilege('authenticated',oid,'execute'),
    'service',has_function_privilege('service_role',oid,'execute'))
    from pg_proc where oid='public.guard_live_route_username()'::regprocedure`);
   assert.deepEqual(guard,{owner:'postgres',config:['search_path=""'],definer:false,anon:false,app:false,service:false});
   assert.equal(await value(db,"select tgenabled from pg_trigger where tgrelid='public.profiles'::regclass and tgname='guard_reserved_live_username'"),'O');
  });
 }finally{await db.close();}
});

test('existing route-helper branch also supports databases without the optional admin provisions table',async()=>{
 const db=await fixture();
 try{
  await db.exec(await source('../../migrations/20261030031124_reserve_web_route_usernames.sql'));
  assert.equal(await value(db,"select md5(pg_get_functiondef('app_routes.is_reserved_username(text)'::regprocedure))"),'7131f4adec0b5325d873d73cb0623707');
  const definition=await value(db,"select pg_get_functiondef('app_routes.is_reserved_username(text)'::regprocedure)");
  await rollback(db,async()=>{
   await db.exec(definition.replace("'jobs','login'","'jobs','another_route','login'"));
   await assert.rejects(db.exec(migration),/LIVE_ROUTE_RESERVATION_BASELINE_DRIFT/);
  });
  await db.exec(migration);
  assert.equal(await value(db,"select public.is_username_available('live')"),false);
  assert.equal(await value(db,"select public.is_username_available('watch')"),false);
  assert.equal(await value(db,"select public.is_username_available('original_name')"),true);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await value(db,
   "select has_function_privilege($1,'app_routes.is_reserved_username(text)','execute')",[role]),false);
  assert.equal(await value(db,"select to_regprocedure('public.guard_live_route_username()')"),null);
 }finally{await db.close();}
});
