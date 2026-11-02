const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(relative) {
 const filename=path.join(__dirname,'..',relative),exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Request,Response,Headers,URL,ReadableStream,AbortController,AbortSignal,crypto:require('node:crypto').webcrypto,
   setTimeout,clearTimeout,fetch,require:reference=>load(path.relative(path.join(__dirname,'..'),path.resolve(path.dirname(filename),reference)))});
 return exports;
}
const delivery=load('shared/mediaDelivery.ts'),content=load('shared/contentMedia.ts');
const create=load('supabase/functions/media-content/handler.ts').createMediaContentHandler;
const createContent=load('supabase/functions/content-media-sign/handler.ts').createContentMediaHandler;
const origin='https://qa.supabase.co',bucket='post-media',objectPath='10000000-0000-4000-8000-000000000001/photo.jpg',token='a'.repeat(64);
const url=delivery.mediaDeliveryUrl(origin,bucket,objectPath,token);
function harness(options={}) {
 const reads=[],grants=[],signals=[],events=[];let cancelled=0;
 const proof={bucket,path:objectPath,version:'object-version',expiresAt:new Date(Date.now()+300000).toISOString()};
 const handler=create({base:origin,serviceKey:'server-secret',randomId:()=>`read-${reads.length}`,
  startupTimeoutMs:options.startupTimeoutMs,streamIdleTimeoutMs:options.streamIdleTimeoutMs,diagnostic:event=>events.push(event),
  resolveVariant:options.resolveVariant,
  resolve:async(...args)=>{
   grants.push(args);
   if(options.resolve)return options.resolve({...proof},grants.length,args[3]);
   if(options.resolveError===grants.length)throw new Error('database secret');
   return options.denied||options.revoke===grants.length?null:{...proof,...(options.replace===grants.length?{version:'changed'}:{})};
  },fetch:async(href,init)=>{
   reads.push({href,init});signals.push(init.signal);
   if(options.fetch)return options.fetch(href,init);
   const status=options.status||200;
   const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('private-bytes'));if(!options.openStream)controller.close();},cancel(){cancelled++;}});
   return new Response(body,{status,headers:{'Content-Type':options.mime||'image/jpeg','Content-Length':'13','Accept-Ranges':'bytes',...(status===206?{'Content-Range':'bytes 0-12/100'}:{}),...(status===416?{'Content-Range':'bytes */100'}:{})}});
  }});
 return {handler,reads,grants,signals,events,cancelled:()=>cancelled};
}
test('capabilities are pinned to the configured origin, object and opaque token',()=>{
 const loc=delivery.mediaDeliveryObject(url,origin);assert.equal(loc.key,`${bucket}/${objectPath}`);
 assert.equal(delivery.isMediaDeliveryCapability(url,origin),true);assert.equal(content.isContentCapability(url,origin),true);
 for(const value of [url.replace(origin,'https://evil.test'),url.replace(token,'short'),url.replace('photo.jpg','%252e%252e/secret')])assert.equal(delivery.isMediaDeliveryCapability(value,origin),false);
});
test('private delivery images do not use persistent disk cache',()=>{
 for(const value of [url,`${origin}/functions/v1/limited-media-file?messageId=one`,`${origin}/storage/v1/object/sign/chat-media/${objectPath}?token=secret`])assert.equal(delivery.privateImageCachePolicy(value),'none');
 assert.equal(delivery.privateImageCachePolicy(`${origin}/storage/v1/object/public/avatars/public.jpg`),'memory-disk');
});
test('bytes stream only after two current proof checks; secrets and cache headers never escape',async()=>{
 const h=harness(),result=await h.handler(new Request(url));
 assert.equal(result.status,200);assert.equal(await result.text(),'private-bytes');assert.equal(h.grants.length,2);
 assert.equal(h.reads[0].init.headers.Authorization,'Bearer server-secret');assert.equal(h.reads[0].init.redirect,'error');assert.equal(h.reads[0].init.cache,'no-store');
 const upstream=new URL(h.reads[0].href);assert.equal(upstream.origin,origin);assert.equal(upstream.searchParams.get('cacheNonce'),'object-version-read-0');
 for(const name of ['Cache-Control','CDN-Cache-Control'])assert.match(result.headers.get(name),/no-store/);
 assert.match(result.headers.get('Content-Security-Policy'),/sandbox/);assert.equal(result.headers.get('Authorization'),null);assert.equal(result.headers.get('apikey'),null);
});
test('forged capabilities and denied proofs cannot cause a privileged fetch',async()=>{
 for(const value of [url.replace(token,'bad'),url.replace('/post-media/','/application-cvs/'),url.replace('photo.jpg','%252e%252e/secret')]){
  const h=harness();assert.ok((await h.handler(new Request(value))).status>=400);assert.equal(h.reads.length,0);
 }
 const h=harness({denied:true});assert.equal((await h.handler(new Request(url))).status,403);assert.equal(h.reads.length,0);
});
test('all single-range forms work and invalid reversed/empty/multi/zero ranges stop before Storage',async()=>{
 for(const range of ['bytes=0-12','bytes=0-','bytes=-12']){const h=harness({status:206}),response=await h.handler(new Request(url,{headers:{Range:range}}));assert.equal(response.status,206);assert.equal(h.reads[0].init.headers.Range,range);await response.body.cancel();}
 for(const range of ['bytes=-0','bytes=10-9','bytes=0-1,3-4','bytes=-','bytes=','bytes=0-'+ '9'.repeat(90)]){const h=harness();assert.equal((await h.handler(new Request(url,{headers:{Range:range}}))).status,416);assert.equal(h.reads.length,0);}
});
test('upstream range failures stay 416 and a missing file is 410',async()=>{
 const h=harness({status:416}),response=await h.handler(new Request(url,{headers:{Range:'bytes=500-'}}));assert.equal(response.status,416);assert.equal(response.headers.get('Content-Range'),'bytes */100');
 assert.equal((await harness({status:404}).handler(new Request(url))).status,410);
 assert.equal((await harness({status:500}).handler(new Request(url))).status,503);
});
test('revocation, object replacement or proof failure while fetching suppresses all bytes',async()=>{
 for(const options of [{revoke:2},{replace:2},{resolveError:2}]){
  const h=harness({...options,openStream:true}),response=await h.handler(new Request(url));assert.ok(response.status>=400);assert.equal(h.cancelled(),1);assert.doesNotMatch(await response.text(),/private-bytes|database secret|server-secret/);
 }
});
test('active HTML and SVG payloads cannot be served as private attachments',async()=>{
 for(const mime of ['text/html','image/svg+xml','application/javascript']){const h=harness({mime,openStream:true});assert.equal((await h.handler(new Request(url))).status,415);assert.equal(h.cancelled(),1);}
});
test('HEAD fetches only headers while preserving no-store and range metadata',async()=>{
 const h=harness(),response=await h.handler(new Request(url,{method:'HEAD'}));assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(h.reads[0].init.method,'HEAD');assert.equal(h.grants.length,2);
});
test('consumer cancellation aborts the active upstream download',async()=>{
 const h=harness({openStream:true}),response=await h.handler(new Request(url));await response.body.cancel('viewer closed');assert.equal(h.signals[0].aborted,true);assert.equal(h.cancelled(),1);
});
test('request cancellation reaches a pending Storage fetch',async()=>{
 const controller=new AbortController();let started;
 const ready=new Promise(resolve=>started=resolve);
 const h=harness({fetch:(_href,init)=>new Promise((_resolve,reject)=>{started();init.signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true});})});
 const pending=h.handler(new Request(url,{signal:controller.signal}));await ready;controller.abort('closed');assert.equal((await pending).status,499);assert.equal(h.signals[0].aborted,true);
});
test('new clients explicitly opt into no-store delivery, with no signed or public fallback',async()=>{
 const canonical=`${origin}/storage/v1/object/public/${bucket}/${objectPath}`;let signs=0,delivers=0;
 const handler=createContent({base:origin,authenticate:async()=>true,manifest:async()=>[{media_url:canonical}],sign:async()=>{signs++;return[];},deliver:async()=>{delivers++;return{urls:[{key:`${bucket}/${objectPath}`,url}],expiresAt:Date.now()+300000};}});
 const body={references:[{kind:'post',id:'10000000-0000-4000-8000-000000000002'}],delivery:'no-store'};
 const result=await handler(new Request(origin,{method:'POST',body:JSON.stringify(body)}));assert.equal(result.status,200);assert.equal((await result.json()).urls[0].url,url);assert.equal(delivers,1);assert.equal(signs,0);
 const missing=createContent({base:origin,authenticate:async()=>true,manifest:async()=>[{media_url:canonical}],sign:async()=>{signs++;return[];}});
 assert.equal((await missing(new Request(origin,{method:'POST',body:JSON.stringify(body)}))).status,503);assert.equal(signs,0);
});
test('a legacy client retains its reviewed signed-URL contract during staged migration',async()=>{
 const canonical=`${origin}/storage/v1/object/public/${bucket}/${objectPath}`,signed=`${origin}/storage/v1/object/sign/${bucket}/${objectPath}?token=legacy`;let signs=0;
 const handler=createContent({base:origin,authenticate:async()=>true,manifest:async()=>[{media_url:canonical}],sign:async()=>{signs++;return[{path:objectPath,signedUrl:signed}];}});
 const response=await handler(new Request(origin,{method:'POST',body:JSON.stringify({references:[{kind:'post',id:'10000000-0000-4000-8000-000000000002'}]})}));
 assert.equal(response.status,200);assert.equal((await response.json()).urls[0].url,signed);assert.equal(signs,1);
});

