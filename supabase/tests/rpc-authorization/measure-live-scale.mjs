// Isolated SQL cardinality benchmark. No host, credentials, network clients or real accounts.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';

const dir=await mkdtemp(join(tmpdir(),'platinum-room-scale-'));
const db=new PGlite(dir,{extensions});
const out={kind:'isolated SQL cardinality benchmark',engine:'PGlite 0.5.10, single connection',timings_ms:{},sql_sources:{},observations:{}};
const hash=s=>createHash('sha256').update(s).digest('hex');
const value=async(sql,args=[])=>(Object.values((await db.query(sql,args)).rows[0]??{})[0]);
const timed=async(name,work)=>{const start=performance.now();const result=await work();out.timings_ms[name]=Math.round(performance.now()-start);console.log(name+': '+out.timings_ms[name]+' ms');return result;};
const install=async(name)=>{const sql=await source('supabase/migrations/'+name+'.sql');out.sql_sources[name]=hash(sql);await db.exec(sql);};
try{
 await timed('load_release_schema',async()=>{
  await loadDeployedMediaBaseline(db);await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false');
  for(const file of ['20261103000609_live_portable_control_plane','20261103002858_live_interactivity','20261104022616_live_viewer_presence',
   '20261104052000_live_cancel_stage_cleanup','20261104054700_live_terminal_eject_acknowledgement',
   '20261104175749_live_guest_requests','20261104180010_live_portrait_broadcast','20261104180300_live_approved_guest_sources',
   '20261104180638_live_detail_orientation','20261106030500_live_viewer_counts_job'])await install(file);
 });
 out.postgres_version=await value('show server_version');
 await db.exec(`create temporary table fixture_people as select n,
  md5('local synthetic person/'||n)::uuid as uid,md5('local synthetic session/'||n)::uuid as sid,md5('local synthetic player/'||n)::uuid as pid,
  case when n<=100000 then 1 when n<=199900 then 2+(n-100001)/100 else n-199900 end as room from generate_series(1,200901) n;
  create unique index fixture_people_n on fixture_people(n);
  create temporary table fixture_rooms as select n,md5('local synthetic room/'||n)::uuid room,md5('local synthetic person/'||(n+199900))::uuid host from generate_series(1,1001) n;
  create unique index fixture_rooms_n on fixture_rooms(n);analyze fixture_rooms;analyze fixture_people;`);
 await timed('populate_synthetic_identities',async()=>{
 // Suppress signup/onboarding side effects only during fixture parent insertion.
 // No triggers are disabled for the measured Live tables, count, cleanup or RPC.
  await db.exec(`begin;set local session_replication_role=replica;
    insert into auth.users(id,email) select uid,'bench'||n||'@example.test' from fixture_people;
    insert into public.profiles(id,username,email,full_name,profile_visibility,account_type) select uid,'bench'||n,'bench'||n||'@example.test','Fixture','public','personal' from fixture_people;
    insert into auth.sessions(id,user_id,aal) select sid,uid,'aal1' from fixture_people;
    commit;`);
 });
 await db.exec(`insert into live_streams.sessions(id,host_id,state,title,topic) select room,host,case when n<1000 then 'live' else 'backstage' end,'Fixture','irl' from fixture_rooms;
  insert into live_streams.provider_sessions(session_id,room_name) select room,'synthetic-'||n from fixture_rooms where n>=1000;
  update live_streams.settings set max_active_broadcasts=1000,stage_enabled=true,delivery_enabled=true where singleton;
  analyze live_streams.sessions;`);
 async function reserve(n){
  const f=(await db.query('select r.room,r.host,p.sid from fixture_rooms r join fixture_people p on p.n=r.n+199900 where r.n=$1',[n])).rows[0];
  await db.exec('begin;set local role authenticated');
  try{
   await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)",[f.host,JSON.stringify({sub:f.host,role:'authenticated',session_id:f.sid,is_anonymous:false})]);
   const v=await value("select public.live_prepare_control($1,'start',gen_random_uuid())",[f.room]);await db.exec('commit');return v;
  }catch(e){await db.exec('rollback');throw e;}
 }
 await timed('admit_1000th',()=>reserve(1000));
 await timed('refuse_1001st',()=>assert.rejects(reserve(1001),/BROADCAST_CAPACITY_REACHED/));
 assert.equal(await value("select state from live_streams.sessions where id=(select room from fixture_rooms where n=1001)"),'backstage');
 await db.exec("update live_streams.sessions set state='live' where state='starting'"); // Simulated provider acknowledgement, no traffic.
 assert.equal(+await value("select count(*) from live_streams.sessions where state='live'"),1000);
 out.observations.admission={limit:1000,preexisting:999,accepted:1,overflow:'BROADCAST_CAPACITY_REACHED',overflow_state:'backstage',active_rooms:1000};
 // Seed live leases together *after* creating fixtures. Two extra rows for each
 // first 1024 viewers: a second tab and an expired tab. Add one host-preview row.
 await timed('populate_presence',()=>db.exec(`insert into live_streams.viewer_presence(session_id,user_id,auth_session_id,playback_id,last_seen_at,expires_at)
  select room,uid,sid,playback,observed,observed+interval '90 seconds'
  from (select r.room,p.uid,p.sid,case when v=0 then p.pid else md5('other-tab/'||p.n||'/'||v)::uuid end playback,
   case when v=2 then statement_timestamp()-interval '2 minutes' else statement_timestamp() end observed
   from fixture_people p join fixture_rooms r on r.n=p.room
   cross join lateral generate_series(0,case when p.n<=1024 then 2 else 0 end) v where p.n<=199900
   union all select r.room,p.uid,p.sid,p.pid,statement_timestamp() from fixture_rooms r join fixture_people p on p.n=199901 where r.n=1) t;
  analyze live_streams.viewer_presence;`));
 const before=await value('select count(*) from live_streams.viewer_presence');assert.equal(+before,201949);
 const measure=()=>value('select live_streams.refresh_viewer_counts(1000)');
 const measured=await timed('count_and_cleanup_all_1000',measure);
 assert.deepEqual(measured,{measured:1000,changed:1000,expired_pruned:1000});
 const dist=(await db.query("select viewer_count,count(*) rooms from live_streams.sessions where state='live' group by viewer_count order by viewer_count")).rows;
 assert.deepEqual(dist.map(r=>[+r.viewer_count,+r.rooms]),[[100,999],[100000,1]]);
 assert.equal(+await value('select count(*) from live_streams.viewer_presence where expires_at<=clock_timestamp()'),24);
 const warm=await timed('second_prune_and_skip_recent',measure);assert.equal(warm.expired_pruned,24);
 await db.exec("update live_streams.sessions set viewer_count_at=null where state='live'");
 const same=await timed('all_counts_repeated_unchanged',measure);
 assert.deepEqual(same,{measured:1000,changed:0,expired_pruned:0});
 assert.equal(+await value('select count(*) from live_streams.viewer_presence where expires_at<=clock_timestamp()'),0);
 out.observations.counts={active_unique_audience:199900,large_room:100000,other_rooms:999,each_other_room:100,total_seeded_leases:+before,duplicate_tabs:1024,expired_tabs:1024,host_preview_excluded:1,first:measured,second:warm,remeasure:same};
 // Call the actual audience RPC with isolated authenticated principals. A fresh
 // tab is intentionally measured alongside renewal and an immediately coalesced repeat.
 const sample=(await db.query(`select p.uid,p.sid,p.pid,r.room,md5('bench-second-tab/'||p.n)::uuid extra
  from fixture_people p join fixture_rooms r on r.n=p.room where p.n between 1200 and 1247
  or (p.n>=100001 and p.n<104801 and (p.n-100001)%100=0) order by p.n`)).rows;
 assert.equal(sample.length,96);
 const samples={renew:[],coalesced:[],open_tab:[],close_tab:[]};
 const stats=a=>{const v=[...a].sort((x,y)=>x-y);const q=p=>+v[Math.ceil(v.length*p)-1].toFixed(2);return {n:v.length,p50_ms:q(.5),p95_ms:q(.95),max_ms:q(1)};};
 await timed('authenticated_heartbeat_checks',async()=>{
 for (const member of sample) {
  await db.query("update live_streams.viewer_presence set last_seen_at=clock_timestamp()-interval '25 seconds' where session_id=$1 and user_id=$2 and playback_id=$3",[member.room,member.uid,member.pid]);
  for(const [kind,player,active] of [['renew',member.pid,true],['coalesced',member.pid,true],['open_tab',member.extra,true],['close_tab',member.extra,false]]){
   await db.exec('begin;set local role authenticated');
   try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)",[member.uid,JSON.stringify({sub:member.uid,role:'authenticated',session_id:member.sid,is_anonymous:false})]);
    const t=performance.now();const v=await value('select public.live_viewer_heartbeat($1,$2,$3)',[member.room,player,active]);samples[kind].push(performance.now()-t);assert.equal(v.ok,true);
    await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}
  }
 }
 });
 out.observations.heartbeat=Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,stats(v)]));
 // Simulate a disconnect of the entire large room. Expired leases must stop
 // contributing immediately regardless of cleanup backlog. Measure repeated
 // bounded invocations with no sleeps; this does NOT simulate the cron wall clock.
 await db.exec("update live_streams.viewer_presence set last_seen_at=now()-interval '100 seconds', expires_at=now()-interval '10 seconds' where session_id=(select room from fixture_rooms where n=1);update live_streams.sessions set viewer_count_at=null where state='live';analyze live_streams.viewer_presence;");
 const burstBefore=+await value('select count(*) from live_streams.viewer_presence where expires_at<=clock_timestamp()');
 assert.equal(burstBefore,101025);
 await db.exec("create temporary table expired_fixture as select * from live_streams.viewer_presence where expires_at<=clock_timestamp()");
 const wal=()=>value("select pg_current_wal_insert_lsn()::text");
 const walDelta=async before=>+await value("select pg_wal_lsn_diff(pg_current_wal_insert_lsn(),$1)::text",[before]);
 const originalWal=await wal();
 const pruneTimes=[];let totalPruned=0;
 await timed('disconnect_burst_drain',async()=>{
  while(totalPruned<burstBefore){const t=performance.now();const pass=await measure();pruneTimes.push(performance.now()-t);assert.equal(pass.expired_pruned,Math.min(1000,burstBefore-totalPruned));totalPruned+=pass.expired_pruned;
   if(pruneTimes.length===1){const v=await value('select viewer_count from live_streams.sessions where id=(select room from fixture_rooms where n=1)');assert.equal(+v,0);}
  }
 });
 assert.equal(+await value('select count(*) from live_streams.viewer_presence where expires_at<=clock_timestamp()'),0);
 assert.equal(+await value('select sum(viewer_count) from live_streams.sessions'),99900);
 out.observations.disconnect_burst={expired:burstBefore,large_room_count_after_first_pass:0,remaining_audience:99900,prunes_per_pass:1000,immediate_passes:pruneTimes.length,total_pruned:totalPruned,first_ms:+pruneTimes[0].toFixed(2),all_passes:stats(pruneTimes)};
 out.observations.disconnect_burst.wal_bytes=await walDelta(originalWal);
 await install('20261106181400_live_viewer_lease_pruning');
 // Restore the exact expired tuples, keeping commits independent so row locks
 // really end between calls. A warm restored table is not cold disk evidence.
 await db.exec("insert into live_streams.viewer_presence select * from expired_fixture;analyze live_streams.viewer_presence;");
 const candidate=()=>value('select live_streams.prune_expired_viewer_leases(5000)');
 await assert.rejects(value('select live_streams.prune_expired_viewer_leases(5001)'),/INVALID_PRUNE_LIMIT/);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await value("select has_function_privilege($1,'live_streams.prune_expired_viewer_leases(integer)','execute')",[role]),false);
 const candidateWal=await wal();let removed=0;const ticks=[];
 await timed('independent_prune_same_burst',async()=>{while(removed<burstBefore){
   const t=performance.now();const n=await candidate();ticks.push(performance.now()-t);assert.equal(n,Math.min(5000,burstBefore-removed));removed+=n;
 }});
 const candidateWritten=await walDelta(candidateWal);
 assert.equal(removed,totalPruned);assert.equal(await candidate(),0);assert.equal(+await value('select count(*) from live_streams.viewer_presence'),99900);
 assert.equal(+await value("select sum(viewer_count) from live_streams.sessions"),99900);
 out.observations.candidate_cleanup={restored_identical_expired_rows:burstBefore,max_rows:5000,cron_seconds:10,total_pruned:removed,independent_transactions:ticks.length,transaction_ms:stats(ticks),wal_bytes:candidateWritten,remaining_fresh:99900,visible_counts_unchanged:true,
   wal_scope:'Whole isolated instance LSN delta, after fixture restore, no external traffic. Original includes its count updates; candidate includes only deletes.'};
 out.sql_function_hashes=(await db.query("select proname,md5(pg_get_functiondef(oid)) as md5 from pg_proc where pronamespace='live_streams'::regnamespace and proname in ('refresh_viewer_counts','prepare_control','prune_expired_viewer_leases') order by proname")).rows;
 out.limits=['Single local PostgreSQL WASM engine. No concurrent connections, managed hardware, CDN, broadcaster, playback, heartbeat arrival rate, Realtime transport or end-to-end latency was tested.','Fixture inserted 999 preexisting active rooms. Two sequential authenticated admission attempts used the real baseline start RPC. A simulated state transition represents provider acknowledgement.','Production rollout and admission limits are unchanged. Milliseconds are observations on this runner, not service-level guarantees.'];
 out.passed=true;const json=JSON.stringify(out,null,2)+'\n';if(process.argv[2])await writeFile(process.argv[2],json);console.log(json);
}finally{await db.close();await rm(dir,{recursive:true,force:true});}
