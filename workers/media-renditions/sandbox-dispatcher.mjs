import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {backend} from './backend.mjs';
import {UUID} from './config.mjs';

const FILES=['backend.mjs','config.mjs','worker.mjs','transcode.mjs','run-job.mjs','host-metrics.mjs','sandbox-job.mjs'];
const ID=/^[A-Za-z0-9_-]{8,160}$/;
const terminal=status=>['stopped','failed','aborted'].includes(status);
export function sandboxConfig(env=process.env){
 const base=new URL(env.SUPABASE_URL||''),snapshot=env.MEDIA_SANDBOX_SNAPSHOT_ID,image=env.MEDIA_SANDBOX_IMAGE;
 if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('invalid_sandbox_backend');
 if(!/^team_[A-Za-z0-9]+$/.test(env.MEDIA_SANDBOX_TEAM_ID||'')||!/^prj_[A-Za-z0-9]+$/.test(env.MEDIA_SANDBOX_PROJECT_ID||''))throw new Error('missing_sandbox_scope');
 if(!['preview','production'].includes(env.VERCEL_ENV))throw new Error('invalid_sandbox_environment');
 if(!/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i.test(env.MEDIA_SANDBOX_DISPATCHER_KEY||'')||!/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i.test(env.MEDIA_BROKER_KEY||'')||env.MEDIA_SANDBOX_DISPATCHER_KEY===env.MEDIA_BROKER_KEY)throw new Error('separate_sandbox_credentials_required');
 if(snapshot?(!/^snap_[A-Za-z0-9_-]{8,150}$/.test(snapshot)||!!image):!/^[-A-Za-z0-9_./]+@sha256:[0-9a-f]{64}$/.test(image||''))throw new Error('pinned_sandbox_image_required');
 return{base:base.origin,teamId:env.MEDIA_SANDBOX_TEAM_ID,projectId:env.MEDIA_SANDBOX_PROJECT_ID,workerKey:env.MEDIA_BROKER_KEY,dispatcherKey:env.MEDIA_SANDBOX_DISPATCHER_KEY,
  environment:env.VERCEL_ENV,region:'pdx1',...(snapshot?{source:{type:'snapshot',snapshotId:snapshot}}:{image})};
}
export function requestSandboxCredentials(config,token,{now=Date.now,fetchImpl=fetch}={}){
 if(typeof token!=='string'||token.length>16000||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(token))throw new Error('invalid_request_oidc');
 let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{throw new Error('invalid_request_oidc');}
 const at=now();
 // Scope checks constrain our request; Vercel verifies the signed token.
 if(claims.owner_id!==config.teamId||claims.project_id!==config.projectId||claims.environment!==config.environment
  ||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=at+120000
  ||(claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf*1000>at+30000))
  ||(claims.iat!==undefined&&(!Number.isSafeInteger(claims.iat)||claims.iat*1000>at+30000)))throw new Error('invalid_request_oidc');
 const mutations=new Set();
 const scopedFetch=async(url,options={})=>{
  const target=new URL(url),method=options.method||'GET',path=target.pathname;
  const named=method==='GET'&&/^\/api\/v2\/sandboxes\/pc-media-[0-9a-f]{32}$/.test(path)
   &&target.searchParams.get('projectId')===config.projectId&&target.searchParams.get('resume')==='false';
  const commandRead=method==='GET'&&/^\/api\/v2\/sandboxes\/sessions\/sbx_[A-Za-z0-9_-]{8,150}\/cmd\/[A-Za-z0-9_-]{8,160}$/.test(path);
  const create=method==='POST'&&path==='/api/v3/sandboxes';
  const sessionWrite=method==='POST'&&/^\/api\/v2\/sandboxes\/sessions\/sbx_[A-Za-z0-9_-]{8,150}\/(stop|cmd|fs\/mkdir|fs\/write)$/.test(path);
  if(target.protocol!=='https:'||target.hostname!=='vercel.com'||target.username||target.password||target.hash
   ||target.searchParams.get('teamId')!==config.teamId||!(named||commandRead||create||sessionWrite))throw new DOMException('sandbox_transport_scope','AbortError');
  if(create){let body;try{body=JSON.parse(options.body);}catch{throw new DOMException('sandbox_transport_scope','AbortError');}
   if(body.projectId!==config.projectId||!/^pc-media-[0-9a-f]{32}$/.test(body.name||'')||body.persistent!==false)throw new DOMException('sandbox_transport_scope','AbortError');}
  if(method==='POST'){if(mutations.has(path))throw new DOMException('sandbox_mutation_retry_blocked','AbortError');mutations.add(path);}
  const headers=new Headers(options.headers);headers.set('Authorization',`Bearer ${token}`);
  try{
   const result=await fetchImpl(target.toString(),{...options,headers,redirect:'error'});
   if(method==='POST'&&(result.status===429||result.status>=500)){await result.body?.cancel().catch(()=>{});throw new DOMException('sandbox_mutation_unavailable','AbortError');}
   return result;
  }catch(error){
   // SDK retries transport errors by default. Mutations must not repeat a
   // detached command or create; an ambiguous outcome retains its DB slot.
   if(method==='POST')throw new DOMException('sandbox_mutation_unavailable','AbortError');
   throw error;
  }
 };
 return{token,teamId:config.teamId,projectId:config.projectId,fetch:scopedFetch};
}
export async function workerBundle(){
 const files=await Promise.all(FILES.map(async name=>({path:'/vercel/sandbox/worker/'+name,content:await readFile(fileURLToPath(new URL(name,import.meta.url)))})));
 const hash=createHash('sha256');for(const file of files)hash.update(file.path+'\0').update(file.content).update('\0');
 return{files,sha256:hash.digest('hex')};
}
export function sandboxOptions(config,reservation,credentials){
 if(!UUID.test(reservation.id)||reservation.name!==`pc-media-${reservation.id.replaceAll('-','')}`||reservation.timeoutMs!==780000||reservation.vcpus!==2)throw new Error('invalid_sandbox_reservation');
 return{...credentials,name:reservation.name,...(config.source?{source:config.source}:{image:config.image}),region:config.region,
  persistent:false,ports:[],resources:{vcpus:2},timeout:780000,tags:{purpose:'media-renditions',profile:'hls-v2'},
  networkPolicy:{allow:[new URL(config.base).hostname]}};
}
export function workerEnvironment(config){
 return{SUPABASE_URL:config.base,MEDIA_BROKER_URL:config.base+'/functions/v1/media-broker',MEDIA_BROKER_KEY:config.workerKey,
  MEDIA_WORKER_DEADLINE_MS:'720000',MEDIA_WORKER_DISK_BYTES:'2147483648',MEDIA_WORKER_MAX_INPUT_BYTES:'536870912',MEDIA_WORKER_THREADS:'2',TMPDIR:'/vercel/sandbox/scratch'};
}
export function createSandboxDispatcher({config,Sandbox,api,bundle=workerBundle,now=Date.now,uuid=randomUUID,fetchImpl=fetch}){
 const rpc=(name,args={})=>api.rpc(name,args,AbortSignal.timeout(10000));
 const credentials=token=>requestSandboxCredentials(config,token,{now,fetchImpl});
 async function reap(auth){
  const pending=await rpc('pending_media_sandboxes_v1');if(!Array.isArray(pending)||pending.length>2)throw new Error('invalid_sandbox_runs');
  let stopped=0;
  for(const run of pending){
   if(!UUID.test(run.id)||run.name!==`pc-media-${run.id.replaceAll('-','')}`||run.sessionId&&!ID.test(run.sessionId)||run.commandId&&!ID.test(run.commandId))throw new Error('invalid_sandbox_run');
   if(!run.commandId&&Date.parse(run.launchUntil)>now())continue;
   let session,shouldStop=false,exitCode=null;
   try{
    const sandbox=await Sandbox.get({...auth,name:run.name,resume:false,signal:AbortSignal.timeout(10000)});session=sandbox.currentSession();
    if(run.sessionId&&session.sessionId!==run.sessionId){session=undefined;throw new Error('sandbox_session_changed');}
    if(terminal(session.status)){await rpc('finish_media_sandbox_v1',{p_run_id:run.id,p_session_id:session.sessionId,p_exit_code:null});continue;}
    if(!run.commandId||Date.parse(run.stopAfter)<=now()){shouldStop=true;continue;}
    const command=await session.getCommand(run.commandId,{signal:AbortSignal.timeout(10000)});
    if(command.exitCode!==null&&command.exitCode!==undefined){exitCode=command.exitCode;shouldStop=true;}
   }catch(error){
    if(session)shouldStop=true;
    else if(error?.response?.status===404&&Date.parse(run.stopAfter)<=now())await rpc('finish_media_sandbox_v1',{p_run_id:run.id,p_session_id:run.sessionId||null,p_exit_code:null});
    // Unknown create outcomes retain their full reservation until both the
    // provider hard bound and a successful absence/stop check have passed.
   }
   finally{
    if(shouldStop&&session){
     const result=await session.stop({signal:AbortSignal.timeout(10000)});
     if(!terminal(result.session.status))throw new Error('sandbox_stop_unconfirmed');
     await rpc('finish_media_sandbox_v1',{p_run_id:run.id,p_session_id:session.sessionId,p_exit_code:exitCode});stopped++;
    }
   }
  }
  return stopped;
 }
 return{
  async tick(oidcToken){
   const auth=credentials(oidcToken),stopped=await reap(auth),source=await bundle();
   const reservation=await rpc('reserve_media_sandbox_v1',{p_run_id:uuid(),p_source_sha256:source.sha256});
   if(!reservation)return{state:'idle',stopped};
   if(reservation.sourceSha256!==source.sha256||Date.parse(reservation.launchUntil)<=now())throw new Error('expired_sandbox_reservation');
   let sandbox,session,launched=false;
   try{
    const deadline=Math.min(30000,Date.parse(reservation.launchUntil)-now());
    sandbox=await Sandbox.create({...sandboxOptions(config,reservation,auth),signal:AbortSignal.timeout(Math.max(1,deadline))});session=sandbox.currentSession();
    if(Date.parse(reservation.launchUntil)<=now()||!await rpc('attach_media_sandbox_v1',{p_run_id:reservation.id,p_session_id:session.sessionId,p_command_id:null}))throw new Error('sandbox_attach_rejected');
    await session.mkDir('/vercel/sandbox/worker',{signal:AbortSignal.timeout(Math.max(1,Date.parse(reservation.launchUntil)-now()))});
    await session.writeFiles(source.files,{signal:AbortSignal.timeout(Math.max(1,Date.parse(reservation.launchUntil)-now()))});
    if(Date.parse(reservation.launchUntil)<=now())throw new Error('expired_sandbox_reservation');
    const command=await session.runCommand({cmd:'node',args:['/vercel/sandbox/worker/sandbox-job.mjs'],cwd:'/vercel/sandbox',env:workerEnvironment(config),detached:true,timeoutMs:735000,signal:AbortSignal.timeout(Math.max(1,Date.parse(reservation.launchUntil)-now()))});
    if(!await rpc('attach_media_sandbox_v1',{p_run_id:reservation.id,p_session_id:session.sessionId,p_command_id:command.cmdId}))throw new Error('sandbox_command_attach_rejected');
    launched=true;return{state:'launched',stopped,timeout_seconds:780,max_input_bytes:536870912};
   }finally{
    if(session&&!launched){const result=await session.stop({signal:AbortSignal.timeout(10000)});if(terminal(result.session.status))await rpc('finish_media_sandbox_v1',{p_run_id:reservation.id,p_session_id:session.sessionId,p_exit_code:null});}
   }
  },reap:token=>reap(credentials(token)),status:()=>rpc('media_sandbox_status_v1'),
 };
}
export async function configuredSandboxDispatcher(env=process.env){
 const config=sandboxConfig(env),{Sandbox}=await import('@vercel/sandbox');
 return createSandboxDispatcher({config,Sandbox,api:backend({base:config.base,brokerUrl:config.base+'/functions/v1/media-broker',brokerKey:config.dispatcherKey})});
}
