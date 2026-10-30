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
function harness(file,props){
  let cursor=0;const states=[],deps=[],effects=[],cleanups=[],listeners=new Map();
  const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(value){const i=cursor++;return states[i]??={current:value};},useTransition(){return[false,fn=>fn()];},useEffect(fn,next){const i=cursor++;if(!deps[i]||next.some((value,n)=>value!==deps[i][n])){deps[i]=next;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}};
  const jsx=(type,props,key)=>({type,props,key});
  const document={hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const exports={};vm.runInNewContext(compile(fs.readFileSync(path.join(root,'admin-web/components',file),'utf8')),{exports,document,window,require:name=>({'react':react,'next/image':{default:'img'},'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({refresh(){}})},'../../shared/postMediaEditing':shared.exports,'../../shared/postVoiceEffects':voice.exports,'../../shared/storyFilterAppearance':{STORY_FILTERS:[],filterCss:()=>undefined},'../../shared/StoryAdjustOverlay':{AdjustOverlay:'AdjustOverlay'},'./MediaPreview':{default:'MediaPreview'}}[name]??{})});
  const player={duration:12,currentTime:0,playbackRate:1,pauses:0,pause(){this.pauses++;},play:async()=>{}};
  let current=props;
  const render=()=>{cursor=0;let tree=exports.default(current);if(typeof tree?.type==='function')tree=tree.type(tree.props);const node=walk(tree).find(n=>n.type==='video');if(node?.props.ref)node.props.ref.current=player;while(effects.length)effects.shift()();return tree;};
  return{render,player,document,listeners,setProps:value=>{current=value;},find:fn=>walk(render()).find(fn),unmount:()=>cleanups.forEach(fn=>fn?.())};
}
test('admin thumbnails show the authorized uploaded cover instead of decoding and replacing it with a video frame',()=>{
  const h=harness('MediaPreview.tsx',{url:'signed:video',video:true,thumbnail:true,edit:{aspectRatio:.8,coverUrl:'signed:cover',coverAt:3}});
  const nodes=walk(h.render());assert.equal(nodes.filter(n=>n.type==='video').length,0);assert.equal(nodes.find(n=>n.type==='img').props.src,'signed:cover');
  nodes.find(n=>n.type==='img').props.onError();assert.ok(h.find(n=>n.type==='video'));h.unmount();
});
test('admin trim seeks, captions and playback stop obey the saved recipe',()=>{
  const h=harness('MediaPreview.tsx',{url:'signed:video',video:true,edit:{aspectRatio:.8,trimStart:2,trimEnd:10,speed:1.5,captions:[{text:'Our weekend',start:2,end:4,style:'bold',position:'bottom'}]}});
  h.find(n=>n.type==='video').props.onLoadedMetadata({currentTarget:h.player});assert.equal(h.player.currentTime,2);assert.equal(h.player.playbackRate,1.5);
  h.find(n=>n.type==='video').props.onPlay();assert.ok(walk(h.render()).some(n=>n.props?.children==='Our weekend'));
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
    assert.equal(thumbnail.find(n=>n.type===(video?'video':'img')).props.style.objectFit,'cover');thumbnail.unmount();
    const cropped=harness('MediaPreview.tsx',{url:'signed:authored',video,edit:{fit:'cover',aspectRatio:.8}});
    assert.equal(cropped.find(n=>n.type===(video?'video':'img')).props.style.objectFit,'cover');cropped.unmount();
  }
});

test('admin media review reproduces the authored voice preset without altering trim',()=>{
  const h=harness('MediaPreview.tsx',{url:'signed:video',video:true,edit:{voiceEffect:'deep',trimStart:2,trimEnd:9}});
  h.find(n=>n.type==='video').props.onLoadedMetadata({currentTarget:h.player});
  assert.equal(h.player.playbackRate,.75);assert.equal(h.player.preservesPitch,false);assert.equal(h.player.currentTime,2);h.unmount();
});
