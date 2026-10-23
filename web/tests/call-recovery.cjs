const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function load(disk = new Map(), unavailable = false) {
  const module = { exports: {} };
  const localStorage = { get length() { return disk.size; }, key: i => [...disk.keys()][i], getItem: k => disk.get(k) ?? null, setItem: (k, v) => { if (unavailable) throw new Error('blocked'); disk.set(k, v); }, removeItem: k => disk.delete(k) };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/callRecovery.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, window: { localStorage }, Date });
  return module.exports;
}
test('failed closures survive reload, retain only minimum data, and retry under their own account', async () => {
  const disk = new Map(), first = load(disk); const intent = { id: id(10), is_group_call: false, token: 'never-persist-this' };
  assert.equal(first.queueCallClose(id(1), intent), true); assert.doesNotMatch([...disk.values()].join(''), /token|never-persist/);
  const next = load(disk); let attempts = 0;
  assert.equal(await next.flushPendingCallCloses(id(2), () => true, async () => { attempts++; }), true); assert.equal(attempts, 0);
  assert.equal(await next.flushPendingCallCloses(id(1), () => false, async () => { attempts++; }), false); assert.equal(attempts, 0);
  assert.equal(await next.flushPendingCallCloses(id(1), () => true, async () => { attempts++; throw new Error('offline'); }), false);
  assert.equal(next.pendingCallCloses(id(1)).length, 1);
  assert.equal(await next.flushPendingCallCloses(id(1), () => true, async () => { attempts++; }), true); assert.equal(attempts, 2); assert.equal(disk.size, 0);
});
test('group recovery requires an exact membership identity and preserves independent join generations', async () => {
  const queue = load(); assert.equal(queue.queueCallClose(id(1), { id: id(10), is_group_call: true }), false);
  for (const generation of [id(20), id(21)]) assert.equal(queue.queueCallClose(id(1), { id: id(10), is_group_call: true, provider_identity: generation }), true);
  const closed = []; await queue.flushPendingCallCloses(id(1), () => true, async entry => closed.push(entry.provider_identity)); assert.deepEqual(closed, [id(20), id(21)]);
});
test('concurrent reconnect signals send only one request per pending close', async () => {
  const queue = load(); queue.queueCallClose(id(1), { id: id(10), is_group_call: false }); let resolve, count = 0; const wait = new Promise(r => { resolve = r; });
  const close = async () => { count++; await wait; }; const a = queue.flushPendingCallCloses(id(1), () => true, close), b = queue.flushPendingCallCloses(id(1), () => true, close); assert.equal(count, 1); resolve(); assert.deepEqual(await Promise.all([a, b]), [true, true]);
});
test('malformed storage and expired intents cannot become server calls, while blocked storage retains memory retry', async () => {
  const key = `pc:call-close:v1:${id(1)}:${id(10)}:direct`; const disk = new Map([[key, '{not-json'], [key + ':old', JSON.stringify({ id: id(10), is_group_call: false, queued_at: 1 })]]);
  const queue = load(disk); assert.equal(queue.pendingCallCloses(id(1)).length, 0); assert.equal(disk.size, 0);
  const memory = load(new Map(), true); memory.queueCallClose(id(1), { id: id(10), is_group_call: false }); assert.equal(memory.pendingCallCloses(id(1)).length, 1);
  assert.equal(await memory.flushPendingCallCloses(id(1), () => true, async () => {}), true);
});
