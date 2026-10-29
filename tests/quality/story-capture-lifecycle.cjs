const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},walk=node=>Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];
const words=node=>Array.isArray(node)?node.map(words).join(' '):typeof node==='string'?node:node&&typeof node==='object'?words(node.props?.children):'';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function hooks(){let cursor=0,dirty=true,tree,fn,onCommit=()=>{};const slots=[],effects=[];const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));const react={
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const n=typeof next==='function'?next(slots[i]):next;if(!Object.is(n,slots[i])){slots[i]=n;dirty=true;}}];},
 useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
 useEffect(effect,deps){const i=cursor++,old=slots[i];if(!same(old?.deps,deps)){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}},
 useMemo(factory,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:factory()};return slots[i].value;},
 useCallback(fn,deps){return this.useMemo(()=>fn,deps);},
};react.useCallback=(fn,deps)=>react.useMemo(()=>fn,deps);
 function render(force=false){dirty=dirty||force;let n=0;while(dirty){assert.ok(++n<40,'render settles');dirty=false;cursor=0;tree=fn();onCommit(tree);while(effects.length)effects.shift()();}return tree;}
 return{react,mount(component,commit){fn=component;if(commit)onCommit=commit;render();},render,get nodes(){return walk(tree);},async flush(){for(let i=0;i<5;i++){await turn();render();}},dispose(){slots.forEach(s=>s?.cleanup?.());}};
}
function timers(){let id=0;const timeouts=new Map(),intervals=new Map(),frames=[];return{setTimeout(fn,ms){const n=++id;timeouts.set(n,{fn,ms});return n;},clearTimeout:id=>timeouts.delete(id),setInterval(fn,ms){const n=++id;intervals.set(n,{fn,ms});return n;},clearInterval:id=>intervals.delete(id),requestAnimationFrame:fn=>frames.push(fn),frame(){for(const fn of frames.splice(0))fn();},run(ms){for(const[id,t]of [...timeouts])if(t.ms===ms){timeouts.delete(id);t.fn();}},get pending(){return timeouts.size+intervals.size;}};}
function compile(file,mods,globals={},append=''){const module={exports:{}};vm.runInNewContext(ts.transpileModule(read(file)+'\n'+append,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,console,require:name=>{assert.ok(name in mods,name);return mods[name];},...globals},{filename:file});return module.exports;}
const nativeBase={View:'View',Text:'Text',TouchableOpacity:'Button',ActivityIndicator:'Spinner',StatusBar:'StatusBar',Image:'Image',ScrollView:'ScrollView',StyleSheet:{create:x=>x,absoluteFill:{},absoluteFillObject:{}},Linking:{openSettings:async()=>{}},Dimensions:{get:()=>({width:390,height:844})}};
const haptics={impactAsync:async()=>{},notificationAsync:async()=>{},ImpactFeedbackStyle:{Heavy:1,Light:2,Medium:3},NotificationFeedbackType:{Success:1}};
function boomerang(){
 const h=hooks(),time=timers(),record=deferred(),encoded=deferred(),navigations=[],calls=[],alerts=[];let active=true;
 const camera={recordAsync:options=>{calls.push(['record',options]);return record.promise;},stopRecording:()=>calls.push(['stop'])};
 const native={...nativeBase,Alert:{alert:(...args)=>alerts.push(args)}};
 const mods={react:h.react,'react/jsx-runtime':jsx,'react-native':native,'expo-file-system/legacy':{cacheDirectory:'file:///cache/'},'../../../modules/boomerang':{makeBoomerang:(...args)=>{calls.push(['encode',...args]);return encoded.promise;}},'./BoomerangWeb':{default:'WebEncoder',__esModule:true},'../../hooks/useCameraLife':{useCameraLife:()=>({active,epoch:0})},'../../components/SafeArea':{SafeAreaView:'SafeArea',useSafeAreaInsets:()=>({top:40,bottom:20})},'@expo/vector-icons':{Feather:'Icon'},'expo-haptics':haptics,'react-native-svg':{default:'Svg',Circle:'Circle',__esModule:true},'expo-camera':{CameraView:'Camera',useCameraPermissions:()=>[{granted:true,canAskAgain:true},async()=>({granted:true})]}};
 const Inner=compile('src/screens/stories/StoryBoomerangScreen.tsx',mods,time,'export { BoomerangInner };').BoomerangInner;
 const nav={navigate:(route,args)=>navigations.push({route,args}),goBack:()=>navigations.push({route:'back'})};
 h.mount(()=>Inner({navigation:nav,extraParams:{circleId:'circle'},insets:{top:40,bottom:20}}),tree=>{const cameraNode=walk(tree).find(n=>n.type==='Camera');if(cameraNode)cameraNode.props.ref.current=camera;});
 const findButton=label=>{const b=h.nodes.find(n=>n.type==='Button'&&(n.props.accessibilityLabel===label||words(n)===label));assert.ok(b,label);return b;};
 return{...h,get nodes(){return h.nodes;},record,encoded,calls,navigations,alerts,time,press(label){const b=findButton(label);assert.ok(!b.props.disabled,label+' is enabled');b.props.onPress();h.render();},ready(){const c=h.nodes.find(n=>n.type==='Camera');assert.ok(c);c.props.onCameraReady();h.render();},active(value){active=value;h.render(true);},get camera(){return h.nodes.find(n=>n.type==='Camera')?.props;}};
}

