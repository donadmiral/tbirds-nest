const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function load(file, dependencies) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Map, Set, Date, Promise, Number, Error, AbortController, setTimeout, clearTimeout,
    require(name) { assert.ok(name in dependencies, 'Unexpected dependency ' + name); return dependencies[name]; } });
  return module.exports;
}
function fixture() {
  const cache = load('shared/navigationCache.ts', {}).createNavigationCache();
  cache.setScope('A:session-1');
  let session = { user: { id: 'A' }, access_token: 'token-A-1' };
  const listeners = new Set(), calls = [], badges = [];
  const supabase = { rpc(name) {
    const work = deferred(), call = { name, headers: {}, signal: null, ...work }; calls.push(call);
    const query = { setHeader(key, value) { call.headers[key] = value; return query; },
      abortSignal(signal) { call.signal = signal; return query; }, then(resolve, reject) { return work.promise.then(resolve, reject); } };
    return query;
  } };
  const { useUnreadStore: store } = load('src/stores/unreadStore.ts', {
    zustand: require('zustand'), '../services/supabase': { supabase },
    'expo-notifications': { setBadgeCountAsync: async count => { badges.push(count); return true; } },
    './authStore': { useAuthStore: { getState: () => ({ session }) } },
    '../lib/navigationCache': { navigationCache: cache, navigationScope: cache.scope,
      subscribeNavigationScope(listener) { listeners.add(listener); return () => listeners.delete(listener); } },
  });
  return { store, calls, badges, change(scope, owner = null) {
    session = owner ? { user: { id: owner }, access_token: 'token-' + scope } : null;
    cache.setScope(scope); listeners.forEach(listener => listener());
  } };
}
const counts = (personal = 3) => ({ personal, groups: 2, market: 1, jobs: 4 });

test('simultaneous tab refreshes share one authenticated request and one complete unread result', async () => {
  const h = fixture(), a = h.store.getState().refresh(), b = h.store.getState().refresh();
  assert.equal(a, b); await turn(); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].headers.Authorization, 'Bearer token-A-1');
  h.calls[0].resolve({ data: counts(), error: null }); await a; await turn();
  assert.equal(h.store.getState().counts.personal, 3); assert.equal(h.store.getState().counts.jobs, 4);
  assert.deepEqual(h.badges, [5]);
});

test('offline and malformed unread responses preserve the previous counts and icon badge', async () => {
  const h = fixture(); const first = h.store.getState().refresh(); await turn(); h.calls[0].resolve({ data: counts(), error: null }); await first; await turn();
  for (const response of [{ data: null, error: Error('Offline') }, { data: { personal: 0 }, error: null }, { data: { ...counts(), groups: -1 }, error: null }]) {
    const next = h.store.getState().refresh(); await turn(); h.calls.at(-1).resolve(response); await next; await turn();
    assert.equal(h.store.getState().counts.personal, 3); assert.equal(h.store.getState().loading, false);
  }
  assert.deepEqual(h.badges, [5]);
});

test('logout aborts old unread work and a late response cannot restore another account counts', async () => {
  const h = fixture(); const work = h.store.getState().refresh(); await turn(); const old = h.calls[0];
  h.change(null); old.resolve({ data: counts(95), error: null }); await work; await turn();
  assert.equal(old.signal.aborted, true); assert.equal(h.store.getState().counts.personal, 0); assert.equal(h.store.getState().loading, false);
  assert.deepEqual(h.badges, [0]);
});

test('an A to B to A session round trip rejects the original A response', async () => {
  const h = fixture(); const old = h.store.getState().refresh(); await turn();
  h.change('B:session-2', 'B'); h.change('A:session-3', 'A');
  const current = h.store.getState().refresh(); await turn();
  h.calls[1].resolve({ data: counts(1), error: null }); await current;
  h.calls[0].resolve({ data: counts(70), error: null }); await old; await turn();
  assert.equal(h.calls[1].headers.Authorization, 'Bearer token-A:session-3');
  assert.equal(h.store.getState().counts.personal, 1); assert.equal(h.badges.at(-1), 3);
});

test('signed-out refreshes cannot issue an authenticated unread request', async () => {
  const h = fixture(); h.change(null); await h.store.getState().refresh(); await turn();
  assert.equal(h.calls.length, 0); assert.equal(h.store.getState().counts.personal, 0);
});
