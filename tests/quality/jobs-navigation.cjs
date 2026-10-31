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
