const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
function load(file) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require, setTimeout, clearTimeout, queueMicrotask, Map, Set });
  return module.exports;
}
const { createFollowStore } = load('lib/followState.ts');
const { notificationHref, conversationHref } = load('lib/notificationRouting.ts');
const profileLookup = load('lib/profileLookup.ts');
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const flush = () => new Promise(r => setImmediate(r));
function harness() {
  let auth;
  let viewer = 'alice';
  let query = () => ({ count: 0, error: null });
  let action = () => ({ data: { action: 'followed' }, error: null });
  let session = () => Promise.resolve({ data: { session: { user: { id: viewer } } }, error: null });
  const calls = { reads: [], writes: 0 };
  const client = {
    auth: { getSession: () => session(), onAuthStateChange: fn => { auth = fn; return { data: { subscription: { unsubscribe() {} } } }; } },
    from(table) {
      const filters = {};
      const chain = { select() { return chain; }, eq(k,v) { filters[k]=v; return chain; }, then(ok,bad) { calls.reads.push({ table, filters }); return Promise.resolve(query(table, filters)).then(ok,bad); } };
      return chain;
    },
    rpc() { calls.writes++; return Promise.resolve(action()); },
  };
  return { store: createFollowStore(client), calls, setQuery(fn) { query=fn; }, setAction(fn) { action=fn; }, setSession(fn) { session=fn; }, auth(id) { viewer=id; auth('SIGNED_IN', id ? {user:{id}} : null); } };
}
test('duplicate cards share one hydration and observe the same optimistic and confirmed state', async () => {
  const h=harness(); let a=0,b=0;
  const ua=h.store.subscribe('target',()=>a++), ub=h.store.subscribe('target',()=>b++);
  await Promise.all([h.store.ensure('target'),h.store.ensure('target')]);
  assert.equal(h.calls.reads.length,2);
  const pending=defer();h.setAction(()=>pending.promise);
  const task=h.store.toggle('target');
  assert.equal(h.store.snapshot('target').pending,true);assert.equal(h.store.snapshot('target').state,'following');
  await h.store.toggle('target');assert.equal(h.calls.writes,1);
  pending.resolve({data:{action:'requested'},error:null});await task;
  assert.equal(h.store.snapshot('target').state,'requested');assert.equal(a,b);assert.ok(a>1);ua();ub();
});
test('old viewer hydration cannot overwrite the next viewer', async () => {
  const h=harness(), old=defer();
  h.setQuery((_table,f)=>f.follower_id==='alice'||f.requester_id==='alice'?old.promise:{count:0,error:null});
  const oldRead=h.store.ensure('target');await flush();h.auth('bob');await h.store.ensure('target');
  old.resolve({count:1,error:null});await oldRead;
  assert.equal(h.store.snapshot('target').state,'none');
});
test('sign-out invalidates a pending follow mutation', async () => {
  const h=harness();await h.store.ensure('target');const pending=defer();h.setAction(()=>pending.promise);
  const task=h.store.toggle('target');h.auth(null);pending.resolve({data:{action:'followed'},error:null});await task;
  assert.equal(h.store.snapshot('target').state,'unknown');
});
test('an auth event releases hydration even if getSession remains pending', async () => {
  const h=harness();h.setSession(()=>new Promise(()=>{}));const task=h.store.ensure('target');h.auth('bob');await task;
  assert.equal(h.store.snapshot('target').state,'none');
});
test('late getSession cannot undo a newer sign-out', async () => {
  const h=harness(), pending=defer();h.setSession(()=>pending.promise);
  const task=h.store.ensure('target');h.auth(null);pending.resolve({data:{session:{user:{id:'alice'}}},error:null});await task;
  assert.equal(h.calls.reads.length,0);assert.equal(h.store.snapshot('target').state,'unknown');
});
test('returned query errors stay unknown and retry rehydrates', async () => {
  const h=harness();h.setQuery(()=>({count:null,error:{message:'unavailable'}}));await h.store.ensure('target');
  assert.equal(h.store.snapshot('target').state,'unknown');assert.ok(h.store.snapshot('target').error);
  h.setQuery(()=>({count:0,error:null}));await h.store.toggle('target');assert.equal(h.store.snapshot('target').state,'none');assert.equal(h.calls.writes,0);
});
test('ambiguous mutation failures reconcile instead of blindly toggling again', async () => {
  const h=harness();await h.store.ensure('target');h.setAction(()=>Promise.reject(new Error('network lost')));
  h.setQuery(table=>({count:table==='follows'?1:0,error:null}));await h.store.toggle('target');
  assert.equal(h.store.snapshot('target').state,'following');assert.equal(h.store.snapshot('target').pending,false);assert.equal(h.calls.writes,1);
});
test('actual request_cancelled RPC result clears a pending request', async () => {
  const h=harness();h.setQuery(table=>({count:table==='follow_requests'?1:0,error:null}));await h.store.ensure('target');
  h.setAction(()=>({data:{action:'request_cancelled'},error:null}));await h.store.toggle('target');assert.equal(h.store.snapshot('target').state,'none');
});
test('self controls never write', async () => { const h=harness();await h.store.ensure('alice');await h.store.toggle('alice');assert.equal(h.store.snapshot('alice').state,'self');assert.equal(h.calls.writes,0); });
test('payment and reaction notifications point into their conversation', () => {
  assert.equal(notificationHref({type:'payment_received',data:{conversation_id:'c',listing_id:'l'},actor_username:'sender'}),'/messages?c=c');
  assert.equal(conversationHref('c','market'),'/market/messages?c=c');assert.equal(conversationHref('c','jobs'),'/jobs/messages?c=c');
  assert.equal(notificationHref({type:'message_reaction',data:{conversation_id:'c'}}),'/messages?c=c');
});
test('job applications, posts, marketplace and invitations preserve relevant destinations', () => {
  const route=(type,data)=>notificationHref({type,data,actor_username:'actor'});
  assert.equal(route('job_application',{job_id:'j'}),'/jobs/j/applicants');assert.equal(route('job_referral',{job_id:'j'}),'/jobs/j');
  assert.equal(route('comment',{post_id:'p'}),'/post/p');assert.equal(route('market_alert',{listing_id:'l'}),'/market/l');
  assert.equal(route('community_invite',{community_id:'c'}),'/communities/c');assert.equal(route('business_member',{business_id:'b'}),'/businesses');
});
test('routing escapes path/query values and rejects non-string metadata', () => {
  assert.equal(conversationHref('x&c=other','personal'),'/messages?c=x%26c%3Dother');
  assert.equal(notificationHref({type:'like',data:{post_id:42},actor_username:'a/b'}),'/a%2Fb');
});