test('Boomerang records one silent 1080p clip and blocks double taps until native encoding finishes',async()=>{
 const h=boomerang();assert.equal(h.camera.mute,true);assert.equal(h.camera.videoQuality,'1080p');assert.equal(h.camera.videoBitrate,8000000);h.ready();
 const shutter=h.nodes.find(n=>n.props?.accessibilityLabel==='Capture Boomerang');shutter.props.onPress();shutter.props.onPress();h.render();assert.equal(h.calls.filter(c=>c[0]==='record').length,0);h.ready();h.ready();assert.equal(h.calls.filter(c=>c[0]==='record').length,1);
 h.record.resolve({uri:'file:///original.mp4'});await h.flush();assert.equal(h.calls.filter(c=>c[0]==='encode').length,1);assert.equal(h.camera,undefined,'camera releases during encoding');assert.equal(h.navigations.length,0);
 h.encoded.resolve('file:///encoded.mp4');await h.flush();assert.equal(h.navigations.length,1);assert.equal(h.navigations[0].args.assets[0].uri,'file:///encoded.mp4');assert.equal(h.navigations[0].args.circleId,'circle');h.dispose();assert.equal(h.time.pending,0);
});

test('selected Boomerang effects use their actual engine and failure never silently publishes a straight clip',async()=>{
 const h=boomerang();h.ready();h.press('Echo');h.press('Capture Boomerang');h.ready();h.record.resolve({uri:'file:///original.mp4'});await h.flush();assert.equal(h.calls.filter(c=>c[0]==='encode').length,0);
 const engine=h.nodes.find(n=>n.type==='WebEncoder');assert.equal(engine.props.effect,'echo');engine.props.onError('Synthetic encoder failure');h.render();assert.equal(h.navigations.length,0);assert.ok(h.nodes.some(n=>n.props?.accessibilityRole==='alert'));
 h.press('Try again');assert.equal(h.nodes.find(n=>n.type==='WebEncoder').props.effect,'echo');h.nodes.find(n=>n.type==='WebEncoder').props.onDone('file:///echo.mp4',2.04);h.render();assert.equal(h.navigations[0].args.assets[0].uri,'file:///echo.mp4');assert.equal(h.navigations[0].args.assets[0].durationSec,2.04);h.dispose();
});

test('backgrounding during native Boomerang encoding invalidates its late completion and releases camera/timers',async()=>{
 const h=boomerang();h.ready();h.press('Capture Boomerang');h.ready();h.record.resolve({uri:'file:///input.mp4'});await h.flush();h.active(false);h.encoded.resolve('file:///late.mp4');await h.flush();assert.equal(h.navigations.length,0);assert.equal(h.camera,undefined);assert.equal(h.nodes.some(n=>n.type==='WebEncoder'),false);assert.equal(h.time.pending,0);h.dispose();
});

test('an unfinished Boomerang recording settles to a retry instead of spinning forever',async()=>{
 const h=boomerang();h.ready();h.press('Capture Boomerang');h.ready();h.time.run(6000);await h.flush();assert.ok(h.nodes.some(n=>n.props?.accessibilityRole==='alert'&&words(n).includes('did not finish')));h.record.resolve({uri:'file:///late.mp4'});await h.flush();assert.equal(h.navigations.length,0);assert.equal(h.calls.filter(c=>c[0]==='encode').length,0);h.press('Try again');h.dispose();
});

