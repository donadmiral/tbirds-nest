const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const compile=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const walk=node=>Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];
const ticks=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness({micGranted=true,token=true,stopLens=async()=>'file://lens.mp4',photo=async()=>({uri:'file://photo.jpg',width:1080,height:1920})}={}){
 let cursor=0,active=true,changed=false,tree,timerId=0,micRequests=0;
 const slots=[],effects=[],timers=new Map(),keyboardListeners=new Map(),navigations=[],alerts=[],calls={flip:0,record:0,startLens:0};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;changed=true;}}];},useRef(value){const i=cursor++;return slots[i]??={current:value};},useCallback(fn){cursor++;return fn;},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 hooks.default=hooks;
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'};
 const native=Object.fromEntries(['View','Text','TouchableOpacity','StatusBar','ActivityIndicator','ScrollView','Image','TextInput'].map(name=>[name,name]));
 Object.assign(native,{StyleSheet:{create:x=>x,absoluteFill:{}},Platform:{OS:'ios'},Alert:{alert:(...args)=>alerts.push(args)},Keyboard:{dismiss(){keyboardListeners.get('keyboardWillHide')?.();},addListener(name,fn){keyboardListeners.set(name,fn);return{remove(){keyboardListeners.delete(name);}};}}});
 const camera={takePictureAsync:photo,recordAsync(){calls.record++;return new Promise(()=>{});},stopRecording(){}};
 const lens={flip(){calls.flip++;},applyLens(){},capturePhoto:async()=> 'file://lens.jpg',startVideo(){calls.startLens++;},stopVideo:stopLens};
 const module={exports:{}};
 vm.runInNewContext(compile(fs.readFileSync(path.join(root,'src/screens/stories/StoryFunCameraScreen.tsx'),'utf8')+'\nexport { FunCameraInner };'),{module,exports:module.exports,console,Date,process:{env:token?{EXPO_PUBLIC_CAMERAKIT_API_TOKEN:'synthetic',EXPO_PUBLIC_CAMERAKIT_LENS_GROUP_ID:'synthetic'}:{}},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),require(name){
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return runtime;if(name==='react-native')return native;
  if(name==='expo-camera')return{CameraView:'CameraView',useCameraPermissions:()=>[{granted:true},async()=>{}],useMicrophonePermissions:()=>[{granted:micGranted},async()=>{micRequests++;return{granted:micGranted};}]};
  if(name==='expo-av')return{Audio:{setAudioModeAsync:async()=>{}}};
  if(name==='expo-haptics')return{selectionAsync(){},impactAsync(){},ImpactFeedbackStyle:{Light:1,Medium:2}};
  if(name==='react-native-gesture-handler')return{PinchGestureHandler:'Pinch',State:{END:1,CANCELLED:2}};
  if(name==='@expo/vector-icons')return{Feather:'Icon'};
  if(name.endsWith('/useCameraLife'))return{useCameraLife:()=>({active,epoch:0})};
  if(name.endsWith('/SafeArea'))return{SafeAreaView:'SafeArea',useSafeAreaInsets:()=>({top:48,bottom:34})};
  if(name.endsWith('/StoryFilters'))return{STORY_FILTERS:[{id:'platinum_glow',label:'Pearl glow',family:'platinum'}],FilterLayer:'FilterLayer',FilterPickerSheet:'FilterPicker'};
  if(name.endsWith('/CameraKitLensView'))return{CameraKitLensView:'LensView',webViewAvailable:true};
  if(name.endsWith('/uploadSafe'))return{ensureUploadSafe:async uri=>({uri})};
  if(name.endsWith('/captureBridge'))return{setPendingCapture(){}};
  if(name.endsWith('/storyCapture'))return{STORY_CAPTURE_VIDEO_QUALITY:'1080p',STORY_CAPTURE_VIDEO_BITRATE:8000000};
  throw Error(name);
 }});
 const props={navigation:{navigate:(...args)=>navigations.push(args),goBack(){},canGoBack:()=>true},insets:{top:48,bottom:34},route:{params:{}}};
 function render(){for(let i=0;i<8;i++){changed=false;cursor=0;tree=module.exports.FunCameraInner(props);for(const node of walk(tree)){if(node.type==='CameraView')node.props.ref.current=camera;if(node.type==='LensView')node.props.ref.current=lens;}while(effects.length)effects.shift()();if(!changed)break;}return tree;}
 render();
 return{render,calls,alerts,navigations,timers,keyboard(height){keyboardListeners.get(height?'keyboardWillShow':'keyboardWillHide')?.({endCoordinates:{height}});render();},get micRequests(){return micRequests;},nodes:()=>walk(tree),button:label=>walk(tree).find(n=>n.props.accessibilityLabel===label),tab(label){walk(tree).find(n=>n.props.accessibilityRole==='tab'&&walk(n).some(x=>x.props.children===label)).props.onPress();render();},lensReady(){walk(tree).find(n=>n.type==='LensView').props.onReady();render();},active(value){active=value;render();},unmount(){slots.forEach(x=>x?.cleanup?.());},runTimer(ms){const pair=[...timers].find(([,timer])=>timer.ms===ms);if(pair){timers.delete(pair[0]);return pair[1].fn();}}};
}
test('camera opens without a microphone prompt, flips the regular camera, and records at 1080p',()=>{
 const h=harness({micGranted:false});assert.equal(h.micRequests,0);assert.equal(h.nodes().find(n=>n.type==='CameraView').props.facing,'front');h.button('Flip camera').props.onPress();h.render();const camera=h.nodes().find(n=>n.type==='CameraView');assert.equal(camera.props.facing,'back');assert.equal(camera.props.videoQuality,'1080p');assert.equal(camera.props.videoBitrate,8000000);assert.equal(h.calls.flip,0);h.unmount();
});
test('denied microphone permission never starts video capture',async()=>{
 const h=harness({micGranted:false});h.tab('Video');h.button('Record video').props.onPressOut();await ticks();h.render();assert.equal(h.micRequests,1);assert.equal(h.calls.record,0);assert.equal(h.nodes().find(n=>n.type==='CameraView').props.mode,'picture');assert.match(h.alerts[0][0],/Microphone/);h.unmount();
});
test('available lenses load, their camera flips, and successful readiness does not become a timeout error',()=>{
 const h=harness();h.tab('Snapchat lenses');h.lensReady();h.runTimer(25000);h.render();assert.ok(!h.nodes().some(n=>n.props.accessibilityRole==='alert'));h.button('Flip camera').props.onPress();assert.equal(h.calls.flip,1);h.unmount();
});
test('lens search and its choices move above the iPhone keyboard and return when dismissed',()=>{
 const h=harness();h.tab('Snapchat lenses');h.lensReady();h.keyboard(336);assert.equal(h.button('Available lens controls').props.style[1].bottom,348);h.button('Search available Snapchat lenses').props.onSubmitEditing();h.render();assert.equal(h.button('Available lens controls').props.style[1].bottom,234);h.unmount();
});
test('a stalled lens load exits the spinner with working recovery, without disabling ordinary effects',()=>{
 const h=harness();h.tab('Snapchat lenses');h.runTimer(25000);h.render();assert.ok(h.nodes().some(n=>n.props.accessibilityRole==='alert'));assert.equal(h.button('Take photo').props.disabled,true);h.tab('Platinum effects');assert.equal(h.button('Take photo').props.disabled,false);h.unmount();
});
test('lens video rejection is caught and capture becomes usable again',async()=>{
 const h=harness({stopLens:async()=>{throw Error('capture failed');}});h.tab('Snapchat lenses');h.lensReady();h.tab('Video');h.button('Record video').props.onPressOut();await ticks();h.render();assert.equal(h.calls.startLens,1);h.button('Stop recording').props.onPressOut();await ticks();h.render();assert.match(h.alerts[0][0],/Recording unavailable/);assert.equal(h.button('Record video').props.disabled,false);assert.equal(h.navigations.length,0);h.unmount();
});
test('a photo that finishes after leaving the camera cannot navigate over the next screen',async()=>{
 let resolve;const h=harness({photo:()=>new Promise(done=>{resolve=done;})});h.button('Take photo').props.onPressIn();h.button('Take photo').props.onPressOut();h.active(false);resolve({uri:'file://late.jpg'});await ticks();assert.equal(h.navigations.length,0);h.unmount();
});