test('initial authorization is cancel-aware even when its network promise never settles',{timeout:1000},async()=>{
 const controller=new AbortController();let signal,started;
 const ready=new Promise(resolve=>started=resolve);
 const h=harness({resolve:(_proof,_count,current)=>{signal=current;started();return new Promise(()=>{});}});
 const pending=h.handler(new Request(url,{signal:controller.signal}));await ready;controller.abort('viewer closed');
 assert.equal((await pending).status,499);assert.equal(signal.aborted,true);assert.equal(h.reads.length,0);
 assert.equal(h.events[0].stage,'authorization');assert.equal(h.events[0].outcome,'aborted');
});

test('a stalled proof after Storage headers reaches a deadline without waiting for upstream cancellation',{timeout:1000},async()=>{
 let cancelled=0,proofSignal;
 const h=harness({startupTimeoutMs:20,resolve:(proof,count,signal)=>{proofSignal=signal;return count===2?new Promise(()=>{}):proof;},
  fetch:async()=>new Response(new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}}),{headers:{'Content-Type':'video/mp4','Content-Length':'10'}})});
 const response=await h.handler(new Request(url));assert.equal(response.status,503);assert.equal(cancelled,1);assert.equal(proofSignal.aborted,true);
 const event=h.events.find(item=>item.outcome==='timeout');assert.equal(event.stage,'revalidation');assert.ok(event.timings.revalidation>=0);
 assert.doesNotMatch(JSON.stringify(h.events),/server-secret|private-bytes|token=|photo\.jpg/);
});

