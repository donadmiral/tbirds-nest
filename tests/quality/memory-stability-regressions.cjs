const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const compile=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function shelf(owner='owner',previous='owner',hydrate=async rows=>rows){
 const src=read('src/components/MemoryAlbumCard.tsx'),start=src.indexOf(' const refresh=useCallback'),end=src.indexOf(' useFocusEffect',start),request=deferred(),writes=[],errors=[],loading=[];
 const ownerScope={ownerId:owner,viewerId:'viewer'};
 const scope={ownerId:owner,viewerId:'viewer',scope:{current:ownerScope},loadedOwner:{current:previous},loadedScope:{current:owner===previous?ownerScope:null},pendingRead:{current:null},epoch:{current:0},useCallback:f=>f,setData:x=>writes.push(x),setError:x=>errors.push(x),setLoading:x=>loading.push(x),profileRead:x=>Promise.resolve(x),supabase:{rpc:()=>request.promise},hydrateMemoryAlbumMedia:hydrate,withoutPrivateMedia:rows=>rows.map(row=>({...row,cover_page:row.cover_page?{...row.cover_page,media_url:null}:undefined}))};
 vm.runInNewContext(compile(src.slice(start,end)+'\nthis.refresh=refresh;'),scope);
 return{scope,request,writes,errors,loading};
}
test('refresh retains the existing owner shelf instead of collapsing profile height',async()=>{
 const h=shelf(),work=h.scope.refresh();assert.deepEqual(h.writes,[]);assert.deepEqual(h.loading,[true]);
 h.request.resolve({data:{is_owner:true,books:[{id:'book'}]},error:null});await work;assert.equal(h.writes[0].books[0].id,'book');assert.deepEqual(h.loading,[true,false,false]);
});
test('failed refresh keeps existing books and exposes retry; missing payload is not a successful empty shelf',async()=>{
 const h=shelf(),work=h.scope.refresh();h.request.resolve({data:null,error:null});await work;assert.deepEqual(h.writes,[]);assert.match(h.errors.at(-1),/retry/i);assert.equal(h.loading.at(-1),false);
});
test('owner changes clear prior books and late requests cannot restore them',async()=>{
 const h=shelf('new-owner','old-owner'),work=h.scope.refresh();assert.deepEqual(h.writes,[null]);h.scope.epoch.current++;
 h.request.resolve({data:{is_owner:true,books:[{id:'stale'}]},error:null});await work;assert.deepEqual(h.writes,[null]);
});
function imageHarness(initial){
 const state=[],runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};let cursor=0,retries=0,props=initial;
 const react={useState(value){const i=cursor++;if(!(i in state))state[i]=value;return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];}};
 const module={exports:{}};vm.runInNewContext(compile(read('src/components/memory/MemoryPageImage.tsx')),{module,exports:module.exports,require:n=>n==='react'?react:n==='react/jsx-runtime'?runtime:n==='react-native'?{View:'View',Text:'Text',TouchableOpacity:'Button'}:n.endsWith('StoryPixelImage')?{default:'Image',__esModule:true}:{Image:'Image'}});
 return{render(next){if(next)props=next;cursor=0;return module.exports.default({...props,onRetry:()=>retries++});},get retries(){return retries;}};
}
function walk(x){return Array.isArray(x)?x.flatMap(walk):x&&typeof x==='object'?[x,...walk(x.props?.children)]:[];}
test('book images use full originals, fall back to posters, and offer a working retry after both fail',()=>{
 const h=imageHarness({uri:'full.jpg',thumbnail:'poster.jpg'});let tree=h.render();assert.equal(tree.props.uri,'full.jpg');tree.props.onError();
 tree=h.render();assert.equal(tree.props.uri,'poster.jpg');tree.props.onError();tree=h.render();const button=walk(tree).find(n=>n.type==='Button');assert.equal(button.props.accessibilityLabel,'Retry memory image');button.props.onPress();assert.equal(h.retries,1);assert.equal(h.render().props.uri,'full.jpg');
});
test('a renewed signed image source can display after the old source failed',()=>{
 const h=imageHarness({uri:'photo?old'});h.render().props.onError();assert.equal(h.render().type,'View');assert.equal(h.render({uri:'photo?new'}).props.uri,'photo?new');
});
test('screen navigation delegates to the reader that owns and locks the turn',()=>{
 const src=read('src/screens/profile/MemoryAlbumScreen.tsx'),start=src.indexOf('  const flipTo = useCallback'),end=src.indexOf('  const openPicker',start),directions=[];
 const scope={pageTurn:{current:{turn:value=>directions.push(value)}},useCallback:f=>f};
 vm.runInNewContext(compile(src.slice(start,end)+'\nthis.flipTo=flipTo;'),scope);scope.flipTo(1);scope.flipTo(-1);assert.deepEqual(directions,[1,-1]);
 scope.pageTurn.current=null;assert.doesNotThrow(()=>scope.flipTo(1));
});
test('page-turn touch regions leave bottom video and caption controls unobstructed',()=>{
 const src=read('src/components/memory/MemoryPageTurn.tsx'),start=src.indexOf('const styles=StyleSheet.create'),scope={StyleSheet:{absoluteFillObject:{},create:x=>x},PAPER:'#fff',serif:'Georgia'};
 vm.runInNewContext(compile(src.slice(start)+'\nthis.styles=styles;'),scope);
 for(const key of ['edgeL','edgeR']){const style=scope.styles[key];assert.equal(typeof style.bottom,'string');const regionEnd=600*(1-parseFloat(style.bottom)/100);const bottomButtonTop=600-8-34;assert.ok(regionEnd<bottomButtonTop,'edge must not cover video controls');assert.ok(parseFloat(style.top)>0,'edge must not cover top controls');}
});

