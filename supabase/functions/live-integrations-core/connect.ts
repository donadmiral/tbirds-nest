import {Vault,Platform,isPlatform,isUuid,record,randomSecret,digest,seal,unseal,validVault,boundedJson,fail,safeFailure,IntegrationFailure} from './security.ts';
import {ProviderConfig,Account,Tokens,configured,authorizationUrl,exchange,accounts,refresh,validTokens,Fetcher} from './providers.ts';
export type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:unknown}>;
type Caller={auth:{getUser():PromiseLike<{data:{user:{id:string;is_anonymous?:boolean}|null};error:unknown}>};rpc:Rpc};
export type ConnectDependencies={config:ProviderConfig;vault:Vault;caller(request:Request):Caller;rpc:Rpc;fetch:Fetcher};
const common={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const publicAccount=(account:Account)=>({id:account.id,name:account.name});
export function createConnectHandler(deps:ConnectDependencies){return async(request:Request)=>{
 const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:common});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:common});if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
 try{
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(25000)]),caller=deps.caller(request),auth=await caller.auth.getUser();
  if(auth.error||!auth.data.user||auth.data.user.is_anonymous)fail('AUTH_REQUIRED');
  const context=await caller.rpc('live_integration_context',{});
  if(context.error||!record(context.data)||context.data.user_id!==auth.data.user!.id||!isUuid(context.data.auth_session_id))fail('AUTH_REQUIRED');
  const actor=auth.data.user!.id,sid=context.data.auth_session_id;
  const body=await boundedJson(request,12000,signal);if(!record(body)||typeof body.action!=='string')fail('INVALID_REQUEST');
  const input=body as Record<string,unknown>;
  const operation=async(action:string,data:Record<string,unknown>)=>{
   const r=await deps.rpc('live_oauth_operation',{p_actor:actor,p_session:sid,p_action:action,p_data:data});
   if(r.error||!record(r.data))fail('DATABASE_UNAVAILABLE');
   if(typeof r.data.error==='string')throw safeFailure(new IntegrationFailure(r.data.error as any));return r.data;
  };
  if(input.action==='status'){
   if(Object.keys(input).some(k=>k!=='action'))fail('INVALID_REQUEST');
   const result=await operation('status',{});return json(200,{...result,available:['x','facebook','instagram','youtube','tiktok'].filter(p=>configured(deps.config,p as Platform)&&validVault(deps.vault))});
  }
  if(!isPlatform(input.platform))fail('INVALID_REQUEST');const platform=input.platform as Platform;
  if(input.action==='disconnect'){
   if(Object.keys(input).some(k=>!['action','platform'].includes(k)))fail('INVALID_REQUEST');
   return json(200,await operation('disconnect',{platform}));
  }
  if(!configured(deps.config,platform)||!validVault(deps.vault))fail('INTEGRATION_NOT_CONFIGURED');
  if(input.action==='begin'){
   if(Object.keys(input).some(k=>!['action','platform'].includes(k)))fail('INVALID_REQUEST');
   const state=randomSecret(),verifier=randomSecret(),id=crypto.randomUUID();
   const ciphertext=await seal(deps.vault,`oauth:${actor}:${id}:${platform}`,{verifier});
   await operation('begin',{id,platform,state_hash:await digest(state),ciphertext});
   return json(200,{authorization_url:await authorizationUrl(deps.config,platform,state,verifier),expires_in:600});
  }
  const finish=async(row:Record<string,any>,account:Account)=>{
   if(!isUuid(row.connection_id))fail('PROVIDER_RESPONSE_INVALID');
   const ciphertext=await seal(deps.vault,`connection:${actor}:${row.connection_id}:${platform}`,{...account.tokens,accountId:account.id});
   return operation('finish',{id:row.id,platform,account_id:account.id,account_name:account.name,ciphertext,scopes:account.tokens.scopes,expires_at:new Date(account.tokens.expiresAt).toISOString()});
  };
  if(input.action==='complete'){
   if(Object.keys(input).some(k=>!['action','platform','state','code'].includes(k))||typeof input.state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.state)||typeof input.code!=='string'||input.code.length<1||input.code.length>8000)fail('INVALID_REQUEST');
   const row=await operation('claim',{platform,state_hash:await digest(input.state)});
   if(!isUuid(row.id)||typeof row.ciphertext!=='string')fail('PROVIDER_RESPONSE_INVALID');
   try{
    const state=await unseal(deps.vault,`oauth:${actor}:${row.id}:${platform}`,row.ciphertext);
    if(!record(state)||typeof state.verifier!=='string')fail('INVALID_CIPHERTEXT');
    const token=await exchange(deps.config,platform,input.code,state.verifier,deps.fetch,signal),targets=await accounts(deps.config,platform,token,deps.fetch,signal);
    if(!targets.length)fail('SCOPES_NOT_GRANTED');if(targets.length>20)fail('ACCOUNT_LIMIT');
    if(targets.length===1)return json(200,await finish(row,targets[0]));
    const ciphertext=await seal(deps.vault,`oauth:${actor}:${row.id}:${platform}`,{targets});
    await operation('selection',{id:row.id,platform,ciphertext});
    return json(200,{state:'select_account',selection_id:row.id,accounts:targets.map(publicAccount)});
   }catch(error){await operation('failed',{id:row.id,platform}).catch(()=>{});throw error;}
  }
  if(input.action==='select'){
   if(Object.keys(input).some(k=>!['action','platform','selection_id','account_id'].includes(k))||!isUuid(input.selection_id)||typeof input.account_id!=='string')fail('INVALID_REQUEST');
   const row=await operation('select',{id:input.selection_id,platform});
   if(typeof row.ciphertext!=='string')fail('PROVIDER_RESPONSE_INVALID');
   const state=await unseal(deps.vault,`oauth:${actor}:${row.id}:${platform}`,row.ciphertext);
   if(!record(state)||!Array.isArray(state.targets))fail('INVALID_CIPHERTEXT');
   const target=state.targets.find((a:any)=>a.id===input.account_id);if(!target||!validTokens(target.tokens))fail('ACCESS_DENIED');
   return json(200,await finish(row,target));
  }
  if(input.action==='refresh'){
   if(Object.keys(input).some(k=>!['action','platform'].includes(k)))fail('INVALID_REQUEST');
   const row=await operation('refresh_claim',{platform});
   if(!isUuid(row.id)||!isUuid(row.lease_id)||typeof row.ciphertext!=='string')fail('PROVIDER_RESPONSE_INVALID');
   try{
    const old=await unseal(deps.vault,`connection:${actor}:${row.id}:${platform}`,row.ciphertext);if(!validTokens(old)||typeof old.accountId!=='string')fail('INVALID_CIPHERTEXT');
    const updated=await refresh(deps.config,platform,old as Tokens,deps.fetch,signal);
    const ciphertext=await seal(deps.vault,`connection:${actor}:${row.id}:${platform}`,updated);
    return json(200,await operation('refresh_finish',{platform,id:row.id,lease_id:row.lease_id,version:row.version,ciphertext,expires_at:new Date(updated.expiresAt).toISOString()}));
   }catch(error){await operation('refresh_failed',{platform,id:row.id,lease_id:row.lease_id}).catch(()=>{});throw error;}
  }
  fail('INVALID_REQUEST');
 }catch(error){const safe=safeFailure(error),status=safe.code==='AUTH_REQUIRED'?401:safe.code==='ACCESS_DENIED'?403:safe.code==='INVALID_REQUEST'?400:safe.code==='PROVIDER_RATE_LIMITED'?429:safe.code.startsWith('STATE_')||safe.code==='RECONNECT_REQUIRED'?409:503;
  return json(status,{error:safe.code,...(safe.retryAfterSeconds?{retry_after:safe.retryAfterSeconds}:{})});}
};}
