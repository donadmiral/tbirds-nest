const test=require('node:test'),assert=require('node:assert/strict'),{measure}=require('../tools/performance/live-audience-window.cjs');
const source='0'.repeat(40),event='a'.repeat(32),b='b'.repeat(32),c='c'.repeat(32),plan={otherRooms:2,otherRoomViewers:100};
const records=(a,names=[event,event],offset=60)=>a.map((rooms,i)=>JSON.stringify({sourceCommit:source,eventRoom:names[i],at:new Date(Date.UTC(2026,0,1)+i*offset*1000).toISOString(),activeRooms:rooms}));
test('separate peaks cannot certify one hot event with the long tail healthy',async()=>{
 const rows=[[[event,100000],[b,1],[c,100]],[[event,10],[b,100000],[c,100]]];
 const result=await measure(records(rows),plan,source);assert.deepEqual(result.simultaneous,{minimumBroadcasts:3,minimumHotRoomViewers:10,minimumTotalViewers:100101,minimumOtherRoomsWithAudience:1,minimumAudiencePerOtherRoom:1,durationSeconds:60});
 await assert.rejects(measure(records(rows,[event,b]),plan,source),/different event/);
 await assert.rejects(measure(records(rows,[event,event],61),plan,source),/Discontinuous/);
 await assert.rejects(measure(records([[[b,10],[b,30]],rows[1]]),plan,source),/duplicate/);
});