function layout(){
 const h=hooks(),time=timers(),gallery=deferred(),snapshot=deferred(),pickCalls=[],captureCalls=[],navigation=[],alerts=[],foreground=new Set();let focused=true;
 const native={...nativeBase,useWindowDimensions:()=>({width:390,height:844}),Alert:{alert:(...args)=>alerts.push(args)},AppState:{addEventListener(_,fn){foreground.add(fn);return{remove:()=>foreground.delete(fn)};}},PanResponder:{create:handlers=>({panHandlers:handlers})}};
 const mods={react:h.react,'react/jsx-runtime':jsx,'react-native':native,'../../components/SafeArea':{useSafeAreaInsets:()=>({top:40,bottom:20})},'@react-navigation/native':{useIsFocused:()=>focused,useNavigation:()=>({goBack:()=>navigation.push({route:'back'}),replace:(route,args)=>navigation.push({route,args})}),useRoute:()=>({params:{circleId:'circle'}})},'expo-image-picker':{launchImageLibraryAsync:options=>{pickCalls.push(options);return gallery.promise;},requestCameraPermissionsAsync:async()=>({granted:true}),launchCameraAsync:async()=>({canceled:false,assets:[{uri:'camera.jpg'}]})},'react-native-view-shot':{default:'ViewShot',__esModule:true,captureRef:(_ref,options)=>{captureCalls.push({options,selected:h.nodes.filter(n=>n.type?.name==='SlotView').some(n=>n.props.isActive)});return snapshot.promise;}},'@expo/vector-icons':{Feather:'Icon'}};
 const Component=compile('src/screens/stories/StoryLayoutScreen.tsx',mods,time).default;h.mount(()=>Component());
 const find=label=>{const n=h.nodes.find(n=>n.type==='Button'&&n.props.accessibilityLabel===label);assert.ok(n,label);return n;};
 return{...h,get nodes(){return h.nodes;},gallery,snapshot,pickCalls,captureCalls,navigation,alerts,time,button:find,press(label){const n=find(label);assert.ok(!n.props.disabled,label+' enabled');n.props.onPress();h.render();},async images(){for(const node of h.nodes.filter(n=>n.type?.name==='SlotView'))node.props.onReady(node.props.fill.uri,true);h.render();},async paint(){time.frame();h.render();time.frame();await h.flush();},background(){for(const fn of foreground)fn('background');h.render();},focus(value){focused=value;h.render(true);}};
}

test('layout waits for all decoded images, hides editing rings, and exports once at 1080×1920',async()=>{
 const h=layout(),button=h.button('Choose photos from the library');button.props.onPress();button.props.onPress();h.render();assert.equal(h.pickCalls.length,1);assert.equal(h.pickCalls[0].quality,1);assert.equal(h.pickCalls[0].orderedSelection,true);
 h.gallery.resolve({canceled:false,assets:[1,2,3,4].map(i=>({uri:'photo-'+i+'.jpg'}))});await h.flush();assert.equal(h.button('Continue').props.disabled,true,'URI assignment alone cannot export blank photos');
 await h.images();const done=h.button('Continue');done.props.onPress();done.props.onPress();h.render();await h.paint();assert.equal(h.captureCalls.length,1);assert.equal(h.captureCalls[0].selected,false);assert.equal(h.captureCalls[0].options.width,1080);assert.equal(h.captureCalls[0].options.height,1920);assert.equal(h.captureCalls[0].options.quality,1);
 h.snapshot.resolve('file:///layout.jpg');await h.flush();assert.equal(h.navigation.length,1);assert.equal(h.navigation[0].args.circleId,'circle');assert.equal(h.navigation[0].args.assets[0].localUri,'file:///layout.jpg');h.dispose();
});

test('layout ignores a picker result after navigation and an export completed in the background',async()=>{
 const a=layout();a.press('Choose photos from the library');a.focus(false);a.gallery.resolve({canceled:false,assets:[{uri:'late.jpg'}]});await a.flush();assert.equal(a.nodes.filter(n=>n.type?.name==='SlotView').some(n=>n.props.fill),false);a.dispose();
 const b=layout();b.press('Choose photos from the library');b.gallery.resolve({canceled:false,assets:[1,2,3,4].map(i=>({uri:'p'+i+'.jpg'}))});await b.flush();await b.images();b.press('Continue');await b.paint();b.background();b.snapshot.resolve('file:///late-layout.jpg');await b.flush();assert.equal(b.navigation.length,0);b.dispose();
});

test('layout render timeout exposes an error and permits retry',async()=>{
 const h=layout();h.press('Choose photos from the library');h.gallery.resolve({canceled:false,assets:[1,2,3,4].map(i=>({uri:'p'+i+'.jpg'}))});await h.flush();await h.images();h.press('Continue');await h.paint();h.time.run(15000);await h.flush();assert.ok(h.alerts.some(a=>a[1].includes('too long')));assert.equal(h.button('Continue').props.disabled,false);h.dispose();
});

