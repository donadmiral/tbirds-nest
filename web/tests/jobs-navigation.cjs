const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..'),compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function loader(responses={}){
 let current={owner:'A',scope:'1:A',revision:1,initialized:true};const reads=[],writes=[],errors=[],loading=[],saved=[];
 const client={auth:{getSession:async()=>({data:{session:{user:{id:responses.user??'A'},access_token:'token-A'}},error:null})},from(table){const row={table,headers:{},filters:[]};const q={select(cols){row.cols=cols;return q;},setHeader(name,value){row.headers[name]=value;return q;},abortSignal(signal){row.signal=signal;return q;},then(ok,bad){reads.push(row);return Promise.resolve(responses[table]??{data:table==='jobs'?[{id:'fresh',title:'Design'}]:table==='job_saves'?[]:{location:'Cape Town, South Africa'},error:null}).then(ok,bad);}};for(const method of ['or','order','limit','eq','maybeSingle'])q[method]=(...args)=>{row.filters.push([method,...args]);return q;};return q;}};
 const scope={AbortController,Map,Set,Date,supabase:client,session:current,navigationStore:{getSnapshot:()=>current},generation:{current:0},request:{current:null},pending:{current:null},saveRevision:{current:0},savedChanges:{current:new Map()},useCallback:fn=>fn,withTimeout:work=>Promise.resolve(work),setLoading:value=>loading.push(value),setError:value=>errors.push(value),setViewerId(){},setJobs:rows=>writes.push(rows),setSavedIds:ids=>saved.push([...ids]),setMyCity(){},setLoaded(){}};
 const source=fs.readFileSync(path.join(root,'web/app/jobs/page.tsx'),'utf8'),start=source.indexOf('  const load = useCallback'),end=source.indexOf('\n  useEffect(',start);assert.ok(start>=0&&end>start);vm.runInNewContext(compile(source.slice(start,end)+'\nthis.load=load;'),scope);
 return{scope,reads,writes,errors,loading,saved,change(owner){current={owner,scope:`${current.revision+1}:${owner}`,revision:current.revision+1,initialized:true};}};
}
test('real Jobs loader coalesces concurrent refreshes and pins all three independent reads without unused poster enrichment',async()=>{
 const gate=defer(),h=loader({jobs:gate.promise});const a=h.scope.load(),b=h.scope.load();assert.equal(a,b);await tick();assert.equal(h.reads.length,3);assert.ok(h.reads.every(row=>row.headers.Authorization==='Bearer token-A'&&row.signal instanceof AbortSignal));gate.resolve({data:[{id:'fresh'}],error:null});await a;assert.equal(h.writes[0][0].id,'fresh');assert.equal(h.reads.filter(row=>row.table==='profiles').length,1);assert.equal(h.reads.find(row=>row.table==='profiles').cols,'location');
});
test('a confirmed save during a held older read survives its completion',async()=>{
 const gate=defer(),h=loader({job_saves:gate.promise});const work=h.scope.load();await tick();h.scope.saveRevision.current=1;h.scope.savedChanges.current.set('new-save',{revision:1,saved:true});gate.resolve({data:[{job_id:'old-save'}],error:null});await work;assert.deepEqual(h.saved.at(-1).sort(),['new-save','old-save']);
});
test('a confirmed unsave during a held older read is not resurrected',async()=>{
 const gate=defer(),h=loader({job_saves:gate.promise});const work=h.scope.load();await tick();h.scope.saveRevision.current=1;h.scope.savedChanges.current.set('removed',{revision:1,saved:false});gate.resolve({data:[{job_id:'removed'}],error:null});await work;assert.deepEqual(h.saved.at(-1),[]);
});
test('A to B to A suppresses stale jobs and saved results even if the transport ignores cancellation',async()=>{
 const gate=defer(),h=loader({jobs:gate.promise});const work=h.scope.load();await tick();h.change('B');h.change('A');gate.resolve({data:[{id:'old-account'}],error:null});await work;assert.equal(h.writes.length,0);assert.equal(h.saved.length,0);
});
test('a changed session cannot dispatch queries under the previous owner',async()=>{
 const h=loader({user:'B'});await h.scope.load();assert.equal(h.reads.length,0);assert.match(h.errors.at(-1),/could not be loaded/);assert.equal(h.loading.at(-1),false);
});
test('refresh failures preserve existing rows, expose retry, and abort remaining transport',async()=>{
 const h=loader({jobs:{data:null,error:Error('offline')}});await h.scope.load();assert.equal(h.writes.length,0);assert.match(h.errors.at(-1),/try again/);assert.equal(h.loading.at(-1),false);assert.ok(h.reads.every(read=>read.signal.aborted));
});
test('off-route saves update only the captured account/session while retaining filters and loaded rows',()=>{
 let snapshot={owner:'A',scope:'1:A'},memory={jobs:[{id:'job'}],loaded:true,savedIds:[],search:'design',scope:'global',category:'freelance',sort:'salary',myCity:'Cape Town',scrollTop:650};
 const store={getSnapshot:()=>snapshot,cache:{read:scope=>scope===snapshot.scope?memory:null,save:(scope,key,value)=>{assert.equal(scope,snapshot.scope);assert.equal(key,'jobs:discover');memory=value;}}};const module={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.join(root,'web/lib/jobsNavigation.ts'),'utf8')),{module,exports:module.exports,Set,require:()=>({getNavigationStore:()=>store})});
 const api=module.exports;api.rememberJobSave('A','1:A','job',true);assert.deepEqual([...memory.savedIds],['job']);assert.equal(memory.search,'design');assert.equal(memory.scrollTop,650);assert.equal(memory.jobs[0].id,'job');
 snapshot={owner:'B',scope:'2:B'};api.rememberJobSave('A','1:A','wrong',true);snapshot={owner:'A',scope:'3:A'};api.rememberJobSave('A','1:A','late',true);assert.deepEqual([...memory.savedIds],['job']);api.rememberJobSave('A','3:A','job',false);assert.deepEqual([...memory.savedIds],[]);
});
test('actual Jobs layout cleanup cannot overwrite a save confirmed just before navigation',()=>{
 const source=fs.readFileSync(path.join(root,'web/app/jobs/page.tsx'),'utf8'),start=source.indexOf('  useLayoutEffect(() => {\n    navigationStore.cache.save'),end=source.indexOf('\n  const savedChanged',start);assert.ok(start>=0&&end>start);
 let memory,cleanup;const scope={JOBS_NAVIGATION_KEY:'jobs:discover',session:{scope:'1:A'},navigationStore:{cache:{save:(_scope,_key,value)=>{memory=value;},read:()=>memory}},jobs:[{id:'job'}],loaded:true,savedIds:new Set(),myCity:'Cape Town',scope:'global',category:'freelance',sort:'salary',search:'design',lastScroll:{current:650},useLayoutEffect:fn=>{cleanup=fn();}};
 vm.runInNewContext(compile(source.slice(start,end)),scope);memory={...memory,savedIds:['confirmed-after-render']};cleanup();assert.equal(memory.savedIds[0],'confirmed-after-render');assert.equal(memory.search,'design');assert.equal(memory.scrollTop,650);
});
test('a later same-value confirmation advances the real callback revision and overrides an intervening false read without allocating another Set',async()=>{
 const gate=defer(),h=loader({job_saves:gate.promise});let selected=new Set(['same']);const original=selected;
 h.scope.saveRevision.current=1;h.scope.savedChanges.current.set('same',{revision:1,saved:true});h.scope.setSavedIds=next=>{selected=typeof next==='function'?next(selected):next;};
 const work=h.scope.load();await tick();const source=fs.readFileSync(path.join(root,'web/app/jobs/page.tsx'),'utf8'),start=source.indexOf('  const savedChanged = useCallback'),end=source.indexOf('\n  useEffect(',start);assert.ok(start>=0&&end>start);vm.runInNewContext(compile(source.slice(start,end)+'\nthis.savedChanged=savedChanged;'),h.scope);
 h.scope.savedChanged('same',true);assert.equal(h.scope.saveRevision.current,2);assert.equal(selected,original);gate.resolve({data:[],error:null});await work;assert.equal(selected.has('same'),true);
});

