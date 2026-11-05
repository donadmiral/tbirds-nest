const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const code=ts.transpileModule(fs.readFileSync('supabase/functions/private-hls/handler.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports_={};vm.runInNewContext(code,{exports:exports_,Request,Response,Headers,URL,AbortSignal,AbortController,ReadableStream,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout,crypto:crypto.webcrypto});
const M='10000000-0000-4000-8000-000000000001',R='20000000-0000-4000-8000-000000000001',L='30000000-0000-4000-8000-000000000001',U='40000000-0000-4000-8000-000000000001',J='50000000-0000-4000-8000-000000000001';
const base='https://qa.supabase.co',endpoint=base+'/functions/v1/private-hls',bytes=Uint8Array.from([1,2,3,4]);
const asset=(name='master.m3u8')=>({bucket:'adaptive-media',path:`${U}/_renditions_v2/${J}/${L}/${name}`,name,leaseId:L,sourceVersion:'source-v1',version:'out-v1',expiresAt:new Date(Date.now()+60000).toISOString(),etag:'out-etag',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:4,mime:name.endsWith('.ts')?'video/mp2t':'application/vnd.apple.mpegurl',playlist:name==='master.m3u8'?'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=480x270,FRAME-RATE=30.000\nr0/index.m3u8\n':'#EXTM3U\n#EXTINF:4.0,\nseg00000.ts\n#EXT-X-ENDLIST\n'});
function harness(options={}){
 const calls=[],fetches=[];let denied=false;
 const handle=exports_.createPrivateHLS({env:n=>({SUPABASE_URL:base,SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'server-secret'})[n],client:()=>({auth:{getUser:async()=>({data:{user:options.noUser?null:{id:U}},error:null})},rpc:async(name,args)=>{
  calls.push({name,args});if(options.rpcError)return {error:{},data:null};
  if(name==='close_chat_hls_v1')return {error:null,data:true};
  return {error:null,data:options.unavailable||denied?null:{...asset(args.p_name),...options.asset}};
 }}),fetch:async(url,init)=>{
  fetches.push({url:String(url),init});if(options.closeDuringFetch)denied=true;
  return new Response(options.badBytes?Uint8Array.from([9,9,9,9]):bytes,{status:200,headers:{etag:'"out-etag"','Content-Length':'4','Content-Type':'video/mp2t',...options.upstreamHeaders}});
 }});
 const post=(action='open',extra={})=>new Request(endpoint,{method:'POST',headers:{Authorization:'Bearer user-token','Content-Type':'application/json'},body:JSON.stringify({messageId:M,requestId:R,action,...extra})});
 const get=(name='master.m3u8',extra={},headers={})=>{const u=new URL(endpoint);for(const [k,v]of Object.entries({messageId:M,requestId:R,sourceVersion:'source-v1',leaseId:L,asset:name,...extra}))u.searchParams.set(k,v);return new Request(u,{headers:{Authorization:'Bearer user-token',...headers}});};
 return {handle,calls,fetches,post,get};
}
test('auth is required and an unavailable optional HLS open keeps the original fallback',async()=>{
 let h=harness();assert.equal((await h.handle(new Request(endpoint))).status,401);assert.equal(h.calls.length,0);
 h=harness({noUser:true});assert.equal((await h.handle(h.post())).status,401);
 h=harness({unavailable:true});assert.deepEqual(await (await h.handle(h.post())).json(),{ready:false});assert.equal(h.fetches.length,0);
});
test('open returns only session IDs and immutable proof in URL, never a JWT or Storage capability',async()=>{
 const h=harness(),r=await h.handle(h.post()),a=await r.json();assert.equal(a.ready,true);assert.equal(a.requestId,R);
 const url=new URL(a.hlsUrl);assert.equal(url.origin,base);assert.equal(url.pathname,'/functions/v1/private-hls');assert.deepEqual([...url.searchParams.keys()],['messageId','requestId','sourceVersion','leaseId','asset']);assert.equal(url.searchParams.get('sourceVersion'),'source-v1');assert.ok(!a.hlsUrl.includes('user-token'));assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'open_chat_hls_v1');assert.equal(h.fetches.length,0);
});
test('close revokes only the HLS grant and does not consume or close an original media view',async()=>{
 const h=harness();assert.deepEqual(await(await h.handle(h.post('close'))).json(),{closed:true});assert.deepEqual(h.calls.map(x=>x.name),['close_chat_hls_v1']);
});
test('every playlist rechecks the grant and rewrites children to this authenticated endpoint',async()=>{
 const h=harness(),r=await h.handle(h.get()),body=await r.text();assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'private, no-store, max-age=0');assert.equal(h.calls.length,2);
 const child=body.split('\n').find(x=>x.startsWith('https:'));assert.equal(new URL(child).searchParams.get('asset'),'r0/index.m3u8');assert.equal(new URL(child).searchParams.get('requestId'),R);assert.ok(!body.includes('server-secret'));
 const r2=await h.handle(h.get('r0/index.m3u8'));assert.equal(r2.status,200);assert.equal(h.calls.length,4);assert.match(await r2.text(),/asset=r0%2Fseg00000.ts/);
});
test('unexpected playlist URIs and key/session tags fail closed',async()=>{
 for(const playlist of ['#EXTM3U\nhttps://evil.test/seg.ts\n','#EXTM3U\n../x.ts\n','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="evil"\nr0/index.m3u8\n']){
  const h=harness({asset:{playlist}});assert.equal((await h.handle(h.get())).status,503);assert.equal(h.fetches.length,0);
 }
});
test('a segment checks current grants before and after verified bytes with no authorization cache',async()=>{
 const h=harness();for(let i=0;i<2;i++){const r=await h.handle(h.get('r0/seg00000.ts'));assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);}
 assert.equal(h.calls.length,4);assert.equal(h.fetches.length,2);
 for(const f of h.fetches){assert.match(f.url,/\/storage\/v1\/object\/authenticated\/adaptive-media\//);assert.equal(f.init.headers.Authorization,'Bearer server-secret');assert.equal(f.init.cache,'no-store');assert.equal(f.init.redirect,'error');}
});
test('close during upstream fetch releases no segment bytes',async()=>{
 const h=harness({closeDuringFetch:true}),r=await h.handle(h.get('r0/seg00000.ts'));assert.equal(r.status,410);assert.deepEqual(await r.json(),{error:'viewing_ended'});assert.equal(h.calls.length,2);
});
test('swapped bytes, wrong ETag and wrong declared length are rejected',async()=>{
 for(const options of [{badBytes:true},{upstreamHeaders:{etag:'"replacement"'}},{upstreamHeaders:{'Content-Length':'5'}}]){
  const h=harness(options);assert.equal((await h.handle(h.get('r0/seg00000.ts'))).status,503);
 }
});
test('foreign lease, source revision, Storage path or expired capability never reaches upstream',async()=>{
 for(const change of [{leaseId:U},{sourceVersion:'old'},{path:'../../secret'},{path:`${U}/_renditions_v2/${J}/${L}/masterXm3u8`},{expiresAt:new Date(Date.now()-1000).toISOString()}]){
  const h=harness({asset:change});assert.equal((await h.handle(h.get())).status,410);assert.equal(h.fetches.length,0);
 }
});
test('range, arbitrary asset, duplicate proof and query tokens are not accepted',async()=>{
 const h=harness();for(const request of [h.get('r0/seg00000.ts',{}, {Range:'bytes=0-1'}),h.get('../../x'),h.get('master.m3u8',{token:'user-token'})])assert.equal((await h.handle(request)).status,400);
 const u=new URL(h.get().url);u.searchParams.append('requestId',R);assert.equal((await h.handle(new Request(u,{headers:{Authorization:'Bearer user-token'}}))).status,400);assert.equal(h.fetches.length,0);
});
test('HEAD still checks authorization twice without returning bytes',async()=>{
 const h=harness(),r=await h.handle(new Request(h.get('r0/seg00000.ts'),{method:'HEAD'}));assert.equal(r.status,200);assert.equal((await r.arrayBuffer()).byteLength,0);assert.equal(h.calls.length,2);
});
test('caller abort leaves no successful response or media fetch',async()=>{
 const h=harness(),signal=AbortSignal.abort();assert.equal((await h.handle(new Request(h.post(),{signal}))).status,499);assert.equal(h.fetches.length,0);
});
test('JSON arrays cannot impersonate UUID strings through coercion',async()=>{
 const h=harness();assert.equal((await h.handle(h.post('open',{messageId:[M]}))).status,400);assert.equal(h.calls.length,0);
});
test('worker accepts only owner-bound chat jobs while generic gateway still rejects chat URLs',async()=>{
 const {validateJob}=await import('../workers/media-renditions/config.mjs');
 const job={job_id:J,lease_id:L,source_id:M,source_owner:U,source_bucket:'chat-media',source_path:U+'/video.mp4',source_bytes:10,source_version:'v1',source_etag:'etag',attempt:1,output_bucket:'adaptive-media',output_prefix:`${U}/_renditions_v2/${J}/${L}/`,output_max_bytes:1000,duration_max_seconds:10,lease_until:new Date(Date.now()+60000).toISOString()};
 assert.equal(validateJob(job),job);assert.throws(()=>validateJob({...job,source_path:M+'/video.mp4'}),/invalid_job/);
 const {createGateway}=await import('../workers/media-renditions/gateway.mjs');
 const api={rpc:async()=>{throw new Error('must not authorize generic chat playback');}},cache={get:async()=>null,set:async()=>{}};
 const gateway=createGateway(api,{cache,secret:'s'.repeat(40),publicOrigin:'https://media.test'});
 const response=await gateway(new Request(`https://media.test/playback/chat-media/${U}/video.mp4/master.m3u8?token=${'a'.repeat(64)}`));assert.equal(response.status,400);
});
