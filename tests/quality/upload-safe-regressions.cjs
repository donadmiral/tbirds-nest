const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/utils/uploadSafe.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function harness({ meta, native = false, compressor, manipulator } = {}) {
  const exports = {}, timers = new Map(); let timerId = 0;
  vm.runInNewContext(source, { exports, console: { log() {} }, setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), require: name => {
    if (name === './sniffMedia') return { resolveTrueMeta: async () => meta };
    if (name === 'react-native') return { TurboModuleRegistry: { get: () => native } };
    if (name === 'react-native-compressor') return { Video: compressor };
    if (name === 'expo-image-manipulator') return manipulator ?? {};
    throw new Error(`Unexpected dependency ${name}`);
  }});
  return { ...exports, timers };
}
test('unsupported video conversion cannot silently relabel QuickTime bytes as MP4', async () => {
  const h = harness({ meta: { kind: 'video', ext: 'mov', mime: 'video/quicktime' } });
  await assert.rejects(() => h.ensureUploadSafe('file:///original.mov', 'video'), /could not be converted/);
});
test('failed image conversion cannot silently relabel HEIC bytes as JPEG', async () => {
  const h = harness({ meta: { kind: 'image', ext: 'heic', mime: 'image/heic' } });
  await assert.rejects(() => h.ensureUploadSafe('file:///original.heic', 'image'), /could not be converted/);
});
test('successful image conversion uses a new file and releases native objects', async () => {
  let released = 0;
  const h = harness({ meta: { kind: 'image', ext: 'heic', mime: 'image/heic' }, manipulator: {
    ImageManipulator: { manipulate: () => ({ renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file:///converted.jpg' }), release: () => released++ }), release: () => released++ }) }, SaveFormat: { JPEG: 'jpeg' },
  }});
  const result = await h.ensureUploadSafe('file:///original.heic', 'image');
  assert.equal(result.uri, 'file:///converted.jpg'); assert.equal(result.converted, true); assert.equal(released, 2);
});
test('successful video conversion clears its timeout', async () => {
  const h = harness({ native: true, meta: { kind: 'video', ext: 'mov', mime: 'video/quicktime' }, compressor: { compress: async () => 'file:///converted.mp4' } });
  const result = await h.ensureUploadSafe('file:///original.mov', 'video');
  assert.equal(result.uri, 'file:///converted.mp4'); assert.equal(h.timers.size, 0);
});
test('timed-out conversion cancels native work and preserves the unsupported original', async () => {
  let cancelled;
  const h = harness({ native: true, meta: { kind: 'video', ext: 'mov', mime: 'video/quicktime' }, compressor: { compress: (_uri, opts) => { opts.getCancellationId('conversion-1'); return new Promise(() => {}); }, cancelCompression: id => { cancelled = id; } } });
  const result = h.ensureUploadSafe('file:///original.mov', 'video');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  h.timers.forEach(fn => fn());
  await assert.rejects(result, /could not be converted/); assert.equal(cancelled, 'conversion-1'); assert.equal(h.timers.size, 0);
});
