const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function loadCallback(name, context) {
  const source = ts.createSourceFile('JobsScreen.tsx', fs.readFileSync(path.join(root, 'src/screens/jobs/JobsScreen.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      callback = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(callback, 'Expected the real screen callback');
  const module = { exports: {} };
  vm.runInNewContext(compile('module.exports = ' + callback.getText(source)), { module, ...context, console, Set, Map, Error, Promise });
  return module.exports;
}
function loadFunction(name) {
 const source=ts.createSourceFile('JobsScreen.tsx',fs.readFileSync(path.join(root,'src/screens/jobs/JobsScreen.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration;
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.getText(source)===name)declaration=node.getText(source);ts.forEachChild(node,visit);}visit(source);assert.ok(declaration);
 const module={exports:{}};vm.runInNewContext(compile(declaration+';module.exports='+name),{module,console});return module.exports;
}
function beforePaint(context) {
 const source=ts.createSourceFile('JobsScreen.tsx',fs.readFileSync(path.join(root,'src/screens/jobs/JobsScreen.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration;
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='useLayoutEffect')declaration=node.arguments[0].getText(source);ts.forEachChild(node,visit);}visit(source);assert.ok(declaration);
 const module={exports:{}};vm.runInNewContext(compile('module.exports='+declaration),{module,...context});return module.exports();
}
function initialState(cache,scope) {
 const source=ts.createSourceFile('JobsScreen.tsx',fs.readFileSync(path.join(root,'src/screens/jobs/JobsScreen.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const names=['[initialJobs]','[jobs, setJobs]','[posterLogos, setPosterLogos]','[myApplications, setMyApplications]','[savedIds, setSavedIds]','[appliedMap, setAppliedMap]','[loading, setLoading]'];const declarations=[];
 function visit(node){if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(source)))declarations.push('const '+node.getText(source)+';');ts.forEachChild(node,visit);}visit(source);assert.equal(declarations.length,names.length);
 const module={exports:{}};vm.runInNewContext(compile(declarations.join('\n')+'\nmodule.exports={jobs,posterLogos,myApplications,savedIds,appliedMap,loading}'),{module,navigationScope:()=>scope,navigationCache:cache,posterLogosFor:loadFunction('posterLogosFor'),Set,useState:value=>[typeof value==='function'?value():value,()=>{}]});return module.exports;
}
function fixture() {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'shared/navigationCache.ts'), 'utf8')), {
    module, exports: module.exports, Map, Set, Date, Promise, AbortController, Error, setTimeout, clearTimeout,
  });
  const cache = module.exports.createNavigationCache(); cache.setScope('account-A:session-1');
  let scope = cache.scope();
  const state = { jobs: [], saved: new Set(), applied: {}, apps: [], loading: true, refreshing: false, error: null };
  const reads = [];
  const set = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const jobsService = {
    getJobs: async options => { reads.push(options); return [{ id: 'job-1', posted_by: 'recruiter', title: 'Designer' }]; },
    getSavedJobIds: async (_id, options) => { reads.push(options); return []; },
    getAppliedJobIds: async (_id, options) => { reads.push(options); return {}; },
    getMyApplications: async (_id, options) => { reads.push(options); return []; },
  };
  const context = { userId: 'account-A', scopeMode: 'all', sortBy: 'recent', jobsService, navigationCache: cache,
    navigationScope: () => scope, useAuthStore: { getState: () => ({ session: { user: { id: 'account-A' }, access_token: 'original-session-token' } }) },
    loadGeneration: { current: 0 }, loadedListKey: { current: null }, pendingSaves: { current: new Set() },
    setJobs: set('jobs'), setSavedIds: set('saved'), setAppliedMap: set('applied'), setMyApplications: set('apps'),
    setLoading: set('loading'), setRefreshing: set('refreshing'), setLoadError: set('error'), setPosterLogos: set('logos'),
  };
  context.posterLogosFor = loadFunction('posterLogosFor');
  context.publishJobs = loadCallback('publishJobs', context);
  return { state, reads, context, jobsService, load: loadCallback('loadAll', context), switchAccount() { scope = 'account-B:session-2'; cache.setScope(scope); } };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('a warm Jobs return preserves the mounted list while all reads refresh with one pinned session and cancellation signal', async () => {
  const h = fixture(); await h.load();
  assert.equal(h.state.loading, false); assert.equal(h.state.jobs[0].title, 'Designer');
  const next = deferred(); h.jobsService.getJobs = options => { h.reads.push(options); return next.promise; };
  const work = h.load(true); await Promise.resolve();
  assert.equal(h.state.loading, false); assert.equal(h.state.jobs[0].title, 'Designer');
  next.resolve([{ id: 'job-2', title: 'Engineer' }]); await work;
  assert.equal(h.state.jobs[0].title, 'Engineer');
  assert.ok(h.reads.every(options => options.accessToken === 'original-session-token' && options.signal instanceof AbortSignal));
  assert.ok(h.reads.slice(4).every(options => options.signal === h.reads[4].signal));
});

test('a loaded empty Jobs list also stays ready on a warm return', async () => {
  const h = fixture(); h.jobsService.getJobs = async () => []; await h.load();
  const next = deferred(); h.jobsService.getJobs = () => next.promise;
  const work = h.load(); assert.equal(h.state.loading, false); assert.equal(h.state.jobs.length, 0);
  next.resolve([]); await work;
});

test('a failed background refresh keeps the previous Jobs list and exposes its error', async () => {
  const h = fixture(); await h.load();
  h.jobsService.getJobs = async () => { throw Error('Offline'); };
  await h.load(); assert.equal(h.state.jobs[0].title, 'Designer'); assert.equal(h.state.error, 'Offline'); assert.equal(h.state.loading, false);
});

test('an account switch aborts the original Jobs reads and prevents a late response from changing the screen', async () => {
  const h = fixture(); await h.load(); const next = deferred();
  h.jobsService.getJobs = options => { h.reads.push(options); return next.promise; };
  const work = h.load(); await Promise.resolve(); const signal = h.reads[4].signal;
  h.switchAccount(); next.resolve([{ id: 'private-old-job', title: 'Stale account data' }]); await work;
  assert.equal(signal.aborted, true); assert.equal(h.state.jobs[0].title, 'Designer');
});

test('refreshing the Jobs list does not overwrite an optimistic save still being confirmed', async () => {
  const h = fixture(); await h.load(); h.state.saved.add('job-1'); h.context.pendingSaves.current.add('job-1');
  await h.load(); assert.equal(h.state.saved.has('job-1'), true);
});

test('the Jobs first render consumes the current session snapshot before any effects run',()=>{
 const h=fixture(),snapshot=[[{id:'cached',posted_by:'recruiter',title:'Retained job',profile:{avatar_url:'logo.png'}}],['cached'],{cached:'applied'},[{id:'application'}]];
 h.context.navigationCache.save(h.context.navigationScope(),'jobs:all:recent',snapshot);
 const first=initialState(h.context.navigationCache,h.context.navigationScope());
 assert.equal(first.loading,false);assert.equal(first.jobs,snapshot[0]);assert.equal(first.posterLogos.recruiter,'logo.png');assert.equal(first.savedIds.has('cached'),true);assert.equal(first.appliedMap.cached,'applied');assert.equal(first.myApplications,snapshot[3]);assert.equal(h.reads.length,0);
 h.switchAccount();const changed=initialState(h.context.navigationCache,h.context.navigationScope());assert.equal(changed.loading,true);assert.equal(changed.jobs.length,0);assert.equal(changed.savedIds.size,0);
});
test('revisiting a loaded Jobs filter restores its rows before paint while its fresh read is pending',async()=>{
 const h=fixture();await h.load();const loaded=h.state.jobs;const gate=deferred();
 h.context.loadedListKey.current='jobs:global:salary';h.state.jobs=[{id:'other-filter'}];h.state.loading=true;
 beforePaint(h.context);assert.equal(h.state.jobs,loaded);assert.equal(h.state.loading,false);assert.equal(h.context.loadedListKey.current,'jobs:all:recent');
 h.jobsService.getJobs=()=>gate.promise;const read=h.load();assert.equal(h.state.jobs,loaded);assert.equal(h.state.loading,false);
 gate.resolve([{id:'updated'}]);await read;assert.equal(h.state.jobs[0].id,'updated');
});
test('an uncached Jobs selection does not relabel old rows after its read fails',async()=>{
 const h=fixture();await h.load();h.context.scopeMode='global';h.context.sortBy='salary';beforePaint(h.context);
 assert.equal(h.state.jobs.length,0);assert.equal(h.state.loading,true);assert.equal(h.context.loadedListKey.current,null);
 h.jobsService.getJobs=async()=>{throw Error('Offline')};await loadCallback('loadAll',h.context)();
 assert.equal(h.state.loading,false);assert.equal(h.state.jobs.length,0);assert.equal(h.state.error,'Offline');
});
test('restoring a filter invalidates its outgoing refresh before that response can publish',async()=>{
 const h=fixture();await h.load();const gate=deferred();h.jobsService.getJobs=()=>gate.promise;const old=h.load();await Promise.resolve();
 h.context.scopeMode='global';beforePaint(h.context);gate.resolve([{id:'wrong-filter'}]);await old;
 assert.equal(h.state.jobs.length,0);assert.equal(h.state.loading,true);
});
