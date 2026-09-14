import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Isolated PostgreSQL/WASM dependency, never bundled into the mobile app.
// Converts the Windows absolute path supplied by the local runner, too.
const moduleName = process.env.TRINITI_PGLITE_MODULE;
const { PGlite } = await import(moduleName ? pathToFileURL(moduleName).href : '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20260910230211_chat_payment_recovery.sql', import.meta.url), 'utf8');
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222', C='33333333-3333-4333-8333-333333333333';
const C1='00000000-0000-4000-8000-000000000001', C2='00000000-0000-4000-8000-000000000002', C3='00000000-0000-4000-8000-000000000003', C4='00000000-0000-4000-8000-000000000004';
const P1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', P2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', P3='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LEGACY_VALID='dddddddd-dddd-4ddd-8ddd-dddddddddddd', LEGACY_INVALID='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
async function asRole(db,role,owner=role==='authenticated'?A:'') {
  await db.exec(`reset role; set role ${role}; set request.jwt.claim.role='${role}'; set request.jwt.claim.sub='${owner}';`);
}
async function fixture() {
  const db=new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${A}'),('${B}'),('${C}');
    create table public.conversations(id uuid primary key,user_1 uuid,user_2 uuid,last_message text,last_message_time timestamptz,last_message_sender_id uuid);
    insert into public.conversations(id,user_1,user_2) values('${C1}','${A}','${B}'),('${C2}','${A}','${B}'),('${C3}','${A}','${C}'),('${C4}','${C}','${B}');
    create table public.chat_payments(
      id uuid primary key default gen_random_uuid(),conversation_id uuid not null,
      sender_id uuid not null references auth.users(id),recipient_id uuid not null references auth.users(id),
      status text not null check(status in('pending','completed','failed')),
      amount numeric not null default 5,currency text not null default 'USD',tx_id text,error text,note text,listing_id uuid,idempotency_key text,
      created_at timestamptz not null default now(),completed_at timestamptz,
      constraint chat_payments_conversation_id_fkey foreign key(conversation_id) references public.conversations(id) on delete cascade
    );
    create table public.messages(
      id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id),sender_id uuid not null,receiver_id uuid,
      text text,media_type text,payment_id uuid references public.chat_payments(id) on delete set null,created_at timestamptz not null default now(),
      read_at timestamptz,viewed_at timestamptz,delivered_at timestamptz
    );
    grant all on public.chat_payments,public.conversations,public.messages to public,anon,authenticated,service_role;
    alter table public.conversations enable row level security;
    create policy conversations_participant on public.conversations for all to authenticated using(user_1=auth.uid() or user_2=auth.uid()) with check(user_1=auth.uid() or user_2=auth.uid());
    create policy chat_payments_own on public.chat_payments for select to public using(sender_id=auth.uid() or recipient_id=auth.uid());
    alter table public.messages enable row level security;
    create policy messages_own on public.messages for all to authenticated using(sender_id=auth.uid()) with check(sender_id=auth.uid());
    insert into public.chat_payments(id,conversation_id,sender_id,recipient_id,status,created_at,tx_id,idempotency_key) values
      ('${P1}','${C1}','${A}','${B}','pending','2026-01-01',null,'stable-key-one'),
      ('${P2}','${C4}','${C}','${B}','pending','2026-01-01',null,'stable-key-two'),
      ('${P3}','${C2}','${A}','${B}','completed','2026-01-01','99999999-9999-4999-8999-999999999999','stable-key-three');
    insert into public.messages(id,conversation_id,sender_id,receiver_id,text,media_type,payment_id) values
      ('${LEGACY_VALID}','${C2}','${A}','${B}',null,'payment','${P3}'),
      ('${LEGACY_INVALID}','${C1}','${A}','${B}','untrusted legacy receipt','payment','${P1}');
    -- Reproduce the existing privileged account-deletion path, which explicitly
    -- deletes payment rows first and therefore bypasses the conversation FK.
    create function public.fixture_delete_account(p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
    begin
      if auth.uid() is distinct from p_user_id then raise exception 'unauthorized'; end if;
      delete from public.chat_payments where sender_id=p_user_id or recipient_id=p_user_id;
      delete from auth.users where id=p_user_id;
    end $$;
    grant execute on function public.fixture_delete_account(uuid) to authenticated;
    create function public.fixture_edit_receipt(p_message_id uuid) returns void language plpgsql security definer set search_path='' as $$
    begin update public.messages set text='forged through privileged helper' where id=p_message_id; end $$;
    grant execute on function public.fixture_edit_receipt(uuid) to authenticated;
    create function public.fixture_ack_receipt(p_message_id uuid,p_tamper boolean default false) returns void language plpgsql security definer set search_path='' as $$
    begin
      update public.messages set read_at=now(),viewed_at=now(),delivered_at=now(),text=case when p_tamper then 'tampered receipt' else text end
      where id=p_message_id and receiver_id=auth.uid();
    end $$;
    grant execute on function public.fixture_ack_receipt(uuid,boolean) to authenticated;
  `);
  await db.exec(migration);
  await db.exec(migration);
  return db;
}

test('real PostgreSQL migration preserves payment identities and trusted receipts',async t=>{
  const db=await fixture();
  try {
    await t.test('owner reads survive while direct client payment writes are denied',async()=>{
      const {rows}=await db.query(`select
        has_table_privilege('authenticated','public.chat_payments','SELECT') as can_read,
        has_table_privilege('authenticated','public.chat_payments','INSERT') as can_insert,
        has_table_privilege('authenticated','public.chat_payments','UPDATE') as can_update,
        has_table_privilege('authenticated','public.chat_payments','DELETE') as can_delete,
        has_table_privilege('anon','public.chat_payments','UPDATE') as anon_update,
        has_table_privilege('service_role','public.chat_payments','UPDATE') as worker_update`);
      assert.deepEqual(rows[0],{can_read:true,can_insert:false,can_update:false,can_delete:false,anon_update:false,worker_update:true});
      await asRole(db,'authenticated');
      assert.deepEqual((await db.query('select id from public.chat_payments order by id')).rows.map(r=>r.id),[P1,P3]);
      await assert.rejects(db.exec(`update public.chat_payments set status='completed'`),/permission denied/);
      await assert.rejects(db.exec(`insert into public.chat_payments(conversation_id,sender_id,recipient_id,status) values('${C1}','${A}','${B}','pending')`),/permission denied/);
    });
    await t.test('pending and completed payment conversations cannot cascade away evidence',async()=>{
      await asRole(db,'authenticated');
      await assert.rejects(db.exec(`delete from public.conversations where id='${C1}'`));
      await assert.rejects(db.exec(`delete from public.conversations where id='${C2}'`));
      assert.equal((await db.query(`select count(*)::int as n from public.chat_payments where id in('${P1}','${P3}')`)).rows[0].n,2);
      await db.exec(`delete from public.conversations where id='${C3}'`);
      assert.equal((await db.query(`select count(*)::int as n from public.conversations where id='${C3}'`)).rows[0].n,0);
      // This conversation has no messages: only the payment FK can stop deletion.
      await asRole(db,'authenticated',C);
      await assert.rejects(db.exec(`delete from public.conversations where id='${C4}'`),/chat_payments_conversation_id_fkey/);
      await asRole(db,'service_role');
      assert.equal((await db.query("select confdeltype from pg_constraint where conname='chat_payments_conversation_id_fkey'")).rows[0].confdeltype,'r');
    });
    await t.test('privileged account deletion and service delete/truncate preserve payment identities',async()=>{
      await asRole(db,'authenticated');
      await assert.rejects(db.query(`select public.fixture_delete_account('${A}')`),/reviewed retention process/);
      await asRole(db,'service_role');
      await assert.rejects(db.exec(`delete from public.chat_payments where id='${P1}'`));
      await assert.rejects(db.exec('truncate public.chat_payments cascade'));
      assert.equal((await db.query('select count(*)::int as n from public.chat_payments')).rows[0].n,3);
      await db.exec('reset role;');
      assert.equal((await db.query(`select count(*)::int as n from auth.users where id='${A}'`)).rows[0].n,1);
    });
    await t.test('only structurally valid completed legacy receipts are backfilled',async()=>{
      await asRole(db,'service_role');
      const {rows}=await db.query('select id,payment_receipt_verified from public.messages order by id');
      assert.deepEqual(rows,[{id:LEGACY_VALID,payment_receipt_verified:true},{id:LEGACY_INVALID,payment_receipt_verified:false}]);
    });
    await t.test('clients cannot forge, reclassify, edit or delete payment messages',async()=>{
      await asRole(db,'authenticated');
      await assert.rejects(db.exec(`insert into public.messages(conversation_id,sender_id,receiver_id,text,media_type,payment_id) values('${C1}','${A}','${B}','forged','payment','${P1}')`));
      await assert.rejects(db.exec(`insert into public.messages(conversation_id,sender_id,text,media_type) values('${C1}','${A}','forged','payment')`));
      await assert.rejects(db.exec(`insert into public.messages(conversation_id,sender_id,text,payment_receipt_verified) values('${C1}','${A}','forged',true)`));
      await assert.rejects(db.exec(`update public.messages set text='changed amount' where id='${LEGACY_VALID}'`));
      await assert.rejects(db.exec(`update public.messages set payment_id=null,media_type='text',payment_receipt_verified=false where id='${LEGACY_VALID}'`));
      await assert.rejects(db.exec(`delete from public.messages where id='${LEGACY_VALID}'`));
      await assert.rejects(db.exec(`delete from public.messages where id='${LEGACY_INVALID}'`));
      await assert.rejects(db.query(`select public.fixture_edit_receipt('${LEGACY_VALID}')`),/managed by the payment service/);
      const inserted=await db.query(`insert into public.messages(conversation_id,sender_id,receiver_id,text,media_type) values('${C1}','${A}','${B}','ordinary chat','text') returning id`);
      const id=inserted.rows[0].id;
      await db.exec(`update public.messages set text='edited ordinary chat' where id='${id}'`);
      await assert.rejects(db.exec(`update public.messages set payment_id='${P1}' where id='${id}'`));
      await db.exec(`delete from public.messages where id='${id}'`);
      assert.equal((await db.query(`select count(*)::int as n from public.messages where id='${id}'`)).rows[0].n,0);
    });
    await t.test('anonymous and trusted service callers cannot forge a canonical receipt',async()=>{
      await asRole(db,'anon');
      await assert.rejects(db.exec(`insert into public.messages(conversation_id,sender_id,receiver_id,media_type,payment_id) values('${C1}','${A}','${B}','payment','${P1}')`));
      await asRole(db,'service_role');
      await assert.rejects(db.exec(`insert into public.messages(conversation_id,sender_id,receiver_id,media_type,payment_id,payment_receipt_verified) values('${C1}','${A}','${B}','payment','${P1}',true)`),/does not match a completed payment/);
      await assert.rejects(db.exec(`insert into public.messages(conversation_id,sender_id,receiver_id,media_type,payment_id,payment_receipt_verified) values('${C2}','${A}','${C}','payment','${P3}',true)`),/does not match a completed payment/);
    });
    await t.test('recipient read acknowledgements work without granting receipt editing',async()=>{
      await asRole(db,'authenticated',B);
      await db.query(`select public.fixture_ack_receipt('${LEGACY_VALID}')`);
      await assert.rejects(db.query(`select public.fixture_ack_receipt('${LEGACY_VALID}',true)`),/managed by the payment service/);
      await asRole(db,'authenticated',A);
      await assert.rejects(db.exec(`update public.messages set read_at=now() where id='${LEGACY_VALID}'`),/managed by the payment service/);
      await asRole(db,'service_role');
      const {rows}=await db.query(`select text,read_at is not null as read,viewed_at is not null as viewed,delivered_at is not null as delivered from public.messages where id='${LEGACY_VALID}'`);
      assert.deepEqual(rows,[{text:null,read:true,viewed:true,delivered:true}]);
    });
    await t.test('service completion creates exactly one trusted receipt alongside unverified legacy content',async()=>{
      await asRole(db,'service_role');
      await db.exec(`update public.chat_payments set status='completed',tx_id='88888888-8888-4888-8888-888888888888',completed_at=now() where id='${P1}'`);
      await db.exec(`update public.chat_payments set last_status_check_at=now() where id='${P1}'`);
      const {rows}=await db.query(`select conversation_id,sender_id,receiver_id,text,media_type,payment_receipt_verified from public.messages where payment_id='${P1}' and payment_receipt_verified=true`);
      assert.deepEqual(rows,[{conversation_id:C1,sender_id:A,receiver_id:B,text:null,media_type:'payment',payment_receipt_verified:true}]);
      assert.equal((await db.query(`select count(*)::int as n from public.messages where payment_id='${P1}'`)).rows[0].n,2);
      await assert.rejects(db.exec(`insert into public.messages(conversation_id,sender_id,receiver_id,text,media_type,payment_id,payment_receipt_verified) values('${C1}','${A}','${B}',null,'payment','${P1}',true)`),/duplicate key|unique constraint/);
    });
    await t.test('pending work remains selectable through the bounded recovery index',async()=>{
      await asRole(db,'service_role');
      const next=await db.query("select id from public.chat_payments where status='pending' order by last_status_check_at nulls first,id limit 1");
      assert.equal(next.rows[0].id,P2);
      assert.equal((await db.query("select indexname from pg_indexes where indexname='chat_payments_pending_recovery_idx'")).rows.length,1);
    });
  } finally {await db.close();}
});
