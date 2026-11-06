const test = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness } = require('./helpers/account-component-harness.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('account resources hide old identity data immediately and reject stale A-to-B-to-A completions', async () => {
  const h = accountHarness(), first = deferred(), requests = []; let state;
  const load = async (_client, owner) => { requests.push(owner); return requests.length === 1 ? first.promise : [owner + '-' + requests.length]; };
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  h.mount(() => { state = useAccountResource(load, []); return null; }); await h.flush();
  h.auth('account-b'); assert.equal(state.loading, true); assert.equal(state.data.length, 0); await h.flush();
  assert.equal(state.data[0], 'account-b-2'); h.auth('account-a'); assert.equal(state.data.length, 0); await h.flush();
  assert.equal(state.data[0], 'account-a-3'); first.resolve(['old account-a response']); await h.flush();
  assert.equal(state.data[0], 'account-a-3'); assert.deepEqual(requests, ['account-a', 'account-b', 'account-a']); h.dispose();
});

test('resource deadlines expose retry and a late response cannot replace the retried result', async () => {
  const h = accountHarness(), held = deferred(); let calls = 0, state;
  const load = () => ++calls === 1 ? held.promise : Promise.resolve(['recovered']);
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  h.mount(() => { state = useAccountResource(load, []); return null; }); await h.flush(); h.expire(); await h.flush();
  assert.match(state.error, /Timed out/); assert.equal(state.loading, false); state.retry(); h.render(); await h.flush();
  assert.equal(state.data[0], 'recovered'); held.resolve(['late']); await h.flush(); assert.equal(state.data[0], 'recovered'); h.dispose();
});

test('old mutations cannot update a later login even when the account ID is the same again', async () => {
  const h = accountHarness(), identity = deferred(); let state;
  const load = async () => ['fresh']; const { useAccountResource } = h.load('lib/useAccountResource.ts');
  h.mount(() => { state = useAccountResource(load, []); return null; }); await h.flush();
  const oldSetData = state.setData; h.userRead = () => identity.promise; const check = state.assertOwner();
  h.auth('account-b'); await h.flush(); h.auth('account-a'); await h.flush(); oldSetData(['stale']); h.render();
  identity.resolve({ data: { user: { id: 'account-a' } }, error: null }); await assert.rejects(check, /account changed/);
  assert.equal(state.data[0], 'fresh'); h.dispose();
});

test('token refresh keeps the current account resource without a reload or loading flash', async () => {
  const h = accountHarness(); let calls = 0, state; const load = async () => [++calls];
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  h.mount(() => { state = useAccountResource(load, []); return null; }); await h.flush();
  h.auth('account-a', 'TOKEN_REFRESHED'); assert.equal(state.loading, false); await h.flush(); assert.equal(calls, 1); h.dispose();
});

test('same-scope refresh keeps the exact visible value while pending and reconciles a confirmed empty result', async () => {
  const h = accountHarness(), held = deferred(); let state, reads = 0;
  const load = () => ++reads === 1 ? Promise.resolve(['visible']) : held.promise;
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  h.mount(() => { state = useAccountResource(load, []); return null; }); await h.flush();
  const original = state.data;
  state.reload(); h.render();
  assert.equal(state.data, original); assert.equal(state.loading, false); assert.equal(state.refreshing, true);
  await h.flush(); held.resolve([]); await h.flush();
  assert.equal(state.data.length, 0); assert.equal(state.refreshing, false); assert.equal(state.error, ''); h.dispose();
});

test('transient refresh failure retains rows, exposes nonblocking retry and recovers without a loading flash', async () => {
  const h = accountHarness(); let state, reads = 0;
  const load = async () => { if (++reads === 2) throw Error('Offline'); return [reads]; };
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  h.mount(() => { state = useAccountResource(load, []); return null; }); await h.flush();
  state.reload(); h.render(); await h.flush();
  assert.equal(state.data[0], 1); assert.equal(state.error, ''); assert.equal(state.refreshError, 'Offline'); assert.equal(state.loading, false);
  state.retry(); h.render(); assert.equal(state.data[0], 1); assert.equal(state.refreshing, true);
  await h.flush(); assert.equal(state.data[0], 3); assert.equal(state.refreshError, ''); h.dispose();
});

test('explicit authorization refusals and ambiguous private-media failures clear previously visible values', async () => {
  for (const failure of [{ status: 401 }, { statusCode: 403 }, { context: { status: 403 } }, { code: '42501' }, { code: 'PGRST301' }, Error('Permission denied'), Error('AUTH_REQUIRED'), Error('ACCESS_DENIED'), Error('UNAUTHORIZED'), Error('FORBIDDEN'), Error('Media could not be loaded. Please try again.')]) {
    const h = accountHarness(); let state, fail = false;
    const load = async () => { if (fail) throw failure; return ['private']; };
    const { useAccountResource } = h.load('lib/useAccountResource.ts');
    h.mount(() => { state = useAccountResource(load, []); return null; }); await h.flush();
    fail = true; state.reload(); h.render(); await h.flush();
    assert.equal(state.data.length, 0); assert.ok(state.error); assert.equal(state.refreshError, ''); h.dispose();
  }
});

test('filter identity clears immediately and stale reloads cannot replace the new query', async () => {
  const h = accountHarness(), held = deferred(); let state, active, reads = 0;
  const first = () => ++reads === 1 ? Promise.resolve(['first']) : held.promise;
  const second = async () => ['second']; active = first;
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  h.mount(() => { state = useAccountResource(active, []); return null; }); await h.flush();
  state.reload(); h.render(); await h.flush(); active = second; h.render();
  assert.equal(state.data.length, 0); assert.equal(state.loading, true);
  await h.flush(); held.resolve(['obsolete first']); await h.flush();
  assert.equal(state.data[0], 'second'); h.dispose();
});

test('a confirmed local update during refresh wins over its older network snapshot', async () => {
  const h = accountHarness(), held = deferred(); let state, reads = 0;
  const load = () => ++reads === 1 ? Promise.resolve(['visible']) : held.promise;
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  h.mount(() => { state = useAccountResource(load, []); return null; }); await h.flush();
  const oldSetData = state.setData;
  state.reload(); h.render(); await h.flush(); oldSetData(['obsolete callback']); h.render();
  assert.equal(state.data[0], 'visible');
  state.setData(['confirmed update']); h.render();
  held.resolve(['stale network']); await h.flush();
  assert.equal(state.data[0], 'confirmed update'); assert.equal(state.refreshing, false); h.dispose();
});

test('queued state updates recheck scope when React applies them', async () => {
  const h = accountHarness(), original = h.hooks.useState, queued = []; let defer = false, state;
  h.hooks.useState = initial => {
    const [value, set] = original(initial);
    return [value, update => { if (defer && typeof update === 'function') queued.push(() => set(update)); else set(update); }];
  };
  const load = async (_client, owner) => [owner];
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  h.mount(() => { state = useAccountResource(load, []); return null; }); await h.flush();
  defer = true; state.setData(['queued account-a']); defer = false;
  h.auth('account-b'); await h.flush();
  queued.forEach(apply => apply()); h.render();
  assert.equal(state.data[0], 'account-b'); h.dispose();
});
