const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function load(name) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: mod, exports: mod.exports, AbortController, require: request => load(request.replace('./', '')) });
  return mod.exports;
}
const { createThreadWindow } = load('threadWindow');
const { mergeMessagePage } = load('messageHistory');
const row = n => ({ id: String(n).padStart(8, '0'), created_at: new Date(1735689600000 + n * 1000).toISOString(), sender_id: n % 2 ? 'a' : 'b', text: 'private content ' + n, media_url: 'signed://grant/' + n });
const rows = (n, count) => Array.from({ length: count }, (_, i) => row(n + i));
const height = id => 40 + Number(id) % 17;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(options = {}) {
  let current = true, deny = new Set(); const reads = [];
  const history = createThreadWindow({ ascending: true, current: () => current,
    fetch: async (ids, signal) => { reads.push({ ids, signal }); return ids.filter(id => !deny.has(id)).map(id => ({ ...row(Number(id)), renewed: true })); }, ...options });
  const measure = () => history.getSnapshot().rows.forEach(value => history.measure(value.id, height(value.id)));
  const add = (incoming, follow = false) => { history.replace(mergeMessagePage(history.getSnapshot().rows, incoming, true), follow); measure(); };
  return { history, reads, measure, add, deny(ids) { deny = new Set(ids); }, current(value) { current = value; } };
}
const totalHeight = snapshot => snapshot.items.reduce((sum, item) => sum + item.height, 0);
test('both ends of a 700-message conversation retain at most120 content rows and exact cold geometry', async () => {
  const f = fixture(); f.add(rows(500, 50), true);
  for (let start = 450; start >= 0; start -= 50) {
    await f.history.near(0, 400); f.add(rows(start, 50));
    assert.ok(f.history.stats().residentMessages <= 120);
  }
  await f.history.near(0, 400);
  for (let n = 550; n < 700; n++) { f.add([row(n)]); assert.ok(f.history.stats().residentMessages <= 120); }
  assert.equal(f.history.stats().ledgerMessages, 700);
  assert.equal(totalHeight(f.history.getSnapshot()), rows(0, 700).reduce((sum, value) => sum + height(value.id), 0));
  assert.doesNotMatch(JSON.stringify(f.history.getSnapshot().identities), /private content|signed:|media_url|text/);
  await f.history.near(1e9, 400); assert.equal(f.history.getSnapshot().rows.at(-1).id, row(699).id);
  await f.history.near(0, 400); assert.equal(f.history.getSnapshot().rows[0].id, row(0).id);
  assert.ok(f.reads.every(read => read.ids.length <= 100));
});
test('reversed native ordering preserves the same identity geometry and cold access checks', async () => {
  const f = fixture({ ascending: false });
  for (let n = 0; n < 300; n += 50) f.add(rows(n, 50), true);
  f.deny([row(0).id, row(1).id]); const before = totalHeight(f.history.getSnapshot());
  await f.history.near(1e9, 400);
  assert.ok(!f.history.getSnapshot().rows.some(value => [row(0).id, row(1).id].includes(value.id)));
  assert.equal(totalHeight(f.history.getSnapshot()), before);
  assert.ok(f.history.getSnapshot().rows.every(value => Number(value.id) < 120));
  assert.equal(f.history.atLatest(), false);
  await f.history.near(0, 400); assert.equal(f.history.atLatest(), true);
});
test('unmeasured rows are never discarded and a failed page does not advance the ledger', () => {
  const f = fixture(); f.history.replace(rows(0, 120), true);
  assert.throws(() => f.history.replace(rows(0, 121), true), /still loading/);
  assert.equal(f.history.stats().ledgerMessages, 120); assert.equal(f.history.getSnapshot().rows.length, 120);
  f.measure(); f.add([row(120)], true); assert.equal(f.history.stats().ledgerMessages, 121);
  assert.equal(f.history.getSnapshot().error, null);
});
test('ledger capacity stops further paging with all current content intact', () => {
  const f = fixture({ maximum: 20 }); f.add(rows(0, 20));
  assert.throws(() => f.add([row(20)]), /Reopen the conversation/);
  assert.equal(f.history.stats().ledgerMessages, 20); assert.equal(f.history.getSnapshot().rows.length, 20);
});
test('a resident date/group boundary may shrink before eviction without accumulating blank spacing', () => {
  const f = fixture(); f.add(rows(0, 50));
  f.history.measure(row(0).id, 100); f.history.measure(row(0).id, 50);
  assert.equal(f.history.getSnapshot().items.find(item => item.id === row(0).id).height, 50);
});
test('a realtime deletion cannot be resurrected by a pending authenticated restore', async () => {
  const f = fixture(); for (let n = 0; n < 300; n += 50) f.add(rows(n, 50), true);
  const pending = deferred(); let requested;
  f.history.rebind({ current: () => true, fetch: async ids => { requested = ids; return pending.promise; } });
  const moving = f.history.near(0, 400); f.history.remove(new Set([row(0).id]));
  pending.resolve(requested.map(id => row(Number(id)))); await moving;
  assert.equal(f.history.getSnapshot().identities.some(value => value.id === row(0).id), false);
  assert.equal(f.history.getSnapshot().rows.some(value => value.id === row(0).id), false);
});
test('actor changes abort and fence in-flight content and clear removes every retained identity', async () => {
  const f = fixture(); for (let n = 0; n < 300; n += 50) f.add(rows(n, 50), true);
  const pending = deferred(); let request;
  f.history.rebind({ current: () => true, fetch: async (ids, signal) => { request = { ids, signal }; return pending.promise; } });
  const moving = f.history.near(0, 400); f.history.clear();
  assert.equal(request.signal.aborted, true);
  pending.resolve(request.ids.map(id => row(Number(id)))); await assert.rejects(moving, /changed/);
  assert.equal(f.history.getSnapshot().rows.length, 0); assert.equal(f.history.stats().ledgerMessages, 0);
});
test('deferred cold rows cannot replace a newer realtime edit', async () => {
  const f = fixture(); for (let n = 0; n < 300; n += 50) f.add(rows(n, 50), true);
  const pending = deferred(); let requested;
  f.history.rebind({ current: () => true, fetch: async ids => { requested = ids; return pending.promise; } });
  const moving = f.history.near(0, 400);
  f.history.invalidate(new Set([row(0).id]));
  f.add([{ ...row(0), text: 'edited during read' }]);
  pending.resolve(requested.map(id => row(Number(id)))); await moving;
  assert.equal(f.history.getSnapshot().rows.find(value => value.id === row(0).id)?.text, 'edited during read');
});
