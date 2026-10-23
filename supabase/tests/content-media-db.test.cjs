const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || './rpc-authorization/node_modules/@electric-sql/pglite');
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const P = '20000000-0000-4000-8000-000000000001', S = '30000000-0000-4000-8000-000000000001';
const url = `https://example.supabase.co/storage/v1/object/public/post-media/${B}/photo.jpg`;
let db;
async function identity(uid) { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']); }
async function manifest(uid, refs) {
  await identity(uid); await db.exec('set role authenticated');
  try { return (await db.query('select * from content_media_manifest($1::jsonb)', [JSON.stringify(refs)])).rows; }
  finally { await db.exec('reset role'); }
}
test.before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key, profile_visibility text, is_verified boolean default false);
    create table close_friends(owner_id uuid,friend_id uuid);
    create table story_shared_with(story_id uuid,user_id uuid);
    create table story_hidden_from(story_id uuid,user_id uuid);
    create table memory_albums(id uuid primary key,user_id uuid,audience text);
    create table memory_album_access(owner_id uuid,member_id uuid,kind text);
    create table memory_pages(id uuid primary key,album_id uuid,story_id uuid,media_url text,thumbnail_url text);
    create table story_highlights(id uuid primary key,user_id uuid,cover_url text);
    create table story_highlight_items(highlight_id uuid,story_id uuid);
    create table follows(follower_id uuid,following_id uuid);
    create table blocked_users(blocker_id uuid,blocked_id uuid);
    create table community_members(community_id uuid,user_id uuid);
    create table post_mentions(post_id uuid,mentioned_user_id uuid);
    create table posts(id uuid primary key,user_id uuid,audience text default 'everyone',community_id uuid,is_exclusive boolean default false,archived_at timestamptz,media_url text,image_url text);
    create table post_media(id uuid primary key default gen_random_uuid(),post_id uuid,url text,edit jsonb);
    create table post_products(id uuid primary key default gen_random_uuid(),post_id uuid,image_url text);
    create table articles(id uuid primary key,linked_post_id uuid,current_revision_id uuid,cover_asset_id uuid);
    create table article_revisions(id uuid primary key,article_id uuid);
    create table article_blocks(id uuid primary key,revision_id uuid,content jsonb);
    create table media_assets(id uuid primary key,url text,thumbnail_url text);
    create table stories(id uuid primary key,user_id uuid,audience text default 'everyone',media_url text,thumbnail_url text,dual_front_url text,audio_url text,audio_source text,audio_title text,audio_duration_sec integer,stickers_json jsonb,media_transform jsonb,expires_at timestamptz default now()+interval '1 day');
    create table story_drafts(id uuid primary key,user_id uuid,media_url text,stickers_json jsonb,media_transform jsonb);
    create table story_sounds(id uuid primary key default gen_random_uuid(),owner_id uuid,title text,url text,duration_sec integer,source text,use_count integer default 0,created_at timestamptz default now());
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text);
    create function can_act_as(target uuid) returns boolean language sql stable as $$select auth.uid()=target$$;
    create function creator_has_active_subscription(creator uuid, viewer uuid) returns boolean language sql stable as $$select false$$;
    create function viewer_can_see_story(target uuid) returns boolean language sql stable as $$select exists(select 1 from public.stories where id=target and expires_at>now())$$;
    grant select on all tables in schema public to authenticated;
  `);
  const original = fs.readFileSync(path.join(__dirname, '../migrations/00000000000151_capture_functions.sql'), 'utf8');
  await db.exec(original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.can_view_post('), original.indexOf('CREATE OR REPLACE FUNCTION public.can_view_profile(')));
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261022211311_story_sound_rights.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261022211648_content_media_manifests.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261023190047_content_owner_upload_previews.sql'), 'utf8'));
});
test.beforeEach(async () => {
  await identity(null);
  await db.exec(`truncate memory_pages,memory_albums,memory_album_access,story_highlights,story_highlight_items,close_friends,story_shared_with,story_hidden_from,content_media_bindings,post_media,articles,article_revisions,article_blocks,media_assets,story_sounds,stories,story_drafts,posts,storage.objects,profiles,follows,blocked_users,community_members,post_mentions cascade;
    insert into profiles(id,profile_visibility) values('${A}','public'),('${B}','public');
    insert into storage.objects(bucket_id,name,owner_id) values('post-media','${B}/photo.jpg','${B}');`);
  await identity(B);
  await db.query('insert into posts(id,user_id,media_url) values($1,$2,$3)', [P, B, url]);
});
test.after(async () => db.close());
test('uploader-bound public content is in the authenticated manifest', async () => {
  const rows = await manifest(A, [{ kind: 'post', id: P }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].media_url, url);
});
test('a publisher cannot bind somebody else\'s object to their own post', async () => {
  await identity(A);
  await assert.rejects(() => db.query('insert into posts(id,user_id,media_url) values($1,$2,$3)', [S, A, url]), /Media must belong/);
});
test('private profiles and both block directions are checked beyond content visibility', async () => {
  await db.query("update profiles set profile_visibility='private' where id=$1", [B]);
  assert.equal((await manifest(A, [{ kind: 'post', id: P }])).length, 0);
  await db.query('insert into follows values($1,$2)', [A, B]);
  assert.equal((await manifest(A, [{ kind: 'post', id: P }])).length, 1);
  for (const pair of [[A, B], [B, A]]) {
    await db.query('insert into blocked_users values($1,$2)', pair);
    assert.equal((await manifest(A, [{ kind: 'post', id: P }])).length, 0);
    await db.exec('delete from blocked_users');
  }
});
test('removing an attachment immediately removes the old binding from manifests', async () => {
  await identity(B); await db.query('update posts set media_url=null where id=$1', [P]);
  assert.equal((await manifest(A, [{ kind: 'post', id: P }])).length, 0);
});
test('an accessible outer story does not authorize embedded private post media', async () => {
  await identity(A);
  await db.query('insert into stories(id,user_id,stickers_json) values($1,$2,$3)', [S, A, JSON.stringify([{ kind: 'post', postId: P, postMediaUrl: url }])]);
  await db.query("update posts set audience='followers' where id=$1", [P]);
  assert.equal((await manifest(A, [{ kind: 'story', id: S }, { kind: 'post', id: P }])).length, 0);
});
test('stories also enforce private profile and expiry outside their RPC', async () => {
  await identity(B);
  await db.query('insert into stories(id,user_id,media_url) values($1,$2,$3)', [S, B, url]);
  assert.equal((await manifest(A, [{ kind: 'story', id: S }])).length, 1);
  await db.query("update profiles set profile_visibility='private' where id=$1", [B]);
  assert.equal((await manifest(A, [{ kind: 'story', id: S }])).length, 0);
  await db.query('insert into follows values($1,$2)', [A, B]);
  await db.query("update stories set expires_at=now()-interval '1 second' where id=$1", [S]);
  assert.equal((await manifest(A, [{ kind: 'story', id: S }])).length, 0);
});
test('unauthenticated and excessive manifest requests fail closed', async () => {
  await assert.rejects(() => manifest(null, [{ kind: 'post', id: P }]), /Authentication required/);
  await assert.rejects(() => manifest(A, Array.from({ length: 101 }, () => ({ kind: 'post', id: P }))), /At most 100/);
});
test('exclusive and archived media fail closed for non-owners', async () => {
  await identity(B); await db.exec('update posts set is_exclusive=true');
  assert.equal((await manifest(A, [{ kind: 'post', id: P }])).length, 0);
  assert.equal((await manifest(B, [{ kind: 'post', id: P }])).length, 1);
  await db.exec('update posts set is_exclusive=false, archived_at=now()');
  assert.equal((await manifest(A, [{ kind: 'post', id: P }])).length, 0);
});
test('sound publication is owner-bound, attested and idempotent', async () => {
  await identity(B);
  await db.query("insert into stories(id,user_id,audio_url,audio_source,audio_duration_sec) values($1,$2,$3,'voiceover',5)", [S, B, url]);
  await assert.rejects(() => db.query('select publish_story_sound($1,false)', [S]), /Confirm/);
  const first = (await db.query('select publish_story_sound($1,true) as id', [S])).rows[0].id;
  const second = (await db.query('select publish_story_sound($1,true) as id', [S])).rows[0].id;
  assert.equal(first, second);
  await identity(A); await assert.rejects(() => db.query('select publish_story_sound($1,true)', [S]), /cannot share/);
});

test('draft previews are owner-only and cannot bind foreign media', async () => {
  await identity(B);
  await db.query('insert into story_drafts(id,user_id,media_url) values($1,$2,$3)', [S, B, url]);
  assert.equal((await manifest(B, [{ kind: 'story_draft', id: S }])).length, 1);
  assert.equal((await manifest(A, [{ kind: 'story_draft', id: S }])).length, 0);
  await identity(A);
  await assert.rejects(() => db.query('insert into story_drafts(id,user_id,media_url) values($1,$2,$3)', [P, A, url]), /Media must belong/);
  await identity(B);
  await db.query('update story_drafts set media_url=null where id=$1', [S]);
  assert.equal((await manifest(B, [{ kind: 'story_draft', id: S }])).length, 0);
});

test('album permissions authorize retained owner media without reopening expired stories', async () => {
  await identity(B);
  await db.query("insert into stories(id,user_id,media_url,expires_at) values($1,$2,$3,now()-interval '1 day')", [S,B,url]);
  await db.query("insert into memory_albums values($1,$2,'only_me')", [P,B]);
  await db.query('insert into memory_pages(id,album_id,story_id,media_url) values($1,$2,$3,$4)', [S,P,S,url]);
  assert.equal((await manifest(A,[{kind:'story',id:S}])).length,0);
  assert.equal((await manifest(A,[{kind:'memory_album',id:P}])).length,0);
  assert.equal((await manifest(B,[{kind:'memory_album',id:P}])).length,1);
  await db.query("update memory_albums set audience='custom'");
  await db.query("insert into memory_album_access values($1,$2,'allow')",[B,A]);
  assert.equal((await manifest(A,[{kind:'memory_album',id:P}])).length,1);
  await db.query("insert into memory_album_access values($1,$2,'block')",[B,A]);
  assert.equal((await manifest(A,[{kind:'memory_album',id:P}])).length,0);
});
test('highlights retain stories but preserve close-friend audience and reject foreign covers', async () => {
  await identity(B);
  await db.query("insert into stories(id,user_id,media_url,audience,expires_at) values($1,$2,$3,'close_friends',now()-interval '1 day')", [S,B,url]);
  await db.query('insert into story_highlights values($1,$2,null)',[P,B]);
  await db.query('insert into story_highlight_items values($1,$2)',[P,S]);
  assert.equal((await manifest(A,[{kind:'highlight',id:P}])).length,0);
  await db.query('insert into close_friends values($1,$2)',[B,A]);
  assert.equal((await manifest(A,[{kind:'highlight',id:P}])).length,1);
  await db.query('delete from story_highlight_items');
  await db.query('update story_highlights set user_id=$1,cover_url=$2',[A,url]);
  assert.equal((await manifest(A,[{kind:'highlight',id:P}])).length,0);
});

test('unpublished upload preview checks the actual storage owner and authentication', async () => {
  const query = async viewer => {
    await identity(viewer); await db.exec('set role authenticated');
    try { return (await db.query('select * from content_upload_manifest($1::jsonb)', [JSON.stringify([url])])).rows; }
    finally { await db.exec('reset role'); }
  };
  assert.equal((await query(B)).length, 1);
  assert.equal((await query(A)).length, 0);
  await assert.rejects(() => query(null), /Authentication required/);
  await identity(B);
  await assert.rejects(() => db.query('select * from content_upload_manifest($1::jsonb)',[JSON.stringify(Array(101).fill(url))]), /At most 100/);
});


test('cutover preflight distinguishes verified, unbound and missing objects', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../ops/check-content-media-cutover.sql'), 'utf8');
  assert.equal((await db.query(sql)).rows.length, 0);
  await db.exec('delete from content_media_bindings');
  let rows = (await db.query(sql)).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].issue, 'missing_authorized_binding');
  await db.exec('delete from storage.objects');
  rows = (await db.query(sql)).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].issue, 'missing_storage_object');
});


test('cutover preflight ignores prose and external URLs instead of reporting null objects', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../ops/check-content-media-cutover.sql'), 'utf8');
  await db.query('insert into post_media(post_id,url,edit) values($1,$2,$3)', [P,'https://cdn.example.com/public.jpg',JSON.stringify({caption:'A caption',filter:'none'})]);
  assert.equal((await db.query(sql)).rows.length, 0);
  await db.exec('delete from content_media_bindings');
  const rows = (await db.query(sql)).rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].bucket_id,'post-media');
  assert.equal(rows[0].object_path, `${B}/photo.jpg`);
});