test('Storage headers without a first media byte cannot leave the viewer waiting for a minute',{timeout:1000},async()=>{
 let cancelled=0;
 const h=harness({startupTimeoutMs:20,fetch:async()=>new Response(new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}}),{headers:{'Content-Type':'video/mp4','Content-Length':'10'}})});
 const response=await h.handler(new Request(url));assert.equal(response.status,503);assert.equal(h.grants.length,2);assert.equal(cancelled,1);assert.equal(h.signals[0].aborted,true);
 assert.equal(h.events.find(item=>item.outcome==='timeout').stage,'first_byte');assert.match(response.headers.get('Cache-Control'),/no-store/);
});

test('client cancellation after headers cancels a pending first-byte read immediately',{timeout:1000},async()=>{
 const controller=new AbortController();let ready;
 const started=new Promise(resolve=>ready=resolve);
 const h=harness({fetch:async()=>new Response(new ReadableStream({pull(){ready();return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}),{headers:{'Content-Type':'video/mp4','Content-Length':'10'}})});
 const pending=h.handler(new Request(url,{signal:controller.signal}));await started;await new Promise(resolve=>setImmediate(resolve));controller.abort('closed');
 assert.equal((await pending).status,499);assert.equal(h.signals[0].aborted,true);
});

test('a stream that stops making progress is released even if cancellation never resolves',{timeout:1000},async()=>{
 let cancelled=0;
 const h=harness({streamIdleTimeoutMs:20,fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('first'));},cancel(){cancelled++;return new Promise(()=>{});}}),{headers:{'Content-Type':'video/mp4','Content-Length':'10'}})});
 const response=await h.handler(new Request(url));assert.equal(response.status,200);const reader=response.body.getReader();
 assert.equal(new TextDecoder().decode((await reader.read()).value),'first');await assert.rejects(()=>reader.read(),/interrupted/);
 assert.equal(cancelled,1);assert.equal(h.signals[0].aborted,true);const event=h.events.find(item=>item.outcome==='timeout');assert.equal(event.stage,'stream');assert.equal(event.bytesRead,5);
});

