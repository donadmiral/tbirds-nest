const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function compile(file, imports) {
  const module = {exports:{}};
  const js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(js,{module,exports:module.exports,console,Date,Promise,Error,require(name){if(name in imports)return imports[name];throw Error('Unexpected import '+name);}});
  return module.exports;
}
const directory=compile('shared/liveDirectory.ts',{});
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const words=value=>typeof value==='string'?value:Array.isArray(value)?value.map(words).join(''):value?.props?words(value.props.children):'';
function harness(role='viewer', platform='ios') {
  let cursor=0,slots=[],effects=[];
  const same=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn;},useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
  const runtime={jsx:(type,props)=>({type,props:props||{}}),jsxs:(type,props)=>({type,props:props||{}}),Fragment:'Fragment'};
  const commands=[],channels=[],alerts=[],navigations=[],keyboardListeners=new Map();let loadFailure=null,keyboardDismissals=0;
  let current={session:directory.parseLiveSession({id:id(1),title:'Live together',state:'live',host:{id:id(2),full_name:'Host'},chat_mode:'open',viewer_count:17,audience:'public'}),raw:{role,capabilities:{view:true,chat:true},chat_topic:`live:${id(1)}:${id(3)}`,guest_topic:`live-guests:${id(1)}:${id(2)}`,stage:{limit:12,occupied:1,available:11},join_requests:[],own_join_request:null}};
  const playback={session:null,player:{},open:async()=>{},close(){},expand(){},minimize(){},retry:async()=>{},setPictureInPicture(){}};
  const rn=new Proxy({StyleSheet:{create:x=>x,absoluteFill:{position:'absolute',top:0,left:0,right:0,bottom:0}},Platform:{OS:platform},Keyboard:{dismiss(){keyboardDismissals++;},isVisible:()=>false,addListener(name,callback){keyboardListeners.set(name,callback);return{remove(){keyboardListeners.delete(name);}};}},Alert:{alert:(...args)=>alerts.push(args)}},{get:(obj,key)=>key in obj?obj[key]:key});
  const component=compile('src/screens/feed/LiveSessionScreen.tsx',{
    react,'react/jsx-runtime':runtime,'react-native':rn,'@react-navigation/native':{useFocusEffect(){}},'expo-video':{VideoView:'VideoView'},'expo-linear-gradient':{LinearGradient:'LinearGradient'},'@expo/vector-icons':{Feather:'Feather'},
    '../../components/SafeArea':{SafeAreaView:'SafeAreaView',useSafeAreaInsets:()=>({top:54,bottom:34,left:0,right:0})},'../../theme/useTheme':{useTheme:()=>({t:{ink:{primary:'#111',secondary:'#666',muted:'#888'},surface:{raised:'#fff',sunken:'#eee'}}})},'../../stores/authStore':{useAuthStore:read=>read({profile:{id:id(2)}})},'../../contexts/LivePlaybackContext':{useLivePlayback:()=>playback},
    '../../components/LiveStudio':{LiveStudio:'LiveStudio'},'../../components/LiveUi':{LiveIcon:'LiveIcon'},'../../components/LiveChat':{LiveChat:'LiveChat'},'../../components/LiveInteractions':{LiveInteractions:'LiveInteractions',LiveAnalytics:'LiveAnalytics'},
    '../../services/liveService':{liveObject:object,liveText:value=>typeof value==='string'?value:'',liveRows:(value,limit)=>Array.isArray(value)?value.slice(0,limit):[],loadLiveSession:async()=>{if(loadFailure)throw new Error(loadFailure);return current;},liveRequestId:()=>id(99),liveCommand:async(...args)=>{commands.push(args);return {ok:true};}},'../../../shared/liveDirectory':directory,
    '../../services/supabase':{supabase:{channel(){const handlers={};const channel={handlers,on(_kind,filter,cb){handlers[filter.event]=cb;return channel;},subscribe(){return channel;}};channels.push(channel);return channel;},removeChannel:async()=>{}}},'../../utils/profileRead':{},
  }).default;
  const render=()=>{cursor=0;return component({route:{params:{sessionId:id(1)}},navigation:{goBack:()=>navigations.push('back'),navigate:(...args)=>navigations.push(args)}});};
  const settle=async()=>{const pending=effects;effects=[];pending.forEach(fn=>fn());await new Promise(done=>setImmediate(done));};
  const by=(key,value)=>nodes(render()).find(node=>node.props?.[key]===value);
  return {render,settle,by,commands,channels,alerts,navigations,keyboardDismissals:()=>keyboardDismissals,keyboard(visible){keyboardListeners.get(platform==='ios'?(visible?'keyboardWillShow':'keyboardWillHide'):(visible?'keyboardDidShow':'keyboardDidHide'))?.();},failLoad(message){loadFailure=message;},update(fn){current=fn(current);},async start(){render();await settle();render();await settle();},button(label){return nodes(render()).filter(node=>node.type==='TouchableOpacity'&&words(node)===label).at(-1);}};
}

