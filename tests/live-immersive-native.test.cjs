const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
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
function harness(role='viewer') {
  let cursor=0,slots=[],effects=[];
  const same=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn;},useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
  const runtime={jsx:(type,props)=>({type,props:props||{}}),jsxs:(type,props)=>({type,props:props||{}}),Fragment:'Fragment'};
  const commands=[],channels=[],alerts=[],navigations=[];let loadFailure=null;
  let current={session:directory.parseLiveSession({id:id(1),title:'Live together',state:'live',host:{id:id(2),full_name:'Host'},chat_mode:'open',viewer_count:17,audience:'public'}),raw:{role,capabilities:{view:true,chat:true},chat_topic:`live:${id(1)}:${id(3)}`,guest_topic:`live-guests:${id(1)}:${id(2)}`,stage:{limit:12,occupied:1,available:11},join_requests:[],own_join_request:null}};
  const playback={session:null,player:{},open:async()=>{},close(){},expand(){},minimize(){},retry:async()=>{},setPictureInPicture(){}};
  const rn=new Proxy({StyleSheet:{create:x=>x,absoluteFill:{position:'absolute',top:0,left:0,right:0,bottom:0}},Platform:{OS:'ios'},Alert:{alert:(...args)=>alerts.push(args)}},{get:(obj,key)=>key in obj?obj[key]:key});
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
  return {render,settle,by,commands,channels,alerts,navigations,failLoad(message){loadFailure=message;},update(fn){current=fn(current);},async start(){render();await settle();render();await settle();},button(label){return nodes(render()).filter(node=>node.type==='TouchableOpacity'&&words(node)===label).at(-1);}};
}

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
