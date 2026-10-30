const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const text=file=>fs.readFileSync(path.join(root,file),'utf8');
function compile(file,globals={},pick){
 let code=text(file);
 if(pick){const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);code=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&pick.includes(s.name?.text)).map(s=>s.getText(ast)).join('\n');}
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,console,setTimeout,clearTimeout,queueMicrotask,...globals},{filename:file});
 return module.exports;
}
const soundtrack=compile('shared/soundtrack.ts'),editing=compile('shared/postMediaEditing.ts'),voice=compile('shared/postVoiceEffects.ts');
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
const walk=node=>Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];
const words=node=>Array.isArray(node)?node.map(words).join(' '):typeof node==='string'?node:node&&typeof node==='object'?words(node.props?.children):'';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const turn=()=>new Promise(r=>setImmediate(r));
function hooks(){
 let cursor=0,dirty=true,tree,renderFn,commit=()=>{};const slots=[],effects=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const n=typeof next==='function'?next(slots[i]):next;if(!Object.is(n,slots[i])){slots[i]=n;dirty=true;}}];},
  useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!same(old?.deps,deps)){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},
 };
 react.useLayoutEffect=react.useEffect;
 function render(force=false){if(force)dirty=true;let n=0;while(dirty){assert.ok(++n<40,'component render settled');dirty=false;cursor=0;tree=renderFn();commit(tree);while(effects.length)effects.shift()();}return tree;}
 return{react,mount(fn,onCommit){renderFn=fn;if(onCommit)commit=onCommit;return render();},render,async flush(){for(let i=0;i<5;i++){await turn();render();}},get nodes(){return walk(tree);},dispose(){slots.forEach(s=>s?.cleanup?.());}};
}
function timers(){let id=0;const tasks=new Map();return{setTimeout(fn,ms){const key=++id;tasks.set(key,{fn,ms});return key;},clearTimeout:key=>tasks.delete(key),run(ms){for(const[key,t]of [...tasks])if(t.ms===ms){tasks.delete(key);t.fn();}},get size(){return tasks.size;}};}
const first={id:'11111111-1111-4111-8111-111111111111',title:'Morning',artist:'A real fixture',source:'original',duration_sec:40,max_excerpt_sec:12,url:'https://fixture.invalid/first'},second={id:'22222222-2222-4222-8222-222222222222',title:'Evening',artist:'A real fixture',source:'library',duration_sec:50,max_excerpt_sec:15,url:'https://fixture.invalid/second'};
const choice={soundId:first.id,startSec:2,durationSec:8,volume:.6,originalVolume:.3};
function picker(platform,options={}){
 const h=hooks(),time=timers(),saved=new Map(),reads=[],writes=[],checks=[],changes=[],previews=[],audio=[];
 const control=compile('shared/soundtrackPicker.ts',time);
 let denied=false,closed=0,dismissed=0;
 const list=async(use,query)=>{reads.push({use,query});if(options.listError)throw Error('offline');return options.rows??[first,second];};
 const get=(id,use)=>{checks.push({id,use});if(denied)return Promise.reject(Error('revoked'));if(options.check)return options.check(id,use);return Promise.resolve(id===first.id?first:second);};
 const storage={getItem:async key=>saved.get(key)??null,setItem:async(key,value)=>{writes.push({key,value});saved.set(key,value);}};
 const props={visible:true,value:null,use:'post',ownerId:'account-a',originalAudio:true,onChange:value=>changes.push(value),onClose:()=>{closed++;},renderPreview:(selection,active)=>{previews.push({selection,active});return jsx.jsx('Draft',{selection,active});},...options.props};
 const originals={soundFavorites:async()=>saved.get(props.ownerId)||[],saveSoundFavorite:async(id,value)=>{writes.push({owner:props.ownerId,id,saved:value});const current=saved.get(props.ownerId)||[];saved.set(props.ownerId,value?[...current,id]:current.filter(x=>x!==id));}};
 const native={View:'View',Text:'Text',TextInput:'Input',TouchableOpacity:'Button',ActivityIndicator:'Spinner',Modal:'Modal',ScrollView:'ScrollView',KeyboardAvoidingView:'KeyboardAvoidingView',Platform:{OS:'ios'},Keyboard:{dismiss:()=>{dismissed++;}},StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:390,height:844})};
 const mods={'./OriginalAudioUpload':{OriginalAudioUpload:'OriginalAudioUpload'},'../services/originalAudioService':originals,'@/lib/originalAudio':originals,react:h.react,'react/jsx-runtime':jsx,'react-native':native,'@expo/vector-icons':{Feather:'Icon'},'@react-native-async-storage/async-storage':{default:storage,__esModule:true},'./stories/storyPanels':{MiniSlider:'Slider'},'./SafeArea':{SafeAreaView:'SafeArea'},'../services/soundtrackService':{getSoundtrack:get,listSoundtracks:list},'../hooks/useSoundtrackPlayer':{useSoundtrackPlayer:args=>{audio.push(args);return{error:'',retry(){}};}},'../../shared/soundtrack':soundtrack,'../../shared/musicAvailability':options.musicAvailable===false?{ORIGINAL_AUDIO_ENABLED:false,MUSIC_UNAVAILABLE_MESSAGE:'Unavailable fixture'}:{ORIGINAL_AUDIO_ENABLED:true,MUSIC_UNAVAILABLE_MESSAGE:'Unavailable fixture'},'../../shared/soundtrackPicker':control,'@/lib/soundtrack':{getSoundtrack:get,listSoundtracks:list},'./PostSoundtrack':{PostSoundtrack:'Soundtrack'},'./SoundtrackPicker.module.css':{default:new Proxy({},{get:(_,k)=>k}),__esModule:true},'lucide-react':new Proxy({},{get:(_,k)=>k})};
 const document={activeElement:null};
 const global={...time,document,HTMLElement:class{},localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{writes.push({key,value});saved.set(key,value);}},require:name=>{assert.ok(name in mods,name);return mods[name];}};
 const component=compile(platform==='native'?'src/components/SoundtrackPicker.tsx':'web/components/SoundtrackPicker.tsx',global).default;
 h.mount(()=>{const node=component(props);return typeof node?.type==='function'?node.type(node.props):node;});
 function button(label){const found=h.nodes.find(n=>(n.type==='Button'||n.type==='button')&&(n.props.accessibilityLabel===label||n.props['aria-label']===label||words(n).trim()===label));assert.ok(found,'button '+label);return found;}
 function press(label){const node=button(label);assert.ok(!node.props.disabled,label+' enabled');(node.props.onPress??node.props.onClick)();h.render();}
 function slider(label,value){const n=h.nodes.find(n=>platform==='native'?n.type==='Slider'&&n.props.label===label:n.type==='input'&&n.props.type==='range'&&n.props['aria-label']===label);assert.ok(n,'slider '+label);n.props.onChange(platform==='native'?value:{target:{value:String(value)}});h.render();}
 return{...h,get nodes(){return h.nodes;},button,press,slider,reads,writes,checks,changes,previews,audio,props,time,control,saved,async load(){await h.flush();time.run(180);await h.flush();},update(next){Object.assign(props,next);h.render(true);},deny(){denied=true;},get closed(){return closed;},get dismissed(){return dismissed;}};
}

