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
