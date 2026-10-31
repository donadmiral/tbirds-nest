const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../../node_modules/typescript'),{createHash,randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),code=ts.transpileModule(fs.readFileSync(path.join(root,'supabase/functions/business-session/handler.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleValue={exports:{}};vm.runInNewContext(code,{module:moduleValue,exports:moduleValue.exports,Request,Response,JSON,TextEncoder,Error});
const {createBusinessSessionHandler}=moduleValue.exports;
const ids={business:randomUUID(),member:randomUUID(),grant:randomUUID(),session:randomUUID(),owner:randomUUID(),ownerSession:randomUUID(),application:randomUUID(),device:randomUUID()};
const access='synthetic-bound-business-access-token',refresh='synthetic-bound-refresh-token',proof='a'.repeat(64);
const digest=s=>createHash('sha256').update(s).digest('hex');
function fixture(mode='code',overrides={}){
 const calls=[];let issued=false,revoked=false,bound=false;
 const wrap=(name,fn)=>async(...args)=>{calls.push({name,args});return overrides[name]?overrides[name](...args):fn(...args);};
 const deps={
  rpc:wrap('rpc',(name,args)=>{
   if(name.endsWith('signin_check')||name.endsWith('owner_access'))return {data:{allowed:true,grant_id:ids.grant,business_id:ids.business,member_id:ids.member}};
   if(name.endsWith('finish_signin')){assert.equal(issued,true);bound=true;return{data:{success:true,business_id:ids.business,member_id:ids.member,session_id:ids.session,role:'editor'}};}
   if(name.endsWith('cancel_signin')){bound=false;return{data:true};}throw new Error(`Unexpected ${name}`);
  }),
  getUser:wrap('getUser',()=>({data:{user:{id:ids.owner,email:'never-return@example.invalid'}}})),
  getClaims:wrap('getClaims',token=>({data:{claims:{sub:token===access?ids.business:ids.owner,session_id:token===access?ids.session:ids.ownerSession}}})),
  getUserById:wrap('getUserById',()=>({data:{user:{id:ids.business,email:'business@accounts.platinumcircles.invalid'}}})),
  generateLink:wrap('generateLink',()=>({data:{properties:{hashed_token:'server-only-magic-capability'}}})),
  exchange:wrap('exchange',()=>{issued=true;return{data:{session:{access_token:access,refresh_token:refresh,user:{id:ids.business}}}};}),
  revoke:wrap('revoke',()=>{revoked=true;}),hash:wrap('hash',digest),
 };
 const handler=createBusinessSessionHandler(mode,deps);
 const body={device_id:ids.device,device_key:proof,device_label:'Synthetic browser',...(mode==='code'?{handle:'@Example_business',code:' personal-code '}:{application_id:ids.application})};
 const request=(changes={},signal,method='POST')=>new Request('https://qa.example.invalid/function',{method,headers:{'Content-Type':'application/json',...(mode==='owner'?{Authorization:'Bearer personal-owner-token'}:{})},...(method==='POST'?{body:JSON.stringify({...body,...changes})}:{}),signal});
 return{handler,request,calls,body,get issued(){return issued;},get revoked(){return revoked;},get bound(){return bound;}};
}
test('code sign-in exchanges on the server and only returns a refresh-capable bound session',async()=>{
 const f=fixture(),response=await f.handler(f.request()),body=await response.json();assert.equal(response.status,200);
 assert.deepEqual(body,{business_id:ids.business,member_id:ids.member,role:'editor',session:{access_token:access,refresh_token:refresh}});
 assert.equal(f.bound,true);assert.equal(f.revoked,false);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('CDN-Cache-Control'),'no-store');
 const steps=f.calls.filter(c=>c.name!=='hash').map(c=>c.name==='rpc'?c.args[0]:c.name);assert.deepEqual(steps,['triniti_business_signin_check','getUserById','generateLink','exchange','getClaims','triniti_business_finish_signin']);
 const prepare=f.calls.find(c=>c.args[0]==='triniti_business_signin_check').args[1];assert.equal(prepare.p_code_hash,digest('PERSONAL-CODE'));assert.equal(prepare.p_proof_hash,digest(proof));
 assert.equal('token_hash'in body,false);assert.equal('email'in body,false);
});
test('owner launch uses provider-verified personal user and session, never supplied identity claims',async()=>{
 const f=fixture('owner'),response=await f.handler(f.request({bootstrap_owner:true,user_id:randomUUID(),session_id:randomUUID()}));assert.equal(response.status,200);
 const args=f.calls.find(c=>c.args[0]==='triniti_business_owner_access').args[1];assert.equal(args.p_user_id,ids.owner);assert.equal(args.p_session_id,ids.ownerSession);assert.equal(args.p_bootstrap_owner,true);
});
test('owner bootstrap is a reviewable 409 and does not create or exchange an Auth token',async()=>{
 const f=fixture('owner',{rpc:()=>({data:{allowed:false,error:'OWNER_BOOTSTRAP_REQUIRED'}})}),response=await f.handler(f.request());assert.equal(response.status,409);assert.equal((await response.json()).requires_owner_bootstrap,true);assert.equal(f.calls.some(c=>c.name==='generateLink'),false);
});
test('owner launch requires exactly one application or business and a verified personal JWT',async()=>{
 let f=fixture('owner');assert.equal((await f.handler(f.request({business_id:ids.business}))).status,400);assert.equal(f.calls.some(c=>c.name==='rpc'),false);
 f=fixture('owner',{getClaims:()=>({data:{claims:{sub:ids.business,session_id:ids.ownerSession}}})});assert.equal((await f.handler(f.request())).status,401);assert.equal(f.calls.some(c=>c.name==='rpc'),false);
 f=fixture('owner');assert.equal((await f.handler(f.request({application_id:undefined,business_id:ids.business}))).status,200);
});
test('device approval, blocked device, inactive credentials and rate limits stop before provider issuance',async()=>{
 for(const [error,status]of [['DEVICE_APPROVAL_REQUIRED',403],['DEVICE_BLOCKED',403],['ACCESS_REJECTED',401],['TRY_LATER',429]]){
  const f=fixture('code',{rpc:()=>({data:{allowed:false,error}})}),response=await f.handler(f.request());assert.equal(response.status,status);assert.equal((await response.json()).code,error);assert.equal(f.calls.some(c=>c.name==='generateLink'),false);
 }
});
test('missing or forged device storage is rejected before server access',async()=>{
 for(const changes of [{device_id:'web-unknown-device'},{device_key:''},{device_key:'b'.repeat(63)},{device_label:'x'.repeat(101)}]){const f=fixture();assert.equal((await f.handler(f.request(changes))).status,400);assert.equal(f.calls.length,0);}
});
test('provider identity mismatch cannot exchange a different account',async()=>{
 const f=fixture('code',{getUserById:()=>({data:{user:{id:ids.owner,email:'other@example.invalid'}}})});assert.equal((await f.handler(f.request())).status,503);assert.equal(f.calls.some(c=>c.name==='generateLink'),false);
});
test('grant, provider and network errors return a generic failure without credentials or database details',async()=>{
 for(const overrides of [{rpc:()=>({data:null,error:Error('private SQL secret')})},{generateLink:()=>{throw Error('service-key-secret');}},{exchange:()=>({data:{session:null},error:Error('provider-secret')})}]){
  const f=fixture('code',overrides),response=await f.handler(f.request()),text=await response.text();assert.equal(response.status,503);assert.doesNotMatch(text,/secret|server-only-magic|synthetic-bound/);
 }
});
test('finish failure revokes the issued session using independent SQL and Auth cleanup',async()=>{
 const f=fixture('code',{rpc:(name)=>name.endsWith('signin_check')?{data:{allowed:true,grant_id:ids.grant,business_id:ids.business,member_id:ids.member}}:name.endsWith('finish_signin')?{data:null,error:Error('revoked')}:{data:true}});
 const response=await f.handler(f.request());assert.equal(response.status,503);assert.equal(f.revoked,true);assert.ok(f.calls.some(c=>c.args[0]==='triniti_business_cancel_signin'));assert.doesNotMatch(await response.text(),/synthetic-bound/);
});
test('an ambiguous finish response cannot return another seat and is cleaned up',async()=>{
 const f=fixture('code',{rpc:(name)=>name.endsWith('signin_check')?{data:{allowed:true,grant_id:ids.grant,business_id:ids.business,member_id:ids.member}}:name.endsWith('finish_signin')?{data:{success:true,business_id:ids.business,member_id:ids.owner,session_id:ids.session,role:'owner'}}:{data:true}});
 assert.equal((await f.handler(f.request())).status,503);assert.equal(f.revoked,true);
});
test('unverifiable issued claims are revoked and never sent to the client',async()=>{
 const f=fixture('code',{getClaims:()=>({data:{claims:{sub:ids.business,session_id:'forged'}}})});assert.equal((await f.handler(f.request())).status,503);assert.equal(f.revoked,true);assert.equal(f.calls.some(c=>c.args[0]==='triniti_business_finish_signin'),false);
});
test('abort after exchange revokes the issued session and prevents installation',async()=>{
 const controller=new AbortController(),f=fixture('code',{getClaims:()=>{controller.abort();return{data:{claims:{sub:ids.business,session_id:ids.session}}};}});
 assert.equal((await f.handler(f.request({},controller.signal))).status,503);assert.equal(f.revoked,true);assert.equal(f.calls.some(c=>c.args[0]==='triniti_business_finish_signin'),false);
});
test('abort during finish still revokes a possibly committed business session',async()=>{
 const controller=new AbortController(),f=fixture('code',{rpc:(name)=>{
  if(name.endsWith('signin_check'))return{data:{allowed:true,grant_id:ids.grant,business_id:ids.business,member_id:ids.member}};
  if(name.endsWith('finish_signin')){controller.abort();return{data:{success:true,business_id:ids.business,member_id:ids.member,session_id:ids.session,role:'editor'}};}return{data:true};
 }});assert.equal((await f.handler(f.request({},controller.signal))).status,503);assert.equal(f.revoked,true);
});
test('Auth revocation is attempted when SQL cleanup fails',async()=>{
 const f=fixture('code',{rpc:name=>{if(name.endsWith('signin_check'))return{data:{allowed:true,grant_id:ids.grant,business_id:ids.business,member_id:ids.member}};throw Error('service unavailable');}});assert.equal((await f.handler(f.request())).status,503);assert.equal(f.revoked,true);
});
test('preflight and unsupported HTTP methods never touch provider state',async()=>{
 const f=fixture();assert.equal((await f.handler(f.request({},undefined,'OPTIONS'))).status,200);assert.equal((await f.handler(f.request({},undefined,'GET'))).status,405);assert.equal(f.calls.length,0);
});
const guardModule={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'supabase/functions/_shared/businessSessionGuard.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:guardModule,exports:guardModule.exports,Request,Response,JSON});
const {guardBusinessRequest}=guardModule.exports;
test('a revoked business JWT cannot reach a privileged service/provider handler even when getUser would accept it',async()=>{
 for(const response of [{data:false,error:null},{data:true,error:Error('unavailable')},{data:null,error:null}]){
  let reached=0;const requests=[];
  const protectedHandler=guardBusinessRequest(async()=>{reached++;return new Response('provider');},request=>({rpc:async(name,args)=>{requests.push({authorization:request.headers.get('Authorization'),name,args});return response;}}));
  const result=await protectedHandler(new Request('https://qa.example.invalid',{method:'POST',headers:{Authorization:'Bearer old-but-signed-business-jwt'}}));
  assert.equal(result.status,401);assert.equal(reached,0);assert.equal(requests[0].name,'business_session_allowed');assert.equal(requests[0].authorization,'Bearer old-but-signed-business-jwt');assert.equal(Object.keys(requests[0].args).length,0);
 }
});
test('the Edge guard preserves authorized personal/member requests and explicit public image/OPTIONS paths',async()=>{
 let reached=0,checks=0;const handler=guardBusinessRequest(async()=>{reached++;return new Response('okay');},()=>({rpc:async()=>{checks++;return{data:true,error:null};}}));
 assert.equal((await handler(new Request('https://qa.example.invalid',{method:'POST'}))).status,200);
 assert.equal((await handler(new Request('https://qa.example.invalid',{method:'OPTIONS'}))).status,200);assert.equal(checks,1);assert.equal(reached,2);
 const publicImage=guardBusinessRequest(async()=>new Response('public image'),()=>({rpc:async()=>{throw Error('not called');}}),request=>request.method==='POST');assert.equal((await publicImage(new Request('https://qa.example.invalid?image=public-capability'))).status,200);
});
test('every direct user-to-provider/service entrypoint installs the guard, while worker credentials stay separate',()=>{
 for(const endpoint of ['apple-music','crisp-bridge','daily-get-token','replicate-proxy','create-business','link-preview'])assert.match(fs.readFileSync(path.join(root,`supabase/functions/${endpoint}/index.ts`),'utf8'),/serveBusinessRequest\(/,endpoint);
 for(const endpoint of ['content-media-sign','chat-media-sign','export-my-data'])assert.match(fs.readFileSync(path.join(root,`supabase/functions/${endpoint}/index.ts`),'utf8'),/\.rpc\(/,endpoint);
 assert.match(fs.readFileSync(path.join(root,'supabase/functions/daily-get-token/index.ts'),'utf8'),/if \(!await businessSessionAllowed\(anon\)\) return false/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'supabase/functions/account-storage-erasure/index.ts'),'utf8'),/serveBusinessRequest/);
});
const boundedModule={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'supabase/functions/_shared/boundedFetch.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:boundedModule,exports:boundedModule.exports,Request,AbortSignal});
const {boundedFetch}=boundedModule.exports;
const pendingFetch=(_input,init)=>new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test hung without network deadline')),150);const stop=()=>{clearTimeout(timer);reject(init.signal.reason);};if(init.signal.aborted)stop();else init.signal.addEventListener('abort',stop,{once:true});});
test('business network operations have a deadline even if the browser stays connected',async()=>{
 await assert.rejects(boundedFetch(pendingFetch,undefined,5)('https://qa.example.invalid'),error=>error.name==='TimeoutError');
});
test('network deadline preserves SDK, Request and outer cancellation signals',async()=>{
 for(const mode of ['sdk','request','parent']){const controller=new AbortController(),parent=mode==='parent'?controller.signal:undefined;controller.abort(new Error(`Cancelled ${mode}`));const input=mode==='request'?new Request('https://qa.example.invalid',{signal:controller.signal}):'https://qa.example.invalid';await assert.rejects(boundedFetch(pendingFetch,parent)(input,mode==='sdk'?{signal:controller.signal}:undefined),new RegExp(`Cancelled ${mode}`));}
});
test('compensating Auth revocation keeps its own bounded fetch after request cancellation',async()=>{
 const controller=new AbortController();controller.abort();let called=0;
 const cleanup=boundedFetch(async(_url,init)=>{called++;assert.equal(init.signal.aborted,false);return new Response('revoked');});assert.equal((await cleanup('https://qa.example.invalid')).status,200);assert.equal(called,1);
 const source=fs.readFileSync(path.join(root,'supabase/functions/business-session/runtime.ts'),'utf8');assert.match(source,/cleanup\.auth\.admin\.signOut/);assert.match(source,/name==='triniti_business_cancel_signin'\?cleanup:svc/);
});
