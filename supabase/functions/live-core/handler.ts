import { buildLiveLayout, hlsEndpoints, liveEndpointName, liveOutputSize, roomHasEndpoint, safeHttpsOrigin, sha256, validPlaybackPath, validScene, validUuid, verifyDailyWebhook, type LiveProviderConfig, type ProviderContext, type Presence } from './provider.ts';
import { dailyCommandAccepted } from '../_shared/dailyCommandAcknowledgement.ts';
export { dailyCommandAccepted } from '../_shared/dailyCommandAcknowledgement.ts';
type RpcResult = { data: unknown; error: { message?: string } | null };
type Rpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult> };
type Caller = Rpc & { auth: { getUser(): PromiseLike<{ data: { user: { id: string; is_anonymous?: boolean } | null }; error: unknown }> } };
export type LiveDependencies = { caller(request: Request): Caller; service: Rpc; config: LiveProviderConfig; fetch: typeof fetch; removeCovers?: (paths: string[]) => Promise<{ error: unknown }>; now?: () => number; wait?: (ms:number,signal:AbortSignal) => Promise<void> };
type Mode = 'stage' | 'control' | 'playback' | 'webhook' | 'maintenance';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,x-client-info,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store' };
const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
async function boundedText(body: ReadableStream<Uint8Array> | null, max: number): Promise<string> {
  if (!body) return '';
  const reader=body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try { for (;;) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('REQUEST_TOO_LARGE');}chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return new TextDecoder().decode(bytes);
}
async function readJson(request: Request, max = 8192) {
  const length=Number(request.headers.get('content-length')||0);if(length>max)throw new Error('REQUEST_TOO_LARGE');
  const value:unknown=JSON.parse(await boundedText(request.body,max));if(!object(value))throw new Error('INVALID_REQUEST');return value;
}
async function rpc<T>(client: Rpc, name: string, args: Record<string, unknown>): Promise<T> {
  const result=await client.rpc(name,args);if(result.error)throw new Error(result.error.message||'LIVE_SERVICE_UNAVAILABLE');
  if(!object(result.data))throw new Error('INVALID_SERVICE_RESPONSE');return result.data as T;
}
async function identity(client: Caller, request: Request) {
  const {data,error}=await client.auth.getUser();if(error||!data.user||data.user.is_anonymous)throw new Error('AUTH_REQUIRED');
  const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  let claims:unknown;try { const raw=token.split('.')[1];claims=JSON.parse(atob(raw.replace(/-/g,'+').replace(/_/g,'/'))); }catch{throw new Error('AUTH_REQUIRED');}
  // getUser has independently verified this exact bearer token. The database
  // independently rechecks auth.sessions and actor ownership for every action.
  if(!object(claims)||claims.sub!==data.user.id||!validUuid(claims.session_id))throw new Error('AUTH_REQUIRED');
  return {userId:data.user.id,sessionId:claims.session_id};
}
function dailyHeaders(config:LiveProviderConfig){if(!config.dailyKey)throw new Error('PROVIDER_NOT_READY');return{Authorization:`Bearer ${config.dailyKey}`,'Content-Type':'application/json'};}
async function provider(deps:LiveDependencies,path:string,init:RequestInit,signal:AbortSignal){
  if(!path.startsWith('/rooms')&&!path.startsWith('/meeting-tokens'))throw new Error('INVALID_PROVIDER_PATH');
  const response=await deps.fetch(`https://api.daily.co/v1${path}`,{...init,headers:dailyHeaders(deps.config),signal,redirect:'error'});
  if(!response.ok)throw new Error(response.status===404?'PROVIDER_NOT_FOUND':`PROVIDER_REJECTED_${response.status}`);
  const data:unknown=JSON.parse(await boundedText(response.body,65536));if(!object(data))throw new Error('INVALID_PROVIDER_RESPONSE');return data;
}
function waitForPresence(ms:number,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new Error('STAGE_CONNECTION_CHANGED'));return;}
  const cancel=()=>{clearTimeout(timer);reject(new Error('STAGE_CONNECTION_CHANGED'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);
  signal.addEventListener('abort',cancel,{once:true});
 });
}
async function ensureRoom(deps:LiveDependencies,context:ProviderContext,signal:AbortSignal,now:number){
  if(!/^pc-live-[0-9a-f]{32}$/.test(context.room_name))throw new Error('INVALID_PROVIDER_ROOM');
  const endpoints=hlsEndpoints(deps.config,context);
  let room:Record<string,unknown>;
  try{room=await provider(deps,`/rooms/${context.room_name}`,{},signal);}
  catch(error){
    if(!(error instanceof Error)||error.message!=='PROVIDER_NOT_FOUND')throw error;
    try{room=await provider(deps,'/rooms',{method:'POST',body:JSON.stringify({name:context.room_name,privacy:'private',properties:{
      exp:Math.floor(now/1000)+21600,eject_at_room_exp:true,max_participants:context.max_stage_members,enable_screenshare:true,
      start_audio_off:true,start_video_off:true,streaming_endpoints:endpoints,
    }})},signal);}catch(error){
      if(!(error instanceof Error)||!['PROVIDER_REJECTED_400','PROVIDER_REJECTED_409'].includes(error.message))throw error;
      room=await provider(deps,`/rooms/${context.room_name}`,{},signal);
    }
  }
  if(room.privacy!=='private'||typeof room.url!=='string')throw new Error('INVALID_PROVIDER_ROOM');
  const u=new URL(room.url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!u.hostname.endsWith('.daily.co')||u.pathname!==`/${context.room_name}`)throw new Error('INVALID_PROVIDER_ROOM');
  // A running Daily call can retain its original endpoint ladder. Never promise
  // portrait by rewriting a landscape endpoint after participants have joined.
  if(!endpoints.every(endpoint=>roomHasEndpoint(room,endpoint))){
    const present=await provider(deps,`/rooms/${context.room_name}/presence?limit=1`,{},signal);
    if(!Array.isArray(present.data)||!Number.isSafeInteger(present.total_count)||Number(present.total_count)<0)throw new Error('INVALID_PROVIDER_RESPONSE');
    if(Number(present.total_count)>0){
      // Preserve established landscape broadcasts while old previews reconnect.
      if(context.output_orientation==='portrait'||!roomHasEndpoint(room,endpoints[0]))throw new Error('PROVIDER_ROOM_RECONNECT_REQUIRED');
    }else{
      room=await provider(deps,`/rooms/${context.room_name}`,{method:'POST',body:JSON.stringify({privacy:'private',properties:{max_participants:context.max_stage_members,streaming_endpoints:endpoints}})},signal);
      if(!endpoints.every(endpoint=>roomHasEndpoint(room,endpoint)))throw new Error('PROVIDER_ENDPOINT_READBACK_FAILED');
    }
  }
  if((room.config as {max_participants?:unknown}|undefined)?.max_participants!==context.max_stage_members){
    await provider(deps,`/rooms/${context.room_name}`,{method:'POST',body:JSON.stringify({privacy:'private',properties:{max_participants:context.max_stage_members}})},signal);
  }
  return u.href;
}
async function recheck(client:Caller,sessionId:string,purpose:'stage'|'playback'){
  return rpc<Record<string,unknown>>(client,'live_provider_access',{p_session_id:sessionId,p_purpose:purpose});
}
function errorResponse(error:unknown){
  const message=error instanceof Error?error.message:'';
  if(/AUTH_REQUIRED|ACTIVE_SESSION|JWT/.test(message))return json(401,{error:'AUTH_REQUIRED'});
  if(/ACCESS_DENIED|ADMIN_ACCESS|LIVE_NOT_AVAILABLE/.test(message))return json(403,{error:'LIVE_NOT_AVAILABLE'});
  if(/TOO_LARGE/.test(message))return json(413,{error:'REQUEST_TOO_LARGE'});
  if(message==='STAGE_CONNECTION_CHANGED')return json(409,{error:'STAGE_CONNECTION_CHANGED'});
  if(/INVALID_|SELECT_STAGE|SOURCE_NOT|SyntaxError/.test(message)||error instanceof SyntaxError)return json(400,{error:'INVALID_REQUEST'});
  if(/RATE_LIMIT|CAPACITY_REACHED/.test(message))return json(429,{error:'RATE_LIMIT'});
  if(/STATE_CONFLICT|CONTROL_IN_PROGRESS|IDEMPOTENCY/.test(message))return json(409,{error:'STATE_CONFLICT'});
  if(/NOT_READY|PROVIDER_ROOM_RECONNECT_REQUIRED|PROVIDER_ENDPOINT_READBACK_FAILED/.test(message))return json(503,{error:'PROVIDER_NOT_READY'});
  return json(503,{error:'LIVE_SERVICE_UNAVAILABLE'});
}
export function createLiveHandler(mode:Mode,deps:LiveDependencies){
 return async(request:Request):Promise<Response>=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers});
  if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  const now=deps.now?.()??Date.now();const signal=AbortSignal.any([request.signal,AbortSignal.timeout(mode==='maintenance'?25000:20000)]);
  try{
   if(mode==='webhook'){
    const event=await readJson(request,131072);
    if(!await verifyDailyWebhook(event,request.headers.get('X-Webhook-Timestamp'),request.headers.get('X-Webhook-Signature'),deps.config.webhookSecret,now))return json(401,{error:'INVALID_SIGNATURE'});
    if(event.test==='test'&&Object.keys(event).length===1)return json(200,{ok:true});
    const p=event.payload;
    if(typeof event.id!=='string'||event.id.length>200||typeof event.version!=='string'||!event.version.startsWith('1.')||typeof event.type!=='string'||!object(p)||!validUuid(p.instance_id)||typeof p.timestamp!=='number'||!Number.isSafeInteger(p.timestamp))return json(400,{error:'INVALID_EVENT'});
    if(!['streaming.started','streaming.updated','streaming.ended','streaming.error','streaming.warning'].includes(event.type))return json(200,{ok:true,ignored:true});
    if(!deps.config.domainId||p.domain_id!==deps.config.domainId)return json(403,{error:'INVALID_DOMAIN'});
    const result=await rpc(deps.service,'live_provider_event',{p_id:event.id,p_instance:p.instance_id,p_type:event.type,p_time:new Date(p.timestamp*1000).toISOString(),p_digest:await sha256(JSON.stringify(event))});
    return json(200,result);
   }
   if(mode==='maintenance'){
    const supplied=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    if(!deps.config.workerSecret||supplied.length<32||await sha256(supplied)!==await sha256(deps.config.workerSecret))return json(401,{error:'AUTH_REQUIRED'});
    const result=await rpc<Record<string,unknown>>(deps.service,'live_maintenance',{p_limit:1000});
    const jobs=await rpc<{items:Record<string,unknown>[]}>(deps.service,'live_claim_outbox',{p_limit:10});
    let completed=0;
    for(const job of jobs.items){
      if(!validUuid(job.id)||!validUuid(job.lease_id)||typeof job.room_name!=='string'||!/^pc-live-[0-9a-f]{32}$/.test(job.room_name))continue;
      let ok=false;let errorCode:string|null=null;
      try{
        if(job.action==='eject'&&validUuid(job.provider_identity))await provider(deps,`/rooms/${job.room_name}/eject`,{method:'POST',body:JSON.stringify({user_ids:[job.provider_identity],ban:true})},signal);
        else if(job.action==='stop'&&validUuid(job.instance_id))await provider(deps,`/rooms/${job.room_name}/live-streaming/stop`,{method:'POST',body:JSON.stringify({instanceId:job.instance_id})},signal);
        else throw new Error('INVALID_OUTBOX');ok=true;completed++;
      }catch(e){errorCode=e instanceof Error?e.message:'PROVIDER_OPERATION_FAILED';if(errorCode==='PROVIDER_NOT_FOUND')ok=true;}
      await rpc(deps.service,'live_finish_outbox',{p_id:job.id,p_lease:job.lease_id,p_ok:ok,p_error:errorCode});
    }
    let coversErased=0;
    if(deps.removeCovers){
      const covers=await rpc<{items:Record<string,unknown>[]}>(deps.service,'live_claim_cover_cleanup',{p_limit:10});
      for(const job of covers.items){
        if(!validUuid(job.id)||!validUuid(job.lease_id))continue;
        let ok=false,errorCode:string|null=null;
        try{
          const checked=await rpc<{absent:boolean;object_path:string}>(deps.service,'live_check_cover_cleanup',{p_id:job.id,p_lease:job.lease_id});
          if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(checked.object_path))throw new Error('INVALID_COVER_PATH');
          if(!checked.absent){const removed=await deps.removeCovers([checked.object_path]);if(removed.error)throw new Error('COVER_STORAGE_UNAVAILABLE');}
          ok=true;coversErased++;
        }catch(e){errorCode=e instanceof Error?e.message:'COVER_STORAGE_UNAVAILABLE';}
        await rpc(deps.service,'live_finish_cover_cleanup',{p_id:job.id,p_lease:job.lease_id,p_ok:ok,p_error:errorCode});
      }
    }
    return json(200,{...result,provider_jobs_completed:completed,covers_erased:coversErased});
   }
   const body=await readJson(request);if(!validUuid(body.sessionId))return json(400,{error:'INVALID_SESSION'});
   const sessionId=body.sessionId.toLowerCase(),caller=deps.caller(request),actor=await identity(caller,request);
   if(mode==='stage'){
    const access=await recheck(caller,sessionId,'stage');
    const context=await rpc<ProviderContext>(deps.service,'live_service_context',{p_session_id:sessionId,p_actor_id:actor.userId,p_auth_session_id:actor.sessionId,p_purpose:'stage'});
    const roomUrl=await ensureRoom(deps,context,signal,now);
    if(!validUuid(context.provider_identity)||context.provider_identity!==access.provider_identity)throw new Error('STATE_CONFLICT');
    const canScreen=context.role!=='camera';const expires=Math.floor(now/1000)+120;
    const token=await provider(deps,'/meeting-tokens',{method:'POST',body:JSON.stringify({properties:{
      room_name:context.room_name,user_id:context.provider_identity,user_name:object(access.profile)?String(access.profile.full_name||'').slice(0,100):'',
      is_owner:false,exp:expires,eject_at_token_exp:false,enable_screenshare:canScreen,start_audio_off:true,start_video_off:true,
      enable_recording_ui:false,permissions:{hasPresence:true,canSend:canScreen?['audio','video','screenAudio','screenVideo']:['audio','video'],canAdmin:false},
    }})},signal);
    const fresh=await recheck(caller,sessionId,'stage');
    if(fresh.provider_identity!==context.provider_identity||fresh.role!==context.role)throw new Error('STATE_CONFLICT');
    if(typeof token.token!=='string'||!token.token)throw new Error('INVALID_PROVIDER_RESPONSE');
    return json(200,{roomUrl,token:token.token,expires_at:new Date(expires*1000).toISOString(),role:context.role,can_publish:true,can_screen_share:canScreen,max_stage_members:context.max_stage_members});
   }
   if(mode==='playback'){
    await recheck(caller,sessionId,'playback');
    const context=await rpc<ProviderContext>(deps.service,'live_service_context',{p_session_id:sessionId,p_actor_id:actor.userId,p_auth_session_id:actor.sessionId,p_purpose:'playback'});
    if(!validPlaybackPath(context.playback_path,sessionId))throw new Error('DELIVERY_NOT_READY');
    const origin=safeHttpsOrigin(deps.config.cdnOrigin);if(!origin)throw new Error('DELIVERY_NOT_READY');
    let url:string,expiresAt=new Date(now+120000).toISOString();
    if(deps.config.signerUrl&&deps.config.signerSecret){
      const signer=new URL(deps.config.signerUrl);if(signer.protocol!=='https:'||signer.username||signer.password)throw new Error('DELIVERY_NOT_READY');
      const response=await deps.fetch(signer.toString(),{method:'POST',headers:{Authorization:`Bearer ${deps.config.signerSecret}`,'Content-Type':'application/json'},body:JSON.stringify({path:context.playback_path,expiresAt,sessionId,userId:actor.userId}),signal,redirect:'error'});
      if(!response.ok)throw new Error('DELIVERY_NOT_READY');
      const signed:unknown=JSON.parse(await boundedText(response.body,8192));
      if(!object(signed)||typeof signed.url!=='string'||typeof signed.expiresAt!=='string')throw new Error('INVALID_SIGNER_RESPONSE');
      const parsed=new URL(signed.url),expiry=Date.parse(signed.expiresAt);
      if(parsed.origin!==origin||!parsed.pathname.startsWith('/_live/')||!parsed.pathname.endsWith('/'+context.playback_path)||!(expiry>now&&expiry<=now+120000))throw new Error('INVALID_SIGNER_RESPONSE');
      url=signed.url;expiresAt=signed.expiresAt;
    }else{
      // Public streams may use a genuinely public CDN. A private audience never
      // receives an unsigned manifest, even if a config flag was set by mistake.
      if(context.audience!=='public')throw new Error('DELIVERY_NOT_READY');
      url=`${origin}/${context.playback_path}`;
    }
    await recheck(caller,sessionId,'playback');
    return json(200,{url,expires_at:expiresAt,format:'hls',live:context.state!=='ended',poster_url:null,tracks:[]});
   }
   if(!['start','stop','scene'].includes(String(body.action))||!validUuid(body.requestId))return json(400,{error:'INVALID_CONTROL'});
   if(body.scene!==undefined&&body.scene!==null&&!validScene(body.scene))return json(400,{error:'INVALID_SCENE'});
   if(!deps.config.dailyKey)throw new Error('PROVIDER_NOT_READY');
   const prepared=await rpc<{operation_id:string;status:string;result:unknown}>(caller,'live_prepare_control',{p_session_id:sessionId,p_action:body.action,p_request_id:body.requestId,p_scene:body.scene??null,p_reason:body.reason??null});
   if(prepared.status==='accepted')return json(200,prepared.result);
   const context=await rpc<ProviderContext>(deps.service,'live_service_context',{p_session_id:sessionId,p_actor_id:actor.userId,p_auth_session_id:actor.sessionId,p_purpose:'control',p_operation_id:prepared.operation_id});
   if(context.completed)return json(200,context.result);
   if(!context.lease_id||!context.action)throw new Error('INVALID_SERVICE_RESPONSE');
   let published:{session_id:string;provider_identity:string}[]=[];
   try{
    let payload:Record<string,unknown>={instanceId:context.instance_id};
    if(context.action!=='stop'){
      await ensureRoom(deps,context,signal,now);
      const clock=deps.now??Date.now, stopReading=now+12000, delays=[900,2200,4200];
      for(let attempt=0;;attempt++){
        if(signal.aborted)throw new Error('STAGE_CONNECTION_CHANGED');
        const present=await provider(deps,`/rooms/${context.room_name}/presence?limit=${context.max_stage_members+1}`,{cache:'no-store'},signal);
        if(!Array.isArray(present.data)||Number(present.total_count)>context.max_stage_members)throw new Error('STAGE_FULL');
        // Refresh authenticated scope and the operation lease after every REST read.
        const fresh=await rpc<ProviderContext>(deps.service,'live_service_context',{p_session_id:sessionId,p_actor_id:actor.userId,p_auth_session_id:actor.sessionId,p_purpose:'control_check',p_operation_id:prepared.operation_id});
        if(fresh.lease_id!==context.lease_id)throw new Error('CONTROL_LEASE_EXPIRED');
        const scene=fresh.payload?.scene??{preset:'host'};
        try{
          const composed=buildLiveLayout(scene,fresh,present.data as Presence[],context.action==='start');published=composed.published;
          payload={...payload,layout:composed.layout,...(context.action==='start'?{endpoints:[{endpoint:liveEndpointName(deps.config,fresh)}],...liveOutputSize(fresh),fps:30}:{})};
          break;
        }catch(e){
          const delay=delays[attempt];
          if(!(e instanceof Error)||e.message!=='STAGE_CONNECTION_CHANGED'||context.action!=='scene'||!scene.connection_ids
            ||!delay||clock()+delay>=stopReading||signal.aborted)throw e;
          await (deps.wait??waitForPresence)(delay,signal);
        }
      }
    }
    // Recheck current authenticated authority immediately before the provider
    // call. This checks the operation without minting viewer/stage credentials.
    await rpc(caller,'live_prepare_control',{p_session_id:sessionId,p_action:body.action,p_request_id:body.requestId,p_scene:body.scene??null,p_reason:body.reason??null});
    if(signal.aborted)throw new Error('STAGE_CONNECTION_CHANGED');
    const response=await provider(deps,`/rooms/${context.room_name}/live-streaming/${context.action==='scene'?'update':context.action}`,{method:'POST',body:JSON.stringify(payload)},signal);
    if(!dailyCommandAccepted(response))throw new Error('PROVIDER_OPERATION_UNCONFIRMED');
    const finished=await rpc(deps.service,'live_finish_control',{p_operation_id:prepared.operation_id,p_lease_id:context.lease_id,p_accepted:true,p_error:null,p_published:published});
    // 'starting'/'ending' are deliberate. Only the signed provider event may
    // confirm the media has actually started or stopped.
    const requested = context.payload?.scene.connection_ids;
    if (context.action === 'start' && requested && object(finished)) {
      return json(200,{...finished,scene_connections_confirmed:requested.length===published.length && published.every((p,i)=>p.session_id.toLowerCase()===requested[i].toLowerCase())});
    }
    return json(200,finished);
   }catch(error){
    await rpc(deps.service,'live_finish_control',{p_operation_id:prepared.operation_id,p_lease_id:context.lease_id,p_accepted:false,p_error:error instanceof Error?error.message:'PROVIDER_OPERATION_UNCONFIRMED',p_published:[]}).catch(()=>undefined);
    throw error;
   }
  }catch(error){return errorResponse(error);}
 };
}
