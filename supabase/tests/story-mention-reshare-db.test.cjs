const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const OWNER = '10000000-0000-4000-8000-000000000001', VIEWER = '10000000-0000-4000-8000-000000000002', OTHER = '10000000-0000-4000-8000-000000000003';
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
    create table profiles(id uuid primary key,full_name text,username text,avatar_url text,profile_visibility text default 'public',deactivated_at timestamptz);
    create table blocked_users(blocker_id uuid,blocked_id uuid);
    create table follows(follower_id uuid,following_id uuid);
    create table close_friends(owner_id uuid,friend_id uuid);
    create table story_hidden_from(story_id uuid,user_id uuid);
    create table story_shared_with(story_id uuid,user_id uuid);
    create table stories(id uuid primary key default gen_random_uuid(),user_id uuid,created_at timestamptz default now(),expires_at timestamptz default now()+interval '24 hours',audience text default 'everyone',allow_sharing boolean default true,caption text,media_url text,media_type text default 'image',thumbnail_url text,stickers_json jsonb,filter_id text,media_transform jsonb,text_background jsonb,duration_sec int,audio_url text,audio_title text,audio_source text,audio_duration_sec int);
    create schema story_ops;
    create table story_ops.publications(request_id uuid primary key,user_id uuid,payload_hash text,story_id uuid,created_at timestamptz);
    create table story_drafts(id uuid,user_id uuid);
    create function resolve_story_soundtrack(jsonb) returns jsonb language sql as $$select null::jsonb$$;
    create table story_mentions(id uuid primary key default gen_random_uuid(),story_id uuid,mentioned_user_id uuid,mentioned_by_user_id uuid,visible boolean default true,allow_reshare boolean default true,reshared_at timestamptz,created_at timestamptz default now(),unique(story_id,mentioned_user_id));
    create table notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,actor_id uuid,type text,message text,body_preview text,data jsonb,account_type text,read_at timestamptz);
    create table posts(id uuid primary key,user_id uuid,content text,audience text);
    create table post_media(id uuid primary key,post_id uuid);
    create table post_media_tags(id uuid primary key default gen_random_uuid(),post_id uuid,media_id uuid,user_id uuid,nx double precision,ny double precision,unique(media_id,user_id));
    create function can_view_post(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.posts where id=$1 and (user_id=auth.uid() or audience='everyone'))$$;
    alter table post_media_tags enable row level security;
    create policy legacy_tag_read on post_media_tags for select to authenticated using(true);
    create policy legacy_tag_write on post_media_tags for insert to authenticated with check(true);
    create policy legacy_tag_update on post_media_tags for update to authenticated using(true) with check(true);
    grant select,insert,update,delete on all tables in schema public to authenticated;
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261028152200_story_mention_reshare_quality.sql'), 'utf8'));
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
  const p=await post(),saved=await tag(p);const second=id();await db.query('insert into post_media values($1,$2)',[second,p.pid]);await tag({...p,mid:second});
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