function saveFixture({authGate,writeGate,deadline}={}){
 let navigation={owner:'A',scope:'1:A',revision:1,initialized:true,changed:false},accessToken='A-session-1',mounted=true;
 let memory={jobs:[{id:'job'}],loaded:true,savedIds:[],search:'design',scope:'global',category:'freelance',sort:'salary',myCity:'Cape Town',scrollTop:650};
 const observers=new Set(),requests=[],events=[];
 const store={getSnapshot:()=>navigation,cache:{read:()=>memory,save:(_scope,_key,value)=>{memory=value;}}};
 const session=()=>({user:{id:navigation.owner},access_token:accessToken});
 const client={auth:{getSession:()=>authGate?.promise??Promise.resolve({data:{session:session()},error:null}),onAuthStateChange:fn=>{observers.add(fn);return{data:{subscription:{unsubscribe:()=>observers.delete(fn)}}};}},from(table){const request={table,headers:{},filters:[]};const q={insert(value){request.values=value;request.operation='insert';return q;},delete(){request.operation='delete';return q;},eq(...args){request.filters.push(args);return q;},setHeader(name,value){request.headers[name]=value;return q;},abortSignal(signal){request.signal=signal;return q;},then(resolve,reject){requests.push(request);return(writeGate?.promise??Promise.resolve({error:null})).then(resolve,reject);}};return q;}};
 const bound=async work=>{if(!deadline)return Promise.resolve(work);let timer;try{return await Promise.race([Promise.resolve(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('deadline')),deadline);})]);}finally{clearTimeout(timer);}};
 const module={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.join(root,'web/lib/jobsNavigation.ts'),'utf8')),{module,exports:module.exports,AbortController,Set,window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},require:name=>name==='./navigationCache'?{getNavigationStore:()=>store}:name==='./withTimeout'?{withTimeout:bound}:(()=>{throw Error(name);})()});
 const change=(owner,token)=>{navigation={owner,scope:`${navigation.revision+1}:${owner}`,revision:navigation.revision+1,initialized:true,changed:true};accessToken=token;for(const observer of observers)observer('SIGNED_IN',session());};
 return{run:()=>module.exports.saveJobForSession(client,'A','job',true,()=>mounted),requests,events,observers,get memory(){return memory;},unmount(){mounted=false;},change,refresh(){accessToken='A-session-1-refreshed';for(const observer of observers)observer('TOKEN_REFRESHED',session());}};
}
test('auth-queued A to B to A save cannot dispatch with the new A session bearer',async()=>{
 const gate=defer(),h=saveFixture({authGate:gate});const work=h.run();h.change('B','B-session');h.change('A','A-session-2');gate.resolve({data:{session:{user:{id:'A'},access_token:'A-session-2'}},error:null});await assert.rejects(work,/session changed/);assert.equal(h.requests.length,0);assert.equal(h.events.length,0);assert.equal(h.observers.size,0);
});
test('leaving while authentication is queued prevents a not-yet-dispatched save',async()=>{
 const gate=defer(),h=saveFixture({authGate:gate});const work=h.run();h.unmount();gate.resolve({data:{session:{user:{id:'A'},access_token:'A-session-1'}},error:null});await assert.rejects(work,/session changed/);assert.equal(h.requests.length,0);assert.equal(h.observers.size,0);
});
test('an already-dispatched save keeps its captured bearer and confirms after same-session navigation and token refresh',async()=>{
 const gate=defer(),h=saveFixture({writeGate:gate});const work=h.run();await tick();assert.equal(h.requests.length,1);assert.equal(h.requests[0].headers.Authorization,'Bearer A-session-1');h.unmount();h.refresh();assert.equal(h.requests[0].signal.aborted,false);gate.resolve({error:null});await work;assert.deepEqual([...h.memory.savedIds],['job']);assert.equal(h.events.length,1);assert.equal(h.events[0].detail.scope,'1:A');assert.equal(h.observers.size,0);
});
test('a same-owner new login aborts an old dispatched save and suppresses a late success acknowledgement',async()=>{
 const gate=defer(),h=saveFixture({writeGate:gate});const work=h.run();await tick();h.change('A','A-session-2');assert.equal(h.requests[0].signal.aborted,true);gate.resolve({error:null});await assert.rejects(work,/session changed/);assert.equal(h.events.length,0);assert.deepEqual([...h.memory.savedIds],[]);
});
test('a dispatched A to B to A save cannot publish into the new session even if abort is ignored',async()=>{
 const gate=defer(),h=saveFixture({writeGate:gate});const work=h.run();await tick();h.change('B','B-session');h.change('A','A-session-2');assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.requests[0].headers.Authorization,'Bearer A-session-1');gate.resolve({error:null});await assert.rejects(work,/session changed/);assert.equal(h.events.length,0);assert.deepEqual([...h.memory.savedIds],[]);
});
test('an unconfirmed save is bounded, cancels transport and removes its auth observer without automatic retry',async()=>{
 const gate=defer(),h=saveFixture({writeGate:gate,deadline:10});await assert.rejects(h.run(),/deadline/);assert.equal(h.requests.length,1);assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.observers.size,0);assert.equal(h.events.length,0);
});
