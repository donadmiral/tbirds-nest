const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
function load(file,mocks={},env={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>{if(n in mocks)return mocks[n];throw Error(n);},process:{env},URL,Response,Request,Headers,AbortController,TextDecoder,Uint8Array,Map,Set,Date,Promise,setTimeout,clearTimeout,fetch});return exports;}
const source='https://fixture.supabase.co/functions/v1/media-content/post-media/40000000-0000-4000-8000-000000000001/video.mp4?token='+'a'.repeat(64);
const hls='https://media.fixture.test/playback/post-media/40000000-0000-4000-8000-000000000001/video.mp4/master.m3u8?token='+'a'.repeat(64);
const turn=()=>new Promise(r=>setImmediate(r));
test('readiness is bounded, deduplicated and limited to exact first-party video capabilities',async()=>{
 const media=load('shared/adaptiveMedia.ts');assert.equal(media.adaptiveProbeUrl('https://outside.test/video.mp4'),null);assert.equal(media.adaptiveProbeUrl(source.replace('post-media','chat-media')),null);
 let reads=0;const fetcher=async()=>{reads++;return Response.json({ready:true,hlsUrl:hls,sourceVersion:'v1',expiresAt:Date.now()+300000});};
 const [a,b]=await Promise.all([media.resolveAdaptiveMedia(source,fetcher),media.resolveAdaptiveMedia(source,fetcher)]);assert.equal(a.hlsUrl,hls);assert.equal(b.hlsUrl,hls);assert.equal(reads,1);await media.resolveAdaptiveMedia(source,fetcher);assert.equal(reads,1);
 media.clearAdaptiveMedia();assert.equal(media.knownAdaptiveMedia(source),null);
});
test('a different source in a readiness response is rejected and an oversized streamed body is cancelled',async()=>{
 const media=load('shared/adaptiveMedia.ts');assert.equal(await media.resolveAdaptiveMedia(source,async()=>Response.json({ready:true,hlsUrl:hls.replace('video.mp4','different.mp4'),sourceVersion:'v1',expiresAt:Date.now()+300000})),null);
 media.clearAdaptiveMedia();let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4097));},cancel(){cancelled=true;}}));assert.equal(await media.resolveAdaptiveMedia(source,async()=>response),null);assert.equal(cancelled,true);
});
test('native fetch without ReadableStream accepts only length-bounded readiness',async()=>{
 const media=load('shared/adaptiveMedia.ts'),body=JSON.stringify({ready:true,hlsUrl:hls,sourceVersion:'v1',expiresAt:Date.now()+300000});
 const result=await media.resolveAdaptiveMedia(source,async()=>({ok:true,body:null,headers:new Headers({'Content-Length':String(body.length)}),text:async()=>body}));assert.equal(result.hlsUrl,hls);
});
function video(){return{src:'',paused:true,currentTime:0,duration:60,loads:0,listeners:new Map(),canPlayType:()=>true,getAttribute(name){return this[name];},load(){this.loads++;},play(){this.paused=false;return Promise.resolve();},addEventListener(name,fn){this.listeners.set(name,fn);},removeEventListener(name,fn){if(this.listeners.get(name)===fn)this.listeners.delete(name);}};}
test('late adaptive readiness cannot replace an explicitly started original',async()=>{
 let resolve;const known={knownAdaptiveMedia:()=>null,resolveAdaptiveMedia:()=>new Promise(r=>resolve=r)};
 const {attachAdaptiveVideo}=load('web/lib/adaptiveVideo.ts',{'../../shared/adaptiveMedia':known},{NEXT_PUBLIC_ADAPTIVE_MEDIA:'true'});const v=video(),a=attachAdaptiveVideo(v,source);a.ensure();v.paused=false;v.currentTime=1;resolve({hlsUrl:hls});await turn();assert.equal(v.src,source);assert.equal(v.loads,1);a.dispose();
});
test('native HLS error returns to the original at the same play position and intent',async()=>{
 const known={knownAdaptiveMedia:()=>({hlsUrl:hls}),resolveAdaptiveMedia:async()=>null};const {attachAdaptiveVideo}=load('web/lib/adaptiveVideo.ts',{'../../shared/adaptiveMedia':known},{NEXT_PUBLIC_ADAPTIVE_MEDIA:'true'});
 const v=video(),a=attachAdaptiveVideo(v,source,{shouldPlay:()=>true});await turn();assert.equal(v.src,hls);v.currentTime=12;v.paused=true;assert.equal(a.recover(),true);assert.equal(v.src,source);v.listeners.get('loadedmetadata')();await turn();assert.equal(v.currentTime,12);assert.equal(v.paused,false);assert.equal(a.recover(),false);a.dispose();
});
test('cold readiness never delays original preload or replaces its loaded pixels',async()=>{
 let resolve;const known={knownAdaptiveMedia:()=>null,resolveAdaptiveMedia:()=>new Promise(r=>resolve=r)};const enabled=load('web/lib/adaptiveVideo.ts',{'../../shared/adaptiveMedia':known},{NEXT_PUBLIC_ADAPTIVE_MEDIA:'true'});const v=video(),a=enabled.attachAdaptiveVideo(v,source);assert.equal(v.src,source);assert.equal(v.loads,1);resolve({hlsUrl:hls});await turn();assert.equal(v.src,source);assert.equal(v.loads,1);a.dispose();
 const off=load('web/lib/adaptiveVideo.ts',{'../../shared/adaptiveMedia':known});const normal=video(),b=off.attachAdaptiveVideo(normal,source);assert.equal(normal.src,source);assert.equal(normal.loads,1);b.dispose();
});
test('account reset aborts pending readiness and cannot reuse or erase a new session request',async()=>{
 const media=load('shared/adaptiveMedia.ts');let releaseOld,releaseNew,oldSignal,reads=0;
 const first=media.resolveAdaptiveMedia(source,async(_url,{signal})=>{oldSignal=signal;return new Promise(r=>releaseOld=r);});
 media.clearAdaptiveMedia();assert.equal(oldSignal.aborted,true);
 const fetcher=async()=>{reads++;return new Promise(r=>releaseNew=r);};
 const second=media.resolveAdaptiveMedia(source,fetcher);
 releaseOld(Response.json({ready:true,hlsUrl:hls,sourceVersion:'old',expiresAt:Date.now()+300000}));
 assert.equal(await first,null);assert.equal(media.knownAdaptiveMedia(source),null);
 const deduplicated=media.resolveAdaptiveMedia(source,fetcher);assert.equal(reads,1);
 releaseNew(Response.json({ready:true,hlsUrl:hls,sourceVersion:'current',expiresAt:Date.now()+300000}));
 assert.equal((await second).sourceVersion,'current');assert.equal((await deduplicated).sourceVersion,'current');
});
test('expired or ambiguous adaptive capabilities are never retained',async()=>{
 for(const patch of [{expiresAt:Date.now()+9999},{sourceVersion:''},{sourceVersion:'v'.repeat(129)},{hlsUrl:hls+'&token='+'b'.repeat(64)}]){
  const media=load('shared/adaptiveMedia.ts');assert.equal(await media.resolveAdaptiveMedia(source,async()=>Response.json({ready:true,hlsUrl:hls,sourceVersion:'v1',expiresAt:Date.now()+300000,...patch})),null);
 }
});
test('native standalone player keeps the immediate original after cold discovery completes',async()=>{
 let effect,initial,resolve;const replacements=[];
 const player={addListener(){return{remove(){}};},replaceAsync:async value=>replacements.push(value)};
 const {useAdaptiveVideoPlayer}=load('src/lib/useAdaptiveVideoPlayer.ts',{
  react:{useMemo:fn=>fn(),useEffect:fn=>effect=fn},
  'expo-video':{useVideoPlayer:value=>{initial=value;return player;}},
  '../../shared/adaptiveMedia':{knownAdaptiveMedia:()=>null,resolveAdaptiveMedia:()=>new Promise(r=>resolve=r)},
 },{EXPO_PUBLIC_ADAPTIVE_MEDIA:'true'});
 useAdaptiveVideoPlayer(source);assert.equal(initial.uri,source);assert.equal(initial.useCaching,false);
 const cleanup=effect();resolve({hlsUrl:hls});await turn();assert.equal(replacements.length,0);cleanup();
});
test('adaptive redirects are additive, reject invalid inputs and never redirect to request-controlled origins',()=>{
 const {adaptiveRedirect}=load('supabase/functions/media-content/adaptive.ts');assert.equal(adaptiveRedirect(new Request(source)),null);assert.equal(adaptiveRedirect(new Request(source+'&stream=check')).status,200);const r=adaptiveRedirect(new Request(source+'&stream=hls&origin=https://evil.invalid'),'https://media.fixture.test');assert.equal(r.status,307);assert.equal(new URL(r.headers.get('location')).origin,'https://media.fixture.test');assert.equal(adaptiveRedirect(new Request(source.replace('a'.repeat(64),'forged')+'&stream=hls'),'https://media.fixture.test').status,400);
});
test('adaptive discovery accepts the Supabase relay path with identical capability checks',()=>{
 const {adaptiveRedirect}=load('supabase/functions/media-content/adaptive.ts'),relay=source.replace('/functions/v1/','/');
 for(const input of [source,relay]){
  const response=adaptiveRedirect(new Request(input+'&stream=check'),'https://media.fixture.test');
  assert.equal(response.status,307);const destination=new URL(response.headers.get('location'));
  assert.equal(destination.origin,'https://media.fixture.test');assert.equal(destination.pathname,'/playback/post-media/40000000-0000-4000-8000-000000000001/video.mp4');assert.equal(destination.searchParams.get('token'),'a'.repeat(64));assert.equal(destination.searchParams.get('format'),'json');
  assert.equal(adaptiveRedirect(new Request(input.replace('a'.repeat(64),'forged')+'&stream=check'),'https://media.fixture.test').status,400);
  assert.equal(adaptiveRedirect(new Request(input.replace('post-media','chat-media')+'&stream=check'),'https://media.fixture.test').status,400);
 }
 assert.equal(adaptiveRedirect(new Request(relay.replace('/media-content/','/unrelated/media-content/')+'&stream=check'),'https://media.fixture.test').status,400);
});