function webShelf(){
 const src=read('web/components/MemoryAlbumBook.tsx'),start=src.indexOf(' useEffect(()=>'),end=src.indexOf('\n useEffect',start+1),request=deferred(),writes=[],owners=[],loading=[];
 const scope={queueMicrotask,epoch:{current:0},loadedProfile:{current:'owner'},profileId:'owner',attempt:1,setBooks:v=>writes.push(v),setIsOwner:v=>owners.push(v),setLoading:v=>loading.push(v),setLoaded(){},setError(){},getMemoryBooks:()=>request.promise,useEffect:f=>f()};
 vm.runInNewContext(compile(src.slice(start,end)),scope);return{request,writes,owners,loading};
}
test('web shelf retains existing books during a same-profile refresh',async()=>{
 const h=webShelf();assert.deepEqual(h.writes,[]);assert.deepEqual(h.owners,[]);h.request.resolve({is_owner:true,books:[{id:'book',count:0}]});await new Promise(r=>setImmediate(r));assert.equal(h.writes[0][0].id,'book');assert.deepEqual(h.loading,[true,false]);
});

function webImageHarness(){
 const state=[],runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};let cursor=0,retries=0;
 const react={useState(value){const i=cursor++;if(!(i in state))state[i]=value;return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];}};
 const module={exports:{}};vm.runInNewContext(compile(read('web/components/memory/MemoryPageImage.tsx')),{module,exports:module.exports,require:n=>n==='react'?react:runtime});
 return{render(){cursor=0;return module.exports.MemoryPageImage({src:'original.jpg',poster:'poster.jpg',onRetry:()=>retries++});},get retries(){return retries;}};
}
test('web book photos preserve originals and recover from a failed original and poster',()=>{
 const h=webImageHarness();let tree=h.render();assert.equal(tree.props.src,'original.jpg');tree.props.onError();
 tree=h.render();assert.equal(tree.props.src,'poster.jpg');tree.props.onError();tree=h.render();const button=walk(tree).find(n=>n.type==='button');assert.ok(button);button.props.onClick();assert.equal(h.retries,1);assert.equal(h.render().props.src,'original.jpg');
});
test('leaving a book during add does not add subsequent selected stories or update the new book',async()=>{
 const src=read('src/screens/profile/MemoryAlbumScreen.tsx'),start=src.indexOf('  const addChosen = useCallback'),end=src.indexOf('  const pageMenu',start),request=deferred(),calls=[],closed=[],reloads=[];
 const scope={chosen:new Set(['first','second']),bookId:'old-book',saveLock:{current:false},bookGeneration:{current:1},viewerRef:{current:'owner'},useCallback:f=>f,setAdding(){},setMutationError(){},setPicker:v=>closed.push(v),load:()=>reloads.push('loaded'),supabase:{rpc:(name,args)=>{calls.push({name,args});return request.promise;}}};
 vm.runInNewContext(compile(src.slice(start,end)+'\nthis.addChosen=addChosen;'),scope);const work=scope.addChosen();scope.bookGeneration.current++;request.resolve({error:null});await work;
 assert.equal(calls.length,1);assert.deepEqual(closed,[]);assert.deepEqual(reloads,[]);assert.equal(scope.saveLock.current,false);
});
test('closing a book cancels its pending page animation before it can change the page',()=>{
 const src=read('src/screens/profile/MemoryAlbumScreen.tsx'),start=src.indexOf('  const closeBook = useCallback'),end=src.indexOf('  const playBook',start),stops=[],opened=[],playing=[];
 const scope={bookGeneration:{current:3},pageTurn:{current:{cancel:()=>stops.push(true)}},setOpened:v=>opened.push(v),setGrid(){},setPlayMode(){},setPlaying:value=>playing.push(value),coverAnim:{},reduceMotion:false,Animated:{timing:()=>({start(){}})},Easing:{out:x=>x,cubic:x=>x},useCallback:f=>f};
 vm.runInNewContext(compile(src.slice(start,end)+'\nthis.closeBook=closeBook;'),scope);scope.closeBook();assert.equal(scope.bookGeneration.current,4);assert.deepEqual(stops,[true]);assert.deepEqual(opened,[false]);assert.deepEqual(playing,[false]);
});


