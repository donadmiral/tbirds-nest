const { test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { fixture, contextMigration, login, id, OWNER, VIEWER, FOREIGN } = require('./context-inbox-fixture.cjs');
const real = !!process.env.PC_TEST_PSQL;
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
let db, psql, original;
const exec = sql => real ? psql.query(sql) : db.exec(sql);
const value = async expression => {
  const sql = `select to_jsonb(${expression});`;
  return real ? JSON.parse(await psql.query(sql)) : Object.values((await db.query(sql)).rows[0])[0];
};
const pageExpr = (context = 'market', cursor = null, limit = 17, ids = null) =>
  `public.get_context_inbox_page_v2(${quote(context)},${cursor === null ? 'null' : quote(JSON.stringify(cursor)) + '::jsonb'},${limit},${ids === null ? 'null' : 'array[' + ids.map(quote).join(',') + ']::uuid[]'})`;
const page = (...args) => value(pageExpr(...args));
const legacy = context => value(`(select coalesce(jsonb_agg(to_jsonb(t) order by t.last_message_time desc nulls last,t.conversation_id desc),'[]'::jsonb)
  from public.get_conversations_by_context(${quote(context)},false) t)`);
async function denied(expression, code) {
  await exec(`do $$ declare caught boolean:=false;begin begin perform ${expression};exception when sqlstate '${code}' then caught:=true;end;
    if not caught then raise exception 'Expected denial ${code}';end if;end $$;`);
}
async function admin(sql) { await exec('reset role;' + sql); await exec(login()); }
async function complete(context, size = 17) {
  let cursor = null, rows = [], seen = new Set();
  do {
    const result = await page(context, cursor, size);
    assert.ok(result.items.length <= size);
    for (const row of result.items) { assert.ok(!seen.has(row.id), 'no duplicate across keyset windows'); seen.add(row.id); rows.push(row); }
    cursor = result.next_cursor;
    assert.equal(!!cursor, result.has_more);
  } while (cursor);
  return rows;
}
before(async () => {
  if (real) {
    assert.equal(process.env.PGDATABASE, 'pc_scale_context', 'Use the dedicated disposable context fixture.');
    psql = new LocalPsqlSession();
    assert.equal(await psql.query("select current_database()='pc_scale_context' and inet_server_addr() is null;"), 't');
    await exec('drop schema if exists read_paging cascade;drop schema if exists memory_creative cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;set jit=off;');
  } else db = new PGlite();
  await exec("set timezone='UTC';" + fixture);
  original = await value(`pg_get_functiondef('public.get_conversations_by_context(text,boolean)'::regprocedure)`);
  await exec(contextMigration);
});
beforeEach(async () => { await exec('reset role;begin;update read_paging.settings set inbox_ready=true;' + login()); });
afterEach(async () => { await exec('rollback;reset role;'); });
after(async () => { if (real) await psql?.close(); else await db?.close(); });

test('context paging is additive, gated and authenticated without changing the old reader', async () => {
  assert.equal(await value(`pg_get_functiondef('public.get_conversations_by_context(text,boolean)'::regprocedure)`), original);
  await admin('update read_paging.settings set inbox_ready=false;');
  await denied(pageExpr(), '55000'); assert.ok((await legacy('market')).length > 30);
  await exec('reset role;set role anon;'); await denied(pageExpr(), '42501');
  await exec('reset role;set role service_role;'); await denied(pageExpr(), '42501');
});

test('both context lists match every original row, subject, sender and unread count across all pages', async () => {
  for (const context of ['market', 'jobs']) {
    const expected = await legacy(context), actual = (await complete(context)).map(({ id: _id, ...row }) => row);
    assert.ok(actual.length > 30); assert.deepEqual(actual, expected);
  }
});

test('request flags, deleted unread messages, deleted settings and membership-only DMs keep their original semantics', async () => {
  const actual = await complete('market'), byId = new Map(actual.map(row => [row.id, row]));
  assert.ok(byId.has(id(3202)), 'DM membership does not require endpoint ownership');
  assert.ok(byId.has(id(3003)), 'settings deletion was not a context filter');
  assert.ok(byId.has(id(3006)), 'pending status alone is not is_request');
  assert.ok(!byId.has(id(3009)), 'accepted request is still excluded by is_request');
  const expected = (await legacy('market')).find(row => row.conversation_id === id(3003));
  assert.equal(byId.get(id(3003)).unread_count, expected.unread_count);
  assert.ok(byId.get(id(3003)).unread_count > await value(`(select count(*)::int from public.messages where conversation_id='${id(3003)}'
    and receiver_id=auth.uid() and sender_id<>auth.uid() and read_at is null and deleted_at is null)`));
});

test('microsecond activity ties and null tails have stable complete cursor order', async () => {
  await admin(`update conversations set last_message_time=case when right(id::text,1)::integer%3=0 then null
    when right(id::text,1)::integer%3=1 then '2026-02-01T00:00:00.123456Z'::timestamptz else '2026-02-01T00:00:00.123457Z'::timestamptz end;`);
  const actual = await complete('market', 3), expected = await legacy('market');
  assert.deepEqual(actual.map(row => row.id), expected.map(row => row.conversation_id));
  const firstNull = actual.findIndex(row => row.last_message_time === null);
  assert.ok(firstNull > 0 && actual.slice(firstNull).every(row => row.last_message_time === null));
});

test('row-level privacy applies to membership, subjects, profiles and unread messages', async () => {
  await admin(`update marketplace_listings set visible=false;update jobs set visible=false;update profiles set hidden=true where id='${OWNER}';`);
  for (const context of ['market', 'jobs']) {
    const rows = await complete(context);
    assert.deepEqual(rows.map(({ id: _id, ...row }) => row), await legacy(context));
    assert.ok(rows.every(row => row.ref_title === null && row.ref_image === null));
    assert.ok(rows.filter(row => row.id !== id(3202)).every(row => row.other_id === null && row.other_name === null));
  }
  const forbidden = await page('market', null, 50, [id(3201), id(3009)]);
  assert.deepEqual(forbidden.items, []);
});

test('ID revalidation is bounded, deduplicated and keeps the same context/request/authorization scope', async () => {
  const rows = await complete('market');
  const result = await page('market', null, 50, [rows[0].id, rows[0].id, id(3009), id(3004)]);
  assert.deepEqual(result.items.map(row => row.id), [rows[0].id]); assert.equal(result.next_cursor, null);
  await denied(pageExpr('market', null, 50, Array.from({ length: 51 }, (_, n) => id(n))), '22023');
  await denied(`public.get_context_inbox_page_v2('market',null,50,array[null]::uuid[])`, '22023');
  await denied(`public.get_context_inbox_page_v2('market',null,50,array[['${id(3003)}']]::uuid[])`, '22023');
});

test('cursors cannot cross accounts or contexts and malformed or nonfinite activity is rejected', async () => {
  const first = await page();
  await denied(pageExpr('jobs', first.next_cursor), '22023');
  await denied(pageExpr('market', { ...first.next_cursor, viewer: OWNER }), '22023');
  await denied(pageExpr('market', { ...first.next_cursor, activity_at: 'infinity' }), '22023');
  await denied(pageExpr('market', { ...first.next_cursor, activity_at: 'bad-time' }), '22023');
  await denied(pageExpr('market', { ...first.next_cursor, id: 'bad-id' }), '22023');
  await denied(pageExpr('market', first.next_cursor, 50, [id(3003)]), '22023');
  await denied(pageExpr('personal'), '22023'); await denied(pageExpr('market', null, 51), '22023');
});

test('a committed membership removal is reflected by the next authorized ID revalidation', async () => {
  assert.equal((await page('market', null, 50, [id(3202)])).items.length, 1);
  await admin(`delete from conversation_members where conversation_id='${id(3202)}' and user_id='${VIEWER}';`);
  assert.equal((await page('market', null, 50, [id(3202)])).items.length, 0);
});

test('the context unread index reads only matching unread rows despite a large read history', async () => {
  await admin(`insert into messages(id,conversation_id,sender_id,receiver_id,created_at,read_at)
    select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${id(3003)}','${OWNER}','${VIEWER}',now(),now()
    from generate_series(1,20000)n;
    insert into messages(id,conversation_id,sender_id,receiver_id,created_at)
    select ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${id(3006)}','${OWNER}','${VIEWER}',now()
    from generate_series(1,20000)n;analyze public.messages;`);
  const sql = `explain (analyze,format json) select count(*) from public.messages
    where receiver_id='${VIEWER}' and conversation_id='${id(3003)}' and read_at is null;`;
  await exec('reset role;');
  const result = real ? JSON.parse(await psql.query(sql)) : (await db.query(sql)).rows[0]['QUERY PLAN'];
  const nodes = [], walk = node => { nodes.push(node); (node.Plans ?? []).forEach(walk); }; walk(result[0].Plan);
  assert.ok(nodes.some(node => node['Index Name'] === 'messages_context_unread_window_idx'), JSON.stringify(result));
  assert.ok(nodes.filter(node => node['Relation Name'] === 'messages').every(node => node['Actual Rows'] < 20));
});
