const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const objectId = id(1), author = id(2), entity = id(3), file = `${author}/capture.mp4`;
const url = `https://project.test/storage/v1/object/public/story-media/${file}`;
let db;
const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0];
const jwt = role => db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role })]);
const claim = () => value('select claim_faststart_video_remux($1,$2,$3,$4)', ['story-media', file, objectId, 'version-1']);
const check = lease => value('select check_faststart_video_remux($1)', [lease.lease_id]);
const marked = lease => JSON.stringify({ caption: 'kept', platinum_faststart_lease: lease.lease_id });
const write = (lease, version = 'remux-version') => db.query('update storage.objects set version=$1,user_metadata=$2 where id=$3', [version, marked(lease), objectId]);
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth to anon,authenticated,service_role;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,version text,
      owner uuid,owner_id text,metadata jsonb,user_metadata jsonb,unique(bucket_id,name));
    create table public.posts(id uuid primary key,url text);
    create table public.stories(id uuid primary key,url text);
    create table public.story_drafts(id uuid primary key,url text);
    create table public.content_media_bindings(entity_kind text,entity_id uuid,bucket_id text,object_path text,uploader_id uuid,
      primary key(entity_kind,entity_id,bucket_id,object_path));
    create function public.content_media_document(k text,i uuid) returns jsonb language sql stable as $$
      select jsonb_build_object('media_url',url) from (
        select url from public.posts where k='post' and id=i union all select url from public.stories where k='story' and id=i
        union all select url from public.story_drafts where k='story_draft' and id=i) refs limit 1$$;
    create function public.content_media_strings(doc jsonb) returns setof text language sql immutable as $$
      select distinct value #>> '{}' from jsonb_path_query(coalesce(doc,'{}'::jsonb),'lax $.** ? (@.type() == "string")') value$$;
    create schema content_media_legacy;
    create table content_media_legacy.snapshots(object_id uuid,object_version text);
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261029051017_faststart_registered_provenance.sql'), 'utf8'));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('reset role');
  await jwt('authenticated');
  await db.exec('truncate storage.objects,posts,stories,story_drafts,content_media_bindings,content_media_legacy.snapshots,content_media_processing.faststart_leases');
  await db.query('insert into storage.objects(id,bucket_id,name,version,owner,owner_id,metadata,user_metadata) values($1,$2,$3,$4,$5::uuid,$5::uuid::text,$6,$7)',
    [objectId, 'story-media', file, 'version-1', author, JSON.stringify({ eTag: 'source-etag' }), JSON.stringify({ caption: 'kept' })]);
  await db.query('insert into stories values($1,$2)', [entity, url]);
  await db.query('insert into content_media_bindings values($1,$2,$3,$4,$5)', ['story', entity, 'story-media', file, author]);
  await jwt('service_role');
});
test('only the service role may claim/check/release; even service cannot read private lease rows', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(claim(), /permission denied/);
    await assert.rejects(value('select check_faststart_video_remux($1)', [id(90)]), /permission denied/);
    await assert.rejects(value('select release_faststart_video_remux($1)', [id(90)]), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.ok((await claim()).lease_id);
  await assert.rejects(db.query('select * from content_media_processing.faststart_leases'), /permission denied/);
  await db.exec('reset role');
});
test('unbound, draft-only and snapshot-only media never create a processing lease', async () => {
  await db.exec('delete from content_media_bindings');
  assert.equal(await claim(), null);
  await db.query('insert into content_media_legacy.snapshots values($1,$2)', [objectId, 'version-1']);
  assert.equal(await claim(), null);
  await db.query('insert into story_drafts values($1,$2)', [entity, url]);
  await db.query('insert into content_media_bindings values($1,$2,$3,$4,$5)', ['story_draft', entity, 'story-media', file, author]);
  assert.equal(await claim(), null);
  assert.equal(await value('select owner_id from storage.objects'), author);
  assert.equal(await value('select count(*) from content_media_processing.faststart_leases'), 0);
});
test('the object id, current version, media path and live published reference must all match', async () => {
  assert.equal(await value('select claim_faststart_video_remux($1,$2,$3,$4)', ['story-media', file, id(4), 'version-1']), null);
  assert.equal(await value('select claim_faststart_video_remux($1,$2,$3,$4)', ['story-media', file, objectId, 'old-version']), null);
  assert.equal(await value('select claim_faststart_video_remux($1,$2,$3,$4)', ['chat-media', file, objectId, 'version-1']), null);
  await db.query('update stories set url=$1', [url + '/other.mp4']); assert.equal(await claim(), null);
  await db.query('update stories set url=$1', [url]);
  await db.exec("update storage.objects set metadata='{}'"); assert.equal(await claim(), null);
});
test('a conflicting non-null uploader refuses processing while a previously verified binding survives Storage owner omission', async () => {
  await db.query('update storage.objects set owner_id=$1', [id(50)]); assert.equal(await claim(), null);
  await db.exec('update storage.objects set owner_id=null,owner=null');
  assert.ok((await claim()).lease_id);
});
test('the Storage permission probe rolls back, and the guarded final commit preserves the binding and user metadata', async () => {
  const lease = await claim(); assert.equal(await check(lease), true);
  await db.exec('begin; savepoint permission_probe');
  await db.query(`insert into storage.objects(bucket_id,name,version,user_metadata) values($1,$2,'1',$3)
    on conflict(bucket_id,name) do update set version=excluded.version,user_metadata=excluded.user_metadata`, ['story-media', file, marked(lease)]);
  await db.exec('rollback to savepoint permission_probe; commit');
  assert.equal(await check(lease), true);
  await write(lease);
  assert.equal(await check(lease), false);
  assert.equal(await value('select version from storage.objects'), 'remux-version');
  assert.deepEqual(await value('select user_metadata from storage.objects'), { caption: 'kept' });
  assert.equal(await value('select owner_id from storage.objects'), author);
  assert.equal(await value('select count(*) from content_media_bindings'), 1);
  assert.equal(await value('select content_media_processing.has_published_binding($1,$2)', ['story-media', file]), true);
  await assert.rejects(write(lease, 'replayed-version'), /FASTSTART_LEASE_INVALID/);
});
test('a replacement between successful preflight and final write rejects the stale processor atomically', async () => {
  const lease = await claim(); assert.equal(await check(lease), true);
  await jwt('authenticated'); await db.exec("update storage.objects set version='user-replacement'"); await jwt('service_role');
  await assert.rejects(write(lease), /FASTSTART_OBJECT_CHANGED/);
  assert.equal(await value('select version from storage.objects'), 'user-replacement');
  assert.equal(await check(lease), false);
});
test('a deleted object cannot be recreated by a delayed processing upsert', async () => {
  const lease = await claim(); await db.exec('delete from storage.objects');
  await assert.rejects(db.query('insert into storage.objects(id,bucket_id,name,version,user_metadata) values($1,$2,$3,$4,$5)',
    [id(99), 'story-media', file, 'remux-version', marked(lease)]), /FASTSTART_(OBJECT_CHANGED|LEASE_INVALID)/);
  assert.equal(await value('select count(*) from storage.objects'), 0);
});
test('an unexpected versioned insert path cannot bypass the guarded conflict update', async () => {
  const lease = await claim(); await db.exec('begin');
  try {
    await db.exec('alter table storage.objects drop constraint objects_bucket_id_name_key');
    await assert.rejects(db.query('insert into storage.objects(id,bucket_id,name,version,user_metadata) values($1,$2,$3,$4,$5)',
      [id(99), 'story-media', file, 'unexpected-insert', marked(lease)]), /FASTSTART_IN_PLACE_UPDATE_REQUIRED/);
  } finally { await db.exec('rollback'); }
  assert.equal(await value('select count(*) from storage.objects'), 1);
  assert.equal(await value('select version from storage.objects'), 'version-1');
});
test('expired permission and a removed current binding both prevent the final version commit', async () => {
  let lease = await claim();
  await db.exec("update content_media_processing.faststart_leases set expires_at=now()-interval '1 second'");
  assert.equal(await check(lease), false); await assert.rejects(write(lease), /FASTSTART_LEASE_INVALID/);
  lease = await claim(); await db.exec('delete from content_media_bindings');
  assert.equal(await check(lease), false); await assert.rejects(write(lease), /FASTSTART_LEASE_INVALID/);
  assert.equal(await value('select version from storage.objects'), 'version-1');
});
test('two processing leases cannot both replace the same generation', async () => {
  const first = await claim(), second = await claim(); await write(first);
  await assert.rejects(write(second, 'second-remux'), /FASTSTART_OBJECT_CHANGED/);
  assert.equal(await value('select version from storage.objects'), 'remux-version');
});
test('old unmarked service rewrites are refused; new uploads, user writes and chat objects retain existing behavior', async () => {
  await assert.rejects(db.exec("update storage.objects set version='unmarked-remux'"), /FASTSTART_REGISTERED_LEASE_REQUIRED/);
  await db.query('insert into storage.objects(id,bucket_id,name,version) values($1,$2,$3,$4)', [id(5), 'story-media', `${author}/new.mp4`, 'new-upload']);
  await db.query('insert into storage.objects(id,bucket_id,name,version) values($1,$2,$3,$4)', [id(6), 'chat-media', `${author}/chat.mp4`, 'chat-original']);
  await db.exec("update storage.objects set version='chat-update' where bucket_id='chat-media'");
  await jwt('authenticated'); await db.query('update storage.objects set version=$1 where id=$2', ['owner-upload', objectId]);
  assert.equal(await value('select version from storage.objects where id=$1', [objectId]), 'owner-upload');
  await assert.rejects(write({ lease_id: id(8) }), /FASTSTART_SERVICE_LEASE_REQUIRED/);
});
