const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/screens/stories/StoryDualCaptureScreen.tsx'), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
function render({facing='back',mode='photo',active=true,phase='idle',micGranted=true,microphone=async()=>({granted:true})}={}) {
  const effects=[], focus=[], timers=[], alerts=[], updates=[], animations=[];
  const animation = () => ({ start(fn) { if(fn)animations.push(fn); } });
  const react = { createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState:initial=>[initial === 'back' ? facing : initial === 'photo' ? mode : initial === 'idle' ? phase : initial, value=>updates.push(value)],
    useRef:value=>({current:value}), useCallback:fn=>fn, useEffect:fn=>effects.push(fn) };
  const native = { View:'View',Text:'Text',TouchableOpacity:'TouchableOpacity',ActivityIndicator:'ActivityIndicator',Image:'Image',
    Dimensions:{get:()=>({width:400,height:800})},StyleSheet:{create:s=>s,absoluteFill:{}},Alert:{alert:(...args)=>alerts.push(args)},
    Animated:{Value:class {setValue() {}},timing:animation,spring:animation,parallel:animation,sequence:animation,View:'AnimatedView',Text:'AnimatedText'},Easing:{out:v=>v,ease:{}},Linking:{openSettings:async()=>{}} };
  const modules={react,'react-native':native,'../../hooks/useCameraLife':{useCameraLife:()=>({active,epoch:0})},
    '../../components/SafeArea':{useSafeAreaInsets:()=>({top:0,bottom:0})},'@react-navigation/native':{useNavigation:()=>({canGoBack:()=>true,goBack(){}}),useRoute:()=>({}),useFocusEffect:fn=>focus.push(fn)},
    '@expo/vector-icons':{Feather:'Icon'},'expo-haptics':{impactAsync:async()=>{},notificationAsync:async()=>{},ImpactFeedbackStyle:{Heavy:1,Medium:2,Light:3},NotificationFeedbackType:{Success:1}},
    'expo-camera':{CameraView:'Camera',useCameraPermissions:()=>[{granted:true},async()=>({granted:true})],useMicrophonePermissions:()=>[{granted:micGranted},microphone]},
    'expo-linear-gradient':{LinearGradient:'Gradient'},'../../components/stories/DualCameraComposerBridge':{prepareDualAsset:async()=>({})},'../../components/stories/dual/dualCaptureTypes':{DEFAULT_LAYOUT:{}}};
  const exports={};
  vm.runInNewContext(code,{exports,require:name=>{if(!(name in modules))throw new Error(name);return modules[name];},console,
    setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);},setInterval:fn=>{timers.push(fn);return fn;},clearInterval:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);}});
  const tree=exports.default();
  const find=(node,test)=> {if(!node||typeof node!=='object')return null;if(test(node))return node;for(const child of(node.children||[]).flat(Infinity)){const hit=find(child,test);if(hit)return hit;}return null;};
  return {camera:find(tree,n=>n.type==='Camera'),shutter:find(tree,n=>n.props.accessibilityLabel==='Capture scene'),effects,focus,timers,alerts,updates,animations,photoMode:find(tree,n=>n.type==='TouchableOpacity'&&n.children.some(c=>c?.children?.includes('Photo')))};
}
test('video dual capture uses the picture camera session for the reaction photo',()=>{
  assert.equal(render({mode:'video'}).camera.props.mode,'video');
  assert.equal(render({mode:'video',facing:'front'}).camera.props.mode,'picture');
  assert.equal(render({mode:'video'}).camera.props.videoQuality,'1080p');
});
test('inactive camera is unmounted rather than left recording on Android',()=>{
  assert.equal(render({active:false}).camera,null);
});
test('camera waits for readiness and a rapid double tap starts only one photo capture',async()=>{
  const h=render();let captured=0,resolve;h.camera.props.ref.current={takePictureAsync:()=>{captured++;return new Promise(r=>resolve=r);}};
  await h.shutter.props.onPress();assert.equal(captured,0);
  h.camera.props.onCameraReady();const pending=h.shutter.props.onPress();await h.shutter.props.onPress();assert.equal(captured,1);
  resolve({uri:'file:///photo.jpg'});await pending;assert.equal(h.alerts.length,0);
});
test('a capture finishing after blur cannot advance or schedule a reaction countdown',async()=>{
  const h=render();let resolve;const cleanup=h.focus[0]();
  h.camera.props.ref.current={takePictureAsync:()=>new Promise(r=>resolve=r),stopRecording(){}};
  h.camera.props.onCameraReady();const pending=h.shutter.props.onPress();cleanup();const count=h.updates.length;
  resolve({uri:'file:///photo.jpg'});await pending;
  assert.equal(h.updates.length,count);assert.equal(h.timers.length,0);
});

test('dual mode cannot change while microphone permission is still pending',async()=>{
 let resolve;const h=render({mode:'video',micGranted:false,microphone:()=>new Promise(r=>resolve=r)});h.camera.props.ref.current={stopRecording(){}};h.camera.props.onCameraReady();const pending=h.shutter.props.onPress();h.photoMode.props.onPress();assert.equal(h.updates.includes('photo'),false);resolve({granted:false});await pending;h.photoMode.props.onPress();assert.equal(h.updates.includes('photo'),true);
});
test('a countdown animation completing after blur cannot restart the reaction sequence',()=>{
 const h=render({phase:'countdown'}),cleanup=h.focus[0]();h.effects.forEach(fn=>fn());assert.equal(h.timers.length,1);h.timers[0]();assert.equal(h.animations.length,1);cleanup();const before=h.updates.length;h.animations[0]();assert.equal(h.updates.length,before);
});
test('a stuck dual photo request settles to an error and releases the capture lock',async()=>{
 const h=render();h.camera.props.ref.current={takePictureAsync:()=>new Promise(()=>{})};h.camera.props.onCameraReady();const pending=h.shutter.props.onPress();assert.equal(h.timers.length,1);h.timers[0]();await pending;assert.equal(h.timers.length,0);assert.match(h.alerts.at(-1)[1],/did not finish/);
});
