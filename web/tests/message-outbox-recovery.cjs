const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '../lib/messageOutbox.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(count, outcomes = []) {
  const timers = new Map(), attempts = [], delays = [];
  let visible = true;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require: () => ({}), Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    setTimeout(fn, delay) { timers.set(fn, delay); delays.push(delay); return fn; },
    clearTimeout(fn) { timers.delete(fn); },
  });
  const pending = Array.from({ length: count }, (_, id) => ({ id }));
  const worker = exports.createOutboxReplay({
    pending: () => pending, active: () => visible,
    deliver: async row => {
      attempts.push(row.id);
      const result = outcomes.shift() || 'confirmed';
      if (result !== 'pending') pending.splice(pending.indexOf(row), 1);
      return result;
    },
  });
  async function tick() {
    assert.equal(timers.size, 1);
    const [fn] = timers.keys(); timers.delete(fn); fn();
    await new Promise(resolve => setImmediate(resolve));
  }
  return { ...worker, attempts, delays, timers, tick, setVisible(value) { visible = value; } };
}

test('reconnect coalesces wakeups and drains at most 20 messages per pass in order', async () => {
  const x = fixture(47);
  for (let i = 0; i < 50; i++) x.wake();
  await x.tick(); assert.equal(x.attempts.length, 20);
  await x.tick(); assert.equal(x.attempts.length, 40);
  await x.tick(); assert.deepEqual(x.attempts, Array.from({ length: 47 }, (_, i) => i));
  assert.equal(x.timers.size, 0);
});
test('a lost response backs off and retries the same ID before later rows', async () => {
  const x = fixture(2, ['pending', 'pending', 'confirmed', 'confirmed']);
  x.wake(); await x.tick(); await x.tick(); await x.tick();
  assert.deepEqual(x.attempts, [0, 0, 0, 1]);
  assert.deepEqual(x.delays, [500, 1000, 2000]);
  assert.equal(x.timers.size, 0);
});
test('hidden clients pause, resume explicitly, and disposal cancels a scheduled pass', async () => {
  const x = fixture(40); x.wake(); x.setVisible(false); await x.tick();
  assert.equal(x.attempts.length, 0); assert.equal(x.timers.size, 0);
  x.setVisible(true); x.wake(); await x.tick(); x.dispose(); x.wake();
  assert.equal(x.attempts.length, 20); assert.equal(x.timers.size, 0);
});
