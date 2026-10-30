const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
function modules(overrides={}) { const cache=new Map(); const load=file=>{file=path.resolve(root,file);if(cache.has(file))return cache.get(file);const m={exports:{}};cache.set(file,m.exports); const requireLocal=name=>{if(name in overrides)return overrides[name];if(name.startsWith('.')){const base=path.resolve(path.dirname(file),name);return load([base+'.ts',base+'.tsx'].find(fs.existsSync));}throw Error('Unmocked '+name);};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:requireLocal,AbortController,console});cache.set(file,m.exports);return m.exports;};return load;}
const lib=modules()('shared/storyVideoComposition.ts');
const base=()=>lib.storyVideoRecipe({duration:12,width:390,height:844,transform:{fit:'contain',trimStart:2,trimEnd:10,speed:2,mix:{orig:35}}});
test('video recipe bounds output dimensions without changing canvas aspect, keeps edit duration and original mix',()=>{const r=base();assert.equal(r.width%2,0);assert.equal(r.height%2,0);assert.ok(r.width<=1080&&r.height<=1920);assert.ok(Math.abs(r.width/r.height-390/844)<.002);assert.equal((r.trimEnd-r.trimStart)/r.speed,4);assert.equal(r.volume,.35);});
test('invalid metadata and excessive slowed clips cannot start export',()=>{assert.throws(()=>lib.storyVideoRecipe({duration:NaN,width:390,height:844}),/duration/);assert.throws(()=>lib.storyVideoRecipe({duration:10,width:0,height:0}),/canvas/);assert.throws(()=>lib.storyVideoRecipe({duration:90,width:390,height:844,transform:{speed:.25}}),/two minutes/);});
test('export uses actual color matrix and clamps hostile geometry/volume values',()=>{const r=lib.storyVideoRecipe({duration:12,width:390,height:844,transform:{scale:100,translateNX:Infinity,translateNY:-50,mix:{orig:-20},adjust:{bri:-100}}});assert.equal(r.scale,5);assert.equal(r.x,0);assert.equal(r.y,-2);assert.equal(r.volume,0);assert.equal(r.matrix[0],.5);assert.equal(r.matrix[6],.5);assert.equal(r.matrix[12],.5);});
test('timed artwork partitions its real source windows into speed-adjusted output time',()=>{const r=base();const windows=lib.storyVideoLayerWindows([{startSec:1,endSec:4},{startSec:4,endSec:9}],r);assert.deepEqual(JSON.parse(JSON.stringify(windows)),[{start:0,end:1,clock:3},{start:1,end:3.5,clock:6.5},{start:3.5,end:4,clock:9.5}]);assert.equal(lib.storyVideoLayerAtTime({startSec:4,endSec:9},4),true);assert.equal(lib.storyVideoLayerAtTime({startSec:4,endSec:9},9),false);});
test('animated or embedded media never silently becomes a static export',()=>{assert.match(lib.storyVideoExportLimit([{kind:'gif'}]),/GIF/);assert.match(lib.storyVideoExportLimit([{anim:'bounce'}]),/animations/);assert.match(lib.storyVideoExportLimit([{postMediaType:'video'}]),/another video/);assert.match(lib.storyVideoExportLimit([],true),/added music/);assert.equal(lib.storyVideoExportLimit([{kind:'photo'},{kind:'text',anim:'none'}]),null);});
test('export format is chosen only when the recorder reports support',()=>{assert.equal(lib.storyVideoMime(t=>t==='video/webm;codecs=vp8,opus'),'video/webm;codecs=vp8,opus');assert.equal(lib.storyVideoMime(()=>false),null);});
function bridge(native,os='ios'){return modules({'expo-modules-core':{requireOptionalNativeModule:()=>native},'react-native':{Platform:{OS:os}}})('modules/boomerang/storyComposition.ts');}
const request={id:'story-test-1',inputUri:'file:///source.mp4',outputUri:'file:///cache/pc-story-export-1.mp4',recipe:base(),layers:[]};
test('an older native build cannot claim edited video export',async()=>{const b=bridge({make(){}});assert.equal(b.storyVideoCompositionAvailable,false);await assert.rejects(b.composeStoryVideo(request),/new iPhone build/);assert.equal(bridge({storyVideoVersion:1,composeStory(){}},'android').storyVideoCompositionAvailable,false);});
test('Android export is explicitly unavailable even if a linked module advertises iOS capabilities', async () => {
  let calls = 0;
  const b = bridge({ storyVideoVersion: 1, storyAudioExportVersion: 1, composeStory: async () => { calls++; } }, 'android');
  assert.equal(b.storyVideoCompositionAvailable, false);
  assert.equal(b.storyAudioCompositionAvailable, false);
  await assert.rejects(b.composeStoryVideo(request), /not available on Android yet/);
  await assert.rejects(b.composeStoryVideo({ ...request, audio: { uri: 'file:///audio.wav' } }), /added music or voiceover is not available on Android yet/);
  assert.equal(calls, 0);
  assert.match(lib.storyNativeEditingUnavailable('android', 'color'), /Video color editing is not available on Android yet/);
  assert.doesNotMatch(lib.storyVideoExportLimit([], true, false), /iPhone/);
});
test('native bridge cancels pending work and rejects late completion after an account fence',async()=>{let resolve,cancelled=[];const b=bridge({storyVideoVersion:1,composeStory:()=>new Promise(r=>resolve=r),cancelStoryComposition:async id=>cancelled.push(id)}),abort=new AbortController();const work=b.composeStoryVideo(request,abort.signal);abort.abort();resolve({uri:request.outputUri,duration:4,bytes:2048});await assert.rejects(work,/cancelled/);assert.deepEqual(cancelled,[request.id]);});
test('native bridge verifies returned output identity, media duration and bytes',async()=>{for(const invalid of [{uri:'file:///wrong.mp4',duration:4,bytes:5000},{uri:request.outputUri,duration:NaN,bytes:5000},{uri:request.outputUri,duration:4,bytes:0}]){await assert.rejects(bridge({storyVideoVersion:1,composeStory:async()=>invalid}).composeStoryVideo(request),/verified/);}const result={uri:request.outputUri,duration:4,bytes:5000};assert.equal((await bridge({storyVideoVersion:1,composeStory:async()=>result}).composeStoryVideo(request)).bytes,5000);});
test('native controller maintains actual clock events, bounded settings, exact seeks and released fencing',()=>{const load=modules({'react':{createContext:()=>({})},'react/jsx-runtime':{},'react-native':{Platform:{OS:'ios'},StyleSheet:{create:x=>x}},'expo-modules-core':{requireOptionalNativeModule:()=>null,requireNativeViewManager:()=>{}},'expo-video':{useVideoPlayer(){}},'../../src/components/stories/StoryPixelImage':{StoryPhotoLookContext:{}},});const {StoryVideoController}=load('modules/boomerang/storyVideo.tsx'),p=new StoryVideoController('file:///clip.mp4');let ticks=0;p.addListener('timeUpdate',()=>ticks++);p.volume=2;assert.equal(p.volume,1);p.playbackRate=100;assert.equal(p.playbackRate,4);p.currentTime=3;assert.equal(p.props().seekSeconds,3);p.play();p.receive({type:'timeUpdate',currentTime:4,playing:true});assert.equal(p.currentTime,4);assert.equal(p.playing,true);p.pause();p.receive({type:'timeUpdate',currentTime:4.1,playing:true});assert.equal(p.playing,false);assert.equal(ticks,2);p.release();p.receive({type:'timeUpdate',currentTime:9,playing:true});assert.equal(p.currentTime,4.1);});

