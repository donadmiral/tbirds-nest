import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sandboxConfig,sandboxOptions,workerEnvironment,createSandboxDispatcher,workerBundle,requestSandboxCredentials} from '../sandbox-dispatcher.mjs';
import {createWorkerHandler} from '../server.mjs';
import {parseCpuStat,parseMemory} from '../host-metrics.mjs';
import {createMediaBroker} from '../../../supabase/functions/media-broker/handler.mjs';
import {randomUUID} from 'node:crypto';
import {Sandbox as ActualSandbox} from '@vercel/sandbox';
const runId='40000000-0000-4000-8000-000000000001',sessionId='sbx_fixture_12345',commandId='cmd_fixture_12345',sha='a'.repeat(64);
const env={SUPABASE_URL:'https://fixture.supabase.co',VERCEL_ENV:'preview',MEDIA_SANDBOX_TEAM_ID:'team_fixture',MEDIA_SANDBOX_PROJECT_ID:'prj_fixture',MEDIA_BROKER_KEY:runId+'.'+'b'.repeat(64),MEDIA_SANDBOX_DISPATCHER_KEY:runId+'.'+'c'.repeat(64),MEDIA_SANDBOX_SNAPSHOT_ID:'snap_fixture_12345'};
const now=Date.now(),claims={owner_id:'team_fixture',project_id:'prj_fixture',environment:'preview',exp:Math.floor(now/1000)+3600};
const jwt=payload=>'header.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.signature',token=jwt(claims);
const config=sandboxConfig(env),reservation={id:runId,name:'pc-media-'+runId.replaceAll('-',''),timeoutMs:780000,vcpus:2,launchUntil:new Date(Date.now()+30000).toISOString(),stopAfter:new Date(Date.now()+825000).toISOString(),sourceSha256:sha};
function harness({queued=true,pending=[],exitCode=null,attach=true,writeFails=false,getFails=false,status='running',stopStatus='stopped',returnedSessionId=sessionId}={}){
 const calls=[],session={sessionId:returnedSessionId,status,async mkDir(){calls.push('mkdir');},async writeFiles(){calls.push('write');if(writeFails)throw Error('write_failed');},async getCommand(){calls.push('getCommand');return{exitCode};},async runCommand(params){calls.push({runCommand:params});return{cmdId:commandId};},async stop(){calls.push('stop');return{session:{status:stopStatus}};}};
 const sandbox={currentSession:()=>session,async mkDir(){throw Error('parent_auto_resume_forbidden');},async writeFiles(){throw Error('parent_auto_resume_forbidden');}};
 const Sandbox={async get(params){calls.push({get:params});if(getFails)throw Error('provider_unavailable');return sandbox;},async create(options){calls.push({create:options});return sandbox;}};
 const api={async rpc(name,args){calls.push({rpc:name,args});if(name==='pending_media_sandboxes_v1')return pending;if(name==='reserve_media_sandbox_v1')return queued?reservation:null;if(name==='attach_media_sandbox_v1')return attach;if(name==='finish_media_sandbox_v1')return true;if(name==='media_sandbox_status_v1')return{enabled:false,active_reservations:0,max_concurrency:1};throw Error(name);}};
 return{calls,dispatcher:createSandboxDispatcher({config,Sandbox,api,bundle:async()=>({files:[],sha256:sha}),uuid:()=>runId,now:()=>now})};
}
test('sandbox configuration requires pinned runtime and distinct launcher credentials',()=>{
 assert.throws(()=>sandboxConfig({...env,MEDIA_SANDBOX_SNAPSHOT_ID:undefined,MEDIA_SANDBOX_IMAGE:'vercel/sandbox/node:24'}),/pinned/);
 assert.throws(()=>sandboxConfig({...env,MEDIA_SANDBOX_DISPATCHER_KEY:env.MEDIA_BROKER_KEY}),/separate/);
 assert.throws(()=>sandboxConfig({...env,SUPABASE_URL:'https://attacker.invalid'}),/backend/);
 assert.throws(()=>sandboxConfig({...env,VERCEL_ENV:undefined}),/environment/);
 assert.equal(sandboxConfig({...env,MEDIA_SANDBOX_SNAPSHOT_ID:undefined,MEDIA_SANDBOX_IMAGE:'vercel/sandbox/node@sha256:'+sha}).image.endsWith(sha),true);
});
test('sandbox is nonpersistent, has no ports, fixed resources and one allowed backend; VM receives no OIDC or dispatcher authority',()=>{
 const options=sandboxOptions(config,reservation,{token,teamId:config.teamId,projectId:config.projectId});
 assert.equal(options.persistent,false);assert.deepEqual(options.ports,[]);assert.deepEqual(options.resources,{vcpus:2});assert.equal(options.timeout,780000);assert.equal(options.region,'pdx1');assert.deepEqual(options.networkPolicy,{allow:['fixture.supabase.co']});assert.equal(options.env,undefined);
 const inside=workerEnvironment(config);assert.equal(inside.MEDIA_WORKER_MAX_INPUT_BYTES,'536870912');assert.equal(inside.MEDIA_WORKER_DISK_BYTES,'2147483648');assert.equal(inside.MEDIA_WORKER_DEADLINE_MS,'720000');assert.equal(Object.values(inside).includes(config.dispatcherKey),false);assert.equal(Object.values(inside).includes(token),false);
});
test('no queued work creates no sandbox and missing OIDC fails before database or provider calls',async()=>{
 const h=harness({queued:false});assert.equal((await h.dispatcher.tick(token)).state,'idle');assert.equal(h.calls.some(c=>c.create),false);
 const bad=harness();await assert.rejects(bad.dispatcher.tick(null),/oidc/);assert.equal(bad.calls.length,0);
});
test('reservation is attached before source or detached command starts and successful launch keeps VM running',async()=>{
 const h=harness();assert.equal((await h.dispatcher.tick(token)).state,'launched');
 const attach=h.calls.findIndex(c=>c.rpc==='attach_media_sandbox_v1');assert.ok(attach<h.calls.indexOf('write'));assert.equal(h.calls.includes('stop'),false);
 const command=h.calls.find(c=>c.runCommand).runCommand;assert.equal(command.detached,true);assert.equal(command.timeoutMs,735000);assert.deepEqual(command.args,['/vercel/sandbox/worker/sandbox-job.mjs']);
 assert.equal(h.calls.filter(c=>c.rpc==='attach_media_sandbox_v1').length,2);
});
test('failed source upload stops the VM in finally before closing the reservation',async()=>{
 const h=harness({writeFails:true});await assert.rejects(h.dispatcher.tick(token),/write_failed/);
 assert.ok(h.calls.indexOf('stop')<h.calls.findIndex(c=>c.rpc==='finish_media_sandbox_v1'));assert.equal(h.calls.some(c=>c.runCommand),false);
});
test('reaper never resumes a VM, stops finished command, then closes its exact session reservation',async()=>{
 const h=harness({queued:false,pending:[{...reservation,sessionId,commandId}],exitCode:0});await h.dispatcher.tick(token);
 assert.equal(h.calls.find(c=>c.get).get.resume,false);assert.ok(h.calls.indexOf('stop')<h.calls.findIndex(c=>c.rpc==='finish_media_sandbox_v1'));
 assert.equal(h.calls.find(c=>c.rpc==='finish_media_sandbox_v1').args.p_session_id,sessionId);
});
test('running and ambiguous provider states do not release a budget slot',async()=>{
 for(const getFails of [false,true]){
  const h=harness({queued:false,pending:[{...reservation,sessionId,commandId}],getFails});await h.dispatcher.tick(token);
  assert.equal(h.calls.includes('stop'),false);assert.equal(h.calls.some(c=>c.rpc==='finish_media_sandbox_v1'),false);
 }
});
test('provider-confirmed aborted sessions release their exact slot without command lookup or resume',async()=>{
 const h=harness({queued:false,pending:[{...reservation,sessionId,commandId}],status:'aborted'});await h.dispatcher.tick(token);
 assert.equal(h.calls.includes('getCommand'),false);assert.equal(h.calls.includes('stop'),false);
 assert.equal(h.calls.find(c=>c.rpc==='finish_media_sandbox_v1').args.p_session_id,sessionId);
});
test('aborted stop response closes the exact reservation while stopping remains unconfirmed',async()=>{
 const aborted=harness({writeFails:true,stopStatus:'aborted'});await assert.rejects(aborted.dispatcher.tick(token),/write_failed/);
 assert.equal(aborted.calls.some(c=>c.rpc==='finish_media_sandbox_v1'),true);
 const pending=harness({queued:false,pending:[{...reservation,sessionId,commandId}],exitCode:0,stopStatus:'stopping'});
 await assert.rejects(pending.dispatcher.tick(token),/stop_unconfirmed/);assert.equal(pending.calls.some(c=>c.rpc==='finish_media_sandbox_v1'),false);
});
test('session identity mismatch never stops or releases another provider session',async()=>{
 const h=harness({queued:false,pending:[{...reservation,sessionId,commandId}],status:'aborted',returnedSessionId:'sbx_different_12345'});
 await h.dispatcher.tick(token);assert.equal(h.calls.includes('stop'),false);assert.equal(h.calls.some(c=>c.rpc==='finish_media_sandbox_v1'),false);
});
test('current request OIDC rejects wrong project/team/environment, expired and not-yet-valid tokens before RPCs',async()=>{
 for(const invalid of ['header.payload.signature',jwt({...claims,project_id:'prj_other'}),jwt({...claims,owner_id:'team_other'}),jwt({...claims,environment:'production'}),jwt({...claims,exp:Math.floor(now/1000)+120}),jwt({...claims,nbf:Math.floor(now/1000)+3600})]){
  const h=harness();await assert.rejects(h.dispatcher.tick(invalid),/oidc/);assert.equal(h.calls.length,0);
 }
});
test('restricted provider transport pins current header token and prevents hidden mutation retries',async()=>{
 const sent=[],auth=requestSandboxCredentials(config,token,{now:()=>now,fetchImpl:async(url,options)=>{sent.push({url,options});return new Response('{}',{status:200});}});
 const query='?teamId='+config.teamId;
 const options={method:'POST',headers:{Authorization:'Bearer stale-sdk-refresh'},body:JSON.stringify({projectId:config.projectId,name:reservation.name,persistent:false})};
 await auth.fetch('https://vercel.com/api/v3/sandboxes'+query,options);
 assert.equal(sent.length,1);assert.equal(sent[0].options.headers.get('authorization'),'Bearer '+token);assert.equal(sent[0].options.redirect,'error');
 await assert.rejects(auth.fetch('https://vercel.com/api/v3/sandboxes'+query,options),/retry_blocked/);assert.equal(sent.length,1);
 for(const url of ['https://attacker.invalid/api/v3/sandboxes'+query,'http://vercel.com/api/v3/sandboxes'+query,'https://vercel.com/api/v3/sandboxes?teamId=team_other',`https://vercel.com/api/v2/sandboxes/${reservation.name}${query}&projectId=${config.projectId}&resume=true`])await assert.rejects(auth.fetch(url,options),/scope/);
 assert.equal(sent.length,1);
});
test('provider mutation 429/5xx and transport errors use SDK abort branch while read 404 remains observable',async()=>{
 for(const status of [429,503]){
  let calls=0;const auth=requestSandboxCredentials(config,token,{now:()=>now,fetchImpl:async()=>{calls++;return new Response('{}',{status});}});
  await assert.rejects(auth.fetch(`https://vercel.com/api/v2/sandboxes/sessions/${sessionId}/stop?teamId=${config.teamId}`,{method:'POST'}),e=>e.name==='AbortError');assert.equal(calls,1);
 }
 const auth=requestSandboxCredentials(config,token,{now:()=>now,fetchImpl:async()=>new Response('{}',{status:404})});
 assert.equal((await auth.fetch(`https://vercel.com/api/v2/sandboxes/${reservation.name}?teamId=${config.teamId}&projectId=${config.projectId}&resume=false`)).status,404);
});
test('dispatcher status reads its scoped DB aggregate and does not create or inspect a provider VM',async()=>{
 const h=harness();assert.deepEqual(await h.dispatcher.status(),{enabled:false,active_reservations:0,max_concurrency:1});
 assert.deepEqual(h.calls.map(c=>c.rpc),['media_sandbox_status_v1']);
});
test('actual SDK completes create, bound-session upload, detached launch and nonresuming reap through the restricted transport',async()=>{
 const previous=process.env.VERCEL_OIDC_TOKEN;
 // Deliberately a different valid token: SDK refresh must not replace the
 // invocation token on the outgoing request.
 process.env.VERCEL_OIDC_TOKEN=jwt({...claims,exp:4102444800});
 const wire=[],db=[],session={id:sessionId,memory:4096,vcpus:2,region:'pdx1',timeout:780000,status:'running',requestedAt:now,createdAt:now,updatedAt:now,cwd:'/vercel/sandbox',sourceSnapshotId:env.MEDIA_SANDBOX_SNAPSHOT_ID};
 const metadata={name:reservation.name,persistent:false,region:'pdx1',createdAt:now,updatedAt:now,currentSessionId:sessionId,status:'running'};
 const command={id:commandId,name:'node',args:['/vercel/sandbox/worker/sandbox-job.mjs'],cwd:'/vercel/sandbox',sessionId,exitCode:null,startedAt:now};
 const reply=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 let active=false,offered=false;
 const fetchImpl=async(url,options)=>{
  const path=new URL(url).pathname;wire.push({path,method:options.method||'GET'});
  assert.equal(options.headers.get('authorization'),'Bearer '+token);
  if(path==='/api/v3/sandboxes')return reply({sandbox:metadata,session,routes:[]});
  if(path.endsWith('/fs/mkdir'))return reply({});
  if(path.endsWith('/fs/write')){assert.ok(Buffer.isBuffer(options.body));assert.ok(options.body.length>0);return reply({});}
  if(path.endsWith('/cmd'))return reply({command});
  if(path.endsWith('/cmd/'+commandId))return reply({command:{...command,exitCode:0}});
  if(path.endsWith('/stop'))return reply({session:{...session,status:'stopped'},sandbox:{...metadata,status:'stopped'}});
  if(path.endsWith('/'+reservation.name)){assert.equal(new URL(url).searchParams.get('resume'),'false');return reply({sandbox:metadata,session,routes:[]});}
  throw Error('unexpected lifecycle API request');
 };
 const api={async rpc(name,args){db.push(name);if(name==='pending_media_sandboxes_v1')return active?[{...reservation,sessionId,commandId}]:[];if(name==='reserve_media_sandbox_v1'){if(offered)return null;offered=true;return reservation;}if(name==='attach_media_sandbox_v1'){if(args.p_command_id)active=true;return true;}if(name==='finish_media_sandbox_v1'){active=false;return true;}throw Error(name);}};
 try{
  const dispatcher=createSandboxDispatcher({config,Sandbox:ActualSandbox,api,fetchImpl,bundle:async()=>({files:[],sha256:sha}),now:()=>now,uuid:()=>runId});
  assert.equal((await dispatcher.tick(token)).state,'launched');assert.deepEqual(await dispatcher.tick(token),{state:'idle',stopped:1});
  assert.deepEqual(wire.map(x=>x.path),['/api/v3/sandboxes',`/api/v2/sandboxes/sessions/${sessionId}/fs/mkdir`,`/api/v2/sandboxes/sessions/${sessionId}/fs/write`,`/api/v2/sandboxes/sessions/${sessionId}/cmd`,`/api/v2/sandboxes/${reservation.name}`,`/api/v2/sandboxes/sessions/${sessionId}/cmd/${commandId}`,`/api/v2/sandboxes/sessions/${sessionId}/stop`]);
  assert.equal(db.filter(x=>x==='finish_media_sandbox_v1').length,1);
 }finally{if(previous===undefined)delete process.env.VERCEL_OIDC_TOKEN;else process.env.VERCEL_OIDC_TOKEN=previous;}
});
test('worker and gateway credentials cannot invoke any Sandbox lifecycle or budget operation',async()=>{
 const operations=[['sandbox_reserve',{p_run_id:runId,p_source_sha256:sha}],['sandbox_attach',{p_run_id:runId,p_session_id:sessionId,p_command_id:commandId}],['sandbox_pending',{}],['sandbox_finish',{p_run_id:runId,p_session_id:sessionId,p_exit_code:0}],['sandbox_status',{}]];
 for(const role of ['worker','gateway','dispatcher'])for(const [action,args] of operations){
  const seen=[];const handler=createMediaBroker({base:config.base,storage:{},rpc:async name=>{seen.push(name);return name==='authorize_media_broker_v2'?role:null;}});
  const response=await handler(new Request(config.base+'/functions/v1/media-broker',{method:'POST',headers:{Authorization:'Bearer '+env.MEDIA_BROKER_KEY,'X-Media-Request-ID':randomUUID(),'X-Media-Issued-At':new Date().toISOString(),'Content-Type':'application/json'},body:JSON.stringify({action,args})}));
  assert.equal(response.status,role==='dispatcher'?200:403);assert.equal(seen.length,role==='dispatcher'?2:1);
 }
});
test('pinned source bundle contains only the reviewed consumer and telemetry modules',async()=>{
 const a=await workerBundle(),b=await workerBundle();assert.equal(a.sha256,b.sha256);assert.equal(a.files.length,7);assert.equal(a.files.some(f=>f.path.includes('dispatcher')),false);assert.ok(a.files.every(f=>f.content instanceof Buffer));
});
test('resource parsers distinguish missing counters from zero and include actual memory',()=>{
 assert.equal(parseCpuStat('usage_usec 12345\nuser_usec 4\n'),12345);assert.equal(parseCpuStat(''),null);assert.deepEqual(parseMemory('MemTotal: 100 kB\nMemAvailable: 60 kB\n'),{total:102400,used:40960});
});

