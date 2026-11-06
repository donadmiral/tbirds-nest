const {test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {LocalPsqlSession}=require('./local-psql-session.cjs');
if(!process.env.PC_TEST_PSQL)test('sandbox budget tests require isolated PostgreSQL',{skip:true},()=>{});
else{
 let db;const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const q=sql=>db.query(sql),v=async sql=>{const value=await q(sql);try{return JSON.parse(value);}catch{return value;}};
 const reserve=n=>v(`select reserve_media_sandbox_v1('${id(n)}',repeat('a',64))`);
 const attach=n=>v(`select attach_media_sandbox_v1('${id(n)}','sbx_fixture_${n}12','cmd_fixture_${n}12')`);
 const finish=n=>v(`select finish_media_sandbox_v1('${id(n)}','sbx_fixture_${n}12',0)`);
 async function queue(n=90){await q(`insert into media_renditions.jobs(source_id,source_version,source_bucket,source_path,source_owner,source_bytes,source_etag,source_mime) values('${id(n)}','v1','post-media','${id(91)}/fixture.mov','${id(91)}',536371200,'fixture','video/quicktime')`);}
 before(async()=>{
  if(process.env.PGDATABASE!=='pc_scale_media_sandbox')throw Error('Dedicated pc_scale_media_sandbox database required');db=new LocalPsqlSession();
  await q("set client_min_messages='warning';drop schema if exists media_renditions,media_processing,media_delivery,storage,auth,extensions,public cascade;create schema public");
  for(const file of ['media-processing-fixture.sql','../migrations/20261102071532_durable_media_processing_v1.sql','../migrations/20261102090521_adaptive_media_renditions_v2.sql','../migrations/20261102100428_media_broker_scoped_credentials_v2.sql','../migrations/20261102174937_bounded_media_sandbox_dispatch_v1.sql','../migrations/20261105045037_media_sandbox_production_budget_bounds_v1.sql','../migrations/20261106225000_bounded_parallel_encoder_slots.sql'])await q(fs.readFileSync(path.join(__dirname,file),'utf8'));
 });
 after(async()=>db?.close());
 beforeEach(async()=>{await q("reset role;set request.jwt.claims='{\"role\":\"service_role\"}';truncate media_renditions.sandbox_runs,media_renditions.sandbox_usage,media_renditions.publications,media_renditions.assets,media_renditions.attempts,media_renditions.jobs;update media_renditions.sandbox_settings set enabled=false,max_parallel_runs=1,daily_wall_seconds=1560,monthly_wall_seconds=6240,daily_cpu_seconds=3120,monthly_cpu_seconds=12480;update media_renditions.settings set worker_enabled=false,maintenance_enabled=false,emergency_revoke=false,input_max_bytes=536870912");});
 test('inert install and private table / public RPC ACLs fail closed',async()=>{
  await queue();assert.equal(await reserve(1),'');assert.equal((await v('select media_sandbox_status_v1()')).enabled,false);
  for(const role of ['anon','authenticated'])for(const fn of ['reserve_media_sandbox_v1(uuid,text)','attach_media_sandbox_v1(uuid,text,text)','pending_media_sandboxes_v1()','finish_media_sandbox_v1(uuid,text,integer)','media_sandbox_status_v1()'])assert.equal(await v(`select has_function_privilege('${role}','public.${fn}','EXECUTE')`),'f');
  for(const role of ['anon','authenticated','service_role'])assert.equal(await v(`select has_table_privilege('${role}','media_renditions.sandbox_runs','SELECT')`),'f');
 });
 test('a burst earns a second slot only with independent demand and remaining budget',async()=>{
  await q('update media_renditions.sandbox_settings set enabled=true,max_parallel_runs=2;update media_renditions.settings set worker_enabled=true,concurrency=2');
  await queue();assert.ok((await reserve(1)).id);assert.equal(await reserve(2),'');
  await queue(92);await queue(93);
  const other=new LocalPsqlSession();try{
   await other.query("set request.jwt.claims='{\"role\":\"service_role\"}'");
   const attempts=await Promise.all([q(`select reserve_media_sandbox_v1('${id(2)}',repeat('a',64))`),other.query(`select reserve_media_sandbox_v1('${id(3)}',repeat('a',64))`)]);
   assert.equal(attempts.filter(Boolean).length,1);
  }finally{await other.close();}
  assert.equal((await v('select media_sandbox_status_v1()')).active_reservations,2);
  assert.equal(await v("select creations from media_renditions.sandbox_usage where period='day'"),2);
  assert.equal(await attach(1),'t');assert.equal(await finish(1),'t');
  assert.equal(await reserve(4),'','the daily compute budget is still exhausted after freeing a slot');
 });
 test('enabled dispatcher with no queue reserves no resources or budget',async()=>{await q('update media_renditions.sandbox_settings set enabled=true;update media_renditions.settings set worker_enabled=true');assert.equal(await reserve(1),'');assert.equal(await v('select count(*) from media_renditions.sandbox_usage'),0);});
 test('atomic global reservation enforces one VM across concurrent connections',async()=>{
  await q('update media_renditions.sandbox_settings set enabled=true;update media_renditions.settings set worker_enabled=true');await queue();
  const other=new LocalPsqlSession();await other.query("set request.jwt.claims='{\"role\":\"service_role\"}'");
  try{await q('begin');assert.ok((await reserve(1)).id);let done=false;const contender=other.query(`select reserve_media_sandbox_v1('${id(2)}',repeat('b',64))`).then(r=>{done=true;return r;});await new Promise(r=>setTimeout(r,40));assert.equal(done,false);await q('commit');assert.equal(await contender,'');assert.equal(await v('select sum(creations) from media_renditions.sandbox_usage'),2);}finally{await other.close();}
 });
 test('daily full-wall and CPU charge is never refunded after successful stop',async()=>{
  await q('update media_renditions.sandbox_settings set enabled=true;update media_renditions.settings set worker_enabled=true');await queue();
  for(const n of [1,2]){assert.ok((await reserve(n)).id);assert.equal(await attach(n),'t');assert.equal(await finish(n),'t');}
  assert.equal(await reserve(3),'');assert.equal(await v("select wall_seconds from media_renditions.sandbox_usage where period='day'"),1560);assert.equal(await v("select cpu_seconds from media_renditions.sandbox_usage where period='month'"),3120);
 });
 test('monthly wall and CPU ceilings independently reject further reservations atomically',async()=>{
  await q('update media_renditions.sandbox_settings set enabled=true;update media_renditions.settings set worker_enabled=true');await queue();
  for(const metric of ['wall_seconds','cpu_seconds']){
   await q("truncate media_renditions.sandbox_usage;insert into media_renditions.sandbox_usage(period,starts_on) values('month',date_trunc('month',now() at time zone 'UTC')::date)");
   await q(`update media_renditions.sandbox_usage set ${metric}=${metric==='wall_seconds'?6240:12480}`);
   assert.equal(await reserve(1),'');assert.equal(await v("select coalesce(sum(creations),0) from media_renditions.sandbox_usage"),0);
  }
 });
 test('ambiguous expired create cannot free the VM slot solely by elapsed time',async()=>{
  await q('update media_renditions.sandbox_settings set enabled=true;update media_renditions.settings set worker_enabled=true');await queue();await reserve(1);
  assert.equal(await v(`select finish_media_sandbox_v1('${id(1)}',null,null)`),'f');
  await q("update media_renditions.sandbox_runs set launch_until=now()-interval '15 minutes',stop_after=now()-interval '1 second'");assert.equal(await reserve(2),'');
  assert.equal(await v(`select finish_media_sandbox_v1('${id(1)}',null,null)`),'t');assert.ok((await reserve(2)).id);
 });
 test('session attachment and completion reject mismatches and reused launch IDs',async()=>{
  await q('update media_renditions.sandbox_settings set enabled=true;update media_renditions.settings set worker_enabled=true');await queue();await reserve(1);assert.equal(await attach(1),'t');
  assert.equal(await v(`select attach_media_sandbox_v1('${id(1)}','sbx_other_123','cmd_other_123')`),'f');assert.equal(await v(`select finish_media_sandbox_v1('${id(1)}','sbx_other_123',0)`),'f');assert.equal(await finish(1),'t');assert.equal(await reserve(1),'');
 });
 test('media emergency revoke and input cap prevent new VM creation',async()=>{
  await q('update media_renditions.sandbox_settings set enabled=true;update media_renditions.settings set worker_enabled=true,emergency_revoke=true');await queue();assert.equal(await reserve(1),'');
  await q('update media_renditions.settings set emergency_revoke=false,input_max_bytes=104857600');assert.equal(await reserve(1),'');
 });
 test('null source hashes roll back every reservation and usage write',async()=>{
  await q('update media_renditions.sandbox_settings set enabled=true;update media_renditions.settings set worker_enabled=true');await queue();
  assert.equal(await v(`select fixture_fails($q$select reserve_media_sandbox_v1('${id(1)}',null)$q$)`),'t');
  assert.equal(await v('select count(*) from media_renditions.sandbox_runs'),0);assert.equal(await v('select count(*) from media_renditions.sandbox_usage'),0);
 });
 test('late attachment and ambiguous failure preserve both charged budget and slot',async()=>{
  await q('update media_renditions.sandbox_settings set enabled=true;update media_renditions.settings set worker_enabled=true');await queue();await reserve(1);
  await q("update media_renditions.sandbox_runs set launch_until=now()-interval '1 second'");assert.equal(await attach(1),'f');
  assert.equal(await v(`select finish_media_sandbox_v1('${id(1)}',null,null)`),'f');assert.equal(await reserve(2),'');
  assert.equal(await v("select cpu_seconds from media_renditions.sandbox_usage where period='day'"),1560);
 });
 test('new launcher scope is distinct and remains hash-authenticated',async()=>{
  await q(`insert into media_renditions.broker_keys(id,role,token_hash,max_requests_per_minute) values('${id(70)}','dispatcher',extensions.digest(repeat('c',64),'sha256'),128)`);
  assert.equal(await v(`select authorize_media_broker_v2('${id(70)}',encode(extensions.digest(repeat('c',64),'sha256'),'hex'),'${id(71)}',clock_timestamp())`),'dispatcher');
 });
 test('production bounds keep the defaults inert and allow an explicit twelve-job batch without weakening one-VM ownership',async()=>{
  const initial=await v('select to_jsonb(s) from media_renditions.sandbox_settings s');
  assert.equal(initial.enabled,false);assert.equal(initial.daily_wall_seconds,1560);assert.equal(initial.monthly_wall_seconds,6240);
  await q('update media_renditions.sandbox_settings set enabled=true,daily_wall_seconds=9360,daily_cpu_seconds=18720,monthly_wall_seconds=15600,monthly_cpu_seconds=31200;update media_renditions.settings set worker_enabled=true');await queue();
  for(let n=1;n<=12;n++){
   assert.ok((await reserve(n)).id);assert.equal(await reserve(100+n),'');
   assert.equal(await attach(n),'t');assert.equal(await finish(n),'t');
  }
  assert.equal(await reserve(13),'');assert.equal(await v("select creations from media_renditions.sandbox_usage where period='day'"),12);
  assert.equal(await v("select wall_seconds from media_renditions.sandbox_usage where period='month'"),9360);
 });
 test('production budget cannot exceed the reviewed ceilings',async()=>{
  for(const assignment of ['daily_wall_seconds=78001','daily_cpu_seconds=156001','monthly_wall_seconds=1560001','monthly_cpu_seconds=3120001'])
   assert.equal(await v(`select fixture_fails('update media_renditions.sandbox_settings set ${assignment}')`),'t');
 });
}
