const { test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const real = !!process.env.PC_TEST_PSQL;
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261102075616_bounded_inbox_mentions.sql'), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const OWNER = id(1), OTHER = id(2), C1 = id(10), C2 = id(11), HIDDEN = id(12);
let db, psql;
const exec = sql => real ? psql.query(sql) : db.exec(sql);
const value = async expression => {
  const sql = `select to_jsonb(${expression});`;
  return real ? JSON.parse(await psql.query(sql)) : Object.values((await db.query(sql)).rows[0])[0];
};
const login = `set role authenticated;select set_config('request.jwt.claim.sub','${OWNER}',false);`;
const request = (ids = [C1, C2, HIDDEN], since = "now()-interval '7 days'") =>
  `public.get_inbox_mentions_v2(array[${ids.map(value => `'${value}'`).join(',')}]::uuid[],${since})`;
const denied = async (expression, code) => exec(`do $$ declare caught boolean:=false;begin
  begin perform ${expression};exception when sqlstate '${code}' then caught:=true;end;
  if not caught then raise exception 'Expected ${code}';end if;end $$;`);

before(async () => {
  if (real) {
    assert.equal(process.env.PGDATABASE, 'pc_scale_mentions'); psql = new LocalPsqlSession();
    assert.equal(await psql.query("select current_database()='pc_scale_mentions' and inet_server_addr() is null;"), 't');
    await exec('drop schema if exists auth cascade;drop schema public cascade;create schema public;set jit=off;');
  } else db = new PGlite();
  await exec(`
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
    end $$;
    create schema auth;grant usage on schema public,auth to authenticated,anon,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table readiness(inbox boolean not null);insert into readiness values(false);
    create function public.get_paged_reader_capabilities() returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_build_object('version',1,'inbox',r.inbox and auth.uid() is not null) from public.readiness r;
    $$;
    create table messages(id uuid primary key,conversation_id uuid not null,sender_id uuid,receiver_id uuid,
      deleted_at timestamptz,hidden boolean not null default false);
    create index messages_conversation_idx on messages(conversation_id);
    create table message_mentions(message_id uuid references messages(id) on delete cascade,mentioned_user_id uuid,
      created_at timestamptz not null,primary key(message_id,mentioned_user_id));
    alter table messages enable row level security;alter table message_mentions enable row level security;
    create policy message_read on messages for select to authenticated using(not hidden and (sender_id=auth.uid() or receiver_id=auth.uid()));
    create policy mention_read on message_mentions for select to authenticated using(mentioned_user_id=auth.uid()
      or exists(select 1 from messages m where m.id=message_id and m.sender_id=auth.uid()));
    grant select on messages,message_mentions to authenticated;
  `);
  await exec(migration);
});
beforeEach(async () => {
  await exec(`reset role;begin;update readiness set inbox=true;
    insert into messages values
      ('${id(101)}','${C1}','${OTHER}','${OWNER}',null,false),
      ('${id(102)}','${C1}','${OTHER}','${OWNER}',now(),false),
      ('${id(103)}','${C1}','${OTHER}','${OWNER}',null,true),
      ('${id(104)}','${C2}','${OTHER}','${OWNER}',null,false),
      ('${id(105)}','${HIDDEN}','${OTHER}','${OTHER}',null,false),
      ('${id(106)}','${C2}','${OWNER}','${OTHER}',null,false);
    insert into message_mentions values
      ('${id(101)}','${OWNER}',now()-interval '3 days'),
      ('${id(102)}','${OWNER}',now()-interval '1 day'),
      ('${id(103)}','${OWNER}',now()),
      ('${id(104)}','${OWNER}',now()-interval '8 days'),
      ('${id(105)}','${OWNER}',now()),
      ('${id(106)}','${OTHER}',now());
    ${login}`);
});
afterEach(async () => { await exec('rollback;reset role;'); });
after(async () => { if (real) await psql?.close(); else await db?.close(); });

test('mention reader is default gated, invoker-only and rejects anonymous/service execution', async () => {
  assert.equal(await value(`(select prosecdef from pg_proc where oid='public.get_inbox_mentions_v2(uuid[],timestamptz)'::regprocedure)`), false);
  await exec('reset role;update readiness set inbox=false;' + login); await denied(request(), '55000');
  await exec('reset role;set role anon;'); await denied(request(), '42501');
  await exec('reset role;set role service_role;'); await denied(request(), '42501');
});

test('bounded mention result exactly matches the two-table RLS oracle including visible deleted messages', async () => {
  const actual = await value(request());
  const expected = await value(`(select coalesce(jsonb_agg(jsonb_build_object('conversation_id',conversation_id,'latest_mention_at',created_at) order by conversation_id),'[]'::jsonb)
    from (select m.conversation_id,max(mm.created_at) created_at from public.message_mentions mm
      join public.messages m on m.id=mm.message_id where mm.mentioned_user_id=auth.uid()
      and mm.created_at>now()-interval '7 days' and m.conversation_id=any(array['${C1}','${C2}','${HIDDEN}']::uuid[])
      group by m.conversation_id) q)`);
  assert.deepEqual(actual.items, expected); assert.equal(actual.items.length, 1); assert.equal(actual.items[0].conversation_id, C1);
  assert.equal(Date.parse(actual.items[0].latest_mention_at), Date.parse(await value(`now()-interval '1 day'`)));
});

test('the latest mention beyond the old thousand-row cap is included with a single bounded result', async () => {
  await exec(`reset role;
    insert into messages select md5('message-'||g)::uuid,'${C1}','${OTHER}','${OWNER}',null,false from generate_series(1,1300) g;
    insert into message_mentions select md5('message-'||g)::uuid,'${OWNER}',now()-interval '12 hours'+g*interval '1 second' from generate_series(1,1300) g;
    ${login}`);
  const result = await value(request([C1])); assert.equal(result.items.length, 1);
  assert.equal(Date.parse(result.items[0].latest_mention_at), Date.parse(await value(`now()-interval '12 hours'+1300*interval '1 second'`)));
});

test('the effective cutoff clamps malicious history requests and retains the strict greater-than boundary', async () => {
  const old = await value(request([C2], "'1900-01-01'::timestamptz")); assert.equal(old.items.length, 0);
  assert.equal(Date.parse(old.since), Date.parse(await value(`now()-interval '7 days'`)));
  const exact = await value(request([C1], "now()-interval '1 day'")); assert.equal(exact.items.length, 0);
  const justBefore = await value(request([C1], "now()-interval '1 day 0.000001 seconds'")); assert.equal(justBefore.items.length, 1);
});

test('input cardinality, multidimensional arrays and invalid dates are rejected while empty and duplicate IDs stay safe', async () => {
  await denied(request(Array.from({length:51},(_,n)=>id(10000+n))), '22023');
  await denied(`public.get_inbox_mentions_v2(null,now())`, '22023');
  await denied(`public.get_inbox_mentions_v2(array[['${C1}'],['${C2}']]::uuid[],now())`, '22023');
  await denied(request([C1], "'infinity'::timestamptz"), '22023');
  assert.equal((await value(request([]))).items.length, 0);
  assert.equal((await value(request([C1,C1]))).items.length, 1);
});

test('removing message visibility or the viewer ledger removes the badge without disclosing other recipients', async () => {
  await exec(`reset role;update messages set hidden=true where conversation_id='${C1}';${login}`);
  assert.equal((await value(request())).items.length, 0);
  await exec(`reset role;update messages set hidden=false where id='${id(102)}';delete from message_mentions where message_id='${id(102)}' and mentioned_user_id='${OWNER}';${login}`);
  assert.equal((await value(request())).items.length, 0);
});

test('recipient time index has the exact reviewed columns and the function leaves table RLS enabled', async () => {
  const definition = await value(`pg_get_indexdef('public.message_mentions_recipient_created_message_idx'::regclass)`);
  assert.match(definition, /\(mentioned_user_id, created_at DESC, message_id\)/);
  assert.equal(await value(`(select bool_and(relrowsecurity) from pg_class where oid in ('public.messages'::regclass,'public.message_mentions'::regclass))`), true);
});
