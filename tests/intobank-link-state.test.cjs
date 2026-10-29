const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIntoBankLinkState, intoBankLinkCacheKey } = require('../src/services/intoBankLinkState.ts');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup({ ownerId = 'account-a', entries = [], getItem, setItem } = {}) {
  const data = new Map(entries), states = [], requests = [], keys = [], writes = [];
  let currentOwner = ownerId;
  const controller = createIntoBankLinkState({
    ownerId, isCurrentOwner: () => currentOwner === ownerId,
    storage: {
      getItem: async key => { keys.push(key); return getItem ? getItem(key) : data.get(key) ?? null; },
      setItem: async (key, value) => { writes.push([key, value]); if (setItem) await setItem(key, value); data.set(key, value); },
    },
    readStatus: async id => { const request = deferred(); requests.push({ ...request, ownerId: id }); return request.promise; },
    onState: state => states.push(state),
  });
  return { controller, data, states, requests, keys, writes, switchOwner: id => { currentOwner = id; } };
}

test('legacy global cache and another account never supply the current account status', async () => {
  const h = setup({ entries: [['pc.ib.linked', '1'], [intoBankLinkCacheKey('account-b'), '1']] });
  const work = h.controller.refresh();
  h.requests[0].reject(new Error('Service unavailable')); await work; await flush();
  assert.deepEqual(h.keys, [intoBankLinkCacheKey('account-a')]);
  assert.deepEqual(h.states.at(-1), { linked: null, issue: 'Service unavailable' });
  assert.equal(h.requests[0].ownerId, 'account-a');
});

test('an outage retains only this account last-known state and the error', async () => {
  const cached = deferred();
  const h = setup({ getItem: () => cached.promise });
  const work = h.controller.refresh();
  h.requests[0].reject(new Error('Offline')); await work;
  cached.resolve('1'); await flush();
  assert.deepEqual(h.states.at(-1), { linked: true, issue: 'Offline' });
  assert.equal(h.writes.length, 0);
});

test('a late cached state cannot replace the confirmed server answer', async () => {
  const cached = deferred();
  const h = setup({ getItem: () => cached.promise });
  const work = h.controller.refresh();
  h.requests[0].resolve({ linked: false }); await work;
  cached.resolve('1'); await flush();
  assert.deepEqual(h.states.at(-1), { linked: false, issue: null });
  assert.equal(h.data.get(intoBankLinkCacheKey('account-a')), '0');
});

test('an older refresh cannot overwrite a newer refresh or its cache', async () => {
  const h = setup();
  const old = h.controller.refresh(), recent = h.controller.refresh();
  h.requests[1].resolve({ linked: false }); await recent;
  h.requests[0].resolve({ linked: true }); await old; await flush();
  assert.deepEqual(h.states.at(-1), { linked: false, issue: null });
  assert.deepEqual(h.writes, [[intoBankLinkCacheKey('account-a'), '0']]);
});

test('confirmed unlink invalidates an in-flight linked status', async () => {
  const h = setup();
  const work = h.controller.refresh();
  h.controller.confirm(false);
  h.requests[0].resolve({ linked: true }); await work; await flush();
  assert.deepEqual(h.states.at(-1), { linked: false, issue: null });
  assert.equal(h.data.get(intoBankLinkCacheKey('account-a')), '0');
});

test('account switches and disposal suppress late responses and cache writes', async () => {
  for (const end of [h => h.switchOwner('account-b'), h => h.controller.dispose()]) {
    const h = setup();
    const work = h.controller.refresh();
    end(h); const count = h.states.length;
    h.requests[0].resolve({ linked: true }); await work;
    h.controller.confirm(false); await flush();
    assert.equal(h.states.length, count);
    assert.equal(h.writes.length, 0);
  }
});

test('confirmed cache writes preserve order when native storage is slow', async () => {
  const first = deferred();
  let count = 0;
  const h = setup({ setItem: async () => { if (++count === 1) await first.promise; } });
  h.controller.confirm(true); await flush();
  h.controller.confirm(false); await flush();
  assert.equal(h.writes.length, 1);
  first.resolve(); await flush();
  assert.deepEqual(h.writes, [[intoBankLinkCacheKey('account-a'), '1'], [intoBankLinkCacheKey('account-a'), '0']]);
  assert.equal(h.data.get(intoBankLinkCacheKey('account-a')), '0');
});

test('refresh keeps an in-memory confirmation while its cache write is still pending', async () => {
  const write = deferred();
  const h = setup({ entries: [[intoBankLinkCacheKey('account-a'), '1']], setItem: () => write.promise });
  h.controller.confirm(false);
  const work = h.controller.refresh(); await flush();
  assert.equal(h.keys.length, 0);
  assert.equal(h.states.at(-1).linked, false);
  h.requests[0].reject(new Error('Offline')); await work;
  assert.deepEqual(h.states.at(-1), { linked: false, issue: 'Offline' });
  write.resolve(); await flush();
});

test('a remounted controller waits for the previous confirmed write before reading cache', async () => {
  const write = deferred();
  let cached = '1';
  const old = setup({ ownerId: 'remount-a', setItem: async (_key, value) => { await write.promise; cached = value; } });
  old.controller.confirm(false); await flush(); old.controller.dispose();
  const fresh = setup({ ownerId: 'remount-a', getItem: async () => cached });
  const work = fresh.controller.refresh();
  fresh.requests[0].reject(new Error('Offline')); await work; await flush();
  assert.equal(fresh.keys.length, 0);
  assert.deepEqual(fresh.states.at(-1), { linked: null, issue: 'Offline' });
  write.resolve(); await flush();
  assert.deepEqual(fresh.states.at(-1), { linked: false, issue: 'Offline' });
});

test('empty owner never reads or persists connection state', async () => {
  const h = setup({ ownerId: '' });
  await h.controller.refresh(); h.controller.confirm(true); await flush();
  assert.equal(h.requests.length, 0); assert.equal(h.keys.length, 0); assert.equal(h.writes.length, 0);
});
