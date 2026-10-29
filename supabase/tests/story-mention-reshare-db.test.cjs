const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const OWNER = '10000000-0000-4000-8000-000000000001', VIEWER = '10000000-0000-4000-8000-000000000002', OTHER = '10000000-0000-4000-8000-000000000003';
const visualOnly = process.env.PLATINUM_NON_MUSIC_RELEASE === '1' || process.env.PLATINUM_VISUAL_RELEASE === '1';
let db, sequence = 0;
const id = () => `20000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
async function as(user, action) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
  await db.exec('set role authenticated');
  try { return await action(); } finally { await db.exec('reset role'); }
}
async function story(owner = OWNER) {
  const sid = id();
  await db.query("insert into stories(id,user_id,media_url,thumbnail_url) values($1,$2,'https://media.test/source.jpg','https://media.test/thumb.jpg')", [sid, owner]);
  return sid;
}
async function mention(sid, user = VIEWER, allow = true) {
  return as(OWNER, () => db.query('insert into story_mentions(story_id,mentioned_user_id,mentioned_by_user_id,allow_reshare) values($1,$2,$3,$4) returning id', [sid, user, OWNER, allow]));
}
const visible = (sid, user = VIEWER) => as(user, () => db.query('select viewer_can_see_story($1) ok', [sid])).then(r => r.rows[0].ok);
const reshare = (sid, user = VIEWER) => as(user, () => db.query('select get_story_for_reshare($1) value', [sid])).then(r => r.rows[0].value);
async function post(owner = OWNER, audience = 'everyone') {
  const pid = id(), mid = id();
  await db.query('insert into posts(id,user_id,content,audience) values($1,$2,$3,$4)', [pid, owner, 'A post', audience]);
  await db.query('insert into post_media(id,post_id) values($1,$2)', [mid, pid]);
  return { pid, mid };
}
const tag = (p, user = VIEWER, x = 0.5, y = 0.5) => as(OWNER, () => db.query('insert into post_media_tags(post_id,media_id,user_id,nx,ny) values($1,$2,$3,$4,$5) returning id', [p.pid, p.mid, user, x, y]));
test.before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create function can_act_as(uuid) returns boolean language sql stable as $$select auth.uid()=$1$$;
    create table profiles(id uuid primary key,full_name text,username text,avatar_url text,profile_visibility text default 'public',deactivated_at timestamptz,is_verified boolean default false,verified_tier text);
    create table blocked_users(blocker_id uuid,blocked_id uuid);
    create table follows(follower_id uuid,following_id uuid);
    create table close_friends(owner_id uuid,friend_id uuid);
    create table story_hidden_from(story_id uuid,user_id uuid);
    create table story_shared_with(story_id uuid,user_id uuid);
    create table stories(id uuid primary key default gen_random_uuid(),user_id uuid,created_at timestamptz default now(),expires_at timestamptz default now()+interval '24 hours',audience text default 'everyone',allow_sharing boolean default true,allow_replies boolean default true,caption text,media_url text,media_type text default 'image',thumbnail_url text,stickers_json jsonb,filter_id text,media_transform jsonb,text_background jsonb,duration_sec int,audio_url text,audio_title text,audio_source text,audio_duration_sec int);
    create schema story_ops;
    create table story_ops.publications(request_id uuid primary key,user_id uuid,payload_hash text,story_id uuid,created_at timestamptz);
    create table story_drafts(id uuid,user_id uuid);
    ${visualOnly ? '' : 'create function resolve_story_soundtrack(jsonb) returns jsonb language sql as $$select null::jsonb$$;'}
    create table story_mentions(id uuid primary key default gen_random_uuid(),story_id uuid,mentioned_user_id uuid,mentioned_by_user_id uuid,visible boolean default true,allow_reshare boolean default true,reshared_at timestamptz,created_at timestamptz default now(),unique(story_id,mentioned_user_id));
    create table notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,actor_id uuid,type text,message text,body_preview text,data jsonb,account_type text,read_at timestamptz);
    create table posts(id uuid primary key,user_id uuid,content text,body text,article_title text,audience text,media_url text,image_url text,archived_at timestamptz,is_exclusive boolean default false,community_id uuid,created_at timestamptz default now(),likes_count int default 0,comments_count int default 0,reposts_count int default 0);
    create table post_media(id uuid primary key,post_id uuid,url text,media_type text,width int,height int,sort_order int,edit jsonb);
    create table post_media_tags(id uuid primary key default gen_random_uuid(),post_id uuid,media_id uuid,user_id uuid,nx double precision,ny double precision,unique(media_id,user_id));
    create function can_view_post(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.posts where id=$1 and (user_id=auth.uid() or audience='everyone'))$$;
    alter table post_media_tags enable row level security;
    create policy legacy_tag_read on post_media_tags for select to authenticated using(true);
    create policy legacy_tag_write on post_media_tags for insert to authenticated with check(true);
    create policy legacy_tag_update on post_media_tags for update to authenticated using(true) with check(true);
    grant select,insert,update,delete on all tables in schema public to authenticated;
  `);
  if (visualOnly) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261029054351_story_visual_publication_controls.sql'), 'utf8'));
  } else {
    await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261028152200_story_mention_reshare_quality.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261029044445_story_reply_controls.sql'), 'utf8'));
    // QA already has the old publisher. This narrow patch must work there too.
    await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261029060247_story_public_post_reference_cards.sql'), 'utf8'));
  }
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261029074530_story_post_voice_playback.sql'), 'utf8'));
});
test.beforeEach(async () => {
  await db.exec('truncate profiles,blocked_users,follows,close_friends,story_hidden_from,story_shared_with,stories,story_mentions,notifications,posts,post_media,post_media_tags,story_ops.publications,story_drafts');
  await db.query('insert into profiles(id,full_name,username) values($1,$2,$3),($4,$5,$6),($7,$8,$9)', [OWNER, 'Original Author', 'author', VIEWER, 'Viewer', 'viewer', OTHER, 'Other', 'other']);
});
test.after(() => db.close());