// Exercise the installed implementation with the real component's props. This
// checks show/hide geometry, rather than treating a behavior string as proof.
function installedKeyboardAvoidance(props,platform) {
  const file=require.resolve('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView');
  const listeners=new Map(),module={exports:{}};
  class Component {constructor(props){this.props=props;}setState(next){this.state={...this.state,...next};}}
  const react={Component,createRef:()=>({current:null}),createElement:(type,props,...children)=>({type,props:{...props,children}})};
  const imports={
    '../../LayoutAnimation/LayoutAnimation':{configureNext(){},Types:{keyboard:'keyboard'}},
    '../../StyleSheet/StyleSheet':{compose:(a,b)=>[a,b]},'../../Utilities/Platform':{OS:platform},
    '../AccessibilityInfo/AccessibilityInfo':{prefersCrossFadeTransitions:async()=>false},'../View/View':'View',
    './Keyboard':{isVisible:()=>false,addListener(name,callback){listeners.set(name,callback);return{remove(){listeners.delete(name);}};}},react,
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  };
  const code=babel.transformSync(fs.readFileSync(file,'utf8'),{filename:file,babelrc:false,configFile:false,
    presets:[require.resolve('@react-native/babel-preset')]}).code;
  vm.runInNewContext(code,{module,exports:module.exports,require(name){if(name in imports)return imports[name];if(name.startsWith('@babel/runtime/helpers/'))return require(name);throw Error('Unexpected keyboard import '+name);}});
  const view=new module.exports.default(props);view.componentDidMount();
  const layout=height=>view._onLayout({persist(){},nativeEvent:{layout:{x:0,y:0,width:320,height}}});
  const signal=async(show,screenY)=>{listeners.get(platform==='ios'?(show?'keyboardWillShow':'keyboardWillHide'):(show?'keyboardDidShow':'keyboardDidHide'))({duration:0,endCoordinates:{screenY,height:640-screenY,width:320,screenX:0}});await new Promise(done=>setImmediate(done));};
  const flatten=value=>Object.assign({},...(Array.isArray(value)?value.flat(Infinity):[value]).filter(Boolean));
  return{layout,signal,style:()=>flatten(view.render().props.style),close:()=>view.componentWillUnmount(),listeners};
}

test('Android Live composer follows the measured keyboard and restores the full footer on hide',async()=>{
  const app=harness('viewer','android');await app.start();
  const footer=nodes(app.render()).find(node=>node.type==='KeyboardAvoidingView'&&node.props.pointerEvents==='box-none');
  const native=installedKeyboardAvoidance(footer.props,'android');
  await native.layout(640);await native.signal(true,346);
  assert.equal(native.style().height,346,'The Send row must be lifted above the observed keyboard top');
  await native.layout(346);assert.equal(native.style().height,346,'The keyboard adjustment must not accumulate');
  await native.signal(false,640);assert.equal(native.style().height,undefined,'Remove the explicit height when the keyboard closes');
  assert.equal(app.keyboardDismissals(),0,'Typing and keyboard layout must not dismiss the keyboard to reach Send');
  assert.equal(app.commands.length,0);native.close();assert.equal(native.listeners.size,0);
  const resized=installedKeyboardAvoidance(footer.props,'android');
  await resized.layout(346);await resized.signal(true,346);
  assert.equal(resized.style().height,undefined,'Do not subtract a second keyboard height from a resized window');resized.close();
});

test('iOS keeps its existing padding behavior for the Live composer',async()=>{
  const app=harness('viewer','ios');await app.start();
  const footer=nodes(app.render()).find(node=>node.type==='KeyboardAvoidingView'&&node.props.pointerEvents==='box-none');
  const native=installedKeyboardAvoidance(footer.props,'ios');await native.layout(640);await native.signal(true,346);
  assert.equal(native.style().paddingBottom,294);assert.equal(native.style().height,undefined);
  await native.signal(false,640);assert.equal(native.style().paddingBottom,0);native.close();
});

