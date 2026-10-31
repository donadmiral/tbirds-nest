const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, imports = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, AbortController, URL, setTimeout, clearTimeout, console, atob,
      require(name) {
        if (name in imports) return imports[name];
        const relative = path.resolve(root, path.dirname(file), name + '.ts');
        if (name.startsWith('.') && relative.startsWith(path.join(root, 'shared') + path.sep)) return load(path.relative(root, relative), {}, globals);
        throw Error('Unexpected dependency '+name);
      }, ...globals });
  return module.exports;
}
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',C='10000000-0000-4000-8000-000000000003',STORY='20000000-0000-4000-8000-000000000001';
const base='https://story-fixture.invalid';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(options={}) {
  let now=Date.now(),session={user:{id:A},access_token:'captured-A-token'},snapshot={owner:A,scope:'1:'+A,revision:1,initialized:true,changed:false};
  const clock=class extends Date {static now(){return now;}};
  const timer=(fn,ms)=>setTimeout(fn,Math.min(ms,options.deadline??12000));
  const cache=load('shared/navigationCache.ts',{}, {Date:clock,setTimeout:timer}).createNavigationCache({clock:()=>now});cache.setScope(snapshot.scope);
  const store={cache,getSnapshot:()=>snapshot},requests=[],verified=[],signed=[];
  const responses=options.responses??{};
  const users=[{user_id:B,full_name:'Stored person',latest_story_id:STORY,latest_story_at:new Date(now).toISOString(),has_unseen:true}];
  const data=name=>name==='get_catchup_feed'?users:name==='profiles'?{avatar_url:'owner-avatar.jpg'}:name==='get_trending_stories'&&options.hot?[{story_id:STORY,user_id:C,full_name:'Spotlight',username:'spotlight',avatar_url:null}]:name==='stories'?[{id:STORY,user_id:C,media_type:'image',media_url:`${base}/storage/v1/object/public/story-media/${C}/photo.jpg`,thumbnail_url:null,expires_at:new Date(now+60000).toISOString(),created_at:new Date(now).toISOString()}]:[];
  const builder=(name,args)=>{
    const request={name,args,headers:{},filters:[]};
    const q={setHeader(k,v){request.headers[k]=v;return q;},abortSignal(signal){request.signal=signal;return q;},
      then(ok,bad){requests.push(request);return Promise.resolve().then(()=>typeof responses[name]==='function'?responses[name](request):responses[name]??{data:data(name),error:null}).then(ok,bad);}};
    for(const name of ['select','eq','in','maybeSingle'])q[name]=(...args)=>{request.filters.push([name,...args]);return q;};return q;
  };
  const client={auth:{getSession:()=>options.sessionGate?.promise??Promise.resolve({data:{session},error:null}),
      async getUser(token){verified.push(token);return options.verificationGate?.promise??{data:{user:{id:A}},error:null};}},
    rpc:(name,args)=>builder(name,args),from:name=>builder(name),functions:{async invoke(name,opts){signed.push({name,opts});return{data:{expiresAt:now+60000,urls:[{key:`story-media/${C}/photo.jpg`,url:`${base}/storage/v1/object/sign/story-media/${C}/photo.jpg?token=valid`}]},error:null};}}};
  const media=load('shared/contentMedia.ts',{}, {Date:clock});
  const imports={'./navigationCache':{getNavigationStore:()=>store},'./supabase/client':{createClient:()=>client},
    './contentMedia':{hydrateStoryMedia:(rows,scoped)=>media.hydrateContentMedia(scoped,base,rows,'story')},
    './withTimeout':load('web/lib/withTimeout.ts',{}, {setTimeout:timer}),
    '../../shared/trendingStories':load('shared/trendingStories.ts',{}, {Date:clock})};
  const api=load('web/lib/storyNavigation.ts',imports,{Date:clock});
  const stories=load('web/lib/stories.ts',{'@/lib/supabase/client':{createClient:()=>client},'@/lib/contentMedia':imports['./contentMedia'],'./storyNavigation':api});
  return{api,stories,store,requests,verified,signed,responses,users,
    advance(ms){now+=ms;},switchOwner(owner){session=owner?{user:{id:owner},access_token:owner+'-token'}:null;snapshot={owner,scope:owner?(snapshot.revision+1)+':'+owner:null,revision:snapshot.revision+1,initialized:true,changed:true};cache.setScope(snapshot.scope);}};
}

