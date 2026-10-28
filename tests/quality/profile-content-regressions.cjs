const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function compile(source, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, console, ...globals });
  return module.exports;
}
function callback(file, name, globals) {
  const source = read(file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let found;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found, name);
  return compile(`export const run = ${found}`, { useCallback: fn => fn, ...globals }).run;
}
const normalize = compile(read('src/utils/profilePost.ts')).normalizeProfilePost;
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
const turn = () => new Promise(resolve => setImmediate(resolve));
function db(rows, failures = {}) {
  const calls=[];
  return {calls, from(table) {
    const q = { then(ok, bad) { calls.push(table); return Promise.resolve({ data: rows[table] || [], error: failures[table] || null }).then(ok,bad); } };
    for (const method of ['select','eq','order','limit','in','lt','maybeSingle']) q[method]=()=>q;
    return q;
  }};
}
function own(hydrate, failures) {
  const source = 'src/screens/profile/ProfileScreen.tsx';
  const state={ posts:[{id:'already-visible'}],error:null,loading:false,counts:{},reposts:[],saved:[],tagged:[] };
  const scope={current:{userId:'owner'}}, tabRequest={current:0}, mounted={current:true}, loaded={current:{}};
  const row={id:'post',user_id:'owner',post_media:[{id:'photo',url:'canonical-private.jpg',media_type:'image'}]};
  const client=db({posts:[row],post_reposts:[{post_id:'post',created_at:'2026-10-01'}],post_bookmarks:[{post_id:'post',created_at:'2026-10-01'}]},failures);
  const set = key => value => state[key]=typeof value==='function'?value(state[key]):value;
  const globals={ userId:'owner',scope,tabRequest,mounted,tabLoadedRef:loaded,authProfileRef:{current:{id:'owner'}},normalizePost:normalize,
    hydratePostMedia:hydrate,supabase:client,setTabError:set('error'),setTabLoading:set('loading'),setTabPosts:set('posts'),setTabCounts:set('counts'),setPostsHasMore:set('more'),setTabReposts:set('reposts'),setTabSaved:set('saved'),setTabTagged:set('tagged') };
  return {state,scope,loaded,client,run:callback(source,'loadTabContent',globals)};
}
for (const tab of ['posts','reposts','saved','tagged']) test(`profile ${tab} waits for authorized media before publishing cards`, async () => {
  const gate=deferred();let received;
  const h=own(async rows=>{received=rows;return gate.promise;}); const promise=h.run(tab); await turn();
  assert.equal(h.state.posts[0].id,'already-visible'); assert.ok(received.length);
  gate.resolve(received.map(row=>({...row,post_media:[{id:'photo',url:'signed-capability.jpg',media_type:'image',edit:{coverUrl:'signed-cover.jpg'}}]}))); await promise;
  const data=h.state[{posts:'posts',reposts:'reposts',saved:'saved',tagged:'tagged'}[tab]];
  assert.equal(data[0].media[0].url,'signed-capability.jpg'); assert.equal(data[0].media[0].edit.coverUrl,'signed-cover.jpg'); assert.equal(h.loaded.current[tab],true); assert.equal(h.state.loading,false);
});
test('account ABA and superseded loads cannot replace the current profile feed',async()=>{
  const gates=[deferred(),deferred()];let n=0;const h=own(()=>gates[n++].promise);
  const first=h.run('posts');await turn();const second=h.run('posts');await turn();
  gates[1].resolve([{id:'new',post_media:[]}]);await second;gates[0].resolve([{id:'old',post_media:[]}]);await first;
  assert.equal(h.state.posts[0].id,'new');
  const gate=deferred(), switched=own(()=>gate.promise); const pending=switched.run('posts');await turn();
  switched.scope.current={userId:'other'}; switched.scope.current={userId:'owner'};
  gate.resolve([{id:'stale-account',post_media:[]}]);await pending;
  assert.equal(switched.state.posts[0].id,'already-visible'); assert.equal(switched.loaded.current.posts,undefined);
});
test('query and signing failures keep visible posts, expose retry, and do not mark the tab loaded',async()=>{
  for (const mode of ['query','signing']) {
    const h=own(async()=>{throw Error('Signing unavailable');},mode==='query'?{posts:Error('Query unavailable')}:{});
    await h.run('posts');assert.equal(h.state.posts[0].id,'already-visible');assert.match(h.state.error,/unavailable/);assert.equal(h.loaded.current.posts,undefined);assert.equal(h.state.loading,false);
  }
});
test('legacy video metadata stays video and normalizing does not reorder cached source arrays',()=>{
  assert.equal(normalize({id:'legacy',media_url:'https://signed.test/movie.mp4?token=valid'}).media[0].media_type,'video');
  assert.equal(normalize({id:'legacy',media_url:'https://signed.test/object',media_type:'video'}).media[0].media_type,'video');
  const source=[{id:'later',sort_order:2,url:'later.jpg'},{id:'first',sort_order:0,url:'first.jpg'},{id:'denied',sort_order:1,url:null}];
  const result=normalize({id:'one',post_media:source});assert.equal(result.media[0].id,'first');assert.equal(source[0].id,'later');assert.equal(result.mediaUnavailable,true);
});
function visitor(profileResult,hydrate) {
  const state={profile:null,posts:[],error:null};const scope={current:{targetId:'target',myId:'viewer'}}, client=db({posts:[{id:'post',post_media:[{url:'canonical',media_type:'video'}]}]});
  client.rpc=async()=>profileResult;
  const noop=()=>{},set=key=>value=>state[key]=value;
  const globals={targetId:'target',myId:'viewer',scope,loadRequest:{current:0},mounted:{current:true},takePrefetched:()=>null,
    supabase:client,hydratePostMedia:hydrate,normalizeProfilePost:normalize,setProfile:set('profile'),setPosts:set('posts'),setLoadError:set('error'),setContentError:noop,setStats:noop,setFollowing:noop,setFollowRequested:noop,setLoading:noop,setRefreshing:noop};
  return {state,scope,client,run:callback('src/screens/profile/UserProfileScreen.tsx','load',globals)};
}
test('visitor profile honors server content visibility before requesting posts',async()=>{
  const h=visitor({data:{id:'target',can_view_content:false},error:null},()=>{throw Error('must not sign private posts');});await h.run();
  assert.equal(h.client.calls.includes('posts'),false);assert.equal(h.state.posts.length,0);
});
test('visitor profile signs post previews and drops old account/target responses',async()=>{
  const gate=deferred(),h=visitor({data:{id:'target',can_view_content:true},error:null},()=>gate.promise);const pending=h.run();await turn();
  assert.equal(h.state.posts.length,0);gate.resolve([{id:'post',post_media:[{id:'v',url:'signed.mp4',media_type:'video'}]}]);await pending;
  assert.equal(h.state.posts[0].media[0].url,'signed.mp4');
  const late=deferred(),stale=visitor({data:{id:'target',can_view_content:true},error:null},()=>late.promise);const old=stale.run();await turn();
  stale.scope.current={targetId:'other',myId:'viewer'};late.resolve([{id:'wrong-person',post_media:[]}]);await old;assert.equal(stale.state.posts.length,0);
});
test('profile content refresh depends on identity and explicit revision, not profile object replacement',()=>{
  const source=read('src/screens/profile/ProfileScreen.tsx'),ast=ts.createSourceFile('profile.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let dependencies;
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('loadTabContent(activeTab)'))dependencies=node.arguments[1].elements.map(e=>e.getText(ast));ts.forEachChild(node,visit);}visit(ast);
  assert.ok(dependencies.includes('profile?.id'));assert.ok(dependencies.includes('contentRevision'));assert.equal(dependencies.includes('profile'),false);
});

test('reselecting a loaded tab keeps its content visible while media access refreshes', async () => {
  const gate=deferred(), h=own(()=>gate.promise);
  h.loaded.current.posts=true; h.state.loading=true;
  const pending=h.run('posts'); await turn();
  assert.equal(h.state.loading,false);
  assert.equal(h.state.posts[0].id,'already-visible');
  gate.resolve([{id:'updated',post_media:[]}]); await pending;
  assert.equal(h.state.posts[0].id,'updated');
});
