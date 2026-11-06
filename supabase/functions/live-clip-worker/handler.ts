import {validUuid,validPlaybackPath,safeHttpsOrigin,sha256} from '../live-core/provider.ts';
import {readBoundedJson,bodyErrorStatus} from './body.ts';
type Rpc={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:any;error:unknown}>};
type Deps={service:Rpc;secret:string;cdnOrigin:string;signerUrl:string;signerSecret:string;fetch:typeof fetch;
 signUpload(path:string):Promise<string|null>;remove(paths:string[]):Promise<boolean>;now?:()=>number};
const headers={'Content-Type':'application/json','Cache-Control':'private, no-store'};
const assetNames=new Set(['horizontal.mp4','vertical.mp4','thumbnail.jpg','captions.vtt']);
const expectedMime:Record<string,string>={'horizontal.mp4':'video/mp4','vertical.mp4':'video/mp4','thumbnail.jpg':'image/jpeg','captions.vtt':'text/vtt'};
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const proof=(b:any)=>({p_id:b.id,p_lease_id:b.lease_id});
async function rpc(deps:Deps,name:string,args:Record<string,unknown>={}){const r=await deps.service.rpc(name,args);if(r.error||!object(r.data))throw Error('CLIP_WORKER_UNAVAILABLE');return r.data;}
function validJob(job:any){return object(job)&&['id','lease_id','clip_id','session_id','owner_id'].every(k=>validUuid(job[k]))
 &&job.output_prefix===`${job.owner_id}/${job.session_id}/${job.clip_id}/${job.lease_id}/`&&validPlaybackPath(job.source_path,job.session_id);}
