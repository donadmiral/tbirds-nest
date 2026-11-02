const { test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { fixture, businessMigration, login, id, BUSINESS, VIEWER, FOREIGN } = require('./business-inbox-fixture.cjs');
const real = !!process.env.PC_TEST_PSQL;
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
let db, psql, original, helpers;
const exec = sql => real ? psql.query(sql) : db.exec(sql);
const value = async expression => { const sql = `select to_jsonb(${expression});`;
  return real ? JSON.parse(await psql.query(sql)) : Object.values((await db.query(sql)).rows[0])[0]; };
const pageExpr = (tab = 'primary', cursor = null, limit = 17, ids = null, business = BUSINESS) =>
  `public.get_business_inbox_page_v2(${quote(business)},${quote(tab)},${cursor === null ? 'null' : quote(JSON.stringify(cursor)) + '::jsonb'},${limit},${ids === null ? 'null' : 'array[' + ids.map(quote).join(',') + ']::uuid[]'})`;
const page = (...args) => value(pageExpr(...args));
const legacy = (business = BUSINESS) => value(`(select coalesce(jsonb_agg(to_jsonb(t) order by t.last_at desc nulls last,t.conversation_id desc),'[]'::jsonb)
  from public.get_business_conversations('${business}') t)`);
async function denied(expression, code) { await exec(`do $$ declare caught boolean:=false;begin begin perform ${expression};exception when sqlstate '${code}' then caught:=true;end;
  if not caught then raise exception 'Expected denial ${code}';end if;end $$;`); }
async function admin(sql) { await exec('reset role;' + sql); await exec(login()); }
async function complete(tab, limit = 17) {
  let cursor = null; const rows = [], seen = new Set(); const all = await legacy();
  const totals = { primary: all.filter(row => !row.is_request).length, requests: all.filter(row => row.is_request).length };
  do { const result = await page(tab, cursor, limit); assert.deepEqual(result.summary, totals);
    assert.ok(result.items.length <= limit); assert.equal(result.can_view, true);
    for (const row of result.items) { assert.ok(!seen.has(row.id)); seen.add(row.id); rows.push(row); }
    cursor = result.next_cursor; assert.equal(!!cursor, result.has_more);
  } while (cursor);
  return rows;
}
before(async () => {
  if (real) {
    assert.equal(process.env.PGDATABASE, 'pc_scale_business'); psql = new LocalPsqlSession();
    assert.equal(await psql.query("select current_database()='pc_scale_business' and inet_server_addr() is null;"), 't');
    await exec('drop schema if exists read_paging cascade;drop schema if exists memory_creative cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;set jit=off;');
  } else db = new PGlite();
  await exec("set timezone='UTC';" + fixture);
  original = await value(`pg_get_functiondef('public.get_business_conversations(uuid)'::regprocedure)`);
  helpers = await value(`(select jsonb_agg(pg_get_functiondef(p.oid) order by p.proname) from pg_proc p where p.oid in(
    'public.is_business_member(uuid)'::regprocedure,'public.org_role_for_profile(uuid)'::regprocedure,'public.org_delegated_scopes(uuid)'::regprocedure))`);
  await exec(businessMigration);
});
beforeEach(async () => { await exec('reset role;begin;update read_paging.settings set inbox_ready=true;' + login()); });
afterEach(async () => { await exec('rollback;reset role;'); });
after(async () => { if (real) await psql?.close(); else await db?.close(); });

test('business paging keeps the canonical reader and authorization helpers unchanged and remains gated', async () => {
  assert.equal(await value(`pg_get_functiondef('public.get_business_conversations(uuid)'::regprocedure)`), original);
  assert.deepEqual(await value(`(select jsonb_agg(pg_get_functiondef(p.oid) order by p.proname) from pg_proc p where p.oid in(
    'public.is_business_member(uuid)'::regprocedure,'public.org_role_for_profile(uuid)'::regprocedure,'public.org_delegated_scopes(uuid)'::regprocedure))`), helpers);
  await admin('update read_paging.settings set inbox_ready=false;'); await denied(pageExpr(), '55000'); assert.ok((await legacy()).length > 100);
  await exec('reset role;set role anon;'); await denied(pageExpr(), '42501');
  await exec('reset role;set role service_role;'); await denied(pageExpr(), '42501');
});

test('every Primary and Requests row exactly matches the original business reader, with full tab counts on every page', async () => {
  const all = await legacy();
  for (const tab of ['primary', 'requests']) {
    const rows = await complete(tab), expected = all.filter(row => row.is_request === (tab === 'requests'));
    assert.ok(rows.length > 50); assert.deepEqual(rows.map(({ id: _id, ...row }) => row), expected);
  }
});

test('latest message, receiver unread and request rules retain deleted content and ignore personal settings', async () => {
  const rows = [...await complete('primary'), ...await complete('requests')], map = new Map(rows.map(row => [row.id, row]));
  assert.equal(map.get(id(3003)).last_text, 'Canonical latest message');
  assert.notEqual(map.get(id(3003)).last_at, '2030-01-01T00:00:00+00:00');
  assert.equal(map.get(id(3003)).is_request, true); assert.equal(map.get(id(3006)).is_request, false);
  assert.equal(map.get(id(3007)).unread, 1, 'deleted incoming unread still counts for the business contract');
  assert.equal(map.get(id(4100)).last_at, null); assert.equal(map.get(id(4100)).is_request, true);
  await admin(`update profiles set hidden=true where id='${VIEWER}';`);
  assert.equal((await complete('requests')).find(row => row.id === id(3003)).other_name, 'Viewer', 'existing acting-business definer projection is preserved');
});

test('organization ancestors, delegated scopes, expiries and legacy membership all use the existing authorization helper', async () => {
  await admin(`delete from business_members;update organizations set parent_id='${id(9901)}' where id='${id(9900)}';
    insert into org_memberships values('${id(9901)}','${VIEWER}','editor',now()+interval '1 day');`);
  assert.ok((await legacy()).length > 0); assert.equal((await page()).can_view, true);
  await admin(`update org_memberships set expires_at=now()-interval '1 day';`);
  assert.deepEqual(await legacy(), []); assert.equal((await page()).can_view, false);
  await admin(`update organizations set parent_id=null;update org_memberships set expires_at=null;
    insert into org_delegations values('${id(9900)}','${id(9901)}',array['inbox'],now()+interval '1 day');`);
  assert.equal((await page()).can_view, true);
  await admin(`update org_delegations set expires_at=now()-interval '1 day';`);
  assert.equal((await page()).can_view, false);
  await admin(`insert into business_members values('${BUSINESS}','${VIEWER}');`); assert.equal((await page()).can_view, true);
});

test('nonmembers receive a fixed empty envelope for existing and nonexistent businesses, with no full counts', async () => {
  const result = await page('primary', null, 17, null, FOREIGN), nonexistent = await page('requests', null, 17, null, id(9999));
  assert.deepEqual(result, nonexistent); assert.deepEqual(result.summary, { primary: 0, requests: 0 });
  assert.equal(result.can_view, false); assert.deepEqual(result.items, []);
  await exec(login(FOREIGN)); assert.deepEqual(await legacy(), []); assert.deepEqual(await page(), result);
});

test('microsecond keysets, null tails and revalidation keep complete request-tab order', async () => {
  await admin(`update messages set created_at=case when right(conversation_id::text,1)::integer%2=0 then '2026-05-01T00:00:00.123456Z'::timestamptz
    else '2026-05-01T00:00:00.123457Z'::timestamptz end where receiver_id='${BUSINESS}';`);
  const actual = await complete('requests', 3), expected = (await legacy()).filter(row => row.is_request);
  assert.deepEqual(actual.map(row => row.id), expected.map(row => row.conversation_id));
  assert.ok(actual.slice(-2).every(row => row.last_at === null));
  const lookup = await page('primary', null, 50, [id(4100), id(4100), id(3201)]);
  assert.deepEqual(lookup.items.map(row => row.id), [id(4100)]); assert.equal(lookup.next_cursor, null);
});

test('cursors and IDs cannot cross human accounts, acting businesses, tabs or bounded input limits', async () => {
  const first = await page();
  for (const cursor of [{ ...first.next_cursor, viewer: BUSINESS }, { ...first.next_cursor, business: FOREIGN },
    { ...first.next_cursor, tab: 'requests' }, { ...first.next_cursor, activity_at: 'infinity' }, { ...first.next_cursor, id: 'bad' }]) {
    await denied(pageExpr('primary', cursor), '22023');
  }
  await denied(pageExpr('primary', null, 51), '22023');
  await denied(pageExpr('primary', null, 50, Array.from({ length: 51 }, (_, n) => id(n))), '22023');
  await denied(`public.get_business_inbox_page_v2('${BUSINESS}','primary',null,50,array[null]::uuid[])`, '22023');
  await denied(`public.get_business_inbox_page_v2('${BUSINESS}','primary',null,50,array[['${id(3003)}']]::uuid[])`, '22023');
  await denied(pageExpr('primary', first.next_cursor, 50, [id(3003)]), '22023');
});

test('membership revocation on a later page returns an empty result instead of retaining business access', async () => {
  const first = await page(); assert.ok(first.next_cursor);
  await admin('delete from business_members;');
  const denied = await page('primary', first.next_cursor); assert.equal(denied.can_view, false);
  assert.deepEqual(denied.items, []); assert.deepEqual(denied.summary, { primary: 0, requests: 0 });
});