for(const platform of ['native','web']){
 test(platform+' music browse → excerpt → mix uses authorized real rows and commits bounded controls',async()=>{
  const gate=deferred(),h=picker(platform,{check:()=>gate.promise});await h.load();assert.equal(h.reads.length,1);
  h.press('Choose Morning');assert.equal(h.button('Use track').props.disabled,true,'metadata cannot bypass the server check');
  gate.resolve(first);await h.flush();assert.equal(h.button('Use track').props.disabled,false);
  h.press('Use track');assert.ok(h.nodes.some(n=>words(n)==='Music excerpt'));
  h.slider('Length',5);h.slider('Start',900);h.press('Preview excerpt');
  const preview=h.previews.at(-1);assert.equal(preview.active,true);assert.equal(preview.selection.startSec,35);assert.equal(preview.selection.durationSec,5);
  if(platform==='native')assert.equal(h.audio.at(-1).active,false,'media preview owns its single music stream');else assert.equal(h.nodes.some(n=>n.type==='Soundtrack'),false);
  h.press('Next');h.slider('Original video',platform==='native'?20:.2);h.slider('Morning',platform==='native'?55:.55);h.press('Done');
  assert.equal(h.changes.length,1);assert.equal(h.changes[0].originalVolume,.2);assert.equal(h.changes[0].volume,.55);assert.equal(h.changes[0].durationSec,5);assert.equal(h.closed,1);h.dispose();
 });
 test(platform+' real Originals and Saved filters recheck rights; bookmarks store IDs for the current account only',async()=>{
  const h=picker(platform);await h.load();h.press('Save Morning');await h.flush();
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].owner,'account-a');assert.equal(h.writes[0].id,first.id);assert.equal(h.writes[0].saved,true);
  h.press('Originals');await h.load();assert.ok(h.button('Choose Morning'));assert.equal(h.nodes.some(n=>n.props?.['aria-label']==='Choose Evening'||n.props?.accessibilityLabel==='Choose Evening'),false);
  h.press('Saved');await h.load();assert.ok(h.checks.some(c=>c.id===first.id&&c.use==='post'));assert.ok(h.button('Choose Morning'));
  h.dispose();const other=picker(platform,{props:{ownerId:'account-b'}});await other.load();other.press('Saved');await other.load();assert.equal(other.nodes.some(n=>n.props?.['aria-label']==='Choose Morning'||n.props?.accessibilityLabel==='Choose Morning'),false);other.dispose();
 });
 test(platform+' denied selection settles, blocks Done, exposes retry and allows removal without committing',async()=>{
  const h=picker(platform,{props:{value:choice},check:()=>Promise.reject(Error('revoked'))});await h.flush();
  assert.ok(h.nodes.some(n=>words(n)==='This sound could not be checked. Retry or choose another.'));
  assert.equal(h.button('Next').props.disabled,true);
  const before=h.checks.length;h.press('This sound could not be checked. Retry or choose another.');await h.flush();assert.equal(h.checks.length,before+1);
  h.press('Remove music');assert.equal(h.changes[0],null);assert.equal(h.closed,1);
  h.dispose();
 });
 test(platform+' empty music library does not invent songs and keeps original-audio guidance',async()=>{
  const h=picker(platform,{rows:[]});await h.load();assert.ok(h.nodes.some(n=>words(n)==='No music available'));assert.ok(h.nodes.some(n=>words(n)==='You can publish with your original audio, or without music.'));assert.equal(h.nodes.some(n=>(n.props?.accessibilityLabel??n.props?.['aria-label']??'').startsWith('Choose ')),false);h.dispose();
 });
}

