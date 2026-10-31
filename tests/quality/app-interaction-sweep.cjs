const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file) {
  const module = {exports:{}};
  const js = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{module,exports:module.exports,Map,Set,Date,Promise,console});
  return module.exports;
}
const {createFeedTabCache} = load('shared/feedTabCache.ts');
const {uniqueCollaborators,collaborationName} = load('shared/collaborationPeople.ts');
const {loadCommentHighlights,pinnedFirst} = load('shared/commentHighlights.ts');

test('collaboration identity removes self/duplicate accounts while preserving two people with the same name',()=>{
 const people=[{id:'author',full_name:'Don'},{id:'second',full_name:'Don',username:'second_don'},{id:'second',full_name:'Don'},{id:'third',full_name:'Jane'}];
 const result=uniqueCollaborators(people,'author');
 assert.deepEqual(result.map(p=>p.id),['second','third']);
 assert.equal(collaborationName(result[0],'Don'),'@second_don');
 assert.equal(collaborationName(result[1],'Don'),'Jane');
 assert.equal(collaborationName({username:'jane'},'Don'),'jane');
});

test('feed memory expires capabilities and clearing an account removes every tab',()=>{
 let now=0;const cache=createFeedTabCache(1000,()=>now);
 cache.save('alice:forYou:all',['a']);cache.save('alice:discover:video',['v']);
 now=999;assert.equal(cache.read('alice:forYou:all')[0],'a');
 now=1000;assert.equal(cache.read('alice:forYou:all'),null);
 cache.clear();assert.equal(cache.read('alice:discover:video'),null);
 assert.equal(cache.read('bob:forYou:all'),null);
});

