import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {command,transcode,probe,ladder,validatePlaylist} from '../transcode.mjs';
test('real FFmpeg produces independently decodable ABR playlists, audio and faststart fallback while preserving the original',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pc-rendition-test-'));
 try{
  const input=path.join(dir,'input.mp4'),out=path.join(dir,'output');
  await command('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=8','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=8','-c:v','libx264','-preset','ultrafast','-threads','1','-c:a','aac','-shortest',input]);
  const before=createHash('sha256').update(await readFile(input)).digest('hex');
  const result=await transcode(input,out,{duration_max_seconds:600,output_max_bytes:805306368},{threads:1,signal:AbortSignal.timeout(60000)});
  assert.equal(result.media.width,640);assert.equal(result.media.height,360);assert.ok(Math.abs(result.media.duration-8)<.2);
  assert.ok(result.assets.some(a=>a.name==='r0/seg00001.ts'));assert.ok(result.assets.some(a=>a.name==='r1/index.m3u8'));
  for(const folder of ['r0','r1'])await command('ffmpeg',['-hide_banner','-loglevel','error','-protocol_whitelist','file,crypto','-i',path.join(out,folder,'index.m3u8'),'-f','null','-'],{signal:AbortSignal.timeout(20000)});
  assert.equal((await probe(path.join(out,'fallback.mp4'))).audio,true);
  const fallback=await readFile(path.join(out,'fallback.mp4'));assert.ok(fallback.indexOf(Buffer.from('moov'))<fallback.indexOf(Buffer.from('mdat')));
  assert.equal(createHash('sha256').update(await readFile(input)).digest('hex'),before);
  assert.ok(result.assets.every(a=>/^[a-f0-9]{64}$/.test(a.sha256)));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('ladder preserves aspect ratio, portrait dimensions, high frame rate and never upscales',()=>{
 for(const media of [{width:1080,height:1920,fps:60},{width:640,height:360,fps:30},{width:320,height:240,fps:24}]){
  const variants=ladder(media);assert.ok(variants.length<=4);for(const v of variants){assert.ok(v.width<=media.width&&v.height<=media.height);assert.ok(Math.abs(v.width/v.height-media.width/media.height)<.01);assert.equal(v.width%2,0);assert.equal(v.height%2,0);}
 }
});
test('playlists cannot introduce external URLs, traversal, key URLs or incomplete VOD',()=>{
 for(const data of ['#EXTM3U\nhttps://outside.invalid/file.ts\n#EXT-X-ENDLIST\n','#EXTM3U\n../secret.ts\n#EXT-X-ENDLIST\n','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://outside.invalid"\nseg00000.ts\n#EXT-X-ENDLIST\n','#EXTM3U\nseg00000.ts\n'])assert.throws(()=>validatePlaylist(data,'r0/index.m3u8'));
});
test('encoder cancellation terminates the real child process promptly',async()=>{
 const c=new AbortController();const started=Date.now();const work=command('ffmpeg',['-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=320x240:rate=30','-f','null','-'],{signal:c.signal});setTimeout(()=>c.abort(),100);await assert.rejects(work,/worker_deadline/);assert.ok(Date.now()-started<3000);
});
