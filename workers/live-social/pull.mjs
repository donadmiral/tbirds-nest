import {mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {publishStep,PublishFailure,allowedProviderRequest} from './adapters.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const codes=new Set(['PROVIDER_REJECTED','PROVIDER_RATE_LIMITED','PROVIDER_UNAVAILABLE','PROVIDER_RESPONSE_INVALID','RECONNECT_REQUIRED','UNSUPPORTED_FORMAT','PUBLICATION_CONFIRMATION_REQUIRED','MEDIA_TOO_LARGE']);
async function readJson(response,max=100000){
 if(Number(response.headers.get('content-length')||0)>max)throw new PublishFailure('PROVIDER_RESPONSE_INVALID');const reader=response.body?.getReader();if(!reader)throw new PublishFailure('PROVIDER_RESPONSE_INVALID');const chunks=[];let bytes=0;
 try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>max){await reader.cancel();throw new PublishFailure('PROVIDER_RESPONSE_INVALID');}chunks.push(r.value);}}finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new PublishFailure('PROVIDER_RESPONSE_INVALID');}
}
export function configuration(env=process.env){
 const base=new URL(env.LIVE_SOCIAL_PROJECT_ORIGIN||'');if(base.protocol!=='https:'||!/^[a-z0-9]{20}\.supabase\.co$/.test(base.hostname)||base.port||base.pathname!=='/'||base.search||base.hash||base.username||base.password)throw Error('INVALID_CONFIGURATION');
 const secret=env.LIVE_SOCIAL_WORKER_SECRET;if(!/^[a-zA-Z0-9_-]{32,200}$/.test(secret||''))throw Error('INVALID_CONFIGURATION');
 return{origin:base.origin,secret,maxBytes:512*1024*1024};
}
const boundedSignal=(parent,timeout)=>AbortSignal.any([AbortSignal.timeout(timeout),...(parent?[parent]:[])]);
export function broker(config,fetcher=fetch,signal){return async(action,fields={})=>{
 let response;try{response=await fetcher(config.origin+'/functions/v1/live-social-worker',{method:'POST',redirect:'error',signal:boundedSignal(signal,30000),headers:{Authorization:'Bearer '+config.secret,'Content-Type':'application/json'},body:JSON.stringify({action,...fields})});}catch{throw new PublishFailure('PROVIDER_UNAVAILABLE');}
 const result=await readJson(response);if(!response.ok||!record(result)||!record(result.data)||result.data.ok===false)throw new PublishFailure(codes.has(result?.error)?result.error:'PROVIDER_UNAVAILABLE');return result.data;
};}
export async function privateMedia(config,job,fetcher=fetch,signal){
 const url=new URL(job.source_url);
 if(url.origin!==config.origin||!url.pathname.startsWith('/storage/v1/object/sign/live-clips/')||url.hash||url.username||url.password||!url.searchParams.get('token'))throw new PublishFailure('PROVIDER_RESPONSE_INVALID');
 const suffix=url.pathname.slice('/storage/v1/object/sign/live-clips/'.length).split('/');if(suffix.length!==5||!suffix.slice(0,4).every(uuid)||suffix[2]!==job.clip_id||!['horizontal.mp4','vertical.mp4'].includes(suffix[4]))throw new PublishFailure('PROVIDER_RESPONSE_INVALID');
 const directory=await mkdtemp(join(tmpdir(),'pc-social-'));let handle;
 try{
  const response=await fetcher(url,{redirect:'error',signal:boundedSignal(signal,60000)});if(!response.ok||!response.body){void response.body?.cancel().catch(()=>{});throw new PublishFailure('PROVIDER_UNAVAILABLE');}if(Number(response.headers.get('content-length')||0)>config.maxBytes){await response.body.cancel();throw new PublishFailure('MEDIA_TOO_LARGE');}
  handle=await open(join(directory,'clip.mp4'),'wx+',0o600);const reader=response.body.getReader();let size=0;
  try{for(;;){const r=await reader.read();if(r.done)break;if(size+r.value.byteLength>config.maxBytes){await reader.cancel();throw new PublishFailure('MEDIA_TOO_LARGE');}let written=0;while(written<r.value.length){const output=await handle.write(r.value,written,r.value.length-written,size+written);if(!output.bytesWritten)throw new PublishFailure('PROVIDER_UNAVAILABLE');written+=output.bytesWritten;}size+=r.value.byteLength;}}finally{reader.releaseLock();}
  if(size<1)throw new PublishFailure('PROVIDER_RESPONSE_INVALID');
  return{size,async read(start,length){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<1||length>64*1024*1024+10*1024*1024||start+length>size)throw new PublishFailure('PROVIDER_RESPONSE_INVALID');const buffer=Buffer.alloc(length);let offset=0;while(offset<length){const r=await handle.read(buffer,offset,length-offset,start+offset);if(!r.bytesRead)throw new PublishFailure('PROVIDER_RESPONSE_INVALID');offset+=r.bytesRead;}return buffer;},async close(){await handle.close();await rm(directory,{recursive:true,force:true});}};
 }catch(error){await handle?.close().catch(()=>{});await rm(directory,{recursive:true,force:true});throw error;}
}
export async function runOnce(config,{fetcher=fetch,call,media,signal:parentSignal}={}){
 const signal=boundedSignal(parentSignal,110000),customCall=call;
 call??=broker(config,fetcher,signal);media??=job=>privateMedia(config,job,fetcher,signal);
 // Record a known receipt or conservative failure with an independent 5s budget
 // when shutdown/deadline has already stopped external provider work.
 const complete=(action,fields)=>customCall?customCall(action,fields):broker(config,fetcher,AbortSignal.timeout(5000))(action,fields);
 const claimed=await call('claim');if(!Array.isArray(claimed.items)||claimed.items.length>1)throw new PublishFailure('PROVIDER_RESPONSE_INVALID');if(!claimed.items.length)return{state:'idle'};
 const ticket=claimed.items[0];if(!record(ticket)||!uuid(ticket.id)||!uuid(ticket.lease_id))throw new PublishFailure('PROVIDER_RESPONSE_INVALID');const fields={id:ticket.id,lease_id:ticket.lease_id};let opened,phase='initial';
 try{
  const job=await call('grant',fields);if(job.id!==ticket.id||!uuid(job.clip_id))throw new PublishFailure('PROVIDER_RESPONSE_INVALID');phase=job.phase;
  const result=await publishStep(job,{async checkpoint(next,progress){await call('checkpoint',{...fields,phase:next,progress});phase=next;},check:()=>call('check',fields),async media(){if(!opened)opened=await media(job);return opened;},async request(url,init){allowedProviderRequest(url);return fetcher(url,{...init,redirect:'error',signal:boundedSignal(signal,45000)});}});
  if(result.state==='published'){await complete('finish',{...fields,provider_id:result.provider_id,external_url:result.external_url});return{state:'published',id:ticket.id};}
  await complete('defer',{...fields,after_seconds:result.after_seconds});return{state:'deferred',id:ticket.id};
 }catch(error){const code=codes.has(error?.code)?error.code:'PROVIDER_UNAVAILABLE';
  // Poll/read failures can retry with backoff. Creating/finalizing remains fenced.
  if(['PROVIDER_RATE_LIMITED','PROVIDER_UNAVAILABLE'].includes(code)&&['processing','prepared'].includes(phase)){await complete('defer',{...fields,after_seconds:error.after||60}).catch(()=>{});return{state:'deferred',id:ticket.id,error:code};}
  await complete('fail',{...fields,error:code}).catch(()=>{});return{state:'failed',id:ticket.id,error:code};
 }finally{await opened?.close().catch(()=>{});}
}
export function delayMs(result,failures,random=Math.random){
 if(result.error==='PROVIDER_UNAVAILABLE'||result.error==='PROVIDER_RATE_LIMITED')return Math.min(300000,15000*2**Math.min(5,Math.max(0,failures-1)))+Math.floor(random()*5000);
 return result.state==='idle'?60000+Math.floor(random()*5000):1000;
}
export function pause(ms,signal){return new Promise(resolve=>{if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});}
export async function main(){
 let config;try{config=configuration();}catch{console.error(JSON.stringify({service:'live-social',error:'INVALID_CONFIGURATION'}));process.exitCode=1;return;}
 const shutdown=new AbortController();process.once('SIGTERM',()=>shutdown.abort());process.once('SIGINT',()=>shutdown.abort());let failures=0;
 while(!shutdown.signal.aborted){let result;try{result=await runOnce(config,{signal:shutdown.signal});}catch{result={state:'failed',error:'PROVIDER_UNAVAILABLE'};}
  console.log(JSON.stringify({service:'live-social',...result}));
  await writeFile(join(tmpdir(),'pc-social-health.json'),JSON.stringify({at:Date.now()}),{mode:0o600}).catch(()=>{});
  failures=result.error==='PROVIDER_UNAVAILABLE'||result.error==='PROVIDER_RATE_LIMITED'?failures+1:0;
  if(!shutdown.signal.aborted)await pause(delayMs(result,failures),shutdown.signal);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