test('opening a separate Live tools panel dismisses the composer keyboard without unmounting chat',async()=>{
  for(const platform of ['android','ios']){
    const app=harness('viewer',platform);await app.start();
    const before=nodes(app.render()).find(node=>node.type==='LiveChat');assert.equal(app.keyboardDismissals(),0);
    app.by('accessibilityLabel','More live tools').props.onPress();
    assert.equal(app.keyboardDismissals(),1);assert.equal(app.by('visible',true).type,'Modal');
    const after=nodes(app.render()).find(node=>node.type==='LiveChat');assert.equal(after.type,before.type);assert.equal(after.props.id,before.props.id);
    const sheet=nodes(app.by('visible',true)).find(node=>node.type==='KeyboardAvoidingView');
    assert.equal(sheet.props.behavior,platform==='ios'?'padding':'height');
    assert.equal(app.commands.length,0);assert.equal(app.navigations.length,0);
  }
});

test('the measured header bounds keyboard-open chat history while keeping the composer and actions usable',async()=>{
  const app=harness('viewer','android');await app.start();
  const header=nodes(app.render()).find(node=>node.type==='LinearGradient'&&node.props.style?.[0]?.top===0);
  assert.equal(typeof header.props.onLayout,'function','Use the rendered header height, not a device cutoff');
  header.props.onLayout({nativeEvent:{layout:{height:146,width:320,x:0,y:0}}});app.keyboard(true);
  const avoidance=nodes(app.render()).find(node=>node.type==='KeyboardAvoidingView'&&node.props.pointerEvents==='box-none');
  const native=installedKeyboardAvoidance(avoidance.props,'android');await native.layout(640);await native.signal(true,346);
  const space=nodes(avoidance).find(node=>node.props?.testID==='live-viewer-footer-space');
  assert.equal(space.props.style.paddingTop,146);
  const footer=nodes(space).find(node=>node.type==='LinearGradient');
  const style=Object.assign({},...footer.props.style);assert.equal(style.flexShrink,1);assert.equal(style.minHeight,0);
  assert.equal(style.paddingBottom,12,'The footer is above the IME, not above the device navigation bar');
  const available=native.style().height-space.props.style.paddingTop;
  // Retained320x640 failure: the entered reply occupied57px and actions44px.
  // The list consumes the remaining measured space and must retain two20px lines.
  const history=available-style.paddingTop-style.paddingBottom-44-style.gap-57-8;
  assert.ok(history>=40,'The reply history remains readable above its composer');
  assert.ok(346-(style.paddingBottom+44+style.gap+57+8+history)>=146,'History cannot enter the host header');
  assert.equal(app.keyboardDismissals(),0);assert.equal(app.commands.length,0);
  app.keyboard(false);const restored=nodes(app.render()).find(node=>node.type==='LinearGradient'&&node.props.style?.[0]?.flexShrink===1);
  assert.equal(Object.assign({},...restored.props.style).paddingBottom,34,'Restore the existing safe-area padding after input');native.close();
  const host=harness('host','android');await host.start();
  nodes(host.render()).find(node=>node.type==='LinearGradient'&&node.props.style?.[0]?.top===0).props.onLayout({nativeEvent:{layout:{height:146}}});host.keyboard(true);
  const stage=nodes(host.render()).find(node=>node.type==='LiveStudio');assert.equal(stage.props.headerHeight,146);assert.equal(stage.props.keyboardVisible,true);
});

test('host has a full-height stage with the real chat overlay and preserves it while tools open',async()=>{
  const app=harness('host');await app.start();
  const stage=nodes(app.render()).find(node=>node.type==='LiveStudio');
  assert.equal(stage.props.immersive,true);assert.equal(stage.props.autoPreview,true);
  assert.equal(stage.props.children.type,'LiveChat');assert.equal(stage.props.children.props.overlay,true);
  stage.props.onGuests();assert.equal(app.by('visible',true).type,'Modal');
  assert.ok(nodes(app.render()).some(node=>node.type==='LiveStudio'&&node.props.immersive));
});

test('viewer guest request and cancellation use the actual scoped commands',async()=>{
  const app=harness();await app.start();
  app.by('accessibilityLabel','Guests').props.onPress();app.button('Request to join').props.onPress();await app.settle();
  assert.equal(app.commands[0][0],'request_join');assert.equal(app.commands[0][1],id(1));
  app.update(value=>({...value,raw:{...value.raw,own_join_request:{status:'pending'}}}));
  app.channels[0].handlers.guest_requests_changed({payload:{}});await app.settle();
  app.button('Cancel join request').props.onPress();await app.settle();assert.equal(app.commands[1][0],'cancel_join_request');
});

