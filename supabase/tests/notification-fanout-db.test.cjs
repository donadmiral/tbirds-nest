const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {LocalPsqlSession}=require('./local-psql-session.cjs');
const {PGlite}=require('./rpc-authorization/node_modules/@electric-sql/pglite');
const {captured,sql,id}=require('./feed-scale-fixture.cjs');
let db,real;const group=id(90000),sender=id(1);
const exec=async q=>real?db.query(q):db.exec(q);
const value=async q=>real?JSON.parse(await db.query(`select to_jsonb(q) from(${q})q;`)):(await db.query(q)).rows[0];
const rows=async q=>real?JSON.parse(await db.query(`select coalesce(jsonb_agg(q),'[]') from(${q})q;`)):(await db.query(q)).rows;
const message=(n)=>`insert into messages(id,conversation_id,sender_id,text) values('${id(100000+n)}','${group}','${sender}','Original message ${n}');`;
async function drain(){
 for(let n=0;n<100;n++){
  if((await value("select count(*)::int n from notification_fanout.jobs where state='pending'")).n===0)return;
  await exec('select drain_notification_fanout_v1(64,75);');
 }
 throw Error('Unexpected fanout backlog');
}
async function clear(){await exec('delete from messages;delete from notifications;');}
before(async()=>{
 real=!!process.env.PC_TEST_PSQL;
 if(real&&process.env.PGDATABASE!=='pc_scale_notification_fanout')throw Error('Use disposable pc_scale_notification_fanout.');
 db=real?new LocalPsqlSession():new PGlite();
 await exec(`drop schema if exists notification_fanout cascade;drop schema public cascade;create schema public;
 do $$begin
  if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;
  if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role;end if;
 end$$;
 create table profiles(id uuid primary key,full_name text,account_type text default 'personal');
 create table conversations(id uuid primary key,is_group boolean,group_name text);
 create table conversation_members(conversation_id uuid,user_id uuid,joined_at timestamptz default now(),last_read_at timestamptz default now(),primary key(conversation_id,user_id));
 create table messages(id uuid primary key,conversation_id uuid,sender_id uuid,receiver_id uuid,text text,media_type text,is_system_message boolean default false,created_at timestamptz default now());
 create table notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,actor_id uuid,type text,message text,body_preview text,data jsonb,created_at timestamptz default now(),account_type text);
 insert into profiles(id,full_name) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Member '||n from generate_series(1,8000)n;
 insert into conversations values('${group}',true,'Existing Group');
 insert into conversation_members(conversation_id,user_id) select '${group}',id from profiles where id<='${id(1004)}';
 ${captured('notify_on_new_message')}
 ${captured('stamp_notification_account_type')}
 create trigger stamp_notification before insert on notifications for each row execute function stamp_notification_account_type();
 create trigger notify_message after insert on messages for each row execute function notify_on_new_message();
 create table legacy_dispatch_calls(id uuid);
 create function notify_push_notification()returns trigger language plpgsql as $$begin insert into public.legacy_dispatch_calls values(new.id);return new;end$$;
 create trigger legacy_push after insert on notifications for each row execute function notify_push_notification();`);
 await exec(sql('20261102090627_durable_notification_fanout.sql'));
 await exec(sql('20261106230400_group_notification_cohorts.sql'));
});
after(async()=>await db?.close());
test('disabled fanout preserves the original synchronous group records and titles',async()=>{
 await exec(message(1));
 assert.equal((await value('select count(*)::int n from notifications')).n,1003);
 assert.equal((await value('select count(*)::int n from notification_fanout.jobs')).n,0);
 const n=await value('select message,body_preview,data from notifications limit 1');
 assert.equal(n.message,'Member 1 in Existing Group');assert.equal(n.body_preview,'Original message 1');
 assert.equal(n.data.is_group,true);assert.equal(n.data.group_name,'Existing Group');
});
test('group send writes constant durable work and bounded pages produce each notification once',async()=>{
 await clear();await exec('select configure_notification_fanout_v1(true,false);'+message(2));
 assert.equal((await value('select count(*)::int n from notifications')).n,0);
 assert.equal((await value('select count(*)::int n from notification_fanout.jobs')).n,16);
 const page=await value('select drain_notification_fanout_v1(2,17) result');
 assert.ok(page.result.notifications<=34);await drain();
 assert.equal((await value('select count(*)::int n from notifications')).n,1003);
 assert.equal((await value('select count(distinct recipient_id)::int n from notifications')).n,1003);
 await exec('select drain_notification_fanout_v1(64,500);');
 assert.equal((await value('select count(*)::int n from notifications')).n,1003);
});
test('joining and leaving after a message cannot change its captured recipient snapshot',async()=>{
 await clear();await exec(message(3));
 await exec(`insert into conversation_members(conversation_id,user_id) values('${group}','${id(5000)}');
 delete from conversation_members where user_id='${id(2)}';`);await drain();
 assert.equal((await value(`select count(*)::int n from notifications where recipient_id='${id(2)}'`)).n,1);
 assert.equal((await value(`select count(*)::int n from notifications where recipient_id='${id(5000)}'`)).n,0);
});
test('same-transaction membership changes respect their order around the message',async()=>{
 await clear();await exec(`begin;insert into conversation_members(conversation_id,user_id) values('${group}','${id(6000)}');
 ${message(4)}insert into conversation_members(conversation_id,user_id) values('${group}','${id(6001)}');commit;`);await drain();
 assert.equal((await value(`select count(*)::int n from notifications where recipient_id='${id(6000)}'`)).n,1);
 assert.equal((await value(`select count(*)::int n from notifications where recipient_id='${id(6001)}'`)).n,0);
});
test('real membership transaction committed after enqueue is excluded even when its transaction began earlier',{skip:!process.env.PC_TEST_PSQL},async()=>{
 await clear();const other=new LocalPsqlSession();
 try{
  await other.query(`begin;insert into conversation_members(conversation_id,user_id) values('${group}','${id(7000)}');`);
  await exec(message(5));await other.query('commit;');await drain();
  assert.equal((await value(`select count(*)::int n from notifications where recipient_id='${id(7000)}'`)).n,0);
 }finally{await other.close();}
});
test('failed page rolls back recipients and cursor, then dead-letter retry resumes without duplication',async()=>{
 await clear();await exec(`create function fixture_notification_failure()returns trigger language plpgsql as $$begin
  if new.recipient_id='${id(3)}' then raise exception 'synthetic delivery fault';end if;return new;end$$;
 create trigger fixture_notification_failure before insert on notifications for each row execute function fixture_notification_failure();${message(6)}`);
 for(let n=0;n<8;n++){
  await exec("update notification_fanout.jobs set available_at=clock_timestamp() where state='pending';select drain_notification_fanout_v1(64,500);");
 }
 const dead=await value("select id::text id,attempts,last_error from notification_fanout.jobs where state='dead'");
 assert.equal(dead.attempts,8);assert.equal(dead.last_error,'P0001');
 assert.equal((await value(`select count(*)::int n from notification_fanout.recipients where user_id='${id(3)}'`)).n,0);
 await exec(`drop trigger fixture_notification_failure on notifications;select retry_notification_dead_letter_v1('${dead.id}','fanout');`);
 await drain();
 const totals=await value('select count(*)::int n,count(distinct recipient_id)::int unique_n from notifications');
 assert.equal(totals.n,totals.unique_n);
 assert.equal((await value(`select count(*)::int n from notifications where recipient_id='${id(3)}'`)).n,1);
});
test('durable ordinary dispatch suppresses legacy send and uses fenced retryable leases',async()=>{
 await clear();await exec('truncate legacy_dispatch_calls;select claim_notification_dispatch_v1(1,90);select configure_notification_fanout_v1(true,true);');
 await exec(`insert into notifications(recipient_id,type,message) values('${id(3)}','like','Existing like');`);
 assert.equal((await value('select count(*)::int n from legacy_dispatch_calls')).n,0);
 const [first]=await rows('select * from claim_notification_dispatch_v1(1,90)');
 assert.equal(first.attempts,1);
 await exec(`update notification_fanout.dispatch_jobs set lease_until=now()-interval '1 second' where id='${first.id}';`);
 const [second]=await rows('select * from claim_notification_dispatch_v1(1,90)');
 assert.notEqual(second.lease_id,first.lease_id);assert.equal(second.attempts,2);
 assert.equal((await value(`select complete_notification_dispatch_v1('${first.id}','${first.lease_id}','delivered') ok`)).ok,false);
 assert.equal((await value(`select complete_notification_dispatch_v1('${second.id}','${second.lease_id}','delivered',null,1,0,0) ok`)).ok,true);
 assert.equal((await value("select state,accepted from notification_fanout.dispatch_jobs where id='"+first.id+"'")).state,'delivered');
});
test('dispatch retries are bounded, dead letters retain outcomes and rollback still drains old queued work',async()=>{
 await clear();await exec(`insert into notifications(recipient_id,type,message) values('${id(3)}','like','Retry me');`);
 let claimed;
 for(let n=0;n<8;n++){
  [claimed]=await rows('select * from claim_notification_dispatch_v1(1,90)');assert.equal(claimed.attempts,n+1);
  await exec(`select complete_notification_dispatch_v1('${claimed.id}','${claimed.lease_id}','retry','PROVIDER_OUTCOME_UNKNOWN',0,0,1);
    update notification_fanout.dispatch_jobs set available_at=clock_timestamp() where id='${claimed.id}';`);
 }
 assert.deepEqual(await value(`select state,unknown,attempts from notification_fanout.dispatch_jobs where id='${claimed.id}'`),{state:'dead',unknown:8,attempts:8});
 await exec(`select retry_notification_dead_letter_v1('${claimed.id}','dispatch');select configure_notification_fanout_v1(false,false);`);
 assert.equal((await rows('select * from claim_notification_dispatch_v1(1,90)')).length,1);
});
test('calls remain on their existing path and service work never becomes a public RPC',async()=>{
 await clear();await exec('select configure_notification_fanout_v1(true,true);');
 await exec(`insert into notifications(recipient_id,type,message) values('${id(3)}','incoming_call','Call');`);
 assert.equal((await value('select count(*)::int n from notification_fanout.dispatch_jobs')).n,0);
 const acl=await value(`select has_function_privilege('authenticated','claim_notification_dispatch_v1(integer,integer)','execute') member,
 has_table_privilege('authenticated','notification_fanout.jobs','select') raw,
 has_function_privilege('service_role','claim_notification_dispatch_v1(integer,integer)','execute') service`);
 assert.deepEqual(acl,{member:false,raw:false,service:true});
});