test('a prewarmed or paused player can leave queued bytes unread beyond the upstream inactivity deadline',{timeout:2000},async()=>{
 const h=harness({startupTimeoutMs:20,streamIdleTimeoutMs:20,fetch:async()=>new Response(new ReadableStream({start(c){for(const part of ['one','two','end'])c.enqueue(new TextEncoder().encode(part));c.close();}}),{headers:{'Content-Type':'video/mp4','Content-Length':'9'}})});
 const response=await h.handler(new Request(url));await new Promise(resolve=>setTimeout(resolve,45));
 assert.equal(h.signals[0].aborted,false,'An unread prewarmed response has no pending upstream read');
 const reader=response.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'one');
 await new Promise(resolve=>setTimeout(resolve,45));assert.equal(h.signals[0].aborted,false,'A buffered chunk can wait while the player is paused');
 assert.equal(new TextDecoder().decode((await reader.read()).value),'two');assert.equal(new TextDecoder().decode((await reader.read()).value),'end');assert.equal((await reader.read()).done,true);
 assert.equal(h.events.some(item=>item.outcome==='timeout'),false);
});

test('a late Storage response after the header deadline is discarded and cancelled',{timeout:1000},async()=>{
 let release,cancelled=0;
 const h=harness({startupTimeoutMs:20,fetch:()=>new Promise(resolve=>release=resolve)});
 const response=await h.handler(new Request(url));assert.equal(response.status,503);assert.equal(h.events[0].stage,'storage_headers');
 release(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'Content-Type':'video/mp4','Content-Length':'10'}}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);assert.equal(h.grants.length,1);
});

test('longer healthy streams use an inactivity limit rather than the startup or total-duration budget',{timeout:2000},async()=>{
 let timer;
 const h=harness({startupTimeoutMs:20,streamIdleTimeoutMs:60,fetch:async()=>new Response(new ReadableStream({
  start(c){let i=0;const send=()=>{c.enqueue(new TextEncoder().encode(String(i++)));if(i<5)timer=setTimeout(send,20);else c.close();};send();},
  cancel(){clearTimeout(timer);},
 }),{headers:{'Content-Type':'video/mp4','Content-Length':'5'}})});
 const before=Date.now(),response=await h.handler(new Request(url));assert.equal(await response.text(),'01234');assert.ok(Date.now()-before>=60);
 assert.equal(h.events.some(item=>item.outcome==='timeout'),false);assert.equal(h.events.at(-1).outcome,'complete');
});