test('host acceptance keeps the correct request identity and stage-capacity gate',async()=>{
  const app=harness('host');app.update(value=>({...value,raw:{...value.raw,join_requests:[{user_id:id(6),status:'pending',profile:{full_name:'Guest'}}]}}));await app.start();
  nodes(app.render()).find(node=>node.type==='LiveStudio').props.onGuests();
  app.by('accessibilityLabel','Accept request from Guest').props.onPress();await app.settle();
  assert.equal(app.commands[0][0],'accept_join_request');assert.equal(app.commands[0][2].user_id,id(6));
  app.update(value=>({...value,raw:{...value.raw,stage:{limit:12,occupied:12,available:0}}}));app.channels[0].handlers.guest_requests_changed({payload:{}});await app.settle();
  assert.equal(app.by('accessibilityLabel','Accept request from Guest').props.disabled,true);
});

test('accepted guest explicitly joins camera, and revoked membership removes the studio',async()=>{
  const app=harness('guest');await app.start();
  assert.equal(nodes(app.render()).some(node=>node.type==='LiveStudio'),false);
  app.button('Join live camera').props.onPress();assert.ok(nodes(app.render()).some(node=>node.type==='LiveStudio'));
  app.update(value=>({...value,raw:{...value.raw,role:'viewer'}}));app.channels[0].handlers.guest_requests_changed({payload:{}});await app.settle();
  assert.equal(nodes(app.render()).some(node=>node.type==='LiveStudio'),false);
});

test('host exit asks before leaving while the broadcaster is live',async()=>{
  const app=harness('host');await app.start();app.by('accessibilityLabel','Back to live streams').props.onPress();
  assert.equal(app.navigations.length,0);assert.equal(app.alerts[0][0],'Leave this live?');
  app.alerts[0][2].find(action=>action.text==='Leave camera').onPress();assert.equal(app.navigations[0],'back');
});


test('transient refresh failure keeps the broadcaster mounted but explicit access revocation closes it',async()=>{
  const app=harness('host');await app.start();
  app.failLoad('The action could not be confirmed. Your details are still here. Retry when connected.');
  app.channels[0].handlers.guest_requests_changed({payload:{}});await app.settle();
  assert.ok(nodes(app.render()).some(node=>node.type==='LiveStudio'));
  app.failLoad('This stream is unavailable or your access has changed.');
  app.channels[0].handlers.guest_requests_changed({payload:{}});await app.settle();
  assert.equal(nodes(app.render()).some(node=>node.type==='LiveStudio'),false);
});


test('a short multi-guest stage collapses comment history without shrinking or unmounting its camera',async()=>{
  const app=harness('host');await app.start();
  const stage=nodes(app.render()).find(node=>node.type==='LiveStudio');
  stage.props.onParticipantCount(3);
  app.by('testID','immersive-live-screen').props.onLayout({nativeEvent:{layout:{height:568,width:320}}});
  let next=nodes(app.render()).find(node=>node.type==='LiveStudio');
  assert.equal(next.props.immersive,true);assert.equal(next.props.children.props.compact,true);assert.equal(next.props.children.props.collapseHistory,true);
  app.by('testID','immersive-live-screen').props.onLayout({nativeEvent:{layout:{height:844,width:390}}});
  next=nodes(app.render()).find(node=>node.type==='LiveStudio');assert.equal(next.props.children.props.compact,true);assert.equal(next.props.children.props.collapseHistory,false);
});

test('iOS dismisses Live tools before navigating to clips and consumes that action once',async()=>{
  const app=harness('viewer','ios');await app.start();
  app.by('accessibilityLabel','More live tools').props.onPress();
  app.button('Clips').props.onPress();
  assert.equal(app.by('visible',true).type,'Modal');
  app.button('Open clips').props.onPress();
  const sheet=nodes(app.render()).find(node=>node.type==='Modal');
  assert.equal(sheet.props.visible,false,'The current sheet must begin dismissal');
  assert.equal(app.navigations.length,0,'Wait for native iOS dismissal before pushing a screen');
  sheet.props.onDismiss();
  assert.equal(JSON.stringify(app.navigations),JSON.stringify([['LiveClips',{sessionId:id(1)}]]));
  sheet.props.onDismiss();
  assert.equal(app.navigations.length,1,'A duplicate dismissal cannot navigate twice');
});

test('Android closes Live tools and opens clips without depending on an iOS dismissal event',async()=>{
  const app=harness('viewer','android');await app.start();
  app.by('accessibilityLabel','More live tools').props.onPress();
  app.button('Clips').props.onPress();app.button('Open clips').props.onPress();
  const sheet=nodes(app.render()).find(node=>node.type==='Modal');
  assert.equal(sheet.props.visible,false);
  assert.equal(JSON.stringify(app.navigations),JSON.stringify([['LiveClips',{sessionId:id(1)}]]));
  sheet.props.onDismiss();
  assert.equal(app.navigations.length,1);
});
