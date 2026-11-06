'use strict';
// Consume redacted, provider-backed attendance snapshots. Never add independent
// peak metrics together: at each timestamp count the same fixed event and rooms.
const fs=require('node:fs'),readline=require('node:readline'),crypto=require('node:crypto');
const opaque=s=>typeof s==='string'&&/^[a-f0-9]{32,64}$/.test(s);
async function measure(iter,plan,source){
 let first=null,last=null,event=null,samples=0;
 const minima={minimumBroadcasts:Infinity,minimumHotRoomViewers:Infinity,minimumTotalViewers:Infinity,minimumOtherRoomsWithAudience:Infinity,minimumAudiencePerOtherRoom:Infinity};
 for await(const line of iter){
  if(!line.trim())continue;
  if(line.length>2e6)throw Error('Oversized snapshot');
  const s=JSON.parse(line),t=Date.parse(s.at);
  if(!Number.isFinite(t)||s.sourceCommit!==source||!opaque(s.eventRoom)||!Array.isArray(s.activeRooms)||s.activeRooms.length>10000)throw Error('Invalid snapshot, source or event');
  if(first===null){first=t;event=s.eventRoom;} else if(t<=last||t-last>60000||s.eventRoom!==event)throw Error('Discontinuous or different event');
  const seen=new Set(),other=[];let hot=0,total=0;
  for(const row of s.activeRooms){
   if(!Array.isArray(row)||row.length!==2||!opaque(row[0])||seen.has(row[0])||!Number.isSafeInteger(row[1])||row[1]<0||row[1]>5000000)throw Error('Invalid or duplicate room');
   seen.add(row[0]);total+=row[1];if(row[0]===event)hot=row[1];else other.push(row[1]);
  }
  other.sort((a,b)=>b-a);
  const point={minimumBroadcasts:seen.size,minimumHotRoomViewers:hot,minimumTotalViewers:total,
   minimumOtherRoomsWithAudience:other.filter(x=>x>=plan.otherRoomViewers).length,
   minimumAudiencePerOtherRoom:other[plan.otherRooms-1]||0};
  for(const k of Object.keys(minima))minima[k]=Math.min(minima[k],point[k]);last=t;samples++;
 }
 if(samples<2)throw Error('At least two snapshots required');
 return {simultaneous:{...minima,durationSeconds:(last-first)/1000},observedFrom:new Date(first).toISOString(),observedTo:new Date(last).toISOString(),samples};
}
async function measureFile(file,plan,source){
 const stream=fs.createReadStream(file),hash=crypto.createHash('sha256');stream.on('data',chunk=>hash.update(chunk));
 try{const measured=await measure(readline.createInterface({input:stream,crlfDelay:Infinity}),plan,source);
 return {...measured,sha256:hash.digest('hex')};}finally{stream.destroy();}
}
module.exports={measure,measureFile};
if(require.main===module){const [, ,file,tier,source]=process.argv;measureFile(file,require('./live-standard.cjs').planFor(+tier),source).then(result=>console.log(JSON.stringify(result,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});}
