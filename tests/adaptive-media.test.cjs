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
 const v=video(),a=attachAdaptiveVideo(v,source,{shouldPlay:()=>true});await turn();assert.equal(v.src,hls);v.currentTime=12;v.paused=true;assert.equal(a.recover(),true);assert.equal(v.src,source);v.listeners.get('loadedmetadata')();assert.equal(v.currentTime,12);assert.equal(v.paused,false);assert.equal(a.recover(),false);a.dispose();
});
test('unmount fences discovery and disabled mode retains immediate original playback',async()=>{
 let resolve;const known={knownAdaptiveMedia:()=>null,resolveAdaptiveMedia:()=>new Promise(r=>resolve=r)};const enabled=load('web/lib/adaptiveVideo.ts',{'../../shared/adaptiveMedia':known},{NEXT_PUBLIC_ADAPTIVE_MEDIA:'true'});const v=video(),a=enabled.attachAdaptiveVideo(v,source);a.dispose();resolve({hlsUrl:hls});await turn();assert.equal(v.loads,0);
 const off=load('web/lib/adaptiveVideo.ts',{'../../shared/adaptiveMedia':known});const normal=video(),b=off.attachAdaptiveVideo(normal,source);assert.equal(normal.src,source);assert.equal(normal.loads,1);b.dispose();
});
test('adaptive redirects are additive, reject invalid inputs and never redirect to request-controlled origins',()=>{
 const {adaptiveRedirect}=load('supabase/functions/media-content/adaptive.ts');assert.equal(adaptiveRedirect(new Request(source)),null);assert.equal(adaptiveRedirect(new Request(source+'&stream=check')).status,200);const r=adaptiveRedirect(new Request(source+'&stream=hls&origin=https://evil.invalid'),'https://media.fixture.test');assert.equal(r.status,307);assert.equal(new URL(r.headers.get('location')).origin,'https://media.fixture.test');assert.equal(adaptiveRedirect(new Request(source.replace('a'.repeat(64),'forged')+'&stream=hls'),'https://media.fixture.test').status,400);
});
