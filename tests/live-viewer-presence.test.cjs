const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../shared/useLiveViewerPresence.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(rpc) {
  const timers = new Map(); let next = 0;
  const sandbox = { exports: {}, require(name) { throw Error('Shared presence must not import app dependencies: ' + name); }, AbortController, Promise, Math, setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(code, sandbox);
  const lease = sandbox.exports.createLiveViewerPresence({ client: { rpc }, sessionId: 'stream', playbackId: 'one-player', random: () => 0.5 });
  return { lease, timers };
}
test('heartbeats reflect playback activity and use one stable instance with bounded jitter', async () => {
  const calls = [], { lease, timers } = fixture(async (name, args) => { calls.push({ name, args }); return { error: null }; });
  lease.setActive(false); assert.equal(calls.length, 0);
  lease.setActive(true); await flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'live_viewer_heartbeat'); assert.equal(calls[0].args.p_playback_id, 'one-player'); assert.equal(calls[0].args.p_active, true);
  lease.setActive(true); assert.equal(calls.length, 1);
  const [id, timer] = [...timers][0]; assert.equal(timer.delay, 37500); timers.delete(id); timer.fn(); await flush();
  assert.equal(calls.length, 2);
  lease.setActive(false); await flush(); assert.equal(calls[2].args.p_active, false); assert.equal(timers.size, 0);
  lease.dispose(); await flush(); assert.equal(calls.length, 3);
});
test('unmount during a pending join sends leave after join completes and stops timers', async () => {
  const calls = []; let finish;
  const { lease, timers } = fixture((name, args) => { calls.push(args); return calls.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ error: null }); });
  lease.setActive(true); lease.dispose(); assert.equal(calls.length, 1);
  finish({ error: null }); await flush(); await flush();
  assert.deepEqual(calls.map(call => call.p_active), [true, false]); assert.equal(timers.size, 0);
  lease.setActive(true); assert.equal(calls.length, 2);
});
test('a failed heartbeat retries on the normal interval and a later pause still retires its lease', async () => {
  const calls = [], { lease, timers } = fixture(async (name, args) => { calls.push(args); throw Error('offline'); });
  lease.setActive(true); await flush(); assert.equal(calls.length, 1); assert.equal([...timers.values()][0].delay, 37500);
  lease.setActive(false); await flush(); assert.deepEqual(calls.map(call => call.p_active), [true, false]); assert.equal(timers.size, 0);
});
