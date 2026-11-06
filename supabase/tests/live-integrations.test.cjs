const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {webcrypto,randomUUID}=require('node:crypto');
const cache=new Map();
function load(file){
 file=path.resolve(__dirname,'../functions',file);if(cache.has(file))return cache.get(file);
 const module={exports:{}};cache.set(file,module.exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {module,exports:module.exports,require:name=>load(path.relative(path.join(__dirname,'../functions'),path.resolve(path.dirname(file),name))),
 Request,Response,Headers,URL,URLSearchParams,FormData,Blob,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,AbortSignal,crypto:webcrypto,atob,btoa,Date,setTimeout,clearTimeout});return module.exports;
}
const security=load('live-integrations-core/security.ts'),providers=load('live-integrations-core/providers.ts'),{createConnectHandler}=load('live-integrations-core/connect.ts'),{parseTranscribeResult,transcriptionJob}=load('live-integrations-core/transcription.ts'),{createTranscriptionWorkerHandler}=load('live-transcription-worker/handler.ts');
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),actor=id(1),sid=id(2),connection=id(3),clip=id(4),job=id(5),lease=id(6);
const plain=value=>JSON.parse(JSON.stringify(value));
const vault={activeKeyId:'v1',keys:{v1:Buffer.alloc(32,71).toString('base64url')}},secret='synthetic-provider-token-canary-never-expose';
const config={redirectUri:'https://platinumcircles.example/live/connections/callback',clients:Object.fromEntries(['x','facebook','instagram','youtube','tiktok'].map(p=>[p,{clientId:'synthetic-client',clientSecret:'synthetic-client-secret'}])),metaVersion:'v25.0'};
test('AES-GCM binds encrypted tokens to actor, connection and platform; key rotation reads old envelopes',async()=>{
 const context=`connection:${actor}:${connection}:x`,value=await security.seal(vault,context,{secret});
 assert.ok(!value.includes(secret));assert.equal((await security.unseal(vault,context,value)).secret,secret);
 const rotated={activeKeyId:'v2',keys:{...vault.keys,v2:Buffer.alloc(32,72).toString('base64url')}};
 assert.equal((await security.unseal(rotated,context,value)).secret,secret);
 for(const wrong of [`connection:${sid}:${connection}:x`,`connection:${actor}:${sid}:x`,`connection:${actor}:${connection}:youtube`])await assert.rejects(security.unseal(vault,wrong,value),/INVALID_CIPHERTEXT/);
 await assert.rejects(security.unseal(vault,context,value.slice(0,-5)+'AAAAA'),/INVALID_CIPHERTEXT/);
});
test('OAuth uses high-entropy state, S256 where supported, exact redirects and minimum scoped APIs',async()=>{
 const state=security.randomSecret(),verifier=security.randomSecret();assert.equal(state.length,43);assert.notEqual(state,verifier);
 const url=new URL(await providers.authorizationUrl(config,'x',state,verifier));
 assert.equal(url.origin,'https://x.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('code_challenge'),await security.challenge(verifier));assert.ok(!url.href.includes(verifier));
 assert.deepEqual(url.searchParams.get('scope').split(' '),['tweet.read','tweet.write','users.read','offline.access','media.write']);
 assert.equal(url.searchParams.get('redirect_uri'),config.redirectUri);
 assert.equal(new URL(await providers.authorizationUrl(config,'youtube',state,verifier)).searchParams.get('access_type'),'offline');
 assert.equal(new URL(await providers.authorizationUrl(config,'tiktok',state,verifier)).searchParams.get('code_challenge'),null,'web flow uses documented confidential code exchange');
 assert.equal(providers.configured({...config,redirectUri:'https://evil.example/x?next=x'},'x'),false);
 assert.equal(providers.configured({...config,metaVersion:undefined},'instagram'),false);
});
test('X exchanges a code once with confidential-client auth and never includes the secret in URL',async()=>{
 const requests=[];const result=await providers.exchange(config,'x','code-canary',security.randomSecret(),async(url,init)=>{requests.push({url,init});return Response.json({access_token:secret,refresh_token:'rotating-canary',expires_in:7200,scope:providers.requiredScopes.x.join(' '),token_type:'bearer'});},AbortSignal.timeout(1000));
 assert.equal(requests.length,1);assert.equal(requests[0].url,'https://api.x.com/2/oauth2/token');assert.ok(requests[0].init.headers.Authorization.startsWith('Basic '));assert.equal(requests[0].init.redirect,'error');assert.equal(result.accessToken,secret);
});
test('missing scopes and missing refresh consent fail closed',async()=>{
 for(const body of [{access_token:secret,refresh_token:'r',scope:'tweet.read'},{access_token:secret,scope:providers.requiredScopes.x.join(' ')}])await assert.rejects(providers.exchange(config,'x','code',security.randomSecret(),async()=>Response.json(body),AbortSignal.timeout(1000)),/SCOPES_NOT_GRANTED/);
});
test('TikTok success error envelope is accepted and rotated refresh tokens replace old tokens',async()=>{
 const tokens={accessToken:secret,refreshToken:'old',expiresAt:0,scopes:providers.requiredScopes.tiktok};
 const account=await providers.accounts(config,'tiktok',tokens,async()=>Response.json({data:{user:{open_id:'owner_123',display_name:'Creator'}},error:{code:'ok',message:''}}),AbortSignal.timeout(1000));assert.equal(account[0].id,'owner_123');
 const updated=await providers.refresh(config,'tiktok',tokens,async(url,init)=>{assert.equal(url,'https://open.tiktokapis.com/v2/oauth/token/');assert.equal(init.body.get('refresh_token'),'old');return Response.json({access_token:'new-access',refresh_token:'new-refresh',scope:'user.info.basic,video.publish',expires_in:86400,refresh_expires_in:31536000});},AbortSignal.timeout(1000));assert.equal(updated.refreshToken,'new-refresh');
});
test('Meta targets come only from Page API response and required granted permissions',async()=>{
 const token={accessToken:secret,expiresAt:Date.now()+10000,scopes:providers.requiredScopes.instagram};
 const requests=[];const result=await providers.accounts(config,'instagram',token,async(url)=>{requests.push(url);return Response.json(url.endsWith('/permissions')?{data:providers.requiredScopes.instagram.map(permission=>({permission,status:'granted'}))}:{data:[{id:'100',name:'Page',access_token:'page-secret',instagram_business_account:{id:'200',username:'creator'}}]});},AbortSignal.timeout(1000));
 assert.equal(result[0].id,'200');assert.equal(result[0].tokens.accessToken,'page-secret');assert.equal(requests.length,2);
 await assert.rejects(providers.accounts(config,'facebook',token,async()=>Response.json({data:[]}),AbortSignal.timeout(1000)),/SCOPES_NOT_GRANTED/);
});
test('bounded account pagination fails without following arbitrary provider links',async()=>{
 let calls=0;await assert.rejects(providers.accounts(config,'youtube',{accessToken:secret,expiresAt:0,scopes:[]},async()=>{calls++;return Response.json({items:[],nextPageToken:'next'});},AbortSignal.timeout(1000)),/ACCOUNT_LIMIT/);assert.equal(calls,1);
});
test('provider errors and rate limits disclose no provider response text or credentials',async()=>{
 for(const status of [400,401,429,503]){
  try{await providers.providerJson(async()=>new Response(secret,{status,headers:{'Retry-After':'120'}}),'https://api.x.com/fixed',{},AbortSignal.timeout(1000));assert.fail();}
  catch(error){assert.ok(!JSON.stringify(error).includes(secret));if(status===429)assert.equal(error.retryAfterSeconds,120);}
 }
});
test('ambiguous irreversible calls never automatically retry; safe reads have bounded backoff',()=>{
 for(const phase of ['publish','token_exchange'])assert.deepEqual(plain(security.retryDecision({phase,attempt:1,status:503})),{retry:false,state:'confirmation_required',after_seconds:null});
 assert.equal(security.retryDecision({phase:'read',attempt:1,status:429,retryAfter:200000}).after_seconds,86400);
 assert.equal(security.retryDecision({phase:'read',attempt:5,status:503}).retry,false);
 assert.equal(security.retryDecision({phase:'upload',attempt:1,status:403}).retry,false);
});
function connect(options={}){
 const calls=[],providerCalls=[];let row,consumed=false;const deps={config,vault,fetch:async(url,init)=>{providerCalls.push({url,init});if(url.endsWith('/token'))return Response.json({access_token:secret,refresh_token:'refresh-canary',expires_in:7200,scope:providers.requiredScopes.x.join(' ')});return Response.json({data:{id:'xowner',username:'Creator'}});},caller:()=>({auth:{getUser:async()=>({data:{user:options.anonymous?null:{id:actor}},error:null})},rpc:async()=>({data:options.invalidSession?null:{user_id:actor,auth_session_id:sid},error:null})}),rpc:async(name,args)=>{
  calls.push({name,args});assert.equal(args.p_actor,actor);assert.equal(args.p_session,sid);
  const data=args.p_data;switch(args.p_action){
   case 'begin':row={...data,connection_id:connection};return{data:options.disabled?{error:'INTEGRATION_DISABLED'}:{ok:true},error:null};
   case 'claim':if(consumed||data.state_hash!==row.state_hash)return{data:{error:'STATE_REPLAYED'},error:null};consumed=true;return{data:row,error:null};
   case 'finish':return{data:{state:'connected',account_name:data.account_name,can_publish:false},error:null};
   case 'disconnect':return{data:{state:'disconnected'},error:null};
   case 'failed':return{data:{ok:true},error:null};
   case 'status':return{data:{items:[],direct_publishing:false},error:null};
   default:throw Error(args.p_action);
  }
 }};return{handler:createConnectHandler(deps),calls,providerCalls,get row(){return row;}};
}
const request=body=>new Request('https://local.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic-user'},body:JSON.stringify(body)});
test('connection authenticates live session before state creation or provider IO',async()=>{
 for(const option of [{anonymous:true},{invalidSession:true}]){const h=connect(option);assert.equal((await h.handler(request({action:'begin',platform:'x'}))).status,401);assert.equal(h.calls.length,0);assert.equal(h.providerCalls.length,0);}
});
test('disabled connection never emits an authorization URL',async()=>{const h=connect({disabled:true});const response=await h.handler(request({action:'begin',platform:'x'}));assert.equal(response.status,503);assert.equal((await response.json()).error,'INTEGRATION_DISABLED');assert.equal(h.providerCalls.length,0);});
test('OAuth completion is one-use and returns metadata only; ciphertext stays server-side',async()=>{
 const h=connect();const started=await(await h.handler(request({action:'begin',platform:'x'}))).json(),state=new URL(started.authorization_url).searchParams.get('state');
 const response=await h.handler(request({action:'complete',platform:'x',state,code:'code-canary'})),body=await response.text();assert.equal(response.status,200);assert.ok(body.includes('connected'));assert.ok(!body.includes(secret));assert.ok(!body.includes('ciphertext'));
 const saved=h.calls.find(c=>c.args.p_action==='finish').args.p_data;assert.ok(!saved.ciphertext.includes(secret));assert.equal((await security.unseal(vault,`connection:${actor}:${connection}:x`,saved.ciphertext)).accessToken,secret);
 assert.equal((await h.handler(request({action:'complete',platform:'x',state,code:'code-canary'}))).status,409);assert.equal(h.providerCalls.length,2);
});
test('no connect operation accepts arbitrary redirect or provider URL',async()=>{const h=connect();assert.equal((await h.handler(request({action:'begin',platform:'x',redirect:'https://evil.example'}))).status,400);assert.equal(h.calls.length,0);assert.equal(h.providerCalls.length,0);});
test('stream limits count actual UTF-8 bytes and abort releases the source',async()=>{
 let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('é'.repeat(20)));},cancel(){cancelled=true;}});
 await assert.rejects(security.boundedBytes(new Response(stream),30,AbortSignal.timeout(1000)),/MEDIA_TOO_LARGE/);assert.equal(cancelled,true);
 const controller=new AbortController();controller.abort();await assert.rejects(security.boundedJson(Response.json({}),100,controller.signal),/PROVIDER_UNAVAILABLE/);
});
const jobName='pc-live-caption-'+job.replaceAll('-','');
const transcript=()=>({jobName,status:'COMPLETED',results:{language_code:'en-US',items:[{type:'pronunciation',start_time:'0.1',end_time:'0.4',alternatives:[{content:'Hello'}]},{type:'pronunciation',start_time:'0.5',end_time:'0.9',alternatives:[{content:'world'}]},{type:'punctuation',alternatives:[{content:'.'}]}]}});
test('AWS transcript drafts preserve real timing and require review',()=>{const r=parseTranscribeResult(transcript(),30000,jobName);assert.deepEqual(plain(r.cues),[{start_ms:100,end_ms:900,text:'Hello world.'}]);assert.equal(r.requires_review,true);assert.equal(r.timing,'provider_words');});
test('AWS output must match deterministic job and completed state',()=>{for(const patch of [{jobName:'foreign'},{status:'IN_PROGRESS'},{results:{items:[]}}])assert.throws(()=>parseTranscribeResult({...transcript(),...patch},30000,jobName),/PROVIDER_RESPONSE_INVALID|TRANSCRIPTION_FAILED/);});
test('timestamp-free, out-of-range and overlapping output cannot become subtitles',()=>{
 for(const patch of [{start_time:undefined},{start_time:'0.3'},{end_time:'40.0'},{end_time:'0.5'}]){const r=transcript();Object.assign(r.results.items[1],patch);assert.throws(()=>parseTranscribeResult(r,30000,jobName),/PROVIDER_RESPONSE_INVALID/);}
});
test('word gaps and sentence endings split cues; subtitle markup remains inert text',()=>{const r=transcript();r.results.items[0].alternatives[0].content='<b>Hello</b>';r.results.items[1].start_time='4.5';r.results.items[1].end_time='5.0';const result=parseTranscribeResult(r,30000,jobName);assert.equal(result.cues.length,2);assert.ok(!result.text.includes('<'));});
test('Transcribe request has deterministic job and same-region private input/output locations',()=>{const result=transcriptionJob(job,'private-caption-bucket','us-east-2','en-US');assert.equal(result.request.TranscriptionJobName,jobName);assert.equal(result.request.Media.MediaFileUri,`s3://private-caption-bucket/transcription/${job}/source.flac`);assert.equal(result.request.OutputKey,`transcription/${job}/result.json`);assert.throws(()=>transcriptionJob(job,'bucket','eu-west-1','en-US'),/INVALID_REQUEST/);});
const workerSecret='synthetic-transcription-worker-secret-123456',base='https://abcdefghijklmnopqrst.supabase.co',objectPath=`${actor}/${sid}/${clip}/${lease}/horizontal.mp4`;
function worker(options={}){
 const calls=[];let checks=0,signs=0;
 const handler=createTranscriptionWorkerHandler({secret:workerSecret,base,rpc:async(name,args)=>{calls.push(args);return{data:args.p_action==='check'?{ok:!options.revoked&&!(options.revokeAfterSign&&++checks>1),object_path:options.path||objectPath,bucket:'live-clips',clip_id:clip,duration_ms:30000,language:'en-US',job_name:jobName}:args.p_action==='claim'?{items:[]}:{ok:true,state:'draft'},error:null};},sign:async p=>{signs++;return options.url||`${base}/storage/v1/object/sign/live-clips/${p}?token=synthetic-grant`;}});
 return{handler,calls,get signs(){return signs;}};
}
const workerRequest=(body,token=workerSecret)=>new Request(base,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
test('transcription broker rejects ordinary user JWT before database access',async()=>{const h=worker();assert.equal((await h.handler(workerRequest({action:'claim'},'synthetic-user'))).status,401);assert.equal(h.calls.length,0);});
test('transcription source is a current private rendition and is rechecked after signing',async()=>{
 const h=worker(),r=await h.handler(workerRequest({action:'source',id:job,lease_id:lease}));assert.equal(r.status,200);assert.equal(h.calls.filter(c=>c.p_action==='check').length,2);
 const revoked=worker({revokeAfterSign:true});assert.equal((await revoked.handler(workerRequest({action:'source',id:job,lease_id:lease}))).status,409);assert.equal(revoked.signs,1);
});
test('transcription broker refuses foreign clip paths and signing hosts',async()=>{for(const options of [{path:objectPath.replace(clip,id(9))},{url:'https://evil.example/token'}]){const h=worker(options);assert.equal((await h.handler(workerRequest({action:'source',id:job,lease_id:lease}))).status,503);}});
test('transcription completion stores only validated timed draft and never publishes or edits a clip',async()=>{
 const h=worker();const r=await h.handler(workerRequest({action:'finish',id:job,lease_id:lease,result:transcript()}));assert.equal(r.status,200);assert.equal(h.calls.length,2);const payload=h.calls[1].p_payload;assert.equal(payload.requires_review,true);assert.equal(payload.cues.length,1);assert.ok(!h.calls.some(c=>String(c.p_action).includes('publish')));
});
test('malformed transcript never reaches finish and revoked jobs never receive media',async()=>{const h=worker();assert.equal((await h.handler(workerRequest({action:'finish',id:job,lease_id:lease,result:{}}))).status,503);assert.equal(h.calls.length,1);const r=worker({revoked:true});assert.equal((await r.handler(workerRequest({action:'source',id:job,lease_id:lease}))).status,409);assert.equal(r.signs,0);});