test('native search and selected mini player remain inside the keyboard avoidance area',async()=>{
 const h=picker('native');await h.load();h.press('Choose Morning');await h.flush();
 const keyboard=h.nodes.find(n=>n.type==='KeyboardAvoidingView');assert.equal(keyboard.props.behavior,'padding');
 assert.ok(walk(keyboard).some(n=>n.type==='Input'&&n.props.accessibilityLabel==='Search music'));
 assert.ok(walk(keyboard).some(n=>n.type==='Button'&&words(n)==='Use track'));
 const scroll=h.nodes.find(n=>n.type==='ScrollView');assert.equal(scroll.props.keyboardDismissMode,'on-drag');assert.equal(scroll.props.keyboardShouldPersistTaps,'handled');
 h.press('Use track');assert.equal(h.dismissed,1);h.dispose();
});

test('saved soundtrack preferences reject objects/URLs and reauthorize all IDs for the requested use',async()=>{
 const helper=compile('shared/soundtrackPicker.ts');assert.deepEqual(Array.from(helper.savedSoundtrackIds(JSON.stringify([first.id,first.id,'https://untrusted.invalid',{url:'bad'},second.id]))),[first.id,second.id]);
 const calls=[];const rows=await helper.loadSoundtrackChoices('memory_album','morning','Saved',[first.id,second.id],async()=>{throw Error('not a catalog read');},async(id,use)=>{calls.push({id,use});if(id===second.id)throw Error('revoked');return first;});assert.equal(rows.length,1);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.use==='memory_album'));
 await assert.rejects(helper.loadSoundtrackChoices('post','','Saved',[first.id],async()=>[],async()=>{throw Error('revoked');}),/could not be checked/);
 await assert.rejects(helper.soundtrackRead(new Promise(()=>{}),5),/too long/);
});

