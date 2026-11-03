import {isUuid,record,digest,boundedJson,fail,safeFailure} from '../live-integrations-core/security.ts';
import {parseTranscribeResult} from '../live-integrations-core/transcription.ts';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:unknown}>;
type Dependencies={secret:string;peekSecret?:string;base:string;rpc:Rpc;sign(path:string,ttl:number):Promise<string|null>};
const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export function createTranscriptionWorkerHandler(deps:Dependencies){return async(request:Request)=>{
 const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
 try{
  const authorization=request.headers.get('Authorization')||'';
  if(!/^Bearer [A-Za-z0-9_-]{32,200}$/.test(authorization))return json(401,{error:'AUTH_REQUIRED'});
  const supplied=await digest(authorization),workerAuthorized=deps.secret.length>=32&&supplied===await digest('Bearer '+deps.secret);
  const peekAuthorized=typeof deps.peekSecret==='string'&&deps.peekSecret.length>=32&&deps.peekSecret!==deps.secret&&supplied===await digest('Bearer '+deps.peekSecret);
  if(!workerAuthorized&&!peekAuthorized)return json(401,{error:'AUTH_REQUIRED'});
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(20000)]),body=await boundedJson(request,peekAuthorized?512:2500000,signal);
  if(peekAuthorized){
   if(!record(body)||body.action!=='peek'||Object.keys(body).length!==1)return json(403,{error:'ACTION_DENIED'});
   const response=await deps.rpc('live_transcription_worker',{p_action:'peek',p_id:null,p_lease_id:null,p_payload:{}});
   const data=response.data;
   if(response.error||!record(data)||typeof data.enabled!=='boolean'||typeof data.due!=='boolean'||typeof data.active!=='number'||!Number.isInteger(data.active)||data.active<0||data.active>2)fail('DATABASE_UNAVAILABLE');
   return json(200,{enabled:data.enabled,due:data.due,active:data.active});
  }
  if(!record(body)||!['claim','check','source','submit','settle','cleanup_defer','defer','finish','fail'].includes(String(body.action))||Object.keys(body).some(k=>!['action','id','lease_id','result','error','configuration_hash','provider_status'].includes(k)))fail('INVALID_REQUEST');
  const call=async(action:string,payload:unknown={})=>{
   const response=await deps.rpc('live_transcription_worker',{p_action:action,p_id:body.id||null,p_lease_id:body.lease_id||null,p_payload:payload});
   if(response.error||!record(response.data))fail('DATABASE_UNAVAILABLE');return response.data;
  };
  if(body.action==='claim')return json(200,{data:await call('claim')});
  if(!isUuid(body.id)||!isUuid(body.lease_id))fail('INVALID_REQUEST');
  if(body.action==='cleanup_defer')return json(200,{data:await call('cleanup_defer')});
  if(body.action==='settle'){
   if(!['COMPLETED','FAILED','NOT_FOUND','NOT_SUBMITTED'].includes(String(body.provider_status)))fail('INVALID_REQUEST');
   return json(200,{data:await call('settle',{provider_status:body.provider_status})});
  }
  const checked=await call('check');if(checked.ok!==true)return json(409,{error:checked.error==='INTEGRATION_DISABLED'?'INTEGRATION_DISABLED':'CLIP_CHANGED'});
  if(body.action==='check')return json(200,{data:{ok:true,id:checked.id,clip_id:checked.clip_id,duration_ms:checked.duration_ms,language:checked.language,job_name:checked.job_name}});
  if(body.action==='submit'){
   if(typeof body.configuration_hash!=='string'||!/^[a-f0-9]{64}$/.test(body.configuration_hash))fail('INVALID_REQUEST');
   return json(200,{data:await call('submit',{configuration_hash:body.configuration_hash})});
  }
  if(body.action==='defer')return json(200,{data:await call('defer')});
  if(body.action==='fail'){
   if(!['TRANSCRIPTION_FAILED','PROVIDER_UNAVAILABLE','MEDIA_TOO_LARGE','PROVIDER_RESPONSE_INVALID'].includes(String(body.error)))fail('INVALID_REQUEST');
   return json(200,{data:await call('fail',{error:body.error})});
  }
  if(body.action==='finish'){
   if(typeof checked.duration_ms!=='number'||typeof checked.job_name!=='string')fail('PROVIDER_RESPONSE_INVALID');
   const draft=parseTranscribeResult(body.result,checked.duration_ms,checked.job_name);
   return json(200,{data:await call('finish',draft)});
  }
  if(typeof checked.object_path!=='string'||checked.bucket!=='live-clips'||!isUuid(checked.clip_id))fail('PROVIDER_RESPONSE_INVALID');
  const parts=checked.object_path.split('/');if(parts.length!==5||!parts.slice(0,4).every(isUuid)||parts[2]!==checked.clip_id||!['horizontal.mp4','vertical.mp4'].includes(parts[4]))fail('PROVIDER_RESPONSE_INVALID');
  const signed=await deps.sign(checked.object_path,120);if(!signed)fail('PROVIDER_UNAVAILABLE');
  const url=new URL(signed);if(url.origin!==new URL(deps.base).origin||url.pathname!==`/storage/v1/object/sign/live-clips/${checked.object_path}`||!url.searchParams.get('token')||url.username||url.password||url.hash)fail('PROVIDER_RESPONSE_INVALID');
  const current=await call('check');if(current.ok!==true||current.object_path!==checked.object_path)return json(409,{error:'CLIP_CHANGED'});
  return json(200,{data:{url:url.href,expires_in:120,job_name:checked.job_name,duration_ms:checked.duration_ms,language:checked.language}});
 }catch(error){const code=safeFailure(error).code;return json(code==='INVALID_REQUEST'?400:code==='MEDIA_TOO_LARGE'?413:503,{error:code});}
};}
