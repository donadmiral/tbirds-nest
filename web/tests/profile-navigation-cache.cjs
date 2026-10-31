const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..'),base='https://profile-fixture.invalid';
function load(file,imports={},globals={}){
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,URL,Map,AbortController,setTimeout,clearTimeout,atob,process:{env:{NEXT_PUBLIC_SUPABASE_URL:base}},require:name=>{if(name in imports)return imports[name];throw Error(name);},...globals});return module.exports;
}
const media=load('shared/contentMedia.ts');
function fixture(){
 const handlers=new Map(),cache=load('shared/navigationCache.ts').createNavigationCache();let snapshot={owner:'A',scope:'1:A',revision:1};cache.setScope(snapshot.scope);
 const store={cache,getSnapshot:()=>snapshot};
 const api=load('web/lib/profileNavigation.ts',{'./navigationCache':{getNavigationStore:()=>store},'../../shared/contentMedia':media},{window:{addEventListener:(name,callback)=>handlers.set(name,callback)}});
 api.getProfileNavigationStore();
 return {api,store,handlers,change(owner){snapshot={owner,scope:`${snapshot.revision+1}:${owner}`,revision:snapshot.revision+1};cache.setScope(snapshot.scope);}};
}
test('off-route post mutations invalidate only the current account profile snapshot',()=>{
 const h=fixture(),key=h.api.profileNavigationKey('A','posts');h.store.cache.save('1:A',key,{items:[{id:'deleted'}]});h.store.cache.save('1:A','home:personal',{id:'home'});
 h.handlers.get('pc-feed-hidden')();assert.equal(h.store.cache.read('1:A',key),null);assert.equal(h.store.cache.read('1:A','home:personal').id,'home');
 h.change('B');h.store.cache.save('2:B',h.api.profileNavigationKey('B','posts'),{items:[{id:'B'}]});h.handlers.get('pc-refresh-feed')();assert.equal(h.store.cache.read('2:B',h.api.profileNavigationKey('B','posts')),null);
});
test('A to B to A invalidates previous profile cache scopes and late writes',()=>{
 const h=fixture(),key=h.api.profileNavigationKey('A','posts');h.store.cache.save('1:A',key,{items:[{id:'private-A'}]});h.change('B');h.change('A');
 assert.equal(h.store.cache.read('3:A',key),null);assert.equal(h.store.cache.save('1:A',key,{items:[{id:'late'}]}),false);
});
test('expired profile capabilities are removed recursively while metadata and valid images remain',()=>{
 const h=fixture(),signed=base+'/storage/v1/object/sign/story-media/A/photo.jpg?token=expired',valid={id:'valid',_mediaExpiresAt:2000,media_url:signed};
 const expired={id:'book',title:'Keep the title',_mediaExpiresAt:999,cover_page:{media_url:signed,caption:'Keep the caption'},body:`![A picture](${signed})`};
 const [a,b]=h.api.safeProfileMemoryRows([expired,valid],1000);
 assert.equal(a.title,expired.title);assert.equal(a.cover_page.caption,expired.cover_page.caption);assert.equal(a.cover_page.media_url,null);assert.equal(a.body,'[A picture]');assert.equal(b,valid);assert.equal(expired.cover_page.media_url,signed,'the original remembered value is not mutated');
});
test('successful shelf edits change the off-route revision without notifying unrelated owner listeners',()=>{
 const bus=load('web/lib/memoryBookEvents.ts'),calls=[];const stop=bus.onMemoryBookShelfChanged('A',()=>calls.push('A'));
 const initial=bus.memoryBookShelfRevision('A');bus.notifyMemoryBookShelfChanged('B');assert.equal(bus.memoryBookShelfRevision('A'),initial,'an unrelated owner cannot invalidate an in-flight first shelf read');bus.notifyMemoryBookShelfChanged('A');const saved=bus.memoryBookShelfRevision('A');assert.ok(saved>initial);assert.deepEqual(calls,['A']);
 bus.notifyMemoryBookShelfChanged('B');assert.equal(bus.memoryBookShelfRevision('A'),saved);assert.deepEqual(calls,['A']);stop();bus.notifyMemoryBookShelfChanged('A');assert.deepEqual(calls,['A']);
});
test('actual profile media renewal effect cannot overwrite newer caption or like metadata on the same row',async()=>{
 const source=fs.readFileSync(path.join(root,'web/lib/useSocialPages.ts'),'utf8'),start=source.indexOf('  useEffect(() => {\n    if (!postMedia'),end=source.indexOf('\n  return { ...state',start);
 assert.ok(start>=0&&end>start);let renew,finish,rows=[{id:'one',caption:'before',liked:false,_mediaExpiresAt:0}];const pending=new Promise(resolve=>{finish=resolve;});
 const scope={postMedia:true,enabled:true,key:'id',client:{},Map,Date,reader:{snapshot:()=>({items:rows}),version:()=>1,setItems:update=>{rows=update(rows);}},withTimeout:x=>x,hydratePostMedia:()=>pending,useEffect:fn=>fn(),setInterval:()=>1,clearInterval(){},document:{visibilityState:'visible',addEventListener:(_name,fn)=>{renew=fn;},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}}};
 vm.runInNewContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
 const work=renew();rows=[{...rows[0],caption:'edited while signing',liked:true}];finish([{id:'one',caption:'before',liked:false,_mediaExpiresAt:Date.now()+60000}]);await work;
 assert.equal(rows[0].caption,'edited while signing');assert.equal(rows[0].liked,true);
});
