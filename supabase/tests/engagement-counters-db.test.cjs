const { test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { fixture, migration, id, P1, P2, OWNER, VIEWER } = require('./engagement-counter-fixture.cjs');
let db;
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
async function canonical() {
  const inconsistent = await scalar(`select count(*)::int from posts p where
    likes_count<>(select count(*) from post_likes where post_id=p.id) or
    comments_count<>(select count(*) from post_comments where post_id=p.id) or
    reposts_count<>(select count(*) from post_reposts where post_id=p.id) or
    bookmarks_count<>(select count(*) from post_bookmarks where post_id=p.id)`);
  assert.equal(inconsistent, 0);
}
before(async () => { db = new PGlite(); await db.exec(fixture); await db.exec(migration); });
beforeEach(async () => { await db.exec('begin; truncate counter_write_log,notifications;'); });
afterEach(async () => { await db.exec('rollback; reset role;'); });
after(async () => db?.close());

test('cutover reconciles canonical rows, including hidden replies, without changing views', async () => {
  assert.deepEqual(await rows('select id,likes_count,comments_count,reposts_count,bookmarks_count,views_count from posts order by id'), [
    { id: P1, likes_count: 1, comments_count: 2, reposts_count: 1, bookmarks_count: 1, views_count: 37 },
    { id: P2, likes_count: 0, comments_count: 0, reposts_count: 0, bookmarks_count: 0, views_count: 41 },
  ]);
  await canonical();
});

test('1,000 likes cause one post update and retain the existing notifications', async () => {
  await db.exec(`insert into post_likes(post_id,user_id) select '${P1}',id from members where id>='${id(102)}' and id<'${id(1102)}';`);
  assert.equal(await scalar(`select likes_count from posts where id='${P1}'`), 1001);
  assert.equal(await scalar('select count(*)::int from counter_write_log'), 1);
  assert.equal(await scalar("select count(*)::int from notifications where type='like'"), 1000);
  await canonical();
});

test('duplicate inserts, upsert retries and edits perform no counter write', async () => {
  for (const table of ['post_likes', 'post_reposts', 'post_bookmarks']) {
    await db.exec(`insert into ${table}(post_id,user_id) values('${P1}','${VIEWER}') on conflict(post_id,user_id) do nothing;
      insert into ${table}(post_id,user_id) values('${P1}','${VIEWER}') on conflict(post_id,user_id) do update set created_at=now();`);
  }
  await db.exec("update post_comments set body='Edited',hidden_at=null,is_spam=false;");
  assert.equal(await scalar('select count(*)::int from counter_write_log'), 0);
  assert.equal(await scalar('select count(*)::int from notifications'), 0);
  await canonical();
});

test('reassignment moves each count once; nullable bookmarks do not invent counts', async () => {
  for (const table of ['post_likes', 'post_comments', 'post_reposts', 'post_bookmarks']) {
    await db.exec(`update ${table} set post_id='${P2}' where post_id='${P1}';`);
  }
  assert.equal(await scalar('select count(*)::int from counter_write_log'), 8);
  await db.exec(`insert into post_bookmarks(post_id,user_id) values(null,'${id(102)}');
    update post_bookmarks set post_id='${P1}' where user_id='${id(102)}';
    update post_bookmarks set post_id=null where user_id='${id(102)}';
    delete from post_bookmarks where user_id='${id(102)}';`);
  await canonical();
});

test('parent-comment, account and post cascades subtract actual deleted rows', async () => {
  await db.exec(`delete from post_comments where id='${id(10)}';`);
  assert.equal(await scalar(`select comments_count from posts where id='${P1}'`), 0);
  await canonical();
  await db.exec(`delete from members where id='${VIEWER}';`);
  await canonical();
  assert.deepEqual(await rows(`select likes_count,reposts_count,bookmarks_count from posts where id='${P1}'`), [{ likes_count: 0, reposts_count: 0, bookmarks_count: 0 }]);
  await db.exec(`insert into post_likes(post_id,user_id) values('${P2}','${id(102)}'); delete from posts where id='${P2}';`);
  await canonical();
});

test('failed writes and rollback never leave counters or notifications behind', async () => {
  await db.exec('savepoint attempted_action;');
  await assert.rejects(db.exec(`insert into post_likes(post_id,user_id) values('${P1}','${id(102)}'),('${P1}','${VIEWER}');`), /duplicate key/);
  await db.exec('rollback to savepoint attempted_action;');
  await canonical();
  assert.equal(await scalar('select count(*)::int from counter_write_log'), 0);
  await db.exec(`insert into post_likes(post_id,user_id) values('${P1}','${id(102)}'); rollback to savepoint attempted_action;`);
  await canonical();
  assert.equal(await scalar('select count(*)::int from notifications'), 0);
});

test('existing toggle RPC returns the committed-in-transaction exact result', async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [VIEWER]);
  const first = await scalar('select toggle_post_like($1)', [P1]);
  assert.equal(first.liked, false); assert.equal(first.likes_count, 0);
  const second = await scalar('select toggle_post_like($1)', [P1]);
  assert.equal(second.liked, true); assert.equal(second.likes_count, 1);
  await canonical();
});

