const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { if (name in mocks) return mocks[name]; throw Error(name); }, setTimeout, clearTimeout, console, Promise, Map, Set, Date });
  return module.exports;
}
const shared = load('shared/videoReadiness.ts');
const turn = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const players = [], changes = [];
  const pool = shared.createVideoReadinessPool(() => {
    let resolve, reject;
    const loaded = new Promise((yes, no) => { resolve = yes; reject = no; });
    const player = { sources: [], paused: 0, released: 0, resolve, reject,
      replaceAsync(source) { this.sources.push(source); return loaded; },
      pause() { this.paused++; }, release() { this.released++; },
    };
    players.push(player); return player;
  }, entry => changes.push(entry), options);
  return { pool, players, changes };
}

test('a warmed upcoming video is the exact same buffered player when scrolled into view', async () => {
  const h = harness(); h.pool.prefetch([{ uri: 'https://media/next.mp4' }]); await turn();
  const prepared = h.pool.peek('https://media/next.mp4'); prepared.player.resolve(); await turn();
  const shown = h.pool.claim('https://media/next.mp4');
  assert.equal(shown, prepared); assert.equal(shown.ready, true); assert.equal(h.players.length, 1);
  assert.equal(shown.player.sources.length, 1); assert.equal(shown.player.sources[0].useCaching, false);
  h.pool.clear();
});

test('rapid A to B scrolling cannot show A in the B player even if A resolves last', async () => {
  const h = harness(); const a = h.pool.claim('https://media/a.mp4'); const b = h.pool.claim('https://media/b.mp4'); await turn();
  assert.notEqual(a.player, b.player); assert.ok(a.player.paused > 0);
  b.player.resolve(); await turn(); a.player.resolve(); await turn();
  assert.equal(b.ready, true); assert.deepEqual(b.player.sources.map(x => x.uri), ['https://media/b.mp4']);
  assert.deepEqual(a.player.sources.map(x => x.uri), ['https://media/a.mp4']); h.pool.clear();
});

test('preload work has a three-player ceiling and never evicts the active player', async () => {
  const h = harness(); const active = h.pool.claim('active');
  for (let i = 0; i < 20; i++) { h.pool.prefetch([{ uri: 'next-' + i }, { uri: 'after-' + i }]); assert.ok(h.pool.size() <= 3); }
  assert.equal(active.disposed, false); assert.equal(active.player.released, 0);
  assert.ok(h.players.filter(p => p.released).length > 20); h.pool.clear(); await turn();
});

test('expired standby media is replaced instead of reusing its authorized buffer', async () => {
  let now = 1; const h = harness({ clock: () => now });
  h.pool.prefetch([{ uri: 'signed', expiresAt: 10 }]); await turn(); const old = h.pool.peek('signed');
  now = 11; const current = h.pool.claim('signed');
  assert.notEqual(current.player, old.player); assert.equal(old.disposed, true); h.pool.clear();
});

test('clearing on account change releases every player and rejects late readiness', async () => {
  const h = harness(); h.pool.claim('private'); h.pool.prefetch([{ uri: 'other-private' }]); await turn();
  h.pool.clear(); h.players.forEach(p => p.resolve()); await turn();
  assert.equal(h.pool.size(), 0); assert.equal(h.changes.length, 2); assert.ok(h.changes.every(entry => entry.disposed)); assert.ok(h.players.every(p => p.released === 1));
});

test('failed preparation is retryable and a late timed-out completion stays failed', async () => {
  const h = harness({ timeoutMs: 5 }); const first = h.pool.claim('slow'); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(first.failed, true); first.player.resolve(); await turn(); assert.equal(first.ready, false);
  const retry = h.pool.claim('slow'); assert.notEqual(retry.player, first.player); await turn(); retry.player.resolve(); await turn();
  assert.equal(retry.ready, true); h.pool.clear();
});

test('data saver, sensitive and view-once attachments are not speculatively fetched', () => {
  const rows = [
    { media: [{ url: 'https://media/private-once', media_type: 'video', view_once: true }] },
    { media: [{ url: 'https://media/sensitive', media_type: 'video', edit: { sensitive: true } }] },
    { media: [{ url: 'https://media/ordinary', media_type: 'video' }], _mediaExpiresAt: 123 },
    { media: [{ url: 'https://media/ordinary', media_type: 'video' }, { url: 'https://media/second', media_type: 'video' }] },
    { media: [{ url: 'https://media/outside', media_type: 'video' }] },
  ];
  assert.equal(shared.upcomingFeedVideos(rows, 0, false).length, 0);
  assert.deepEqual(Array.from(shared.upcomingFeedVideos(rows, 0, true), x => x.uri), ['https://media/ordinary', 'https://media/second']);
  assert.equal(shared.upcomingFeedVideos(rows, 0, true)[0].expiresAt, 123);
});


test('source replacement must reach native readiness and native decode errors remain recoverable', async () => {
  let listener; const changes = [];
  const player = { status: 'loading', pause() {}, release() {}, async replaceAsync() {}, addListener(event, fn) { listener = fn; return { remove() {} }; } };
  const pool = shared.createVideoReadinessPool(() => player, entry => changes.push({ ready: entry.ready, failed: entry.failed }));
  const entry = pool.claim('native'); await turn(); assert.equal(entry.ready, false);
  player.status = 'readyToPlay'; listener({ status: player.status }); assert.equal(entry.ready, true);
  listener({ status: 'error' }); assert.equal(entry.ready, false); assert.equal(entry.failed, true);
  pool.clear();
});

test('retrying a missing first frame creates a new native surface identity', async () => {
  const h = harness(); const original = h.pool.claim('movie'); await turn(); original.player.resolve(); await turn();
  const retried = h.pool.reload('movie');
  assert.notEqual(retried.player, original.player); assert.notEqual(retried.identity, original.identity);
  assert.equal(original.disposed, true); assert.equal(retried.ready, false); h.pool.clear();
});
