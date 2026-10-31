const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..');
function compile(file,imports={},globals={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>imports[name],AbortController,setTimeout,clearTimeout,...globals});return module.exports;}
const normalize=compile('src/utils/profilePost.ts').normalizeProfilePost;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(initial,hydrate,{signedIn=true,active=true}={}){
 let rows=initial,cleanup,scope=signedIn?'1:viewer':null,owner=signedIn?'viewer':null,revision=1;
 const events=new Set(),timers=new Set(),errors=[],listeners=new Set(),reads=[];
 const app={currentState:'active',addEventListener:(_event,fn)=>{events.add(fn);return{remove:()=>events.delete(fn)};}};
 const navigation={navigationScope:()=>scope,subscribeNavigationScope:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
 const auth={useAuthStore:{getState:()=>({session:owner?{user:{id:owner},access_token:owner+'-token'}:null})}};
 const service=compile('src/services/profileContent.ts',{
  '../../shared/contentMedia':{hydrateContentMedia:(_client,_base,value)=>hydrate(value)},
  '../lib/navigationCache':navigation,'../stores/authStore':auth,'./supabase':{supabase:{},SUPABASE_URL:'https://fixture.invalid'},
 });
 const hooks={useRef:value=>({current:value}),useEffect:fn=>{cleanup=fn();},useSyncExternalStore:(_subscribe,getSnapshot)=>getSnapshot()};
 const hook=compile('src/hooks/useProfileMediaRefresh.ts',{
  'react':hooks,'react-native':{AppState:app},'../services/profileContent':{profileContentRead:(viewer,scope,signal,work)=>{reads.push({viewer,scope,signal});return service.profileContentRead(viewer,scope,signal,work);}},
  '../lib/navigationCache':navigation,'../stores/authStore':auth,'../utils/profilePost':{normalizeProfilePost:normalize},
 },{Date:{now:()=>100000},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)}).useProfileMediaRefresh;
 hook(rows,update=>{rows=typeof update==='function'?update(rows):update;},'viewer:owner',active,value=>errors.push(value));
 return{get rows(){return rows;},errors,reads,dispose:()=>cleanup?.(),replace:value=>rows=value,
  tick:()=>{for(const fn of timers)fn();},state:value=>{app.currentState=value;for(const fn of events)fn(value);},
  get listeners(){return events.size;},get scopedListeners(){return listeners.size;},
  account(next){owner=next;scope=next?`${++revision}:${next}`:null;listeners.forEach(fn=>fn());},
 };
}
test('profile renewal keeps pagination and renews only expiring signed attachments',async()=>{
 const calls=[],old={id:'one',_mediaExpiresAt:120000,post_media:[{url:'old.jpg'}]},fresh={id:'two',_mediaExpiresAt:300000,post_media:[{url:'fresh.jpg'}]};
 const f=fixture([old,fresh],async rows=>{calls.push(rows);return rows.map(row=>({...row,_mediaExpiresAt:400000,post_media:[{url:'renewed.jpg'}]}));});await turn();
 assert.equal(calls[0].length,1);assert.equal(f.rows.length,2);assert.equal(f.rows[0].media[0].url,'renewed.jpg');assert.equal(f.rows[1],fresh);f.dispose();assert.equal(f.listeners,0);
});
test('a late renewal cannot overwrite a newer profile read or a changed account',async()=>{
 const gate=deferred(),f=fixture([{id:'one',_mediaExpiresAt:120000,post_media:[{url:'old.jpg'}]}],()=>gate.promise);
 const newer={id:'one',_mediaExpiresAt:500000,post_media:[{url:'newer.jpg'}]};f.replace([newer]);gate.resolve([{id:'one',_mediaExpiresAt:400000,post_media:[{url:'stale.jpg'}]}]);await turn();assert.equal(f.rows[0],newer);f.dispose();
 const late=deferred(),g=fixture([{id:'one',_mediaExpiresAt:120000}],()=>late.promise);g.dispose();const current=g.rows;late.resolve([{id:'one',_mediaExpiresAt:400000}]);await turn();assert.equal(g.rows,current);
});
test('denied media stays denied after refresh and signing outages expose a retry message',async()=>{
 const f=fixture([{id:'one',_mediaExpiresAt:120000,post_media:[{url:'old.jpg'}]}],async rows=>rows.map(row=>({...row,_mediaExpiresAt:400000,post_media:[{url:null}]})));await turn();assert.equal(f.rows[0].media.length,0);assert.equal(f.rows[0].mediaUnavailable,true);f.dispose();
 const g=fixture([{id:'one',_mediaExpiresAt:120000}],async()=>{throw Error('offline');});await turn();assert.match(g.errors[0],/Retry/);g.dispose();
});

test('a media renewal cannot replace a newer metadata edit that retains the same expiry',async()=>{
 const gate=deferred(),old={id:'one',content:'Before edit',_mediaExpiresAt:120000,post_media:[{url:'old.jpg'}]},f=fixture([old],()=>gate.promise);
 const newer={...old,content:'Edited caption',likes_count:8};f.replace([newer]);
 gate.resolve([{...old,_mediaExpiresAt:400000,post_media:[{url:'stale.jpg'}]}]);await turn();
 assert.equal(f.rows[0],newer);assert.equal(f.rows[0].content,'Edited caption');assert.equal(f.rows[0].likes_count,8);f.dispose();
});
test('same-user session round trips abort periodic renewal before React rerenders and never restart old work',async()=>{
 const gate=deferred(),old={id:'one',_mediaExpiresAt:120000,post_media:[{url:'old.jpg'}]},f=fixture([old],()=>gate.promise);
 await turn();assert.equal(f.reads.length,1);assert.equal(f.reads[0].viewer,'viewer');assert.equal(f.scopedListeners,1);
 f.account('another');f.account('viewer');await turn();
 assert.equal(f.scopedListeners,0,'the session observer releases the cancelled operation');
 gate.resolve([{id:'one',_mediaExpiresAt:400000,post_media:[{url:'old-session.jpg'}]}]);await turn();
 assert.equal(f.rows[0],old);assert.deepEqual(f.errors,[]);
 f.tick();f.state('active');await turn();assert.equal(f.reads.length,1,'the old effect cannot dispatch under the new session');f.dispose();
});
test('leaving a profile aborts its renewal and suppresses late errors',async()=>{
 const gate=deferred(),f=fixture([{id:'one',_mediaExpiresAt:120000}],()=>gate.promise);await turn();
 f.dispose();await turn();assert.equal(f.reads[0].signal.aborted,true);assert.equal(f.scopedListeners,0);assert.equal(f.listeners,0);
 gate.reject(Error('late transport error'));await turn();assert.deepEqual(f.errors,[]);
});
test('inactive and signed-out profiles dispatch no renewal',async()=>{
 for(const options of [{signedIn:false},{active:false}]){
  const f=fixture([{id:'one',_mediaExpiresAt:120000}],()=>{throw Error('must not run');},options);await turn();
  assert.equal(f.reads.length,0);assert.equal(f.listeners,0);assert.equal(f.scopedListeners,0);f.dispose();
 }
});
