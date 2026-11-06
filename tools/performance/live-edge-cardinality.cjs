'use strict';
// Isolated logical audience check; no external socket, AWS key, CDN or video request.
// The CloudFront-specific environment is injected; authorization code is the tracked
// viewer-request source. This checks actual path/key behavior, not AWS throughput.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{planFor}=require('./live-standard.cjs');
async function run(){
 const p=planFor(1000),source=fs.readFileSync(path.join(__dirname,'../../infrastructure/live/viewer-request.js'),'utf8');
 const fixed=1_800_000_000, key=crypto.randomBytes(32).toString('hex');
 const ctx=vm.createContext({cf:{kvs:()=>({get:async k=>k==='signing:fixture'?key:undefined})},require:n=>{assert.equal(n,'crypto');return crypto;},Date:{now:()=>fixed*1000}});
 const body=source.replace("import cf from 'cloudfront';",'');assert.notEqual(body,source);const check=vm.runInContext(body+'\n;handler',ctx);
 const opened=performance.now();let accepted=0,refused=0,featured=0;const objectKeys=new Set();
 const id=i=>'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
 const grant=(room,instance,expires)=>{const value=['fixture',expires,room,instance].join('.');return value+'.'+crypto.createHmac('sha256',key).update('pc-live-v1.'+value).digest('hex');};
 function event(token,object,n){return {request:{method:'GET',uri:'/_live/'+token+'/'+object,headers:{cookie:{value:'dummy'},authorization:{value:'dummy'}},querystring:{viewer:{value:String(n)}}}};}
 for(let i=1;i<=p.broadcasts;i++){
  const room=id(i),instance=id(10000+i),amount=i===1?p.eventViewers:p.otherRoomViewers,prefix='live/'+room+'/'+instance+'/';
  // Vary expiry/credentials across people to ensure none enter the origin cache key.
  const tickets=Array.from({length:120},(_,n)=>grant(room,instance,fixed+n+1));
  for(let n=0;n<amount;n++) for(const file of ['master.m3u8','stream/00027.m4s']){
   const result=await check(event(tickets[n%120],prefix+file,n));
   assert.equal(result.uri,'/'+prefix+file);assert.equal(Object.keys(result.querystring).length,0);assert.equal(result.headers.authorization,undefined);assert.equal(result.headers.cookie,undefined);
   objectKeys.add(result.uri);accepted++;if(i===1)featured++;
  }
  for(const ev of [event(tickets[0],'live/'+id(i+1)+'/'+instance+'/master.m3u8',0),event(grant(room,instance,fixed-1),prefix+'master.m3u8',0)]){
   const no=await check(ev);assert.equal(no.statusCode,403);refused++;
  }
 }
 assert.equal(accepted,p.totalViewers*2);assert.equal(featured,200000);assert.equal(objectKeys.size,p.broadcasts*2);
 return {scope:'Isolated Node execution of exact edge authorization code, fake key-value store and clock. Sequential logical requests, no hosted users, no media transfer, no throughput certification.',code_sha256:crypto.createHash('sha256').update(source).digest('hex'),rooms:p.broadcasts,logicalViewerRoomAttendances:p.totalViewers,featuredRoomViewers:p.eventViewers,authorizedManifestAndSegmentRequests:accepted,distinctAuthorizedObjectPaths:objectKeys.size,expiredOrCrossRoomDenied:refused,elapsedMs:Math.round(performance.now()-opened)};
}
if(require.main===module)run().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={run};