test('layout pan uses loaded image geometry and updates its bounds after resizing',()=>{
 const h=hooks(),time=timers(),changes=[];const props={index:0,left:0,top:0,width:100,height:100,fill:{uri:'wide.jpg',scale:1,tx:0,ty:0},isActive:true,locked:false,onReady(){},onTap(){},onTransform:(...args)=>changes.push(args)};
 const mods={react:h.react,'react/jsx-runtime':jsx,'react-native':{...nativeBase,useWindowDimensions:()=>({width:390,height:844}),PanResponder:{create:panHandlers=>({panHandlers})}},'../../components/SafeArea':{},'@react-navigation/native':{},'expo-image-picker':{},'react-native-view-shot':{},'@expo/vector-icons':{Feather:'Icon'}};
 const Slot=compile('src/screens/stories/StoryLayoutScreen.tsx',mods,time,'export { SlotView };').SlotView;h.mount(()=>Slot(props));
 h.nodes.find(n=>n.type==='Image').props.onLoad({nativeEvent:{source:{width:400,height:100}}});h.render();let slot=h.nodes.find(n=>n.props?.accessibilityLabel==='Slot 1');slot.props.onPanResponderGrant({nativeEvent:{touches:[{pageX:0,pageY:0}]}});slot.props.onPanResponderMove({nativeEvent:{touches:[{pageX:100,pageY:0}]}},{dx:100,dy:0});h.render();slot.props.onPanResponderRelease();assert.equal(changes.at(-1)[1],100,'wide photos have horizontal crop room after decoding');
 props.width=400;h.render(true);assert.equal(changes.at(-1)[1],0,'resizing clamps translations to the new image bounds');props.locked=true;h.render(true);slot=h.nodes.find(n=>n.props?.accessibilityLabel==='Slot 1');assert.equal(slot.props.onStartShouldSetPanResponder(),false);h.dispose();
});

function webEncoder(){
 const h=hooks(),time=timers(),readGate=deferred(),writeGate=deferred(),injections=[],writes=[],removed=[],done=[],errors=[];
 const engine={injectJavaScript:code=>injections.push(code)},props={inputUri:'file:///input.mp4',effect:'classic',onDone:(...args)=>done.push(args),onError:message=>errors.push(message)};
 const mods={react:h.react,'react/jsx-runtime':jsx,'react-native':nativeBase,'expo-file-system/legacy':{cacheDirectory:'file:///cache/',EncodingType:{Base64:'base64'},readAsStringAsync:()=>readGate.promise,writeAsStringAsync:(...args)=>{writes.push(args);return writeGate.promise;},deleteAsync:async path=>removed.push(path)},'react-native-webview':{WebView:'WebView'},'../../../shared/boomerangEngine':{BOOMERANG_ENGINE:engineHtml()}};
 const Component=compile('src/screens/stories/BoomerangWeb.tsx',mods,time).default;h.mount(()=>Component(props),tree=>{const web=walk(tree).find(n=>n.type==='WebView');if(web)web.props.ref.current=engine;});
 return{...h,get nodes(){return h.nodes;},time,readGate,writeGate,injections,writes,removed,done,errors,message(msg){const web=h.nodes.find(n=>n.type==='WebView');const pending=web.props.onMessage({nativeEvent:{data:JSON.stringify(msg)}});h.render();return pending;}};
}

test('local Boomerang engine ignores a file read that finishes after cancellation',async()=>{
 const h=webEncoder();h.message({type:'ready'});await h.flush();h.dispose();h.readGate.resolve('Ynl0ZXM=');await h.flush();assert.equal(h.injections.some(code=>code.startsWith('window.__bounce(')),false);assert.equal(h.done.length,0);assert.equal(h.time.pending,0);
});

test('local Boomerang engine cannot hand off a saved result after cancellation',async()=>{
 const h=webEncoder();const pending=h.message({type:'done',b64:'Ynl0ZXM=',mime:'video/mp4',seconds:2.02});assert.equal(h.writes.length,1);h.dispose();h.writeGate.resolve();await pending;assert.equal(h.done.length,0);assert.equal(h.removed.length,1);assert.equal(h.errors.length,0);
});

test('local Boomerang engine has one deadline and rejects late or invalid results',async()=>{
 const h=webEncoder();h.time.run(60000);await h.flush();assert.equal(h.errors.length,1);await h.message({type:'done',b64:'Ynl0ZXM=',mime:'video/mp4',seconds:2});assert.equal(h.writes.length,0);h.dispose();
 const other=webEncoder();await other.message({type:'done',b64:'not base64',mime:'image/jpeg',seconds:2});assert.equal(other.errors.length,1);assert.equal(other.writes.length,0);other.dispose();
});

