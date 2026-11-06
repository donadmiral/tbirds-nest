import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createMediaBroker} from '../../../supabase/functions/media-broker/handler.mjs';
import {backend} from '../backend.mjs';
import {createWorkerHandler} from '../server.mjs';
import {createPosterWorker} from '../poster.mjs';
const base='https://poster.example',key=randomUUID()+'.'+'a'.repeat(64),cron='b'.repeat(40),digest=b=>createHash('sha256').update(b).digest('hex');
function fixture(bytes,options={}){
 const job={filter_id:'none',lease:randomUUID(),media_id:randomUUID(),bucket:'adaptive-media',path:randomUUID()+'/_renditions_v2/'+randomUUID()+'/'+randomUUID()+'/fallback.mp4',version:'v1',etag:'fixture-etag',bytes:bytes.length,sha256:digest(bytes),...options.descriptor};
 let finished=false,claims=0,signs=0;const commits=[],seen=[];
 const broker=createMediaBroker({base,rpc:async(name,args)=>{
  if(name==='authorize_media_broker_v2')return options.role||'worker';
  if(name==='claim_post_poster_v1'){claims++;return finished?null:job;}
  if(name==='finish_post_poster_v1'){assert.equal(args.p_lease,job.lease);assert.equal(args.p_media,job.media_id);commits.push(args);return finished=options.allow!==false;}
  throw Error('unexpected_rpc');
 },storage:{downloadURL:(bucket,p,ttl)=>{signs++;assert.equal(ttl,90);return (options.foreign?'https://other.example':base)+'/storage/v1/object/sign/'+bucket+'/'+p+'?token=fixture';}}});
 const api=backend({base,brokerUrl:base+'/functions/v1/media-broker',brokerKey:key,fetchImpl:async(url,init)=>{
  const u=new URL(url);if(u.pathname==='/functions/v1/media-broker')return broker(new Request(url,init));
  assert.equal(u.origin,base);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(new Headers(init.headers).get('authorization'),null);seen.push(u.pathname);
  return new Response(bytes,{status:200,headers:{etag:'"fixture-etag"','content-type':'video/mp4','content-length':String(bytes.length),...options.headers}});
 }});
 return{api,job,broker,commits,seen,stats:()=>({claims,signs}),send:(action,args)=>broker(new Request(base,{method:'POST',headers:{Authorization:'Bearer '+key,'X-Media-Request-ID':randomUUID(),'X-Media-Issued-At':new Date().toISOString()},body:JSON.stringify({action,args})}))};
}
test('one enrolled progressive MP4 generates the actual capped JPEG via the scoped broker, then goes idle',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pc-fixture-poster-'));
 try{
  const source=path.join(dir,'clip.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=1280x720:r=10','-t','0.4','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart',source]);
  const f=fixture(await readFile(source)),job=createPosterWorker(f.api,{tempRoot:dir});
  const result=await job();assert.equal(result.state,'ready');assert.equal(result.width,640);assert.equal(result.height,360);assert.ok(result.bytes<65537);
  const saved=f.commits[0],jpeg=Buffer.from(saved.p_jpeg,'base64');assert.equal(digest(jpeg),saved.p_sha256);
  const rgb=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','mjpeg','-i','pipe:0','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-frames:v','1','-threads','1','pipe:1'],{input:jpeg});
  assert.ok(rgb[0]>180&&rgb[1]<50&&rgb[2]<50,'JPEG must contain the video fixture pixels');
  assert.deepEqual(await job(),{state:'idle'});assert.equal(f.commits.length,1);assert.equal(f.seen.length,1);assert.deepEqual(await readdir(dir),['clip.mp4']);
  const falseHash=await f.send('poster_finish',{...saved,p_sha256:'c'.repeat(64)});assert.equal(falseHash.status,400);
  const fake=Buffer.from(jpeg);const sof=fake.indexOf(Buffer.from([0xff,0xc0]));assert.ok(sof>0);fake.writeUInt16BE(1024,sof+5);
  assert.equal((await f.send('poster_finish',{...saved,p_sha256:digest(fake),p_jpeg:fake.toString('base64')})).status,400);assert.equal(f.commits.length,1);
  const faded=fixture(await readFile(source),{descriptor:{filter_id:'fade'}});
  assert.equal((await createPosterWorker(faded.api,{tempRoot:dir})()).state,'ready');
  const fadedRGB=execFileSync('ffmpeg',['-loglevel','error','-f','mjpeg','-i','pipe:0','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-frames:v','1','-threads','1','pipe:1'],{input:Buffer.from(faded.commits[0].p_jpeg,'base64')});
  assert.ok(fadedRGB[0]-fadedRGB[1]<rgb[0]-rgb[1]-10,'authored fade must actually reduce saturation');
  const stale=fixture(await readFile(source),{allow:false});assert.deepEqual(await createPosterWorker(stale.api,{tempRoot:dir})(),{state:'rejected'});assert.deepEqual(await readdir(dir),['clip.mp4']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('workers cannot supply locators; wrong role, source version proofs, origin, MIME, hash and lengths are rejected before encoding',async()=>{
 const bytes=Buffer.from('not-encoded');for(const opt of [{descriptor:{filter_id:'injected-expression'}},{role:'gateway'},{foreign:true},{descriptor:{path:'foreign/escape'}},{descriptor:{bytes:33554433}},{descriptor:{sha256:'f'.repeat(64)}},{headers:{etag:'"changed"'}},{headers:{'content-type':'text/html'}},{headers:{'content-length':'1'}}]){
  const f=fixture(bytes,opt);let encodes=0;assert.deepEqual(await createPosterWorker(f.api,{encode:()=>{encodes++;}})(),{state:'unavailable'});assert.equal(encodes,0);assert.equal(f.commits.length,0);
 }
 const f=fixture(bytes);assert.equal((await f.send('poster_claim',{path:'input'})).status,400);assert.equal(f.stats().claims,0);
});
test('one-shot HTTP path rejects unauthenticated calls, alternate methods and caller-selected objects',async()=>{
 const api={base,fetch,claimPoster:async()=>null,finishPoster:async()=>true},ctrl=new AbortController();
 const server=createServer(createWorkerHandler({config:{cronSecret:cron},api,worker:{},stopping:ctrl,env:{MEDIA_WORKER_RUNTIME:'sandbox'}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/poster';
 try{assert.equal((await fetch(url,{method:'POST'})).status,401);assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+cron}})).status,405);
  const send=(suffix,body)=>fetch(url+suffix,{method:'POST',headers:{Authorization:'Bearer '+cron,'content-type':'application/json'},body});
  assert.equal((await send('?source=1','{}')).status,400);assert.equal((await send('','{"path":true}')).status,400);
  assert.deepEqual(await (await send('','{}')).json(),{state:'idle'});
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
