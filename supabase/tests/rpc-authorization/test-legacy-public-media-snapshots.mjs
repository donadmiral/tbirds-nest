import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions, loadLiveSchema } from './live-schema-fixture.mjs';

const root = new URL('../../../', import.meta.url);
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const X = '10000000-0000-4000-8000-000000000003';
const origin = 'https://prlkikhckbifseosbukl.supabase.co';
const records = Array.from({ length: 11 }, (_, index) => {
  const kind = index < 5 || index === 10 ? 'post' : 'story';
  const bucket = kind === 'post' ? 'post-media' : 'story-media';
  const path = `${A}/legacy-${index}.jpg`;
  return { kind, bucket, path, id: randomUUID(), object: randomUUID(), url: `${origin}/storage/v1/object/public/${bucket}/${path}` };
});
const post = records[0];
const story = records[5];
const unreviewed = records[10];
let db;

async function as(uid, sql, args = [], role = 'authenticated') {
  await db.exec('savepoint caller_request');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid || '']);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })]);
    const result = (await db.query(sql, args)).rows;
    await db.exec('reset role; release savepoint caller_request');
    return result;
  } catch (error) {
    await db.exec('rollback to savepoint caller_request; release savepoint caller_request');
    throw error;
  }
}
async function manifest(uid = B, kind = post.kind, id = post.id) {
  return as(uid, 'select * from public.content_media_manifest($1::jsonb)', [JSON.stringify([{ kind, id }])]);
}

