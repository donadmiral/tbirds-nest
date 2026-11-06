const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');const sdk=require(createRequire(require('path').resolve('web/package.json')).resolve('@supabase/supabase-js'));
const {createProofTransport}=require('../supabase/functions/media-content/proofTransport.ts');
const {createMediaContentHandler}=require('../supabase/functions/media-content/handler.ts');
const bucket='post-media',path='10000000-0000-4000-8000-000000000001/fixture.jpg',token='a'.repeat(64),base='https://synthetic.supabase.co',valid={bucket,path,version:'1',expiresAt:'2099-01-01'};
const abortWait=signal=>new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})});
function fixture(answers,{budget=1400,variant=false,timeout=20,scoped=false}={}){
 const events=[],calls=[];let upstream=0,start;const started=new Promise(resolve=>start=resolve);
 const transport=createProofTransport(async(input,options)=>{
   const choice=answers[calls.length];calls.push(new URL(input).pathname.split('/').pop());start();
   if(choice==='headers')return abortWait(options.signal);
   if(choice==='body')return new Response(new ReadableStream({async pull(c){try{await abortWait(options.signal)}catch{c.error(options.signal.reason)}}}));
   if(choice==='network')throw Error('temporary unavailable');
   if(choice==='invalid')return new Response('{');
   if(choice==='http')return new Response('{}',{status:503});
   if(choice==='denied-http')return new Response('{}',{status:403});
   assert.notEqual(choice,undefined,'unexpected resolver read');return Response.json(choice);
 },'synthetic-service',(fn)=>((u,i)=>fn(u,{...i,signal:AbortSignal.any([i.signal,AbortSignal.timeout(timeout)])})));
 const client=sdk.createClient(base,'synthetic-service',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport.fetch}});
 const h=createMediaContentHandler({base,serviceKey:'synthetic-service',diagnostic:e=>events.push(e),startupTimeoutMs:budget,
   resolve:(t,b,p,s,stage,ctx)=>transport.run(stage,ctx,s,a=>client.rpc('resolve_media_delivery',{p_token:t,p_bucket:b,p_path:p}).abortSignal(a)),
   ...(variant?{resolveVariant:(t,b,p,v,s,stage,ctx)=>transport.run(stage,ctx,s,a=>client.rpc('resolve_media_variant_for_ticket_v1',{}).abortSignal(a))}:{}),
   ...(scoped?{readRepresentation:(t,b,p,v,kind,s,stage,ctx)=>transport.run(stage,ctx,s,a=>client.rpc('read_post_representation_v1',{p_token:t,p_bucket:b,p_path:p,p_source_version:v,p_kind:kind}).abortSignal(a))}:{}),
   fetch:async()=>{upstream++;return new Response('private',{headers:{'Content-Type':scoped?'video/mp4':'image/jpeg','Content-Length':'7','ETag':'"etag"'}});}});
 return {events,calls,started,upstream:()=>upstream,send:s=>h(new Request(`${base}/functions/v1/media-content/${bucket}/${path}?token=${token}${scoped?'&representation=compatible':''}`,{signal:s}))};
}
for(const phase of ['headers','body'])test(`SDK ${phase} deadline: a fresh authorized read recovers inside the original request`,async()=>{
 const f=fixture([phase,valid,valid]);const r=await f.send();assert.equal(r.status,200);assert.equal(await r.text(),'private');assert.equal(f.calls.length,3);assert.equal(f.upstream(),1);
 const d=f.events.find(e=>e.outcome==='ready');assert.equal(d.resolver[0].result,'transport_timeout');assert.equal(d.resolver[0].phase,phase);
 assert.deepEqual(d.resolver.map(a=>[a.stage,a.attempt]),[['authorization',1],['authorization',2],['revalidation',1]]);
 assert.equal(JSON.stringify(d).includes(path),false);assert.equal(JSON.stringify(d).includes(token),false);
});
for(const changed of [null,{...valid,version:'2'}])test(`revalidation timeout followed by ${changed?'replacement':'refusal'} releases no media`,async()=>{
 const f=fixture([valid,'body',changed]);const r=await f.send();assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/private/);assert.equal(f.calls.length,3);assert.equal(f.upstream(),1);assert.equal(f.events.at(-1).bytesRead,0);
});
for(const [input,status] of [[null,403],['invalid',503],['http',503],['denied-http',503],['network',503]])test(`no repeat after ${input} resolver result`,async()=>{
 const f=fixture([input]);assert.equal((await f.send()).status,status);assert.equal(f.calls.length,1);assert.equal(f.upstream(),0);
});
test('only one repeat for the entire request even when the second proof also times out',async()=>{const f=fixture(['headers',valid,'body']);assert.equal((await f.send()).status,503);assert.equal(f.calls.length,3);assert.equal(f.events.at(-1).bytesRead,0);});
test('variant lookup timeout has its own stage and never repeats',async()=>{const f=fixture([valid,'headers'],{variant:true});assert.equal((await f.send()).status,503);assert.deepEqual(f.calls,['resolve_media_delivery','resolve_media_variant_for_ticket_v1']);assert.equal(f.events.at(-1).stage,'variant_selection');});
test('low remaining budget or caller cancellation never triggers a repeat',async()=>{const f=fixture(['body'],{budget:950});assert.equal((await f.send()).status,503);assert.equal(f.calls.length,1);const g=fixture(['headers']);const c=new AbortController();const run=g.send(c.signal);await g.started;c.abort();assert.equal((await run).status,499);assert.equal(g.calls.length,1);});
test('a different RPC cannot use the resolver transport even when called by mistake',async()=>{
 let calls=0;const t=createProofTransport(async()=>{calls++;return Response.json({});},'synthetic-service');
 const client=sdk.createClient(base,'synthetic-service',{global:{fetch:t.fetch},auth:{autoRefreshToken:false,persistSession:false}});
 await assert.rejects(t.run('authorization',{until:Date.now()+12000,retried:false,attempts:[]},new AbortController().signal,s=>client.rpc('some_mutation',{}).abortSignal(s)));assert.equal(calls,0);
});
const derived={sourceBucket:bucket,sourcePath:path,sourceVersion:'1',expiresAt:valid.expiresAt,bucket:'adaptive-media',
path:path.split('/')[0]+'/_renditions_v2/20000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000003/fallback.mp4',version:'2',etag:'etag'};
for(const phase of ['headers','body'])for(const initial of [true,false])test('scoped '+(initial?'initial':'post-storage')+' proof recovers one '+phase+' deadline on the installed SDK',async()=>{
 const f=fixture(initial?[phase,derived,derived]:[derived,phase,derived],{scoped:true});
 const r=await f.send();assert.equal(r.status,200);assert.equal(await r.text(),'private');assert.equal(f.upstream(),1);
 assert.deepEqual(f.calls,Array(3).fill('read_post_representation_v1'));const a=f.events.find(e=>e.outcome==='ready').resolver;
 assert.equal(a[initial?0:1].phase,phase);assert.deepEqual(a.map(x=>x.stage),initial?['scoped_authorization','scoped_authorization','scoped_revalidation']:['scoped_authorization','scoped_revalidation','scoped_revalidation']);
});
test('scoped refusals, revocation, hard errors, aborted requests and exhausted shared budget deliver no bytes',async()=>{
 for(const [answers,status,calls] of [[[null],403,1],[['denied-http'],503,1],[[derived,'body',null],410,3],[['body',derived,'headers'],503,3]]){
  const f=fixture(answers,{scoped:true});const r=await f.send();assert.equal(r.status,status);assert.equal(f.calls.length,calls);assert.doesNotMatch(await r.text(),/private/);
 }
 const f=fixture(['headers'],{scoped:true}),ac=new AbortController(),p=f.send(ac.signal);await f.started;ac.abort();assert.equal((await p).status,499);assert.equal(f.calls.length,1);
});
