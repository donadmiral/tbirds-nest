const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const shared={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.join(root,'shared/postMediaEditing.ts'),'utf8')),shared);
const voice={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.join(root,'shared/postVoiceEffects.ts'),'utf8')),voice);
const walk=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(walk):[node,...walk(node.props?.children)];
function harness(file,props,clock={setTimeout,clearTimeout}){
  let cursor=0;const states=[],deps=[],effects=[],cleanups=[],listeners=new Map();
  const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(value){const i=cursor++;return states[i]??={current:value};},useTransition(){return[false,fn=>fn()];},useEffect(fn,next){const i=cursor++;if(!deps[i]||next.some((value,n)=>value!==deps[i][n])){deps[i]=next;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}};
  const jsx=(type,props,key)=>({type,props,key});
  class Element { constructor(){this.focused=0;this.isConnected=true;} focus(){this.focused++;} }
  const trigger=new Element();
  const document={activeElement:trigger,body:{style:{overflow:"auto"}},hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const window={dispatchEvent:event=>listeners.get(event.type)?.(),addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const exports={};vm.runInNewContext(compile(fs.readFileSync(path.join(root,'admin-web/components',file),'utf8')),{exports,document,window,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,HTMLElement:Element,Event:class Event{constructor(type){this.type=type;}},require:name=>({'react':react,'next/image':{default:'img'},'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({refresh(){}})},'../../shared/postMediaEditing':shared.exports,'../../shared/postVoiceEffects':voice.exports,'../../shared/storyFilterAppearance':{STORY_FILTERS:[],filterCss:()=>undefined},'../../shared/StoryAdjustOverlay':{AdjustOverlay:'AdjustOverlay'},'./MediaPreview':{default:'MediaPreview'}}[name]??{})});
  const player={duration:12,currentTime:0,readyState:2,seeking:false,playbackRate:1,pauses:0,pause(){this.pauses++;},play:async()=>{}};
  const dialog={open:true,modal:false,isConnected:true,show(){this.open=true;this.modal=false;},showModal(){this.open=true;this.modal=true;},close(){this.open=false;this.modal=false;}};
  let current=props;
  const render=()=>{cursor=0;let tree=exports.default(current);if(typeof tree?.type==='function')tree=tree.type(tree.props);const dialogNode=walk(tree).find(n=>n.type==='dialog');dialog.isConnected=!!dialogNode;if(dialogNode?.props.ref)dialogNode.props.ref.current=dialog;const node=walk(tree).find(n=>n.type==='video');if(node?.props.ref)node.props.ref.current=player;while(effects.length)effects.shift()();return tree;};
  return{render,player,document,listeners,dialog,trigger,setProps:value=>{current=value;},find:fn=>walk(render()).find(fn),unmount:()=>cleanups.forEach(fn=>fn?.())};
}
function timerClock(){
  let now=0,next=0;const timers=new Map();
  return{setTimeout(fn,ms){const id=++next;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id),advance(ms){now+=ms;for(const[id,timer]of[...timers])if(timer.at<=now){timers.delete(id);timer.fn();}}};
}
test('admin thumbnails show the authorized uploaded cover instead of decoding and replacing it with a video frame',()=>{
  const h=harness('MediaPreview.tsx',{url:'signed:video',video:true,thumbnail:true,edit:{aspectRatio:.8,coverUrl:'signed:cover',coverAt:3}});
  const nodes=walk(h.render());assert.equal(nodes.filter(n=>n.type==='video').length,0);assert.equal(nodes.find(n=>n.type==='img').props.src,'signed:cover');
  nodes.find(n=>n.type==='img').props.onError();assert.equal(h.find(n=>n.type==='video'),undefined);assert.ok(h.find(n=>n.props?.['aria-label']==='Reload media preview'));h.unmount();
});
test('admin trim seeks, captions and playback stop obey the saved recipe',()=>{
  const h=harness('MediaPreview.tsx',{url:'signed:video',video:true,edit:{aspectRatio:.8,trimStart:2,trimEnd:10,speed:1.5,captions:[{text:'Our weekend',start:2,end:4,style:'bold',position:'bottom'}]}});
  h.find(n=>n.type==='video').props.onLoadedMetadata({currentTarget:h.player});assert.equal(h.player.currentTime,2);assert.equal(h.player.playbackRate,1.5);
  h.find(n=>n.type==='video').props.onPlay({currentTarget:h.player});assert.ok(walk(h.render()).some(n=>n.props?.children==='Our weekend'));
  const slider=h.find(n=>n.type==='input');assert.equal(slider.props.max,9.95);slider.props.onChange({target:{value:99}});assert.equal(h.player.currentTime,9.95);
  h.player.currentTime=10;h.find(n=>n.type==='video').props.onTimeUpdate({currentTarget:h.player});assert.equal(h.player.currentTime,2);assert.equal(h.player.pauses,1);
  h.document.hidden=true;h.listeners.get('visibilitychange')();assert.equal(h.player.pauses,2);h.unmount();assert.equal(h.player.pauses,3);assert.equal(h.listeners.size,0);
});
test('admin gallery navigates immediately after a media list shrinks and handles an empty list',()=>{
  const media=Array.from({length:5},(_,n)=>({url:`signed:${n}`}));const h=harness('ReviewMediaGallery.tsx',{media});
  h.find(n=>n.props?.['aria-label']==='View attachment 5').props.onClick();assert.equal(h.find(n=>n.type==='MediaPreview').props.url,'signed:4');
  h.setProps({media:media.slice(0,2)});assert.equal(h.find(n=>n.type==='MediaPreview').props.url,'signed:1');h.find(n=>n.props?.['aria-label']==='Previous attachment').props.onClick();assert.equal(h.find(n=>n.type==='MediaPreview').props.url,'signed:0');
  h.setProps({media:[]});assert.equal(h.render(),null);
});
test('legacy moderation details preserve the whole unknown-size image or video while respecting an authored crop',()=>{
  for(const video of [false,true]){
    const legacy=harness('MediaPreview.tsx',{url:'signed:legacy',video});
    assert.equal(legacy.find(n=>n.type===(video?'video':'img')).props.style.objectFit,'contain');legacy.unmount();
    const thumbnail=harness('MediaPreview.tsx',{url:'signed:legacy',video,thumbnail:true});
    if(video){assert.equal(thumbnail.find(n=>n.type==='video'),undefined);assert.ok(thumbnail.find(n=>n.props?.['aria-label']==='Video preview'));}
    else assert.equal(thumbnail.find(n=>n.type==='img').props.style.objectFit,'cover');thumbnail.unmount();
    const cropped=harness('MediaPreview.tsx',{url:'signed:authored',video,edit:{fit:'cover',aspectRatio:.8}});
    assert.equal(cropped.find(n=>n.type===(video?'video':'img')).props.style.objectFit,'cover');cropped.unmount();
  }
});

test('admin media review reproduces the authored voice preset without altering trim',()=>{
  const h=harness('MediaPreview.tsx',{url:'signed:video',video:true,edit:{voiceEffect:'deep',trimStart:2,trimEnd:9}});
  h.find(n=>n.type==='video').props.onLoadedMetadata({currentTarget:h.player});
  assert.equal(h.player.playbackRate,.75);assert.equal(h.player.preservesPitch,false);assert.equal(h.player.currentTime,2);h.unmount();
});

test('expanded admin photos consume Escape without closing the record and restore focus',()=>{
  const h=harness('ReviewMediaGallery.tsx',{media:[{url:'signed:photo'}]});
  h.find(n=>n.type==='MediaPreview').props.onExpand();
  // Hiding the inline preview can move browser focus before the effect runs.
  h.document.activeElement = null;
  const open=h.render();
  assert.equal(h.dialog.open,true);assert.equal(h.document.body.style.overflow,'hidden');
  assert.equal(walk(open).filter(n=>n.type==='MediaPreview').length,1,'Only the full-screen media instance remains mounted');
  let prevented=false,stopped=false;
  walk(open).find(n=>n.type==='dialog').props.onKeyDown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  h.render();assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(h.dialog.modal,false);assert.equal(h.dialog.open,true);assert.equal(h.document.body.style.overflow,'auto');assert.equal(h.trigger.focused,1);
  h.unmount();
});

test('a granted video poster remains visible until a decoded frame is ready',()=>{
  const h=harness('MediaPreview.tsx',{url:'signed:video',poster:'signed:poster',video:true,edit:{trimStart:2,trimEnd:8}});
  let frame, nextId=0;
  h.player.requestVideoFrameCallback=callback=>{frame=callback;return ++nextId;};h.player.cancelVideoFrameCallback=()=>{};
  const video=h.find(n=>n.type==='video');assert.equal(video.props.preload,'auto');
  video.props.onLoadedMetadata({currentTarget:h.player});video.props.onPlay({currentTarget:h.player});
  assert.ok(h.find(n=>n.type==='img'&&n.props.src==='signed:poster'));
  frame(0,{mediaTime:0});assert.ok(h.find(n=>n.type==='img'&&n.props.src==='signed:poster'),'An untrimmed decoded frame cannot replace the poster');
  video.props.onSeeked({currentTarget:h.player});frame(0,{mediaTime:2});
  assert.equal(h.find(n=>n.type==='img'),undefined);h.unmount();
});

test('a buffered paused video remains playable after the loading deadline without revealing an unverified frame',()=>{
  const clock=timerClock();
  const h=harness('MediaPreview.tsx',{url:'signed:video',poster:'signed:poster',video:true,edit:{trimStart:2,trimEnd:8}},clock);
  let frame,nextId=0;h.player.readyState=4;
  h.player.requestVideoFrameCallback=callback=>{frame=callback;return ++nextId;};h.player.cancelVideoFrameCallback=()=>{};
  h.find(n=>n.type==='video').props.onLoadedMetadata({currentTarget:h.player});
  h.find(n=>n.type==='video').props.onLoadedData({currentTarget:h.player});h.render();
  // A paused browser may not deliver another presented-frame callback until Play.
  clock.advance(20_000);
  assert.ok(h.find(n=>n.type==='video'),'A fully buffered paused preview must not expire while staff read the record');
  assert.ok(h.find(n=>n.type==='img'&&n.props.src==='signed:poster'));
  assert.equal(h.find(n=>n.props?.['aria-label']==='Play video preview').props.disabled,false);
  h.find(n=>n.type==='video').props.onPlay({currentTarget:h.player});h.render();
  clock.advance(14_000);assert.ok(h.find(n=>n.type==='video'));
  frame(0,{mediaTime:2});h.render();clock.advance(20_000);
  assert.ok(h.find(n=>n.type==='video'));assert.equal(h.find(n=>n.type==='img'),undefined);h.unmount();
});

test('a first-frame deadline counts requested playback, not deliberate pauses',()=>{
  const clock=timerClock();
  const h=harness('MediaPreview.tsx',{url:'signed:video',poster:'signed:poster',video:true},clock);
  h.player.requestVideoFrameCallback=()=>1;h.player.cancelVideoFrameCallback=()=>{};
  h.find(n=>n.type==='video').props.onLoadedMetadata({currentTarget:h.player});
  h.find(n=>n.type==='video').props.onLoadedData({currentTarget:h.player});
  h.find(n=>n.type==='video').props.onPlay({currentTarget:h.player});h.render();
  clock.advance(14_000);assert.ok(h.find(n=>n.type==='video'));
  h.find(n=>n.type==='video').props.onPause();h.render();clock.advance(20_000);
  assert.ok(h.find(n=>n.type==='video'));
  h.find(n=>n.type==='video').props.onPlay({currentTarget:h.player});h.render();clock.advance(15_000);
  assert.ok(h.find(n=>n.props?.['aria-label']==='Reload media preview'),'A real presented-frame stall during playback remains bounded');h.unmount();
});

test('metadata alone does not clear the video loading deadline',()=>{
  const clock=timerClock();const h=harness('MediaPreview.tsx',{url:'signed:video',video:true},clock);
  h.player.readyState=1;h.find(n=>n.type==='video').props.onLoadedMetadata({currentTarget:h.player});h.render();
  clock.advance(15_000);assert.ok(h.find(n=>n.props?.['aria-label']==='Reload media preview'));h.unmount();
});

test('removing media while full screen is open restores document scrolling',()=>{
  const h=harness('ReviewMediaGallery.tsx',{media:[{url:'signed:photo'}]});
  h.find(n=>n.type==='MediaPreview').props.onExpand();h.render();
  assert.equal(h.document.body.style.overflow,'hidden');
  h.setProps({media:[]});assert.equal(h.render(),null);
  assert.equal(h.document.body.style.overflow,'auto');assert.equal(h.dialog.open,false);h.unmount();
});
