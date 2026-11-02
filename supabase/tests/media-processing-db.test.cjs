const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {LocalPsqlSession}=require('./local-psql-session.cjs');
const enabled=!!process.env.PC_TEST_PSQL;
if(!enabled) test('media processing requires a disposable local PostgreSQL fixture',{skip:true},()=>{});
else {
 const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),entity=id(2),object=id(3),file=owner+'/source.mp4';
 const url='https://fixture.test/storage/v1/object/public/story-media/'+file;
 let db;
 const query=sql=>db.query(sql),val=async sql=>{const r=await query(sql);if(r==='')return null;try{return JSON.parse(r);}catch{return r;}};
 const claim=()=>val("select claim_media_processing_v1('inline',1)");
 const finish=(j,outcome='ready',code=null,retry=null)=>val(`select finish_media_processing_v1('${j.job_id}','${j.lease_id}',${j.attempt},'${outcome}',${code?`'${code}'`:'null'},${retry??'null'})`);
 async function output(j) {
  await query(`insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('derived-media','${j.output_path}','derived-version','{"size":100,"eTag":"derived-etag"}',jsonb_build_object('processing_job_id','${j.job_id}','processing_lease_id','${j.lease_id}','source_id','${object}','source_version','source-v1'))`);
 }
 async function seed(n=0,bytes=100) {
  const f=n?owner+`/source${n}.mp4`:file,e=n?id(n+20):entity,o=n?id(n+40):object;
  await query(`insert into auth.users(id) values('${owner}') on conflict do nothing;insert into storage.objects(id,bucket_id,name,version,owner_id,metadata) values('${o}','story-media','${f}','source-v1','${owner}',jsonb_build_object('size',${bytes},'eTag','source-etag'));
   insert into stories(id,user_id,media_url) values('${e}','${owner}','https://fixture.test/storage/v1/object/public/story-media/${f}');
   insert into content_media_bindings(entity_kind,entity_id,bucket_id,object_path,uploader_id) values('story','${e}','story-media','${f}','${owner}');`);
 }
 before(async()=>{
  if(!/^pc_scale_media_jobs(?:_v\d+)?$/.test(process.env.PGDATABASE||'')) throw new Error('A dedicated pc_scale_media_jobs fixture database is required.');
  db=new LocalPsqlSession();await query("set client_min_messages='warning';drop schema if exists media_processing,media_delivery,storage,auth,extensions,public cascade;create schema public");
  await query(fs.readFileSync(path.join(__dirname,'media-processing-fixture.sql'),'utf8'));await query(fs.readFileSync(path.join(__dirname,'../migrations/20261102071532_durable_media_processing_v1.sql'),'utf8'));
 });
 after(async()=>await db?.close());
 beforeEach(async()=>{
  await query("reset role; set request.jwt.claims='{\"role\":\"service_role\"}'; truncate media_processing.variants,media_processing.attempts,media_processing.jobs,media_processing.invalidations,storage.objects,stories,posts,post_media,auth.users,content_media_bindings,media_delivery.tickets; delete from media_processing.settings; insert into media_processing.settings(singleton) values(true)");
 });
 test('migration is inert by default and private state has no application privileges',async()=>{
  await seed(); assert.equal(await val('select count(*) from media_processing.jobs'),0);assert.deepEqual(await claim(),[]);
  for(const role of ['anon','authenticated','service_role']) {
   await query('set role '+role); assert.equal(await val("select fixture_fails('select * from media_processing.jobs')"),'t');
   if(role!=='service_role') assert.equal(await val("select fixture_fails('select claim_media_processing_v1(''inline'',1)')"),'t');
   await query('reset role');
  }
 });
 test('only canonical owned published versions enqueue and retries share job identity',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true');await seed();
  assert.equal(await val('select count(*) from media_processing.jobs'),1);
  const request=`select enqueue_media_processing_v1('story-media','${file}','${object}','source-v1')`;
  const a=await val(request),b=await val(request);assert.equal(a.job_id,b.job_id);
  assert.equal((await val(request.replace('source-v1','stale'))).state,'ineligible');
  await query(`update stories set media_url='https://other.invalid/unbound.mp4' where id='${entity}'`);
  assert.deepEqual(await claim(),[]); assert.equal(await val('select state from media_processing.jobs'),'cancelled');
 });
 test('large inputs remain queued for external compute without inline admission',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true');await seed(0,16777217);
  assert.equal(await val('select lane from media_processing.jobs'),'external'); assert.deepEqual(await claim(),[]);
  assert.deepEqual(await val("select claim_media_processing_v1('external',4)"),[]);
  await query('update media_processing.settings set external_enabled=true');const j=await val("select claim_media_processing_v1('external',4)");assert.equal(j.length,1);
 });
 test('global leased concurrency is enforced across real simultaneous connections',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true');await seed();await seed(1);
  const other=new LocalPsqlSession();await other.query("set request.jwt.claims='{\"role\":\"service_role\"}'");
  try {
   await query('begin'); const first=await claim();assert.equal(first.length,1);
   let settled=false;const second=other.query("select claim_media_processing_v1('inline',1)").then(x=>{settled=true;return JSON.parse(x);});
   await new Promise(r=>setTimeout(r,35));assert.equal(settled,false);await query('commit');assert.deepEqual(await second,[]);
   assert.equal(await val("select count(*) from media_processing.jobs where state='processing'"),1);
  } finally {await other.close();}
 });
 test('expired leases retry under a new immutable path and stale acknowledgements cannot publish',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true');await seed();const [first]=await claim();
  await query("update media_processing.jobs set lease_until=clock_timestamp()-interval '1 second'");const [second]=await claim();
  assert.equal(first.job_id,second.job_id);assert.notEqual(first.output_path,second.output_path);assert.equal(second.attempt,2);assert.equal(await finish(first),'f');
  assert.equal(await val(`select fixture_fails($q$insert into storage.objects(bucket_id,name,version) values('derived-media','${first.output_path}','late')$q$)`),'t');
 });
 test('completion preserves original bytes identity, seals output, and cleanup cannot recreate a deleted derived path',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true,maintenance_enabled=true');await seed();const[j]=await claim();await output(j);assert.equal(await finish(j),'t');
  assert.equal(await val(`select version from storage.objects where id='${object}'`),'source-v1');
  assert.equal(await val(`select fixture_fails($q$update storage.objects set version='overwrite' where name='${j.output_path}'$q$)`),'t');
  await query(`delete from storage.objects where id='${object}'`);assert.equal(await val('select active from media_processing.variants'),'f');
  const cleanup=await val('select claim_media_cleanup_v1(10)');assert.equal(cleanup.length,1);
  await query(`delete from storage.objects where name='${j.output_path}'`);
  assert.equal(await val(`select finish_media_cleanup_v1('${cleanup[0].lease_id}','${cleanup[0].cleanup_lease}')`),'t');
  assert.equal(await val(`select fixture_fails($q$insert into storage.objects(bucket_id,name,version) values('derived-media','${j.output_path}','recreate')$q$)`),'t');
 });
 test('source replacement/deletion and removed bindings cannot publish a completed in-flight upload',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true');await seed();const[j]=await claim();await output(j);
  await query(`delete from content_media_bindings where entity_id='${entity}'`);assert.equal(await finish(j),'f');assert.equal(await val('select state from media_processing.jobs'),'cancelled');
  assert.equal(await val('select cleanup_pending from media_processing.attempts'),'t');
 });
 test('entity deletion enqueues bounded cleanup while access proof denies the variant immediately',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true,maintenance_enabled=true');await seed();const[j]=await claim();await output(j);await finish(j);
  await query(`delete from stories where id='${entity}'`);assert.equal(await val('select count(*) from media_processing.invalidations'),1);
  assert.equal(await val('select reconcile_media_processing_v1(1)'),1);assert.equal(await val('select state from media_processing.jobs'),'cancelled');
  assert.equal(await val('select reconcile_media_processing_v1(1)'),0);assert.equal(await val('select count(*) from media_processing.invalidations'),0);
 });
 test('Retry-After persists a project lane pause and exhausted jobs enter a durable failed state',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true');await seed();const[j]=await claim();assert.equal(await finish(j,'retry','upstream_throttled',600),'t');
  assert.equal(await val("select inline_backoff_until>clock_timestamp()+interval '590 seconds' from media_processing.settings"),'t');assert.deepEqual(await claim(),[]);
  await query("update media_processing.settings set inline_backoff_until=null;update media_processing.jobs set attempts=5,available_at=clock_timestamp()-interval '1 second'");assert.deepEqual(await claim(),[]);
  assert.equal(await val('select state from media_processing.jobs'),'failed');
 });
 test('actual persisted ticket times pin representation through publication, normal rollback and emergency revocation',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true,delivery_enabled=true');await seed();const[j]=await claim();
  const makeTicket=async(token,created)=>query(`insert into media_delivery.tickets values(extensions.digest('${token.repeat(64)}','sha256'),'${object}','source-v1','story-media','${file}',${created},clock_timestamp()+interval '7 minutes')`);
  const resolve=token=>val(`select resolve_media_variant_for_ticket_v1('${token.repeat(64)}','story-media','${file}','source-v1')`);
  await makeTicket('a','clock_timestamp()');await output(j);await finish(j);assert.equal(await resolve('a'),null);
  await makeTicket('b','clock_timestamp()');assert.equal((await resolve('b')).path,j.output_path);
  // TTL is deliberately seven minutes: selection still uses actual created_at.
  await query('update media_processing.settings set delivery_enabled=false');await makeTicket('c','clock_timestamp()');
  assert.equal((await resolve('b')).path,j.output_path);assert.equal(await resolve('c'),null);
  assert.equal(await val("select fixture_fails('update media_processing.settings set delivery_enabled=true')"),'t');
  await query('update media_processing.settings set emergency_revoke=true');assert.deepEqual(await resolve('b'),{unavailable:true});
 });
 test('the private derivative bucket defeats broad legacy client policies while source visibility is unchanged',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true');await seed();const[j]=await claim();await output(j);await finish(j);
  assert.equal(await val("select public from storage.buckets where id='story-media'"),'t');assert.equal(await val("select public from storage.buckets where id='derived-media'"),'f');
  for(const role of ['anon','authenticated']) {
   await query('set role '+role);
   assert.equal(await val("select count(*) from storage.objects where bucket_id='derived-media'"),0);
   assert.equal(await val("select count(*) from storage.buckets where id='derived-media'"),0);
   assert.equal(await val("select count(*) from storage.objects where bucket_id='story-media'"),1);
   assert.equal(await val("select fixture_fails($q$insert into storage.objects(bucket_id,name,version) values('derived-media','unregistered','x')$q$)"),'t');
   await query('reset role');
  }
 });
 test('owner erasure revokes the derivative immediately and creates bounded durable cleanup',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true,maintenance_enabled=true');await seed();const[j]=await claim();await output(j);await finish(j);
  await query(`update auth.users set deleted_at=clock_timestamp() where id='${owner}'`);
  assert.equal(await val(`select media_processing.source_snapshot('${object}','source-v1')`),null);
  assert.equal(await val("select count(*) from media_processing.invalidations where entity_kind='owner'"),1);
  assert.equal(await val('select reconcile_media_processing_v1(1)'),1);
  assert.equal((await val('select claim_media_cleanup_v1(10)')).length,1);
 });
 test('microsecond boundaries choose one representation without relying on a rounded JS clock',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true,delivery_enabled=true');await seed();const[j]=await claim();await output(j);await finish(j);
  const at=await val("select resolve_media_variant_v1('story-media','"+file+"','source-v1',(select created_at from media_processing.variants))");assert.equal(at.path,j.output_path);
  const before=await val("select resolve_media_variant_v1('story-media','"+file+"','source-v1',(select created_at-interval '1 microsecond' from media_processing.variants))");assert.equal(before,null);
  await query('update media_processing.settings set delivery_enabled=false');
  const stopped=await val("select resolve_media_variant_v1('story-media','"+file+"','source-v1',(select delivery_stopped_at from media_processing.settings))");assert.equal(stopped,null);
 });
 test('source cancellation and derived deletion acquire attempt/variant locks in a consistent order',{timeout:5000},async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true');await seed();const[j]=await claim();await output(j);await finish(j);
  const other=new LocalPsqlSession();await other.query("set request.jwt.claims='{\"role\":\"service_role\"}';begin");
  try{
   await other.query(`select 1 from media_processing.attempts where lease_id='${j.lease_id}' for update`);
   let settled=false;const cancellation=query(`delete from storage.objects where id='${object}'`).then(x=>{settled=true;return x;});
   await new Promise(r=>setTimeout(r,30));assert.equal(settled,false);
   await other.query(`delete from storage.objects where name='${j.output_path}'`);
   await other.query('commit');await cancellation;
   assert.equal(await val('select state from media_processing.jobs'),'cancelled');
   assert.equal(await val('select active from media_processing.variants'),'f');
  }finally{await other.close();}
 });
 test('invalidation drainer skips a writer-held job without advancing or dropping the final marker',{timeout:5000},async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true,maintenance_enabled=true');await seed();const[j]=await claim();await output(j);await finish(j);
  await query(`insert into media_processing.invalidations(entity_kind,entity_id) values('story','${entity}')`);
  const other=new LocalPsqlSession();await other.query("set request.jwt.claims='{\"role\":\"service_role\"}';begin");
  let pending;
  try{
   await other.query(`select 1 from media_processing.jobs where id='${j.job_id}' for update`);
   let settled=false;pending=query('select reconcile_media_processing_v1(100)').then(x=>{settled=true;return x;});
   await new Promise(r=>setTimeout(r,35));assert.equal(settled,true);assert.equal(await pending,'0');
   assert.equal(await val('select count(*) from media_processing.invalidations where cursor is null'),1);
   await other.query(`update stories set media_url='https://fixture.test/removed.mp4' where id='${entity}'`);
   await other.query('commit');assert.equal(await val('select reconcile_media_processing_v1(100)'),1);
   assert.equal(await val('select state from media_processing.jobs'),'cancelled');
   assert.equal(await val('select reconcile_media_processing_v1(100)'),0);
   assert.equal(await val('select count(*) from media_processing.invalidations'),0);
  }finally{await other.close();if(pending)await pending;}
 });
 test('cleanup candidate index excludes a large history of successfully published outputs',async()=>{
  await query(`insert into media_processing.jobs(id,source_id,source_version,source_bucket,source_path,source_owner,source_bytes,source_etag,source_mime,lane,state)
   select gen_random_uuid(),gen_random_uuid(),'v','story-media','history/'||n,'${owner}',100,'e','video/mp4','inline','ready' from generate_series(1,5000)n;
   insert into media_processing.attempts(lease_id,job_id,attempt,bucket,path,expires_at,closed_at)
   select gen_random_uuid(),id,1,'derived-media',id::text,clock_timestamp()-interval '1 day',clock_timestamp() from media_processing.jobs;
   update media_processing.attempts set cleanup_pending=true where lease_id=(select lease_id from media_processing.attempts limit 1);
   analyze media_processing.attempts;`);
  const plan=await val(`explain(analyze,buffers,format json) select * from media_processing.attempts where not cleanup_done and cleanup_attempts<10
   and (cleanup_pending or closed_at is null) and (cleanup_pending or (closed_at is null and expires_at<=clock_timestamp()))
   and (cleanup_until is null or cleanup_until<=clock_timestamp()) order by expires_at,lease_id limit 10 for update skip locked`);
  const text=JSON.stringify(plan);assert.match(text,/media_attempts_cleanup_idx/);
  const nodes=[];function visit(node){nodes.push(node);for(const child of node.Plans||[])visit(child);}visit(plan[0].Plan);
  const scan=nodes.find(x=>x['Index Name']==='media_attempts_cleanup_idx');assert.ok(scan);assert.equal(scan['Actual Rows'],1);assert.equal(scan['Rows Removed by Filter']||0,0);
 });
 test('malformed size metadata is rejected safely and never creates an allocation proof',async()=>{
  await query('update media_processing.settings set admission_enabled=true,inline_enabled=true');await seed();
  await query(`update storage.objects set metadata='{"size":"not-a-number","eTag":"etag"}' where id='${object}'`);
  assert.equal(await val(`select media_processing.source_snapshot('${object}','source-v1')`),null);
 });
}
