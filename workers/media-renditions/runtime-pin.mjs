import {timingSafeEqual} from 'node:crypto';

// Temporary preview-only operation. Remove its route after the one clean
// nonexpiring snapshot is read back; this is not a general provisioning API.
export const RUNTIME_PIN = Object.freeze({
 name:'pc-media-runtime-pin-20261102',
 sourceSnapshotId:'snap_a9eoAbB3s2ULdyrGtiqFFlnUA9HW',
 teamId:'team_yu7fUehO2z7E6QHF6Nvxp3tC',
 projectId:'prj_KRrC0YmQek14PrWGk9AZeP7hRNgE',
 cutoffMs:Date.parse('2026-11-02T18:30:00Z'),
 region:'pdx1',timeoutMs:120000,
});
const SESSION=/^sbx_[A-Za-z0-9_-]{8,150}$/;
const SNAPSHOT=/^snap_[A-Za-z0-9_-]{8,150}$/;
const terminal=status=>['stopped','failed','aborted'].includes(status);
const response=(status,error)=>({status,body:{error}});
const transportFailure=()=>new DOMException('runtime_pin_transport_failed','AbortError');

function authorizationMatches(value,secret){
 if(typeof secret!=='string'||secret.length<32||typeof value!=='string')return false;
 const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(value);
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
function validOidc(value,now){
 if(typeof value!=='string'||value.length>16000||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(value))return false;
 try{
  // These checks constrain the requested scope; the provider verifies the JWT.
  const claims=JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString('utf8'));
  return claims.owner_id===RUNTIME_PIN.teamId&&claims.project_id===RUNTIME_PIN.projectId&&claims.environment==='preview'
   &&Number.isSafeInteger(claims.exp)&&claims.exp*1000>now+RUNTIME_PIN.timeoutMs;
 }catch{return false;}
}

function singleAttemptTransport(token,fetchImpl){
 const sent=new Set();
 return async(url,options={})=>{
  const target=new URL(url),method=options.method||'GET';
  const allowed=target.protocol==='https:'&&target.hostname==='vercel.com'&&!target.username&&!target.password&&!target.hash
   &&method==='POST'&&(/^\/api\/v3\/sandboxes$/.test(target.pathname)
    ||/^\/api\/v2\/sandboxes\/sessions\/sbx_[A-Za-z0-9_-]{8,150}\/(snapshot|stop)$/.test(target.pathname));
  const key=method+' '+target.pathname;
  if(!allowed||sent.has(key))throw transportFailure();
  sent.add(key);
  const headers=new Headers(options.headers);headers.set('Authorization',`Bearer ${token}`);
  try{
   const result=await fetchImpl(target.toString(),{...options,headers,redirect:'error'});
   if(!result.ok){await result.body?.cancel().catch(()=>{});throw transportFailure();}
   return result;
  }catch{
   // SDK 3.9.1 retries network/429/5xx by default. Its AbortError branch
   // explicitly bails, so neither lifecycle POST is retried on the wire.
   throw transportFailure();
  }
 };
}

export function createRuntimePin({Sandbox,env=process.env,now=Date.now,fetchImpl=fetch}){
 let attempted=false;
 return async({method,authorization,oidcToken})=>{
  if(env.VERCEL_ENV!=='preview'||env.MEDIA_SANDBOX_RUNTIME_PIN_ENABLED!=='true'||now()>=RUNTIME_PIN.cutoffMs)return response(404,'not_found');
  if(method!=='POST')return response(405,'method_not_allowed');
  if(!authorizationMatches(authorization,env.CRON_SECRET))return response(401,'unauthorized');
  if(!validOidc(oidcToken,now()))return response(503,'oidc_unavailable');
  if(attempted)return response(409,'runtime_pin_already_attempted');
  // Provider name uniqueness supplies the cross-instance guard. Do not delete
  // this name or call getOrCreate/resume/retry if the create outcome is unknown.
  attempted=true;
  let session,snapshotCompleted=false,result=response(503,'runtime_pin_unavailable');
  const boundedSignal=maximum=>AbortSignal.timeout(Math.max(1,Math.min(maximum,RUNTIME_PIN.cutoffMs-now())));
  try{
   const sandbox=await Sandbox.create({
    token:oidcToken,teamId:RUNTIME_PIN.teamId,projectId:RUNTIME_PIN.projectId,
    name:RUNTIME_PIN.name,source:{type:'snapshot',snapshotId:RUNTIME_PIN.sourceSnapshotId},
    region:RUNTIME_PIN.region,resources:{vcpus:2},timeout:RUNTIME_PIN.timeoutMs,
    persistent:false,ports:[],networkPolicy:'deny-all',
    fetch:singleAttemptTransport(oidcToken,fetchImpl),signal:boundedSignal(30000),
   });
   session=sandbox.currentSession();
   if(!SESSION.test(session.sessionId)||sandbox.name!==RUNTIME_PIN.name||session.vcpus!==2||session.memory!==4096
    ||session.region!==RUNTIME_PIN.region||session.sourceSnapshotId!==RUNTIME_PIN.sourceSnapshotId||now()>=RUNTIME_PIN.cutoffMs)throw new Error('runtime_pin_scope_mismatch');
   // No environment, credential, file or command is ever sent to this VM.
   const snapshot=await session.snapshot({expiration:0,signal:boundedSignal(80000)});
   snapshotCompleted=snapshot.status==='created';
   if(!snapshotCompleted||!SNAPSHOT.test(snapshot.snapshotId)||snapshot.sourceSessionId!==session.sessionId
    ||snapshot.expiresAt!=null||!Number.isSafeInteger(snapshot.sizeBytes)||snapshot.sizeBytes<1)throw new Error('runtime_pin_not_durable');
   result={status:200,body:{state:'pinned',snapshot_id:snapshot.snapshotId,expires_at:null,size_bytes:snapshot.sizeBytes}};
  }catch{
   // Never return SDK errors: they may contain provider request details.
  }finally{
   if(session&&!snapshotCompleted){
    try{
     const stopped=await session.stop({signal:AbortSignal.timeout(10000)});
     if(!terminal(stopped.session.status))result=response(503,'runtime_pin_cleanup_unconfirmed');
    }catch{result=response(503,'runtime_pin_cleanup_unconfirmed');}
   }
  }
  return result;
 };
}

export async function configuredRuntimePin(env=process.env){
 const {Sandbox}=await import('@vercel/sandbox');
 return createRuntimePin({Sandbox,env});
}