test('client counter overwrites are ignored while ordinary author edits and views retain their behavior', async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [OWNER]);
  await db.exec('set local role authenticated;');
  await db.exec(`update posts set content='Updated by author',likes_count=9000,comments_count=-1,reposts_count=0,bookmarks_count=88,views_count=42 where id='${P1}';
    insert into posts(id,user_id,content,likes_count,comments_count,reposts_count,bookmarks_count,views_count)
      values('${id(3)}','${OWNER}','New post',99,88,77,66,12);`);
  await db.exec('reset role;');
  assert.deepEqual(await rows(`select content,likes_count,comments_count,reposts_count,bookmarks_count,views_count from posts where id='${P1}'`), [
    { content: 'Updated by author', likes_count: 1, comments_count: 2, reposts_count: 1, bookmarks_count: 1, views_count: 42 },
  ]);
  assert.deepEqual(await rows(`select likes_count,comments_count,reposts_count,bookmarks_count,views_count from posts where id='${id(3)}'`), [
    { likes_count: 0, comments_count: 0, reposts_count: 0, bookmarks_count: 0, views_count: 12 },
  ]);
  await canonical();
});

test('authenticated engagement writes update every real count despite the original JWT and RLS', async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id(102)]);
  await db.exec("select set_config('request.jwt.claim.role','authenticated',true); set local role authenticated;");
  for (const table of ['post_likes', 'post_comments', 'post_reposts', 'post_bookmarks']) {
    await db.exec(`insert into ${table}(post_id,user_id) values('${P1}','${id(102)}');`);
  }
  assert.equal(await scalar(`select likes_count from posts where id='${P1}'`), 2);
  await db.exec(`update posts set content='Not mine',likes_count=800 where id='${P1}'; reset role;`);
  assert.equal(await scalar(`select content from posts where id='${P1}'`), 'Existing post');
  await canonical();
  assert.equal(await scalar("select has_schema_privilege('authenticated','post_counter_internal','USAGE')"), false);
  assert.equal(await scalar("select has_function_privilege('authenticated','post_counter_internal.apply_delta()','EXECUTE')"), false);
});

test('changed or additional legacy counter bindings abort the entire migration', async () => {
  for (const change of [
    'alter trigger trg_comments_count on post_comments rename to unexpected_counter;',
    'create trigger extra_counter after insert on post_likes for each row execute function sync_post_likes_count_exact();',
  ]) {
    const other = new PGlite();
    try {
      await other.exec(fixture + change);
      await assert.rejects(other.exec(migration), /ENGAGEMENT_COUNTER_(TRIGGER_DRIFT|UNEXPECTED_CALLBACK)/);
      await other.exec('rollback;');
      assert.equal((await other.query("select to_regnamespace('post_counter_internal')::text value")).rows[0].value, null);
      assert.equal((await other.query(`select likes_count from posts where id='${P1}'`)).rows[0].likes_count, 97);
    } finally { await other.close(); }
  }
});