test.before(async () => {
  db = new PGlite({ extensions });
  await loadLiveSchema(db);
  await db.exec("alter table auth.users add column if not exists created_at timestamptz default now(); alter table storage.objects add column version text; alter table storage.objects add column if not exists user_metadata jsonb; grant usage on schema auth to authenticated,anon; insert into storage.buckets(id,name,public) values('post-media','post-media',true),('story-media','story-media',true),('chat-media','chat-media',true),('chat-files','chat-files',true);");
  for (const [id, name] of [[A, 'owner'], [B, 'viewer'], [X, 'other']]) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${name}@example.test`]);
    await db.query("insert into public.profiles(id,email,username,profile_visibility) values($1,$2,$3,'public') on conflict(id) do update set username=excluded.username,profile_visibility='public'", [id, `${name}@example.test`, name]);
  }
  // These are synthetic pre-existing publications, before the new binding
  // guards exist. Storage ownership is intentionally unknown, as in production.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [A]);
  for (const record of records) {
    await db.query('insert into storage.objects(id,bucket_id,name,version) values($1,$2,$3,$4)', [record.object, record.bucket, record.path, 'reviewed-version-1']);
    if (record.kind === 'post') {
      await db.query("insert into public.posts(id,user_id,media_url,audience,created_at) values($1,$2,$3,'everyone','2026-09-01T00:00:00Z')", [record.id, A, record.url]);
    } else {
      await db.query("insert into public.stories(id,user_id,media_url,media_type,audience,created_at,expires_at) values($1,$2,$3,'image','everyone','2026-09-01T00:00:00Z',now()+interval '1 day')", [record.id, A, record.url]);
    }
  }
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  const plan = JSON.parse(await readFile(new URL('supabase/ops/production-rollout-20261029.json', root), 'utf8'));
  for (const unit of plan.units) {
    const sources = await Promise.all(unit.files.map(file => readFile(new URL(file.path, root), 'utf8')));
    if (unit.legacySnapshotRegistry === true) {
      // Only the ten review fingerprints are fixture substitutions. The same
      // candidate query, exact-match whitelist and all runtime SQL are executed.
      const fingerprints = [];
      for (const record of records.slice(0, 10)) {
        fingerprints.push((await db.query("select encode(extensions.digest(concat_ws(chr(31),$1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text),'sha256'),'hex') as fingerprint", [record.kind, record.id, A, record.object, record.bucket, record.path, record.url, 'reviewed-version-1'])).rows[0].fingerprint);
      }
      let index = 0;
      const fixtureSql = sources[0].replace(/'[a-f0-9]{64}'/g, () => `'${fingerprints[index++]}'`);
      assert.equal(index, 10);
      await db.exec(fixtureSql);
    } else {
      await db.exec(sources.length > 1 ? `begin;\n${sources.join('\n')}\ncommit;` : sources[0]);
    }
  }
});
test.beforeEach(() => db.exec('begin'));
test.afterEach(() => db.exec('rollback'));
test.after(() => db.close());

test('only the ten approved pairs are captured, without assigning any uploader ownership', async () => {
  assert.equal((await db.query('select count(*)::int as n from content_media_legacy.snapshots')).rows[0].n, 10);
  assert.equal((await db.query('select count(*)::int as n from public.content_media_bindings')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int as n from storage.objects where owner_id is not null or owner is not null')).rows[0].n, 0);
  assert.equal((await manifest()).length, 1);
  assert.equal((await manifest(B, 'story', story.id)).length, 1);
  assert.equal((await manifest(B, 'post', unreviewed.id)).length, 0);
});

test('current audience and private profile changes still control historical post reads', async () => {
  await db.query("update public.posts set audience='followers' where id=$1", [post.id]);
  assert.equal((await manifest()).length, 0);
  assert.equal((await manifest(A)).length, 1);
  await db.query("update public.posts set audience='everyone' where id=$1", [post.id]);
  await db.query("update public.profiles set profile_visibility='private' where id=$1", [A]);
  assert.equal((await manifest()).length, 0);
  assert.equal((await manifest(A)).length, 1);
});

test('blocks in either direction deny snapshot media', async () => {
  for (const pair of [[A, B], [B, A]]) {
    await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)', pair);
    assert.equal((await manifest()).length, 0);
    await db.query('delete from public.blocked_users where blocker_id=$1 and blocked_id=$2', pair);
  }
});

test('new publications cannot reuse the ownerless object through a snapshot', async () => {
  for (const actor of [A, X]) {
    await assert.rejects(() => as(actor, "insert into public.posts(id,user_id,media_url,audience) values($1,$2,$3,'everyone')", [randomUUID(), actor, post.url]), /Media must belong/);
  }
  assert.equal((await db.query('select count(*)::int as n from content_media_legacy.snapshots')).rows[0].n, 10);
});

test('unreviewed legacy and newly written rows do not gain signing or upload rights', async () => {
  assert.equal((await manifest(A, 'post', unreviewed.id)).length, 0);
  assert.equal((await as(A, 'select * from public.content_upload_manifest($1::jsonb)', [JSON.stringify([post.url])])).length, 0);
  await assert.rejects(() => as(A, 'select * from content_media_legacy.snapshots'), /permission denied/);
  await assert.rejects(() => as(A, 'select content_media_legacy.allows_read($1,$2,$3,$4,$5,$6)', ['post', post.id, A, post.url, post.bucket, post.path]), /permission denied/);
});

test('a changed version, conflicting owner, missing object or private bucket fails closed', async () => {
  await db.query("update storage.objects set version='replacement-version' where id=$1", [post.object]);
  assert.equal((await manifest()).length, 0);
  await db.query("update storage.objects set version='reviewed-version-1' where id=$1", [post.object]);
  await db.query('update storage.objects set owner_id=$1 where id=$2', [X, post.object]);
  assert.equal((await manifest()).length, 0);
  await db.query('update storage.objects set owner_id=null where id=$1', [post.object]);
  await db.query('update storage.buckets set public=false where id=$1', [post.bucket]);
  assert.equal((await manifest()).length, 0);
  await db.query('update storage.buckets set public=true where id=$1', [post.bucket]);
  await db.query('delete from storage.objects where id=$1', [post.object]);
  assert.equal((await manifest()).length, 0);
});

test('deleting and recreating an entity cannot revive its previous snapshot', async () => {
  await db.query('delete from public.posts where id=$1', [post.id]);
  assert.equal((await manifest()).length, 0);
  assert.ok((await db.query('select revoked_at from content_media_legacy.snapshots where entity_id=$1', [post.id])).rows[0].revoked_at);
  // Simulate a privileged restore with the old ID and timestamp. Its former
  // snapshot stays revoked even though all other visible fields match again.
  await db.exec('alter table public.posts disable trigger bind_post_media_objects');
  await db.query("insert into public.posts(id,user_id,media_url,audience,created_at) values($1,$2,$3,'everyone','2026-09-01T00:00:00Z')", [post.id, A, post.url]);
  await db.exec('alter table public.posts enable trigger bind_post_media_objects');
  assert.equal((await manifest()).length, 0);
});

test('story expiry is respected while an owned archived story remains readable through an authorized book', async () => {
  await db.query("update public.stories set expires_at=now()-interval '1 day' where id=$1", [story.id]);
  assert.equal((await manifest(B, 'story', story.id)).length, 0);
  const book = (await as(A, "select public.create_memory_book_presentation('Legacy memories','cream','postcard','',$1::uuid[],$2) as id", [[story.id], story.id]))[0].id;
  await db.query("update public.memory_albums set audience='only_me' where id=$1", [book]);
  assert.equal((await manifest(B, 'memory_album', book)).length, 0);
  assert.equal((await manifest(A, 'memory_album', book)).length, 1);
  await db.query("update public.memory_albums set audience='profile' where id=$1", [book]);
  assert.equal((await manifest(B, 'memory_album', book)).length, 1);
  await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)', [A, B]);
  assert.equal((await manifest(B, 'memory_album', book)).length, 0);
});

test('removing the exact current reference or changing its parent does not authorize another entity', async () => {
  await db.query('update public.posts set media_url=null where id=$1', [post.id]);
  assert.equal((await manifest()).length, 0);
  assert.equal((await manifest(B, 'post', story.id)).length, 0);
});

test('authenticated users cannot read or modify the registry, and snapshot evidence is immutable', async () => {
  await assert.rejects(() => as(B, 'update content_media_legacy.snapshots set object_version=$1', ['changed']), /permission denied/);
  await db.exec('savepoint immutable_check');
  await assert.rejects(() => db.query('update content_media_legacy.snapshots set object_version=$1 where entity_id=$2', ['changed', post.id]), /LEGACY_MEDIA_SNAPSHOT_IMMUTABLE/);
  await db.exec('rollback to savepoint immutable_check; release savepoint immutable_check');
  assert.equal((await manifest()).length, 1);
});

test('anonymous calls cannot use the finite legacy exceptions', async () => {
  await assert.rejects(() => as(null, 'select * from public.content_media_manifest($1::jsonb)', [JSON.stringify([{ kind: 'post', id: post.id }])], 'anon'), /permission denied/);
  await assert.rejects(() => manifest(null), /Authentication required/);
});
