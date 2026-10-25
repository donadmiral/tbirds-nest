const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const viewer = '10000000-0000-4000-8000-000000000001';
const author = '10000000-0000-4000-8000-000000000002';
const story = '20000000-0000-4000-8000-000000000001';
let db;
async function read(sql = 'select * from get_trending_stories(8)') {
  await db.exec('set role authenticated');
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
}
test.before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key, full_name text, username text, avatar_url text, profile_visibility text default 'public', deactivated_at timestamptz);
    create table stories(id uuid primary key, user_id uuid, expires_at timestamptz, created_at timestamptz, audience text default 'everyone', reach text default 'wider');
    create table follows(follower_id uuid,following_id uuid);
    create table blocked_users(blocker_id uuid,blocked_id uuid);
    create table muted_stories(user_id uuid,muted_id uuid);
    create table muted_authors(user_id uuid,author_id uuid);
    create table trending_snapshot(kind text, ref_id uuid, user_id uuid, rank int, heat numeric, uniq_engagers int, computed_at timestamptz);
    alter table trending_snapshot enable row level security;
    create policy trending_snapshot_read on trending_snapshot for select to authenticated using (true);
    create function viewer_can_see_story(uuid) returns boolean language sql stable as $$select true$$;
    grant select on all tables in schema public to authenticated;
    select set_config('request.jwt.claim.sub','${viewer}',false);`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261025073235_trending_story_visibility.sql'),'utf8'));
});
test.beforeEach(async () => {
  await db.exec(`truncate profiles,stories,follows,blocked_users,muted_stories,muted_authors,trending_snapshot;
    insert into profiles(id,full_name) values('${viewer}','Viewer'),('${author}','Author');
    insert into stories(id,user_id,expires_at,created_at) values('${story}','${author}',now()+interval '1 hour',now()-interval '1 hour');
    insert into trending_snapshot values('story','${story}','${author}',1,12,10,now());`);
});
test.after(() => db.close());
test('eligible current story resolves with the bounded public RPC', async () => {
  const rows = await read(); assert.equal(rows.length,1); assert.equal(rows[0].story_id,story);
  assert.equal((await read('select * from get_trending_stories(null)')).length,1);
});
test('expired, newly restricted and deactivated stories disappear without rebuilding the snapshot', async () => {
  for (const mutation of ["update stories set expires_at=now()", "update stories set audience='followers'", "update profiles set profile_visibility='private'", "update profiles set deactivated_at=now()", "update stories set created_at=now()-interval '25 hours'"]) {
    await db.exec('begin'); await db.exec(mutation);
    assert.equal((await read()).length,0,mutation);
    assert.equal((await read('select * from trending_snapshot')).length,0,mutation);
    await db.exec('rollback');
  }
});
test('both directions of blocking and both mute controls apply to RPC and snapshot reads', async () => {
  for (const sql of [`insert into blocked_users values('${viewer}','${author}')`, `insert into blocked_users values('${author}','${viewer}')`, `insert into muted_stories values('${viewer}','${author}')`, `insert into muted_authors values('${viewer}','${author}')`]) {
    await db.exec('begin'); await db.exec(sql);
    assert.equal((await read()).length,0,sql);
    assert.equal((await read('select * from trending_snapshot')).length,0,sql);
    await db.exec('rollback');
  }
});
test('followers reach is never promoted to strangers, but followers may see it', async () => {
  await db.exec("update stories set reach='followers'"); assert.equal((await read()).length,0);
  await db.exec(`insert into follows values('${viewer}','${author}')`); assert.equal((await read()).length,1);
});
test('overdue, future, deleted and incorrectly attributed snapshot entries fail closed', async () => {
  for (const sql of ["update trending_snapshot set computed_at=now()-interval '16 minutes'", "update trending_snapshot set computed_at=now()+interval '1 hour'", 'delete from stories', `update trending_snapshot set user_id='${viewer}'`]) {
    await db.exec('begin'); await db.exec(sql); assert.equal((await read()).length,0,sql); await db.exec('rollback');
  }
});
test('anonymous callers cannot execute discovery helpers', async () => {
  await db.exec('set role anon');
  try { await assert.rejects(() => db.query('select * from get_trending_stories(6)'), /permission denied/); }
  finally { await db.exec('reset role'); }
});