test('one consistent conversation cohort selects exactly one group-notification path',async()=>{
 await clear();
 const bucket=(await value(`select (get_byte(decode(md5('${group}'),'hex'),0)*100/256)::int as b`)).b;
 try{
  await exec(`select configure_notification_fanout_v1(true,false);update notification_fanout.settings set group_rollout_percent=${bucket};`+message(80));
  const immediate=(await value(`select count(*)::int n from notifications where data->>'message_id'='${id(100080)}'`)).n;
  assert.ok(immediate>0);
  assert.equal((await value(`select count(*)::int n from notification_fanout.jobs where message_id='${id(100080)}'`)).n,0);
  await exec(`update notification_fanout.settings set group_rollout_percent=${bucket+1};`+message(81));
  assert.equal((await value(`select count(*)::int n from notification_fanout.jobs where message_id='${id(100081)}'`)).n,16);
  await drain();
  assert.equal((await value(`select count(*)::int n from notifications where data->>'message_id'='${id(100081)}'`)).n,immediate);
 } finally{await exec('update notification_fanout.settings set group_rollout_percent=100');}
});

const reserve = (job, lease, units) =>
  `select public.qa_reserve_ordinary_expo_batch('${job}','${lease}',${units}) admission`;

async function seedAdmissionJobs(n) {
  await exec("truncate notification_fanout.qa_expo_windows;delete from notification_fanout.dispatch_jobs;");
  await exec(`insert into public.notifications(id,recipient_id,type) select
    ('aa000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${sender}','message' from generate_series(1,${n}) i on conflict do nothing;
    insert into notification_fanout.dispatch_jobs(notification_id,lease_id,lease_until,state,attempts)
    select id,gen_random_uuid(),clock_timestamp()+interval '90 seconds','leased',7 from public.notifications
      where id::text like 'aa000000-%' order by id limit ${n}
    on conflict(notification_id) do update set lease_id=excluded.lease_id,lease_until=excluded.lease_until,state='leased',attempts=7;`);
  return rows("select id,lease_id from notification_fanout.dispatch_jobs where state='leased' order by notification_id");
}

