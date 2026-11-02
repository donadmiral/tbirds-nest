const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const viewer = id(1), sender = id(2), other = id(3), group = id(10);
let db, real;
const exec = async q => real ? db.query(q) : db.exec(q);
async function value(q) { return real ? JSON.parse(await db.query(`select to_jsonb(q) from (${q})q;`)) : (await db.query(q)).rows[0]; }
async function badge(who = viewer) { return Number((await value(`select get_push_message_badge_v1('${who}') n`)).n); }
before(async () => {
  real = !!process.env.PC_TEST_PSQL;
  if (real && process.env.PGDATABASE !== 'pc_scale_push_badge') throw Error('Use disposable pc_scale_push_badge.');
  db = real ? new LocalPsqlSession() : new PGlite();
  await exec(`drop schema public cascade;create schema public;
   do $$begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
   end$$;
   grant usage on schema public to anon,authenticated,service_role;
   create table messages(id uuid primary key default gen_random_uuid(),receiver_id uuid,sender_id uuid,conversation_id uuid,
    created_at timestamptz default now(),read_at timestamptz,deleted_at timestamptz);
   create table conversation_members(conversation_id uuid,user_id uuid,last_read_at timestamptz,primary key(conversation_id,user_id));
   alter table messages enable row level security;alter table conversation_members enable row level security;
   insert into conversation_members values('${group}','${viewer}','2026-01-02T00:00:00Z');
   insert into messages(receiver_id,sender_id,read_at,deleted_at) values
    ('${viewer}','${sender}',null,null),('${viewer}','${viewer}',null,null),('${viewer}','${sender}',now(),null),
    ('${viewer}','${sender}',null,now()),('${other}','${sender}',null,null);
   insert into messages(conversation_id,sender_id,created_at,deleted_at) values
    ('${group}','${sender}','2026-01-02T00:00:01Z',null),('${group}','${sender}','2026-01-02T00:00:00Z',null),
    ('${group}','${viewer}','2026-01-02T00:00:01Z',null),('${group}','${sender}','2026-01-02T00:00:01Z',now());`);
  await exec(fs.readFileSync(path.join(__dirname, '../migrations/20261102100740_indexed_notification_message_badge.sql'), 'utf8'));
});
after(async () => { await db?.close(); });
test('one scalar preserves unread direct and group predicates, strict read cutoff and deletion/self exclusion', async () => {
  assert.equal(await badge(), 2); assert.equal(await badge(other), 1); assert.equal(await badge(id(99)), 0);
});
test('all memberships are counted beyond API default page limits and null read time preserves epoch fallback', async () => {
  await exec(`insert into conversation_members(conversation_id,user_id,last_read_at)
    select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${viewer}',null from generate_series(100,2100)n;
    insert into messages(conversation_id,sender_id,created_at)
    select conversation_id,'${sender}','2026-01-02T00:00:01Z' from conversation_members where last_read_at is null;
    insert into messages(conversation_id,sender_id,created_at) values('${id(100)}','${sender}','1970-01-01T00:00:00Z');`);
  assert.equal(await badge(), 2003);
  await exec(`delete from conversation_members where conversation_id='${id(100)}' and user_id='${viewer}';`);
  assert.equal(await badge(), 2002);
});
test('only service callers can read recipient aggregates and null recipients fail explicitly', async () => {
  await exec('set role service_role;'); assert.equal(await badge(), 2002); await exec('reset role;');
  await exec(`do $$begin
    begin set local role authenticated;perform get_push_message_badge_v1('${viewer}');raise exception 'accepted member';
      exception when insufficient_privilege then reset role;end;
    begin set local role anon;perform get_push_message_badge_v1('${viewer}');raise exception 'accepted anon';
      exception when insufficient_privilege then reset role;end;
    begin perform get_push_message_badge_v1(null);raise exception 'accepted null';exception when invalid_parameter_value then null;end;
  end$$;`);
});