test('current public stories are visible to signed-in people and the owner', async () => {
  const sid = await story();
  assert.equal(await visible(sid), true);
  assert.equal(await visible(sid, OWNER), true);
  assert.equal(await visible(sid, null), false);
});
test('expired, future and deactivated stories cannot be viewed through a direct ID', async () => {
  const sid = await story();
  for (const sql of ["update stories set expires_at=now()-interval '1 second'", "update stories set created_at=now()+interval '1 hour'", "update profiles set deactivated_at=now() where id='" + OWNER + "'"]) {
    await db.exec('begin');await db.exec(sql);assert.equal(await visible(sid),false);await db.exec('rollback');
  }
});
test('a private profile needs a follow or direct mention even for its public-audience story', async () => {
  const sid = await story();
  await db.query("update profiles set profile_visibility='private' where id=$1", [OWNER]);
  assert.equal(await visible(sid), false);
  await db.query('insert into follows values($1,$2)', [VIEWER, OWNER]);
  assert.equal(await visible(sid), true);
  await db.exec('delete from follows');await mention(sid);
  assert.equal(await visible(sid), true);
});
test('audience membership is checked separately from mentions', async () => {
  const sid = await story();await mention(sid);
  for (const audience of ['followers','close_friends','only_with']) {
    await db.query('update stories set audience=$1 where id=$2', [audience,sid]);
    assert.equal(await visible(sid),false);
  }
  await db.query('insert into story_shared_with values($1,$2)', [sid,VIEWER]);assert.equal(await visible(sid),true);
  await db.query("update stories set audience='close_friends' where id=$1", [sid]);
  await db.query('insert into close_friends values($1,$2)', [OWNER,VIEWER]);assert.equal(await visible(sid),true);
  await db.query("update stories set audience='followers' where id=$1", [sid]);
  await db.query('insert into follows values($1,$2)', [VIEWER,OWNER]);assert.equal(await visible(sid),true);
});
test('hidden recipients and either block direction override a mention', async () => {
  const sid = await story();await mention(sid);
  await db.query('insert into story_hidden_from values($1,$2)', [sid,VIEWER]);assert.equal(await visible(sid),false);
  await db.exec('delete from story_hidden_from');
  for (const pair of [[OWNER,VIEWER],[VIEWER,OWNER]]) {
    await db.query('insert into blocked_users values($1,$2)',pair);assert.equal(await visible(sid),false);await db.exec('delete from blocked_users');
  }
});
test('resharing requires a mention and both the mention and source sharing permissions', async () => {
  const sid = await story();assert.equal(await reshare(sid),null);await mention(sid);
  assert.equal((await reshare(sid)).story_id,sid);
  await as(OWNER,()=>db.query('update story_mentions set allow_reshare=false where story_id=$1',[sid]));assert.equal(await reshare(sid),null);
  await as(OWNER,()=>db.query('update story_mentions set allow_reshare=true where story_id=$1',[sid]));
  await db.query('update stories set allow_sharing=false where id=$1',[sid]);assert.equal(await reshare(sid),null);
});
test('restricted source audiences and private profiles do not become public through reshares', async () => {
  const sid=await story();await mention(sid);await db.query('insert into follows values($1,$2)',[VIEWER,OWNER]);
  await db.query("update stories set audience='followers' where id=$1",[sid]);assert.equal(await reshare(sid),null);
  await db.query("update stories set audience='everyone' where id=$1",[sid]);await db.query("update profiles set profile_visibility='private' where id=$1",[OWNER]);assert.equal(await reshare(sid),null);
  assert.equal((await reshare(sid,OWNER)).story_id,sid);
});
test('marking a reshare rechecks permission and records only one receipt', async () => {
  const sid=await story();await mention(sid);
  await as(VIEWER,()=>db.query('select mark_story_reshared($1)',[sid]));
  const before=(await db.query('select reshared_at from story_mentions where story_id=$1',[sid])).rows[0].reshared_at;
  await as(VIEWER,()=>db.query('select mark_story_reshared($1)',[sid]));
  assert.equal(String((await db.query('select reshared_at from story_mentions where story_id=$1',[sid])).rows[0].reshared_at),String(before));
  await db.query('update stories set allow_sharing=false where id=$1',[sid]);
  await as(VIEWER,()=>assert.rejects(()=>db.query('select mark_story_reshared($1)',[sid]),/STORY_RESHARE_UNAVAILABLE/));
});
test('reference cards use canonical author and media while preserving placement', async () => {
  const sid=await story();await mention(sid);
  const draft={kind:'story',id:'reference',storyId:sid,storyAuthorId:OTHER,storyAuthorName:'Forged',storyMediaUrl:'https://evil.test/file',nx:0.5,ny:0.3};
  const out=await as(VIEWER,()=>db.query('insert into stories(user_id,stickers_json) values($1,$2) returning stickers_json',[VIEWER,JSON.stringify([draft])]));
  const item=out.rows[0].stickers_json[0];assert.equal(item.storyAuthorId,OWNER);assert.equal(item.storyAuthorName,'Original Author');assert.equal(item.storyMediaUrl,'https://media.test/source.jpg');assert.equal(item.ny,0.3);
});
test('unavailable references and a forged destination owner cannot be published', async () => {
  const sid=await story();const sticker=JSON.stringify([{kind:'story',storyId:sid}]);
  await as(VIEWER,()=>assert.rejects(()=>db.query('insert into stories(user_id,stickers_json) values($1,$2)',[VIEWER,sticker]),/STORY_RESHARE_UNAVAILABLE/));
  await mention(sid);await as(VIEWER,()=>assert.rejects(()=>db.query('insert into stories(user_id,stickers_json) values($1,$2)',[OTHER,sticker]),/STORY_REFERENCE_FORBIDDEN/));
});
test('a previously allowed reference cannot publish after its source expires', async () => {
  const sid=await story();await mention(sid);assert.ok(await reshare(sid));await db.query('update stories set expires_at=now() where id=$1',[sid]);
  await as(VIEWER,()=>assert.rejects(()=>db.query('insert into stories(user_id,stickers_json) values($1,$2)',[VIEWER,JSON.stringify([{kind:'story',storyId:sid}])]),/STORY_RESHARE_UNAVAILABLE/));
});
const sharePost = (postId, viewer = VIEWER, destination = viewer, extra = {}) => as(viewer, () => db.query(
  'insert into stories(user_id,stickers_json) values($1,$2) returning id,stickers_json',
  [destination, JSON.stringify([{ id: 'post-card', kind: 'post', postId, nx: 0.4, ny: 0.6, scale: 0.9, rotation: 3, ...extra }])],
));
test('public post cards replace forged identity, caption, counters and media with the current ordered gallery', async () => {
  const p = await post();
  await db.query("update profiles set avatar_url='https://media.test/author.jpg',is_verified=true,verified_tier='gold' where id=$1", [OWNER]);
  await db.query("update posts set content='Current caption',article_title='Current article',likes_count=7,comments_count=3,reposts_count=2 where id=$1", [p.pid]);
  await db.query("update post_media set url='https://media.test/later.jpg',media_type='image',width=800,height=600,sort_order=4 where id=$1", [p.mid]);
  await db.query("insert into post_media(id,post_id,url,media_type,width,height,sort_order) values($1,$2,'https://media.test/first.mp4','video',1080,1920,0)", [id(), p.pid]);
  const result = await sharePost(p.pid, VIEWER, VIEWER, {
    postAuthorId: OTHER, postAuthorName: 'Forged', postText: 'Forged caption', postArticleTitle: 'Forged article',
    postUsername: 'fake', postAuthorAvatar: 'https://evil.test/avatar.jpg', postVerified: false, postVerifiedTier: 'fake',
    postMediaUrl: 'https://evil.test/file.mp4', postMediaType: 'image', postMediaWidth: 1, postMediaHeight: 1,
    postMediaCount: 99, postCreatedAt: '1900-01-01', postLikes: 900, postComments: 800, postReposts: 700,
  });
  const card = result.rows[0].stickers_json[0];
  assert.equal(card.postAuthorId, OWNER); assert.equal(card.postAuthorName, 'Original Author');
  assert.equal(card.postText, 'Current caption'); assert.equal(card.postArticleTitle, 'Current article');
  assert.equal(card.postUsername, 'author'); assert.equal(card.postAuthorAvatar, 'https://media.test/author.jpg');
  assert.equal(card.postVerified, true); assert.equal(card.postVerifiedTier, 'gold');
  assert.equal(card.postMediaUrl, 'https://media.test/first.mp4'); assert.equal(card.postMediaType, 'video');
  assert.equal(card.postMediaCount, 2); assert.equal(card.postMediaWidth, 1080); assert.equal(card.postMediaHeight, 1920);
  assert.deepEqual([card.postLikes, card.postComments, card.postReposts], [7, 3, 2]);
  assert.notEqual(card.postCreatedAt, '1900-01-01');
  assert.deepEqual([card.id, card.nx, card.ny, card.scale, card.rotation], ['post-card', 0.4, 0.6, 0.9, 3]);
});
test('post cards support legacy media and text-only posts without retaining fabricated attachments', async () => {
  const p = await post(); await db.query('delete from post_media where post_id=$1', [p.pid]);
  await db.query("update posts set content='',body='Legacy body',media_url='https://media.test/legacy.M4V?version=1' where id=$1", [p.pid]);
  let card = (await sharePost(p.pid)).rows[0].stickers_json[0];
  assert.equal(card.postText, 'Legacy body'); assert.equal(card.postMediaType, 'video'); assert.equal(card.postMediaCount, 1);
  assert.equal(card.postMediaWidth, null); assert.equal(card.postMediaHeight, null);
  await db.query('update posts set media_url=null where id=$1', [p.pid]);
  card = (await sharePost(p.pid, VIEWER, VIEWER, { postMediaUrl: 'https://evil.test/fake.jpg', postMediaType: 'image', postMediaCount: 8, postMediaWidth: 200 })).rows[0].stickers_json[0];
  assert.equal(card.postMediaUrl, null); assert.equal(card.postMediaType, null); assert.equal(card.postMediaCount, 0); assert.equal(card.postMediaWidth, null);
});
test('a visible source cannot widen followers, verified, private, archived, exclusive or community content into a story', async () => {
  const p = await post();
  for (const [change, restore] of [
    ["update posts set audience='followers'", "update posts set audience='everyone'"],
    ["update posts set audience='verified'", "update posts set audience='everyone'"],
    ["update profiles set profile_visibility='private'", "update profiles set profile_visibility='public'"],
    ['update posts set archived_at=now()', 'update posts set archived_at=null'],
    ['update posts set is_exclusive=true', 'update posts set is_exclusive=false'],
    ["update posts set community_id='40000000-0000-4000-8000-000000000001'", 'update posts set community_id=null'],
  ]) {
    await db.exec(change);
    // Even the author can view these sources but cannot turn them into a public card.
    assert.equal((await as(OWNER, () => db.query('select can_view_post($1) allowed', [p.pid]))).rows[0].allowed, true);
    await assert.rejects(() => sharePost(p.pid, OWNER), /POST_RESHARE_UNAVAILABLE/, change);
    await assert.rejects(() => sharePost(p.pid), /POST_RESHARE_UNAVAILABLE/, change);
    await db.exec(restore);
  }
  assert.equal((await db.query('select count(*)::int n from stories')).rows[0].n, 0);
});
test('post cards deny either block direction, inactive actors/authors, anonymous calls and forged destinations', async () => {
  const p = await post();
  for (const pair of [[OWNER, VIEWER], [VIEWER, OWNER]]) {
    await db.query('insert into blocked_users values($1,$2)', pair);
    await assert.rejects(() => sharePost(p.pid), /POST_RESHARE_UNAVAILABLE/);
    await db.exec('delete from blocked_users');
  }
  for (const person of [OWNER, VIEWER]) {
    await db.query('update profiles set deactivated_at=now() where id=$1', [person]);
    await assert.rejects(() => sharePost(p.pid), /POST_RESHARE_UNAVAILABLE/);
    await db.query('update profiles set deactivated_at=null where id=$1', [person]);
  }
  await assert.rejects(() => sharePost(p.pid, VIEWER, OTHER), /STORY_REFERENCE_FORBIDDEN/);
  await assert.rejects(() => sharePost(p.pid, null, VIEWER), /STORY_REFERENCE_FORBIDDEN/);
  await assert.rejects(() => sharePost(id()), /POST_RESHARE_UNAVAILABLE/);
  await assert.rejects(() => sharePost('not-a-uuid'), /uuid/);
});
test('post card updates recheck the source and atomic publication cannot persist a denied card or receipt', async () => {
  const p = await post();
  const saved = (await sharePost(p.pid)).rows[0];
  await db.query("update posts set audience='followers' where id=$1", [p.pid]);
  await as(VIEWER, () => assert.rejects(() => db.query('update stories set stickers_json=$1 where id=$2', [JSON.stringify(saved.stickers_json), saved.id]), /POST_RESHARE_UNAVAILABLE/));
  const payload = { media_type: 'text', text_background: { color: '#1a1a1a' }, stickers_json: saved.stickers_json };
  await as(VIEWER, () => assert.rejects(() => db.query('select publish_story_v2($1,$2,$3)', [VIEWER, id(), JSON.stringify(payload)]), /POST_RESHARE_UNAVAILABLE/));
  assert.equal((await db.query('select count(*)::int n from stories')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int n from story_ops.publications')).rows[0].n, 0);
});
test('the voice metadata upgrade converges from the QA guard without changing publisher or grants', async () => {
  const before = (await db.query("select pg_get_functiondef('public.guard_story_reference_cards()'::regprocedure) guard,pg_get_functiondef('public.publish_story_v2(uuid,uuid,jsonb)'::regprocedure) publisher")).rows[0];
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261029060247_story_public_post_reference_cards.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261029074530_story_post_voice_playback.sql'), 'utf8'));
  const after = (await db.query("select pg_get_functiondef('public.guard_story_reference_cards()'::regprocedure) guard,pg_get_functiondef('public.publish_story_v2(uuid,uuid,jsonb)'::regprocedure) publisher")).rows[0];
  assert.deepEqual(after, before);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.guard_story_reference_cards()','execute') or has_function_privilege('anon','public.guard_story_reference_cards()','execute') allowed")).rows[0].allowed, false);
});
test('mentions cannot forge their story owner or move identity during an update', async () => {
  const sid=await story();
  await as(VIEWER,()=>assert.rejects(()=>db.query('insert into story_mentions(story_id,mentioned_user_id,mentioned_by_user_id) values($1,$2,$3)',[sid,OTHER,VIEWER]),/STORY_MENTION_FORBIDDEN/));
  await mention(sid);
  await as(OWNER,()=>assert.rejects(()=>db.query('update story_mentions set mentioned_user_id=$1 where story_id=$2',[OTHER,sid]),/STORY_MENTION_IDENTITY_IMMUTABLE/));
});
test('self, blocked and deactivated mentions are skipped without notifications', async () => {
  const sid=await story();assert.equal((await mention(sid,OWNER)).rows.length,0);
  await db.query('insert into blocked_users values($1,$2)',[VIEWER,OWNER]);assert.equal((await mention(sid)).rows.length,0);
  await db.exec('delete from blocked_users');await db.query('update profiles set deactivated_at=now() where id=$1',[VIEWER]);assert.equal((await mention(sid)).rows.length,0);
  assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n,0);
});
test('mention permission changes and delete/re-add refresh one existing read notification', async () => {
  const sid=await story();await mention(sid);const before=(await db.query('select * from notifications')).rows[0];
  await db.query('update notifications set read_at=now() where id=$1',[before.id]);
  await as(OWNER,()=>db.query('update story_mentions set visible=false,allow_reshare=false where story_id=$1',[sid]));
  await db.query('delete from story_mentions where story_id=$1',[sid]);await mention(sid,VIEWER,true);
  const rows=(await db.query('select * from notifications')).rows;assert.equal(rows.length,1);assert.equal(rows[0].id,before.id);assert.ok(rows[0].read_at);assert.equal(rows[0].data.allow_reshare,true);assert.equal(rows[0].data.visible,true);
});
test('a media tag cannot combine an owned post and media from another post', async () => {
  const a=await post(),b=await post();await assert.rejects(()=>tag({...a,mid:b.mid}),/MEDIA_TAG_FORBIDDEN/);
  await as(VIEWER,()=>assert.rejects(()=>db.query('insert into post_media_tags(post_id,media_id,user_id,nx,ny) values($1,$2,$3,.5,.5)',[a.pid,a.mid,OTHER]),/MEDIA_TAG_FORBIDDEN/));
});
test('media tags reject invalid coordinates and immutable identity changes', async () => {
  const p=await post();for(const xy of [[-.1,.5],[.5,1.1],[null,.5],['NaN',.5]])await assert.rejects(()=>tag(p,VIEWER,...xy),/INVALID_MEDIA_TAG_POSITION/);
  const saved=await tag(p);await as(OWNER,()=>assert.rejects(()=>db.query('update post_media_tags set user_id=$1 where id=$2',[OTHER,saved.rows[0].id]),/MEDIA_TAG_IDENTITY_IMMUTABLE/));
});
test('multiple media tags notify once per post and moving a tag does not notify again', async () => {
  const p=await post(),saved=await tag(p);const second=id();await db.query('insert into post_media(id,post_id) values($1,$2)',[second,p.pid]);await tag({...p,mid:second});
  await as(OWNER,()=>db.query('update post_media_tags set nx=.1 where id=$1',[saved.rows[0].id]));
  const rows=(await db.query('select * from notifications')).rows;assert.equal(rows.length,1);assert.equal(rows[0].recipient_id,VIEWER);assert.equal(rows[0].actor_id,OWNER);assert.equal(rows[0].data.kind,'photo_tag');assert.equal(rows[0].data.post_id,p.pid);
});
test('blocked and deactivated tag recipients do not produce media tags or notifications', async () => {
  const p=await post();await db.query('insert into blocked_users values($1,$2)',[VIEWER,OWNER]);assert.equal((await tag(p)).rows.length,0);
  await db.exec('delete from blocked_users');await db.query('update profiles set deactivated_at=now() where id=$1',[VIEWER]);assert.equal((await tag(p)).rows.length,0);
  assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n,0);
});
test('legacy permissive tag reads cannot expose tags on an inaccessible post', async () => {
  const p=await post(OWNER,'only_me');await tag(p);
  assert.equal((await as(OWNER,()=>db.query('select * from post_media_tags'))).rows.length,1);
  assert.equal((await as(VIEWER,()=>db.query('select * from post_media_tags'))).rows.length,0);
});