export function createClipWorkerHandler(deps:Deps){return async(request:Request)=>{
 const json=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers});
 if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
 try{
  const authorization=request.headers.get('Authorization')||'';
  if(!/^Bearer\s+/i.test(authorization))return json(401,{error:'AUTH_REQUIRED'});
  const supplied=authorization.replace(/^Bearer\s+/i,'');
  if(deps.secret.length<32||supplied.length>512||await sha256(supplied)!==await sha256(deps.secret))return json(401,{error:'AUTH_REQUIRED'});
  let body:any;try{body=await readBoundedJson(request,300000,request.signal);}catch(error){const status=bodyErrorStatus(error);return json(status,{error:status===413?'REQUEST_TOO_LARGE':status===408?'REQUEST_TIMED_OUT':'INVALID_REQUEST'});}
  if(!object(body)||typeof body.action!=='string')return json(400,{error:'INVALID_REQUEST'});
  if(body.action==='claim'){
   const result=await rpc(deps,'live_claim_clip_jobs',{p_limit:1});
   if(!Array.isArray(result.items)||result.items.length>1||result.items.some((j:any)=>!validJob(j)))throw Error('INVALID_JOB');
   return json(200,{data:result});
  }
  if(body.action==='maintain'){
   const published=await rpc(deps,'live_process_clip_publications',{p_limit:20});
   const cleanup=await rpc(deps,'live_claim_clip_cleanup',{p_limit:4});let removed=0;
   if(!Array.isArray(cleanup.items)||cleanup.items.length>4)throw Error('INVALID_CLEANUP');
   for(const item of cleanup.items){
    if(!validUuid(item.id)||!validUuid(item.lease_id)||item.bucket!=='live-clips'||typeof item.object_path!=='string'
     ||item.object_path.split('/').length!==5||!item.object_path.split('/').slice(0,4).every(validUuid)||!assetNames.has(item.object_path.split('/')[4]))throw Error('INVALID_CLEANUP');
    let ok=false;try{ok=await deps.remove([item.object_path]);}catch{}
    const finished=await rpc(deps,'live_finish_clip_cleanup',{p_id:item.id,p_lease_id:item.lease_id,p_ok:ok,p_error:ok?null:'storage_unavailable'});if(ok&&finished.ok===true)removed++;
   }
   return json(200,{data:{published,removed}});
  }
  if(!validUuid(body.id)||!validUuid(body.lease_id))return json(400,{error:'INVALID_JOB'});
  if(body.action==='finish'){
   if(typeof body.ok!=='boolean'||(body.ok&&!object(body.manifest))||(!body.ok&&typeof body.error!=='string'))return json(400,{error:'INVALID_FINISH'});
   const result=await rpc(deps,'live_finish_clip_job',{...proof(body),p_ok:body.ok,p_manifest:body.ok?body.manifest:null,p_error:body.ok?null:String(body.error).replace(/[^a-z0-9_]/g,'').slice(0,80)});
   return json(200,{data:result});
  }
  if(!['check','source','upload'].includes(body.action))return json(400,{error:'INVALID_ACTION'});
  const checked=await rpc(deps,'live_check_clip_job',proof(body));
  if(checked.ok!==true||!validJob(checked.job))return json(409,{error:'CLIP_LEASE_LOST'});
  const job=checked.job;if(job.id!==body.id||job.lease_id!==body.lease_id)return json(409,{error:'CLIP_LEASE_LOST'});
  if(body.action==='check')return json(200,{data:{ok:true}});
  if(body.action==='source'){
   const origin=safeHttpsOrigin(deps.cdnOrigin),signer=new URL(deps.signerUrl);
   if(!origin||signer.protocol!=='https:'||signer.username||signer.password||!deps.signerSecret)return json(503,{error:'CLIP_SOURCE_NOT_READY'});
   const now=deps.now?.()??Date.now(),expiresAt=new Date(now+120000).toISOString();
   const response=await deps.fetch(signer,{method:'POST',headers:{Authorization:`Bearer ${deps.signerSecret}`,'Content-Type':'application/json'},
    body:JSON.stringify({path:job.source_path,sessionId:job.session_id,userId:job.owner_id,expiresAt}),redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)])});
   if(!response.ok){await response.body?.cancel();throw Error('CLIP_SOURCE_NOT_READY');}const signed=await readBoundedJson(response,16384,request.signal);const url=new URL(signed.url);
   if(url.origin!==origin||!url.pathname.startsWith('/_live/')||!url.pathname.endsWith('/'+job.source_path)||url.username||url.password||url.hash||!(Date.parse(signed.expiresAt)>now&&Date.parse(signed.expiresAt)<=now+120000))throw Error('INVALID_SOURCE_GRANT');
   const current=await rpc(deps,'live_check_clip_job',proof(body));if(current.ok!==true||!validJob(current.job)||current.job.id!==job.id||current.job.lease_id!==job.lease_id||current.source_path!==job.source_path)return json(409,{error:'CLIP_LEASE_LOST'});
   return json(200,{data:{url:url.href,expires_at:signed.expiresAt}});
  }
  const a=body.asset;
  if(!object(a)||!assetNames.has(a.name)||a.content_type!==expectedMime[a.name]||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>536870912||!/^[a-f0-9]{64}$/.test(a.sha256))return json(400,{error:'INVALID_ASSET'});
  if(a.name.endsWith('.mp4')&&(!Array.isArray(job.formats)||!job.formats.includes(a.name.replace('.mp4',''))))return json(400,{error:'INVALID_ASSET'});
  const path=job.output_prefix+a.name,url=await deps.signUpload(path);if(!url)throw Error('CLIP_UPLOAD_UNAVAILABLE');
  const current=await rpc(deps,'live_check_clip_job',proof(body));
  if(current.ok!==true||!validJob(current.job)||current.job.id!==job.id||current.job.lease_id!==job.lease_id||current.job.output_prefix!==job.output_prefix)return json(409,{error:'CLIP_LEASE_LOST'});
  return json(200,{data:{url,bucket:'live-clips',path,bytes:a.bytes,content_type:a.content_type,
   metadata:{live_clip_id:job.clip_id,live_clip_job_id:job.id,live_clip_lease_id:job.lease_id,sha256:a.sha256}}});
 }catch{return json(503,{error:'CLIP_WORKER_UNAVAILABLE'});}
};}
