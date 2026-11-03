import {Vault,Platform,isPlatform,isUuid,record,digest,randomSecret,seal,unseal,boundedJson,fail,safeFailure,IntegrationFailure,errors} from './security.ts';
import {ProviderConfig,Fetcher,Tokens,validTokens,refresh,providerJson,configured} from './providers.ts';
import type {Rpc,ConnectDependencies} from './connect.ts';
type Dependencies={base:string;secret:string;pullOrigin?:string;config:ProviderConfig;vault:Vault;rpc:Rpc;fetch:Fetcher;sign(path:string,ttl:number):Promise<string|null>};
export function verifiedPullOrigin(config:ProviderConfig,pullOrigin?:string){
 try{const value=new URL(pullOrigin||''),redirect=new URL(config.redirectUri);if(value.protocol==='https:'&&!value.port&&!value.username&&!value.password&&!value.search&&!value.hash&&value.pathname==='/'&&value.origin===redirect.origin)return value.origin;}catch{}
 return null;
}
async function rpc(deps:{rpc:Rpc},name:string,args:Record<string,unknown>):Promise<Record<string,any>>{
 const r=await deps.rpc(name,args);if(r.error){if(record(r.error)&&typeof r.error.message==='string'&&errors.includes(r.error.message as any))throw new IntegrationFailure(r.error.message as any);fail('DATABASE_UNAVAILABLE');}if(!record(r.data))fail('DATABASE_UNAVAILABLE');if(typeof r.data.error==='string')throw safeFailure(new IntegrationFailure(r.data.error as any));return r.data;
}
export async function socialCredentials(deps:Pick<Dependencies,'rpc'|'vault'|'config'|'fetch'>,actor:string,sid:string,platform:Platform,signal:AbortSignal){
 if(!configured(deps.config,platform))fail('INTEGRATION_NOT_CONFIGURED');
 const row=await rpc(deps,'live_social_credentials',{p_actor:actor,p_session:sid,p_platform:platform});
 if(!isUuid(row.id)||typeof row.ciphertext!=='string'||typeof row.account_id!=='string')fail('PROVIDER_RESPONSE_INVALID');
 const context=`connection:${actor}:${row.id}:${platform}`;let tokens=await unseal(deps.vault,context,row.ciphertext);if(!validTokens(tokens)||tokens.accountId!==row.account_id)fail('INVALID_CIPHERTEXT');
 if(tokens.expiresAt<Date.now()+120000){
  const lease=await rpc(deps,'live_oauth_operation',{p_actor:actor,p_session:sid,p_action:'refresh_claim',p_data:{platform}});
  if(lease.id!==row.id||!isUuid(lease.lease_id)||typeof lease.ciphertext!=='string')fail('PROVIDER_RESPONSE_INVALID');
  try{
   const old=await unseal(deps.vault,context,lease.ciphertext);if(!validTokens(old)||old.accountId!==row.account_id)fail('INVALID_CIPHERTEXT');
   tokens=await refresh(deps.config,platform,old,deps.fetch,signal);
   await rpc(deps,'live_oauth_operation',{p_actor:actor,p_session:sid,p_action:'refresh_finish',p_data:{platform,id:row.id,lease_id:lease.lease_id,version:lease.version,ciphertext:await seal(deps.vault,context,tokens),expires_at:new Date((tokens as Tokens).expiresAt).toISOString()}});
  }catch(error){await rpc(deps,'live_oauth_operation',{p_actor:actor,p_session:sid,p_action:'refresh_failed',p_data:{platform,id:row.id,lease_id:lease.lease_id}}).catch(()=>{});throw error;}
 }
 return{access_token:(tokens as Tokens).accessToken,account_id:row.account_id,account_name:row.account_name,connection_id:row.id};
}
export async function creatorOptions(deps:Pick<Dependencies,'rpc'|'vault'|'config'|'fetch'|'pullOrigin'>,actor:string,sid:string,platform:Platform,signal:AbortSignal){
 if(platform==='tiktok'&&!verifiedPullOrigin(deps.config,deps.pullOrigin))fail('INTEGRATION_NOT_CONFIGURED');
 const grant=await socialCredentials(deps,actor,sid,platform,signal);
 if(platform!=='tiktok')return{platform,account_name:grant.account_name,can_publish:true};
 const result=await providerJson(deps.fetch,'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',{method:'POST',headers:{Authorization:'Bearer '+grant.access_token,'Content-Type':'application/json'},body:'{}'},signal),data=record(result.data)?result.data:{};
 if(!Array.isArray(data.privacy_level_options)||typeof data.max_video_post_duration_sec!=='number')fail('PROVIDER_RESPONSE_INVALID');
 return{platform,account_name:String(data.creator_nickname||grant.account_name).slice(0,160),creator_username:String(data.creator_username||'').slice(0,100),can_publish:true,
  privacy_options:data.privacy_level_options.filter(p=>['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY'].includes(String(p))),max_duration_seconds:Math.min(600,data.max_video_post_duration_sec),
  comment_disabled:data.comment_disabled===true,duet_disabled:data.duet_disabled===true,stitch_disabled:data.stitch_disabled===true};
}
export function createSocialOptionsHandler(deps:ConnectDependencies&{pullOrigin?:string}){return async(request:Request)=>{
 const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const json=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
 try{
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(25000)]),caller=deps.caller(request),auth=await caller.auth.getUser();
  if(auth.error||!auth.data.user||auth.data.user.is_anonymous)fail('AUTH_REQUIRED');
  const context=await caller.rpc('live_integration_context',{});
  if(context.error||!record(context.data)||context.data.user_id!==auth.data.user.id||!isUuid(context.data.auth_session_id))fail('AUTH_REQUIRED');
  const body=await boundedJson(request,2000,signal);
  if(!record(body)||body.action!=='options'||!isPlatform(body.platform)||Object.keys(body).some(k=>!['action','platform'].includes(k)))fail('INVALID_REQUEST');
  return json(200,await creatorOptions(deps,auth.data.user.id,context.data.auth_session_id,body.platform,signal));
 }catch(error){const failure=safeFailure(error);return json(failure.code==='AUTH_REQUIRED'?401:failure.code==='INVALID_REQUEST'?400:503,{error:failure.code});}
};}
export function externalPublicationUrl(platform:Platform,id:string,value?:unknown):string|null{
 if(!/^[a-zA-Z0-9_:.~-]{1,160}$/.test(id))fail('PROVIDER_RESPONSE_INVALID');
 if(platform==='x'){if(!/^\d{1,30}$/.test(id))fail('PROVIDER_RESPONSE_INVALID');return'https://x.com/i/status/'+id;}
 if(platform==='youtube'){if(!/^[a-zA-Z0-9_-]{11}$/.test(id))fail('PROVIDER_RESPONSE_INVALID');return'https://www.youtube.com/watch?v='+id;}
 if(platform==='facebook'){if(!/^\d{1,40}$/.test(id))fail('PROVIDER_RESPONSE_INVALID');return'https://www.facebook.com/reel/'+id;}
 if(value===undefined||value===null)return null;if(typeof value!=='string'||value.length>2048)fail('PROVIDER_RESPONSE_INVALID');
 const url=new URL(value);if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||url.search)fail('PROVIDER_RESPONSE_INVALID');
 if(platform==='instagram'&&url.hostname==='www.instagram.com'&&/^\/(reel|p)\/[a-zA-Z0-9_-]+\/$/.test(url.pathname))return url.href;
 if(platform==='tiktok'&&url.hostname==='www.tiktok.com'&&/^\/@[a-zA-Z0-9_.-]+\/video\/\d+$/.test(url.pathname))return url.href;
 fail('PROVIDER_RESPONSE_INVALID');
}
export function createSocialWorkerHandler(deps:Dependencies){return async(request:Request)=>{
 const json=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
 if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
 try{
  const auth=request.headers.get('Authorization')||'';if(deps.secret.length<32||!/^Bearer [A-Za-z0-9_-]{32,200}$/.test(auth)||await digest(auth)!==await digest('Bearer '+deps.secret))return json(401,{error:'AUTH_REQUIRED'});
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(25000)]),body=await boundedJson(request,100000,signal);
  if(!record(body)||!['claim','grant','check','checkpoint','defer','finish','fail'].includes(String(body.action))||Object.keys(body).some(k=>!['action','id','lease_id','phase','progress','after_seconds','provider_id','external_url','error'].includes(k)))fail('INVALID_REQUEST');
  const call=(action:string,payload:unknown={})=>rpc(deps,'live_social_worker',{p_action:action,p_id:body.id||null,p_lease_id:body.lease_id||null,p_payload:payload});
  if(body.action==='claim')return json(200,{data:await call('claim')});
  if(!isUuid(body.id)||!isUuid(body.lease_id))fail('INVALID_REQUEST');
  if(body.action==='finish'){
   const receipt=await call('receipt');if(receipt.ok!==true||!isPlatform(receipt.platform)||typeof body.provider_id!=='string')fail('ACCESS_DENIED');
   return json(200,{data:await call('finish',{provider_id:body.provider_id,external_url:externalPublicationUrl(receipt.platform,body.provider_id,body.external_url)})});
  }
  const job=await call('check');if(job.ok!==true||!isPlatform(job.platform)||!isUuid(job.actor_id)||!isUuid(job.auth_session_id))fail('ACCESS_DENIED');
  if(body.action==='check')return json(200,{data:{ok:true,phase:job.phase}});
  if(body.action==='checkpoint'){
   if(typeof body.phase!=='string'||!record(body.progress))fail('INVALID_REQUEST');
   const ciphertext=await seal(deps.vault,`publish:${job.actor_id}:${body.id}:${job.platform}`,body.progress);
   return json(200,{data:await call('checkpoint',{phase:body.phase,ciphertext})});
  }
  if(body.action==='defer')return json(200,{data:await call('defer',{after_seconds:typeof body.after_seconds==='number'?Math.max(15,Math.min(3600,Math.round(body.after_seconds))):30})});
  if(body.action==='fail')return json(200,{data:await call('fail',{error:body.error})});
  const credentials=await socialCredentials(deps,job.actor_id,job.auth_session_id,job.platform,signal);
  if(credentials.account_id!==job.account_id||credentials.connection_id!==job.connection_id)fail('ACCESS_DENIED');
  if(typeof job.object_path!=='string'||!isUuid(job.clip_id))fail('PROVIDER_RESPONSE_INVALID');const parts=job.object_path.split('/');
  if(parts.length!==5||!parts.slice(0,4).every(isUuid)||parts[2]!==job.clip_id||!['horizontal.mp4','vertical.mp4'].includes(parts[4]))fail('PROVIDER_RESPONSE_INVALID');
  let url:URL,pullExpiresAt:string|null=null,mediaBytes:number|null=null,pullOrigin:string|null=null;
  if(job.platform==='tiktok'){
   pullOrigin=verifiedPullOrigin(deps.config,deps.pullOrigin);if(!pullOrigin)fail('INTEGRATION_NOT_CONFIGURED');
   const token=await digest(randomSecret()),context=`publish:${job.actor_id}:${body.id}:tiktok`;
   const grant=await call('pull_grant',{token_hash:await digest(token),ciphertext:await seal(deps.vault,context,{purpose:'social_pull',token})});
   if(typeof grant.ciphertext!=='string'||typeof grant.token_hash!=='string'||typeof grant.expires_at!=='string'||typeof grant.bytes!=='number'||grant.bytes<1||grant.bytes>134217728)fail('PROVIDER_RESPONSE_INVALID');
   const existing=await unseal(deps.vault,context,grant.ciphertext);
   if(!record(existing)||existing.purpose!=='social_pull'||typeof existing.token!=='string'||!/^[a-f0-9]{64}$/.test(existing.token)||await digest(existing.token)!==grant.token_hash)fail('INVALID_CIPHERTEXT');
   url=new URL(`${pullOrigin}/api/live/social-pull/${body.id}/clip.mp4`);url.searchParams.set('token',existing.token);pullExpiresAt=grant.expires_at;mediaBytes=grant.bytes;
  }else{
   const signed=await deps.sign(job.object_path,600);if(!signed)fail('PROVIDER_UNAVAILABLE');url=new URL(signed);
   if(url.origin!==new URL(deps.base).origin||url.pathname!==`/storage/v1/object/sign/live-clips/${job.object_path}`||!url.searchParams.get('token')||url.hash||url.username||url.password)fail('PROVIDER_RESPONSE_INVALID');
  }
  const progress=job.progress_ciphertext?await unseal(deps.vault,`publish:${job.actor_id}:${body.id}:${job.platform}`,job.progress_ciphertext):{};
  if(!record(progress))fail('INVALID_CIPHERTEXT');const checked=await call('check');if(checked.ok!==true||checked.object_path!==job.object_path)fail('ACCESS_DENIED');
  return json(200,{data:{id:body.id,clip_id:job.clip_id,platform:job.platform,account_id:job.account_id,access_token:credentials.access_token,consent:job.consent,phase:job.phase,progress,reconcile_only:job.reconcile_only,
   source_url:url.href,pull_origin:pullOrigin,source_expires_at:pullExpiresAt,media_bytes:mediaBytes,duration_ms:job.duration_ms,cover_ms:job.cover_ms,meta_version:deps.config.metaVersion||null}});
 }catch(error){const failure=safeFailure(error);return json(failure.code==='INVALID_REQUEST'?400:failure.code==='ACCESS_DENIED'?409:503,{error:failure.code});}
};}
