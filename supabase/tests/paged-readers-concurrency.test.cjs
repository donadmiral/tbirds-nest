const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { fixture, legacy, migration, login, id, OWNER, BOOK, FOREIGN } = require('./paged-readers-fixture.cjs');
const enabled = Boolean(process.env.PC_TEST_PSQL);
const local = (name, fn) => test(name, { skip: !enabled, timeout: 20000 }, fn);
let admin, a, b, reader, aPid, bPid;
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
const read = async () => JSON.parse(await reader.query(`select public.get_memory_book_page_v2('${BOOK}',null,4);`));
async function blockedBy(pid, blocker) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await admin.query(`select ${blocker}=any(pg_blocking_pids(${pid}));`) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected independent revision writer lock wait was not observed.');
}
async function rejectsCursor(cursor) {
  await reader.query(`do $$ declare caught boolean:=false;begin
    begin perform public.get_memory_book_page_v2('${BOOK}',${quote(JSON.stringify(cursor))}::jsonb,4);
    exception when serialization_failure then caught:=true;end;
    if not caught then raise exception 'Stale continuation unexpectedly succeeded';end if;end $$;`);
}
before(async () => {
  if (!enabled) return;
  assert.equal(process.env.PGDATABASE, 'pc_scale_paging', 'Use the dedicated disposable paging fixture database.');
  admin = new LocalPsqlSession(); a = new LocalPsqlSession(); b = new LocalPsqlSession(); reader = new LocalPsqlSession();
  assert.equal(await admin.query("select current_database()='pc_scale_paging' and inet_server_addr() is null;"), 't');
  await admin.query('drop schema if exists read_paging cascade;drop schema if exists memory_creative cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;');
  await admin.query(fixture + legacy); await admin.query(migration);
  await admin.query('update read_paging.settings set books_ready=true,inbox_ready=true;');
  for (const session of [admin, a, b, reader]) await session.query("set statement_timeout='10s';set jit=off;");
  await reader.query(login());
  aPid = Number(await a.query('select pg_backend_pid();')); bPid = Number(await b.query('select pg_backend_pid();'));
});
beforeEach(async () => { if (enabled) await admin.query('truncate read_paging.library_revision;'); });
after(async () => { if (enabled) await Promise.all([admin?.close(), a?.close(), b?.close(), reader?.close()]); });

local('overlapping page and story edits advance the owner revision without losing either commit', async () => {
  const old = await read(); assert.equal(old.revision, '0');
  await a.query(`begin;update memory_pages set caption='Concurrent page' where id='${id(2002)}';`);
  await b.query('begin;');
  const pending = b.query(`update stories set caption='Concurrent story' where id='${id(1003)}';`);
  await blockedBy(bPid, aPid);
  // Readers do not wait for either writer and see a coherent committed revision.
  assert.equal((await read()).revision, '0');
  await a.query('commit;'); await pending;
  assert.equal((await read()).revision, '1');
  await b.query('commit;'); assert.equal((await read()).revision, '2');
  await rejectsCursor(old.next_cursor);
  assert.equal(await admin.query(`select revision from read_paging.library_revision where owner_id='${OWNER}';`), '2');
});

local('a rolled-back reorder leaves the previous cursor valid and releases a waiting edit', async () => {
  const old = await read();
  await a.query(`begin;update memory_pages set sort_order=-10 where id='${id(2078)}';`);
  assert.equal((await read()).pages.some(page => page.id === id(2078)), false);
  await a.query('rollback;');
  const continued = JSON.parse(await reader.query(`select public.get_memory_book_page_v2('${BOOK}',${quote(JSON.stringify(old.next_cursor))}::jsonb,4);`));
  assert.equal(continued.revision, '0');
  await a.query(`begin;update memory_pages set caption='Discarded change' where id='${id(2002)}';`);
  await b.query('begin;');
  const pending = b.query(`update stories set caption='Surviving change' where id='${id(1003)}';`);
  await blockedBy(bPid, aPid); await a.query('rollback;'); await pending; await b.query('commit;');
  assert.equal((await read()).revision, '1'); await rejectsCursor(old.next_cursor);
});

local('profile cascades do not recreate a deleted owner revision or block account erasure', async () => {
  await admin.query(`update memory_albums set title='Before erasure' where user_id='${FOREIGN}';delete from profiles where id='${FOREIGN}';`);
  assert.equal(await admin.query(`select count(*) from read_paging.library_revision where owner_id='${FOREIGN}';`), '0');
  assert.equal(await admin.query(`select count(*) from memory_albums where user_id='${FOREIGN}';`), '0');
  assert.equal((await read()).can_view, true);
});