test('typed story mentions require a current whole handle and matching profile identity', async () => {
  const cases = [
    ['Hello @ViEwEr!', VIEWER, 'viewer', true],
    ['Hello @viewer_extra', VIEWER, 'viewer', false],
    ['mail@viewer', VIEWER, 'viewer', false],
    ['@@viewer', VIEWER, 'viewer', false],
    ['Removed handle', VIEWER, 'viewer', false],
    ['Hello @other', VIEWER, 'other', false],
    ['Hello @viewer', OTHER, 'viewer', false],
  ];
  for (const [text, personId, username, expected] of cases) {
    const payload = { stickers_json: [{ kind: 'text', text, mentions: [{ id: personId, username }] }] };
    const rows = (await db.query('select * from story_payload_mentions($1)', [JSON.stringify(payload)])).rows;
    assert.equal(rows.length, expected ? 1 : 0, text + '/' + personId);
    if (expected) assert.equal(rows[0].visible, true);
  }
});

test('explicit and deliberate hidden mentions deduplicate without hiding visible people', async () => {
  const payload = {
    caption: 'Thanks @viewer and email@other',
    stickers_json: [
      { kind: 'mention', mentionUserId: VIEWER },
      { kind: 'text', text: 'No longer tagged', mentions: [{ id: OTHER, username: 'other' }] },
    ],
    hidden_mentions: [VIEWER, { id: OTHER, username: 'other' }],
  };
  const rows = (await db.query('select * from story_payload_mentions($1) order by user_id', [JSON.stringify(payload)])).rows;
  assert.deepEqual(rows, [{ user_id: VIEWER, visible: true }, { user_id: OTHER, visible: false }]);
  delete payload.hidden_mentions;
  assert.deepEqual((await db.query('select * from story_payload_mentions($1)', [JSON.stringify(payload)])).rows, [{ user_id: VIEWER, visible: true }]);
});