function nativeDraft(initial={}){
 const h=hooks(),events=new Map(),foreground=new Set(),seeks=[],calls=[];
 let callState='idle',currentTime=0,loadedSource;
 const player={status:'readyToPlay',duration:20,volume:1,playbackRate:1,playing:false,
  get currentTime(){return currentTime;},set currentTime(value){currentTime=value;seeks.push(value);},
  addListener(name,callback){if(!events.has(name))events.set(name,new Set());events.get(name).add(callback);return{remove:()=>events.get(name).delete(callback)};},
  play(){this.playing=true;calls.push('play');},pause(){this.playing=false;calls.push('pause');},
 };
 const props={media:{uri:'file://fixture-video.mp4',type:'video',width:390,height:600,edit:{trimStart:4,trimEnd:9,speed:1.5}},soundtrack:choice,...initial};
 const native={AppState:{currentState:'active',addEventListener(_,cb){foreground.add(cb);return{remove:()=>foreground.delete(cb)};}},Image:'Image',View:'View',Text:'Text',TouchableOpacity:'Button',StyleSheet:{absoluteFill:{}}};
 const mods={react:h.react,'react/jsx-runtime':jsx,'react-native':native,'expo-video':{VideoView:'Video',useVideoPlayer(source,setup){if(source!==loadedSource){loadedSource=source;setup(player);}return player;}},'@expo/vector-icons':{Feather:'Icon'},'./stories/storyPanels':{AdjustLayer:'Adjust'},'./stories/StoryFilters':{FilterLayer:'Filter'},'./PostCaption':{default:'Caption',__esModule:true},'./PostSoundtrack':{default:'Soundtrack',__esModule:true},'../contexts/CallContext':{useCallContext:()=>({callState})},'../../shared/postMediaEditing':editing,'../../shared/postVoiceEffects':voice};
 const component=compile('src/components/PostDraftPreview.tsx',{require:name=>{assert.ok(name in mods,name);return mods[name];}}).default;
 h.mount(()=>component(props));
 return{...h,get nodes(){return h.nodes;},props,player,seeks,calls,get soundtrack(){return h.nodes.find(n=>n.type==='Soundtrack')?.props;},emit(name,event){if(name==='statusChange')player.status=event.status;for(const cb of events.get(name)??[])cb(event);h.render();},update(next){Object.assign(props,next);h.render(true);},foreground(state){for(const cb of foreground)cb(state);h.render();},call(state){callState=state;h.render(true);},get listenerCount(){return [...events.values()].reduce((n,v)=>n+v.size,0);}};
}

