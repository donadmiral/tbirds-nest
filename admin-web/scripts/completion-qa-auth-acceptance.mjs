// Explicit one-off protected Preview build only. Never imported by the app.
// Existing server credentials stay inside this build process. Only synthetic
// fixture IDs, hashes, check results and sanitized cleanup status are logged.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const QA_ORIGIN='https://uaulhuelcfkjwojtymmw.supabase.co';
const QA_BRANCH='codex/completion-20261101';
export function assertPreviewEnvironment(env,expectedSource){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==QA_BRANCH)throw new Error('QA_PROTECTED_PREVIEW_REQUIRED');
 if(!/^[a-f0-9]{40}$/.test(expectedSource||'')||env.VERCEL_GIT_COMMIT_SHA!==expectedSource)throw new Error('QA_EXACT_SOURCE_REQUIRED');
 if(env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!==QA_ORIGIN)throw new Error('QA_EXACT_PROJECT_REQUIRED');
 if(!env.SUPABASE_SERVICE_ROLE_KEY||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY||env.SUPABASE_SERVICE_ROLE_KEY===env.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw new Error('QA_EXISTING_SERVER_CREDENTIAL_REQUIRED');
 return{origin:QA_ORIGIN,source:expectedSource,branch:QA_BRANCH};
}
export function fixtureBelongsToRun(user,run,id){
 return !!user&&user.id===id&&user.app_metadata?.completion_qa_fixture===true&&user.app_metadata?.completion_qa_run===run
  &&typeof user.email==='string'&&user.email.endsWith('@example.invalid')&&user.email.startsWith(`completion-${run}-`);
}
export function sanitizedFailure(error,stage){
 const raw=typeof error?.code==='string'?error.code:'';
 return{stage,code:/^[A-Z0-9_]{1,64}$/.test(raw)?raw:'CHECK_FAILED',...(Number.isInteger(error?.status)?{status:error.status}:{})};
}
export function storageFailureIsDenied(error){
 return !!error&&[400,403,404].includes(error.status)
  &&['403','404','AccessDenied','NoSuchKey','NoSuchBucket','not_found','unauthorized'].includes(String(error.statusCode??error.code??''));
}
export function authLookupProvesAbsent(result){
 return result?.error?.status===404&&result.error.code==='user_not_found'&&!result.data?.user;
}
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const ok=(condition,code)=>{if(!condition)fail(code);};
const success=(result,code)=>{if(result.error)throw Object.assign(new Error(code),{code,status:result.error.status});return result.data;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function runAcceptance({env=process.env,expectedSource,clientFactory,fetcher=fetch}={}){
 const target=assertPreviewEnvironment(env,expectedSource);
 const run=randomUUID(),created=[],checks=[],objects=[];
 const receipt={formatVersion:1,phase:'identity-media',run,projectRef:'uaulhuelcfkjwojtymmw',sourceCommit:target.source,branch:target.branch,
  scriptSha256:sha(await readFile(new URL(import.meta.url))),startedAt:new Date().toISOString(),checks,cleanup:[],
  scope:'Two disposable ordinary Auth identities, private owned upload, cross-account denial, current session refresh/revocation and synthetic fixture cleanup. No account-erasure worker, owned-audio, outbound message, provider or licensing acceptance is implied.'};
 let stage='client_setup',failure;
 const scopedFetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin!==QA_ORIGIN||!/^\/(auth|rest|storage|functions)\/v1\//.test(url.pathname))fail('QA_REQUEST_SCOPE_VIOLATION');
  return fetcher(input,{...init,redirect:'error',signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
 };
 const make=(key,authorization)=>clientFactory(QA_ORIGIN,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:scopedFetch,...(authorization?{headers:{Authorization:`Bearer ${authorization}`}}:{})}});
 const admin=make(env.SUPABASE_SERVICE_ROLE_KEY);
 const check=(name,detail={})=>checks.push({name,passed:true,...detail});
 const responseBytes=async(response)=>Buffer.from(await response.arrayBuffer());
 try{
  const identities={};
  for(const label of ['owner','viewer']){
   stage=`create_${label}`;
   const password=randomBytes(36).toString('base64url')+'aA1!',email=`completion-${run}-${label}@example.invalid`;
   const fixtureId=randomUUID();created.push({label,id:fixtureId});
   const data=success(await admin.auth.admin.createUser({id:fixtureId,email,password,email_confirm:true,app_metadata:{completion_qa_fixture:true,completion_qa_run:run},user_metadata:{full_name:'Completion QA fixture'}}),'QA_CREATE_DISPOSABLE_IDENTITY_FAILED');
   ok(data.user&&fixtureBelongsToRun(data.user,run,fixtureId),'QA_CREATED_IDENTITY_MISMATCH');
   const member=make(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
   stage=`signin_${label}`;
   const signed=success(await member.auth.signInWithPassword({email,password}),'QA_ORDINARY_SIGNIN_FAILED');
   ok(signed.user?.id===data.user.id&&signed.session?.access_token&&!signed.user.is_anonymous,'QA_ORDINARY_SESSION_MISMATCH');
   const profile=success(await member.from('profiles').select('id,account_type,deactivated_at,push_token').eq('id',data.user.id).single(),'QA_ORDINARY_PROFILE_UNAVAILABLE');
   ok(profile.id===data.user.id&&profile.account_type==='personal'&&profile.deactivated_at===null&&profile.push_token===null,'QA_PROFILE_IS_NOT_ORDINARY');
   const confirmed=success(await member.auth.getUser(),'QA_GET_USER_FAILED');ok(confirmed.user?.id===data.user.id,'QA_GET_USER_MISMATCH');
   identities[label]={member,id:data.user.id,token:signed.session.access_token};check(`${label}_ordinary_identity_and_session`);
  }
  const {owner,viewer}=identities;
  stage='private_upload';
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64');
  const path=`${owner.id}/completion-${run}.png`,bucket='post-media';
  objects.push({bucket,path,owner:owner.id});
  success(await owner.member.storage.from(bucket).upload(path,png,{contentType:'image/png',upsert:false}),'QA_PRIVATE_UPLOAD_FAILED');
  const publicUrl=`${QA_ORIGIN}/storage/v1/object/public/${bucket}/${path}`;
  const publicRead=await scopedFetch(publicUrl,{method:'GET'}),publicError=await publicRead.json().catch(()=>null);
  ok(storageFailureIsDenied({status:publicRead.status,statusCode:publicError?.statusCode??publicError?.code}),'QA_PUBLIC_OBJECT_DENIAL_UNCONFIRMED');
  const otherRead=await viewer.member.storage.from(bucket).download(path);ok(storageFailureIsDenied(otherRead.error)&&!otherRead.data,'QA_OTHER_ACCOUNT_DENIAL_UNCONFIRMED');
  check('owned_upload_is_private',{bytes:png.length,sha256:sha(png),publicStatus:publicRead.status});
  const signing=async(identity)=>{
   const response=await scopedFetch(`${QA_ORIGIN}/functions/v1/content-media-sign`,{method:'POST',headers:{apikey:env.NEXT_PUBLIC_SUPABASE_ANON_KEY,Authorization:`Bearer ${identity.token}`,'Content-Type':'application/json'},body:JSON.stringify({uploads:[publicUrl],delivery:'no-store'})});
   const body=await response.json();ok(response.ok&&Array.isArray(body.urls),'QA_PRIVATE_SIGNING_UNAVAILABLE');return body;
  };
  stage='cross_account_delivery';
  const denied=await signing(viewer);ok(denied.urls.length===0,'QA_OTHER_ACCOUNT_DELIVERY_ALLOWED');check('other_account_cannot_issue_upload_delivery');
  const signed=await signing(owner);ok(signed.urls.length===1,'QA_OWNER_DELIVERY_MISSING');
  const delivery=new URL(signed.urls[0].url);ok(delivery.origin===QA_ORIGIN&&delivery.pathname===`/functions/v1/media-content/${bucket}/${path}`&&/^[a-f0-9]{64}$/.test(delivery.searchParams.get('token')||''),'QA_OWNER_DELIVERY_SCOPE_MISMATCH');
  const loaded=await scopedFetch(delivery,{method:'GET',cache:'no-store'});ok(loaded.status===200&&loaded.headers.get('Cache-Control')?.includes('no-store'),'QA_OWNER_DELIVERY_UNAVAILABLE');ok(sha(await responseBytes(loaded))===sha(png),'QA_OWNER_DELIVERY_BYTES_MISMATCH');check('owner_delivery_reads_exact_bytes_without_cache');
  stage='refresh_owner_session';
  const refreshed=success(await owner.member.auth.refreshSession(),'QA_SESSION_REFRESH_FAILED');ok(refreshed.user?.id===owner.id&&refreshed.session?.access_token,'QA_SESSION_REFRESH_MISMATCH');
  owner.token=refreshed.session.access_token;check('ordinary_session_refresh');
  stage='revoke_owner_session';
  const staleClient=make(env.NEXT_PUBLIC_SUPABASE_ANON_KEY,owner.token);
  success(await owner.member.auth.signOut({scope:'global'}),'QA_SESSION_SIGNOUT_FAILED');
  const after=await scopedFetch(delivery,{method:'GET',cache:'no-store'});ok([401,403,410].includes(after.status),'QA_REVOKED_SESSION_DELIVERY_ALLOWED');await after.body?.cancel();
  const stale=await staleClient.rpc('issue_content_media_delivery',{p_references:null,p_uploads:[publicUrl]});
  ok([401,403].includes(stale.status)&&['42501','PGRST301'].includes(stale.error?.code),'QA_REVOKED_SESSION_ISSUANCE_DENIAL_UNCONFIRMED');check('logout_revokes_existing_delivery_and_fresh_issuance',{deliveryStatus:after.status});
 }catch(error){failure=sanitizedFailure(error,stage);receipt.failure=failure;}
 finally{
  // These are exactly the IDs created by this invocation, additionally checked
  // against Auth metadata before any deletion. No account listing or broad SQL.
  for(const object of objects){
   try{
    const result=await admin.storage.from(object.bucket).remove([object.path]);success(result,'QA_FIXTURE_STORAGE_CLEANUP_FAILED');
    const slash=object.path.lastIndexOf('/'),name=object.path.slice(slash+1);
    const listed=success(await admin.storage.from(object.bucket).list(object.path.slice(0,slash),{search:name,limit:2}),'QA_FIXTURE_STORAGE_READBACK_FAILED');
    ok(Array.isArray(listed)&&listed.every(row=>row.name!==name),'QA_FIXTURE_STORAGE_STILL_PRESENT');
    receipt.cleanup.push({kind:'storage',ownerId:object.owner,passed:true,absenceVerified:true});
   }
   catch(error){receipt.cleanup.push({kind:'storage',ownerId:object.owner,passed:false,...sanitizedFailure(error,'cleanup_storage')});}
  }
  for(const fixture of created.reverse()){
   try{
    ok(!receipt.cleanup.some(row=>row.kind==='storage'&&row.ownerId===fixture.id&&!row.passed),'QA_FIXTURE_FILES_NOT_CONFIRMED_ERASED');
    const lookup=await admin.auth.admin.getUserById(fixture.id);
    if(authLookupProvesAbsent(lookup)){
     const profile=success(await admin.from('profiles').select('id').eq('id',fixture.id).maybeSingle(),'QA_FIXTURE_PROFILE_READBACK_FAILED');ok(profile===null,'QA_FIXTURE_PROFILE_STILL_PRESENT');
     receipt.cleanup.push({kind:'auth',label:fixture.label,id:fixture.id,passed:true,alreadyAbsent:true});continue;
    }
    const fetched=success(lookup,'QA_FIXTURE_LOOKUP_FAILED');ok(fixtureBelongsToRun(fetched.user,run,fixture.id),'QA_FIXTURE_CLEANUP_SCOPE_MISMATCH');
    success(await admin.auth.admin.deleteUser(fixture.id),'QA_FIXTURE_AUTH_CLEANUP_FAILED');
    const absent=await admin.auth.admin.getUserById(fixture.id);ok(authLookupProvesAbsent(absent),'QA_FIXTURE_AUTH_ABSENCE_UNCONFIRMED');
    const profile=success(await admin.from('profiles').select('id').eq('id',fixture.id).maybeSingle(),'QA_FIXTURE_PROFILE_READBACK_FAILED');ok(profile===null,'QA_FIXTURE_PROFILE_STILL_PRESENT');
    receipt.cleanup.push({kind:'auth',label:fixture.label,id:fixture.id,passed:true});
   }catch(error){receipt.cleanup.push({kind:'auth',label:fixture.label,id:fixture.id,passed:false,...sanitizedFailure(error,'cleanup_auth')});}
  }
 }
 receipt.completedAt=new Date().toISOString();receipt.allChecksPassed=!failure&&checks.length===7&&receipt.cleanup.length===3&&receipt.cleanup.every(row=>row.passed);
 return receipt;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let receipt;
 try{
  const at=process.argv.indexOf('--expected-source'),expectedSource=at>=0?process.argv[at+1]:undefined;
  assertPreviewEnvironment(process.env,expectedSource);
  const {createClient}=await import('@supabase/supabase-js');
  receipt=await runAcceptance({expectedSource,clientFactory:createClient});
 }catch(error){receipt={formatVersion:1,allChecksPassed:false,mutationStarted:false,failure:sanitizedFailure(error,'preview_preflight')};}
 console.log('PLATINUM_QA_ACCEPTANCE_RECEIPT='+JSON.stringify(receipt));
 if(!receipt.allChecksPassed)process.exitCode=1;
}
