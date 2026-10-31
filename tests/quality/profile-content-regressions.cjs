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
    { module, exports: module.exports, console, URL, AbortController, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
function callback(file, name, globals) {
  const source = read(file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let found;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found, name);
  return compile(`export const run = ${found}`, { useCallback: fn => fn, ...globals }).run;
}
const normalize = compile(read('src/utils/profilePost.ts')).normalizeProfilePost;
const media = compile(read('shared/contentMedia.ts'));
const { profileRead } = compile(read('src/utils/profileRead.ts'));
const base = 'https://profile-fixture.invalid';
const raw = `${base}/storage/v1/object/public/post-media/owner/photo.jpg`;
const withoutPrivateMedia = rows => media.replaceContentMedia(rows, base, new Map());
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
const turn = () => new Promise(resolve => setImmediate(resolve));
function db(rows, failures = {}, held = {}) {
  const calls=[];
  return {calls, from(table) {
    const q = { then(ok, bad) { calls.push(table); return (held[table] || Promise.resolve({ data: rows[table] || [], error: failures[table] || null })).then(ok,bad); } };
    for (const method of ['select','eq','order','limit','in','lt','maybeSingle']) q[method]=()=>q;
    return q;
  }};
}
function own(hydrate, failures, held = {}, timeoutMs = 15000) {
  const source = 'src/screens/profile/ProfileScreen.tsx';
  const state={ posts:[{id:'already-visible'}],error:null,loading:false,counts:{},reposts:[],saved:[],tagged:[] };
  const scope={current:{userId:'owner'}}, tabRequest={current:0}, mounted={current:true}, loaded={current:{}};
  const row={id:'post',user_id:'owner',post_media:[{id:'photo',url:raw,media_type:'image'}]};
  const client=db({posts:[row],post_reposts:[{post_id:'post',created_at:'2026-10-01'}],post_bookmarks:[{post_id:'post',created_at:'2026-10-01'}]},failures,held);
  const set = key => value => state[key]=typeof value==='function'?value(state[key]):value;
  const globals={ contentRevisionRef:{current:0}, userId:'owner',scope,tabRequest,mounted,tabLoadedRef:loaded,authProfileRef:{current:{id:'owner'}},normalizePost:normalize,
    hydratePostMedia:hydrate,withoutPrivateMedia,profileRead:request=>profileRead(request,timeoutMs),supabase:client,setTabError:set('error'),setTabLoading:set('loading'),setTabPosts:set('posts'),setTabCounts:set('counts'),setPostsHasMore:set('more'),setTabReposts:set('reposts'),setTabSaved:set('saved'),setTabTagged:set('tagged') };
  return {state,scope,loaded,client,run:callback(source,'loadTabContent',globals)};
}
for (const tab of ['posts','reposts','saved','tagged']) test(`profile ${tab} publishes authorized metadata while private previews resolve`, async () => {
  const gate=deferred();let received;
  const h=own(async rows=>{received=rows;return gate.promise;}); const promise=h.run(tab); await turn();
  const key={posts:'posts',reposts:'reposts',saved:'saved',tagged:'tagged'}[tab];
  assert.equal(h.state[key][0].id,'post'); assert.ok(received.length);
  assert.equal(h.state[key][0].media.length,0,'private canonical media must not render');
  assert.equal(h.state.loading,false);
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
  assert.equal(switched.state.posts[0].id,'post'); assert.equal(switched.state.posts[0].media.length,0);
  assert.notEqual(switched.state.posts[0].id,'stale-account');
});
test('query and signing failures expose retry without stranding the profile spinner',async()=>{
  for (const mode of ['query','signing']) {
    const h=own(async()=>{throw Error('Signing unavailable');},mode==='query'?{posts:Error('Query unavailable')}:{});
    await h.run('posts');assert.equal(h.state.posts[0].id,mode==='query'?'already-visible':'post');assert.match(h.state.error,/unavailable/);assert.equal(h.loaded.current.posts,mode==='query'?undefined:true);assert.equal(h.state.loading,false);
  }
});
test('legacy video metadata stays video and normalizing does not reorder cached source arrays',()=>{
  assert.equal(normalize({id:'legacy',media_url:'https://signed.test/movie.mp4?token=valid'}).media[0].media_type,'video');
  assert.equal(normalize({id:'legacy',media_url:'https://signed.test/object',media_type:'video'}).media[0].media_type,'video');
  const source=[{id:'later',sort_order:2,url:'later.jpg'},{id:'first',sort_order:0,url:'first.jpg'},{id:'denied',sort_order:1,url:null}];
  const result=normalize({id:'one',post_media:source});assert.equal(result.media[0].id,'first');assert.equal(source[0].id,'later');assert.equal(result.mediaUnavailable,true);
});
function visitor(profileResult,hydrate,prefetched=null) {
  const state={profile:null,posts:[],error:null,loading:true};const scope={current:{targetId:'target',myId:'viewer'}}, client=db({posts:[{id:'post',post_media:[{url:raw,media_type:'video'}]}]});
  client.rpc=async()=>profileResult;
  const noop=()=>{},set=key=>value=>state[key]=typeof value==='function'?value(state[key]):value;
  const globals={prefetchedTarget:{current:null},targetId:'target',myId:'viewer',scope,loadRequest:{current:0},mounted:{current:true},takePrefetched:()=>prefetched,awaitPrefetched:async()=>null,
    supabase:client,hydratePostMedia:hydrate,withoutPrivateMedia,profileRead,normalizeProfilePost:normalize,setProfile:set('profile'),setPosts:set('posts'),setLoadError:set('error'),setContentError:noop,setContentLoading:noop,setStats:noop,setFollowing:noop,setFollowRequested:noop,setLoading:set('loading'),setRefreshing:noop};
  return {state,scope,client,run:callback('src/screens/profile/UserProfileScreen.tsx','load',globals)};
}
test('visitor profile honors server content visibility before requesting posts',async()=>{
  const h=visitor({data:{id:'target',can_view_content:false},error:null},()=>{throw Error('must not sign private posts');});await h.run();
  assert.equal(h.client.calls.includes('posts'),false);assert.equal(h.state.posts.length,0);
});
test('visitor profile signs post previews and drops old account/target responses',async()=>{
  const gate=deferred(),h=visitor({data:{id:'target',can_view_content:true},error:null},()=>gate.promise);const pending=h.run();await turn();
  assert.equal(h.state.loading,false);assert.equal(h.state.posts[0].id,'post');assert.equal(h.state.posts[0].media.length,0);gate.resolve([{id:'post',post_media:[{id:'v',url:'signed.mp4',media_type:'video'}]}]);await pending;
  assert.equal(h.state.posts[0].media[0].url,'signed.mp4');
  const late=deferred(),stale=visitor({data:{id:'target',can_view_content:true},error:null},()=>late.promise);const old=stale.run();await turn();
  stale.scope.current={targetId:'other',myId:'viewer'};late.resolve([{id:'wrong-person',post_media:[]}]);await old;assert.equal(stale.state.posts[0].id,'post');assert.equal(stale.state.posts[0].media.length,0);
});
test('profile focus starts and restarts content without waiting for a header refresh',()=>{
  const source=read('src/screens/profile/ProfileScreen.tsx'),ast=ts.createSourceFile('profile.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let focused;
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useFocusEffect'&&node.arguments[0]?.getText(ast).includes('loadTabContent(activeTab, contentRevision)'))focused=node.arguments[0];ts.forEachChild(node,visit);}visit(ast);
  assert.ok(focused,'content reads must have their own focus lifecycle');
  const calls=[],tabRequest={current:2},moreRequest={current:3};
  const run=compile('export const run = '+focused.getText(ast),{useCallback:fn=>fn,userId:'owner',activeTab:'posts',contentRevision:0,loadTabContent:tab=>calls.push(tab),tabRequest,moreRequest}).run;
  const cleanup=run();assert.deepEqual(calls,['posts']);cleanup();assert.equal(tabRequest.current,3);assert.equal(moreRequest.current,4);
  run();assert.deepEqual(calls,['posts','posts'],'returning from another screen starts a fresh content read even if header RPC is still pending');
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


test('a hanging optional collaboration query cannot hold own posts or first-page loading',async()=>{
  const gate=deferred(),h=own(async rows=>rows,{}, {post_collaborators:gate.promise});
  const pending=h.run('posts');await turn();
  assert.equal(h.state.posts[0].id,'post');assert.equal(h.state.loading,false);await pending;
  gate.resolve({data:[],error:null});await turn();
});

test('a read that never reaches transport settles with retry, and a late response cannot replace it',async()=>{
  const gate=deferred(),h=own(async rows=>rows,{}, {posts:gate.promise},5);
  await h.run('posts');assert.equal(h.state.loading,false);assert.match(h.state.error,/too long/);assert.equal(h.loaded.current.posts,undefined);
  gate.resolve({data:[{id:'late',post_media:[]}],error:null});await turn();assert.equal(h.state.posts[0].id,'already-visible');
});

test('a media outage leaves the authorized post content usable and a retry replaces its stripped previews',async()=>{
  let attempts=0;const h=own(async rows=>{if(!attempts++)throw Error('Signing unavailable');return rows.map(row=>({...row,post_media:[{url:'signed.jpg',media_type:'image'}]}));});
  await h.run('posts');assert.equal(h.state.posts[0].id,'post');assert.equal(h.state.posts[0].media.length,0);assert.equal(h.state.loading,false);assert.match(h.state.error,/Signing unavailable/);
  await h.run('posts');assert.equal(h.state.posts[0].media[0].url,'signed.jpg');assert.equal(h.state.error,null);
});


test('pending media is a loading state, not an unavailable photo; text-only posts never display a media spinner',()=>{
 const pending=normalize({id:'photo',_mediaPending:true,post_media:[{url:null}]});assert.equal(pending.mediaPending,true);assert.equal(pending.mediaUnavailable,false);
 const text=normalize({id:'text',content:'A text post',_mediaPending:true,post_media:[]});assert.equal(text.mediaPending,false);
 const legacy=normalize({id:'old',_mediaPending:true,_mediaExpected:true,media_url:null});assert.equal(legacy.mediaPending,true);
 assert.equal(normalize({...legacy,_mediaPending:false}).mediaUnavailable,true);
});

test('a consumed profile prefetch cannot hide updated follow or visibility state on refresh',async()=>{
 const h=visitor({data:{id:'target',can_view_content:false},error:null},async rows=>rows,{id:'target',can_view_content:true});let liveReads=0;
 h.client.rpc=async()=>{liveReads++;return{data:{id:'target',can_view_content:false},error:null};};
 await h.run();assert.equal(liveReads,0);assert.equal(h.state.posts[0].id,'post');
 await h.run();assert.equal(liveReads,1);assert.equal(h.state.posts.length,0);
});
