import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import {UUID} from './config.mjs';
import {command,probe} from './transcode.mjs';

const MAX_INPUT=32*1024*1024,MAX_JPEG=64*1024;
const validPath=value=>{if(typeof value!=='string')return false;const p=value.split('/');return p.length===5&&UUID.test(p[0])&&p[1]==='_renditions_v2'&&UUID.test(p[2])&&UUID.test(p[3])&&p[4]==='fallback.mp4';};
async function download(api,job,file,signal){
  if(!['none','fade'].includes(job?.filter_id)||!UUID.test(job?.lease)||!UUID.test(job.media_id)||job.bucket!=='adaptive-media'||!validPath(job.path)
    ||typeof job.version!=='string'||!job.version||job.version.length>128||typeof job.etag!=='string'||!job.etag||job.etag.length>256||/[\s"\\]/.test(job.etag)||job.etag.startsWith('W/')
    ||!Number.isSafeInteger(job.bytes)||job.bytes<1||job.bytes>MAX_INPUT||!(/^[a-f0-9]{64}$/).test(job.sha256))throw Error('invalid_descriptor');
  const url=new URL(job.url);
  if(url.protocol!=='https:'||url.origin!==api.base||url.username||url.password||url.hash||url.pathname!=='/storage/v1/object/sign/adaptive-media/'+job.path||url.searchParams.getAll('token').length!==1||!url.searchParams.get('token')||[...url.searchParams.keys()].some(k=>k!=='token'))throw Error('invalid_transfer_url');
  // The broker and its credentials are never forwarded to the signed Storage URL.
  const response=await api.fetch(url,{headers:{'Accept-Encoding':'identity'},redirect:'error',credentials:'omit',cache:'no-store',signal});
  const etag=response.headers.get('etag'),length=response.headers.get('content-length');
  if(response.status!==200||response.redirected||!response.body||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='video/mp4'
    ||![null,'identity'].includes(response.headers.get('content-encoding'))||!(etag===job.etag||etag==='"'+job.etag+'"')||(length!==null&&length!==String(job.bytes))){
    await response.body?.cancel();throw Error('invalid_source');
  }
  let size=0;const hash=createHash('sha256');
  await pipeline(Readable.fromWeb(response.body),new Transform({transform(bytes,_encoding,done){size+=bytes.length;if(size>job.bytes)return done(Error('size_limit'));hash.update(bytes);done(null,bytes);}}),createWriteStream(file,{flags:'wx',mode:0o600}),{signal});
  if(size!==job.bytes||hash.digest('hex')!==job.sha256)throw Error('source_changed');
}
export async function extractPoster(input,dir,signal,filterId){
  if(!['none','fade'].includes(filterId))throw Error('unsupported_recipe');
  const source=await probe(input,{signal,cwd:dir});
  if(source.width>1920||source.height>1920||source.duration>601)throw Error('unsupported_source');
  const output=path.join(dir,'poster.jpg');
  for(const size of [640,384,256]){
    const width=Math.max(2,2*Math.floor(source.width*Math.min(1,size/Math.max(source.width,source.height))/2));
    const height=Math.max(2,2*Math.floor(source.height*Math.min(1,size/Math.max(source.width,source.height))/2));
    await command(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file','-f','mov','-ss',String(Math.min(0.1,Math.max(0,source.duration-0.05))),'-threads','1','-i',input,'-map','0:v:0','-frames:v','1','-an','-sn','-dn','-map_metadata','-1','-vf',`scale=${width}:${height},setsar=1${filterId==='fade'?',eq=contrast=0.9:saturation=0.85':''}`,'-fflags','+bitexact','-flags:v','+bitexact','-c:v','mjpeg','-threads','1','-q:v','7','-f','image2','-update','1',output],{signal,cwd:dir,maxOutput:65536});
    const {size:bytes}=await stat(output);if(bytes>MAX_JPEG)continue;
    const jpeg=await readFile(output);if(jpeg.length<64||jpeg.readUInt16BE()!==0xffd8||jpeg.readUInt16BE(jpeg.length-2)!==0xffd9)throw Error('invalid_poster');
    const info=JSON.parse(await command(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-protocol_whitelist','file','-select_streams','v:0','-show_entries','stream=codec_name,width,height','-of','json',output],{signal,cwd:dir,maxOutput:8192})).streams?.[0];
    if(info?.codec_name!=='mjpeg'||info.width!==width||info.height!==height)throw Error('invalid_poster');
    return {jpeg,width,height};
  }
  throw Error('poster_budget');
}
export function createPosterWorker(api,{tempRoot=os.tmpdir(),encode=extractPoster}={}){
  let active=false;
  return async parent=>{
    if(active)return {state:'busy'};
    if(!api?.claimPoster||!api.finishPoster||!api.fetch||!api.base)return {state:'unavailable'};
    active=true;let dir;const timeout=AbortSignal.timeout(85000),signal=parent?AbortSignal.any([timeout,parent]):timeout;
    try{
      const job=await api.claimPoster(signal);if(job===null)return {state:'idle'};
      dir=await mkdtemp(path.join(tempRoot,'pc-poster-'));const input=path.join(dir,'source.mp4');
      await download(api,job,input,signal);
      const {jpeg,width,height}=await encode(input,dir,signal,job.filter_id);
      if(signal.aborted||!Buffer.isBuffer(jpeg)||jpeg.length<64||jpeg.length>MAX_JPEG||![width,height].every(n=>Number.isInteger(n)&&n>=2&&n<=640))throw Error('invalid_poster');
      const ready=await api.finishPoster({p_lease:job.lease,p_media:job.media_id,p_jpeg:jpeg.toString('base64'),p_sha256:createHash('sha256').update(jpeg).digest('hex')},signal);
      return ready===true?{state:'ready',bytes:jpeg.length,width,height}:{state:'rejected'};
    }catch{return {state:'unavailable'};}
    finally{try{if(dir)await rm(dir,{force:true,recursive:true});}finally{active=false;}}
  };
}