function searchHarness() {
  const states=[], effects=[], timers=new Map(); let hook=0,timer=0; const scheduled=[];
  let url='linked search', answer=()=>({data:[],error:null}); const searches=[];
  const client={auth:{getSession:async()=>({data:{session:null},error:null})},rpc(name,args){ if(name==='get_trending_topics'||name==='log_search_event')return Promise.resolve({data:[],error:null}); searches.push(args.p_q); return Promise.resolve(answer(name,args)); }};
  const react={Suspense:'Suspense',useState(initial){const i=hook++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useCallback(fn){hook++;return fn;},useEffect(fn,deps){const i=hook++;const prev=effects[i];if(!prev||deps.some((value,k)=>!Object.is(value,prev.deps[k]))){scheduled.push(()=>{prev?.cleanup?.();effects[i]={deps,cleanup:fn()};});}}};
  const module={exports:{}};
  const source=fs.readFileSync(path.join(__dirname,'../../app/search/page.tsx'),'utf8')+'\nexport { SearchResults, SearchFromUrl };';
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const jsx=(type,props,key)=>({type,props,key});
  const imports=name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:name==='next/navigation'?{useRouter:()=>({back(){},push(){}}),useSearchParams:()=>new URLSearchParams({q:url})}:name==='@/lib/supabase/client'?{createClient:()=>client}:name==='@/lib/profileLookup'?profileLookup:name==='@/lib/feed'?{timeAgo:()=>''}:name==='@/lib/media'?{displayImageUrl:x=>x}:new Proxy({__esModule:true,default:name},{get:(target,key)=>target[key]??String(key)});
  vm.runInNewContext(js,{module,exports:module.exports,require:imports,URLSearchParams,window:{localStorage:{getItem:()=>null}},queueMicrotask,setTimeout(fn){const id=++timer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
  function render(query=''){hook=0;const tree=module.exports.SearchResults({initialQuery:query});while(scheduled.length)scheduled.shift()();return tree;}
  function nodes(tree,type){ if(!tree||typeof tree!=='object')return[]; if(Array.isArray(tree))return tree.flatMap(x=>nodes(x,type));return[...(tree.type===type?[tree]:[]),...nodes(tree.props?.children,type)]; }
  return{render,nodes,searches,setAnswer(fn){answer=fn;},fromUrl(){return module.exports.SearchFromUrl();},setQuery(value){const input=nodes(render(),'input')[0];input.props.onChange({target:{value}});return render();},async runTimers(){const pending=[...timers.values()];timers.clear();const running=pending.map(fn=>fn());await flush();return running;}};
}
test('search reads q from navigation links',()=>{const h=searchHarness();const tree=h.fromUrl();assert.equal(tree.props.initialQuery,'linked search');assert.equal(tree.key,'linked search');});
test('a late old search cannot replace the newer query results',async()=>{
 const h=searchHarness(),old=defer();h.setAnswer((name,args)=>args.p_q==='older'?old.promise:{data:name==='search_people'?[{id:'new',full_name:'New result',username:'new'}]:[],error:null});
 h.render('older');await h.runTimers();h.setQuery('newer');await h.runTimers();await flush();
 const before=h.nodes(h.render(),'FollowButton');assert.equal(before[0].props.authorId,'new');
 old.resolve({data:[],error:null});await flush();const after=h.nodes(h.render(),'FollowButton');assert.equal(after[0].props.authorId,'new');
});
test('clearing search hides old results and prevents an in-flight response from restoring them',async()=>{
 const h=searchHarness(),old=defer();h.setAnswer(()=>old.promise);h.render('old');await h.runTimers();h.setQuery('');old.resolve({data:[{id:'old',full_name:'Old result'}],error:null});await flush();assert.equal(h.nodes(h.render(),'FollowButton').length,0);
});
test('returned search RPC errors show retry instead of a false empty result',async()=>{
 const h=searchHarness();h.setAnswer(()=>({data:null,error:{message:'offline'}}));h.render('query');await h.runTimers();await flush();const errors=h.nodes(h.render(),'ErrorState');assert.equal(errors.length,1);errors[0].props.onRetry();h.setAnswer(()=>({data:[],error:null}));h.render();await h.runTimers();await flush();assert.equal(h.nodes(h.render(),'ErrorState').length,0);
});

function storyLoadHarness({ initialStoryId='target', userIdx=0, startIndex=0 }={}) {
  const source=fs.readFileSync(path.join(__dirname,'../../components/StoryViewer.tsx'),'utf8');
  const end=source.indexOf('  }, [user, userIdx, startIndex, initialStoryId]);');
  const start=source.lastIndexOf('  useEffect(() => {',end);
  assert.ok(start>=0&&end>start,'story loading effect is present');
  const pending=defer(), observed={};let cleanup;
  const code=source.slice(start,end)+'  }, []);';
  vm.runInNewContext(code,{user:{user_id:'owner'},userIdx,startIndex,initialStoryId,useEffect:fn=>cleanup=fn(),getUserStories:()=>pending.promise,setStories:value=>observed.stories=value,setItemIdx:value=>observed.index=value,setStoryLoadFinished:value=>observed.finished=value});
  return {pending,observed,cleanup};
}
test('story notification opens its exact asynchronously loaded story',async()=>{
 const h=storyLoadHarness();h.pending.resolve([{id:'earlier'},{id:'target'},{id:'later'}]);await flush();assert.equal(h.observed.index,1);assert.equal(h.observed.finished,true);
});
test('expired story target never falls through to an unrelated story',async()=>{
 const h=storyLoadHarness();h.pending.resolve([{id:'different'}]);await flush();assert.equal(h.observed.stories.length,0);assert.equal(h.observed.finished,true);
});
test('moving to another story owner starts at their first story',async()=>{
 const h=storyLoadHarness({userIdx:1,startIndex:0});h.pending.resolve([{id:'next-owner'}]);await flush();assert.equal(h.observed.index,0);assert.equal(h.observed.stories[0].id,'next-owner');
});
test('unmounted story loading does not replace the current viewer',async()=>{
 const h=storyLoadHarness();h.cleanup();h.pending.resolve([{id:'target'}]);await flush();assert.equal(h.observed.finished,false);assert.equal(h.observed.stories.length,0);
});
