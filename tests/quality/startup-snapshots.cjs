const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, modules = {}, extra = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = { exports: {}, require: id => { if (!(id in modules)) throw Error(id); return modules[id]; },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout, ...extra };
  vm.runInNewContext(code, context);
  return context.exports;
}
const core = load('src/services/startupSnapshotCore.ts');
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
function memory() {
  const values = new Map(), calls = [];
  return { values, calls, async getItem(key) { calls.push(['read', key]); return values.get(key) ?? null; },
    async setItem(key, value) { calls.push(['write', key]); values.set(key, value); },
    async removeItem(key) { calls.push(['remove', key]); values.delete(key); } };
}
function harness(storage = memory(), now = () => 1000) {
  const registry = core.createStartupSnapshotRegistry({ secure: storage, public: storage, metadata: storage }, now);
  const create = (id = 'inbox', options = {}) => registry.create(id, { version: 1, ttlMs: 1000, maxBytes: 1000,
    storage: 'secure', sanitize: value => value && typeof value.text === 'string' ? { text: value.text } : null, ...options });
  return { storage, registry, create };
}

test('cold same-account launch restores sanitized data without any network dependency', async () => {
  const h = harness(), first = h.create(); await h.registry.setAccount('a', 'first-session');
  await first.write('a', { text: 'Already loaded', access_token: 'never-store' });
  assert.ok(![...h.storage.values.values()].join('').includes('never-store'));
  const restarted = harness(h.storage), second = restarted.create();
  await restarted.registry.setAccount('a', 'new-runtime-session');
  assert.equal((await second.hydrate('a')).text, 'Already loaded');
  assert.equal(second.peek('b'), null);
});

test('account change and same-account new session synchronously fence memory and purge disk', async () => {
  const h = harness(), store = h.create(); await h.registry.setAccount('a', 'a1'); await store.write('a', { text: 'private a' });
  const change = h.registry.setAccount('b', 'b1'); assert.equal(store.peek('a'), null); await change;
  assert.ok(![...h.storage.values.values()].join('').includes('private a'));
  await store.write('b', { text: 'private b' }); await h.registry.setAccount('b', 'b1');
  assert.equal(store.peek('b').text, 'private b');
  await h.registry.setAccount('b', 'b2'); assert.equal(await store.hydrate('b'), null);
  await store.write('b', { text: 'signed out' }); await h.registry.setAccount(null);
  assert.equal(h.storage.values.size, 0);
});

test('cold different-account launch purges old domains, including no-longer-registered domains', async () => {
  const h = harness(), old = h.create('old-domain'); await h.registry.setAccount('a'); await old.write('a', { text: 'old private data' });
  const next = harness(h.storage); next.create('new-domain'); await next.registry.setAccount('b');
  assert.ok(![...h.storage.values.values()].join('').includes('old private data'));
});

test('failed logout deletion leaves an invalidation marker and retries before a cold restore', async () => {
  const h = harness(), store = h.create(); await h.registry.setAccount('a'); await store.write('a', { text: 'before logout' });
  const remove = h.storage.removeItem; let fail = true;
  h.storage.removeItem = async key => { if (fail && key.endsWith('.inbox')) throw Error('locked'); return remove(key); };
  await h.registry.setAccount(null);
  assert.equal(JSON.parse(h.storage.values.get('pc.startup.owner.v1')).invalidated, true);
  fail = false;
  const restart = harness(h.storage), restored = restart.create(); await restart.registry.setAccount('a');
  assert.equal(await restored.hydrate('a'), null);
});

test('deduplicated read cannot overwrite a newer confirmed write', async () => {
  const h = harness(), store = h.create(), wait = gate(); await h.registry.setAccount('a');
  const original = h.storage.getItem; let reads = 0;
  h.storage.getItem = key => key.endsWith('.inbox') ? (reads++, wait.promise) : original(key);
  const one = store.hydrate('a'), two = store.hydrate('a'); await flush(); assert.equal(reads, 1);
  await store.write('a', { text: 'new' });
  wait.resolve(JSON.stringify({ schema: 1, version: 1, owner: 'a', savedAt: 1000, value: { text: 'old' } }));
  assert.equal(await one, null); assert.equal(await two, null); assert.equal(store.peek('a').text, 'new');
});