test('a complete advertised byte length closes without waiting for an extra stalled EOF',{timeout:1000},async()=>{
 let cancelled=0;
 const h=harness({fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('all-bytes'));},cancel(){cancelled++;return new Promise(()=>{});}}),{headers:{'Content-Type':'video/mp4','Content-Length':'9'}})});
 const response=await h.handler(new Request(url));assert.equal(response.headers.get('Content-Length'),'9');assert.equal(await response.text(),'all-bytes');assert.equal(cancelled,1);
 assert.equal(h.events.at(-1).outcome,'complete');assert.equal(h.events.at(-1).bytesRead,9);
});

test('truncated, excess and mismatched Range bodies cannot masquerade as a completed media response',{timeout:1000},async()=>{
 const short=harness({fetch:async()=>new Response('short',{headers:{'Content-Type':'video/mp4','Content-Length':'10'}})});
 const shortResponse=await short.handler(new Request(url));assert.equal(shortResponse.status,200);await assert.rejects(()=>shortResponse.text(),/interrupted/);
 assert.equal(short.events.at(-1).outcome,'error');
 const extra=harness({fetch:async()=>new Response('too-long',{headers:{'Content-Type':'video/mp4','Content-Length':'2'}})});
 assert.equal((await extra.handler(new Request(url))).status,503);
 const range=harness({fetch:async()=>new Response('data',{status:206,headers:{'Content-Type':'video/mp4','Content-Length':'4','Content-Range':'bytes 0-12/100'}})});
 assert.equal((await range.handler(new Request(url,{headers:{Range:'bytes=0-12'}}))).status,503);
});

test('identity encoding, redirect refusal and exact Range bytes preserve safe player headers',async()=>{
 const ranged=harness({status:206});const response=await ranged.handler(new Request(url,{headers:{Range:'bytes=0-12'}}));
 assert.equal(await response.text(),'private-bytes');assert.equal(response.headers.get('Content-Length'),'13');assert.equal(response.headers.get('Content-Range'),'bytes 0-12/100');assert.equal(response.headers.get('Accept-Ranges'),'bytes');
 assert.equal(ranged.reads[0].init.headers['Accept-Encoding'],'identity');assert.equal(ranged.reads[0].init.headers.Range,'bytes=0-12');assert.equal(ranged.grants.length,2);
 assert.match(response.headers.get('Server-Timing'),/authorization;dur=.*storage_headers;dur=.*revalidation;dur=.*first_byte;dur=/);
 for(const header of ['Cache-Control','CDN-Cache-Control'])assert.match(response.headers.get(header),/no-store/);
 const encoded=harness({fetch:async()=>new Response('decoded-content',{headers:{'Content-Type':'video/mp4','Content-Encoding':'gzip','Content-Length':'4'}})});
 assert.equal((await encoded.handler(new Request(url))).status,503);
 const redirected=harness({fetch:async()=>{const result=new Response('bytes',{headers:{'Content-Type':'video/mp4'}});Object.defineProperty(result,'redirected',{value:true});return result;}});
 assert.equal((await redirected.handler(new Request(url))).status,503);assert.equal(redirected.reads[0].init.redirect,'error');
});

test('the deployed entrypoint forwards the request cancellation signal into both proof RPCs',async()=>{
 let deps,received;
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../supabase/functions/media-content/index.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports:{},fetch,Headers,console:{warn(){}},Deno:{env:{get:()=>origin},serve(){}},require(name){
  if(name==='npm:@supabase/supabase-js@2.112.3')return{createClient:()=>({rpc:()=>({abortSignal(signal){received=signal;return Promise.resolve({data:null,error:null});}})})};
  if(name==='./handler.ts')return{createMediaContentHandler(value){deps=value;return()=>{};}};
  if(name==='../_shared/serviceRoleFetch.ts')return load('supabase/functions/_shared/serviceRoleFetch.ts');throw Error(name);
 }});
 const controller=new AbortController();await deps.resolve(token,bucket,objectPath,controller.signal);assert.equal(received,controller.signal);
});