function serverHarness({sandboxMode=true,pinEnabled=false,environment='preview'}={}){
 const calls=[],cronSecret='fixture-cron-secret-'.repeat(3),serverConfig={cronSecret,diskBudgetBytes:471859200,maxInputBytes:134217728,deadlineMs:240000,threads:2};
 const handler=createWorkerHandler({config:serverConfig,env:{MEDIA_WORKER_RUNTIME:sandboxMode?'sandbox':'local',VERCEL_ENV:environment,MEDIA_SANDBOX_RUNTIME_PIN_ENABLED:pinEnabled?'true':'false'},
  api:{async rpc(name){calls.push(name);return{worker_enabled:false};}},worker:{active:false,async drain(){calls.push('local_drain');return{state:'ready'};}},
  dispatcherFactory:async()=>{calls.push('dispatcher_factory');return{async tick(value){calls.push({token:value});return{state:'launched'};},async status(){calls.push('dispatcher_status');return{enabled:false,active_reservations:1,vcpus:2,memory_mb:4096};}};},
  runtimePinFactory:async()=>{calls.push('pin_factory');return async input=>{calls.push({pin:input});return{status:200,body:{state:'pinned'}};};},
  controllerMetrics:async()=>({scratch_available_bytes:12345,process_rss_bytes:23456}),
 });
 const invoke=async(path,{method='GET',auth=true,oidc=token}={})=>{
  let status,body;const headers={...(auth?{authorization:'Bearer '+cronSecret}:{}),...(oidc?{'x-vercel-oidc-token':oidc}:{})};
  await handler({url:path,method,headers},{headersSent:false,writeHead(code){status=code;},end(value){body=JSON.parse(value);},destroy(){throw Error('unexpected_destroy');}});
  return{status,body};
 };
 return{calls,invoke,serverConfig};
}
test('authenticated Sandbox metrics separate controller measurements from configured worker limits and DB status',async()=>{
 const h=serverHarness(),result=await h.invoke('/metrics');assert.equal(result.status,200);assert.equal(result.body.runtime,'sandbox');
 assert.equal(result.body.controller.role,'dispatcher');assert.equal(result.body.controller.process_rss_bytes,23456);assert.equal(result.body.controller.scratch_available_bytes,12345);
 assert.equal(result.body.host,undefined);assert.equal(result.body.worker_limits.max_input_bytes,536870912);assert.equal(result.body.encoder_measurements,null);
 assert.equal(result.body.sandbox.active_reservations,1);assert.equal(h.calls.includes('dispatcher_status'),true);assert.equal(h.calls.some(c=>c.token),false);
 const unauth=serverHarness();assert.equal((await unauth.invoke('/metrics',{auth:false})).status,401);assert.equal(unauth.calls.length,0);
});
test('local mode keeps its actual worker limits and local drain behavior',async()=>{
 const h=serverHarness({sandboxMode:false});const result=await h.invoke('/metrics');
 assert.equal(result.body.runtime,'local');assert.equal(result.body.host.max_input_bytes,h.serverConfig.maxInputBytes);assert.equal(result.body.controller,undefined);
 assert.equal((await h.invoke('/drain')).body.state,'ready');assert.equal(h.calls.includes('local_drain'),true);assert.equal(h.calls.includes('dispatcher_factory'),false);
});
test('Sandbox drains pass each request token and share one controller factory without local encoding',async()=>{
 const h=serverHarness();const responses=await Promise.all([h.invoke('/drain'),h.invoke('/drain')]);
 assert.ok(responses.every(r=>r.status===202));assert.equal(h.calls.filter(c=>c==='dispatcher_factory').length,1);assert.equal(h.calls.filter(c=>c.token===token).length,2);assert.equal(h.calls.includes('local_drain'),false);
 const missing=serverHarness();assert.equal((await missing.invoke('/drain',{oidc:null})).status,503);assert.equal(missing.calls.length,0);
});
test('temporary runtime-pin route is preview-only, explicitly enabled, POST-only and CRON-authenticated',async()=>{
 for(const options of [{},{pinEnabled:true,environment:'production'}]){const h=serverHarness(options);assert.equal((await h.invoke('/runtime-pin',{method:'POST'})).status,404);assert.equal(h.calls.length,0);}
 const h=serverHarness({pinEnabled:true});assert.equal((await h.invoke('/runtime-pin')).status,405);assert.equal((await h.invoke('/runtime-pin',{method:'POST',auth:false})).status,401);assert.equal(h.calls.length,0);
 assert.equal((await h.invoke('/runtime-pin',{method:'POST'})).status,200);assert.equal(h.calls.filter(c=>c==='pin_factory').length,1);assert.equal(h.calls.find(c=>c.pin).pin.oidcToken,token);
});
