const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../modules/boomerang/index.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(kind = 'current', platform = 'ios') {
  const work = deferred(), calls = [], removed = [];
  const native = kind === 'absent' ? null : { make: (...args) => { calls.push(['legacy', ...args]); return work.promise; } };
  if (kind === 'current' || kind === 'partial') Object.assign(native, {
    createBoomerangJob: () => { calls.push(['reserve']); return 'job-123'; },
    makeCancellable: (...args) => { calls.push(['make', ...args]); return work.promise; },
  });
  if (kind === 'current') native.cancelBoomerang = id => { calls.push(['cancel', id]); };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Promise, Error, require(name) {
    if (name === 'expo-modules-core') return { requireOptionalNativeModule: () => native };
    if (name === 'react-native') return { Platform: { OS: platform } };
    assert.equal(name, 'expo-file-system/legacy');
    return { deleteAsync: async (...args) => { removed.push(args); } };
  } });
  return { ...module.exports, work, calls, removed, native };
}

test('the linked Android stub is not an available encoder and cannot start work', async () => {
  const h = fixture('current', 'android');
  assert.equal(h.boomerangAvailable, false);
  await assert.rejects(h.makeBoomerang('input.mp4', 'output.mp4'), /not available on Android/);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.removed, []);
});

test('the current native bridge reserves before encoding and preserves a completed output', async () => {
  const h = fixture(), controller = new AbortController();
  const result = h.makeBoomerang('input.mp4', 'output.mp4', 2, controller.signal);
  assert.deepEqual(h.calls, [['reserve'], ['make', 'job-123', 'input.mp4', 'output.mp4', 2]]);
  h.work.resolve('output.mp4');
  assert.equal(await result, 'output.mp4');
  controller.abort(); await turn();
  assert.equal(h.calls.some(c => c[0] === 'cancel'), false);
  assert.equal(h.removed.length, 0);
});

test('cancelling immediately settles the bridge and cancels exactly the reserved native job', async () => {
  const h = fixture(), controller = new AbortController();
  const result = h.makeBoomerang('input.mp4', 'output.mp4', 1, controller.signal);
  const rejected = assert.rejects(result, { name: 'AbortError' });
  controller.abort(); await rejected;
  assert.deepEqual(h.calls.filter(c => c[0] === 'cancel'), [['cancel', 'job-123']]);
  assert.equal(h.removed.length, 0, 'an active writer output is never unlinked');
  h.work.resolve('output.mp4'); await turn();
  assert.equal(h.removed.length, 1); assert.equal(h.removed[0][0], 'output.mp4');
  assert.equal(h.removed[0][1].idempotent, true);
});

test('older and partially upgraded installed builds remain compatible and discard late successful output', async () => {
  for (const kind of ['legacy', 'partial']) {
    const h = fixture(kind), controller = new AbortController();
    const result = h.makeBoomerang('input.mp4', 'output.mp4', 1, controller.signal);
    assert.deepEqual(h.calls, [['legacy', 'input.mp4', 'output.mp4', 1]]);
    const rejected = assert.rejects(result, { name: 'AbortError' }); controller.abort(); await rejected;
    assert.equal(h.removed.length, 0);
    h.work.resolve('output.mp4'); await turn(); assert.equal(h.removed.length, 1);
  }
});

test('an already cancelled request never reserves a job or starts an encoder', async () => {
  const h = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(h.makeBoomerang('input.mp4', 'output.mp4', 1, controller.signal), { name: 'AbortError' });
  assert.equal(h.calls.length, 0);
  await assert.rejects(fixture('absent').makeBoomerang('input.mp4', 'output.mp4'), /not in this build/);
});

test('native start and encode failures release the reservation without deleting a possibly active file', async () => {
  const h = fixture(); const result = h.makeBoomerang('input.mp4', 'output.mp4');
  h.work.reject(new Error('Reader failed'));
  await assert.rejects(result, /Reader failed/);
  assert.deepEqual(h.calls.filter(c => c[0] === 'cancel'), [['cancel', 'job-123']]); assert.equal(h.removed.length, 0);
  const other = fixture(); other.native.makeCancellable = () => { throw new Error('Queue unavailable'); };
  await assert.rejects(other.makeBoomerang('input.mp4', 'output.mp4'), /Queue unavailable/);
  assert.deepEqual(other.calls, [['reserve'], ['cancel', 'job-123']]);
});