test('story strip and every avatar share one session-scoped, coalesced metadata read',async()=>{
  const gate=deferred(),h=fixture({responses:{get_catchup_feed:gate.promise}});
  const strip=h.api.loadStoryNavigation(),avatars=Array.from({length:16},()=>h.stories.getRingUsers());await tick();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].name,'get_catchup_feed');
  gate.resolve({data:h.users,error:null});const [memory,...people]=await Promise.all([strip,...avatars]);
  assert.equal(memory.scope,h.store.getSnapshot().scope);assert.ok(people.every(rows=>rows[0].user_id===B));
  const before=h.requests.length;assert.equal(h.api.storyNavigationMemory(),memory);assert.equal((await h.stories.getRingUsers())[0].user_id,B);
  assert.equal(h.requests.length,before,'a warm avatar uses the current session metadata synchronously');
});

test('story navigation expires after60seconds and invalidation forces a fresh verified read',async()=>{
  const h=fixture();await h.api.loadStoryNavigation();const before=h.requests.length;
  h.advance(60000);assert.equal(h.api.storyNavigationMemory(),null);await h.stories.getRingUsers();assert.ok(h.requests.length>before);
  const again=h.requests.length;h.stories.invalidateRings();assert.equal(h.api.storyNavigationMemory(),null);await h.stories.getRingUsers();assert.ok(h.requests.length>again);
});

test('A to B to A clears story metadata, aborts pending transport and cannot repopulate the old cache',async()=>{
  const gate=deferred(),h=fixture({responses:{get_catchup_feed:gate.promise}});
  const pending=h.api.loadStoryNavigation();const rejected=assert.rejects(pending,/cancelled|changed/);await tick();
  h.switchOwner(B);h.switchOwner(A);await rejected;
  assert.equal(h.requests[0].signal.aborted,true);gate.resolve({data:h.users,error:null});await tick();
  assert.equal(h.api.storyNavigationMemory(),null);assert.equal((await h.stories.getRingUsers()).length,0);assert.equal(h.requests.length,1);
});

test('late Auth lookup cannot dispatch a story read after a same-user session round trip',async()=>{
  const gate=deferred(),h=fixture({sessionGate:gate});const pending=h.api.loadStoryNavigation();const rejected=assert.rejects(pending,/cancelled|changed/);await tick();
  h.switchOwner(B);h.switchOwner(A);await rejected;gate.resolve({data:{session:{user:{id:A},access_token:'old'}},error:null});await tick();
  assert.equal(h.requests.length,0);assert.equal(h.api.storyNavigationMemory(),null);
});

test('a hung story refresh reaches its deadline and preserves the prior authorized snapshot for retry',async()=>{
  const h=fixture({deadline:10});const previous=await h.api.loadStoryNavigation();const gate=deferred();h.responses.get_catchup_feed=gate.promise;
  await assert.rejects(h.api.loadStoryNavigation('all',true),/taking longer/);
  assert.equal(h.api.storyNavigationMemory(),previous);assert.equal(h.requests.at(-1).signal.aborted,true);
  gate.resolve({data:[],error:null});await tick();assert.equal(h.api.storyNavigationMemory(),previous);
  delete h.responses.get_catchup_feed;await h.api.loadStoryNavigation('all',true);assert.equal(h.api.storyNavigationMemory().users[0].user_id,B);
});

test('private spotlight hydration uses the initiating JWT, abort signal and no-store media capabilities',async()=>{
  const h=fixture({hot:true});const memory=await h.api.loadStoryNavigation();assert.equal(memory.spot.length,1);
  assert.ok(h.requests.every(row=>row.headers.Authorization==='Bearer captured-A-token'&&row.signal));
  assert.deepEqual(h.verified,['captured-A-token']);assert.equal(h.signed.length,1);
  assert.equal(h.signed[0].opts.headers.Authorization,'Bearer captured-A-token');assert.equal(h.signed[0].opts.body.delivery,'no-store');assert.ok(h.signed[0].opts.signal);
  assert.equal(JSON.stringify(memory).includes('token=valid'),false,'ring metadata never caches story-media capabilities');
});

test('account change during private verification stops the next signing transport',async()=>{
  const gate=deferred(),h=fixture({hot:true,verificationGate:gate});const pending=h.api.loadStoryNavigation();const rejected=assert.rejects(pending,/cancelled|changed/);
  for(let n=0;n<8&&!h.verified.length;n++)await tick();assert.equal(h.verified.length,1);
  h.switchOwner(B);await rejected;gate.resolve({data:{user:{id:A}},error:null});await tick();await tick();
  assert.equal(h.signed.length,0);assert.equal(h.api.storyNavigationMemory(),null);
});

test('malformed or failed catchup reads do not establish a successful empty cache',async()=>{
  for(const result of [{data:null,error:null},{data:[null],error:null},{data:[],error:{message:'Offline'}}]){
    const h=fixture({responses:{get_catchup_feed:result}});await assert.rejects(h.api.loadStoryNavigation(),/could not be refreshed/);assert.equal(h.api.storyNavigationMemory(),null);
  }
});
