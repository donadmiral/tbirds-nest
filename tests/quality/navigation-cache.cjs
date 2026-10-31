const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, overrides = {}, globals = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, require: name => { if (name in overrides) return overrides[name]; throw Error('Unexpected dependency '+name); },
      AbortController, setTimeout, clearTimeout, Promise, Map, Set, Date, atob, console, ...globals });
  return module.exports;
}
const shared = load('shared/navigationCache.ts');
const { createNavigationCache, navigationSessionIdentity } = shared;
const deferred = () => { let resolve,reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const turn = () => new Promise(resolve=>setImmediate(resolve));
const session = (owner, id, extra = {}) => ({ user:{id:owner}, access_token:`head.${Buffer.from(JSON.stringify({session_id:id,...extra})).toString('base64url')}.signature` });

test('resolved navigation content is synchronously available and isolated by session and business key', () => {
  const cache = createNavigationCache();cache.setScope('alice:session-one');
  cache.save('alice:session-one','inbox:business-one',[{id:'private'}]);
  assert.equal(cache.read('alice:session-one','inbox:business-one')[0].id,'private');
  assert.equal(cache.read('bob:session-one','inbox:business-one'),null);
  assert.equal(cache.read('alice:session-one','inbox:business-two'),null);
  cache.setScope('alice:session-two');assert.equal(cache.read('alice:session-two','inbox:business-one'),null);
  assert.equal(cache.save('alice:session-one','inbox:business-one',['old']),false);
});

test('account A→B→A cancels work immediately and its late result cannot refill the cache', async () => {
  const cache=createNavigationCache();cache.setScope('a');const gate=deferred();let signal;
  const pending=cache.load('a','feed',value=>{signal=value;return gate.promise;});const rejected=assert.rejects(pending,/cancelled|account changed/i);
  await turn();cache.setScope('b');cache.setScope('a');assert.equal(signal.aborted,true);
  await rejected;gate.resolve(['old-private-result']);await turn();assert.equal(cache.read('a','feed'),null);
});

test('a navigation tap shares the prefetch already in flight, including empty results', async () => {
  const cache=createNavigationCache();cache.setScope('a');const gate=deferred();let calls=0;
  const one=cache.load('a','inbox',()=>{calls++;return gate.promise;});
  const two=cache.load('a','inbox',()=>{calls++;return Promise.resolve(['wrong']);});
  assert.equal(one,two);await turn();assert.equal(calls,1);
  gate.resolve([]);await one;assert.equal(cache.read('a','inbox').length,0);
});

test('failed and timed-out refreshes preserve the established content and abort transport', async () => {
  const cache=createNavigationCache();cache.setScope('a');cache.save('a','feed',['readable']);
  await assert.rejects(cache.load('a','feed',async()=>{throw Error('offline');}),/offline/);
  assert.equal(cache.read('a','feed')[0],'readable');let signal;const gate=deferred();
  await assert.rejects(cache.load('a','feed',value=>{signal=value;return gate.promise;},5),/longer/);
  assert.equal(signal.aborted,true);gate.resolve(['late']);await turn();assert.equal(cache.read('a','feed')[0],'readable');
});

test('navigation memory has a finite LRU budget and rejects expired or future-dated entries', () => {
  let now=10;const cache=createNavigationCache({maxEntries:2,maxAgeMs:100,clock:()=>now});cache.setScope('a');
  cache.save('a','one',1);cache.save('a','two',2);assert.equal(cache.read('a','one'),1);cache.save('a','three',3);
  assert.equal(cache.read('a','two'),null);now=110;assert.equal(cache.read('a','one'),null);
  now=50;cache.save('a','future',false);now=49;assert.equal(cache.read('a','future'),null);
});

test('JWT refresh keeps a session namespace while reauthentication and account changes invalidate it', () => {
  assert.equal(navigationSessionIdentity(session('a','s',{exp:1})),navigationSessionIdentity(session('a','s',{exp:2})));
  assert.notEqual(navigationSessionIdentity(session('a','s')),navigationSessionIdentity(session('a','new')));
  assert.notEqual(navigationSessionIdentity(session('a','s')),navigationSessionIdentity(session('b','s')));
  assert.equal(navigationSessionIdentity(null),null);
});

function nativeHarness() {
  let auth={session:session('a','s')};const listeners=new Set();
  const authStore={getState:()=>auth,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  const native=load('src/lib/navigationCache.ts',{'../../shared/navigationCache':shared,'../stores/authStore':{useAuthStore:authStore}});
  const prefetch=load('src/lib/screenTransition.ts',{'./navigationCache':native});
  return {native,prefetch,change(value){auth={session:value};listeners.forEach(fn=>fn(auth));}};
}

test('native cache is cleared while screens are unmounted and a same-account token refresh retains it', () => {
  const h=nativeHarness();let scope=h.native.navigationScope();h.native.navigationCache.save(scope,'profile',{id:'private'});
  h.change(session('a','s',{exp:200}));assert.equal(h.native.navigationScope(),scope);
  h.change(null);assert.equal(h.native.navigationCache.read(scope,'profile'),null);
  h.change(session('a','s'));assert.notEqual(h.native.navigationScope(),scope);
});

test('native transition prefetch deduplicates and never waits for an artificial transition timer', async () => {
  const h=nativeHarness(),gate=deferred();let calls=0;
  h.prefetch.prefetch('profile:target',()=>{calls++;return gate.promise;});h.prefetch.prefetch('profile:target',()=>{calls++;return gate.promise;});
  const waiting=h.prefetch.awaitPrefetched('profile:target');await turn();assert.equal(calls,1);
  gate.resolve({id:'target'});assert.equal((await waiting).id,'target');assert.equal(h.prefetch.takePrefetched('profile:target').id,'target');
  h.change(session('b','s'));assert.equal(h.prefetch.takePrefetched('profile:target'),null);
});

test('a native prefetch cancelled by signout cannot return another session result', async () => {
  const h=nativeHarness(),gate=deferred();h.prefetch.prefetch('listing:one',()=>gate.promise);
  const waiting=h.prefetch.awaitPrefetched('listing:one');await turn();h.change(null);h.change(session('a','s'));
  assert.equal(await waiting,null);gate.resolve({id:'stale'});await turn();assert.equal(h.prefetch.takePrefetched('listing:one'),null);
});

function browserHarness() {
  const gate=deferred();let authEvent;let subscriptionBeforeLookup=false;
  const client={auth:{onAuthStateChange(fn){authEvent=fn;return{data:{subscription:{unsubscribe(){}}}};},getSession(){subscriptionBeforeLookup=!!authEvent;return gate.promise;}}};
  const web=load('web/lib/navigationCache.ts',{'../../shared/navigationCache':shared,'./supabase/client':{createClient:()=>client}},{window:{}});
  const store=web.getNavigationStore();
  return{web,store,gate,event:(event,value)=>authEvent(event,value),subscriptionBeforeLookup};
}

test('browser Auth observation precedes lookup and stale getSession cannot undo a rapid account round trip', async () => {
  const h=browserHarness();assert.equal(h.subscriptionBeforeLookup,true);
  h.event('INITIAL_SESSION',session('a','s'));const original=h.store.getSnapshot().scope;
  h.store.cache.save(original,'home:personal',{owner:'a'});
  h.event('SIGNED_IN',session('b','b'));h.event('SIGNED_IN',session('a','s'));
  h.gate.resolve({data:{session:session('b','b')},error:null});await turn();
  assert.equal(h.store.getSnapshot().owner,'a');assert.equal(h.store.getSnapshot().changed,true);
  assert.notEqual(h.store.getSnapshot().scope,original);assert.equal(h.store.cache.read(h.store.getSnapshot().scope,'home:personal'),null);
});

test('normal browser JWT rotation does not reset navigation or declare an account change', async () => {
  const h=browserHarness();h.event('INITIAL_SESSION',session('a','s'));const scope=h.store.getSnapshot().scope;
  h.store.cache.save(scope,'scroll:/home',480);h.event('TOKEN_REFRESHED',session('a','s',{exp:999}));
  assert.equal(h.store.getSnapshot().scope,scope);assert.equal(h.store.getSnapshot().changed,false);
  assert.equal(h.store.cache.read(scope,'scroll:/home'),480);
  h.gate.resolve({data:{session:session('a','s')},error:null});await turn();
});

test('server renders never share a navigation cache between requests', () => {
  const web=load('web/lib/navigationCache.ts',{'../../shared/navigationCache':shared,'./supabase/client':{createClient:()=>{throw Error('No server browser client');}}});
  const one=web.getNavigationStore(),two=web.getNavigationStore();assert.notEqual(one,two);
  one.cache.setScope('a');one.cache.save('a','private',['secret']);two.cache.setScope('a');assert.equal(two.cache.read('a','private'),null);
});

test('the actual App session callback clears React Query and cancels an old ignored-signal request across A→B→A', async () => {
  const {QueryClient}=require('@tanstack/react-query');
  const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const source=fs.readFileSync(path.join(root,'App.tsx'),'utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback;
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='subscribeNavigationScope')callback=node.arguments[0].getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(callback);
  const owners=[],auth={session:session('a','s')};
  const reset=vm.runInNewContext('('+callback+')',{queryClient,feedSnapshots:{setAccount:owner=>owners.push(owner)},useAuthStore:{getState:()=>auth}});
  queryClient.setQueryData(['private'],{owner:'a'});
  const gate=deferred(),old=queryClient.fetchQuery({queryKey:['pending'],queryFn:()=>gate.promise}).catch(()=>null);
  await turn();auth.session=session('b','b');reset();auth.session=session('a','s');reset();
  assert.equal(queryClient.getQueryData(['private']),undefined);assert.equal(queryClient.getQueryCache().getAll().length,0);
  gate.resolve({owner:'previous-session'});await old;await turn();
  assert.equal(queryClient.getQueryData(['pending']),undefined);assert.deepEqual(owners,[null,'b',null,'a']);queryClient.clear();
});

function inboxHarness() {
  let currentSession=session('a','s'); const native=nativeHarness(),calls=[];let reply;
  const client={from:table=>query(table),rpc:name=>query(name)};
  function query(table){const call={table,filters:{},header:null,signal:null};const q={setHeader(name,value){call.header=[name,value];return q;},abortSignal(value){call.signal=value;return q;},then(ok,bad){calls.push(call);return Promise.resolve().then(()=>reply(call)).then(ok,bad);}};for(const method of ['select','or','order'])q[method]=()=>q;for(const method of ['eq','in'])q[method]=(key,value)=>{call.filters[key]=value;return q;};return q;}
  const service=load('src/services/navigationInbox.ts',{'../../shared/messageReceipts':load('shared/messageReceipts.ts'),'../lib/navigationCache':native.native,'../stores/authStore':{useAuthStore:{getState:()=>({session:currentSession})}},'./supabase':{supabase:client},'./chatMediaService':{signGroupAvatars:async rows=>rows}});
  return {...native,calls,service,setReply:fn=>{reply=fn;},change(value){currentSession=value;native.change(value);}};
}
const inboxRows = call => {
  if(call.table==='conversations') return {data:call.filters.is_group?[{id:'group',is_group:true,group_name:'Team',last_message_time:'2026-10-30'}]:[{id:'dm',user_1:'a',user_2:'other',last_message_time:'2026-10-29'},{id:'hidden',user_1:'a',user_2:'other'}],error:null};
  if(call.table==='conversation_members')return {data:[{conversation_id:'group'}],error:null};
  if(call.table==='conversation_settings')return {data:[{conversation_id:'dm',is_pinned:true},{conversation_id:'hidden',is_deleted:true}],error:null};
  if(call.table==='profiles')return {data:[{id:'other',full_name:'Member'}],error:null};
  return {data:[],error:null};
};

test('native inbox intent and screen share four parallel first-stage reads with a pinned owner token', async()=>{
  const h=inboxHarness(),gate=deferred();h.setReply(async call=>{if(!call.filters.id&&call.table!=='profiles')await gate.promise;return inboxRows(call);});
  const one=h.service.refreshNavigationInbox('a'),two=h.service.refreshNavigationInbox('a');assert.equal(one,two);await turn();
  assert.equal(h.calls.length,4);assert.ok(h.calls.every(call=>call.header[1]==='Bearer '+session('a','s').access_token&&call.signal instanceof AbortSignal));
  gate.resolve();const rows=await one;assert.deepEqual(Array.from(rows,row=>row.id),['dm','group']);
  assert.equal(h.native.navigationCache.read(h.native.navigationScope(),'inbox:personal')[0].id,'dm');
});

test('failed native inbox refresh preserves loaded conversations and never converts denied settings into success',async()=>{
  const h=inboxHarness();h.setReply(inboxRows);await h.service.refreshNavigationInbox('a');
  h.setReply(call=>call.table==='conversation_settings'?{data:null,error:Error('offline')}:inboxRows(call));
  await assert.rejects(h.service.refreshNavigationInbox('a'),/could not be refreshed/);
  assert.equal(h.native.navigationCache.read(h.native.navigationScope(),'inbox:personal').length,2);
});

test('native inbox aborts first-stage transport and never starts another-account detail reads',async()=>{
  const h=inboxHarness(),gate=deferred();h.setReply(async call=>{await gate.promise;return inboxRows(call);});
  const pending=h.service.refreshNavigationInbox('a'),rejected=assert.rejects(pending,/cancelled|account changed/i);await turn();
  h.change(session('b','b'));h.change(session('a','s'));await rejected;gate.resolve();await turn();
  assert.equal(h.calls.length,4);assert.ok(h.calls.every(call=>call.signal.aborted));
  assert.equal(h.native.navigationCache.read(h.native.navigationScope(),'inbox:personal'),null);
});
