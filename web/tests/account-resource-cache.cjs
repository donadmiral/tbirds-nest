const test = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness } = require('./helpers/account-component-harness.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function setup(options) {
  const h = accountHarness();
  const { createAccountResourceCache } = h.load('lib/accountResourceCache.ts');
  const cache = createAccountResourceCache(options);
  cache.setScope('a:session-1');
  return { h, cache };
}

test('bounded memory evicts old entries and oversized values, and refuses expired or reversed clocks', () => {
  let now = 100;
  const { h, cache } = setup({ maxEntries: 2, maxBytes: 100, maxAgeMs: 10, clock: () => now });
  cache.write('a:session-1', 'first', [1]); cache.write('a:session-1', 'second', [2]); cache.write('a:session-1', 'third', [3]);
  assert.equal(cache.read('a:session-1', 'first'), null);
  assert.equal(cache.write('a:session-1', 'second', 'x'.repeat(100)), false);
  assert.equal(cache.read('a:session-1', 'second'), null);
  now = 99; assert.equal(cache.read('a:session-1', 'third'), null);
  now = 110; assert.equal(cache.read('a:session-1', 'third'), null); h.dispose();
});

test('shared requests deduplicate and a confirmed update wins over the older response', async () => {
  const { h, cache } = setup(), held = deferred(); let calls = 0;
  const load = () => { calls++; return held.promise; };
  const first = cache.fetch('a:session-1', 'list', load), second = cache.fetch('a:session-1', 'list', load);
  assert.equal(first, second); await Promise.resolve(); assert.equal(calls, 1);
  cache.write('a:session-1', 'list', ['confirmed']); held.resolve(['old']);
  assert.deepEqual(await first, ['confirmed']); assert.deepEqual(cache.read('a:session-1', 'list').data, ['confirmed']); h.dispose();
});

test('invalidated and old-session completions cannot resurrect discarded content', async () => {
  const { h, cache } = setup(), held = deferred();
  const first = cache.fetch('a:session-1', 'list', () => held.promise); await Promise.resolve();
  cache.remove('a:session-1', 'list'); held.resolve(['revoked']); await assert.rejects(first, /information changed/);
  const later = deferred(), work = cache.fetch('a:session-1', 'list', () => later.promise); await Promise.resolve();
  cache.setScope('b:session-2'); cache.setScope('a:session-3'); later.resolve(['old login']);
  await assert.rejects(work, /account changed/); assert.equal(cache.read('a:session-3', 'list'), null); h.dispose();
});

test('a session change before the request starts avoids calling its loader', async () => {
  const { h, cache } = setup(); let calls = 0;
  const work = cache.fetch('a:session-1', 'list', async () => { calls++; return []; });
  cache.setScope(null); await assert.rejects(work, /account changed/); assert.equal(calls, 0); h.dispose();
});

test('a warm route remount paints its session value before identity or network revalidation', async () => {
  const h = accountHarness(), held = deferred(); let state, reads = 0;
  const load = () => ++reads === 1 ? Promise.resolve(['visible']) : held.promise;
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  const screen = () => { state = useAccountResource(load, [], { cacheKey: 'list' }); return null; };
  h.mount(screen); await h.flush(); const original = state.data;
  h.unmount(); h.mount(screen);
  assert.equal(state.data, original); assert.equal(state.loading, false); assert.equal(state.refreshing, true);
  await h.flush(); assert.equal(reads, 2); held.reject(Error('Offline')); await h.flush();
  assert.equal(state.data, original); assert.equal(state.error, ''); assert.equal(state.refreshError, 'Offline'); h.dispose();
});

test('warm cache clears for denial and for account changes including an earlier account returning', async () => {
  const h = accountHarness(); let state, denied = false;
  const load = async (_client, owner) => { if (denied) throw { status: 403 }; return [owner]; };
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  const screen = () => { state = useAccountResource(load, [], { cacheKey: 'list' }); return null; };
  h.mount(screen); await h.flush();
  denied = true; state.reload(); h.render(); await h.flush(); assert.equal(state.data.length, 0); assert.ok(state.error);
  h.unmount(); h.mount(screen); assert.equal(state.data.length, 0); await h.flush();
  denied = false; h.auth('account-b'); assert.equal(state.data.length, 0); await h.flush(); assert.equal(state.data[0], 'account-b');
  h.auth('account-a'); assert.equal(state.data.length, 0); await h.flush(); assert.equal(state.data[0], 'account-a'); h.dispose();
});

test('confirmed edits update warm-route memory and cannot be replaced by pending reads', async () => {
  const h = accountHarness(), held = deferred(); let state, reads = 0;
  const load = () => ++reads === 1 ? Promise.resolve(['visible']) : held.promise;
  const { useAccountResource } = h.load('lib/useAccountResource.ts');
  const screen = () => { state = useAccountResource(load, [], { cacheKey: 'list' }); return null; };
  h.mount(screen); await h.flush(); state.reload(); h.render(); await h.flush();
  state.setData(['confirmed']); h.render(); held.resolve(['stale']); await h.flush();
  assert.equal(state.data[0], 'confirmed'); h.unmount(); h.mount(screen); assert.equal(state.data[0], 'confirmed'); h.dispose();
});

test('distinct resource keys cannot display each others cached rows', async () => {
  const h = accountHarness(); let state, key = 'first';
  const load = async () => [key]; const { useAccountResource } = h.load('lib/useAccountResource.ts');
  h.mount(() => { state = useAccountResource(load, [], { cacheKey: key }); return null; }); await h.flush();
  key = 'second'; h.render(); assert.equal(state.data.length, 0); await h.flush(); assert.equal(state.data[0], 'second');
  key = 'first'; h.render(); assert.equal(state.data[0], 'first'); h.dispose();
});
