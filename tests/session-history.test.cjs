const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../shared/sessionHistory.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports, AbortController });
const { createSessionHistory } = moduleUnderTest.exports;
const rows = (from, count) => Array.from({ length: count }, (_, n) => ({ id: String(from + n), content: 'private-' + (from + n), url: 'signed-ticket' }));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function fixture(extra = {}) {
  const disk = new Map(), fetches = []; let current = true, now = 1, failure = false, omit = new Set();
  const storage = { read: async keys => keys.map(key => disk.get(key) ?? null),
    write: async entries => { for (const [key, value] of entries) { disk.set(key, value); if (failure) throw Error('device quota'); } },
    clear: async prefix => { for (const key of disk.keys()) if (key.startsWith(prefix)) disk.delete(key); } };
  const history = createSessionHistory({ namespace: 'fixture', storage, id: row => row.id, current: () => current,
    clock: () => now, residentRows: 20, pageRows: 5,
    fetch: async (ids, signal) => { fetches.push({ ids, signal }); return ids.filter(id => !omit.has(id)).map(id => ({ ...rows(Number(id), 1)[0], renewed: true })); }, ...extra });
  const measure = () => history.getSnapshot().pages.forEach(page => history.measure(page.index, 100 + page.index));
  return { history, disk, fetches, measure, setCurrent(value) { current = value; }, fail(value) { failure = value; }, omit(value) { omit = new Set(value); }, clock(value) { now = value; } };
}
async function walk(f, count = 100) {
  for (let from = 0; from < count; from += 10) {
    const last = f.history.getSnapshot().rows.at(-1); if (last) f.history.setAnchor(last.id);
    await f.history.append(rows(from, 10)); f.measure();
    assert.ok(f.history.getSnapshot().rows.length <= 20);
  }
}
test('long reading retains bounded content and persists only identifiers/geometry', async () => {
  const f = fixture(); await walk(f, 500);
  assert.equal(f.history.stats().residentRows, 20); assert.equal(f.history.stats().ledgerPages, 100);
  assert.equal(f.history.getSnapshot().first, 480);
  assert.ok(f.history.getSnapshot().before > 0);
  const ledger = [...f.disk.values()].join(''); assert.doesNotMatch(ledger, /private-|signed-ticket|content|url/);
  await f.history.dispose(); assert.equal(f.disk.size, 0);
});
test('backward and forward restoration preserves ordered geometry and reauthorizes cold rows', async () => {
  const f = fixture(); await walk(f);
  const totalHeight = f.history.getSnapshot().before + f.history.getSnapshot().pages.reduce((sum, page) => sum + page.height, 0);
  f.omit(['1', '6']); await f.history.around(0);
  let value = f.history.getSnapshot(); assert.equal(value.first, 0); assert.equal(value.before, 0);
  assert.deepEqual(Array.from(value.rows, row => row.id), rows(0, 20).map(row => row.id).filter(id => !['1', '6'].includes(id)));
  assert.ok(value.rows.every(row => row.renewed)); assert.equal(value.pages.reduce((sum, page) => sum + page.height, 0) + value.after, totalHeight);
  f.history.measure(0, 20); assert.equal(f.history.getSnapshot().pages[0].height, 100, 'Revoked content does not collapse recorded geometry');
  await f.history.around(19); value = f.history.getSnapshot(); assert.equal(value.first, 80); assert.equal(value.after, 0);
  assert.ok(f.fetches.every(call => call.ids.length <= 100));
});
test('unmeasured pages are never evicted using guessed height', async () => {
  const f = fixture(); await f.history.append(rows(0, 20)); f.history.setAnchor('19');
  await assert.rejects(f.history.append(rows(20, 5)), /could not be saved/);
  assert.equal(f.history.stats().residentRows, 20); assert.equal(f.history.stats().ledgerPages, 4);
  f.measure(); await f.history.append(rows(20, 5)); assert.equal(f.history.stats().residentRows, 20);
});
test('quota failure keeps all current content and retry does not lose partially written IDs', async () => {
  const f = fixture(); await f.history.append(rows(0, 20)); f.measure(); f.history.setAnchor('19'); f.fail(true);
  await assert.rejects(f.history.append(rows(20, 5)), /quota/);
  assert.equal(f.history.getSnapshot().rows[0].id, '0'); assert.equal(f.history.stats().ledgerPages, 4);
  f.fail(false); await f.history.append(rows(20, 5)); assert.equal(f.history.getSnapshot().rows.at(-1).id, '24');
  assert.equal(f.history.getSnapshot().error, null);
});
test('ledger page/byte/age limits stop new retention with existing content intact', async () => {
  const f = fixture({ maxPages: 4 }); await f.history.append(rows(0, 20)); f.measure(); f.history.setAnchor('19');
  await assert.rejects(f.history.append(rows(20, 5)), /could not be saved/); assert.equal(f.history.getSnapshot().count, 20);
  const tiny = fixture({ maxBytes: 1 }); await assert.rejects(tiny.history.append(rows(0, 1)), /could not be saved/);
  const expired = fixture({ maxAgeMs: 5 }); await expired.history.append(rows(0, 5)); expired.clock(10);
  await assert.rejects(expired.history.append(rows(5, 1)), /session changed/);
});
test('rapid reversal coalesces restores without exceeding the resident bound', async () => {
  const f = fixture(); await walk(f);
  await Promise.all([f.history.around(0), f.history.around(10), f.history.around(19)]);
  assert.equal(f.history.getSnapshot().first, 80); assert.equal(f.history.getSnapshot().count, 20);
});
test('actor change during hydration cannot publish late content', async () => {
  const gate = deferred(), f = fixture({ fetch: async ids => { await gate.promise; return ids.map(id => rows(Number(id), 1)[0]); } });
  await walk(f); const restore = f.history.around(0); await Promise.resolve(); await Promise.resolve();
  f.setCurrent(false); gate.resolve(); await assert.rejects(restore, /session changed/);
  assert.equal(f.history.getSnapshot().first, 80);
});
test('disposing waits for a pending write before deleting actor ledger', async () => {
  const gate = deferred(), disk = new Map(); let started;
  const began = new Promise(resolve => { started = resolve; });
  const f = fixture({ storage: { read: async keys => keys.map(() => null), write: async entries => { started(); await gate.promise; entries.forEach(([key, value]) => disk.set(key, value)); },
    clear: async prefix => { for (const key of disk.keys()) if (key.startsWith(prefix)) disk.delete(key); } } });
  const adding = f.history.append(rows(0, 5)); await began; const disposing = f.history.dispose(); gate.resolve();
  await assert.rejects(adding, /session changed/); await disposing; assert.equal(disk.size, 0); assert.equal(f.history.getSnapshot().rows.length, 0);
});
test('restored navigation rebinds the actor fence and cold-reader without retaining old closures', async () => {
  const f = fixture(); await walk(f); f.setCurrent(false);
  let calls = 0;
  f.history.rebind({ current: () => true, fetch: async ids => { calls++; return ids.map(id => rows(Number(id), 1)[0]); } });
  await f.history.around(0); assert.equal(calls, 1); assert.equal(f.history.getSnapshot().first, 0);
});
