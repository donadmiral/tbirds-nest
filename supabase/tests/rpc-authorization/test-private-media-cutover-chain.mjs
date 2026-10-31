import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline, source } from './deployed-media-baseline.mjs';
const db = new PGlite({extensions});
const rows = async(sql,args=[]) => (await db.query(sql,args)).rows;
const value = async(sql,args=[]) => Object.values((await rows(sql,args))[0]||{})[0];
const owner=randomUUID(),viewer=randomUUID(),stranger=randomUUID();
const BASE='https://example.supabase.co/storage/v1/object/public';
let oldLegacy,oldProtected,candidate;
async function as(role,subject,sql,args=[]) {
  await db.exec('savepoint request');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",
      [subject||'',role,JSON.stringify({sub:subject,role})]);
    const result=await value(sql,args); await db.exec('reset role');
    await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");
    await db.exec('release savepoint request');return result;
  } catch(error) {await db.exec('rollback to savepoint request; release savepoint request');throw error;}
}
const manifest=(subject,id,kind='post')=>as('authenticated',subject,"select coalesce(jsonb_agg(media_url),'[]'::jsonb) from public.content_media_manifest($1)",[JSON.stringify([{kind,id}])]);
async function object(bucket='post-media',user=owner,name=`${owner}/${randomUUID()}.jpg`) {
  const id=await value('insert into storage.objects(bucket_id,name,owner,owner_id,version) values($1,$2,$3,$4,$5) returning id',[bucket,name,user,user,randomUUID()]);
  return {id,bucket,path:name,url:`${BASE}/${bucket}/${name}`};
}
async function post(media,audience='everyone') {
  return await value("insert into public.posts(user_id,body,media_url,scope,audience) values($1,'Synthetic media',$2,'global',$3) returning id",[owner,media.url,audience]);
}
const privatize=()=>db.exec("update storage.buckets set public=false where id in ('post-media','story-media','media','chat-media','chat-files')");
before(async()=>{
  await loadDeployedMediaBaseline(db);
  oldLegacy=await value("select pg_get_functiondef('content_media_legacy.allows_read(text,uuid,uuid,text,text,text)'::regprocedure)");
  oldProtected=await rows("select proname,md5(pg_get_functiondef(oid)) hash from pg_proc where oid in ('public.start_group_call(uuid,boolean)'::regprocedure,'public.sweep_dead_calls()'::regprocedure,'public.delete_user_account(uuid)'::regprocedure,'public.content_media_manifest(jsonb)'::regprocedure) order by proname");
  candidate=await source('supabase/migrations/20261029224813_private_media_cutover_compatibility.sql');
  await db.exec(candidate);
  await db.exec("select set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
  for(const [id,name] of [[owner,'privacy_owner'],[viewer,'privacy_viewer'],[stranger,'privacy_stranger']]) {
    await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${name}@example.test`]);
    await db.query("insert into public.profiles(id,username,full_name,email,profile_visibility) values($1,$2,$2,$3,'public') on conflict(id) do update set username=excluded.username,profile_visibility='public'",[id,name,`${name}@example.test`]);
  }
  // Simulate a permissive old managed Storage policy. The new restrictive rules
  // must still protect each object; deleting old policies is not required.
  await db.exec('create policy synthetic_legacy_world on storage.objects for all to authenticated,anon using(true) with check(true)');
});
beforeEach(()=>db.exec('begin'));
afterEach(()=>db.exec('rollback'));
after(()=>db.close());
test('compatibility changes only the legacy public-bucket prerequisite and leaves the activation separate',async()=>{
  assert.equal(await value("select pg_get_functiondef('content_media_legacy.allows_read(text,uuid,uuid,text,text,text)'::regprocedure)"),oldLegacy.replace('JOIN storage.buckets b ON b.id = o.bucket_id AND b.public','JOIN storage.buckets b ON b.id = o.bucket_id'));
  assert.deepEqual(await rows("select proname,md5(pg_get_functiondef(oid)) hash from pg_proc where oid in ('public.start_group_call(uuid,boolean)'::regprocedure,'public.sweep_dead_calls()'::regprocedure,'public.delete_user_account(uuid)'::regprocedure,'public.content_media_manifest(jsonb)'::regprocedure) order by proname"),oldProtected);
  assert.equal(await value("select count(*)::int from storage.buckets where id in ('post-media','story-media','media','chat-media','chat-files') and public"),5);
  assert.doesNotMatch(candidate,/update\s+storage\.buckets/i);
  const readiness=await as('service_role',null,'select public.private_media_cutover_readiness()');
  assert.equal(readiness.restrictedPolicyCount,10);assert.equal(readiness.legacyRequiresPublicBucket,false);
});
test('private objects cannot be read by anonymous or unrelated users despite broad legacy policies',async()=>{
  for(const bucket of ['post-media','story-media','media','chat-media','chat-files']) {
    const media=await object(bucket);
    assert.equal(await as('anon',null,'select count(*)::int from storage.objects where id=$1',[media.id]),0);
    assert.equal(await as('authenticated',stranger,'select count(*)::int from storage.objects where id=$1',[media.id]),0);
    assert.equal(await as('authenticated',owner,'select count(*)::int from storage.objects where id=$1',[media.id]),1);
  }
});
test('public avatars and catalog images remain intentionally public',async()=>{
  for(const bucket of ['avatars','market-media']) {
    const media=await object(bucket);
    assert.equal(await as('anon',null,'select count(*)::int from storage.objects where id=$1',[media.id]),1);
    assert.equal(await value('select public from storage.buckets where id=$1',[bucket]),true);
  }
});
test('private bucket transition preserves authorized content and still enforces followers and blocks',async()=>{
  const media=await object(),id=await post(media,'followers');
  assert.deepEqual(await manifest(viewer,id),[]);
  await db.query('insert into public.follows(follower_id,following_id) values($1,$2)',[viewer,owner]);
  assert.deepEqual(await manifest(viewer,id),[media.url]);
  await privatize(); assert.deepEqual(await manifest(viewer,id),[media.url]);
  assert.equal(await as('authenticated',viewer,'select count(*)::int from storage.objects where id=$1',[media.id]),0,'authorized viewer uses the manifest signer, never a broad Storage policy');
  await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[owner,viewer]);
  assert.deepEqual(await manifest(viewer,id),[]);
});
async function legacy() {
  const media=await object('post-media',null),id=await post(media);
  await db.query("insert into content_media_legacy.snapshots(entity_kind,entity_id,author_id,publication_created_at,object_id,bucket_id,object_path,canonical_url,object_version) select 'post',$1,$2,p.created_at,o.id,o.bucket_id,o.name,$3,o.version from storage.objects o cross join public.posts p where o.id=$4 and p.id=$1",[id,owner,media.url,media.id]);
  return {media,id};
}
test('reviewed ownerless legacy reads survive private cutover without manufacturing ownership',async()=>{
  const {media,id}=await legacy(); assert.deepEqual(await manifest(viewer,id),[media.url]);
  await privatize(); assert.deepEqual(await manifest(viewer,id),[media.url]);
  assert.equal(await value('select coalesce(owner_id,owner::text) from storage.objects where id=$1',[media.id]),null);
  const ready=await as('service_role',null,'select public.private_media_cutover_readiness()');
  assert.equal(ready.reviewedLegacyReferences,1);assert.equal(ready.unboundReferences,0);
  assert.equal(await as('authenticated',owner,'select count(*)::int from storage.objects where id=$1',[media.id]),0,'a read snapshot grants no ownership policy');
});
test('legacy object replacement, author changes or removed provenance fail closed',async()=>{
  const {media,id}=await legacy();await privatize();
  await db.query('update storage.objects set version=$1 where id=$2',[randomUUID(),media.id]);
  assert.deepEqual(await manifest(viewer,id),[]);
  assert.equal((await as('service_role',null,'select public.private_media_cutover_readiness()')).unboundReferences,1);
});
test('unreviewed ownerless files remain inaccessible and show an explicit cutover blocker',async()=>{
  const media=await object('post-media',null),id=await post(media);await privatize();
  assert.deepEqual(await manifest(viewer,id),[]);
  assert.equal((await as('service_role',null,'select public.private_media_cutover_readiness()')).unboundReferences,1);
});
test('new uploads require real ownership and an allowed actor path; published bytes are immutable',async()=>{
  const media=await object();
  assert.equal(await as('authenticated',owner,'with changed as(update storage.objects set version=$1 where id=$2 returning id) select count(*)::int from changed',[randomUUID(),media.id]),0);
  assert.equal(await as('authenticated',owner,'with changed as(delete from storage.objects where id=$1 returning id) select count(*)::int from changed',[media.id]),0);
  await assert.rejects(as('authenticated',viewer,'insert into storage.objects(bucket_id,name,owner_id,version) values($1,$2,$3,$4) returning id',['post-media',`${owner}/stolen.jpg`,viewer,randomUUID()]),/row-level security/);
  await assert.rejects(as('authenticated',viewer,'insert into storage.objects(bucket_id,name,owner_id,version) values($1,$2,$3,$4) returning id',['chat-media',`${viewer}/forged.jpg`,owner,randomUUID()]),/row-level security/);
  assert.ok(await as('authenticated',viewer,'insert into storage.objects(bucket_id,name,owner_id,version) values($1,$2,$3,$4) returning id',['post-media',`${viewer}/new.jpg`,viewer,randomUUID()]));
});
test('ordinary chat participants can read their attachment; unrelated people cannot',async()=>{
  const media=await object('chat-media');
  const c=await value('insert into public.conversations(user_1,user_2) values($1,$2) returning id',[owner,viewer]);
  await db.query("insert into public.messages(conversation_id,sender_id,receiver_id,media_type,media_url) values($1,$2,$3,'image',$4)",[c,owner,viewer,media.url]);
  await privatize();
  assert.equal(await as('authenticated',viewer,'select count(*)::int from storage.objects where id=$1',[media.id]),1);
  assert.equal(await as('authenticated',stranger,'select count(*)::int from storage.objects where id=$1',[media.id]),0);
});
test('limited-view recipients cannot bypass consumption by signing the object directly',async()=>{
  const media=await object('chat-media');
  const c=await value('insert into public.conversations(user_1,user_2) values($1,$2) returning id',[owner,viewer]);
  await as('authenticated',owner,"insert into public.messages(conversation_id,sender_id,receiver_id,media_type,media_url,view_limit) values($1,$2,$3,'image',$4,1) returning id",[c,owner,viewer,media.url]);
  await privatize();
  assert.equal(await as('authenticated',viewer,'select count(*)::int from storage.objects where id=$1',[media.id]),0);
});
test('a new limited-view upload cannot reuse an existing ordinary attachment',async()=>{
  const media=await object('chat-media');
  const c=await value('insert into public.conversations(user_1,user_2) values($1,$2) returning id',[owner,viewer]);
  await db.query("insert into public.messages(conversation_id,sender_id,receiver_id,media_type,media_url) values($1,$2,$3,'image',$4)",[c,owner,viewer,media.url]);
  await assert.rejects(as('authenticated',owner,"insert into public.messages(conversation_id,sender_id,receiver_id,media_type,media_url,view_limit) values($1,$2,$3,'image',$4,1) returning id",[c,owner,viewer,media.url]),/new owned upload/);
});
test('a limited file cannot later become an ordinary message or group photo',async()=>{
  const media=await object('chat-media');
  const c=await value('insert into public.conversations(user_1,user_2) values($1,$2) returning id',[owner,viewer]);
  await as('authenticated',owner,"insert into public.messages(conversation_id,sender_id,receiver_id,media_type,media_url,view_limit) values($1,$2,$3,'image',$4,1) returning id",[c,owner,viewer,media.url]);
  await assert.rejects(as('authenticated',owner,"insert into public.messages(conversation_id,sender_id,receiver_id,media_type,media_url) values($1,$2,$3,'image',$4) returning id",[c,owner,viewer,media.url]),/cannot be reused/);
  await assert.rejects(as('authenticated',owner,'update public.conversations set group_avatar_url=$1 where id=$2 returning id',[media.url,c]),/cannot be reused/);
});
test('preexisting limited/unlimited reuse is denied by both RLS and the ordinary signer manifest',async()=>{
  const media=await object('chat-media');
  const c=await value('insert into public.conversations(user_1,user_2) values($1,$2) returning id',[owner,viewer]);
  const ordinary=await value("insert into public.messages(conversation_id,sender_id,receiver_id,media_type,media_url) values($1,$2,$3,'image',$4) returning id",[c,owner,viewer,media.url]);
  // Seed an association from before the candidate. No hosted trigger changes.
  await db.exec('alter table public.messages disable trigger chat_limited_object_reuse_guard');
  await db.query("insert into public.messages(conversation_id,sender_id,receiver_id,media_type,media_url,view_limit) values($1,$2,$3,'image',$4,1)",[c,owner,viewer,media.url]);
  await db.exec('alter table public.messages enable trigger chat_limited_object_reuse_guard');
  assert.equal(await as('authenticated',viewer,'select count(*)::int from storage.objects where id=$1',[media.id]),0);
  assert.equal(await as('authenticated',viewer,'select count(*)::int from public.chat_media_manifest($1)',[[ordinary]]),0);
  assert.equal((await as('service_role',null,'select public.private_media_cutover_readiness()')).limitedObjectsWithOrdinaryReferences,1);
});
test('cutover report is service-only and leaks no object paths or account identifiers',async()=>{
  const media=await object();await post(media);
  await assert.rejects(as('authenticated',owner,'select public.private_media_cutover_readiness()'),/permission denied/);
  const report=await as('service_role',null,'select public.private_media_cutover_readiness()');
  assert.equal(JSON.stringify(report).includes(owner),false);
  assert.equal(JSON.stringify(report).includes(media.path),false);
});