test('concurrent focus and foreground shelf refreshes share the same read',async()=>{
 const h=shelf(),first=h.scope.refresh(),second=h.scope.refresh();assert.equal(first,second);assert.equal(h.scope.epoch.current,1);
 h.request.resolve({data:{is_owner:true,books:[{id:'one',title:'Memories'}]},error:null});await Promise.all([first,second]);assert.equal(h.writes.at(-1).books[0].id,'one');
});

test('book controls and titles become usable before a stalled cover verification completes',async()=>{
 const gate=deferred(),h=shelf('owner','owner',()=>gate.promise),pending=h.scope.refresh();
 h.request.resolve({data:{is_owner:true,books:[{id:'book',title:'Family',cover_page:{media_url:'private-canonical'}}]},error:null});await new Promise(r=>setImmediate(r));
 assert.equal(h.loading.at(-1),false);assert.equal(h.writes.at(-1).is_owner,true);assert.equal(h.writes.at(-1).books[0].title,'Family');assert.equal(h.writes.at(-1).books[0].cover_page.media_url,null);
 gate.resolve([{id:'book',title:'Family',cover_page:{media_url:'signed-cover'}}]);await pending;assert.equal(h.writes.at(-1).books[0].cover_page.media_url,'signed-cover');
});

test('failed cover verification leaves real books and creation controls available with retry',async()=>{
 const h=shelf('owner','owner',async()=>{throw Error('Signing unavailable');}),work=h.scope.refresh();
 h.request.resolve({data:{is_owner:true,books:[{id:'book',title:'Family'}]},error:null});await work;
 assert.equal(h.writes.at(-1).is_owner,true);assert.equal(h.writes.at(-1).books[0].title,'Family');assert.match(h.errors.at(-1),/covers could not load/);assert.equal(h.loading.at(-1),false);
});
