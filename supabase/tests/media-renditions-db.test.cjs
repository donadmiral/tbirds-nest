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
 before(async()=>{if(process.env.PGDATABASE!=='pc_scale_media_v2')throw new Error('Dedicated pc_scale_media_v2 database required');db=new LocalPsqlSession();await q("set client_min_messages='warning';drop schema if exists media_renditions,media_processing,media_delivery,live_streams,storage,auth,extensions,public cascade;create schema public");await q(fs.readFileSync(path.join(__dirname,'media-processing-fixture.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261102071532_durable_media_processing_v1.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261102090521_adaptive_media_renditions_v2.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261102100428_media_broker_scoped_credentials_v2.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261102101149_media_worker_dispatch_v2.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261105044918_adaptive_media_admission_backfill_v2.sql'),'utf8'));await q(`create function public.resolve_media_delivery(p_token text,p_bucket text,p_path text) returns jsonb language sql as $$ select jsonb_build_object('version',t.object_version) from media_delivery.tickets t where t.token_digest=extensions.digest(p_token,'sha256') and t.bucket_id=p_bucket and t.object_path=p_path and t.expires_at>clock_timestamp() and coalesce(current_setting('fixture.deny_delivery',true),'')<>'true' $$`);await q(fs.readFileSync(path.join(__dirname,'../migrations/20261105152331_adaptive_media_batch_readiness.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'published-clip-renditions-fixture.sql'),'utf8'));await q(fs.readFileSync(path.join(__dirname,'../migrations/20261105153608_published_live_clip_renditions.sql'),'utf8'));});
 after(async()=>db?.close());
 beforeEach(async()=>{await q("reset role;set fixture.deny_delivery='false';set request.jwt.claims='{\"role\":\"service_role\"}';truncate live_streams.clip_publications,live_streams.clip_jobs,live_streams.clips,live_streams.sessions,channel_messages,media_renditions.broker_nonces,media_renditions.broker_rates,media_renditions.broker_keys,media_renditions.publications,media_renditions.assets,media_renditions.attempts,media_renditions.jobs,media_processing.variants,media_processing.attempts,media_processing.jobs,media_processing.invalidations,storage.objects,stories,posts,post_media,auth.users,content_media_bindings,media_delivery.tickets;delete from media_renditions.settings;insert into media_renditions.settings(singleton) values(true)");});
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

 test('batch readiness returns version-pinned HLS only after current delivery authorizes it',async()=>{
  await q("update media_renditions.settings set admission_enabled=true,worker_enabled=true,delivery_enabled=true,gateway_origin='https://media.fixture.test'");
  await seed();const j=await claim();await outputs(j);await finish(j);const token='d'.repeat(64);
  await q(`insert into media_delivery.tickets values(extensions.digest('${token}','sha256'),'${object}','source-v1','story-media','${file}',clock_timestamp(),clock_timestamp()+interval '5 minutes')`);
  const request=`select media_playback_readiness_v2('[{"token":"${token}","bucket":"story-media","path":"${file}"}]')`;
  let result=await v(request);assert.equal(result.origin,'https://media.fixture.test');assert.deepEqual(result.items,[{token,version:'source-v1',hls:true}]);
  // The fixture resolver models current audience denial; the separately tested
  // real resolve_media_delivery implementation owns session/deletion checks.
  await q("set fixture.deny_delivery='true'");result=await v(request);assert.equal(result.items[0].hls,false);
  await q("set fixture.deny_delivery='false';update media_delivery.tickets set created_at=clock_timestamp()-interval '1 hour'");assert.equal((await v(request)).items[0].hls,false);
  await q("update media_renditions.settings set delivery_enabled=false");result=await v(request);assert.equal(result.origin,null);assert.equal(result.items[0].version,'source-v1');assert.equal(result.items[0].hls,false);
  await q(`update storage.objects set version='replacement' where id='${object}'`);assert.equal((await v(request)).items.length,0);
 });
 test('batch readiness rejects excess work, forged tickets and ordinary callers',async()=>{
  assert.equal((await v(`select media_playback_readiness_v2('[{"token":"${'f'.repeat(64)}","bucket":"story-media","path":"${file}"}]')`)).items.length,0);
  for(const role of ['anon','authenticated'])assert.equal(await v(`select has_function_privilege('${role}','public.media_playback_readiness_v2(jsonb)','EXECUTE')`),'f');
  for(const value of [null,{},Array.from({length:129},()=>({}))])assert.equal(await v(`select fixture_fails($q$select media_playback_readiness_v2('${JSON.stringify(value)}')$q$)`),'t');
 });

 const clipCreator=id(91),clipSession=id(92),clipId=id(93),clipLease=id(94),clipJob=id(95),clipPub=id(96),clipObject=id(97),clipPost=id(98);
 const clipPrefix=`${owner}/${clipSession}/${clipId}/${clipLease}/`,clipPath=clipPrefix+'horizontal.mp4';
 async function seedClip(){
  // The real clip_publish_one RPC inserts the publication and its destination
  // in one transaction. psql otherwise autocommits each fixture statement and
  // would run deferred admission before the post exists.
  await q(`begin;insert into auth.users(id) values('${owner}'),('${clipCreator}');
   insert into live_streams.sessions values('${clipSession}','${owner}','public',true);
   insert into live_streams.clips values('${clipId}','${clipSession}','${owner}','${clipCreator}','${clipLease}','${clipPrefix}',
    'ready','approved','cleared',1,'["horizontal"]','{"assets":[{"name":"horizontal.mp4","bytes":1000,"sha256":"${'a'.repeat(64)}","content_type":"video/mp4"}]}');
   insert into live_streams.clip_jobs values('${clipJob}','${clipId}',1,'done','${clipLease}');
   insert into storage.objects(id,bucket_id,name,version,owner_id,metadata,user_metadata)
    values('${clipObject}','live-clips','${clipPath}','clip-v1','${clipCreator}','{"size":1000,"mimetype":"video/mp4","eTag":"clip-etag"}',
     '{"live_clip_id":"${clipId}","live_clip_job_id":"${clipJob}","live_clip_lease_id":"${clipLease}","sha256":"${'a'.repeat(64)}"}');
   insert into live_streams.clip_publications values('${clipPub}','${clipId}','${owner}','feed','${clipPost}',null,'horizontal','published');
   insert into posts(id,user_id,media_url) values('${clipPost}','${owner}','https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/live-clips/${clipPath}');commit;`);
 }
 const clipSnapshot=()=>v(`select media_renditions.source_snapshot('${clipObject}','clip-v1')`);
 test('published clip admission observes the completed destination and preserves creator versus session-owner provenance',async()=>{
  await q('update media_renditions.settings set admission_enabled=true,worker_enabled=true');await seedClip();
  const snapshot=await clipSnapshot();assert.equal(snapshot.owner,clipCreator);assert.equal(snapshot.path,clipPath);
  assert.equal(await v('select count(*) from media_renditions.jobs'),1);assert.equal(await v('select count(*) from media_processing.jobs'),0);
  assert.equal(await v(`select media_processing.source_snapshot('${clipObject}','clip-v1')`),'','The v1 admission contract stays unchanged');
  const j=await claim();assert.equal(j.source_owner,clipCreator);assert.equal(j.source_bucket,'live-clips');assert.equal(j.source_path,clipPath);
 });
 test('clip source snapshots reject dangling publications, wrong authors, retired leases, forged metadata and private source streams',async()=>{
  await seedClip();assert.ok(await clipSnapshot());
  for(const mutation of [
   `delete from posts where id='${clipPost}'`,
   `update posts set user_id='${clipCreator}' where id='${clipPost}'`,
   `update posts set media_url='https://wrong-origin.test/storage/v1/object/public/live-clips/${clipPath}' where id='${clipPost}'`,
   "update live_streams.clip_publications set state='revoked'",
   "update live_streams.clips set state='processing'",
   "update live_streams.clips set copyright_state='blocked'",
   "update live_streams.clips set moderation_state='pending'",
   "update live_streams.clips set formats='[]'",
   `update live_streams.clips set current_lease='${id(990)}'`,
   "update live_streams.clip_jobs set revision=2",
   "update live_streams.sessions set audience='followers'",
   "update live_streams.sessions set can_create=false",
   `update auth.users set deleted_at=now() where id='${clipCreator}'`,
   `update storage.objects set owner_id='${owner}' where id='${clipObject}'`,
   `update storage.objects set user_metadata=jsonb_set(user_metadata,'{sha256}','"${'b'.repeat(64)}"') where id='${clipObject}'`,
   `update storage.objects set metadata=jsonb_set(metadata,'{size}','999') where id='${clipObject}'`,
  ]){await q('begin');try{await q(mutation);assert.equal(await clipSnapshot(),'',mutation);}finally{await q('rollback');}}
  assert.equal(await v(`select media_renditions.source_snapshot('${clipObject}','old-version')`),'');
 });
 test('clip revocation cancels and cleans the old lease while restoration uses a new lease without replenishing retries',async()=>{
  await q('update media_renditions.settings set admission_enabled=true,worker_enabled=true,delivery_enabled=true');await seedClip();
  const first=await claim();await outputs(first);await finish(first);
  await q("update live_streams.clip_publications set state='revoked'");
  assert.equal(await v('select state from media_renditions.jobs'),'cancelled');assert.equal(await v('select active from media_renditions.publications'),'f');
  assert.equal(await v('select cleanup_pending from media_renditions.attempts'),'t');
  await q("update live_streams.clip_publications set state='published'");
  assert.equal(await v('select state from media_renditions.jobs'),'pending');assert.equal(await v('select retry_budget from media_renditions.jobs'),4);
  const second=await claim();assert.notEqual(second.lease_id,first.lease_id);assert.equal(second.attempt,2);
  await outputs(second);assert.equal(await finish(second),'t');assert.equal(await v('select lease_id from media_renditions.publications'),second.lease_id);
 });
 test('clip backfill stays bounded and gates remain off until configured',async()=>{
  await seedClip();assert.equal(await v('select count(*) from media_renditions.jobs'),0);
  assert.equal((await v('select backfill_media_renditions_v2(null,100,true)')).eligible,1);
  assert.equal((await v('select backfill_media_renditions_v2(null,100,false)')).state,'disabled');
  await q('update media_renditions.settings set admission_enabled=true');assert.equal((await v('select backfill_media_renditions_v2(null,100,false)')).admitted,1);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await v(`select has_function_privilege('${role}','media_renditions.source_snapshot(uuid,text)','EXECUTE')`),'f');
 });
 test('provenance-only clip source changes cancel active renditions and schedule cleanup',async()=>{
  await q('update media_renditions.settings set admission_enabled=true,worker_enabled=true');await seedClip();
  const j=await claim();await outputs(j);await finish(j);
  await q(`update storage.objects set user_metadata=jsonb_set(user_metadata,'{live_clip_job_id}','"${id(999)}"') where id='${clipObject}'`);
  assert.equal(await v('select state from media_renditions.jobs'),'cancelled');assert.equal(await v('select active from media_renditions.publications'),'f');
  assert.equal(await v('select cleanup_pending from media_renditions.attempts'),'t');assert.equal(await clipSnapshot(),'');
 });

}
