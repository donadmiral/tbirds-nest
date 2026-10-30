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
 const reads=[],grants=[],signals=[];let cancelled=0;
 const proof={bucket,path:objectPath,version:'object-version',expiresAt:new Date(Date.now()+300000).toISOString()};
 const handler=create({base:origin,serviceKey:'server-secret',randomId:()=>`read-${reads.length}`,
  resolve:async(...args)=>{
   grants.push(args);
   if(options.resolveError===grants.length)throw new Error('database secret');
   return options.denied||options.revoke===grants.length?null:{...proof,...(options.replace===grants.length?{version:'changed'}:{})};
  },fetch:async(href,init)=>{
   reads.push({href,init});signals.push(init.signal);
   if(options.fetch)return options.fetch(href,init);
   const status=options.status||200;
   const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('private-bytes'));if(!options.openStream)controller.close();},cancel(){cancelled++;}});
   return new Response(body,{status,headers:{'Content-Type':options.mime||'image/jpeg','Content-Length':'13','Accept-Ranges':'bytes',...(status===206?{'Content-Range':'bytes 0-12/100'}:{}),...(status===416?{'Content-Range':'bytes */100'}:{})}});
  }});
 return {handler,reads,grants,signals,cancelled:()=>cancelled};
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