test('native draft actual video clock drives soundtrack; volume changes do not seek or recreate playback',()=>{
 const h=nativeDraft();assert.equal(h.calls.includes('play'),false,'ordinary draft does not autoplay');assert.equal(h.player.volume,.3);
 h.emit('playingChange',{isPlaying:true});h.emit('timeUpdate',{currentTime:6});assert.equal(h.soundtrack.clock.time,2);assert.equal(h.soundtrack.clock.playing,true);assert.equal(h.soundtrack.clock.rate,1.5);
 const before=h.seeks.length;h.update({soundtrack:{...choice,originalVolume:.15,volume:.8}});assert.equal(h.player.volume,.15);assert.equal(h.seeks.length,before);assert.equal(h.soundtrack.selection.volume,.8);
 h.emit('statusChange',{status:'loading'});assert.equal(h.soundtrack.clock.playing,false);h.emit('statusChange',{status:'readyToPlay'});assert.equal(h.soundtrack.clock.playing,true);
 h.emit('timeUpdate',{currentTime:9.01});assert.equal(h.seeks.at(-1),4);assert.equal(h.soundtrack.clock.time,0);h.dispose();assert.equal(h.listenerCount,0);
});

test('native draft pauses original/music when another editor opens, app backgrounds or a call arrives',()=>{
 const h=nativeDraft({autoPlay:true});assert.ok(h.calls.includes('play'));h.emit('playingChange',{isPlaying:true});
 h.update({active:false});assert.equal(h.calls.at(-1),'pause');assert.equal(h.soundtrack.active,false);assert.equal(h.soundtrack.clock.playing,false);
 h.emit('playingChange',{isPlaying:true});assert.equal(h.calls.at(-1),'pause');assert.equal(h.soundtrack.clock.playing,false);
 h.update({active:true});h.emit('playingChange',{isPlaying:true});h.foreground('background');assert.equal(h.calls.at(-1),'pause');assert.equal(h.soundtrack.active,false);
 h.foreground('active');h.emit('playingChange',{isPlaying:true});h.call('ringing');assert.equal(h.calls.at(-1),'pause');assert.equal(h.soundtrack.clock.playing,false);h.dispose();
});

test('native photo draft has explicit music control, while picker preview uses its shared play control',()=>{
 const h=nativeDraft({media:{uri:'file://fixture-photo.jpg',type:'image'}});assert.equal(h.soundtrack.controls,true);assert.equal(h.soundtrack.clock,undefined);h.update({autoPlay:true,active:false});assert.equal(h.soundtrack.controls,false);assert.equal(h.soundtrack.active,false);h.dispose();
});

function webDraft(initial={}){
 const h=hooks(),listeners=new Map(),seeks=[],calls=[];let currentTime=0;
 const add=(name,cb)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(cb);};
 const remove=(name,cb)=>listeners.get(name)?.delete(cb);
 const document={hidden:false,documentElement:{dataset:{}},addEventListener:add,removeEventListener:remove},window={addEventListener:add,removeEventListener:remove};
 const element={duration:20,readyState:4,paused:true,volume:1,playbackRate:1,
  get currentTime(){return currentTime;},set currentTime(value){currentTime=value;seeks.push(value);},
  play(){calls.push('play');this.paused=false;return Promise.resolve();},pause(){calls.push('pause');this.paused=true;},
 };
 const props={item:{preview:'blob:fixture-video',width:390,height:600,isVideo:true,edit:{trimStart:4,trimEnd:9,speed:1.5}},soundtrack:choice,...initial};
 const mod=compile('web/components/PostMediaEditor.tsx',{...h.react,...editing,...voice,filterCss:()=>'',PostFilterTint:'Tint',AdjustOverlay:'Adjust',PostCaption:'Caption',PostSoundtrack:'Soundtrack',NextImage:'img',document,window,require:name=>{assert.equal(name,'react/jsx-runtime');return jsx;}},['postMediaStyle','PostDraftMedia','PostDraftPreview']);
 h.mount(()=>{const node=mod.PostDraftPreview(props);return node.type(node.props);},tree=>{const node=walk(tree).find(n=>n.type==='video');if(node?.props.ref)node.props.ref.current=element;});
 return{...h,get nodes(){return h.nodes;},props,element,seeks,calls,document,get soundtrack(){return h.nodes.find(n=>n.type==='Soundtrack')?.props;},emit(name){const node=h.nodes.find(n=>n.type==='video');assert.ok(node);node.props[name]({currentTarget:element});h.render();},update(next){Object.assign(props,next);h.render(true);},event(name){for(const cb of listeners.get(name)??[])cb();h.render();},get listenerCount(){return [...listeners.values()].reduce((n,v)=>n+v.size,0);}};
}

