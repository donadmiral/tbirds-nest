const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
const words=node=>!node?'':Array.isArray(node)?node.map(words).join(' '):typeof node==='object'?words(node.props?.children):typeof node==='function'?'':String(node);

function createFilmHarness(ts,platform,{pages=[{id:'one',media_type:'image',media_url:'signed:first'},{id:'two',media_type:'image',media_url:'signed:second'}],deferredAudio=false,component='film',videoPage={id:'video',media_type:'video',media_url:'signed:clip',media_transform:{trimStart:2,trimEnd:5,speed:2}}}={}){
 const slots=[],timers=new Map(),effects=[],appListeners=new Set(),windowListeners=new Map(),documentListeners=new Map(),players=[],sounds=[];
 let cursor=0,dirty=true,tree,now=0,nextTimer=0,active=true,callState='idle',closed=0,read=0,retries=0,audioResolve,unloaded=false;
 let renderedPages=pages,progress=[],ended=0,ready=0,failed=0;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const hooks={
  useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},
  useState(value){const i=cursor++;if(!slots[i])slots[i]={value:typeof value==='function'?value():value};return[slots[i].value,next=>{const v=typeof next==='function'?next(slots[i].value):next;if(!Object.is(v,slots[i].value)){slots[i].value=v;dirty=true;}}];},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||!equal(old.deps,deps)){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},
  useCallback(fn,deps){const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps))slots[i]={deps,value:fn};return slots[i].value;},
  useMemo(fn,deps){const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
 };
 const createMedia=()=>({isConnected:true,paused:true,muted:true,volume:1,duration:10,currentTime:0,playbackRate:1,status:'readyToPlay',playCalls:0,pauseCalls:0,playReject:null,playPending:null,
  play(){this.playCalls++;if(this.playReject)return Promise.reject(this.playReject);this.paused=false;return this.playPending??Promise.resolve();},pause(){this.pauseCalls++;this.paused=true;},load(){},
 });
 const audioNode=createMedia(),videoNode=createMedia();
 const audioAPI={Sound:{createAsync(){const sound={status:[],unload:0,async setStatusAsync(value){this.status.push(value);},async unloadAsync(){this.unload++;}};sounds.push(sound);return deferredAudio?new Promise(resolve=>{audioResolve=()=>resolve({sound});}):Promise.resolve({sound});}}};
 const app={currentState:'active',addEventListener(_event,fn){appListeners.add(fn);return{remove:()=>appListeners.delete(fn)};}};
 const document={hidden:false,documentElement:{dataset:{}},addEventListener(name,fn){if(!documentListeners.has(name))documentListeners.set(name,new Set());documentListeners.get(name).add(fn);},removeEventListener(name,fn){documentListeners.get(name)?.delete(fn);}};
 const window={addEventListener(name,fn){if(!windowListeners.has(name))windowListeners.set(name,new Set());windowListeners.get(name).add(fn);},removeEventListener(name,fn){windowListeners.get(name)?.delete(fn);}};
 let observer;
 const globals={console,Promise,Map,Set,Math,Date:{now:()=>now},setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay,at:now+delay,interval:false});return id;},clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay,at:now+delay,interval:true});return id;},clearInterval:id=>timers.delete(id),document,window,MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){observer=null;}},Image:class{set src(value){}},};
 const runtime={jsx:(type,props,key)=>({type,props:props??{},key}),jsxs:(type,props,key)=>({type,props:props??{},key})};
 const cache=new Map();
 function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file);const module={exports:{}};cache.set(file,module.exports);let source=fs.readFileSync(file,'utf8');if(file.endsWith('/MemoryFilm.tsx'))source+='\nexport const __TestFilmVideo = FilmVideo;';
  const localRequire=name=>{
   if(name==='react')return {...hooks,default:hooks};if(name==='react/jsx-runtime')return runtime;
   if(name==='react-native')return{Modal:'Modal',View:'View',Text:'Text',TouchableOpacity:'TouchableOpacity',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:value=>value,absoluteFill:{},absoluteFillObject:{}},Animated:{Value:class{constructor(value){this.value=value;}setValue(value){this.value=value;}},View:'AnimatedView',timing:()=>({start(){},stop(){}})},AppState:app,AccessibilityInfo:{isScreenReaderEnabled:async()=>false,addEventListener:()=>({remove(){}})}};
   if(name==='expo-image')return{Image:Object.assign('Image',{prefetch:async()=>true})};
   if(name==='expo-av')return{Audio:audioAPI};
   if(name.endsWith('modules/boomerang/storyVideo')) { const api=localRequire('expo-video'); return {StoryVideoView:api.VideoView,useStoryVideoPlayer:api.useVideoPlayer}; }
   if(name==='expo-video')return{VideoView:'VideoView',useVideoPlayer:(_url,setup)=>{const holder=hooks.useRef(null);if(!holder.current){const listeners=new Map(),p={duration:10,currentTime:0,volume:1,muted:true,status:'readyToPlay',playing:false,play(){p.playing=true;},pause(){p.playing=false;},addListener(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);return{remove:()=>listeners.get(event).delete(fn)};},emit(event,value){for(const fn of listeners.get(event)??[])fn(value);}};setup(p);holder.current=p;players.push(p);}return holder.current;}};
   if(name.includes('CallContext'))return{useCallContext:()=>({callState})};
   if(name.includes('SafeArea'))return{useSafeAreaInsets:()=>({top:0,bottom:0})};
   if(name.endsWith('useMemoryPlayback'))return{useMemoryPlayback:load('shared/useMemoryPlayback.ts').createMemoryPlaybackHook(hooks)};
   if(name.endsWith('useMemoryDialog'))return{useMemoryDialog:()=>hooks.useRef(null)};
   if(name.endsWith('MemoryPageImage'))return{__esModule:true,default:'MemoryPageImage',MemoryPageImage:'MemoryPageImage'};
   if(name.endsWith('MemoryStoryFrame'))return{__esModule:true,default:'MemoryStoryFrame',MemoryStoryFrame:'MemoryStoryFrame'};
   if(name.endsWith('.css'))return{__esModule:true,default:new Proxy({}, {get:(_,key)=>String(key)})};
   if(name.endsWith('.m4a'))return 123;
   if(name.includes('/shared/')||name.startsWith('./memory')){const target=path.resolve(path.dirname(file),name)+'.ts';return load(target);}
   if(name==='lucide-react')return new Proxy({}, {get:(_,key)=>String(key)});
   if(name==='@expo/vector-icons')return{Feather:'Feather'};
   return{default:name};
  };
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module,exports:module.exports,require:localRequire,...globals});cache.set(file,module.exports);return module.exports;
 }
 const source=platform==='native'?'src/components/memory/MemoryFilm.tsx':'web/components/memory/MemoryFilm.tsx';
 const mod=load(source),Component=component==='video'?mod.__TestFilmVideo:platform==='native'?mod.default:mod.MemoryFilm;
 function allNodes(){const nodes=walk(tree);for(const node of [...nodes])if(node.type==='MemoryStoryFrame'&&typeof node.props.children==='function')nodes.push(...walk(node.props.children(platform==='native'?{fit:'contain',style:{}}:{})));return nodes;}
 function render(){let guard=0;while(dirty&&!unloaded){if(++guard>40)throw Error('render loop');dirty=false;cursor=0;tree=Component(component==='video'?{item:load('shared/memoryFilm.ts').memoryFilmItems([videoPage])[0],active,muted:true,onReady:()=>ready++,onError:()=>failed++,onProgress:value=>progress.push(value),onEnd:()=>ended++}:{title:'Our moments',pages:renderedPages,active,reduceMotion:false,onClose:()=>closed++,onReadBook:()=>read++,onRetry:()=>retries++,onPost:()=>closed++});for(const node of allNodes()){if(node.type==='audio'&&node.props.ref)node.props.ref.current=audioNode;if(node.type==='video'&&node.props.ref)node.props.ref.current=videoNode;}while(effects.length)effects.shift()();}}
 async function settle(){for(let i=0;i<8;i++){render();await new Promise(resolve=>setImmediate(resolve));}render();}
 return{settle,nodes:allNodes,words:()=>words(tree).replace(/\s+/g,' ').trim(),sounds,players,audioNode,videoNode,progress,get ended(){return ended;},get ready(){return ready;},get failed(){return failed;},get closed(){return closed;},get read(){return read;},get retries(){return retries;},load,
  press(label){const node=allNodes().find(node=>(node.props['aria-label']??node.props.accessibilityLabel)===label);if(!node)throw Error('Missing control: '+label);(node.props.onClick??node.props.onPress)();},
  mediaReady(){const node=allNodes().find(node=>node.type==='MemoryPageImage');node?.props.onReady();},
  async tick(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){if(timer.interval)timer.at=now+timer.delay;else timers.delete(id);timer.fn();}await settle();},
  setActive(value){active=value;dirty=true;},setPages(value){renderedPages=value;dirty=true;},setCall(value){callState=value;document.documentElement.dataset.platinumCallActive=value==='idle'?'false':'true';observer?.();dirty=true;},
  setForeground(value){app.currentState=value?'active':'background';document.hidden=!value;for(const fn of appListeners)fn(app.currentState);for(const fn of documentListeners.get('visibilitychange')??[])fn();},
  resolveAudio(){audioResolve?.();},
  dispose(){unloaded=true;audioNode.isConnected=false;videoNode.isConnected=false;for(const slot of slots)slot?.cleanup?.();},get timerCount(){return timers.size;},
 };
}
module.exports={createFilmHarness,walk,words};
