import assert from 'node:assert/strict';
import { before,after,beforeEach,afterEach,test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline,source } from './deployed-media-baseline.mjs';
const db=new PGlite({extensions});
const qaMode=process.env.PLATINUM_QA_MEDIA_UPGRADE==='1';
const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
const value=async(sql,args=[]) => Object.values((await rows(sql,args))[0]||{})[0];
const actors=Object.fromEntries(['owner','viewer','stranger','admin','support'].map(n=>[n,randomUUID()]));
const sessions=Object.fromEntries(Object.keys(actors).map(n=>[n,randomUUID()]));
const origin='https://example.supabase.co';
const migrations=['20261029224550_admin_operations_completion','20261029224812_account_storage_erasure',
 '20261029224813_private_media_cutover_compatibility','20261029231321_account_erasure_admin_review_queue','20261029231440_bounded_media_delivery'];
async function as(role,name,sql,args=[],extra={}) {
 await db.exec('savepoint request');
 try {
  await db.exec(`set local role ${role}`);
  const claims={sub:actors[name]||null,role,session_id:sessions[name]||null,aal:'aal1',...extra};
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[claims.sub||'',role,JSON.stringify(claims)]);
  const result=await value(sql,args);await db.exec('reset role');
  await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");
  await db.exec('release savepoint request');return result;
 } catch(error) {await db.exec('rollback to savepoint request; release savepoint request');throw error;}
}
const service=(sql,args=[])=>as('service_role',null,sql,args);
const issue=(name,id,kind='post',extra={})=>as('authenticated',name,"select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_content_media_delivery($1,null) t",[JSON.stringify([{kind,id}])],extra);
const redeem=t=>service('select public.resolve_media_delivery($1,$2,$3)',[t.token,t.bucket_id,t.object_path]);
const adminObject=(id,media,kind='post',base=origin)=>service('select public.admin_bound_content_media_object($1,$2,$3,$4,$5)',[kind,id,media.bucket,media.path,base]);
const adminManifest=(ids,kind='post',base=origin)=>service('select public.admin_bound_content_media_manifest($1,$2,$3)',[kind,ids,base]);
async function object(bucket='post-media',name='owner',suffix=`${randomUUID()}.jpg`) {
 const owner=actors[name]||null,path=`${actors.owner}/${suffix}`,version=randomUUID();
 const id=await value('insert into storage.objects(bucket_id,name,owner_id,owner,version) values($1,$2,$3,$4,$5) returning id',[bucket,path,owner,owner,version]);
 return {id,bucket,path,version,url:`${origin}/storage/v1/object/public/${bucket}/${path}`};
}
const post=(media,audience='everyone')=>value("insert into public.posts(user_id,body,scope,audience,media_url) values($1,'Synthetic test','global',$2,$3) returning id",[actors.owner,audience,media.url]);
async function chat(media,limited=false) {
 const c=await value('select id from public.conversations where user_1=$1 and user_2=$2',[actors.owner,actors.viewer]) || await value('insert into public.conversations(user_1,user_2) values($1,$2) returning id',[actors.owner,actors.viewer]);
 const id=await as('authenticated','owner',"insert into public.messages(conversation_id,sender_id,receiver_id,media_url,media_type,view_limit) values($1,$2,$3,$4,'image',$5) returning id",[c,actors.owner,actors.viewer,media.url,limited?1:null]);
 return {id,c};
}
async function legacy() {
 const media=await object('post-media',null),id=await post(media);
 await db.query("insert into content_media_legacy.snapshots(entity_kind,entity_id,author_id,publication_created_at,object_id,bucket_id,object_path,canonical_url,object_version) select 'post',p.id,p.user_id,p.created_at,o.id,o.bucket_id,o.name,$1,o.version from public.posts p cross join storage.objects o where p.id=$2 and o.id=$3",[media.url,id,media.id]);
 return {media,id};
}
before(async()=>{
 assert.deepEqual(await loadDeployedMediaBaseline(db),{units:25,repairs:4});
 if(qaMode) {
  await db.exec(await source(`supabase/migrations/${migrations[0]}.sql`));
  const admin=await import('./qa-admin-baseline.mjs'),media=await import('./qa-media-baseline.mjs');
  await admin.installQaAdminBaseline(db);await media.installQaMediaBaseline(db);
  const before=await media.qaDataSnapshot(db);
  await db.exec(await source('supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql'));
  await db.exec(await source('supabase/ops/qa/20261029233915_qa_media_completion_forward.sql'));
  await db.exec(await source(`supabase/migrations/${migrations[1]}.sql`));
  await db.exec(await source(`supabase/migrations/${migrations[3]}.sql`));
  assert.deepEqual(await media.qaDataSnapshot(db),before,'QA upgrade must preserve every existing account/session/profile/staff/Storage row and bucket');
  await admin.cleanQaPreservationFixture(db);
 } else for(const name of migrations) await db.exec(await source(`supabase/migrations/${name}.sql`));
 await db.exec("select set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
 for(const [name,id] of Object.entries(actors)) {
  await db.query('insert into auth.users(id,email) values($1,$2)',[id,`delivery-${name}@example.test`]);
  await db.query("insert into public.profiles(id,username,full_name,email,profile_visibility) values($1,$2,$2,$3,'public') on conflict(id) do update set username=excluded.username,profile_visibility='public'",[id,`delivery_${name}`,`delivery-${name}@example.test`]);
  await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);
 }
 await db.query("insert into public.admin_users(user_id,role) values($1,'super_admin'),($2,'support_agent')",[actors.admin,actors.support]);
 await db.exec("update account_erasure.worker set last_seen_at=clock_timestamp(),secret_digest=extensions.digest('test-worker','sha256')");
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db.close());

test('all five candidates compose over the deployed baseline without flipping public buckets',async()=>{
 assert.equal(await value("select count(*)::int from storage.buckets where id in('post-media','story-media','media','chat-media','chat-files') and public"),qaMode?0:5);
 assert.equal(await value("select count(*)::int from pg_namespace where nspname in('admin_ops','account_erasure','media_delivery')"),3);
});
test('service APIs and private proofs cannot be called/read by app roles',async()=>{
 for(const signature of ['public.resolve_media_delivery(text,text,text)','public.admin_bound_content_media_object(text,uuid,text,text,text)','public.admin_bound_content_media_manifest(text,uuid[],text)']) {
  for(const role of ['anon','authenticated']) assert.equal(await value('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
  assert.equal(await value("select has_function_privilege('service_role',$1,'execute')",[signature]),true);
 }
 for(const role of ['anon','authenticated','service_role']) await assert.rejects(as(role,'viewer','select count(*) from media_delivery.tickets'),/permission denied/);
});
test('issuance needs current session and excludes anonymous identities',async()=>{
 const media=await object(),id=await post(media);
 await assert.rejects(issue('viewer',id,'post',{session_id:randomUUID()}),/MEDIA_SESSION_REQUIRED/);
 await assert.rejects(issue('viewer',id,'post',{is_anonymous:true}),/MEDIA_SESSION_REQUIRED/);
 await assert.rejects(as('anon',null,'select * from public.issue_content_media_delivery($1,null)',[JSON.stringify([{kind:'post',id}])]),/permission denied/);
});
test('follower media checks current audience at issuance and on every redemption',async()=>{
 const media=await object(),id=await post(media,'followers');
 assert.deepEqual(await issue('viewer',id),[]);
 await db.query('insert into public.follows(follower_id,following_id) values($1,$2)',[actors.viewer,actors.owner]);
 const [t]=await issue('viewer',id);assert.match(t.token,/^[0-9a-f]{64}$/);assert.equal((await redeem(t)).version,media.version);
 await db.query('delete from public.follows where follower_id=$1 and following_id=$2',[actors.viewer,actors.owner]);
 assert.equal(await redeem(t),null);
});
test('a block revokes a previously issued ticket and service JWT claims are restored',async()=>{
 const media=await object(),id=await post(media),[t]=await issue('viewer',id);
 await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[actors.owner,actors.viewer]);
 assert.equal(await redeem(t),null);
 assert.equal(await value('select auth.uid()'),null);assert.equal(await value('select auth.role()'),'service_role');
});
test('tickets are exact path/version capabilities, expire, and cannot revive after a replacement',async()=>{
 const media=await object(),id=await post(media),[t]=await issue('viewer',id);
 assert.equal(await redeem({...t,object_path:`${actors.owner}/other.jpg`}),null);
 assert.equal(await redeem({...t,token:'f'.repeat(64)}),null);
 await db.query('update storage.objects set version=$1 where id=$2',[randomUUID(),media.id]);
 assert.equal(await redeem(t),null);
 const [current]=await issue('viewer',id);assert.ok(await redeem(current));
 await db.exec("update media_delivery.tickets set expires_at=clock_timestamp()-interval '1 second'");assert.equal(await redeem(current),null);
});
test('a trusted owner reassignment does not reuse an old content binding',async()=>{
 const media=await object(),id=await post(media),[t]=await issue('viewer',id);
 await db.query('update storage.objects set owner=$1,owner_id=$2,version=$3 where id=$4',[actors.stranger,actors.stranger,randomUUID(),media.id]);
 assert.equal(await redeem(t),null);assert.deepEqual(await issue('viewer',id),[]);assert.equal(await adminObject(id,media),null);
});
test('revoked sessions and banned accounts invalidate outstanding tickets',async()=>{
 const media=await object(),id=await post(media),[t]=await issue('viewer',id);
 await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1",[actors.viewer]);assert.equal(await redeem(t),null);
 await db.query('update auth.users set banned_until=null where id=$1',[actors.viewer]);assert.ok(await redeem(t));
 await db.query('delete from auth.sessions where id=$1',[sessions.viewer]);assert.equal(await redeem(t),null);
});
test('upload tickets require actual ownership and a current session',async()=>{
 const media=await object();
 const upload=name=>as('authenticated',name,"select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_content_media_delivery(null,$1) t",[JSON.stringify([media.url])]);
 assert.deepEqual(await upload('viewer'),[]);const [t]=await upload('owner');assert.ok(await redeem(t));
});
test('normal chat delivery requires membership and excludes limited-view messages',async()=>{
 const media=await object('chat-media'),message=await chat(media);
 const issueChat=name=>as('authenticated',name,"select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_chat_media_delivery($1) t",[[message.id]]);
 assert.deepEqual(await issueChat('stranger'),[]);const [t]=await issueChat('viewer');assert.ok(await redeem(t));
 await db.query('update public.messages set deleted_at=clock_timestamp() where id=$1',[message.id]);assert.equal(await redeem(t),null);
 const limited=await chat(await object('chat-media'),true);
 assert.deepEqual(await as('authenticated','viewer',"select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_chat_media_delivery($1) t",[[limited.id]]),[]);
});
test('limited-view reads preserve count, bind real session/version and close immediately',async()=>{
 const media=await object('chat-media'),message=await chat(media,true),request=randomUUID();
 const call=op=>as('authenticated','viewer',`select public.${op}_legacy_chat_media($1,$2)`,[message.id,request]);
 assert.ok(await call('open'));assert.equal((await call('read')).objectVersion,media.version);
 assert.ok(await call('read'));assert.equal(await value('select views from public.message_views where message_id=$1 and user_id=$2',[message.id,actors.viewer]),1);
 const second=randomUUID();await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[second,actors.viewer]);
 assert.equal(await as('authenticated','viewer','select public.read_legacy_chat_media($1,$2)',[message.id,request],{session_id:second}),null);
 assert.equal(await call('close'),true);assert.equal(await call('read'),null);assert.equal(await call('open'),null);
});
test('replaced limited-view bytes never inherit the original viewing grant',async()=>{
 const media=await object('chat-media'),message=await chat(media,true),request=randomUUID();
 assert.ok(await as('authenticated','viewer','select public.open_legacy_chat_media($1,$2)',[message.id,request]));
 await db.query('update storage.objects set version=$1 where id=$2',[randomUUID(),media.id]);
 assert.equal(await as('authenticated','viewer','select public.read_legacy_chat_media($1,$2)',[message.id,request]),null);
});
test('admin media requires current canonical reference and owner proof, even when a stale binding exists',async()=>{
 const media=await object(),id=await post(media);
 assert.deepEqual(await adminObject(id,media),{object_id:media.id,object_version:media.version});
 assert.deepEqual(await adminManifest([id]),[{entity_id:id,bucket_id:media.bucket,object_path:media.path}]);
 await db.query('update public.posts set media_url=null where id=$1',[id]);
 assert.equal(await adminObject(id,media),null);assert.deepEqual(await adminManifest([id]),[]);
});
test('foreign hosts, query tricks, invalid origins and wrong entity types cannot form admin proofs',async()=>{
 const media=await object(),id=await post(media);
 for(const url of [media.url.replace(origin,'https://evil.test'),media.url+'?token=anything',media.url+'#fragment']) {
  await db.query('update public.posts set media_url=$1 where id=$2',[url,id]);
  assert.equal(await adminObject(id,media),null);assert.deepEqual(await adminManifest([id]),[]);
 }
 await db.query('update public.posts set media_url=$1 where id=$2',[media.url+'?t=123',id]);assert.ok(await adminObject(id,media));
 assert.equal(await adminObject(id,media,'story'),null);
 assert.equal(await adminObject(id,media,'post','https://example.supabase.co/evil'),null);
});
test('admin proofs preserve audited ownerless legacy reads and reject changes or revocation',async()=>{
 const {media,id}=await legacy();assert.ok(await adminObject(id,media));assert.equal((await adminManifest([id])).length,1);
 await db.query('update content_media_legacy.snapshots set revoked_at=clock_timestamp() where entity_id=$1',[id]);assert.equal(await adminObject(id,media),null);
});
test('literal spaces and Unicode are supported; encoded/traversing paths fail closed',async()=>{
 const media=await object('post-media','owner','photo élève.jpg'),id=await post(media);assert.ok(await adminObject(id,media));
 assert.equal(await adminObject(id,{...media,path:media.path.replace(' ','%20')}),null);
 for(const path of ['../a.jpg','/a.jpg','a//b.jpg','a\\b.jpg','a\n.jpg']) assert.equal(await adminObject(id,{...media,path}),null);
});
test('admin manifest caps input at 200 and rejects overflow instead of partial results',async()=>{
 const media=await object(),id=await post(media);
 assert.equal((await adminManifest(Array(200).fill(id))).length,1);
 for(const ids of [[],null,[null],Array(201).fill(id)]) await assert.rejects(adminManifest(ids),/ADMIN_MEDIA_INVALID_REFERENCE/);
 // Seed only an isolated synthetic document; no hosted trigger is disabled.
 const story=randomUUID(),prefix=`${actors.owner}/bulk/`;
 await db.exec('alter table public.stories disable trigger bind_story_media_objects');
 await db.query("insert into public.stories(id,user_id,media_type,media_url,media_transform) values($1,$2,'image',$3,'{}')",[story,actors.owner,media.url]);
 await db.query("insert into storage.objects(bucket_id,name,owner,owner_id,version) select 'story-media',$1||n::text||'.jpg',$2::uuid,$2::uuid::text,'bulk-v1' from generate_series(1,4001) n",[prefix,actors.owner]);
 await db.query("insert into public.content_media_bindings(entity_kind,entity_id,bucket_id,object_path,uploader_id) select 'story',$1,'story-media',$2||n::text||'.jpg',$3 from generate_series(1,4001) n",[story,prefix,actors.owner]);
 await db.query("update public.stories set media_transform=(select jsonb_build_object('test',jsonb_agg($1||n::text||'.jpg')) from generate_series(1,4001) n) where id=$2",[`${origin}/storage/v1/object/public/story-media/${prefix}`,story]);
 await db.exec('alter table public.stories enable trigger bind_story_media_objects');
 await assert.rejects(adminManifest([story],'story'),/ADMIN_MEDIA_TOO_LARGE/);
});
test('self-service retention holds appear only in the authorized deletion queue, with no receipt token',async()=>{
 await object('post-media',null);const request=randomUUID(),token='f'.repeat(64);
 const result=await as('authenticated','owner','select public.request_account_erasure($1,$2)',[request,token]);assert.equal(result.state,'retention_review');
 const queue=(who)=>service('select public.triniti_admin_deletion_requests($1,$2,1)',[actors[who],sessions[who]]);
 await assert.rejects(queue('support'),/PERMISSION_DENIED|FORBIDDEN/);
 const data=await queue('admin'),row=data.rows.find(r=>r.request_id===request);
 assert.equal(row.source,'self_service');assert.equal(row.status,'retention_review');assert.equal(row.full_name,null);
 assert.equal(JSON.stringify(data).includes(token),false);assert.equal(JSON.stringify(data).includes('photo.jpg'),false);
});