const variant={bucket:'derived-media',path:'10000000-0000-4000-8000-000000000001/_derived_v1/20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001.mp4',version:'derived-version',etag:'derived-etag',sourceVersion:'object-version'};
function variantFetch(href,init){const ranged=!!init.headers.Range;return new Response(init.method==='HEAD'?null:'private-bytes',{status:ranged?206:200,headers:{'Content-Type':'video/mp4','Content-Length':'13','Accept-Ranges':'bytes',ETag:'"derived-etag"',...(ranged?{'Content-Range':'bytes 0-12/100'}:{})}});}
test('variant selection occurs only after original access and never exposes a sibling redirect',async()=>{
 let choices=0;const denied=harness({denied:true,resolveVariant:async()=>{choices++;return variant;}});assert.equal((await denied.handler(new Request(url))).status,403);assert.equal(choices,0);
 const h=harness({resolveVariant:async(...args)=>{choices++;assert.equal(args[0],token);assert.equal(args[3],'object-version');return variant;},fetch:variantFetch});
 const result=await h.handler(new Request(url));assert.equal(result.status,200);assert.equal(await result.text(),'private-bytes');assert.ok(new URL(h.reads[0].href).pathname.endsWith(variant.path));assert.equal(result.headers.get('Location'),null);assert.match(result.headers.get('Cache-Control'),/no-store/);assert.equal(h.grants.length,2);
});
test('HEAD, GET and Range share a stable representation tag; If-Range mismatch requests the whole selected file',async()=>{
 const h=harness({resolveVariant:async()=>variant,fetch:variantFetch});const first=await h.handler(new Request(url));const etag=first.headers.get('ETag');await first.body.cancel();
 const head=await h.handler(new Request(url,{method:'HEAD'}));assert.equal(head.headers.get('ETag'),etag);assert.equal(head.headers.get('Content-Length'),'13');
 const partial=await h.handler(new Request(url,{headers:{Range:'bytes=-13','If-Range':etag}}));assert.equal(partial.status,206);assert.equal(partial.headers.get('ETag'),etag);assert.equal(h.reads.at(-1).init.headers.Range,'bytes=-13');await partial.body.cancel();
 const full=await h.handler(new Request(url,{headers:{Range:'bytes=0-12','If-Range':'"another-file"'}}));assert.equal(full.status,200);assert.equal(h.reads.at(-1).init.headers.Range,undefined);await full.body.cancel();
});
test('pending or failed jobs keep the original source path, while a revoked selected variant refuses the old representation',async()=>{
 const pending=harness({resolveVariant:async()=>null});const original=await pending.handler(new Request(url));assert.equal(original.status,200);assert.ok(new URL(pending.reads[0].href).pathname.endsWith(objectPath));await original.body.cancel();
 const retired=harness({resolveVariant:async()=>({unavailable:true})});assert.equal((await retired.handler(new Request(url))).status,410);assert.equal(retired.reads.length,0);
});
test('derived version or ETag replacement after header fetch suppresses bytes and never falls through to original',async()=>{
 let n=0;const changed=harness({resolveVariant:async()=>++n===1?variant:{...variant,version:'changed'},fetch:variantFetch});assert.equal((await changed.handler(new Request(url))).status,410);assert.equal(changed.reads.length,1);
 const wrong=harness({resolveVariant:async()=>variant,fetch:async()=>new Response('other',{headers:{'Content-Type':'video/mp4',ETag:'"wrong"'}})});assert.equal((await wrong.handler(new Request(url))).status,410);
});
test('source permission revocation still wins over a valid derived publication',async()=>{
 const h=harness({resolveVariant:async()=>variant,revoke:2,fetch:variantFetch});assert.equal((await h.handler(new Request(url))).status,403);assert.equal(h.reads.length,1);
});
