const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const cache=new Map();
function load(file){
 file=path.resolve(file);if(cache.has(file))return cache.get(file);
 const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const result={};cache.set(file,result);new Function('exports','require',output)(result,name=>name.endsWith('.ts')?load(path.resolve(path.dirname(file),name)):require(name));return result;
}
const {createNotificationEventDispatcher}=load(path.resolve(__dirname,'../../supabase/ops/qa/notification-event-dispatch/handler.ts.template'));
const ids={job:'10000000-0000-4000-8000-000000000001',event:'10000000-0000-4000-8000-000000000002',claim:'10000000-0000-4000-8000-000000000003'};
const token='a'.repeat(64),serviceKey='synthetic-server-key-never-used-with-a-provider',origin='https://uaulhuelcfkjwojtymmw.supabase.co';
const request=(body={jobId:ids.job,token},options={})=>new Request(origin+'/functions/v1/dispatch-notification-event',{method:'POST',body:JSON.stringify(body),...options});
function fixture(extra={}){const claims=[],finishes=[],fetches=[];return{claims,finishes,fetches,handler:createNotificationEventDispatcher({projectUrl:origin,serviceKey,
 claim:async(...args)=>{claims.push(args);return{data:{claimId:ids.claim,eventId:ids.event,kind:'notification'},error:null};},
 allowed:async()=>({data:true,error:null}),
 finish:async(...args)=>{finishes.push(args);return{data:true,error:null};},
 fetch:async(...args)=>{fetches.push(args);return new Response(JSON.stringify({accepted:1,rejected:0,unknown:0}));},...extra})};}

test('canonical DB claim controls the fixed target and all outgoing fields',async()=>{
 const f=fixture();const response=await f.handler(request());assert.equal(response.status,202);assert.deepEqual(await response.json(),{outcome:'accepted'});assert.equal(f.claims.length,1);
 assert.equal(f.fetches[0][0],origin+'/functions/v1/send-push-notification');assert.deepEqual(JSON.parse(f.fetches[0][1].body),{record:{id:ids.event}});assert.equal(f.fetches[0][1].headers.Authorization,`Bearer ${serviceKey}`);assert.equal(f.fetches[0][1].redirect,'error');assert.equal(f.finishes[0][2],'accepted');
});
test('only a canonical call claim selects the call endpoint',async()=>{
 const f=fixture({claim:async()=>({data:{claimId:ids.claim,eventId:ids.event,kind:'call'},error:null})});assert.equal((await f.handler(request())).status,202);assert.equal(f.fetches[0][0],origin+'/functions/v1/send-voip-push');assert.deepEqual(JSON.parse(f.fetches[0][1].body),{callId:ids.event});
});
test('arbitrary routing, recipient, body, credential and SQL fields fail before privileged lookup',async()=>{
 const f=fixture();for(const body of [{},{jobId:ids.job,token:'bad'},{jobId:ids.job,token,target:'https://example.invalid'},{jobId:ids.job,token,recipient_id:ids.event},{jobId:ids.job,token,body:'anything'},{jobId:ids.job,token,Authorization:serviceKey},{jobId:ids.job,token,sql:'anything'}])assert.equal((await f.handler(request(body))).status,401);assert.equal(f.claims.length,0);assert.equal(f.fetches.length,0);
});
test('expired, stale and replayed claims never reach the downstream service',async()=>{
 const f=fixture({claim:async()=>({data:null,error:null})});assert.equal((await f.handler(request())).status,401);assert.equal(f.fetches.length,0);assert.equal(f.finishes.length,0);
});
test('a pause or legacy-mode switch after claim prevents forwarding, but still records the skip',async()=>{
 const f=fixture({allowed:async()=>({data:false,error:null})});assert.equal((await f.handler(request())).status,202);assert.equal(f.fetches.length,0);assert.equal(f.finishes[0][2],'skipped');
});
test('an unavailable recheck records uncertainty instead of forwarding or reusing the token',async()=>{
 const f=fixture({allowed:async()=>({data:null,error:{message:serviceKey}})});assert.equal((await f.handler(request())).status,502);assert.equal(f.fetches.length,0);assert.equal(f.finishes[0][2],'unknown');
});
test('invalid DB receipts cannot choose another target or an arbitrary event',async()=>{
 for(const data of [{claimId:ids.claim,eventId:'invalid',kind:'call'},{claimId:ids.claim,eventId:ids.event,kind:'https://other.invalid'},{claimId:'bad',eventId:ids.event,kind:'call'}]){const f=fixture({claim:async()=>({data,error:null})});assert.equal((await f.handler(request())).status,401);assert.equal(f.fetches.length,0);}
});
test('production and missing service configuration are refused before any claim',async()=>{
 for(const extra of [{projectUrl:'https://prlkikhckbifseosbukl.supabase.co'},{serviceKey:'short'}]){const f=fixture(extra);assert.equal((await f.handler(request())).status,503);assert.equal(f.claims.length,0);}
});
test('method and body size bounds reject oversized inputs without dispatch',async()=>{
 const f=fixture();assert.equal((await f.handler(new Request(origin,{method:'GET'}))).status,405);assert.equal((await f.handler(request({jobId:ids.job,token,large:'x'.repeat(2048)}))).status,401);assert.equal(f.claims.length,0);
});
test('uncertain provider outcomes remain one-shot and never echo sensitive failure bodies',async()=>{
 let calls=0;const f=fixture({fetch:async()=>{calls++;return new Response(serviceKey+token,{status:503});}});const response=await f.handler(request());assert.equal(response.status,502);assert.deepEqual(await response.json(),{outcome:'unknown'});assert.equal(calls,1);assert.equal(f.finishes[0][2],'unknown');
});
test('recipient skip and provider rejection are persisted with exact terminal outcomes',async()=>{
 for(const [receipt,outcome,status] of [[{skipped:true,reason:'no registered devices'},'skipped',202],[{accepted:0,rejected:1,unknown:0},'failed',502],[{accepted:0,rejected:0,unknown:1},'unknown',502],[{accepted:0,rejected:0,unknown:0},'skipped',202]]){const f=fixture({fetch:async()=>new Response(JSON.stringify(receipt))});assert.equal((await f.handler(request())).status,status);assert.equal(f.finishes[0][2],outcome);}
});
test('failed acknowledgement never reports completion or retries the forward call',async()=>{
 const f=fixture({finish:async()=>({data:false,error:null})});const response=await f.handler(request());assert.equal(response.status,503);assert.match((await response.json()).error,/Inspect/);assert.equal(f.fetches.length,1);
});
test('cancellation before lookup or while the claim result is uncertain never forwards',async()=>{
 const before=new AbortController();before.abort();const first=fixture();assert.equal((await first.handler(request(undefined,{signal:before.signal}))).status,503);assert.equal(first.claims.length,0);
 const during=new AbortController();const f=fixture({claim:async()=>{queueMicrotask(()=>during.abort());return{data:{claimId:ids.claim,eventId:ids.event,kind:'notification'},error:null};}});assert.equal((await f.handler(request(undefined,{signal:during.signal}))).status,503);assert.equal(f.fetches.length,0);
});
test('cancellation during forwarding records uncertainty using an independent acknowledgement deadline',async()=>{
 const controller=new AbortController();const f=fixture({fetch:async()=>{controller.abort();return new Promise(()=>{});}});
 const response=await f.handler(request(undefined,{signal:controller.signal}));assert.equal(response.status,502);assert.equal(f.finishes.length,1);assert.equal(f.finishes[0][2],'unknown');assert.equal(f.finishes[0][3].aborted,false);
});
