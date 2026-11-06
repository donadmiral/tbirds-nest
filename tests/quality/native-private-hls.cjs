const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const file=path.resolve(__dirname,'../../src/components/messages/PrivateChatVideo.tsx');
const user='00000000-0000-4000-8000-000000000001',message='00000000-0000-4000-8000-000000000002',request='00000000-0000-4000-8000-000000000003';
const original='https://fixture.supabase.co/functions/v1/limited-media-file?messageId='+message+'&requestId='+request;
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({enabled=true,pending=false,initialPlayerStatus='readyToPlay'}={}){
 let host,seq=0,resolve;const transports=[],players=[],appListeners=new Set(),authListeners=new Set(),timers=new Map();
 let session={user:{id:user},access_token:'current-jwt'};
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useRef:value=>{const index=host.index++;return host.slots[index]??(host.slots[index]={current:value});},
  useState:value=>{const h=host,index=h.index++;if(!(index in h.slots))h.slots[index]=typeof value==='function'?value():value;return[h.slots[index],value=>{h.slots[index]=typeof value==='function'?value(h.slots[index]):value;}];},
  useEffect:(effect,deps)=>{const h=host,index=h.index++,old=h.slots[index];if(!old||deps.some((d,i)=>d!==old.deps[i])){old?.cleanup?.();h.pending.push(()=>{h.slots[index]={deps,cleanup:effect()};});}}};
 const AppState={currentState:'active',addEventListener:(_type,fn)=>{appListeners.add(fn);return{remove:()=>appListeners.delete(fn)}}};
 const makePlayer=source=>{const listeners=new Map();const p={source,status:initialPlayerStatus,playing:false,currentTime:0,duration:20,replacements:[],
  play(){p.playing=true},pause(){p.playing=false},replace(value){p.replacements.push(value)},
  addListener(name,fn){const set=listeners.get(name)||new Set();set.add(fn);listeners.set(name,set);return{remove:()=>set.delete(fn)}},emit(name,value){for(const fn of listeners.get(name)||[])fn(value)}};players.push(p);return p;};
 const imports={react,'react-native':{AppState,StyleSheet:{absoluteFill:{position:'absolute'}},View:'View',Text:'Text',Pressable:'Pressable',ActivityIndicator:'Spinner'},
  'expo-crypto':{randomUUID:()=>request},'expo-video':{VideoView:'Video',useVideoPlayer:(source,setup)=>{const ref=react.useRef(null);if(!ref.current){ref.current=makePlayer(source);setup?.(ref.current)}return ref.current;}},
  '../../stores/authStore':{useAuthStore:{getState:()=>({session})}},
  '../../services/supabase':{supabase:{auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{authListeners.add(fn);return{data:{subscription:{unsubscribe:()=>authListeners.delete(fn)}}}}}}},
  '../../../shared/privateAdaptiveMedia':{createPrivateAdaptiveSession:options=>{const t={options,closed:false,closeCalls:0,open:async()=>{if(pending)await new Promise(r=>resolve=r);return t.closed?null:{uri:'https://fixture.supabase.co/functions/v1/private-hls?fixture=1',headers:{Authorization:'Bearer current-jwt'},sourceVersion:'v1',expiresAt:Date.now()+60000}},close(){if(!t.closed)t.closeCalls++;t.closed=true;return Promise.resolve()}};transports.push(t);return t;}}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,
  {exports,require:name=>{assert.ok(name in imports,name);return imports[name]},process:{env:{EXPO_PUBLIC_PRIVATE_HLS:enabled?'true':'false',EXPO_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co'}},Date,Promise,fetch:()=>{},setTimeout:(fn)=>{const id=++seq;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id)});
 function mount(component=exports.PrivateChatVideo,props={messageId:message,userId:user,uri:original}){const h={slots:[],index:0,pending:[],tree:null,props};h.render=()=>{host=h;h.index=0;h.pending=[];h.tree=component(h.props);for(const effect of h.pending)effect();return h.tree;};h.close=()=>{for(const slot of h.slots)slot?.cleanup?.();};h.render();return h;}
 const child=h=>h.render()?.props.children.find(value=>value&&typeof value.type==='function');
 return{mount,child,transports,players,timers,resolve:()=>resolve?.(),background(){AppState.currentState='background';for(const fn of appListeners)fn('background')},account(){session={user:{id:'other'},access_token:'other-jwt'};for(const fn of authListeners)fn('SIGNED_IN',session)}};
}
test('private HLS stays off by default and inactive slides create no grant or player',async()=>{
 const f=fixture({enabled:false}),h=f.mount();await nextTurn();assert.equal(f.transports.length,0);assert.equal(f.child(h).props.opened.source.uri,original);h.close();
 const inactive=f.mount(undefined,{messageId:message,userId:user,uri:original,active:false});await nextTurn();assert.equal(f.transports.length,0);assert.equal(f.child(inactive),undefined);assert.equal(f.players.length,0);inactive.close();
});
test('already-open limited media reuses its exact request ID with authenticated uncached HLS',async()=>{
 const f=fixture(),h=f.mount(undefined,{messageId:message,userId:user,uri:original,requestId:request,headers:{Authorization:'Bearer current-jwt'}});await nextTurn();
 assert.equal(f.transports.length,1);assert.equal(f.transports[0].options.requestId,request);assert.equal(f.transports[0].options.messageId,message);
 const opened=f.child(h).props.opened;assert.equal(opened.source.contentType,'hls');assert.equal(opened.source.useCaching,false);assert.equal(opened.source.headers.Authorization,'Bearer current-jwt');assert.equal(opened.source.uri.includes('current-jwt'),false);h.close();assert.equal(f.transports[0].closeCalls,1);
});
test('background and account changes close pending grants and discard late results',async()=>{
 for(const event of ['background','account']){const f=fixture({pending:true}),h=f.mount();await nextTurn();assert.equal(f.transports.length,1);f[event]();f.resolve();await nextTurn();assert.equal(f.transports[0].closed,true);assert.equal(f.child(h),undefined);assert.equal(f.players.length,0);h.close();}
});
test('external terminal close clears playback before a late HLS response arrives',async()=>{
 let stop;const f=fixture({pending:true}),h=f.mount(undefined,{messageId:message,userId:user,uri:original,onStopReady:fn=>stop=fn});await nextTurn();stop();f.resolve();await nextTurn();assert.equal(f.transports[0].closed,true);assert.equal(f.child(h),undefined);h.close();
});
test('expiry unloads the visible player and closes the HLS grant once',async()=>{
 const closes=[];const f=fixture(),h=f.mount(undefined,{messageId:message,userId:user,uri:original,onClose:reason=>closes.push(reason)});await nextTurn();const c=f.child(h),video=f.mount(c.type,c.props);const player=f.players[0];assert.equal(player.playing,true);
 for(const callback of [...f.timers.values()])callback();assert.equal(player.playing,false);assert.equal(player.replacements.at(-1),null);assert.equal(f.transports[0].closeCalls,1);assert.deepEqual(closes,['expired']);video.close();h.close();
});
test('HLS failure preserves original URL headers clock and paused intent without consuming another view',async()=>{
 const f=fixture(),h=f.mount(undefined,{messageId:message,userId:user,uri:original,headers:{Authorization:'Bearer original-jwt'},requestId:request});await nextTurn();const c=f.child(h),video=f.mount(c.type,c.props),player=f.players[0];player.currentTime=4.5;player.emit('playingChange',{isPlaying:false});player.status='error';player.emit('statusChange',{status:'error'});
 const recovered=f.child(h).props.opened;assert.equal(recovered.source.uri,original);assert.equal(recovered.source.headers.Authorization,'Bearer original-jwt');assert.equal(recovered.source.useCaching,false);assert.equal(recovered.position,4.5);assert.equal(recovered.playing,false);assert.equal(f.transports.length,1);assert.equal(f.transports[0].closed,true);video.close();h.close();
});
test('an HLS player that failed before listener attachment still falls back once',async()=>{
 const f=fixture({initialPlayerStatus:'error'}),h=f.mount();await nextTurn();const c=f.child(h),video=f.mount(c.type,c.props);
 assert.equal(f.child(h).props.opened.adaptive,false);assert.equal(f.child(h).props.opened.source.uri,original);
 assert.equal(f.players[0].playing,false);assert.equal(f.transports[0].closeCalls,1);video.close();h.close();
});
