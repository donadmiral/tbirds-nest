import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions, loadLiveSchema } from './live-schema-fixture.mjs';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const X = '10000000-0000-4000-8000-000000000003';
const C = '20000000-0000-4000-8000-000000000001';
const url = `https://example.supabase.co/storage/v1/object/public/chat-media/${A}/test.jpg`;
const source = name => readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
let db;
let message;

async function as(uid, sql, args = [], role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid || '']);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid })]);
    const result = (await db.query(sql, args)).rows;
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}
async function open(uid = B, request = randomUUID(), id = message) {
  return (await as(uid, 'select public.open_legacy_chat_media($1,$2) as value', [id, request]))[0].value;
}
async function consume(uid = B, id = message) {
  return (await as(uid, 'select * from public.consume_media_view($1)', [id]))[0];
}
async function views() {
  return (await db.query('select coalesce(sum(views),0)::int as count from public.message_views where message_id=$1', [message])).rows[0].count;
}

test.before(async () => {
  db = new PGlite({ extensions });
  await loadLiveSchema(db);
  await db.exec("grant usage on schema auth to authenticated,anon; insert into storage.buckets(id,name,public) values('chat-media','chat-media',true),('chat-files','chat-files',true);");
  const original = await source('20261022211236_message_call_access.sql');
  const bridge = await source('20261029045648_legacy_chat_media_compatibility.sql');
  // This is the actual production atomic unit, without a visible intermediate
  // state where the old endpoint unconditionally rejects installed clients.
  await db.exec(`begin;\n${original}\n${bridge}\ncommit;`);
  for (const [id, label] of [[A, 'sender'], [B, 'recipient'], [X, 'stranger']]) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${label}@example.test`]);
    await db.query('insert into public.profiles(id,email,username) values($1,$2,$3) on conflict(id) do update set username=excluded.username', [id, `${label}@example.test`, label]);
  }
  await db.query('insert into public.conversations(id,user_1,user_2) values($1,$2,$3)', [C, A, B]);
});
test.beforeEach(async () => {
  message = randomUUID();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [A]);
  await db.query("insert into public.messages(id,conversation_id,sender_id,receiver_id,media_url,media_type,view_limit) values($1,$2,$3,$4,$5,'image',2)", [message, C, A, B, url]);
  await db.query("select set_config('request.jwt.claim.sub','',false)");
});
test.after(() => db.close());

test('modern compatibility grant returns exact contract and original expiry on retry', async () => {
  const request = randomUUID();
  const first = await open(B, request);
  assert.deepEqual(Object.keys(first).sort(), ['expiresAt', 'mediaType', 'remaining', 'requestId', 'url']);
  assert.equal(first.url, url);
  assert.equal(first.mediaType, 'image');
  assert.equal(first.requestId, request);
  assert.equal(first.remaining, 1);
  assert.ok(Date.parse(first.expiresAt) > Date.now());
  assert.ok(Date.parse(first.expiresAt) <= Date.now() + 120_000);
  assert.deepEqual(await open(B, request), first);
  assert.equal(await views(), 1);
});

test('old and new clients share the same counters without changing the old result shape', async () => {
  assert.deepEqual(await consume(), { url, remaining: 1 });
  const next = await open();
  assert.equal(next.remaining, 0);
  assert.deepEqual(await consume(), { url: null, remaining: 0 });
  assert.equal(await open(), null);
  assert.equal(await views(), 2);
});

test('sender, stranger and missing identities cannot consume a view', async () => {
  for (const uid of [A, X, null]) assert.equal(await open(uid), null);
  assert.deepEqual(await consume(A), { url: null, remaining: 0 });
  assert.deepEqual(await consume(X), { url: null, remaining: 0 });
  await assert.rejects(() => consume(null), /Authentication required/);
  assert.equal(await views(), 0);
});

test('anonymous role cannot call either public compatibility endpoint', async () => {
  await assert.rejects(() => as(null, 'select public.open_legacy_chat_media($1,$2)', [message, randomUUID()], 'anon'), /permission denied/);
  await assert.rejects(() => as(null, 'select * from public.consume_media_view($1)', [message], 'anon'), /permission denied/);
  assert.equal(await views(), 0);
});

test('expired request is denied without extending expiry or consuming another view', async () => {
  const request = randomUUID();
  await open(B, request);
  await db.query("update public.chat_media_view_grants set expires_at=now()-interval '1 second' where user_id=$1 and request_id=$2", [B, request]);
  assert.equal(await open(B, request), null);
  assert.equal(await views(), 1);
  assert.equal((await open()).remaining, 0);
});

test('request IDs are user and message bound', async () => {
  const request = randomUUID();
  await open(B, request);
  assert.equal(await open(X, request), null);
  assert.equal(await open(B, request, randomUUID()), null);
  assert.equal(await views(), 1);
});

test('new-grant and legacy reads respect delete-for-everyone', async () => {
  const request = randomUUID();
  await open(B, request);
  await db.query('update public.messages set deleted_at=now() where id=$1', [message]);
  assert.equal(await open(B, request), null);
  assert.deepEqual(await consume(), { url: null, remaining: 0 });
  assert.equal(await views(), 1);
});

test('unsupported media types are rejected before counting a view', async () => {
  // Simulate a pre-migration legacy audio attachment, not a client-side rewrite.
  await db.exec('alter table public.messages disable trigger chat_media_reference_guard');
  await db.query("update public.messages set media_type='audio' where id=$1", [message]);
  await db.exec('alter table public.messages enable trigger chat_media_reference_guard');
  assert.equal(await open(), null);
  assert.equal(await views(), 0);
});

test('legacy foreign-owner object is denied by the real claim authorization', async () => {
  await db.exec('alter table public.messages disable trigger chat_media_reference_guard');
  await db.query('update public.messages set media_url=$1,media_access_verified=false where id=$2', [url.replace(A, X), message]);
  await db.exec('alter table public.messages enable trigger chat_media_reference_guard');
  assert.equal(await open(), null);
  assert.deepEqual(await consume(), { url: null, remaining: 0 });
  assert.equal(await views(), 0);
});

test('bucket visibility and existing message data remain unchanged by compatibility migration', async () => {
  const buckets = (await db.query("select id,public from storage.buckets where id in ('chat-media','chat-files') order by id")).rows;
  assert.deepEqual(buckets, [{ id: 'chat-files', public: true }, { id: 'chat-media', public: true }]);
  assert.equal((await db.query('select media_url from public.messages where id=$1', [message])).rows[0].media_url, url);
  assert.equal((await db.query("select to_regnamespace('private_media') is null as absent")).rows[0].absent, true);
});

test('private-session installations fail closed even if this bridge is applied later', async () => {
  await db.exec('create schema private_media');
  try {
    await db.exec(await source('20261029045648_legacy_chat_media_compatibility.sql'));
    assert.equal(await open(), null);
    await assert.rejects(() => consume(), /Update Platinum Circles/);
    assert.equal(await views(), 0);
  } finally {
    await db.exec('drop schema private_media');
  }
});
