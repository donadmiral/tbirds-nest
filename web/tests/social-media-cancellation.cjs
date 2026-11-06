const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/useSocialPages.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

function fixture(options = {}) {
  const effects = [], listeners = new Set(), events = new Map(), media = [];
  let page, version = 1, querySignal;
  let rows = [{ id: 'one', caption: 'visible', _mediaExpiresAt: 0 }];
  const reader = {
    snapshot: () => ({ items: rows, loading: false, error: null, hasMore: false }),
    version: () => version,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setItems(update) { rows = update(rows); listeners.forEach(fn => fn()); },
  };
  const client = { rpc() { return { abortSignal(signal) { querySignal = signal; return options.query ?? Promise.resolve({ data: rows }); } }; } };
  const store = { subscribe() {}, getSnapshot: () => ({ initialized: true }), getServerSnapshot: () => ({}) };
  const imports = {
    react: {
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useMemo: fn => fn(), useEffect: fn => effects.push(fn), useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    },
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/socialPages': { createPagedCollection: config => { page = config; return reader; } },
    '@/lib/contentMedia': { hydratePostMedia(input, target, signal) {
      const pending = deferred(); media.push({ input, target, signal, ...pending }); return pending.promise;
    } },
    '@/lib/withTimeout': { withTimeout: work => options.timeout?.(work) ?? work },
    '@/lib/profileNavigation': { getProfileNavigationStore: () => store },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, AbortController, Map, Date, JSON,
    require(name) { assert.ok(name in imports, name); return imports[name]; },
    setInterval: () => 1, clearInterval() {},
    document: { visibilityState: 'visible', addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) },
    window: { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) },
  });
  module.exports.useSocialPages('get_discover_page', {}, { key: 'id' });
  return {
    media, reader, events, listeners,
    get rows() { return rows; }, get querySignal() { return querySignal; },
    fetchPage: (...args) => page.fetchPage(...args),
    startRenewal: () => effects.at(-1)(),
    supersede() { version++; listeners.forEach(fn => fn()); },
  };
}

test('page media hydration shares the cancellable page request signal', async () => {
  const f = fixture(), controller = new AbortController();
  const result = f.fetchPage(0, 24, 'snapshot', controller.signal);
  for (let tick = 0; tick < 6; tick++) await Promise.resolve();
  assert.equal(f.querySignal, controller.signal);
  assert.equal(f.media[0].signal, controller.signal);
  controller.abort();
  assert.equal(f.media[0].signal.aborted, true);
  f.media[0].resolve([]);
  await result;
});

test('a page cancelled during its RPC does not start media hydration', async () => {
  const query = deferred(), f = fixture({ query: query.promise }), controller = new AbortController();
  const result = f.fetchPage(0, 24, 'snapshot', controller.signal);
  controller.abort(); query.resolve({ data: [{ id: 'obsolete' }] });
  await assert.rejects(result, /session changed/);
  assert.equal(f.media.length, 0);
});

test('route cleanup aborts pending renewal and releases every subscription', async () => {
  const f = fixture(), cleanup = f.startRenewal();
  const work = f.events.get('visibilitychange')();
  assert.equal(f.media[0].signal.aborted, false);
  cleanup();
  assert.equal(f.media[0].signal.aborted, true);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.events.size, 0);
  f.media[0].resolve([{ id: 'obsolete' }]); await work;
  assert.equal(f.rows[0].caption, 'visible');
});

test('replacement page reads abort old renewal without changing visible rows', async () => {
  const f = fixture(), cleanup = f.startRenewal();
  const work = f.events.get('visibilitychange')();
  f.supersede();
  assert.equal(f.media[0].signal.aborted, true);
  f.media[0].resolve([{ id: 'obsolete' }]); await work;
  assert.equal(f.rows[0].caption, 'visible'); cleanup();
});

test('foreground and reconnect events share renewal and release its transport when settled', async () => {
  const f = fixture(), cleanup = f.startRenewal();
  const work = f.events.get('visibilitychange')();
  await f.events.get('online')();
  assert.equal(f.media.length, 1);
  f.media[0].resolve([{ id: 'one', caption: 'fresh', _mediaExpiresAt: Date.now() + 120000 }]);
  await work;
  assert.equal(f.rows[0].caption, 'fresh');
  assert.equal(f.media[0].signal.aborted, true);
  cleanup();
});

test('renewal deadline aborts transport and keeps current content available', async () => {
  const f = fixture({ timeout: () => Promise.reject(new Error('Timed out')) }), cleanup = f.startRenewal();
  await f.events.get('visibilitychange')();
  assert.equal(f.media[0].signal.aborted, true);
  assert.equal(f.rows[0].caption, 'visible'); cleanup();
});
