const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function compile(code,scope={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,URL,...scope});return module.exports;}
function callback(file,name,scope){const source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let code;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)code=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(code,name);const context={useCallback:fn=>fn,...scope};vm.runInNewContext(ts.transpileModule('this.run='+code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context.run;}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function client(responses){const calls=[];return{calls,from(table){const call={table,action:'select',filters:[]};calls.push(call);const q={};for(const method of ['select','eq','neq','order','limit','in','is','or','delete','insert','maybeSingle'])q[method]=(...args)=>{if(['delete','insert','maybeSingle'].includes(method))call.action=method;call.filters.push([method,...args]);return q;};q.then=(yes,no)=>Promise.resolve(typeof responses[table]==='function'?responses[table](call):responses[table]||{data:[],error:null}).then(yes,no);return q;},rpc(name,args){calls.push({rpc:name,args});return Promise.resolve(typeof responses[name]==='function'?responses[name](args):responses[name]||{data:[],error:null});}};}
const normalize=compile(read('src/utils/profilePost.ts')).normalizeProfilePost;
const media=compile(read('shared/contentMedia.ts'));
const base='https://fixture.supabase.co', canonical=base+'/storage/v1/object/public/post-media/owner/photo.jpg', signed=base+'/storage/v1/object/sign/post-media/owner/photo.jpg?token=fresh';
const without=rows=>media.replaceContentMedia(rows,base,new Map());
const getNetwork=compile(read('shared/networkDirectory.ts')).readNetworkDirectory;

test('Network uses paged authorized community membership, without querying protected tables',async()=>{
 const c=client({get_communities_page:args=>({data:args.p_offset===0?Array.from({length:100},(_,i)=>({id:String(i),is_member:i===0})): [{id:'last',is_member:false}],error:null})});
 const result=await getNetwork(c,'owner');assert.equal(result.communities.length,101);assert.equal(result.communities[0].is_member,true);assert.equal(c.calls.filter(x=>x.rpc==='get_communities_page').length,2);
 assert.equal(c.calls.some(x=>['communities','community_members'].includes(x.table)),false);
 const pages=c.calls.filter(x=>x.rpc==='get_communities_page');assert.equal(pages[0].args.p_as_of,pages[1].args.p_as_of);assert.equal(pages[1].args.p_offset,100);
});
test('a directory source error never masquerades as empty and does not erase healthy sections',async()=>{
 const c=client({profiles:{data:[{id:'person'}]},follows:{error:{message:'offline'}},get_communities_page:{data:[{id:'community',is_member:true}]},clubs:{error:{message:'offline'}}});
 const result=await getNetwork(c,'owner');assert.equal(result.people,null);assert.equal(result.clubs,null);assert.equal(result.communities[0].id,'community');assert.match(result.errors.all,/retry/);assert.match(result.errors.clubs,/retry/);assert.equal(result.errors.communities,undefined);
});
test('community requests and failed leaves use verified server outcomes before changing membership',async()=>{
 const errors=[],calls=[],owner={currentUserId:'owner'},state={rows:[{id:'group',member_count:2,has_pending:false}],ids:new Set()};
 const scope={currentUserId:'owner',locks:{current:new Set()},identity:{current:owner},mounted:{current:true},myCommIds:state.ids,myClubIds:new Set(),communities:state.rows,setBusy(){},setCommunities(fn){state.rows=fn(state.rows);},setMyCommIds(fn){state.ids=fn(state.ids);},Alert:{alert:(...args)=>errors.push(args)},supabase:{rpc:async(name,args)=>{calls.push([name,args]);return{data:'requested',error:null};}}};
 const action=callback('src/screens/network/NetworkScreen.tsx','toggleGroupMembership',scope);await action('communities','group');assert.equal(calls[0][0],'join_community');assert.equal(state.ids.size,0);assert.equal(state.rows[0].has_pending,true);assert.equal(state.rows[0].member_count,2);
 state.ids.add('group');scope.myCommIds=state.ids;scope.supabase.rpc=async()=>({error:{message:'Owner must transfer ownership'}});
 const leave=callback('src/screens/network/NetworkScreen.tsx','toggleGroupMembership',scope);await leave('communities','group');assert.equal(state.ids.has('group'),true);assert.equal(errors.length,1);
});
function savedFixture(overrides={}){
 const first={id:'p1',user_id:'author',content:'Caption',post_media:[{id:'m',url:canonical,media_type:'image'}],created_at:'2026-10-20T00:00:00Z'};
 const state={posts:[],error:'',loading:true,refreshing:false,unsaving:{}},alerts=[];
 const c=client({post_bookmarks:{data:[{post_id:'p1',created_at:'2026-10-29T00:00:00Z'}]},posts:{data:[first]},profiles:{data:[{id:'author',full_name:'Author'}]},...overrides.responses});
 const scope={userId:'owner',identity:{current:{userId:'owner'}},mounted:{current:true},request:{current:0},removed:{current:new Set()},pending:{current:new Set()},supabase:c,profileRead:async value=>await value,hydratePostMedia:overrides.hydrate|| (async rows=>rows.map(row=>({...row,post_media:[{id:'m',url:signed,media_type:'image'}]}))),withoutPrivateMedia:without,normalizeProfilePost:normalize,
 setPosts:fn=>state.posts=typeof fn==='function'?fn(state.posts):fn,setError:value=>state.error=value,setLoading:value=>state.loading=value,setRefreshing:value=>state.refreshing=value,setUnsaving:fn=>state.unsaving=fn(state.unsaving),Alert:{alert:(...args)=>alerts.push(args)}};
 return{state,scope,client:c,alerts,load:callback('src/screens/feed/SavedPostsScreen.tsx','load',scope)};
}
test('Saved Posts exposes authorized text while signing, then replaces only with signed media',async()=>{
 const gate=deferred(),h=savedFixture({hydrate:()=>gate.promise}),pending=h.load();await tick();assert.equal(h.state.posts[0].content,'Caption');assert.equal(h.state.posts[0].media.length,0);assert.equal(h.state.posts[0].mediaPending,true);assert.equal(h.state.loading,false);assert.doesNotMatch(JSON.stringify(h.state.posts),/object\/public/);
 gate.resolve([{id:'p1',user_id:'author',content:'Caption',post_media:[{url:signed,media_type:'image'}]}]);await pending;assert.equal(h.state.posts[0].media[0].url,signed);assert.equal(h.state.posts[0].author.full_name,'Author');
});
test('Saved Posts preserves readable rows and offers retry on read or media failure',async()=>{
 const readFailure=savedFixture({responses:{post_bookmarks:{error:{message:'offline'}}}});readFailure.state.posts=[{id:'existing'}];await readFailure.load();assert.equal(readFailure.state.posts[0].id,'existing');assert.match(readFailure.state.error,/try again/);assert.equal(readFailure.state.loading,false);
 const denied=savedFixture({hydrate:async()=>{throw Error('no session');}});await denied.load();assert.equal(denied.state.posts[0].media.length,0);assert.equal(denied.state.posts[0].mediaUnavailable,true);assert.match(denied.state.error,/Retry/);
});
test('Saved Posts fences stale accounts and a failed unsave never resurrects a successful unsave',async()=>{
 const gate=deferred(),h=savedFixture({hydrate:()=>gate.promise}),load=h.load();await tick();h.scope.identity.current={userId:'other'};h.state.posts=[];gate.resolve([{id:'p1',post_media:[{url:signed}]}]);await load;assert.equal(h.state.posts.length,0);
 const a=deferred(),b=deferred(),g=savedFixture({responses:{post_bookmarks:call=>call.filters.find(x=>x[0]==='eq'&&x[1]==='post_id')[2]==='a'?a.promise:b.promise}});
 g.state.posts=[{id:'a',saved_at:'2026-10-29'},{id:'b',saved_at:'2026-10-28'}];g.scope.posts=g.state.posts;
 const unsave=callback('src/screens/feed/SavedPostsScreen.tsx','unsave',g.scope),one=unsave('a'),two=unsave('b');await unsave('a');assert.equal(g.client.calls.length,2);b.resolve({error:null});await two;a.resolve({error:{message:'offline'}});await one;assert.deepEqual(Array.from(g.state.posts,row=>row.id),['a']);assert.equal(g.alerts.length,1);
});
function searchFixture(responses={},hydrate=async rows=>rows){
 const c=client(responses),state={people:[],posts:[],jobs:[],market:[],loading:false,errors:{},visible:''};
 const scope={myId:'owner',postMode:'top',identity:{current:{myId:'owner'}},mounted:{current:true},request:{current:0},searchScope:{current:'owner:test:top'},supabase:c,profileRead:async q=>await q,hydratePostMedia:hydrate,withoutPrivateMedia:without,normalizeProfilePost:normalize,
 setPeople:value=>state.people=value,setPosts:value=>state.posts=value,setJobs:value=>state.jobs=value,setListings:value=>state.market=value,setLoading:value=>state.loading=value,setErrors:value=>state.errors=typeof value==='function'?value(state.errors):value,setVisibleScope:value=>state.visible=value};
 return{state,scope,client:c,run:callback('src/screens/feed/SearchScreen.tsx','runSearch',scope)};
}
test('search source errors stay separate, signed media is required, and old query responses cannot win',async()=>{
 const c=searchFixture({search_people:{error:{message:'offline'}},search_jobs_fts:{data:[{id:'job'}]},search_posts:{data:[{post_id:'p',author_id:'author',content:'text',media:[{url:canonical,media_type:'image'}]}]}},async()=>{throw Error('signing offline');});
 await c.run('test');assert.equal(c.state.jobs[0].id,'job');assert.match(c.state.errors.people,/retry/);assert.match(c.state.errors.posts,/Retry/);assert.equal(c.state.posts[0].content,'text');assert.equal(c.state.posts[0].mediaUnavailable,true);assert.doesNotMatch(JSON.stringify(c.state.posts),/object\/public/);
 const gate=deferred(),h=searchFixture({search_people:()=>gate.promise});const pending=h.run('test');h.scope.searchScope.current='owner:new:top';gate.resolve({data:[{id:'old'}]});await pending;assert.equal(h.state.people.length,0);assert.equal(h.state.visible,'');
});
test('search fails closed when block settings cannot load and clears every vertical for an empty query',async()=>{
 const h=searchFixture({blocked_users:{error:{message:'denied'}},search_people:{data:[{id:'person'}]},search_jobs_fts:{data:[{id:'job'}]}});await h.run('test');assert.equal(h.state.people.length,0);assert.equal(h.state.jobs.length,0);assert.match(h.state.errors.people,/Privacy settings/);
 h.scope.searchScope.current='owner::top';h.state.market=[{id:'old'}];await h.run('');assert.equal(h.state.market.length,0);assert.equal(h.state.loading,false);assert.equal(h.state.visible,'owner::top');
});
test('seller history failures never invent a new seller and stale responses cannot update a different seller',async()=>{
 const file='src/components/market/SellerTrust.tsx',source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect;
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect')effect=node.arguments[0].getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(effect);
 const state={data:{sellerId:'old'},error:false},scope={sellerId:'new',profileRead:async value=>await value,setD:value=>state.data=value,setError:value=>state.error=value,supabase:client({profiles:{data:{created_at:'2026-10-29',is_verified:false}},marketplace_listings:{count:0,error:{message:'offline'}},get_seller_rating:{data:{avg_rating:0,review_count:0}}})};
 const run=compile('export const effect='+effect,scope).effect,dispose=run();await tick();assert.equal(state.data,null);assert.equal(state.error,true);dispose();
 const gate=deferred();scope.supabase=client({profiles:()=>gate.promise});const stale=compile('export const effect='+effect,scope).effect;const cancel=stale();cancel();gate.resolve({data:{created_at:'2026-10-29',is_verified:true}});await tick();assert.equal(state.data,null);
});
for(const [file,tab,leaf,stack] of [
 ['src/screens/feed/SavedPostsScreen.tsx','Profile','ProfileMain','ProfStack.Screen'],
 ['src/screens/feed/SearchScreen.tsx','Feed','FeedMain','FeedStack.Screen'],
])test(file.split('/').at(-1)+' back button returns through the real registered root, tab and home screen when history is absent',()=>{
 const source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let handler;
 function visit(node){if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='onPress'&&node.initializer?.expression?.getText(ast).includes('navigation.canGoBack()'))handler=node.initializer.expression.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(handler,'actual back-button handler exists');
 const navSource=read('src/navigation/AppNavigator.tsx'),navAst=ts.createSourceFile('nav.tsx',navSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),routes=new Map();
 function route(node){if(ts.isJsxSelfClosingElement(node)){const name=node.attributes.properties.find(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(navAst)==='name');if(name?.initializer&&ts.isStringLiteral(name.initializer)){const tag=node.tagName.getText(navAst);if(!routes.has(tag))routes.set(tag,new Set());routes.get(tag).add(name.initializer.text);}}ts.forEachChild(node,route);}route(navAst);
 for(const hasHistory of [true,false]){
  const calls=[],navigation={canGoBack:()=>hasHistory,goBack:()=>calls.push({back:true}),navigate:(name,params)=>calls.push({name,params})};
  const press=compile('export const press='+handler,{navigation}).press;press();assert.equal(calls.length,1);
  if(hasHistory)assert.deepEqual(calls,[{back:true}]);
  else {const target=calls[0];assert.equal(target.name,'Main');assert.equal(target.params.screen,tab);assert.equal(target.params.params.screen,leaf);assert.ok(routes.get('RootStack.Screen').has(target.name));assert.ok(routes.get('Tab.Screen').has(target.params.screen));assert.ok(routes.get(stack).has(target.params.params.screen));}
 }
});
