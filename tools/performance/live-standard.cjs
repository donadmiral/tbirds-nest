'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const config = require('./live-capacity-stages.json');
function planFor(broadcasts = 1000) {
  const stage = config.stages.find(s => s.broadcasts === broadcasts);
  if (!stage) throw Error('Unknown admission tier');
  const event = stage.eventViewers, other = (broadcasts - 1) * config.otherRoomViewers;
  const total = event + other, r = config.headroom;
  const delivery = config.averageVideoMbps * total / 1000;
  // Web/native audience heartbeats can run as often as every 20s. All active
  // subscribers can receive a chat event; do not dilute the hot room by averaging.
  const chat = event * config.peakRoomMessagesPerSecond + other * config.otherRoomMessagesPerSecond;
  return { standard:config.standard, broadcasts, eventViewers:event, otherRooms:broadcasts-1,
    otherRoomViewers:config.otherRoomViewers, totalViewers:total, modeled:true,
    averageVideoMbps:config.averageVideoMbps, reservedVideoGbps:Math.ceil(delivery*r),
    steadyVideoGbps:Number(delivery.toFixed(3)), viewerHeartbeatsPerSecond:Math.ceil(total/20),
    playbackRenewalsPerSecond:Math.ceil(total/90), chatDeliveriesPerSecond:chat,
    reservedPublisherSessions:broadcasts*r, reservedChatDeliveriesPerSecond:chat*r,
    reservedRealtimeConnections:total*r, reservedHeartbeatRps:Math.ceil(total/20*r),
    reservedPlaybackAuthorizationRps:Math.ceil(total/90*r), minimumSoakHours:broadcasts===1000?24:1 };
}
const SOURCE=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
function verify(plan, e, expectedSource, now = Date.now()) {
  const missing=[];
  if (!SOURCE.test(expectedSource || '') || !e || e.sourceCommit !== expectedSource) missing.push('expected release source');
  if (e?.standard!==config.standard || e?.tier!==plan.broadcasts || e?.environment!=='dedicated-provider-load' || e?.syntheticOnly !== false) missing.push('correct tier and connected-provider exercise');
  const start=Date.parse(e?.observedFrom), end=Date.parse(e?.observedTo);
  if (!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end>now||now-end>30*86400000) missing.push('current measured interval');
  // A single simultaneous window, never the sum of unrelated peaks or spectators.
  const w=e?.simultaneous||{}, bounds={minimumBroadcasts:plan.broadcasts,minimumHotRoomViewers:plan.eventViewers,
    minimumTotalViewers:plan.totalViewers, minimumOtherRoomsWithAudience:plan.otherRooms,
    minimumAudiencePerOtherRoom:plan.otherRoomViewers, durationSeconds:plan.minimumSoakHours*3600};
  function min(obj,k,n){ if(!Number.isFinite(obj?.[k])||obj[k]<n) missing.push(k); }
  for (const [k,n] of Object.entries(bounds)) min(w,k,n);
  if (w.durationSeconds>(end-start)/1000) missing.push('simultaneous window outside observation');
  for(const [k,n] of Object.entries({dailyPublisherSessions:plan.reservedPublisherSessions,cdnGbps:plan.reservedVideoGbps,
    realtimeConnections:plan.reservedRealtimeConnections,realtimeDeliveriesPerSecond:plan.reservedChatDeliveriesPerSecond})) min(e?.providerQuotas,k,n);
  min(e?.observedRates,'playbackAuthorizationRps',plan.reservedPlaybackAuthorizationRps);
  min(e?.observedRates,'heartbeatRps',plan.reservedHeartbeatRps);
  min(e?.observedRates,'deliveredChatMessagesPerSecond',plan.chatDeliveriesPerSecond);
  for(const k of ['multiRegionPlayback','hotRoomJoinBurst','simultaneousCreatorStart','reconnectBurst','guestCameraRejoin',
    'authorizationRevocation','workerFailureRecovery','rollbackRehearsed','approvedTestBudget']) if(e?.checks?.[k]!==true) missing.push(k);
  for(const [k,max] of Object.entries({startupP95Ms:3500,rebufferPercent:1,startFailurePercent:1,chatP95Ms:2000})){
    const val=e?.experience?.[k]; if(!Number.isFinite(val)||val<0||val>max)missing.push(k);
  }
  for(const k of ['dailyQuota','cdnQuota','realtimeQuota','simultaneousAudience','playbackAndChat','failureRecovery','operatorApproval']){
    const a=e?.artifacts?.[k]; if(!a||!DIGEST.test(a.sha256||'')||typeof a.ref!=='string'||!/^https:\/\//.test(a.ref))missing.push('artifact:'+k);
  }
  return {accepted:missing.length===0,missing};
}
module.exports={planFor,verify};
if(require.main===module){
  const [tier,evidence,source]=process.argv.slice(2);
  const plan=planFor(tier===undefined?1000:Number(tier));
  const bytes=evidence && fs.readFileSync(evidence);
  const verification=bytes?verify(plan,JSON.parse(bytes),source):{accepted:false,missing:['No observed provider evidence']};
  console.log(JSON.stringify({plan,verification,evidenceSha256:bytes?crypto.createHash('sha256').update(bytes).digest('hex'):null},null,2));
  if(bytes && !verification.accepted)process.exitCode=1;
}
