const {test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {LocalPsqlSession}=require('./local-psql-session.cjs');
if(!process.env.PC_TEST_PSQL)test('adaptive media requires isolated PostgreSQL',{skip:true},()=>{});
else{
 const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),entity=id(2),object=id(3),file=owner+'/source.mp4';let db;
 const q=sql=>db.query(sql),v=async sql=>{const r=await q(sql);try{return JSON.parse(r);}catch{return r;}};
 const claim=()=>v('select claim_media_rendition_v2()');
 const finish=(j,outcome='ready')=>v(`select finish_media_rendition_v2('${j.job_id}','${j.lease_id}',${j.attempt},'${outcome}','{"width":640,"height":360,"duration":8}')`);
 const assets=[{name:'master.m3u8',mime:'application/vnd.apple.mpegurl',playlist:'#EXTM3U\nr0/index.m3u8\n'},{name:'r0/index.m3u8',mime:'application/vnd.apple.mpegurl',playlist:'#EXTM3U\nseg00000.ts\n#EXT-X-ENDLIST\n'},{name:'r0/seg00000.ts',mime:'video/mp2t'},{name:'fallback.mp4',mime:'video/mp4'}].map(a=>({...a,bytes:100,sha256:'a'.repeat(64)}));
 async function seed(n=0){const f=n?owner+`/source${n}.mp4`:file,e=n?id(20+n):entity,o=n?id(40+n):object;await q(`insert into auth.users(id) values('${owner}') on conflict do nothing;insert into storage.objects(id,bucket_id,name,version,owner_id,metadata) values('${o}','story-media','${f}','source-v1','${owner}','{"size":1000,"eTag":"source-etag"}');insert into stories(id,user_id,media_url) values('${e}','${owner}','https://fixture.test/storage/v1/object/public/story-media/${f}');insert into content_media_bindings(entity_kind,entity_id,bucket_id,object_path,uploader_id) values('story','${e}','story-media','${f}','${owner}')`);}
 async function outputs(j){assert.equal(await v(`select register_media_rendition_assets_v2('${j.job_id}','${j.lease_id}',${j.attempt},$a$${JSON.stringify(assets)}$a$)`),'t');for(const a of assets)await q(`insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('adaptive-media','${j.output_prefix+a.name}','out-v1','{"size":100,"eTag":"output-etag"}','{"processing_lease_id":"${j.lease_id}","sha256":"${a.sha256}"}')`);}
 before(async()=>{if(process.env.PGDATABASE!=='pc_scale_media_v2')throw new Error('Dedicated pc_scale_media_v2 database required');db=new LocalPsqlSession();await q("set client_min_messages='warning';drop schema if exists media_renditions,media_processing,media_delivery,storage,auth,extensions,public cascade;create schema public");await q(fs.readFileSync(path.join(__dirname,'media-processing-fixture.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261102071532_durable_media_processing_v1.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261102090521_adaptive_media_renditions_v2.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261102100428_media_broker_scoped_credentials_v2.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261102101149_media_worker_dispatch_v2.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261105044918_adaptive_media_admission_backfill_v2.sql'),'utf8'));});
 after(async()=>db?.close());
 beforeEach(async()=>{await q("reset role;set request.jwt.claims='{\"role\":\"service_role\"}';truncate media_renditions.broker_nonces,media_renditions.broker_rates,media_renditions.broker_keys,media_renditions.publications,media_renditions.assets,media_renditions.attempts,media_renditions.jobs,media_processing.variants,media_processing.attempts,media_processing.jobs,media_processing.invalidations,storage.objects,stories,posts,post_media,auth.users,content_media_bindings,media_delivery.tickets;delete from media_renditions.settings;insert into media_renditions.settings(singleton) values(true)");});
 test('migration is inert and private tables/bucket remain unavailable to ordinary users',async()=>{await seed();assert.equal(await v('select count(*) from media_renditions.jobs'),0);assert.equal(await claim(),'');for(const role of ['anon','authenticated']){await q('set role '+role);assert.equal(await v("select fixture_fails('select * from media_renditions.jobs')"),'t');assert.equal(await v("select fixture_fails('select claim_media_rendition_v2()')"),'t');assert.equal(await v("select count(*) from storage.buckets where id='adaptive-media'"),0);await q('reset role');}});
 test('canonical admission is idempotent and global leased concurrency holds across connections',async()=>{await q('update media_renditions.settings set admission_enabled=true,worker_enabled=true,concurrency=1');await seed();await seed(1);const a=await v(`select enqueue_media_rendition_v2('${object}','source-v1')`),b=await v(`select enqueue_media_rendition_v2('${object}','source-v1')`);assert.equal(a.job_id,b.job_id);const other=new LocalPsqlSession();await other.query("set request.jwt.claims='{\"role\":\"service_role\"}'");try{await q('begin');assert.ok((await claim()).lease_id);let done=false;const second=other.query('select claim_media_rendition_v2()').then(x=>{done=true;return x;});await new Promise(r=>setTimeout(r,40));assert.equal(done,false);await q('commit');assert.equal(await second,'');}finally{await other.close();}});
 test('real Storage records must match every registered asset before atomic publication',async()=>{await q('update media_renditions.settings set admission_enabled=true,worker_enabled=true');await seed();const j=await claim();await outputs(j);assert.equal(await finish(j),'t');assert.equal(await v('select asset_count from media_renditions.publications'),4);assert.equal(await v(`select version from storage.objects where id='${object}'`),'source-v1');assert.equal(await v(`select fixture_fails($q$update storage.objects set version='overwrite' where name='${j.output_prefix}fallback.mp4'$q$)`),'t');});
 test('expired leases use new paths, fence late workers, and retain recoverable retry state',async()=>{await q('update media_renditions.settings set admission_enabled=true,worker_enabled=true');await seed();const first=await claim();await outputs(first);await q("update media_renditions.jobs set lease_until=clock_timestamp()-interval '1 second'");const second=await claim();assert.notEqual(first.output_prefix,second.output_prefix);assert.equal(second.attempt,2);assert.equal(await finish(first),'f');assert.equal(await v(`select fixture_fails($q$update storage.objects set metadata='{"size":100}' where name='${first.output_prefix}fallback.mp4'$q$)`),'t');});
 test('source replacement or removed binding cannot publish an in-flight rendition',async()=>{await q('update media_renditions.settings set admission_enabled=true,worker_enabled=true');await seed();const j=await claim();await outputs(j);await q(`delete from content_media_bindings where entity_id='${entity}'`);assert.equal(await finish(j),'f');assert.equal(await v('select state from media_renditions.jobs'),'cancelled');assert.equal(await v('select cleanup_pending from media_renditions.attempts'),'t');});
 test('tickets pin an existing publication and cross-source, stale-version, disabled and revoked reads fail',async()=>{await q('update media_renditions.settings set admission_enabled=true,worker_enabled=true,delivery_enabled=true');await seed();const j=await claim();await outputs(j);await finish(j);const token='b'.repeat(64);await q(`insert into media_delivery.tickets values(extensions.digest('${token}','sha256'),'${object}','source-v1','story-media','${file}',clock_timestamp(),clock_timestamp()+interval '5 minutes')`);const request=`select resolve_media_rendition_v2('${token}','story-media','${file}','source-v1')`;assert.equal((await v(request)).leaseId,j.lease_id);assert.equal(await v(request.replace('source-v1','stale')),'');await q(`update media_delivery.tickets set created_at=clock_timestamp()-interval '1 hour'`);assert.equal(await v(request),'');await q('update media_delivery.tickets set created_at=clock_timestamp()');await q('update media_renditions.settings set delivery_enabled=false');assert.equal(await v(request),'');});
 test('sealed cleanup removes only declared attempt assets and prevents resurrection',async()=>{await q('update media_renditions.settings set admission_enabled=true,worker_enabled=true,maintenance_enabled=true');await seed();const j=await claim();await outputs(j);await finish(j,'retry');const a=(await v('select claim_media_rendition_cleanup_v2(1)'))[0];assert.equal(a.names.length,4);assert.equal(await v(`select finish_media_rendition_cleanup_v2('${a.lease_id}','${a.cleanup_lease}')`),'f');await q(`delete from storage.objects where bucket_id='adaptive-media'`);assert.equal(await v(`select finish_media_rendition_cleanup_v2('${a.lease_id}','${a.cleanup_lease}')`),'t');assert.equal(await v(`select fixture_fails($q$insert into storage.objects(bucket_id,name,version) values('adaptive-media','${a.prefix}fallback.mp4','late')$q$)`),'t');assert.equal(await v(`select count(*) from storage.objects where id='${object}'`),1);});
 test('scoped broker hashes, replay windows, revocation, roles and rate shards enforce server-only authority',async()=>{
  const key=id(81),nonce=id(82),token='b'.repeat(64);await q(`insert into media_renditions.broker_keys(id,role,token_hash,max_requests_per_minute) values('${key}','worker',extensions.digest('${token}','sha256'),64)`);
  const authenticate=(request=nonce,hash=`encode(extensions.digest('${token}','sha256'),'hex')`,at='clock_timestamp()')=>v(`select authorize_media_broker_v2('${key}',${hash},'${request}',${at})`);
  assert.equal(await authenticate(nonce,"repeat('0',64)"),'');assert.equal(await authenticate(nonce,undefined,"clock_timestamp()-interval '61 seconds'"),'');
  assert.equal(await authenticate(),'worker');assert.equal(await authenticate(),'rate_limited');
  await q('delete from media_renditions.broker_rates');assert.equal(await authenticate(),'');
  await q(`update media_renditions.broker_keys set enabled=false where id='${key}'`);assert.equal(await authenticate(id(83)),'');
  await q(`update media_renditions.broker_keys set enabled=true,role='gateway',expires_at=clock_timestamp()-interval '1 second'`);assert.equal(await authenticate(id(84)),'');
  for(const role of ['anon','authenticated']){await q('set role '+role);assert.equal(await v("select fixture_fails('select * from media_renditions.broker_keys')"),'t');assert.equal(await v(`select has_function_privilege('${role}','public.authorize_media_broker_v2(uuid,text,uuid,timestamp with time zone)','EXECUTE')`),'f');await q('reset role');}
 });
 test('broker transfer descriptors fence revoked jobs and cleanup cannot escape its exact asset set',async()=>{
  await q('update media_renditions.settings set admission_enabled=true,worker_enabled=true,maintenance_enabled=true');await seed();const j=await claim();await outputs(j);
  const transfer=`select media_rendition_transfer_v2('${j.job_id}','${j.lease_id}',${j.attempt}`;
  assert.equal((await v(transfer+')')).path,file);assert.equal((await v(transfer+",'fallback.mp4')")).path,j.output_prefix+'fallback.mp4');assert.equal(await v(transfer+",'other.mp4')"),'');
  await finish(j,'retry');assert.equal(await v(transfer+')'),'');const a=(await v('select claim_media_rendition_cleanup_v2(1)'))[0];
  assert.deepEqual((await v(`select media_rendition_cleanup_transfer_v2('${a.lease_id}','${a.cleanup_lease}','["fallback.mp4"]')`)).prefixes,[a.prefix+'fallback.mp4']);
  assert.equal(await v(`select media_rendition_cleanup_transfer_v2('${a.lease_id}','${a.cleanup_lease}','["../../original.mp4"]')`),'');
 });
 test('protected aggregate status supports the postgres sampler without a request JWT',async()=>{
  await q("set request.jwt.claims='{}'");assert.equal((await v('select media_processing_status_v1()')).profile,'hls-v2');
  for(const role of ['anon','authenticated'])assert.equal(await v(`select has_function_privilege('${role}','public.media_processing_status_v1()','EXECUTE')`),'f');
 });

 test('external worker dispatch remains inert before explicit protected configuration',async()=>{assert.equal(await v('select dispatch_media_worker_v2()'),'');assert.equal((await v('select media_worker_dispatch_status_v2()')).enabled,false);for(const role of ['anon','authenticated'])assert.equal(await v(`select has_function_privilege('${role}','public.dispatch_media_worker_v2()','EXECUTE')`),'f');});

 test('upload completion after its canonical binding still admits exactly one immutable job',async()=>{
  await q('update media_renditions.settings set admission_enabled=true');
  await q(`insert into auth.users(id) values('${owner}');insert into stories(id,user_id,media_url) values('${entity}','${owner}','https://fixture.test/storage/v1/object/public/story-media/${file}');insert into content_media_bindings(entity_kind,entity_id,bucket_id,object_path,uploader_id) values('story','${entity}','story-media','${file}','${owner}')`);
  assert.equal(await v('select count(*) from media_renditions.jobs'),0);
  await q(`insert into storage.objects(id,bucket_id,name,version,owner_id,metadata) values('${object}','story-media','${file}','source-v1','${owner}','{"size":1000,"eTag":"source-etag"}')`);
  assert.equal(await v('select count(*) from media_renditions.jobs'),1);
  await q(`update content_media_bindings set object_path=object_path where entity_id='${entity}'`);
  assert.equal(await v('select count(*) from media_renditions.jobs'),1);
 });
 test('legacy backfill is a preview by default, gated, bounded and idempotent',async()=>{
  await seed();await seed(1);await seed(2);
  const preview=await v('select backfill_media_renditions_v2(null,2)');
  assert.equal(preview.state,'preview');assert.equal(preview.scanned,2);assert.equal(preview.eligible,2);assert.equal(preview.hasMore,true);
  assert.equal(await v('select count(*) from media_renditions.jobs'),0);
  assert.equal((await v('select backfill_media_renditions_v2(null,2,false)')).state,'disabled');
  await q('update media_renditions.settings set admission_enabled=true');
  const first=await v('select backfill_media_renditions_v2(null,2,false)');assert.equal(first.admitted,2);
  const last=await v(`select backfill_media_renditions_v2('${first.nextAfterId}',2,false)`);assert.equal(last.scanned,1);assert.equal(last.admitted,1);assert.equal(last.hasMore,false);
  assert.equal((await v('select backfill_media_renditions_v2(null,100,false)')).admitted,0);
  assert.equal(await v('select count(*) from media_renditions.jobs'),3);
 });
 test('backfill excludes unbound, removed, wrong-owner and nonvideo media',async()=>{
  await seed();await q(`delete from content_media_bindings where entity_id='${entity}'`);
  await seed(1);await q(`update storage.objects set owner_id='${id(999)}' where id='${id(41)}'`);
  await seed(2);await q(`update storage.objects set name='${owner}/image.jpg' where id='${id(42)}'`);
  await q('update media_renditions.settings set admission_enabled=true');
  const result=await v('select backfill_media_renditions_v2(null,100,false)');assert.equal(result.scanned,3);assert.equal(result.eligible,0);assert.equal(result.admitted,0);
 });
 test('backfill rejects excess work and is unavailable to ordinary callers',async()=>{
  for(const input of ['null,101,false','null,0,false','null,1,null'])assert.equal(await v(`select fixture_fails('select backfill_media_renditions_v2(${input})')`),'t');
  for(const role of ['anon','authenticated'])assert.equal(await v(`select has_function_privilege('${role}','public.backfill_media_renditions_v2(uuid,integer,boolean)','EXECUTE')`),'f');
 });

}