test('native tab effect restores For You immediately and distinguishes a first visit from a resolved empty feed',()=>{
 const source=fs.readFileSync(path.join(root,'src/screens/feed/FeedScreen.tsx'),'utf8');
 const ast=ts.createSourceFile('FeedScreen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let callback;
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useLayoutEffect'&&node.arguments[0]?.getText(ast).includes('feedTabs.read'))callback=node.arguments[0].getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(callback);
 const cache=createFeedTabCache(),calls=[],state={},frames=[],scrolls=[];
 const context={module:{exports:{}},exports:{},feedTabs:cache,feedMode:'trending',discoverCat:'all',userId:'alice',loading:false,feedError:null,
   visibleFeedScope:'alice:forYou:all',posts:[{id:'first',user_id:'author'}],profilesMap:{author:{id:'author'}},likedPosts:{first:true},bookmarkedPosts:{},repostedPosts:{},
   feedModeRef:{current:'forYou'},discoverCatRef:{current:'all'},modeFirstRun:{current:false},feedScopeRef:{current:'alice:trending:all'},
   cursorRef:{current:{key:1,id:'first'}},hasMoreRef:{current:false},scrollOffsetRef:{current:200},discoverPageRef:{current:{asOf:'2026-10-29T00:00:00Z',offset:0}},
   hiddenIdsRef:{current:new Set()},postsRef:{current:[]},restoredSnapshotRef:{current:false},pendingPostsRef:{current:[]},
   feedListRef:{current:{scrollToOffset:value=>scrolls.push(value)}},requestAnimationFrame:fn=>frames.push(fn),loadFeedRef:{current:(...args)=>calls.push(args)},Date};
 for(const [setter,key] of [['setPosts','posts'],['setProfilesMap','profilesMap'],['setLikedPosts','likedPosts'],['setBookmarkedPosts','bookmarkedPosts'],['setRepostedPosts','repostedPosts'],['setVisibleFeedScope','visibleFeedScope'],['setLoading','loading'],['setFeedError','feedError'],['setPendingPostCount','pending']])context[setter]=value=>{context[key]=value;state[key]=value;};
 vm.createContext(context);vm.runInContext('var changeTab = '+callback,context);context.changeTab();
 assert.equal(state.loading,true);assert.equal(state.posts.length,0);assert.deepEqual(calls[0],[true,false]);
 context.posts=[{id:'trend',user_id:'another'}];context.loading=false;
 context.feedMode='forYou';context.feedScopeRef.current='alice:forYou:all';context.changeTab();
 assert.equal(state.posts[0].id,'first');assert.equal(state.loading,false);assert.equal(state.likedPosts.first,true);
 assert.equal(context.scrollOffsetRef.current,200);assert.deepEqual(calls[1],[false,true]);
 assert.equal(context.cursorRef.current.id,'first');assert.equal(context.hasMoreRef.current,false);
 assert.equal(context.restoredSnapshotRef.current,false,'returning to a tab preserves its established paging cursor');
 frames.splice(0).forEach(run=>run());assert.deepEqual(scrolls.map(value=>value.offset),[200],'a stale tab animation cannot scroll the current tab');
 context.feedMode='trending';context.feedScopeRef.current='alice:trending:all';context.changeTab();
 context.feedScopeRef.current='bob:trending:all';frames.splice(0).forEach(run=>run());
 assert.deepEqual(scrolls.map(value=>value.offset),[200],'an old account cannot move the next account feed');
});

test('native cached disk snapshot keeps its pending cursor refresh across tab changes',()=>{
 const source=fs.readFileSync(path.join(root,'src/screens/feed/FeedScreen.tsx'),'utf8');
 const ast=ts.createSourceFile('FeedScreen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let callback;
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useLayoutEffect'&&node.arguments[0]?.getText(ast).includes('feedTabs.read'))callback=node.arguments[0].getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(callback);
 const cache=createFeedTabCache(),calls=[],state={};
 const context={module:{exports:{}},exports:{},feedTabs:cache,feedMode:'trending',discoverCat:'all',userId:'alice',loading:false,feedError:null,
   visibleFeedScope:'alice:forYou:all',posts:[{id:'first',user_id:'author'}],profilesMap:{author:{id:'author'}},likedPosts:{first:true},bookmarkedPosts:{},repostedPosts:{},
   feedModeRef:{current:'forYou'},discoverCatRef:{current:'all'},modeFirstRun:{current:false},feedScopeRef:{current:'alice:trending:all'},
   cursorRef:{current:null},hasMoreRef:{current:false},scrollOffsetRef:{current:200},discoverPageRef:{current:{asOf:'2026-10-29T00:00:00Z',offset:0}},
   hiddenIdsRef:{current:new Set()},postsRef:{current:[]},restoredSnapshotRef:{current:true},pendingPostsRef:{current:[]},
   feedListRef:{current:{scrollToOffset:()=>{}}},requestAnimationFrame:fn=>fn(),loadFeedRef:{current:(...args)=>calls.push(args)},Date};
 for(const [setter,key] of [['setPosts','posts'],['setProfilesMap','profilesMap'],['setLikedPosts','likedPosts'],['setBookmarkedPosts','bookmarkedPosts'],['setRepostedPosts','repostedPosts'],['setVisibleFeedScope','visibleFeedScope'],['setLoading','loading'],['setFeedError','feedError'],['setPendingPostCount','pending']])context[setter]=value=>{context[key]=value;state[key]=value;};
 vm.createContext(context);vm.runInContext('var changeTab = '+callback,context);context.changeTab();
 assert.equal(state.loading,true);assert.equal(state.posts.length,0);assert.deepEqual(calls[0],[true,false]);
 context.posts=[{id:'trend',user_id:'another'}];context.loading=false;
 context.feedMode='forYou';context.feedScopeRef.current='alice:forYou:all';context.changeTab();
 assert.equal(state.posts[0].id,'first');assert.equal(state.loading,false);assert.equal(state.likedPosts.first,true);
 assert.equal(context.scrollOffsetRef.current,200);assert.deepEqual(calls[1],[false,true]);
 assert.equal(context.cursorRef.current,null);assert.equal(context.hasMoreRef.current,false);
 assert.equal(context.restoredSnapshotRef.current,true,'snapshot rows still need a cursor from their first confirmed page');
});

test('author highlights read only positive reactions from the actual post author and preserve chronological order below a pin',async()=>{
 const calls=[];
 const client={from(table){const filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},in:(k,v)=>{filters.push([k,v]);return q;},maybeSingle:()=>q,then(resolve,reject){calls.push({table,filters});return Promise.resolve(table==='post_comment_pins'?{data:{comment_id:'two'}}:{data:[{comment_id:'one'}]}).then(resolve,reject);}};return q;}};
 const result=await loadCommentHighlights(client,'post','author',['one','two']);
 assert.equal(result.pinnedId,'two');assert.ok(result.likedByAuthor.has('one'));assert.equal(result.unavailable,false);
 const reaction=calls.find(c=>c.table==='comment_reactions');assert.ok(reaction.filters.some(([k,v])=>k==='user_id'&&v==='author'));assert.ok(reaction.filters.some(([k,v])=>k==='value'&&v===1));
 const comments=[{id:'one'},{id:'two'},{id:'three'}];assert.deepEqual(Array.from(pinnedFirst(comments,'two'),c=>c.id),['two','one','three']);assert.deepEqual(comments.map(c=>c.id),['one','two','three']);
});

test('an unavailable pin feature cannot erase author likes or a readable thread',async()=>{
 const client={from(table){const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>q,then(resolve,reject){return Promise.resolve(table==='post_comment_pins'?{data:null,error:{message:'temporary'}}:{data:[{comment_id:'one'}]}).then(resolve,reject);}};return q;}};
 const result=await loadCommentHighlights(client,'post','author',['one']);assert.equal(result.pinnedId,null);assert.equal(result.unavailable,true);assert.ok(result.likedByAuthor.has('one'));
});
