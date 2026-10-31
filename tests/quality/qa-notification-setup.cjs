const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ts=require('typescript');
const filename=path.resolve(__dirname,'../../supabase/ops/qa/notification-dispatch-setup/handler.ts');
const output=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exportsObject={};new Function('exports','require',output)(exportsObject,require);
const {createQaNotificationCredentialInstaller}=exportsObject;
const nonce='a'.repeat(64),nonceHash=crypto.createHash('sha256').update(nonce).digest('hex');
const serviceKey='synthetic-service-key-not-a-real-credential';
const receipt={installed:true,project_ref:'uaulhuelcfkjwojtymmw',ordinary:true,calls:true};
const request=(options={})=>new Request('https://example.invalid/setup',{method:'POST',headers:{Authorization:`Bearer ${nonce}`},...options});
function fixture(extra={}){const calls=[];return{calls,handler:createQaNotificationCredentialInstaller({projectUrl:'https://uaulhuelcfkjwojtymmw.supabase.co',serviceKey,nonceHash,armedAt:1000,expiresAt:601000,now:()=>2000,install:async(...args)=>{calls.push(args);return{data:receipt,error:null};},...extra})};}

test('only the prepared nonce authorizes the single narrow installer call',async()=>{
 const {handler,calls}=fixture();const response=await handler(request());assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0][0],nonceHash);assert.equal(calls[0][1],serviceKey);assert.equal(calls[0][2].aborted,false);
 const body=await response.text();assert.deepEqual(JSON.parse(body),{installed:true,ordinary:true,calls:true});assert.ok(!body.includes(serviceKey));assert.ok(!body.includes(nonce));assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('missing and wrong nonces fail before any privileged operation',async()=>{
 const {handler,calls}=fixture();for(const headers of [{},{Authorization:'Bearer wrong'},{Authorization:`Bearer ${'b'.repeat(64)}`}])assert.equal((await handler(request({headers}))).status,401);assert.equal(calls.length,0);
});
test('production, malformed configuration and invalid windows fail closed',async()=>{
 for(const extra of [{projectUrl:'https://prlkikhckbifseosbukl.supabase.co'},{serviceKey:'short'},{nonceHash:'bad'},{armedAt:3000},{expiresAt:2000},{expiresAt:601001},{armedAt:NaN}]){const {handler,calls}=fixture(extra);assert.equal((await handler(request())).status,410);assert.equal(calls.length,0);}
});
test('request bodies cannot select a target, key, account or SQL operation',async()=>{
 const {handler,calls}=fixture();assert.equal((await handler(request({body:JSON.stringify({target:'production',key:'override',sql:'anything'})}))).status,400);assert.equal(calls.length,0);
});
test('an empty HTTP body stream remains a zero-byte setup request',async()=>{
 const {handler,calls}=fixture();const body=new ReadableStream({start(controller){controller.close();}});assert.equal((await handler(request({body,duplex:'half'}))).status,200);assert.equal(calls.length,1);
});
test('non-POST methods cannot invoke setup',async()=>{
 const {handler,calls}=fixture();for(const method of ['GET','PUT','OPTIONS'])assert.equal((await handler(request({method}))).status,405);assert.equal(calls.length,0);
});
test('database failures and malformed acknowledgements return no sensitive details',async()=>{
 for(const result of [{data:null,error:{message:serviceKey}},{data:{...receipt,project_ref:'foreign'},error:null},{data:{...receipt,calls:false},error:null}]){const {handler}=fixture({install:async()=>result});const response=await handler(request());assert.equal(response.status,503);assert.ok(!(await response.text()).includes(serviceKey));}
});
test('the database single-use refusal is surfaced without automatic retry',async()=>{
 let installed=false,writes=0,attempts=0;const {handler}=fixture({install:async()=>{attempts++;if(installed)return{data:null,error:{message:'QA_SETUP_UNAVAILABLE'}};installed=true;writes++;return{data:receipt,error:null};}});
 assert.equal((await handler(request())).status,200);assert.equal((await handler(request())).status,503);assert.equal(writes,1);assert.equal(attempts,2);
});
test('an already interrupted caller never starts the privileged operation',async()=>{
 const controller=new AbortController();controller.abort();const {handler,calls}=fixture();assert.equal((await handler(request({signal:controller.signal}))).status,503);assert.equal(calls.length,0);
});
test('interruption during an uncertain setup does not retry or report success',async()=>{
 const controller=new AbortController();let calls=0;const {handler}=fixture({install:()=>{calls++;queueMicrotask(()=>controller.abort());return new Promise(()=>{});}});const response=await handler(request({signal:controller.signal}));assert.equal(response.status,503);assert.equal(calls,1);assert.match((await response.json()).error,/inspect its database status/);
});
