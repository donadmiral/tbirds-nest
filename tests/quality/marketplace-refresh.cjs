const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const compile=code=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ticks=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function sourceParts(file){
 const source=fs.readFileSync(path.join(root,file),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),parts={};
 function visit(node){
  if(ts.isVariableDeclaration(node)&&node.initializer){const name=node.name.getText(ast);if(['refreshMarketplace','onRefresh','onAuthorHidden','onVisibility'].includes(name))parts[name]=(name==='refreshMarketplace'?node.initializer.arguments[0]:node.initializer).getText(ast);}
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('readMarketplaceRecommendations')){parts.effect=node.arguments[0].getText(ast);parts.dependencies=node.arguments[1].getText(ast);}
  if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='onRefresh'&&node.initializer?.expression?.getText(ast).includes('refreshMarketplace'))parts.pullRefresh=node.initializer.expression.getText(ast);
  ts.forEachChild(node,visit);
 }visit(ast);return parts;
}
function fixture(native){
 const parts=sourceParts(native?'src/screens/feed/FeedScreen.tsx':'web/components/HomeFeed.tsx'),pending=[],timers=new Map(),loads=[],hidden=[];let nextTimer=0,epoch=0,owner='owner',items={owner,items:[{id:'a',seller_id:'blocked'},{id:'b',seller_id:'kept'}]};
 const scope={AbortController,userId:owner,feedMode:'forYou',screenFocused:true,appActive:true,state:{owner},mode:'for_you',uidRef:{current:owner},marketplaceRequest:{current:null},supabase:{},
  setMarketplace(value){items=typeof value==='function'?value(items):value;},setMarketplaceRefresh(fn){epoch=fn(epoch);},useAuthStore:{getState:()=>({profile:{id:owner}})},readMarketplaceRecommendations(_client,signal){return new Promise(resolve=>pending.push({signal,resolve}));},
  setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
  load:()=>loads.push('web'),loadFeed:()=>loads.push('native'),setRefreshing(){},setMomentRefreshKey(){},document:{visibilityState:'visible'},controller:{getSnapshot:()=>({rows:[{post_id:'p',author_id:'blocked'},{post_id:'q',author_id:'kept'}]}),hide:id=>hidden.push(id)},
 };vm.createContext(scope);
 for(const [name,code]of Object.entries(parts))if(name!=='dependencies')vm.runInContext(compile(`this.${name}=${code}`),scope);
 return{parts,scope,pending,timers,loads,hidden,get items(){return items;},get epoch(){return epoch;},setOwner(value){owner=value;scope.uidRef.current=value;}};
}
for(const native of [false,true])test(`${native?'native':'web'} refresh removes blocked sellers immediately and fences old, aborted and cross-account responses`,async()=>{
 const h=fixture(native),dispose=h.scope.effect();assert.equal(h.pending.length,1);
 h.scope.refreshMarketplace('blocked');assert.equal(h.items.items.length,1);assert.equal(h.items.items[0].seller_id,'kept');assert.equal(h.pending[0].signal.aborted,true);assert.equal(h.epoch,1);
 h.pending[0].resolve([{id:'stale',seller_id:'blocked'}]);await ticks();assert.equal(h.items.items[0].id,'b');dispose();
 const disposeNew=h.scope.effect();h.pending[1].resolve([{id:'fresh',seller_id:'kept'}]);await ticks();assert.equal(h.items.items[0].id,'fresh');disposeNew();
 const disposeOwner=h.scope.effect();h.setOwner('new-owner');h.pending[2].resolve([{id:'old-account',seller_id:'kept'}]);await ticks();assert.equal(h.items.items[0].id,'fresh');disposeOwner();
});
test('web feed refresh, visible return and owned block events refresh the shelf but foreign-account events do nothing',()=>{
 const h=fixture(false);h.scope.onRefresh();h.scope.onVisibility();assert.equal(h.epoch,2);
 h.scope.onAuthorHidden({detail:{ownerId:'another-account',authorId:'blocked'}});assert.equal(h.epoch,2);assert.equal(h.items.items.length,2);
 h.scope.onAuthorHidden({detail:{ownerId:'owner',authorId:'blocked'}});assert.equal(h.epoch,3);assert.equal(h.items.items.length,1);assert.deepEqual(h.hidden,['p']);assert.equal(h.loads.length,3);
 h.scope.document.visibilityState='hidden';h.scope.onVisibility();assert.equal(h.epoch,3);
});
test('native pull refresh fetches recommendations and focus/background changes own the request lifecycle',()=>{
 const h=fixture(true);h.scope.pullRefresh();assert.equal(h.epoch,1);assert.deepEqual(h.loads,['native']);
 assert.match(h.parts.dependencies,/screenFocused/);assert.match(h.parts.dependencies,/appActive/);
 h.scope.screenFocused=false;assert.equal(h.scope.effect(),undefined);assert.equal(h.pending.length,0);
});
test('web block and mute events are emitted with the owner only after successful writes',async()=>{
 const file='web/components/PostMenu.tsx',source=fs.readFileSync(path.join(root,file),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),methods={};
 function visit(node){if(ts.isFunctionDeclaration(node)&&['blockAuthor','showLessAuthor'].includes(node.name?.text))methods[node.name.text]=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);
 for(const method of Object.keys(methods))for(const fail of [false,true]){
  const events=[],hidden=[],context={uid:'owner',authorId:'seller',setOpen(){},onHidden:()=>hidden.push(true),alert(){},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},window:{confirm:()=>true,dispatchEvent:event=>events.push(event)},supabase:{from:()=>({upsert:async()=>({error:fail?{message:'no access'}:null})})}};
  vm.createContext(context);vm.runInContext(compile(methods[method]),context);await context[method]();assert.equal(events.length,fail?0:1);assert.equal(hidden.length,fail?0:1);
  if(!fail){assert.equal(events[0].type,'pc-feed-author-hidden');assert.equal(events[0].detail.ownerId,'owner');assert.equal(events[0].detail.authorId,'seller');}
 }
});
