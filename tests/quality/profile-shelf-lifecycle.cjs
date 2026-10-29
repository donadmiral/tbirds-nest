const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const compile=(file,globals={})=>{const module={exports:{}};vm.runInNewContext(ts.transpileModule(source(file),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,URL,console,...globals});return module.exports;};
const media=compile('shared/contentMedia.ts'),design=compile('shared/memoryBookDesign.ts');
const base='https://shelf-fixture.invalid',raw=base+'/storage/v1/object/public/story-media/owner/photo.jpg',signed=base+'/storage/v1/object/sign/story-media/owner/photo.jpg?token=synthetic';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const walk=node=>Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];
const book=id=>({id,title:'Family',subtitle:'Our memories',count:1,cover_page:{id:'page-'+id,media_type:'image',media_url:raw}});
function harness(){
 let cursor=0,focused=true,viewer='viewer',owner='owner',tree;
 const slots=[],effects=[],requests=[],covers=[],foreground=new Set(),intervals=new Map(),navigation=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
  useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!same(previous?.deps,deps)){slots[i]={deps};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}},
 };
 const native={View:'View',Text:'Text',TouchableOpacity:'Button',ScrollView:'ScrollView',Modal:'Modal',TextInput:'Input',ActivityIndicator:'Spinner',Platform:{OS:'ios'},useWindowDimensions:()=>({width:390,height:844}),AppState:{currentState:'active',addEventListener(_event,fn){foreground.add(fn);return{remove:()=>foreground.delete(fn)};}}};
 const client={rpc(name,args){const gate=deferred();requests.push({name,args,...gate});return gate.promise;}};
 const hydrate=rows=>{const gate=deferred();covers.push({rows,...gate});return gate.promise;};
 const mods={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'react-native':native,'@react-navigation/native':{useFocusEffect:fn=>react.useEffect(()=>focused?fn():undefined,[fn,focused])},'@expo/vector-icons':{Feather:'Icon'},'../services/supabase':{supabase:client},'../services/contentMedia':{hydrateMemoryAlbumMedia:hydrate,withoutPrivateMedia:rows=>media.replaceContentMedia(rows,base,new Map())},'../stores/authStore':{useAuthStore:select=>select({session:viewer?{user:{id:viewer}}:null})},'../utils/profileRead':{profileRead:request=>Promise.resolve(request)},'../theme/useTheme':{useTheme:()=>({isDark:false,t:{ink:{primary:'#111',secondary:'#555'},surface:{canvas:'#fff',hairline:'#eee'},brand:{base:'#222'}}})},'./SafeArea':{SafeAreaView:'SafeArea'},'./memory/MemoryBookCover':{default:'BookCover',__esModule:true},'./memory/MemoryBookDesigner':{default:'Designer',__esModule:true},'../../shared/memoryBookDesign':design};
 const component=compile('src/components/MemoryAlbumCard.tsx',{require:name=>{assert.ok(name in mods,name);return mods[name];},setInterval:fn=>{const id=intervals.size+1;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id)}).default;
 const nav={navigate:(route,args)=>navigation.push({route,args})};
 function render(){cursor=0;tree=component({ownerId:owner,navigation:nav});while(effects.length)effects.shift()();cursor=0;tree=component({ownerId:owner,navigation:nav});return tree;}
 return{requests,covers,navigation,render,get nodes(){return walk(tree);},foreground(){for(const fn of foreground)fn('active');},focus(value){focused=value;return render();},viewer(value){viewer=value;return render();},owner(value){owner=value;return render();},dispose(){slots.forEach(slot=>slot?.cleanup?.());},resolveCover(index=0){const cover=covers[index];cover.resolve(media.replaceContentMedia(cover.rows,base,new Map([['story-media/owner/photo.jpg',signed]])));}};
}

test('mounted shelf shares focus/foreground requests and renders working books before cover verification',async()=>{
 const h=harness();h.render();assert.equal(h.requests.length,1);assert.ok(h.nodes.some(n=>n.props?.accessibilityLabel==='Loading memory books'));
 h.foreground();h.foreground();h.viewer('viewer');assert.equal(h.requests.length,1,'same-account updates must not invalidate the first request');
 h.requests[0].resolve({data:{is_owner:true,books:[book('book')]},error:null});await turn();h.render();
 assert.equal(h.nodes.some(n=>n.props?.accessibilityLabel==='Loading memory books'),false);
 assert.ok(h.nodes.some(n=>n.props?.accessibilityLabel==='Create memory book'));
 const cover=h.nodes.find(n=>n.type==='BookCover');assert.equal(cover.props.title,'Family');assert.equal(cover.props.photoUrl,undefined);
 h.nodes.find(n=>n.props?.accessibilityLabel==='Family, 1 memories').props.onPress();
 assert.equal(h.navigation[0].route,'MemoryAlbum');assert.equal(h.navigation[0].args.albumId,'book');
 h.resolveCover();await turn();h.render();assert.equal(h.nodes.find(n=>n.type==='BookCover').props.photoUrl,signed);h.dispose();
});

test('failed mounted shelf read replaces its spinner with a working retry',async()=>{
 const h=harness();h.render();h.requests[0].resolve({data:null,error:{message:'Synthetic failure'}});await turn();h.render();
 assert.equal(h.nodes.some(n=>n.type==='Spinner'),false);
 const retry=h.nodes.find(n=>n.type==='Button'&&walk(n).some(child=>child.props?.children==='Memory books could not load. Tap to retry.'));
 assert.ok(retry);retry.props.onPress();assert.equal(h.requests.length,2);
 h.requests[1].resolve({data:{is_owner:true,books:[book('recovered')]},error:null});await turn();h.resolveCover();await turn();h.render();
 assert.equal(h.nodes.find(n=>n.type==='BookCover').props.photoUrl,signed);h.dispose();
});

test('blur/refocus starts a fresh shelf read and old responses cannot win',async()=>{
 const h=harness();h.render();h.focus(false);h.focus(true);assert.equal(h.requests.length,2);
 h.requests[0].resolve({data:{is_owner:true,books:[book('stale')]},error:null});await turn();h.render();assert.equal(h.nodes.some(n=>n.type==='BookCover'),false);
 h.requests[1].resolve({data:{is_owner:true,books:[book('current')]},error:null});await turn();h.resolveCover();await turn();h.render();
 h.nodes.find(n=>n.props?.accessibilityLabel==='Family, 1 memories').props.onPress();assert.equal(h.navigation[0].args.albumId,'current');h.dispose();
});

test('an account switch immediately hides the old shelf and cannot adopt its late covers',async()=>{
 const h=harness();h.render();h.requests[0].resolve({data:{is_owner:true,books:[book('old-account')]},error:null});await turn();h.render();assert.ok(h.nodes.some(n=>n.type==='BookCover'));
 h.viewer('other-viewer');assert.equal(h.nodes.some(n=>n.type==='BookCover'),false);assert.equal(h.requests.length,2);
 h.resolveCover(0);await turn();h.render();assert.equal(h.nodes.some(n=>n.type==='BookCover'),false);
 h.requests[1].resolve({data:{is_owner:false,books:[]},error:null});await turn();h.resolveCover(1);await turn();h.render();assert.equal(h.nodes.some(n=>n.type==='BookCover'),false);h.dispose();
});