test('web draft uses actual media clock/rate, gates stalled audio and mixes without resetting the video',()=>{
 const h=webDraft();assert.equal(h.calls.includes('play'),false);h.emit('onLoadedMetadata');assert.equal(h.element.volume,.3);
 h.element.paused=false;h.emit('onPlay');h.element.currentTime=6;h.emit('onTimeUpdate');assert.equal(h.soundtrack.clock.time,2);assert.equal(h.soundtrack.clock.playing,true);
 const before=h.seeks.length;h.update({soundtrack:{...choice,originalVolume:.12,volume:.9}});assert.equal(h.element.volume,.12);assert.equal(h.seeks.length,before);
 h.element.playbackRate=2;h.emit('onRateChange');assert.equal(h.soundtrack.clock.rate,2);h.emit('onWaiting');assert.equal(h.soundtrack.clock.playing,false);h.emit('onPlaying');assert.equal(h.soundtrack.clock.playing,true);
 h.element.currentTime=9.1;h.emit('onTimeUpdate');assert.equal(h.element.currentTime,4);assert.equal(h.soundtrack.clock.time,0);h.dispose();assert.equal(h.listenerCount,0);
});

test('web draft stops original/music when inactive, hidden or interrupted by a call',()=>{
 const h=webDraft({autoPlay:true});assert.ok(h.calls.includes('play'));h.emit('onPlay');h.update({active:false});assert.equal(h.calls.at(-1),'pause');assert.equal(h.soundtrack.active,false);assert.equal(h.soundtrack.clock.playing,false);
 h.emit('onPlay');assert.equal(h.calls.at(-1),'pause');h.update({active:true});h.emit('onPlay');h.document.hidden=true;h.event('visibilitychange');assert.equal(h.calls.at(-1),'pause');assert.equal(h.soundtrack.clock.playing,false);
 h.document.hidden=false;h.document.documentElement.dataset.platinumCallActive='true';h.event('platinum:stop-media');h.emit('onPlaying');assert.equal(h.calls.at(-1),'pause');assert.equal(h.soundtrack.clock.playing,false);h.dispose();
});

test('web photo draft exposes music play controls outside the picker and respects parent active state',()=>{
 const h=webDraft({item:{preview:'blob:fixture-photo',width:390,height:600,isVideo:false}});assert.equal(h.soundtrack.controls,true);assert.equal(h.soundtrack.autoPlay,false);h.update({autoPlay:true,active:false});assert.equal(h.soundtrack.controls,false);assert.equal(h.soundtrack.active,false);h.dispose();
});

