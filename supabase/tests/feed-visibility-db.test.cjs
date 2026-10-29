const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || './rpc-authorization/node_modules/@electric-sql/pglite');
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const P = '20000000-0000-4000-8000-000000000001', C = '30000000-0000-4000-8000-000000000001';
let db;
async function read(uid = A, ids = [P], role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
    const result = await db.query('select * from get_feed_visibility($1::uuid[])', [ids]);
    await db.exec('commit'); return result.rows;
  } catch (error) { await db.exec('rollback'); throw error; }
}
test.before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key, profile_visibility text, is_verified boolean default false);
    create table posts(id uuid primary key, user_id uuid, audience text, community_id uuid, is_exclusive boolean default false, archived_at timestamptz);
    create table follows(follower_id uuid, following_id uuid);
    create table blocked_users(blocker_id uuid, blocked_id uuid);
    create table muted_authors(user_id uuid, author_id uuid);
    create table hidden_posts(user_id uuid, post_id uuid);
    create table community_members(community_id uuid, user_id uuid);
    create table post_mentions(post_id uuid, mentioned_user_id uuid);
    alter table posts enable row level security;
    create policy visible_rows on posts for select to authenticated using(archived_at is null or user_id=auth.uid());
    grant select on all tables in schema public to authenticated;`);
  const original = fs.readFileSync(path.join(__dirname, '../migrations/00000000000151_capture_functions.sql'), 'utf8');
  const start = original.indexOf('CREATE OR REPLACE FUNCTION public.can_view_post(');
  const end = original.indexOf('CREATE OR REPLACE FUNCTION public.can_view_profile(', start);
  await db.exec(original.slice(start, end));
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261022211411_feed_snapshot_visibility.sql'), 'utf8'));
});
test.beforeEach(async () => {
  await db.exec(`truncate profiles, posts, follows, blocked_users, hidden_posts, muted_authors, community_members, post_mentions;
    insert into profiles(id,profile_visibility) values('${A}','public'),('${B}','public');
    insert into posts(id,user_id,audience) values('${P}','${B}','everyone');`);
});
test.after(async () => db.close());
test('public rows are visible and eligible; deletion removes them', async () => {
  assert.deepEqual(await read(), [{ post_id: P, snapshot_eligible: true }]);
  await db.exec('delete from posts'); assert.deepEqual(await read(), []);
});
test('private and follower-only posts require following but are never persisted', async () => {
  for (const change of ["update profiles set profile_visibility='private' where id='" + B + "'", "update posts set audience='followers'"]) {
    await db.exec(change); assert.deepEqual(await read(), []);
    await db.exec(`insert into follows values('${A}','${B}')`);
    assert.deepEqual(await read(), [{ post_id: P, snapshot_eligible: false }]);
    await db.exec('delete from follows');
  }
});
test('both directions of blocking and viewer hiding exclude otherwise public rows', async () => {
  for (const pair of [[A, B], [B, A]]) {
    await db.query('insert into blocked_users values($1,$2)', pair);
    assert.deepEqual(await read(), []); await db.exec('delete from blocked_users');
  }
  await db.exec(`insert into hidden_posts values('${A}','${P}')`);
  assert.deepEqual(await read(), []);
});
test('mentions and verification audiences are checked against the requesting account', async () => {
  await db.exec("update posts set audience='mentioned'"); assert.deepEqual(await read(), []);
  await db.exec(`insert into post_mentions values('${P}','${A}')`);
  assert.equal((await read())[0].snapshot_eligible, false);
  await db.exec("update posts set audience='verified'"); assert.deepEqual(await read(), []);
  await db.exec(`update profiles set is_verified=true where id='${A}'`);
  assert.equal((await read())[0].snapshot_eligible, false);
});
test('community content requires membership and does not enter startup cache', async () => {
  await db.exec(`update posts set community_id='${C}'`); assert.deepEqual(await read(), []);
  await db.exec(`insert into community_members values('${C}','${A}')`);
  assert.equal((await read())[0].snapshot_eligible, false);
});
test('premium and archived content are not saved; underlying row security is retained', async () => {
  await db.exec('update posts set is_exclusive=true'); assert.equal((await read())[0].snapshot_eligible, false);
  await db.exec('update posts set archived_at=now()'); assert.deepEqual(await read(), []);
  assert.equal((await read(B))[0].snapshot_eligible, false);
});
test('anonymous callers, missing auth, oversized requests, and unknown audiences fail closed', async () => {
  await assert.rejects(() => read(null, [P], 'anon'), /permission denied/);
  await assert.rejects(() => read(null), /Authentication required/);
  await assert.rejects(() => read(A, Array(101).fill(P)), /At most 100/);
  assert.deepEqual(await read(A, []), []);
  await db.exec("update posts set audience='unrecognized'"); assert.deepEqual(await read(), []);
});


test('muted authors are excluded from cached feed reconciliation', async () => {
  await db.exec(`insert into muted_authors values('${A}','${B}')`);
  assert.deepEqual(await read(), []);
});

test('feed feedback migration preserves output and honors muted authors idempotently', async () => {
  await db.exec(`create or replace function get_feed(p_mode text, p_cursor_key double precision, p_cursor_id uuid, p_limit integer)
    returns setof posts language sql stable as $$with viewer as(select auth.uid() as uid)
    select p.* from posts p where p.id is not null and not exists (select 1 from hidden_posts h where h.post_id=p.id and h.user_id=(select uid from viewer)) limit p_limit$$`);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261022211641_feed_mute_feedback.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [A]);
  assert.equal((await db.query("select * from get_feed('for_you',null,null,20)")).rows.length, 1);
  await db.exec(`insert into muted_authors values('${A}','${B}')`);
  assert.equal((await db.query("select * from get_feed('for_you',null,null,20)")).rows.length, 0);
});