test('aborting one consumer preserves the shared read, while a session change rejects late data', async () => {
  const h = harness(), store = h.create(), wait = gate(); await h.registry.setAccount('a');
  const original = h.storage.getItem;
  h.storage.getItem = key => key.endsWith('.inbox') ? wait.promise : original(key);
  const controller = new AbortController(), cancelled = store.hydrate('a', controller.signal), other = store.hydrate('a');
  await flush(); controller.abort(); assert.equal(await cancelled, null);
  const change = h.registry.setAccount('b');
  wait.resolve(JSON.stringify({ schema: 1, version: 1, owner: 'a', savedAt: 1000, value: { text: 'late a' } }));
  assert.equal(await other, null); await change; assert.equal(store.peek('b'), null);
});

test('schema, owner, expiry, future clocks, corruption and byte limits reject saved data', async () => {
  const valid = { schema: 1, version: 1, owner: 'a', savedAt: 1000, value: { text: 'good' } };
  for (const saved of [null, '{bad', { ...valid, schema: 2 }, { ...valid, version: 2 }, { ...valid, owner: 'b' },
    { ...valid, savedAt: 0 }, { ...valid, savedAt: 1001 }, { ...valid, value: { text: 'x'.repeat(1200) } }]) {
    const h = harness(), store = h.create(); await h.registry.setAccount('a');
    h.storage.values.set('pc.startup.v1.a.inbox', typeof saved === 'string' ? saved : JSON.stringify(saved));
    assert.equal(await store.hydrate('a'), null);
  }
  const h = harness(), store = h.create(); await h.registry.setAccount('a');
  await store.write('a', { text: 'x'.repeat(1200) }); assert.equal(store.peek('a'), null);
});

test('expiry notifies mounted consumers and clock rollback never extends visibility', async () => {
  let clock = 1000; const h = harness(undefined, () => clock), store = h.create('short', { ttlMs: 25 });
  await h.registry.setAccount('a'); let notices = 0; store.subscribe(() => notices++);
  await store.write('a', { text: 'brief' }); clock = 999; assert.equal(store.peek('a'), null); clock = 1000;
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(store.peek('a'), null); assert.equal(notices, 2);
});

test('authoritative content expiry caps a longer snapshot TTL on both warm and cold reads', async () => {
  let clock = 1000; const h = harness(undefined, () => clock);
  const policy = { ttlMs: 86400000, expiresAt: () => 1200 };
  const store = h.create('story', policy); await h.registry.setAccount('a'); await store.write('a', { text: 'story' });
  clock = 1199; assert.equal(store.peek('a').text, 'story');
  clock = 1200; assert.equal(store.peek('a'), null);
  const cold = harness(h.storage, () => clock), restored = cold.create('story', policy);
  await cold.registry.setAccount('a'); assert.equal(await restored.hydrate('a'), null);
  const invalid = cold.create('invalid', { expiresAt: () => NaN });
  await invalid.write('a', { text: 'not retained' }); assert.equal(invalid.peek('a'), null);
});

test('secure chunks respect UTF-8 limits, preserve committed data after failure and purge all slots', async () => {
  const storage = memory(), chunks = core.createChunkedSnapshotStorage(storage);
  const original = 'Hello🙂'.repeat(1000); await chunks.setItem('safe', original);
  assert.equal(await chunks.getItem('safe'), original);
  assert.ok([...storage.values.values()].every(value => Buffer.byteLength(value) <= 1800));
  const write = storage.setItem; storage.setItem = async (key, value) => { if (key.endsWith('.1.1')) throw Error('disk full'); return write(key, value); };
  await assert.rejects(chunks.setItem('safe', 'changed'.repeat(1000)), /disk full/);
  assert.equal(await chunks.getItem('safe'), original);
  await chunks.removeItem('safe'); assert.equal(storage.values.size, 0);
});

test('local launch budget resolves even when secure storage does not answer', async () => {
  const native = { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7, getItemAsync: async () => null,
    setItemAsync: async () => {}, deleteItemAsync: async () => {} };
  const service = load('src/services/startupSnapshots.ts', {
    '@react-native-async-storage/async-storage': { default: memory() }, 'expo-secure-store': native,
    './startupSnapshotCore': core,
  }, { setTimeout });
  await service.waitForStartupSnapshots(new Promise(() => {}), 10);
});
