import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test as nodeTest } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import {readCandidate} from './migration-source.mjs';
import { loadDeployedMediaBaseline, root, source } from './deployed-media-baseline.mjs';

const db = new PGlite({extensions});
const q = async(sql,args=[]) => (await db.query(sql,args)).rows;
const value = async(sql,args=[]) => Object.values((await q(sql,args))[0]||{})[0];
const qaMode=process.env.PLATINUM_QA_DATABASE_HARDENING==='1';
const candidatePath=qaMode?'supabase/ops/qa/20261029235400_qa_database_access_hardening_forward.sql':'supabase/migrations/20261029234214_database_access_hardening.sql';
const ids=Object.fromEntries(['owner','follower','outsider','liker','blocked','business'].map(n=>[n,randomUUID()]));
let candidate,preflight,gate,ordinaryBaseline,qaPreserved;
const completed=[];
function test(name,fn) { return nodeTest(name,async()=>{await fn();completed.push(name);}); }

async function as(role,user,sql,args=[]) {
  assert.ok(['anon','authenticated','service_role'].includes(role));
  await db.exec('savepoint request');
  try {
    await db.exec(`set local role ${role}`);
    await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",
      [user||'',role,JSON.stringify({sub:user,role,is_anonymous:false})]);
    const rows=await q(sql,args);
    await db.exec('reset role');
    await q("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
    await db.exec('release savepoint request');
    return rows;
  }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const user=(id,sql,args=[])=>as('authenticated',id,sql,args);
const scalar=async(id,sql,args=[])=>Object.values((await user(id,sql,args))[0]||{})[0];

async function insert(table,fields) {
  assert.match(table,/^[a-z_]+$/);const cols=Object.keys(fields);cols.forEach(c=>assert.match(c,/^[a-z_][a-z_0-9]*$/));
  return value(`insert into public.${table}(${cols.join(',')}) values(${cols.map((_,i)=>'$'+(i+1)).join(',')}) returning id`,Object.values(fields));
}
async function makeStory(owner=ids.owner,extra={}) {
  return insert('stories',{user_id:owner,media_type:'image',media_url:'https://example.test/story.jpg',
    audience:'everyone',created_at:new Date(Date.now()-86400000*3),expires_at:new Date(Date.now()-86400000),...extra});
}
async function makeHighlight(owner=ids.owner) {
  const id=await insert('story_highlights',{user_id:owner,title:'Synthetic highlight',cover_url:'https://example.test/cover.jpg'});
  return id;
}
async function addHighlightStory(highlight,story,sort=0) {return insert('story_highlight_items',{highlight_id:highlight,story_id:story,sort_order:sort});}
async function ordinaryPostManifest() {
  const path=`${ids.owner}/ordinary-regression.jpg`;
  const url=`https://example.supabase.co/storage/v1/object/public/post-media/${path}`;
  const post=await insert('posts',{user_id:ids.owner,content:'Synthetic ordinary post',audience:'everyone',media_url:url});
  await q("insert into storage.objects(bucket_id,name,owner_id) values('post-media',$1,$2)",[path,ids.owner]);
  await q("insert into public.content_media_bindings(entity_kind,entity_id,bucket_id,object_path,uploader_id) values('post',$1,'post-media',$2,$3)",[post,path,ids.owner]);
  const rows=await user(ids.outsider,'select * from public.content_media_manifest($1)',[JSON.stringify([{kind:'post',id:post}])]);
  assert.equal(rows.length,1);assert.equal(rows[0].media_url,url);
  return {ordinaryPostSucceeded:true,optionalSubscriptionHelperPresent:await value("select to_regprocedure('public.creator_has_active_subscription(uuid,uuid)') is not null"),manifestMd5:await value("select md5(pg_get_functiondef('public.content_media_manifest(jsonb)'::regprocedure))")};
}

before(async()=>{
  await loadDeployedMediaBaseline(db);
  await db.exec(await readCandidate());
  await db.exec(await source('supabase/migrations/20261029224550_admin_operations_completion.sql'));
  let qaMedia,qaAdmin,qaBefore;
  if(qaMode) {
    qaAdmin=await import('./qa-admin-baseline.mjs');qaMedia=await import('./qa-media-baseline.mjs');
    await qaAdmin.installQaAdminBaseline(db);await qaMedia.installQaMediaBaseline(db);
    await db.exec(await source('supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql'));
    await db.exec(await source('supabase/ops/qa/20261029233915_qa_media_completion_forward.sql'));
    await db.exec(await source('supabase/migrations/20261029224812_account_storage_erasure.sql'));
    await db.exec(await source('supabase/migrations/20261029231321_account_erasure_admin_review_queue.sql'));
    const qa=await import('./qa-database-hardening-baseline.mjs');
    await qa.installQaHardeningAclBaseline(db);
    qaBefore=await qaMedia.qaDataSnapshot(db);
    qaPreserved=await q("select p.oid::regprocedure::text identity,md5(pg_get_functiondef(p.oid)) md5,p.proacl::text acl from pg_proc p where p.oid in('public.content_media_manifest(jsonb)'::regprocedure,'public.creator_has_active_subscription(uuid,uuid)'::regprocedure,'public.sound_rights_allow(uuid,text)'::regprocedure) order by 1");
  }
  // Exercise the final deployed projection itself, without inventing an optional
  // entitlement helper. The original production function already serves this
  // case successfully; this hardening must preserve that working behavior.
  await db.exec('begin;set local session_replication_role=replica');
  for(const name of ['owner','outsider']) {
    await q('insert into auth.users(id,email) values($1,$2)',[ids[name],`baseline-${name}@example.test`]);
    await q("insert into public.profiles(id,email,username,profile_visibility) values($1,$2,$3,'public')",[ids[name],`baseline-${name}@example.test`,`baseline_${name}`]);
  }
  ordinaryBaseline=await ordinaryPostManifest();
  assert.equal(ordinaryBaseline.optionalSubscriptionHelperPresent,qaMode);
  assert.equal(ordinaryBaseline.manifestMd5,qaMode?'47b5dff186018f351aa0e188d1e805d2':'1bc0a04f263b282b5e785127ab0f0078');
  await db.exec('rollback');
  if(!qaMode) for(const name of ['20261029224812_account_storage_erasure','20261029224813_private_media_cutover_compatibility','20261029231321_account_erasure_admin_review_queue','20261029231440_bounded_media_delivery'])
    await db.exec(await source(`supabase/migrations/${name}.sql`));
  // The reference deliberately excludes external-delivery hooks and credentials.
  // Their bodies are not changed by this candidate; local inert trigger functions
  // model only the exact return type, owner and EXECUTE ACL being revoked.
  for(const name of qaMode?[]:['notify_push_notification','notify_voip_ring','notify_voip_ring_1to1','notify_voip_ring_session']) {
    assert.equal(await value('select to_regprocedure($1)',[`public.${name}()`]),null);
    await db.exec(`create function public.${name}() returns trigger language plpgsql security definer set search_path=public as $$begin return new;end$$;
      revoke all on function public.${name}() from public,anon,authenticated,service_role,postgres;
      grant execute on function public.${name}() to public,postgres,anon,authenticated,service_role;`);
  }
  preflight=JSON.parse(await source('docs/quality/DATABASE_HARDENING_PREFLIGHT_20261029.json'));
  candidate=await source(candidatePath);
  await db.exec(candidate);
  if(qaMode) {
    assert.deepEqual(await qaMedia.qaDataSnapshot(db),qaBefore,'Hardening preserves all existing QA account/session/profile/staff/Storage rows and buckets');
    assert.deepEqual(await q("select p.oid::regprocedure::text identity,md5(pg_get_functiondef(p.oid)) md5,p.proacl::text acl from pg_proc p where p.oid in('public.content_media_manifest(jsonb)'::regprocedure,'public.creator_has_active_subscription(uuid,uuid)'::regprocedure,'public.sound_rights_allow(uuid,text)'::regprocedure) order by 1"),qaPreserved,'Existing QA rights wrapper and entitlement checks stay byte-for-byte intact');
    await qaAdmin.cleanQaPreservationFixture(db);
  }
  gate={candidate:candidatePath,sha256:createHash('sha256').update(candidate).digest('hex'),baselineUnits:25,repairs:4,
    adminAndPrivacyCandidatesApplied:true,qaMode,qaRightsAndDataPreserved:qaMode?true:undefined,mutableApplicationFunctions:58,triggerRevocations:qaMode?62:66,closedTableRevocations:15,
    extensionSchema:await value("select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm'"),
    remainingMutable:await q("select p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='public' and l.lanname in('sql','plpgsql') and not exists(select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') order by 1")};
  gate.postflight=await value(await source('supabase/ops/check-database-hardening-postflight.sql'));
  await db.exec("set search_path=public,extensions;set session_replication_role=replica;begin");
  for(const [name,id]of Object.entries(ids)) {
    await q('insert into auth.users(id,email) values($1,$2)',[id,`${name}@example.test`]);
    await q("insert into public.profiles(id,email,username,full_name,profile_visibility) values($1,$2,$3,$4,'public') on conflict(id) do update set email=excluded.email,username=excluded.username,full_name=excluded.full_name,profile_visibility=excluded.profile_visibility",
      [id,`${name}@example.test`,`hardening_${name}`,`Synthetic ${name}`]);
  }
  await q('insert into public.follows(follower_id,following_id) values($1,$2)',[ids.follower,ids.owner]);
  await db.exec("update public.profiles set search_tsv=to_tsvector('simple',username||' '||full_name);commit;set session_replication_role=origin");
});
beforeEach(async()=>db.exec('begin;set local session_replication_role=replica'));
afterEach(async()=>db.exec('rollback'));
after(async()=>{
  if(process.env.DATABASE_HARDENING_GATE_OUTPUT && completed.length===18) {
    await writeFile(process.env.DATABASE_HARDENING_GATE_OUTPUT,JSON.stringify({...gate,ordinaryBaseline,testsPassed:completed.length,tests:completed,verifiedAt:new Date().toISOString()},null,2)+'\n');
  }
  await db.close();
});

test(qaMode?'actual QA ordinary-post projection and its existing entitlement helper remain working':'actual production ordinary-post projection already works without an entitlement helper and remains working',async()=>{
  assert.equal(ordinaryBaseline.ordinaryPostSucceeded,true);
  assert.equal(ordinaryBaseline.optionalSubscriptionHelperPresent,qaMode);
  const after=await ordinaryPostManifest();
  assert.equal(after.ordinaryPostSucceeded,true);
  assert.equal(after.optionalSubscriptionHelperPresent,qaMode);
});

test('production-matched full chain fixes every mutable application path after the admin candidate',async()=>{
  assert.deepEqual(gate.remainingMutable,[]);
  assert.equal(gate.extensionSchema,'extensions');
  for(const signature of preflight.mutable) {
    const config=await value('select proconfig from pg_proc where oid=to_regprocedure($1)',[signature]);
    assert.ok(config.some(c=>c.startsWith('search_path=')),signature);
  }
});

test('trigger RPC grants are removed while installed trigger bindings remain enabled',async()=>{
  for(const signature of preflight.triggers) {
    if(qaMode && /notify_(push_notification|voip_ring|voip_ring_1to1|voip_ring_session)\(/.test(signature))continue;
    assert.equal(await value("select has_function_privilege('anon',to_regprocedure($1),'EXECUTE')",[signature]),false,signature);
    assert.equal(await value("select has_function_privilege('authenticated',to_regprocedure($1),'EXECUTE')",[signature]),false,signature);
  }
  assert.ok((await value("select count(*)::int from pg_trigger t where t.tgfoid='public.notify_on_follow()'::regprocedure and t.tgenabled='O'"))>0);
  await db.exec('set local session_replication_role=origin');
  await user(ids.outsider,'insert into public.follows(follower_id,following_id) values($1,$2)',[ids.outsider,ids.owner]);
  assert.equal(await value("select count(*)::int from public.notifications where actor_id=$1 and recipient_id=$2 and type='follow'",[ids.outsider,ids.owner]),1);
});

test('obsolete email lookup and privileged maintenance reject app roles',async()=>{
  for(const signature of ['public.email_for_username(text)','public.cleanup_expired_stories()','public.rebuild_daily_stats(date)',
    'public.rebuild_trending_snapshot()','public.refresh_user_interests()','public.get_moment_feed(uuid)','public.post_campus_moment(uuid,uuid)']) {
    for(const role of ['anon','authenticated'])
      assert.equal(await value('select has_function_privilege($1,to_regprocedure($2),\'EXECUTE\')',[role,signature]),false,signature);
    assert.equal(await value("select has_function_privilege('service_role',to_regprocedure($1),'EXECUTE')",[signature]),true,signature);
  }
  for(const role of ['anon','authenticated']) await assert.rejects(as(role,ids.outsider,"select public.email_for_username('hardening_owner')"),/permission denied/);
});

test('closed tables retain RLS and deny table privileges including TRUNCATE',async()=>{
  for(const table of preflight.closed_tables) {
    const name=`${table.schema_name}.${table.name}`;
    assert.equal(await value('select relrowsecurity from pg_class where oid=to_regclass($1)',[name]),true);
    for(const role of ['anon','authenticated']) {
      assert.equal(await value("select has_table_privilege($1,to_regclass($2),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",[role,name]),false,name);
    }
  }
  await assert.rejects(user(ids.owner,'select * from public.blocked_words'),/permission denied/);
  await assert.rejects(user(ids.owner,'truncate public.health_runs'),/permission denied/);
});

test('people search resolves relocated pg_trgm and keeps stable pagination',async()=>{
  const old=await user(ids.follower,"select * from public.search_people('hardening_owner',20)");
  const paged=await user(ids.follower,"select * from public.search_people_page('hardening_owner',20,0,now())");
  assert.ok(old.some(r=>r.id===ids.owner));assert.ok(paged.some(r=>r.id===ids.owner));
  assert.equal(old[0].id,paged[0].id);
  assert.ok(await value("select extensions.similarity('platinum','platinum')=1"));
});

test('fixed function paths ignore caller-created temporary shadow tables',async()=>{
  await db.exec("create temporary table profiles(id uuid,account_type text);insert into profiles(id,account_type) values('00000000-0000-0000-0000-000000000001','forged');set local search_path=pg_temp,public,extensions");
  await q('insert into pg_temp.profiles(id,account_type) values($1,\'forged\')',[ids.owner]);
  assert.notEqual(await scalar(ids.owner,'select public.get_my_account_type()'),'forged');
  assert.equal(await scalar(ids.owner,'select public.is_email_blocked(\'person@example.test\')'),false);
});

test('private profile highlights and raw references reject outsiders and anon',async()=>{
  await q("update public.profiles set profile_visibility='private' where id=$1",[ids.owner]);
  const highlight=await makeHighlight();const story=await makeStory();await addHighlightStory(highlight,story);
  assert.deepEqual(await user(ids.outsider,'select * from public.get_user_highlights($1)',[ids.owner]),[]);
  assert.deepEqual(await user(ids.outsider,'select * from public.story_highlights where id=$1',[highlight]),[]);
  assert.deepEqual(await user(ids.outsider,'select * from public.story_highlight_items where highlight_id=$1',[highlight]),[]);
  await assert.rejects(as('anon',null,'select * from public.get_user_highlights($1)',[ids.owner]),/permission denied/);
  assert.equal((await user(ids.follower,'select * from public.get_user_highlights($1)',[ids.owner])).length,1);
});

test('authorized followers can read archived highlighted stories while ordinary story feed stays expired',async()=>{
  const highlight=await makeHighlight();const story=await makeStory(ids.owner,{audience:'followers'});await addHighlightStory(highlight,story);
  assert.deepEqual(await user(ids.outsider,'select * from public.get_highlight_stories($1)',[highlight]),[]);
  assert.equal((await user(ids.follower,'select * from public.get_highlight_stories($1)',[highlight]))[0].id,story);
  assert.equal(await scalar(ids.follower,'select public.viewer_can_see_story($1)',[story]),false);
});

test('highlight counts and latest media omit hidden and close-friends-only stories',async()=>{
  const highlight=await makeHighlight();const visible=await makeStory();const hidden=await makeStory(ids.owner,{media_url:'https://example.test/hidden.jpg'});
  const close=await makeStory(ids.owner,{audience:'close_friends',media_url:'https://example.test/close.jpg'});
  await addHighlightStory(highlight,visible,1);await addHighlightStory(highlight,hidden,2);await addHighlightStory(highlight,close,3);
  await q('insert into public.story_hidden_from(story_id,user_id) values($1,$2)',[hidden,ids.follower]);
  const rows=await user(ids.follower,'select * from public.get_user_highlights($1)',[ids.owner]);
  assert.equal(Number(rows[0].story_count),1);assert.equal(rows[0].latest_story_media_url,'https://example.test/story.jpg');
  const document=await scalar(ids.follower,"select public.can_view_story_highlight_item($1,$2)",[highlight,hidden]);assert.equal(document,false);
  assert.equal((await user(ids.owner,'select * from public.get_highlight_stories($1)',[highlight])).length,3);
});

test('blocks and account deactivation immediately remove highlight access',async()=>{
  const highlight=await makeHighlight();const story=await makeStory();await addHighlightStory(highlight,story);
  assert.equal((await user(ids.follower,'select * from public.get_highlight_stories($1)',[highlight])).length,1);
  await q('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[ids.owner,ids.follower]);
  assert.deepEqual(await user(ids.follower,'select * from public.get_highlight_stories($1)',[highlight]),[]);
  await q('delete from public.blocked_users where blocker_id=$1 and blocked_id=$2',[ids.owner,ids.follower]);
  await q('update public.profiles set deactivated_at=now() where id=$1',[ids.owner]);
  assert.deepEqual(await user(ids.follower,'select * from public.get_user_highlights($1)',[ids.owner]),[]);
});

test('highlight ownership cannot be forged on insert or update',async()=>{
  const highlight=await makeHighlight();const own=await makeStory();const other=await makeStory(ids.outsider);
  await assert.rejects(user(ids.owner,'insert into public.story_highlight_items(highlight_id,story_id) values($1,$2)',[highlight,other]),/row-level security/);
  const item=(await user(ids.owner,'insert into public.story_highlight_items(highlight_id,story_id) values($1,$2) returning id',[highlight,own]))[0].id;
  await assert.rejects(user(ids.owner,'update public.story_highlight_items set story_id=$1 where id=$2',[other,item]),/row-level security/);
  assert.equal((await user(ids.owner,'delete from public.story_highlight_items where id=$1 returning id',[item])).length,1);
});

test('another owner association is omitted even when legacy data bypassed the new write policy',async()=>{
  const highlight=await makeHighlight();const other=await makeStory(ids.outsider);await addHighlightStory(highlight,other);
  assert.deepEqual(await user(ids.owner,'select * from public.get_highlight_stories($1)',[highlight]),[]);
  assert.equal(Number((await user(ids.owner,'select * from public.get_user_highlights($1)',[ids.owner]))[0].story_count),0);
});

test('highlight manifest rechecks current hidden-from restrictions on every request',async()=>{
  const highlight=await makeHighlight();const path=`${ids.owner}/highlight.jpg`;
  const url=`https://example.supabase.co/storage/v1/object/public/story-media/${path}`;
  const story=await makeStory(ids.owner,{media_url:url});await addHighlightStory(highlight,story);
  await q('insert into storage.objects(bucket_id,name,owner_id) values(\'story-media\',$1,$2)',[path,ids.owner]);
  await q("insert into public.content_media_bindings(entity_kind,entity_id,bucket_id,object_path,uploader_id) values('story',$1,'story-media',$2,$3)",[story,path,ids.owner]);
  const refs=JSON.stringify([{kind:'highlight',id:highlight}]);
  assert.ok((await user(ids.follower,'select * from public.content_media_manifest($1)',[refs])).some(r=>r.media_url===url));
  await q('insert into public.story_hidden_from(story_id,user_id) values($1,$2)',[story,ids.follower]);
  assert.ok(!(await user(ids.follower,'select * from public.content_media_manifest($1)',[refs])).some(r=>r.media_url===url));
});

test('unread-count overload returns only the caller inbox and excludes deleted messages',async()=>{
  const conversation=await insert('conversations',{user_1:ids.owner,user_2:ids.follower,is_group:false,type:'direct'});
  await insert('messages',{conversation_id:conversation,sender_id:ids.follower,receiver_id:ids.owner,text:'Visible'});
  await insert('messages',{conversation_id:conversation,sender_id:ids.follower,receiver_id:ids.owner,text:'Deleted',deleted_at:new Date()});
  const own=await user(ids.owner,'select * from public.get_unread_counts($1)',[ids.owner]);
  assert.equal(own[0].conversation_id,conversation);assert.equal(Number(own[0].unread_count),1);
  assert.deepEqual(await user(ids.outsider,'select * from public.get_unread_counts($1)',[ids.owner]),[]);
  await assert.rejects(as('anon',null,'select * from public.get_unread_counts($1)',[ids.owner]),/permission denied/);
});

test('private profile reach is unavailable to unrelated members',async()=>{
  const post=await insert('posts',{user_id:ids.owner,content:'Synthetic reach',audience:'everyone'});
  await q('insert into public.post_seen(user_id,post_id,seen_at) values($1,$2,now())',[ids.follower,post]);
  assert.equal(await scalar(ids.owner,'select public.get_profile_reach_28d($1)',[ids.owner]),1);
  assert.equal(await scalar(ids.outsider,'select public.get_profile_reach_28d($1)',[ids.owner]),null);
});

test('liker names follow post audience, archives, blocks and bounded request size',async()=>{
  const post=await insert('posts',{user_id:ids.owner,content:'Synthetic private post',audience:'followers'});
  await insert('post_likes',{post_id:post,user_id:ids.liker});
  assert.deepEqual(await user(ids.outsider,'select * from public.get_recent_likers($1)',[[post]]),[]);
  assert.deepEqual((await user(ids.follower,'select * from public.get_recent_likers($1)',[[post]]))[0].liker_names,['Synthetic liker']);
  await q('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[ids.follower,ids.liker]);
  assert.deepEqual(await user(ids.follower,'select * from public.get_recent_likers($1)',[[post]]),[]);
  await q('delete from public.blocked_users where blocker_id=$1',[ids.follower]);
  await q('update public.posts set archived_at=now() where id=$1',[post]);
  assert.deepEqual(await user(ids.follower,'select * from public.get_recent_likers($1)',[[post]]),[]);
  assert.equal((await user(ids.owner,'select * from public.get_recent_likers($1)',[[post]])).length,1);
  await assert.rejects(user(ids.owner,'select * from public.get_recent_likers($1)',[Array.from({length:201},()=>post)]),/At most 200/);
});

test('a repeated or drifted rollout refuses to overwrite the installed state',async()=>{
  const guard=candidate.match(/do \$preflight\$[\s\S]*?end \$preflight\$;/)[0];
  await assert.rejects(db.exec(guard),/HARDENING_FUNCTION_DRIFT|HARDENING_ACL_DRIFT|HARDENING_TARGET_ALREADY_EXISTS/);
});