test('only the new audio-capable native build can export a soundtrack or still movie', async () => {
  assert.equal(lib.storyVideoExportLimit([], true, true), null);
  const audio = { uri: 'file:///cache/verified.wav', start: 1, duration: 2, volume: .4, loop: true };
  const old = bridge({ storyVideoVersion: 1, composeStory: async () => ({}) });
  await assert.rejects(old.composeStoryVideo({ ...request, audio }), /added music or voiceover/);
  await assert.rejects(old.composeStoryVideo({ ...request, inputKind: 'image' }), /added music or voiceover/);
  let called = 0;
  const current = bridge({ storyVideoVersion: 1, storyAudioExportVersion: 1, composeStory: async () => { called++; return { uri: request.outputUri, duration: 4, bytes: 5000, soundtrackMixed: true }; } });
  assert.equal(current.storyAudioCompositionAvailable, true);
  await current.composeStoryVideo({ ...request, audio }); assert.equal(called, 1);
  await assert.rejects(current.composeStoryVideo({ ...request, audio: { ...audio, uri: 'https://foreign/audio' } }), /excerpt is invalid/);
  await assert.rejects(current.composeStoryVideo({ ...request, audio: { ...audio, volume: Infinity } }), /excerpt is invalid/);
  assert.equal(called, 1);
});
test('native soundtrack export cannot report success when the encoded file lost its audio', async () => {
  const current = bridge({ storyVideoVersion: 1, storyAudioExportVersion: 1, composeStory: async () => ({ uri: request.outputUri, duration: 4, bytes: 5000 }) });
  await assert.rejects(current.composeStoryVideo({ ...request, audio: { uri: 'file:///cache/verified.wav', start: 0, duration: 2, volume: 1, loop: false } }), /soundtrack could not be verified/);
});
