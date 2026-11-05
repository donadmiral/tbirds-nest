import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Input is a private JSON document on stdin. Never pass capabilities in argv.
// The only writes are one temporary segment, removed even when decoding fails.
const fail = code => { throw new Error(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = { projectRef: 'uaulhuelcfkjwojtymmw', ok: false, requests: [], downloadedBytes: 0 };
let temporary;
try {
  // A dedicated PTY can receive one private input line without terminal echo.
  // This also supports an ordinary pipe and never writes the capability to disk.
  if(process.stdin.isTTY)process.stdin.setRawMode(true);
  const input=createInterface({input:process.stdin,terminal:false,crlfDelay:Infinity});
  let line;
  for await(const value of input){line=value;break;}
  if(process.stdin.isTTY)process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdin.unref?.();
  const config = JSON.parse(line);
  if (config.projectRef !== receipt.projectRef || !/^[0-9a-f]{64}$/.test(config.token) || !/^[0-9a-f]{64}$/.test(config.cleanupDigest)
    || !['post-media','story-media'].includes(config.bucket) || typeof config.path !== 'string' || config.path.length>1024
    || /[%\\\u0000-\u001f]/.test(config.path) || config.path.split('/').some(p=>!p||p==='.'||p==='..')) fail('invalid_config');
  const origin = new URL(config.gatewayOrigin), expires = Date.parse(config.expiresAt);
  if (origin.protocol!=='https:' || origin.pathname!=='/' || origin.username || origin.password || origin.search || origin.hash
    || !Number.isFinite(expires) || expires<Date.now()+5000 || expires>Date.now()+60000) fail('invalid_deadline_or_origin');
  receipt.cleanupDigest=config.cleanupDigest;
  receipt.sourceHash=sha(config.bucket+'/'+config.path+'@'+config.sourceVersion);
  const root = new URL('/playback/'+config.bucket+'/'+config.path.split('/').map(encodeURIComponent).join('/')+'/master.m3u8',origin);
  root.searchParams.set('token',config.token);
  async function request(url,label,limit,statuses=[200]) {
    const started=performance.now();
    const response=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});
    receipt.requests.push({label,status:response.status,headerMs:Math.round(performance.now()-started)});
    if (!statuses.includes(response.status)) {await response.body?.cancel();fail(label+'_status');}
    if (!response.headers.get('cache-control')?.includes('no-store')) {await response.body?.cancel();fail(label+'_cache_policy');}
    if (Number(response.headers.get('content-length')||0)>limit) {await response.body?.cancel();fail(label+'_body_budget');}
    const reader=response.body?.getReader();const chunks=[];let count=0;
    if(reader)try{for(;;){const next=await reader.read();if(next.done)break;count+=next.value.length;if(count>limit)fail(label+'_body_budget');chunks.push(next.value);}}finally{await reader.cancel().catch(()=>{});}
    receipt.downloadedBytes+=count;
    return Buffer.concat(chunks,count);
  }
  const check=new URL(root);check.searchParams.set('format','json');
  const ready=JSON.parse((await request(check,'readiness',8192)).toString('utf8'));
  if(ready.ready!==true || ready.sourceVersion!==config.sourceVersion || ready.hlsUrl!==root.href)fail('readiness_identity');
  const master=(await request(root,'master',65536)).toString('utf8');
  const lines=text=>text.split('\n').filter(line=>line && !line.startsWith('#'));
  function child(line,asset) {
    const url=new URL(line);
    if(url.origin!==origin.origin || url.pathname!==root.pathname || url.searchParams.get('token')!==config.token
      || url.searchParams.getAll('token').length!==1 || url.searchParams.get('asset')!==asset || !/^[0-9a-f-]{36}$/.test(url.searchParams.get('rendition')||'')) fail('playlist_identity');
    return url;
  }
  if(!master.startsWith('#EXTM3U\n'))fail('master_invalid');
  const variantUrl=child(lines(master)[0],'r0/index.m3u8');
  const variant=(await request(variantUrl,'lowest_variant',65536)).toString('utf8');
  if(!variant.startsWith('#EXTM3U\n')||!variant.includes('#EXT-X-ENDLIST'))fail('variant_invalid');
  const segmentUrl=child(lines(variant)[0],'r0/seg00000.ts');
  if(segmentUrl.searchParams.get('rendition')!==variantUrl.searchParams.get('rendition'))fail('segment_lease');
  const segment=await request(segmentUrl,'first_segment',2097152);
  temporary=await mkdtemp(join(tmpdir(),'pc-hls-canary-'));
  const filename=join(temporary,'segment.ts');await writeFile(filename,segment,{mode:0o600});
  let metadata;
  try {
    metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-protocol_whitelist','file','-show_entries','stream=codec_type,codec_name,width,height','-of','json',filename],{encoding:'utf8',timeout:10000,maxBuffer:1048576}));
    execFileSync('ffmpeg',['-v','error','-nostdin','-protocol_whitelist','file','-i',filename,'-frames:v','1','-f','null','-'],{stdio:['ignore','ignore','pipe'],timeout:10000,maxBuffer:1048576});
  } catch { fail('segment_decode_failed'); }
  const video=metadata.streams?.find(stream=>stream.codec_type==='video');
  if(!video?.width||!video?.height)fail('video_metadata_missing');
  receipt.decode={codec:video.codec_name,width:video.width,height:video.height,segmentBytes:segment.length,segmentSha256:sha(segment),firstFrameDecoded:true};
  const invalid=new URL(check);invalid.searchParams.set('token',randomBytes(32).toString('hex'));
  await request(invalid,'invalid_capability',8192,[403,404]);
  const delay=Math.max(0,expires-Date.now()+250);if(delay>60000)fail('expiry_wait_budget');
  await new Promise(resolve=>setTimeout(resolve,delay));
  await request(check,'expired_capability',8192,[403,404]);
  receipt.ok=true;
} catch(error) {
  receipt.error=error instanceof Error && /^[a-z_]+$/.test(error.message)?error.message:'canary_failed';
} finally {
  if(temporary)await rm(temporary,{recursive:true,force:true});
  process.stdout.write(JSON.stringify(receipt)+'\n');
  if(!receipt.ok)process.exitCode=1;
}