test('QA Expo single-batch reservations are scoped, replay-safe and refund a deferred lease once', async () => {
  const candidate = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../ops/qa/notification-expo-admission/single-batch.sql'), 'utf8');
  const previous = await value('select dispatch_enabled from notification_fanout.settings');
  await exec(candidate);
  assert.deepEqual(await value('select dispatch_enabled from notification_fanout.settings'), previous);
  const [first,blocked] = await seedAdmissionJobs(2);
  const admission = async (job, n) => (await value(reserve(job.id,job.lease_id,n))).admission;
  assert.equal(await admission(first,601), 'requires_device_checkpoints');
  assert.equal(await admission(first,100), 'granted');
  assert.equal(await admission(first,100), 'already_reserved');
  assert.equal((await value(reserve(first.id,blocked.lease_id,100))).admission,'stale');
  assert.equal((await value('select sum(units)::int total from notification_fanout.qa_expo_windows')).total,100);
  await exec("truncate notification_fanout.qa_expo_windows;insert into notification_fanout.qa_expo_windows select (tick%11)::int,tick,500 from (select floor(extract(epoch from clock_timestamp())*10)::bigint tick) c;");
  assert.equal(await admission(blocked,10),'deferred');
  assert.equal(await admission(blocked,10),'deferred');
  const state=await value(`select state,attempts,available_at>clock_timestamp() delayed,lease_until is null released from notification_fanout.dispatch_jobs where id='${blocked.id}'`);
  assert.deepEqual(state,{state:'pending',attempts:6,delayed:true,released:true});
  for(const role of ['anon','authenticated','service_role']) {
    const privileges=await value(`select has_function_privilege('${role}','public.qa_reserve_ordinary_expo_batch(uuid,uuid,integer)','EXECUTE') admission,has_table_privilege('${role}','notification_fanout.qa_expo_windows','UPDATE') direct`);
    assert.deepEqual(privileges,{admission:role==='service_role',direct:false});
  }
});

