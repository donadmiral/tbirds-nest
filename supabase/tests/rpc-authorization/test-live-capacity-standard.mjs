import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {test} from 'node:test';
import model from '../../../tools/performance/live-standard.cjs';
const src='a'.repeat(40), hash='d'.repeat(64);
const migration=await readFile(new URL('../../migrations/20261106183900_live_capacity_standard.sql',import.meta.url),'utf8');
test('release admission, offline proof and rollback stay distinct from the modeled target',async()=>{
 const db=new PGlite();
 try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema live_streams;grant usage on schema live_streams to authenticated,service_role; create table live_streams.settings(singleton boolean primary key,max_active_broadcasts int,capacity_evidence_ref text);insert into live_streams.settings values(true,10,null)");
 await db.exec('begin;'+migration+'commit;');
 const cap=async()=>(await db.query('select max_active_broadcasts from live_streams.settings')).rows[0].max_active_broadcasts;
 assert.equal(await cap(),10);
 for(const role of ['anon','authenticated','service_role']){
 const grants=await db.query("select has_table_privilege($1,'live_streams.capacity_qualifications','insert') as add,has_function_privilege($1,'live_streams.require_capacity_qualification()','execute') as run",[role]);assert.deepEqual(grants.rows[0],{add:false,run:false});
 }
 const tiers=(await db.query('select * from live_streams.capacity_tiers order by broadcasts')).rows;
 assert.equal(tiers.length,5);
 for(const tier of tiers){const p=model.planFor(tier.broadcasts);assert.equal(p.eventViewers,tier.peak_room_viewers);assert.equal(p.otherRoomViewers,tier.other_room_viewers);}
 assert.equal(model.planFor().totalViewers,199900);
 await assert.rejects(db.exec('update live_streams.settings set max_active_broadcasts=1000'),/LIVE_CAPACITY_TIER_ORDER/);
 await assert.rejects(db.exec('update live_streams.settings set max_active_broadcasts=25'),/LIVE_CAPACITY_EVIDENCE_REQUIRED/);
 await db.query("insert into live_streams.capacity_qualifications(evidence_sha256,source_revision,tier,report_url,observed_until) values($1,$2,25,'https://example.test/evidence',now()-interval '2 minutes')",[hash,src]);
 await db.query('update live_streams.settings set max_active_broadcasts=25,capacity_evidence_ref=$1',[hash]);assert.equal(await cap(),25);
 await db.exec('update live_streams.settings set max_active_broadcasts=10');assert.equal(await cap(),10);
 await assert.rejects(db.query('update live_streams.settings set max_active_broadcasts=25,capacity_evidence_ref=$1',[hash]),/LIVE_CAPACITY_EVIDENCE_REQUIRED/);
 }finally{await db.close();}
});
test('only same-window, source-bound provider and experience evidence qualifies',()=>{
 const p=model.planFor(), now=Date.UTC(2026,10,6), receipt={ref:'https://example.test/retained',sha256:hash};
 const e={standard:p.standard,tier:p.broadcasts,sourceCommit:src,environment:'dedicated-provider-load',syntheticOnly:false,
  observedFrom:new Date(now-86400000).toISOString(),observedTo:new Date(now).toISOString(),
  simultaneous:{minimumBroadcasts:1000,minimumHotRoomViewers:100000,minimumTotalViewers:199900,minimumOtherRoomsWithAudience:999,minimumAudiencePerOtherRoom:100,durationSeconds:86400},
  providerQuotas:{dailyPublisherSessions:2000,cdnGbps:720,realtimeConnections:399800,realtimeDeliveriesPerSecond:4199800},
  observedRates:{playbackAuthorizationRps:p.reservedPlaybackAuthorizationRps,heartbeatRps:p.reservedHeartbeatRps,deliveredChatMessagesPerSecond:p.chatDeliveriesPerSecond},
  checks:Object.fromEntries(['multiRegionPlayback','hotRoomJoinBurst','simultaneousCreatorStart','reconnectBurst','guestCameraRejoin','authorizationRevocation','workerFailureRecovery','rollbackRehearsed','approvedTestBudget'].map(k=>[k,true])),
  experience:{startupP95Ms:2400,chatP95Ms:500,startFailurePercent:.1,rebufferPercent:.2},
  artifacts:Object.fromEntries(['dailyQuota','cdnQuota','realtimeQuota','simultaneousAudience','playbackAndChat','failureRecovery','operatorApproval'].map(k=>[k,receipt]))};
 assert.equal(model.verify(p,e,src,now).accepted,true);
 for(const mutate of [v=>v.simultaneous.minimumBroadcasts=998,v=>v.simultaneous.minimumHotRoomViewers=10000,v=>v.simultaneous.minimumTotalViewers=100000,v=>v.simultaneous.minimumOtherRoomsWithAudience=0,v=>v.simultaneous.durationSeconds=86399,v=>v.observedFrom=v.observedTo,v=>v.sourceCommit='b'.repeat(40),v=>v.environment='isolated-database',v=>v.syntheticOnly=true,v=>v.providerQuotas.cdnGbps=150,v=>v.experience.rebufferPercent=25,v=>v.artifacts.dailyQuota=null]){
  const invalid=structuredClone(e);mutate(invalid);assert.equal(model.verify(p,invalid,src,now).accepted,false);
 }
});