test('atomic story publication saves validated text and hidden mentions with one notification on retry', async () => {
  const request = id();
  const payload = {
    media_type: 'text', text_background: { color: '#123456' },
    stickers_json: [{ id: 'text-1', kind: 'text', nx: 0.5, ny: 0.5, text: 'Hello @viewer', mentions: [{ id: VIEWER, username: 'viewer' }] }],
    hidden_mentions: [{ id: OTHER, username: 'other' }], allow_mention_reshare: false,
  };
  const publish = () => as(OWNER, () => db.query('select publish_story_v2($1,$2,$3) id', [OWNER, request, JSON.stringify(payload)]));
  const first = (await publish()).rows[0].id;
  assert.equal((await publish()).rows[0].id, first);
  assert.deepEqual((await db.query('select mentioned_user_id,visible,allow_reshare from story_mentions order by mentioned_user_id')).rows, [
    { mentioned_user_id: VIEWER, visible: true, allow_reshare: false },
    { mentioned_user_id: OTHER, visible: false, allow_reshare: false },
  ]);
  assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n, 2);
  payload.stickers_json[0].text = 'Edited after first publication';
  await assert.rejects(publish, /PUBLICATION_CONFLICT/);
});


test('story replies publish atomically, retain the legacy default, and participate in safe retry identity', async () => {
  const request = id(), payload = { media_type: 'text', text_background: { colors: ['#111518','#41474f'] }, stickers_json: [], allow_replies: false };
  const publish = (key, value, user = OWNER, expected = OWNER) => as(user, () => db.query('select publish_story_v2($1,$2,$3) id', [expected,key,JSON.stringify(value)])).then(result => result.rows[0].id);
  const first = await publish(request,payload); assert.equal(await publish(request,payload),first);
  const record = await db.query('select allow_replies from stories where id=$1',[first]); assert.equal(record.rows[0].allow_replies,false);
  assert.equal((await db.query('select count(*)::int count from stories')).rows[0].count,1);
  await assert.rejects(publish(request,{ ...payload, allow_replies: true }), /PUBLICATION_CONFLICT/);
  const { allow_replies, ...legacy } = payload;
  const legacyId = await publish(id(),legacy); assert.equal((await db.query('select allow_replies from stories where id=$1',[legacyId])).rows[0].allow_replies,true);
  for (const invalid of ['false',null,0,{}]) await assert.rejects(publish(id(),{ ...payload,allow_replies:invalid }), /INVALID_REPLY_SETTING/);
  await assert.rejects(publish(id(),payload,VIEWER), /ACCOUNT_CHANGED/);
  assert.equal((await db.query('select count(*)::int count from stories')).rows[0].count,2);
});
test('draft reply choices persist and omitted values keep the previous default', async () => {
  await db.query('insert into story_drafts(id,user_id,allow_replies) values($1,$2,false)',[id(),OWNER]);
  await db.query('insert into story_drafts(id,user_id) values($1,$2)',[id(),OWNER]);
  const result = await db.query('select allow_replies from story_drafts order by allow_replies');
  assert.deepEqual(result.rows.map(row => row.allow_replies),[false,true]);
});


