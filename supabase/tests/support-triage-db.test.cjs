const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require('./rpc-authorization/node_modules/@electric-sql/pglite');
const A='10000000-0000-4000-8000-000000000001', S='10000000-0000-4000-8000-000000000002', T='20000000-0000-4000-8000-000000000001';
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema admin_ops;
 create table admin_users(user_id uuid primary key,role text,active boolean);
 create table profiles(id uuid primary key,full_name text);
 create table support_tickets(id uuid primary key,status text,created_at timestamptz);
 create table support_messages(id uuid primary key default gen_random_uuid(),ticket_id uuid,sender text,created_at timestamptz default now());
 create table admin_audit_log(id uuid default gen_random_uuid(),admin_id uuid,action text,target_kind text,target_id text,reason text,before jsonb,after jsonb);
 create table admin_ops.commands(command_key uuid primary key,actor_id uuid,operation text,payload jsonb,result jsonb);
 create function admin_ops.require_session(uuid,uuid,text) returns text language plpgsql as $$begin if $1<>'${A}' or $2<>'${S}' or $3<>'support' then raise exception 'ACTIVE_ADMIN_SESSION_REQUIRED';end if;return 'support_agent';end;$$;
 insert into admin_users values('${A}','support_agent',true),('${S}','finance_admin',true);
 insert into profiles values('${A}','Support tester');
 insert into support_tickets values('${T}','open',now()-interval '2 days');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261023191000_support_triage.sql'),'utf8'));
});
after(async()=>db.close());
const update=(key,version,assigned=A,actor=A)=>db.query('select admin_support_triage_update($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[actor,S,key,T,version,assigned,'urgent','safety',true,'Escalated for review']);
test('triage assignment is audited, replay-safe and rejects stale edits',async()=>{
 const key='30000000-0000-4000-8000-000000000001';
 assert.equal((await update(key,0)).rows[0].value.version,1);
 assert.equal((await update(key,0)).rows[0].value.version,1);
 assert.equal((await db.query('select count(*)::int n from admin_audit_log')).rows[0].n,1);
 await assert.rejects(update(key,1),/COMMAND_CONFLICT/);
 await assert.rejects(update('30000000-0000-4000-8000-000000000002',0),/TRIAGE_CHANGED/);
 await assert.rejects(update('30000000-0000-4000-8000-000000000002',1,S),/INVALID_ASSIGNEE/);
 await assert.rejects(update('30000000-0000-4000-8000-000000000002',1,A,S),/ACTIVE_ADMIN_SESSION_REQUIRED/);
});
test('response deadline follows the latest member message and clears after staff response',async()=>{
 const read=async()=>(await db.query('select admin_support_triage_read($1) value',[[T]])).rows[0].value[0];
 let row=await read();assert.equal(row.assigned_name,'Support tester');assert.ok(Date.parse(row.response_due_at)<Date.now());
 await db.query("insert into support_messages(ticket_id,sender,created_at) values($1,'ops',now())",[T]);
 assert.equal((await read()).response_due_at,null);
 await db.query("insert into support_messages(ticket_id,sender,created_at) values($1,'member',now()+interval '1 second')",[T]);
 assert.ok(Date.parse((await read()).response_due_at)>Date.now());
 await db.query("update support_tickets set status='solved' where id=$1",[T]);
 assert.equal((await read()).response_due_at,null);
});
test('triage data and commands are not exposed to app users',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(db.query('select admin_support_triage_read($1)',[[T]]),/permission denied/);
  await assert.rejects(db.query('select * from admin_ops.support_triage'),/permission denied/);
  await db.exec('reset role');
 }
});