function webAudio(initial={},musicAvailable=true){
 const h=hooks(),audio=[],intervals=new Map(),events=new Map();let denied=false;
 const document={hidden:false,documentElement:{dataset:{}},addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn)};
 const window={addEventListener:document.addEventListener,removeEventListener:document.removeEventListener};
 class Audio{constructor(url){this.url=url;this.paused=true;this.currentTime=0;audio.push(this);}play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;}removeAttribute(name){if(name==='src')this.url=null;}load(){}}
 const props={selection:choice,autoPlay:true,controls:false,active:true,clock:{time:2,playing:true,rate:1.5},...initial};
 const mods={react:h.react,'react/jsx-runtime':jsx,'@/lib/soundtrack':{getSoundtrack:async()=>{if(denied)throw Error('revoked');return first;}},'../../shared/soundtrack':soundtrack,'../../shared/musicAvailability':{ORIGINAL_AUDIO_ENABLED:musicAvailable}};
 const component=compile('web/components/PostSoundtrack.tsx',{require:name=>{assert.ok(name in mods,name);return mods[name];},document,window,Audio,setInterval(fn,ms){const key={fn,ms};intervals.set(key,key);return key;},clearInterval:key=>intervals.delete(key)}).PostSoundtrack;
 h.mount(()=>component(props));
 return{...h,get nodes(){return h.nodes;},audio,intervals,document,update(next){Object.assign(props,next);h.render(true);},event(name){for(const fn of events.get(name)??[])fn();h.render();},tick(ms){for(const t of [...intervals.values()])if(t.ms===ms)t.fn();h.render();},deny(){denied=true;}};
}

test('controlled web soundtrack resumes from parent video play after an interruption and keeps one audio stream',async()=>{
 const h=webAudio();await h.flush();assert.equal(h.audio.length,1);assert.equal(h.audio[0].paused,false);assert.equal(h.audio[0].currentTime,4);assert.equal(h.audio[0].playbackRate,1.5);assert.equal(h.nodes.some(n=>n.type==='button'),false);
 h.event('platinum:stop-media');assert.equal(h.audio[0].paused,true);
 h.update({active:false,clock:{time:2,playing:false,rate:1.5}});h.update({active:true,clock:{time:3,playing:true,rate:1.5}});await h.flush();h.tick(200);await h.flush();
 assert.equal(h.audio[0].paused,false,'a deliberate parent Play must resume the controlled music stream');assert.equal(h.audio[0].currentTime,5);
 h.update({selection:{...choice,volume:.25},clock:{time:4,playing:true,rate:2}});h.tick(200);await h.flush();assert.equal(h.audio.length,1);assert.equal(h.audio[0].volume,.25);assert.equal(h.audio[0].playbackRate,2);
 h.update({clock:{time:4,playing:false,rate:2}});assert.equal(h.audio[0].paused,true);h.dispose();assert.equal(h.intervals.size,0);
});

test('controlled web soundtrack rights failure remains closed with a reachable retry',async()=>{
 const h=webAudio();await h.flush();h.deny();h.tick(30000);await h.flush();assert.equal(h.audio[0].paused,true);h.update({active:false});h.update({active:true});h.tick(200);assert.equal(h.audio[0].paused,true,'parent play cannot override revoked rights');
 const retry=h.nodes.find(n=>n.type==='button');assert.ok(retry);assert.match(words(retry),/no longer available.*Retry/);retry.props.onClick();h.render();await h.flush();assert.equal(h.audio.length,1,'failed reauthorization never creates another audio stream');h.dispose();
});

for(const platform of ['native','web'])test(platform+' emergency original-audio gate shows a clear unavailable state and never requests catalog or rights data',async()=>{
 const h=picker(platform,{musicAvailable:false,props:{value:choice}});await h.load();assert.equal(h.reads.length,0);assert.equal(h.checks.length,0);assert.equal(h.writes.length,0);assert.ok(h.nodes.some(n=>words(n)==='Music unavailable'));assert.equal(h.nodes.some(n=>(n.props?.accessibilityLabel??n.props?.['aria-label'])==='Search music'),false);assert.ok(h.audio.every(call=>!call.selection));h.press('Remove selected music');assert.equal(h.changes[0],null);assert.equal(h.closed,1);h.dispose();
});

test('web playback remains silent and exposes no fake play/retry control when original audio is disabled',async()=>{const h=webAudio({controls:true},false);await h.flush();h.tick(30000);await h.flush();assert.equal(h.audio.length,0);assert.equal(h.intervals.size,0);assert.equal(h.nodes.length,0);h.dispose();});
