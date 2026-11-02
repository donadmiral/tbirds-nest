const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/keyedBatchReader.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(load, options = {}) {
  let now = 0, serial = 0;
  const timers = new Map(), exports = {};
  vm.runInNewContext(source, { exports, AbortController,
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const reader = exports.createKeyedBatchReader(load, { delayMs: 0, ...options });
  reader.setScope('a:1');
  return { reader, async advance(ms = 0) {
    now += ms;
    for (let guard = 0; guard < 100; guard++) {
      const due = [...timers].filter(([, task]) => task.at <= now);
      if (!due.length) { await settle(); if (![...timers.values()].some(task => task.at <= now)) break; continue; }
      due.forEach(([id, task]) => { timers.delete(id); task.fn(); });
      await settle();
    }
  } };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('nearby reads share one query, preserve keys and retain no completed data', async () => {
  const calls = [];
  const f = fixture(async keys => { calls.push(keys); return new Map(keys.map(key => [key, 'value:' + key])); });
  const first = f.reader.read('a'), duplicate = f.reader.read('a'), second = f.reader.read('b');
  assert.equal(first, duplicate);
  await f.advance();
  assert.deepEqual(await Promise.all([first, second]), ['value:a', 'value:b']);
  assert.equal(calls.length, 1); assert.equal(f.reader.pendingCount, 0);
  const refresh = f.reader.read('a'); await f.advance(); await refresh;
  assert.equal(calls.length, 2, 'a later read reauthorizes instead of retaining viewer data');
});

test('many cards keep both batch size and parallel transport bounded', async () => {
  const calls = [];
  const f = fixture((keys, signal) => { const wait = deferred(); calls.push({ keys, signal, wait }); return wait.promise; }, { batchSize: 3, concurrency: 2, maxPending: 12 });
  const pending = Array.from({ length: 10 }, (_, i) => f.reader.read(String(i)));
  await f.advance(); assert.equal(calls.length, 2); assert.equal(f.reader.activeBatches, 2);
  calls[0].wait.resolve(new Map(calls[0].keys.map(key => [key, key])));
  await f.advance(); assert.equal(calls.length, 3); assert.equal(f.reader.activeBatches, 2);
  for (let index = 1; index < 4; index++) {
    calls[index].wait.resolve(new Map(calls[index].keys.map(key => [key, key]))); await f.advance();
  }
  assert.deepEqual(await Promise.all(pending), Array.from({ length: 10 }, (_, i) => String(i)));
  assert.ok(calls.every(call => call.keys.length <= 3));
  assert.equal(f.reader.pendingCount, 0); assert.equal(f.reader.activeBatches, 0);
});

test('session changes reject queued and running reads, even through A to B to A', async () => {
  const calls = [];
  const f = fixture((keys, signal) => { const wait = deferred(); calls.push({ keys, signal, wait }); return wait.promise; }, { batchSize: 1, concurrency: 1 });
  const old = f.reader.read('same'), queued = f.reader.read('queued');
  const oldCheck = assert.rejects(old, /session changed/), queuedCheck = assert.rejects(queued, /session changed/);
  await f.advance(); f.reader.setScope('b:2'); f.reader.setScope('a:3');
  await Promise.all([oldCheck, queuedCheck]); assert.equal(calls[0].signal.aborted, true);
  const fresh = f.reader.read('same'); await f.advance(); assert.equal(calls.length, 1, 'an abort-ignoring transport still owns its slot');
  calls[0].wait.resolve(new Map([['same', 'old private data']]));
  await f.advance(); assert.equal(calls.length, 2);
  calls[1].wait.resolve(new Map([['same', 'fresh authorized data']])); await f.advance();
  assert.equal(await fresh, 'fresh authorized data'); assert.equal(f.reader.pendingCount, 0);
});

test('failed and incomplete reads remain retryable and are never cached as absent', async () => {
  let attempt = 0;
  const f = fixture(async keys => { if (++attempt === 1) throw Error('offline'); if (attempt === 2) return new Map(); return new Map(keys.map(key => [key, true])); });
  for (const message of [/offline/, /Incomplete/]) {
    const request = f.reader.read('poll'), check = assert.rejects(request, message); await f.advance(); await check;
  }
  const retry = f.reader.read('poll'); await f.advance(); assert.equal(await retry, true);
});

test('a stalled transport is aborted without releasing its slot until it settles', async () => {
  const signals = [];
  const gate = deferred();
  const f = fixture((_keys, signal) => { signals.push(signal); return gate.promise; }, { timeoutMs: 50, concurrency: 1 });
  const request = f.reader.read('stalled'), check = assert.rejects(request);
  await f.advance(); await f.advance(50); await check;
  assert.equal(signals[0].aborted, true); assert.equal(f.reader.pendingCount, 0); assert.equal(f.reader.activeBatches, 1);
  const queued = f.reader.read('later'), queuedCheck = assert.rejects(queued, /timed out/);
  await f.advance(50); await queuedCheck;
  assert.equal(signals.length, 1, 'cancellation cannot create extra underlying transports');
  assert.equal(f.reader.pendingCount, 0, 'queue deadlines also release retained caller data');
  gate.resolve(new Map()); await f.advance(); assert.equal(f.reader.activeBatches, 0);
});

test('the pending queue has a hard bound while duplicate readers still join', async () => {
  const f = fixture(async keys => new Map(keys.map(key => [key, key])), { batchSize: 2, maxPending: 3 });
  const requests = ['a', 'b', 'c'].map(key => f.reader.read(key));
  assert.equal(f.reader.read('a'), requests[0]);
  await assert.rejects(f.reader.read('d'), /Too many/);
  await f.advance(); await Promise.all(requests); assert.equal(f.reader.pendingCount, 0);
});
