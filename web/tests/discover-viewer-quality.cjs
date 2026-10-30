const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..');
const allNodes=tree=>{const list=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;list.push(n);walk(n.props?.children);}walk(tree);return list;};
function runtime(native=false){
 let hooks,currentUser='viewer',authListener,callState='idle';const cache=new Map(),listeners=new Map(),calls=[];
 const dims={width:390,height:844},document={body:{style:{overflow:''}},visibilityState:'visible',activeElement:null,addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};
 const window={addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};
 const authStore=Object.assign(fn=>fn({profile:{id:currentUser}}),{getState:()=>({profile:{id:currentUser}}),subscribe:fn=>{authListener=fn;return()=>{};}});
 const client={auth:{getSession:async()=>({data:{session:{user:{id:currentUser}}}}),onAuthStateChange:fn=>{authListener=fn;return {data:{subscription:{unsubscribe(){}}}};}},rpc:(...args)=>{calls.push(args);return Promise.resolve({});}};
 const jsx=(type,props,key)=>({type,props,key});const react=new Proxy({__esModule:true},{get:(o,k)=>k==='__esModule'?true:k==='default'?react:(...args)=>hooks[k](...args)});
 const theme={ink:{primary:'#fff',secondary:'#ddd',inverse:'#000'},surface:{canvas:'#111'},brand:{base:'#ddd'}};
 function load(id){
  if(id==='react')return react;if(id==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};if(id==='react-dom')return {createPortal:n=>n};
  if(id==='next/image')return {__esModule:true,default:'img'};
  if(id==='next/link')return {__esModule:true,default:'Link'};
  if(id==='react-native')return new Proxy({AppState:{currentState:'active',addEventListener:(key,fn)=>{listeners.set('app',fn);return {remove(){}};}},PanResponder:{create:handlers=>({panHandlers:handlers})},useWindowDimensions:()=>dims},{get:(o,k)=>k in o?o[k]:String(k)});
  if(id.endsWith('/theme/useTheme'))return {useTheme(){},getTheme:()=>theme,themedSheet:factory=>factory(theme)};
  if(id.endsWith('/stores/authStore'))return {useAuthStore:authStore};
  if(id.endsWith('/stores/settingsStore'))return {useSettingsStore:fn=>fn({autoplayVideos:true})};
  if(id.endsWith('/contexts/CallContext'))return {useCallContext:()=>({callState})};
  if(id.endsWith('/SafeArea'))return {useSafeAreaInsets:()=>({top:40,bottom:20})};
  if(id.includes('useSoundtrackPlayer'))return {useSoundtrackPlayer(){}};
  if(id.endsWith('/supabase')||id.endsWith('/supabase/client'))return {supabase:client,createClient:()=>client};
  if(id==='@/lib/stories')return {STORY_FILTERS:[],filterCss:()=>''};
  if(id==='@/lib/usePostInteractions')return {usePostInteractions:(_,seed)=>({...seed,pending:false,error:null,setLike(){},setBookmark(){}})};
  if(id==='@/lib/contentMedia')return {hydratePostMedia:async posts=>posts};
  let file=id.includes('shared/discover')?'shared/discover.ts':id.includes('shared/soundtrack')?'shared/soundtrack.ts':id.startsWith('FILE:')?id.slice(5):null;
  if(!file)return new Proxy({__esModule:true},{get:(o,k)=>k==='__esModule'?true:k==='default'?id:String(k)});
  if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:load,document,window,ResizeObserver:class{observe(){}disconnect(){}},Date,Math,console,setTimeout,clearTimeout});return module.exports;
 }
 function mount(Component,initial){
  let props=initial,tree,dirty=true,cursor=0,pending=[];const slots=[];
  const dom={clientHeight:700,clientWidth:390,scrollTop:0,scrollTo({top}){this.scrollTop=top;},focus(){document.activeElement=this;},querySelectorAll:()=>[]};
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const h={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{const value=typeof v==='function'?v(slots[i]):v;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},useRef(value){const i=cursor++;return slots[i]??={current:value};},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const prior=slots[i];slots[i]={deps};pending.push(()=>{prior?.cleanup?.();slots[i].cleanup=fn();});}},useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn,deps};return slots[i].value;},useMemo(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn(),deps};return slots[i].value;}};
  h.useLayoutEffect=h.useEffect;
  const result={get tree(){return tree;},dom,flush(){let count=0;while(dirty){assert.ok(count++<30,'render settles');dirty=false;cursor=0;hooks=h;tree=Component(props);for(const n of allNodes(tree))if(n.props?.ref&&n.props.ref.current===null)n.props.ref.current=dom;const work=pending;pending=[];work.forEach(fn=>fn());}return result;},set(p){props={...props,...p};dirty=true;return this.flush();},find(fn){return allNodes(tree).find(fn);},all(fn){return allNodes(tree).filter(fn);},label(label){return this.find(n=>n.props?.['aria-label']===label||n.props?.accessibilityLabel===label);},unmount(){slots.forEach(s=>s?.cleanup?.());}};
  return result.flush();
 }
 return {load,mount,document,listeners,calls,dims,account(id){currentUser=id;if(native)authListener?.({profile:{id}});else authListener?.('SIGNED_IN',{user:{id}});},call(value){callState=value;}};
}
const posts=Array.from({length:9},(_,i)=>({post_id:'p'+i,id:'p'+i,user_id:'author',author_id:'author',content:'Post '+i,media:[{id:'m'+i,url:'https://example.test/'+i+'.mp4',media_type:'video',width:1920,height:1080}],likes_count:1,comments_count:2,viewer_liked:false,viewer_bookmarked:false}));
function props(extra={}){return {posts,initialId:'p3',profiles:{},liked:{},saved:{},hasMore:true,loading:false,error:null,loadMore:async()=>{},onClose(){},onLike(){},onSave(){},onOpenPost(){},onRefreshMedia(){},onShare(){},...extra};}
test('web viewer keeps comments closed, pauses behind comments, and preserves scroll on dismissal',()=>{
 const rt=runtime(),Component=rt.load('FILE:web/components/DiscoverViewer.tsx').DiscoverViewer;const app=rt.mount(Component,props());
 assert.equal(app.dom.scrollTop,2100);assert.equal(app.label('Close comments'),undefined);
 const active=()=>app.find(n=>typeof n.type==='function'&&n.type.name==='DiscoverItem'&&n.props.active);
 assert.equal(active().props.post.post_id,'p3');active().props.onComments();app.flush();assert.ok(app.label('Close comments'));assert.equal(active(),undefined);
 app.label('Close comments').props.onClick();app.flush();assert.equal(active().props.post.post_id,'p3');assert.equal(app.dom.scrollTop,2100);app.unmount();
});
test('web viewer loads near the end, retains active post after append, and pauses on hidden tab',()=>{
 const rt=runtime(),Component=rt.load('FILE:web/components/DiscoverViewer.tsx').DiscoverViewer;let count=0;const app=rt.mount(Component,props({loadMore:async()=>{count++;}}));
 const scroller=app.find(n=>n.props?.onScroll);scroller.props.onScroll({currentTarget:{scrollTop:4200,clientHeight:700}});app.flush();assert.equal(count,1);
 app.set({posts:[...posts,{...posts[0],post_id:'new',id:'new'}]});assert.equal(app.find(n=>typeof n.type==='function'&&n.props.active).props.post.post_id,'p6');
 rt.document.visibilityState='hidden';rt.listeners.get('visibilitychange')();app.flush();assert.equal(app.find(n=>typeof n.type==='function'&&n.props.active),undefined);app.unmount();
});
test('web viewer closes on an account change and restores page scrolling',async()=>{
 const rt=runtime(),Component=rt.load('FILE:web/components/DiscoverViewer.tsx').DiscoverViewer;let closed=0;const app=rt.mount(Component,props({onClose(){closed++;}}));await Promise.resolve();rt.account('other');assert.equal(closed,1);assert.equal(rt.document.body.style.overflow,'hidden');app.unmount();assert.equal(rt.document.body.style.overflow,'');
});
test('web sensitive media cannot mount a player until explicitly revealed',()=>{
 const rt=runtime(),Component=rt.load('FILE:web/components/DiscoverViewer.tsx').DiscoverViewer;const viewer=rt.mount(Component,props());const itemType=viewer.find(n=>typeof n.type==='function'&&n.type.name==='DiscoverItem').type;
 const item=rt.mount(itemType,{post:{...posts[0],media:[{...posts[0].media[0],is_sensitive:true}]},active:true,expanded:false,onComments(){}});
 assert.equal(item.find(n=>n.type==='VideoPlayer'),undefined);item.find(n=>n.type==='button'&&n.props.children==='Sensitive content. Tap to view.').props.onClick();item.flush();assert.equal(item.find(n=>n.type==='VideoPlayer').props.allowPlayback,true);item.unmount();viewer.unmount();
});
test('native viewer pages in full frames and keeps comments separate from navigation',()=>{
 const rt=runtime(true),Component=rt.load('FILE:src/components/feed/DiscoverViewer.tsx').default;const app=rt.mount(Component,props());let list=app.find(n=>n.type==='FlatList');assert.equal(list.props.initialScrollIndex,3);assert.equal(list.props.pagingEnabled,true);
 const callback=list.props.viewabilityConfig;list.props.onViewableItemsChanged({viewableItems:[{item:posts[5]}]});app.flush();list=app.find(n=>n.type==='FlatList');assert.equal(list.props.initialScrollIndex,5);assert.equal(list.props.viewabilityConfig,callback);
 app.label('Open comments').props.onPress();app.flush();list=app.find(n=>n.type==='FlatList');assert.equal(list.props.renderItem({item:posts[5]}).props.active,false);
 app.find(n=>n.type==='./CommentsSheet').props.onClose();app.flush();assert.equal(app.find(n=>n.type==='FlatList').props.renderItem({item:posts[5]}).props.active,true);app.unmount();
});
test('native viewer suspends playback for calls/background and closes on account change',()=>{
 const rt=runtime(true),Component=rt.load('FILE:src/components/feed/DiscoverViewer.tsx').default;let closed=0;const app=rt.mount(Component,props({onClose(){closed++;}}));
 rt.call('active');app.set({});assert.equal(app.find(n=>n.type==='FlatList').props.renderItem({item:posts[3]}).props.active,false);
 rt.call('idle');rt.listeners.get('app')('background');app.flush();assert.equal(app.find(n=>n.type==='FlatList').props.renderItem({item:posts[3]}).props.active,false);rt.account('other');assert.equal(closed,1);app.unmount();
});
test('pagination retries only explicitly after error and media fitting honors rotation',()=>{
 const rt=runtime(),h=rt.load('../../shared/discover');assert.equal(h.discoverNeedsMore(8,9,true,false,null),true);assert.equal(h.discoverNeedsMore(8,9,true,true,null),false);assert.equal(h.discoverNeedsMore(8,9,true,false,'offline'),false);assert.equal(h.discoverNeedsMore(0,0,true,false,null),true);
 for(const rotation of [0,90,180,270,45]){const frame=h.discoverFrame(390,700,1920,1080,rotation),r=rotation*Math.PI/180;assert.ok(Math.abs(frame.width*Math.cos(r))+Math.abs(frame.height*Math.sin(r))<=390.0001);assert.ok(Math.abs(frame.width*Math.sin(r))+Math.abs(frame.height*Math.cos(r))<=700.0001);}
 assert.equal(h.discoverIndex(['a','b','c','d'],'c'),2);assert.equal(h.discoverIndex(['a','b','c','d','e'],'c'),2);
});
