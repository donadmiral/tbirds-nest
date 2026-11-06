const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const identity=[1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0];
const grade=[0,0,1,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,1,0];
const source='https://fixture.supabase.co/functions/v1/media-content/story-media/owner/video.mp4?token=fixture';
const hls='https://media.fixture.test/playback/story-media/owner/video.mp4/master.m3u8?token=fixture';
function load({enabled=false,version=1,preview=true}={}){
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useSyncExternalStore:()=>{},useContext:()=>null};
 const imports={react,'react-native':{StyleSheet:{}},'expo-video':{VideoView:'ExpoVideo'},
  'expo-modules-core':{requireNativeViewManager:()=> 'NativeView',requireOptionalNativeModule:()=>({storyHLSGradeVersion:version})},
  '../../src/lib/useAdaptiveVideoPlayer':{},'../../shared/adaptiveMedia':{knownAdaptiveMedia:()=>({hlsUrl:hls})},
  './storyComposition':{storyVideoPreviewAvailable:preview},'../../src/components/stories/StoryPixelImage':{StoryPhotoLookContext:{}},
  '../../shared/storyColorMatrix':{storyPhotoColorMatrix:look=>look?.matrix??identity}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'modules/boomerang/storyVideo.tsx'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,
 {exports,require:name=>{if(!(name in imports))throw Error(name);return imports[name];},process:{env:{EXPO_PUBLIC_ADAPTIVE_MEDIA:'true',...(enabled?{EXPO_PUBLIC_IOS_GRADED_HLS:'true'}:{})}},Date,Promise});return exports;
}
function render(api,player,matrix=grade,onFirstFrameRender=()=>{}){const wrapper=api.StoryVideoView({player,look:{matrix},onFirstFrameRender});return wrapper.type(wrapper.props);}

test('graded HLS requires both explicit release flag and new native capability',()=>{
 for(const options of [{},{enabled:true,version:undefined},{enabled:true,version:0},{enabled:false,version:1}]){
  // An absent capability is represented by null to avoid a default argument.
  if(options.version===undefined&&options.enabled)options.version=null;
  const api=load(options),player=new api.StoryVideoController(source),view=render(api,player);
  assert.equal(api.storyHLSGradeAvailable,false);assert.equal(view.props.uri,source);assert.equal(view.props.allowsHLSGrade,false);
 }
 const api=load({enabled:true}),player=new api.StoryVideoController(source),view=render(api,player);
 assert.equal(api.storyHLSGradeAvailable,true);assert.equal(view.props.uri,hls);assert.equal(view.props.allowsHLSGrade,true);assert.deepEqual(view.props.matrix,grade);
});
test('neutral HLS stays available without enabling the graded renderer',()=>{
 const api=load(),player=new api.StoryVideoController(source),view=render(api,player,identity);
 assert.equal(view.props.uri,hls);assert.equal(view.props.allowsHLSGrade,false);
});
test('unsupported native platforms retain their existing player path',()=>{
 const api=load({enabled:true,preview:false});assert.equal(api.storyHLSGradeAvailable,false);
 assert.equal(api.StoryVideoView({player:{},look:{matrix:grade}}).type,'ExpoVideo');
});
test('graded output failure retries authorized original once with grade, clock and paused intent',()=>{
 for(const paused of [true,false]){
  const api=load({enabled:true}),player=new api.StoryVideoController(source);
  player.currentTime=4;player.play();player.receive({type:'timeUpdate',currentTime:7.25,playing:true});if(paused)player.pause();
  let errors=0,firstFrames=0;player.addListener('statusChange',event=>{if(event.status==='error')errors++;});
  render(api,player,grade,()=>firstFrames++).props.onPlayback({nativeEvent:{type:'statusChange',status:'error'}});
  const fallback=render(api,player,grade,()=>firstFrames++);
  assert.equal(fallback.props.uri,source);assert.deepEqual(fallback.props.matrix,grade);
  assert.equal(fallback.props.seekSeconds,7.25);assert.equal(fallback.props.paused,paused);assert.equal(errors,0);assert.equal(firstFrames,0);
  fallback.props.onPlayback({nativeEvent:{type:'firstFrame'}});assert.equal(firstFrames,1);
  fallback.props.onPlayback({nativeEvent:{type:'statusChange',status:'error'}});assert.equal(errors,1);
 }
});
test('released renderer cannot revive fallback, playback or first-frame events',()=>{
 const api=load({enabled:true}),player=new api.StoryVideoController(source);let frames=0;
 const view=render(api,player,grade,()=>frames++);player.currentTime=5;player.release();
 view.props.onPlayback({nativeEvent:{type:'statusChange',status:'error'}});view.props.onPlayback({nativeEvent:{type:'firstFrame'}});
 assert.equal(player.props().uri,hls);assert.equal(player.currentTime,5);assert.equal(frames,0);
});
