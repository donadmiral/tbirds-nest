const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const ticket = n => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
const key = n => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const migration = name => fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8');
const current = migration('20261031181428_member_support_atomic_reply.sql');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key);
    insert into profiles values('${A}'),('${B}');`);
  await db.exec(migration('00000000000099_support_tickets.sql'));
  // The older deployed shape carries these two columns before alignment.
  await db.exec('alter table support_tickets add column message text; alter table support_tickets add column updated_at timestamptz default now();');
  for (const name of ['00000000000108_support_tickets_alignment.sql', '00000000000109_support_full_contract.sql', '00000000000110_support_helpdesk.sql']) await db.exec(migration(name));
  await db.exec(`grant select,insert,update on support_tickets to authenticated;
    grant select,insert on support_messages to authenticated;
    insert into support_tickets(id,user_id,subject,body,status) select
      ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      case when n=9 then '${B}'::uuid else '${A}'::uuid end,'Question','Original question','solved'
      from generate_series(1,10)n;`);
  await db.exec(current);
});
after(async () => db.close());
async function as(owner, action, role = 'authenticated') {
  await db.exec('set role ' + role);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner || '']);
  try { return await action(); }
  finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
const send = (id, request, body = 'Please help', expected = A) => db.query(
  'select public.send_member_support_reply($1,$2,$3,$4) receipt', [expected, ticket(id), key(request), body]);
const state = async id => (await db.query('select status,updated_at from support_tickets where id=$1', [ticket(id)])).rows[0];
const messageCount = async request => (await db.query('select count(*)::int n from support_messages where id=$1', [key(request)])).rows[0].n;

test('new member reply and reopening commit together with an owned receipt', async () => {
  const receipt = (await as(A, () => send(1, 1, '  Please help  '))).rows[0].receipt;
  assert.deepEqual([receipt.message_id, receipt.ticket_id, receipt.sender_id, receipt.body, receipt.ticket_status, receipt.replayed], [key(1), ticket(1), A, 'Please help', 'open', false]);
  assert.ok(Number.isFinite(Date.parse(receipt.created_at)));
  assert.equal(await messageCount(1), 1);
  assert.equal((await state(1)).status, 'open');
});

test('replaying a confirmed reply does not reopen a subsequently solved ticket', async () => {
  await db.query("update support_tickets set status='solved',updated_at='2026-10-31T10:00:00Z' where id=$1", [ticket(1)]);
  const before = await state(1);
  const receipt = (await as(A, () => send(1, 1))).rows[0].receipt;
  assert.equal(receipt.replayed, true); assert.equal(receipt.ticket_status, 'solved');
  assert.deepEqual(await state(1), before); assert.equal(await messageCount(1), 1);
});

test('a request UUID is bound to the exact body and ticket', async () => {
  await as(A, async () => {
    await assert.rejects(send(1, 1, 'Different body'), /SUPPORT_REQUEST_CONFLICT/);
    await assert.rejects(send(2, 1), /SUPPORT_REQUEST_CONFLICT/);
  });
  assert.equal((await state(2)).status, 'solved'); assert.equal(await messageCount(1), 1);
});

test('cross-account ticket access and changed account identity are rejected', async () => {
  await as(A, async () => {
    await assert.rejects(send(9, 2), /SUPPORT_TICKET_UNAVAILABLE/);
    await assert.rejects(send(2, 2, 'Please help', B), /SUPPORT_ACCOUNT_CHANGED/);
  });
  await as(B, () => assert.rejects(send(1, 3, 'Please help', B), /SUPPORT_TICKET_UNAVAILABLE/));
  assert.equal(await messageCount(2), 0); assert.equal(await messageCount(3), 0);
});

test('anonymous execution and authenticated roles without a user are denied', async () => {
  await as(null, () => assert.rejects(send(2, 4), /permission denied/), 'anon');
  await as(null, () => assert.rejects(send(2, 4), /SUPPORT_AUTH_REQUIRED/));
  assert.equal(await messageCount(4), 0);
});

test('legacy direct member insert receives the same atomic reopening', async () => {
  await as(A, () => db.query("insert into support_messages(id,ticket_id,sender,sender_id,body) values($1,$2,'member',$3,'Legacy reply')", [key(5), ticket(3), A]));
  assert.equal((await state(3)).status, 'open'); assert.equal(await messageCount(5), 1);
});

test('a no-op legacy conflict retry does not reopen the ticket', async () => {
  await db.query("update support_tickets set status='solved' where id=$1", [ticket(3)]);
  await as(A, () => db.query("insert into support_messages(id,ticket_id,sender,sender_id,body) values($1,$2,'member',$3,'Legacy reply') on conflict(id) do nothing", [key(5), ticket(3), A]));
  assert.equal((await state(3)).status, 'solved'); assert.equal(await messageCount(5), 1);
});

test('failed status update rolls back the inserted message and permits safe retry', async () => {
  await db.exec(`create function public.reject_test_reopen() returns trigger language plpgsql as $$begin
    if new.id='${ticket(4)}' then raise exception 'INJECTED_REOPEN_FAILURE';end if;return new;end$$;
    create trigger reject_test_reopen before update on support_tickets for each row execute function public.reject_test_reopen();`);
  try { await as(A, () => assert.rejects(send(4, 6), /INJECTED_REOPEN_FAILURE/)); }
  finally { await db.exec('drop trigger reject_test_reopen on support_tickets; drop function public.reject_test_reopen();'); }
  assert.equal(await messageCount(6), 0); assert.equal((await state(4)).status, 'solved');
  await as(A, () => send(4, 6)); assert.equal(await messageCount(6), 1); assert.equal((await state(4)).status, 'open');
});

test('legacy insert cannot survive an unauthorized parent update', async () => {
  await db.exec('drop policy tickets_update_own_status on support_tickets');
  try {
    await as(A, () => assert.rejects(db.query("insert into support_messages(id,ticket_id,sender,sender_id,body) values($1,$2,'member',$3,'No parent update')", [key(7), ticket(5), A]), /SUPPORT_TICKET_UNAVAILABLE/));
  } finally {
    await db.exec('create policy tickets_update_own_status on support_tickets for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id)');
  }
  assert.equal(await messageCount(7), 0); assert.equal((await state(5)).status, 'solved');
});

test('staff reply insertion does not reopen a solved ticket', async () => {
  await db.query("insert into support_messages(id,ticket_id,sender,sender_id,body) values($1,$2,'ops',$3,'Staff note')", [key(8), ticket(6), B]);
  assert.equal((await state(6)).status, 'solved');
});

test('empty, oversized and missing-key requests cannot insert messages', async () => {
  await as(A, async () => {
    for (const body of ['', '  ', 'x'.repeat(2001), null]) await assert.rejects(send(7, 9, body), /SUPPORT_INPUT_INVALID/);
    await assert.rejects(db.query('select send_member_support_reply($1,$2,null,$3)', [A, ticket(7), 'Missing key']), /SUPPORT_INPUT_INVALID/);
  });
  assert.equal(await messageCount(9), 0); assert.equal((await state(7)).status, 'solved');
});

test('an inaccessible existing message UUID never produces a forged success', async () => {
  await as(B, () => send(9, 10, 'Other account reply', B));
  await as(A, () => assert.rejects(send(7, 10, 'Other account reply'), /SUPPORT_REQUEST_CONFLICT/));
  assert.equal((await state(7)).status, 'solved'); assert.equal(await messageCount(10), 1);
});

test('both functions preserve caller RLS and the trigger helper is not exposed', async () => {
  const rows = (await db.query("select proname,prosecdef,proconfig from pg_proc where proname in('reopen_member_ticket','send_member_support_reply')")).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.prosecdef === false));
  assert.ok(rows.every(row => row.proconfig.some(value => value === 'search_path=""' || value === 'search_path=')));
  await as(A, () => assert.rejects(db.query('select support_private.reopen_member_ticket()'), /permission denied/));
  assert.equal((await db.query("select count(*)::int n from pg_class where relname in('support_tickets','support_messages') and relrowsecurity")).rows[0].n, 2);
});

test('reapplying the migration preserves data and leaves one insert trigger', async () => {
  const before = await messageCount(1); await db.exec(current);
  assert.equal(await messageCount(1), before);
  assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname='support_member_reply_reopens_ticket'")).rows[0].n, 1);
  const receipt = (await as(A, () => send(1, 1))).rows[0].receipt;
  assert.equal(receipt.replayed, true); assert.equal(receipt.ticket_status, 'solved');
});