function engineHtml(){const file='shared/boomerangEngine.ts',source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let initializer;for(const statement of ast.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(declaration.name.getText(ast)==='BOOMERANG_ENGINE')initializer=declaration.initializer.getText(ast);assert.ok(initializer);return vm.runInNewContext(initializer);}
function engineScript(){return engineHtml().match(/<script>([\s\S]*)<\/script>/)[1];}
async function runEngine(effect,unsupported=false){
 const posts=[],draws=[],closed=[],urls=[],activeImages=new Set(),timers=new Map();let clock=0,id=0,peakImages=0,stopped=0,settings;
 const events=new Map();let position=0;
 const video={duration:1,videoWidth:1080,videoHeight:1920,readyState:2,src:'',get currentTime(){return position;},set currentTime(value){position=value;queueMicrotask(()=>{for(const fn of events.get('seeked')??[])fn();});},addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn),load(){if(this.src)queueMicrotask(()=>this.onloadeddata?.());},pause(){},removeAttribute(name){if(name==='src')this.src='';}};
 const context={globalAlpha:1,drawImage(image){if(image!==video)draws.push({frame:image.frame,alpha:this.globalAlpha});}};
 const canvas={width:0,height:0,getContext:()=>context,toBlob(callback){const blob=new Blob(['frame']);blob.frame=position;callback(blob);},captureStream:()=>({getTracks:()=>[{stop:()=>stopped++}]})};
 class Recorder{static isTypeSupported(){return !unsupported;}constructor(_stream,options){settings=options;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['encoded'])});this.onstop?.();}}
 class Reader{readAsDataURL(blob){this.result='data:'+blob.type+';base64,ZW5jb2RlZA==';this.onload?.();}}
 const window={addEventListener(){},MediaRecorder:Recorder,ReactNativeWebView:{postMessage:value=>posts.push(JSON.parse(value))}};
 const globals={window,document:{getElementById:id=>id==='v'?video:canvas},MediaRecorder:Recorder,Blob,Uint8Array,FileReader:Reader,Map,Array,URL:{createObjectURL:()=>{const u='blob:'+urls.length;urls.push(u);return u;},revokeObjectURL:url=>closed.push(url)},atob:value=>Buffer.from(value,'base64').toString('binary'),performance:{now:()=>clock},createImageBitmap:async blob=>{const image={frame:blob.frame,close:()=>activeImages.delete(image)};activeImages.add(image);peakImages=Math.max(peakImages,activeImages.size);return image;},setTimeout(fn,ms){const key=++id;timers.set(key,{fn,ms});if(ms<1000)setImmediate(()=>{if(timers.delete(key)){clock+=ms;fn();}});return key;},clearTimeout:key=>timers.delete(key)};
 vm.runInNewContext(engineScript(),globals);await window.__bounce('Y2xpcA==','video/mp4',effect);return{posts,draws,peakImages,activeImages,canvas,settings,stopped,urls,closed,timers};
}

test('actual frame-engine script starts at decoded time zero, creates a forward/reverse clip, and releases resources',async()=>{
 const h=await runEngine('classic');const result=h.posts.find(p=>p.type==='done');assert.ok(result,'the zero-time seek must not hang waiting for an event that never fires');assert.equal(h.posts.some(p=>p.type==='error'),false);assert.equal(h.canvas.width,1080);assert.equal(h.canvas.height,1920);assert.equal(h.settings.videoBitsPerSecond,8000000);assert.ok(result.seconds>=1.9&&result.seconds<=2.1);assert.equal(h.draws[0].frame,0);assert.ok(h.draws.some((item,index)=>index>31&&item.frame<h.draws[index-1].frame));assert.ok(h.peakImages<=6,'compressed frame cache retains no unbounded decoded array');assert.equal(h.activeImages.size,0);assert.equal(h.stopped,1);assert.equal(h.closed.length,h.urls.length);assert.equal(h.timers.size,0);
});

test('actual Slo-Mo and Echo engine paths change the encoded frames/timing and fail honestly without an encoder',async()=>{
 const slow=await runEngine('slomo');assert.ok(slow.posts.find(p=>p.type==='done').seconds>=3.9);const echo=await runEngine('echo');assert.ok(echo.draws.some(draw=>draw.alpha===.35));assert.ok(echo.draws.some(draw=>draw.alpha===.18));const absent=await runEngine('classic',true);assert.equal(absent.posts.some(p=>p.type==='done'),false);assert.ok(absent.posts.some(p=>p.type==='error'&&/no supported video encoder/.test(p.message)));
});
