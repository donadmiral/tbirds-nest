const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { fixture, migration, id, P1, P2 } = require('./engagement-counter-fixture.cjs');
const enabled = Boolean(process.env.PC_TEST_PSQL);
const local = (name, fn) => test(name, { skip: !enabled, timeout: 20000 }, fn);
let admin, a, b, aPid, bPid;
async function canonical() {
  assert.equal(await admin.query(`select count(*) from posts p where
    likes_count<>(select count(*) from post_likes where post_id=p.id) or
    comments_count<>(select count(*) from post_comments where post_id=p.id) or
    reposts_count<>(select count(*) from post_reposts where post_id=p.id) or
    bookmarks_count<>(select count(*) from post_bookmarks where post_id=p.id);`), '0');
}
async function blockedBy(pid, blocker) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await admin.query(`select ${blocker}=any(pg_blocking_pids(${pid}));`) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Independent transaction never entered the expected lock wait.');
}
before(async () => {
  if (!enabled) return;
  admin = new LocalPsqlSession(); a = new LocalPsqlSession(); b = new LocalPsqlSession();
  assert.equal(await admin.query("select current_database() like 'pc_scale_%' and inet_server_addr() is null;"), 't');
  await admin.query('drop schema if exists post_counter_internal cascade; drop schema if exists auth cascade; drop schema public cascade; create schema public;');
  await admin.query(fixture);
  await admin.query(migration);
  for (const client of [admin, a, b]) await client.query("set statement_timeout='10s';");
  aPid = Number(await a.query('select pg_backend_pid();')); bPid = Number(await b.query('select pg_backend_pid();'));
  assert.notEqual(aPid, bPid);
});
beforeEach(async () => {
  if (!enabled) return;
  await admin.query('delete from post_comments; delete from post_likes; delete from post_reposts; delete from post_bookmarks; truncate counter_write_log, notifications;');
});
after(async () => { if (enabled) await Promise.all([admin?.close(), a?.close(), b?.close()]); });

local('two overlapping likes serialize the arithmetic without losing either user', async () => {
  await a.query(`begin; insert into post_likes(post_id,user_id) values('${P1}','${id(102)}');`);
  await b.query('begin;');
  const pending = b.query(`insert into post_likes(post_id,user_id) values('${P1}','${id(103)}');`);
  await blockedBy(bPid, aPid);
  await a.query('commit;'); await pending; await b.query('commit;');
  assert.equal(await admin.query(`select likes_count from posts where id='${P1}';`), '2');
  await canonical();
});

local('overlapping duplicate retries produce one row, one notification and one increment', async () => {
  await a.query(`begin; insert into post_likes(post_id,user_id) values('${P1}','${id(102)}') on conflict do nothing;`);
  await b.query('begin;');
  const pending = b.query(`insert into post_likes(post_id,user_id) values('${P1}','${id(102)}') on conflict do nothing;`);
  await blockedBy(bPid, aPid);
  await a.query('commit;'); await pending; await b.query('commit;');
  assert.equal(await admin.query('select count(*) from notifications;'), '1');
  assert.equal(await admin.query('select count(*) from counter_write_log;'), '1');
  await canonical();
});

local('different engagement types on the same post preserve every counter column', async () => {
  await a.query(`begin; insert into post_likes(post_id,user_id) values('${P1}','${id(102)}');`);
  await b.query('begin;');
  const pending = b.query(`insert into post_comments(post_id,user_id) values('${P1}','${id(103)}');
    insert into post_reposts(post_id,user_id) values('${P1}','${id(103)}');
    insert into post_bookmarks(post_id,user_id) values('${P1}','${id(103)}');`);
  await blockedBy(bPid, aPid); await a.query('commit;'); await pending; await b.query('commit;');
  assert.equal(await admin.query(`select jsonb_build_array(likes_count,comments_count,reposts_count,bookmarks_count) from posts where id='${P1}';`), '[1, 1, 1, 1]');
  await canonical();
});

local('overlapping delete and insert retain an exact total, repeated deletes do not subtract twice', async () => {
  await admin.query(`insert into post_likes(post_id,user_id) values('${P1}','${id(102)}'),('${P1}','${id(103)}');`);
  await a.query(`begin; delete from post_likes where post_id='${P1}' and user_id='${id(102)}';`);
  await b.query('begin;');
  const inserted = b.query(`insert into post_likes(post_id,user_id) values('${P1}','${id(104)}');`);
  await blockedBy(bPid, aPid); await a.query('commit;'); await inserted; await b.query('commit;');
  assert.equal(await admin.query(`select likes_count from posts where id='${P1}';`), '2');
  await a.query(`begin; delete from post_likes where post_id='${P1}' and user_id='${id(103)}';`);
  await b.query('begin;');
  const removed = b.query(`delete from post_likes where post_id='${P1}' and user_id='${id(103)}';`);
  await blockedBy(bPid, aPid); await a.query('commit;'); await removed; await b.query('commit;');
  assert.equal(await admin.query(`select likes_count from posts where id='${P1}';`), '1');
  await canonical();
});

local('rollback releases a waiting writer without retaining the cancelled delta', async () => {
  await a.query(`begin; insert into post_likes(post_id,user_id) values('${P1}','${id(102)}');`);
  await b.query('begin;');
  const pending = b.query(`insert into post_likes(post_id,user_id) values('${P1}','${id(103)}');`);
  await blockedBy(bPid, aPid); await a.query('rollback;'); await pending; await b.query('commit;');
  assert.equal(await admin.query('select count(*) from notifications;'), '1');
  assert.equal(await admin.query(`select likes_count from posts where id='${P1}';`), '1');
  await canonical();
});

local('simultaneous opposite-order batches acquire post locks in the same order', async () => {
  // The test-only observer stretches each post update so the sessions overlap.
  await admin.query(`create or replace function log_counter_write() returns trigger language plpgsql security definer set search_path='' as $$begin
    insert into public.counter_write_log values(new.id,to_jsonb(old),to_jsonb(new));
    perform pg_catalog.pg_sleep(0.1); return null; end$$;`);
  try {
    await Promise.all([
      a.query(`insert into post_likes(post_id,user_id) values('${P2}','${id(102)}'),('${P1}','${id(102)}');`),
      b.query(`insert into post_likes(post_id,user_id) values('${P1}','${id(103)}'),('${P2}','${id(103)}');`),
    ]);
  } finally {
    await admin.query(`create or replace function log_counter_write() returns trigger language plpgsql security definer set search_path='' as $$begin
      insert into public.counter_write_log values(new.id,to_jsonb(old),to_jsonb(new)); return null; end$$;`);
  }
  assert.equal(await admin.query('select sum(likes_count) from posts;'), '4');
  assert.equal(await admin.query('select count(*) from counter_write_log;'), '4');
  await canonical();
});

local('a busy cutover fails immediately and leaves existing data intact', async () => {
  await a.query('begin; lock table posts in row exclusive mode;');
  const installer = new LocalPsqlSession();
  try { await assert.rejects(installer.query(migration), /could not obtain lock on relation/); }
  finally { await installer.close(); await a.query('rollback;'); }
  await canonical();
});