test('eight independent PG connections cannot oversubscribe the shared QA Expo window', { skip:!process.env.PC_TEST_PSQL }, async () => {
  const jobs=await seedAdmissionJobs(8);
  const workers=jobs.map(()=>new LocalPsqlSession());
  try {
    // All sessions reach the admission lock before the simultaneous release.
    await db.query('begin;select pg_advisory_xact_lock(51728941,1);');
    const pids=await Promise.all(workers.map(w=>w.query('select pg_backend_pid()')));
    const requests=workers.map((w,i)=>w.query(reserve(jobs[i].id,jobs[i].lease_id,100)));
    let waiting=0;
    for(let i=0;i<100 && waiting<8;i++) {
      waiting=Number(await db.query(`select count(*) from pg_locks where pid in (${pids.join(',')}) and locktype='advisory' and not granted`));
      if(waiting<8)await new Promise(resolve=>setTimeout(resolve,10));
    }
    await db.query('commit');
    assert.equal(waiting,8);
    const decisions=await Promise.all(requests);
    assert.equal(decisions.filter(d=>d==='granted').length,5);
    assert.equal(decisions.filter(d=>d==='deferred').length,3);
    assert.equal((await value('select sum(units)::int total from notification_fanout.qa_expo_windows')).total,500);
  } finally { await db.query('rollback');await Promise.all(workers.map(w=>w.close())); }
});
