import assert from 'node:assert/strict';import {test} from 'node:test';
import {mkdtemp,rm,stat,writeFile,symlink} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {downloadSource,prepareAudio,runTool} from '../audio.mjs';
import {createScheduler,telemetry,start,writeHealth} from '../pull.mjs';
import {healthy} from '../health.mjs';import {env,failure} from './fixtures.mjs';

test('real local ffmpeg strips video and metadata and verifies a mono 16kHz FLAC; missing audio is refused',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'caption-encode-'));try{
 const input=path.join(folder,'input.mp4'),audio=path.join(folder,'source.flac'),silent=path.join(folder,'silent.mp4');
 await runTool('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','color=c=blue:s=160x90:r=10','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','2','-c:v','mpeg4','-c:a','aac','-ac','2','-metadata','title=synthetic-only',input],{signal:AbortSignal.timeout(10000)});
 const result=await prepareAudio(input,audio,2000,AbortSignal.timeout(10000));assert.ok(result.bytes>100);assert.equal(result.sha256.length,64);assert.ok(Math.abs(result.duration_ms-2000)<750);
 const probe=JSON.parse(await runTool('ffprobe',['-v','error','-show_streams','-show_format','-of','json',audio],{signal:AbortSignal.timeout(5000)}));
 assert.equal(probe.streams.length,1);assert.equal(probe.streams[0].codec_type,'audio');assert.equal(probe.streams[0].codec_name,'flac');assert.equal(probe.streams[0].channels,1);assert.equal(probe.streams[0].sample_rate,'16000');assert.equal(probe.format.tags?.title,undefined);
 await runTool('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','color=c=blue:s=160x90:r=10','-t','1','-c:v','mpeg4',silent],{signal:AbortSignal.timeout(5000)});
 await assert.rejects(prepareAudio(silent,path.join(folder,'silent.flac'),1000,AbortSignal.timeout(5000)),failure('ENCODE_FAILED'));
 const spoof=path.join(folder,'playlist.mp4');await writeFile(spoof,'#EXTM3U\nhttps://untrusted.invalid/audio\n');await assert.rejects(prepareAudio(spoof,path.join(folder,'spoof.flac'),1000,AbortSignal.timeout(5000)),failure('ENCODE_FAILED'));
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('media download forwards no credential, follows no redirect, and creates a private exclusive file',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'caption-download-'));try{
 const destination=path.join(folder,'source.mp4');let options;
 const count=await downloadSource('https://synthetic.invalid/signed',destination,AbortSignal.timeout(1000),{fetcher:async(url,init)=>{options=init;return new Response(Buffer.alloc(128,1));}});
 assert.equal(count,128);assert.equal(options.headers,undefined);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal((await stat(destination)).mode&0o777,0o600);
 await assert.rejects(downloadSource('https://synthetic.invalid/signed',destination,AbortSignal.timeout(1000),{fetcher:async()=>new Response(Buffer.alloc(128))}),failure('SOURCE_DOWNLOAD_FAILED'));
 await assert.rejects(downloadSource('https://synthetic.invalid/signed',path.join(folder,'large.mp4'),AbortSignal.timeout(1000),{fetcher:async()=>new Response('small',{headers:{'content-length':'268435457'}})}),failure('MEDIA_TOO_LARGE'));
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('subprocesses receive no inherited secrets and terminate on timeout or excessive output',async()=>{
 process.env.PLATINUM_SYNTHETIC_PRIVATE='never-forward-this-fixture';try{
 assert.equal(await runTool(process.execPath,['-e','process.stdout.write(process.env.PLATINUM_SYNTHETIC_PRIVATE || "absent")'],{signal:AbortSignal.timeout(2000)}),'absent');
 await assert.rejects(runTool(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:AbortSignal.timeout(40)}),failure('DEADLINE'));
 await assert.rejects(runTool(process.execPath,['-e','process.stderr.write("private".repeat(10000))'],{signal:AbortSignal.timeout(2000),maxOutput:64}),error=>error.code==='ENCODE_FAILED'&&!error.message.includes('private'));
 }finally{delete process.env.PLATINUM_SYNTHETIC_PRIVATE;}
});
test('serial scheduler exits empty queues and daily-budget exhaustion instead of paying for idle compute',async()=>{
 for(const result of [{state:'idle'},{state:'disabled'},{state:'deferred',code:'DAILY_LIMIT'}]){
 let drains=0,sleeps=0;const scheduler=createScheduler({drain:async()=>{drains++;return result;}},{sleep:async()=>{sleeps++;throw Error('must exit');}});
 await scheduler.run(new AbortController().signal);assert.equal(drains,1);assert.equal(sleeps,0);assert.equal(scheduler.health.stopping,true);
 }
});
test('scheduler bounds degraded retry, keeps one drain at a time and exits on abort',async()=>{
 const stopping=new AbortController(),waits=[],events=[];let inFlight=0,maximum=0,count=0,time=0;
 const scheduler=createScheduler({drain:async()=>{inFlight++;maximum=Math.max(maximum,inFlight);time+=5;inFlight--;return{state:'unavailable',code:'BROKER_UNAVAILABLE'};}},
 {idleMs:60000,now:()=>time,random:()=>1,emit:(...args)=>events.push(args),sleep:async(ms)=>{waits.push(ms);time+=ms;if(++count===4)stopping.abort();}});
 await scheduler.run(stopping.signal);assert.equal(maximum,1);assert.deepEqual(waits,[60000,120000,240000,300000]);assert.equal(events.length,4);assert.equal(scheduler.health.cycle_started_ms,null);
});
test('telemetry emits only fixed statuses/counts and never customer text, exceptions, keys or signed URLs',()=>{
 let output='';const emit=telemetry({deployment:'SyntheticWorker',write:text=>output+=text,now:()=>1760000000000});
 emit('drain',{state:'draft',code:'secret-http-url',cleanup_pending:true,url:'https://private.invalid?token=private',text:'customer speech',id:'private-id'},100);emit('unknown',{secret:'private'});
 const value=JSON.parse(output);assert.equal(value.state,'draft');assert.equal(value.code,'AWS_UNAVAILABLE');assert.equal(value.CleanupPending,1);assert.ok(!output.includes('private'));assert.ok(!output.includes('customer'));assert.ok(!output.includes('secret-http-url'));
});
test('expired absolute task deadline exits before credentials, filesystem work or provider requests',async()=>{
 const saved=process.stdout.write;let output='';process.stdout.write=text=>{output+=text;return true;};
 try{await start({...env,LIVE_TRANSCRIPTION_TASK_DEADLINE_MS:String(Date.now()-1000),TMPDIR:'/invalid/unavailable/path'});}finally{process.stdout.write=saved;}
 assert.equal(JSON.parse(output).kind,'stopping');
});
test('health distinguishes a live bounded cycle from a stuck task, stale heartbeat and symlink',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'caption-health-'));try{
 await writeHealth(folder,{cycle_started_ms:null,stopping:false});assert.equal(await healthy(folder),true);
 await writeHealth(folder,{cycle_started_ms:Date.now()-110000,stopping:false});assert.equal(await healthy(folder),false);
 await writeHealth(folder,{cycle_started_ms:null,stopping:true});assert.equal(await healthy(folder),false);
 const file=path.join(folder,'pc-live-transcription-health.json');await rm(file);await symlink('/dev/null',file);assert.equal(await healthy(folder),false);
 }finally{await rm(folder,{recursive:true,force:true});}
});
