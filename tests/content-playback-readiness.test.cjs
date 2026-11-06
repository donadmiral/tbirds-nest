const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function loader(mocks={},env={},globals={}){const cache=new Map();function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file);const result={};cache.set(file,result);const requireLocal=name=>{if(name in mocks)return mocks[name];const target=path.resolve(path.dirname(file),name);if(name.startsWith('.'))return load([target,target+'.ts',target+'.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile()));throw Error(name);};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{exports:result,require:requireLocal,process:{env},URL,Request,Response,Headers,AbortController,AbortSignal,TextDecoder,Uint8Array,setTimeout,clearTimeout,fetch,...globals});return result;}return load;}
const base='https://fixture.supabase.co',owner='40000000-0000-4000-8000-000000000001',token='a'.repeat(64),key=`post-media/${owner}/video.mp4`,source=`${base}/functions/v1/media-content/${key}?token=${token}`,hls=`https://media.fixture.test/playback/${key}/master.m3u8?token=${token}`,expiry=()=>Date.now()+300000;
const ticket=()=>({bucket_id:'post-media',object_path:`${owner}/video.mp4`,token,expires_at:new Date(expiry()).toISOString(),object_version:'v1'});
const turn=()=>new Promise(r=>setImmediate(r));
test('signing metadata is bound to issued tickets and unknown outputs cannot become capabilities',async()=>{
 const api=loader()('supabase/functions/content-media-sign/adaptive.ts');let inputs;
 const result=await api.contentPlaybackReadiness(base,[ticket()],async values=>{inputs=values;return{origin:'https://media.fixture.test',items:[{token,version:'v1',hls:true},{token:'b'.repeat(64),version:'v2',hls:true}]};});
 assert.equal(inputs.length,1);assert.equal(result.size,1);assert.equal(result.get(source).sourceVersion,'v1');assert.equal(result.get(source).playback.hlsUrl,hls);
});
test('missing or invalid adaptive origin retains original versions without creating HLS URLs',async()=>{
 const api=loader()('supabase/functions/content-media-sign/adaptive.ts');for(const origin of [null,'http://media.fixture.test','https://user:pass@media.fixture.test','https://media.fixture.test/evil']){
  const result=await api.contentPlaybackReadiness(base,[ticket()],async()=>({origin,items:[{token,version:'v1',hls:true}]}));assert.equal(result.get(source).sourceVersion,'v1');assert.equal(result.get(source).playback,undefined);
 }
 assert.equal((await api.contentPlaybackReadiness(base,[ticket()],async()=>{throw Error('timeout');})).get(source).sourceVersion,'v1');
});
test('HLS discovery is bounded while every issued original retains its immutable version',async()=>{
 const api=loader()('supabase/functions/content-media-sign/adaptive.ts');let count=0;const tickets=Array.from({length:150},(_,i)=>({...ticket(),token:i.toString(16).padStart(64,'0'),bucket_id:'chat-media'}));
 const result=await api.contentPlaybackReadiness(base,tickets,async items=>{count=items.length;return{origin:'https://media.fixture.test',items:items.map(row=>({token:row.token,version:'v1',hls:true}))};});assert.equal(count,128);assert.equal(result.size,150);for(const item of result.values()){assert.equal(item.sourceVersion,'v1');assert.equal(item.playback,undefined);}
});
test('failed, aborted and malformed optional readiness cannot remove the exact newly issued version',async()=>{
 const api=loader()('supabase/functions/content-media-sign/adaptive.ts');
 const lookups=[async()=>null,async()=>({}),async()=>({items:'invalid'}),async()=>{throw Error('unavailable');},async()=>{const controller=new AbortController();controller.abort();throw controller.signal.reason;}];
 for(const object_version of ['original-v1','replacement-v2'])for(const lookup of lookups){
  const result=await api.contentPlaybackReadiness(base,[{...ticket(),object_version}],lookup);
  assert.deepEqual(JSON.parse(JSON.stringify(result.get(source))),{sourceVersion:object_version});
 }
});
test('a mismatched readiness version cannot override an issued original or add HLS',async()=>{
 const api=loader()('supabase/functions/content-media-sign/adaptive.ts');
 const result=await api.contentPlaybackReadiness(base,[{...ticket(),object_version:'replacement-v2'}],async()=>({origin:'https://media.fixture.test',items:[{token,version:'original-v1',hls:true}]}));
 assert.deepEqual(JSON.parse(JSON.stringify(result.get(source))),{sourceVersion:'replacement-v2'});
 const invalid=await api.contentPlaybackReadiness(base,[{...ticket(),object_version:undefined}],async()=>({origin:'https://media.fixture.test',items:[{token,version:'untrusted-fallback',hls:true}]}));assert.equal(invalid.size,0);
});
test('the deployed Edge entrypoint returns exact fresh versions when its real 500 ms readiness deadline aborts',async()=>{
 let handler,aborted=false,issuance=0,version='original-v1';const calls=[];
 const createClient=(_base,key,options)=>({auth:{getUser:async()=>({data:{user:{id:owner,is_anonymous:false}},error:null})},rpc(name,args){
  calls.push(name);
  if(key==='synthetic-anon'){
   assert.equal(options.global.headers.Authorization,'Bearer synthetic-user');
   if(name==='content_media_manifest')return Promise.resolve({data:[{media_url:`${base}/storage/v1/object/public/${keyPath}`}],error:null});
   assert.equal(name,'issue_content_media_delivery_v2');issuance++;return Promise.resolve({data:[{...ticket(),object_version:version}],error:null});
  }
  assert.equal(name,'media_playback_readiness_v2');assert.equal(args.p_items[0].token,token);
  return{abortSignal:signal=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Readiness was not bounded')),2000);
   signal.addEventListener('abort',()=>{aborted=true;clearTimeout(timer);reject(signal.reason);},{once:true});
  })};
 }});
 const keyPath=key,settings={SUPABASE_URL:base,SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'};
 loader({'npm:@supabase/supabase-js@2.112.3':{createClient}}, {}, {Deno:{env:{get:name=>settings[name]},serve:value=>{handler=value;}}})('supabase/functions/content-media-sign/index.ts');
 for(const expected of ['original-v1','replacement-v2']){
  version=expected;aborted=false;
  const response=await handler(new Request(base+'/functions/v1/content-media-sign',{method:'POST',headers:{Authorization:'Bearer synthetic-user','Content-Type':'application/json'},body:JSON.stringify({references:[{kind:'post',id:owner}],delivery:'no-store'})}));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(aborted,true);
  const body=await response.json();assert.equal(body.urls.length,1);assert.equal(body.urls[0].sourceVersion,expected);assert.equal(body.urls[0].url,source);assert.equal(body.urls[0].playback,undefined);
 }
 assert.equal(issuance,2);assert.equal(calls.includes('issue_content_media_delivery'),false);
});
test('readiness seeds before first player and survives an older cancelled negative probe',async()=>{
 const media=loader()('shared/adaptiveMedia.ts');let finish,signal;
 const probe=media.resolveAdaptiveMedia(source,async(_url,options)=>{signal=options.signal;return new Promise(r=>finish=r);});
 media.acceptAdaptiveMedia([{source,hlsUrl:hls,sourceVersion:'v1',expiresAt:expiry()}]);assert.equal(signal.aborted,true);assert.equal(media.knownAdaptiveMedia(source).hlsUrl,hls);
 finish(Response.json({ready:false}));await probe;assert.equal(media.knownAdaptiveMedia(source).hlsUrl,hls);media.clearAdaptiveMedia();assert.equal(media.knownAdaptiveMedia(source),null);
});
test('invalid signing playback metadata cannot seed another source or persist expired grants',()=>{
 const media=loader()('shared/adaptiveMedia.ts');for(const patch of [{sourceVersion:''},{expiresAt:Date.now()},{hlsUrl:hls.replace('video.mp4','other.mp4')},{hlsUrl:hls+'&asset=evil'},{hlsUrl:hls+'#fragment'}]){media.acceptAdaptiveMedia([{source,hlsUrl:hls,sourceVersion:'v1',expiresAt:expiry(),...patch}]);assert.equal(media.knownAdaptiveMedia(source),null);}
});
function signedClient(onSession=()=>{}){let calls=0;return{auth:{getSession:async()=>{onSession(++calls);return{data:{session:{user:{id:owner},access_token:'synthetic'}},error:null};},getUser:async()=>({data:{user:{id:owner}},error:null})},functions:{invoke:async()=>({data:{urls:[{key,url:source,sourceVersion:'v1',playback:{hlsUrl:hls,sourceVersion:'v1',expiresAt:expiry()}}],expiresAt:expiry()},error:null})}};}
test('hydration gives each media record its current version while readiness stays out of persisted rows',async()=>{
 const media=loader()('shared/contentMedia.ts');let grants;const [row]=await media.hydrateContentMedia(signedClient(),base,[{id:owner,_mediaVersions:{evil:'old'},post_media:[{id:'one',url:`${base}/storage/v1/object/public/${key}`,_sourceVersion:'forged'}]}],'post',undefined,values=>grants=values);
 assert.equal(row.post_media[0]._sourceVersion,'v1');assert.equal(row._mediaVersions[key],'v1');assert.equal(row._mediaVersions.evil,undefined);assert.equal(grants[0].source,source);assert.equal(grants[0].hlsUrl,hls);assert.equal(JSON.stringify(row).includes('master.m3u8'),false);
});
test('account changes prevent both hydrated rows and readiness from reaching consumers',async()=>{
 const media=loader()('shared/contentMedia.ts');let watcher,seeded=false;const client=signedClient();client.auth.onAuthStateChange=fn=>{watcher=fn;return{data:{subscription:{unsubscribe(){}}}};};const invoke=client.functions.invoke;client.functions.invoke=async()=>{const result=await invoke();watcher('SIGNED_OUT',null);return result;};
 await assert.rejects(media.hydrateContentMedia(client,base,[{id:owner,media_url:`${base}/storage/v1/object/public/${key}`}],'post',undefined,()=>seeded=true),/account changed/);assert.equal(seeded,false);
});
test('native story HLS falls back once with current position and paused intent preserved',()=>{
 const load=loader({react:{},'react-native':{StyleSheet:{}},'expo-modules-core':{requireOptionalNativeModule:()=>null,requireNativeViewManager:()=>null},'expo-video':{},'./storyComposition':{storyVideoPreviewAvailable:true},'../../src/components/stories/StoryPixelImage':{},'../../src/lib/useAdaptiveVideoPlayer':{}},{EXPO_PUBLIC_ADAPTIVE_MEDIA:'true'});load('shared/adaptiveMedia.ts').acceptAdaptiveMedia([{source,hlsUrl:hls,sourceVersion:'v1',expiresAt:expiry()}]);
 const {StoryVideoController}=load('modules/boomerang/storyVideo.tsx'),p=new StoryVideoController(source);assert.equal(p.props().uri,hls);assert.equal(p.props(false).uri,source);p.currentTime=7;p.play();p.receive({type:'timeUpdate',currentTime:8,playing:true});let errors=0;p.addListener('statusChange',event=>{if(event.status==='error')errors++;});p.receive({type:'statusChange',status:'error'});assert.equal(p.props().uri,source);assert.equal(p.props().seekSeconds,8);assert.equal(p.props().paused,false);assert.equal(errors,0);p.receive({type:'statusChange',status:'error'});assert.equal(errors,1);
});