test('visual-only publisher works without audio infrastructure, rejects added sound, and preserves recorded video controls', { skip: !visualOnly }, async () => {
  const base={media_type:'video',media_url:`https://example.supabase.co/storage/v1/object/public/story-media/${OWNER}/capture.mp4`,duration_sec:10,stickers_json:[],media_transform:{trimStart:2,trimEnd:8,mix:{orig:63}},audio_draft:null};
  const publish=(request,payload)=>as(OWNER,()=>db.query('select publish_story_v2($1,$2,$3) id',[OWNER,request,JSON.stringify(payload)]));
  const request=id(),sid=(await publish(request,base)).rows[0].id;
  assert.equal((await publish(request,base)).rows[0].id,sid);
  const record=(await db.query('select media_transform,audio_url from stories where id=$1',[sid])).rows[0];
  assert.equal(record.audio_url,null);assert.equal(record.media_transform.mix.orig,63);assert.equal(record.media_transform.trimStart,2);
  for(const audio of [{kind:'sound',soundId:OTHER},{kind:'voiceover',url:'https://media.test/audio',rightsAttested:true},{},false]) {
    await assert.rejects(publish(id(),{...base,audio_draft:audio}), /MUSIC_UNAVAILABLE/);
  }
  assert.equal((await db.query('select count(*)::int n from stories')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from story_ops.publications')).rows[0].n,1);
  assert.equal((await db.query("select to_regprocedure('public.resolve_story_soundtrack(jsonb)') is null and to_regprocedure('public.publish_story_sound(uuid,boolean)') is null as absent")).rows[0].absent,true);
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='story_drafts' and column_name='audio_draft'")).rows[0].n,0);
});

test('public post cards replace forged voice and trim fields with the canonical creator recipe',async()=>{
 const p=await post();
 await db.query("update post_media set url='https://media.test/voice.mp4',media_type='video',edit=$2::jsonb where id=$1",[p.mid,JSON.stringify({speed:1.5,voiceEffect:'deep',muted:false,trimStart:2.25,trimEnd:8.5,soundtrack:{soundId:'unavailable'}})]);
 const result=await sharePost(p.pid,VIEWER,VIEWER,{postMediaPlayback:{speed:99,voiceEffect:'forged',muted:true,trimStart:0,trimEnd:99,soundtrack:{url:'forged'}}});
 const recipe=result.rows[0].stickers_json[0].postMediaPlayback;
 assert.deepEqual(recipe,{speed:1.5,voiceEffect:'deep',muted:false,trimStart:2.25,trimEnd:8.5});
});
test('malformed canonical voice fields normalize without attaching media or music supplied by the caller',async()=>{
 const p=await post();
 await db.query('update post_media set edit=$2::jsonb where id=$1',[p.mid,JSON.stringify({speed:99,voiceEffect:'not-a-preset',muted:'true',trimStart:-20,trimEnd:'invalid'})]);
 const result=await sharePost(p.pid,VIEWER,VIEWER,{postMediaPlayback:{voiceEffect:'chipmunk',soundtrack:{url:'forged'}}});
 assert.deepEqual(result.rows[0].stickers_json[0].postMediaPlayback,{speed:3,voiceEffect:'original',muted:false,trimStart:0,trimEnd:null});
});
