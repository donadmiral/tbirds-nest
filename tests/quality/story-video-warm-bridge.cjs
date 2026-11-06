const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

function load(nativeModule) {
  const exports = {};
  const imports = {
    react: {},
    'react-native': { StyleSheet: { create: value => value } },
    'expo-modules-core': { requireNativeViewManager: () => null, requireOptionalNativeModule: () => nativeModule },
    'expo-video': {},
    '../../src/lib/useAdaptiveVideoPlayer': {},
    '../../shared/adaptiveMedia': { knownAdaptiveMedia: () => null },
    './storyComposition': { storyVideoPreviewAvailable: true },
    '../../src/components/stories/StoryPixelImage': {},
    '../../shared/storyColorMatrix': {},
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'modules/boomerang/storyVideo.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in imports)) throw new Error('Unexpected import: ' + name);
    return imports[name];
  }, Date, Promise, process: { env: {} } });
  return exports;
}

test('a synchronous native warm or clear failure never escapes optional preloading', () => {
  const bridge = load({
    warmStoryVideo() { throw new Error('Native bridge failed'); },
    clearStoryVideoWarmPool() { throw new Error('Native bridge failed'); },
  });
  assert.doesNotThrow(() => bridge.prewarmStoryVideo('https://media.example/story.mp4', 'viewer:1'));
  assert.doesNotThrow(() => bridge.clearStoryVideoWarmPool());
});

test('rejected native promises are consumed without an unhandled rejection', async () => {
  let calls = 0;
  const reject = () => { calls++; return Promise.reject(new Error('Native warm unavailable')); };
  const bridge = load({ warmStoryVideo: reject, clearStoryVideoWarmPool: reject });
  bridge.prewarmStoryVideo('https://media.example/story.mp4', 'viewer:1');
  bridge.clearStoryVideoWarmPool();
  await new Promise(setImmediate);
  assert.equal(calls, 2);
});

test('older modules without warm methods or promise return values remain compatible', () => {
  for (const nativeModule of [null, {}, { warmStoryVideo() {}, clearStoryVideoWarmPool() {} }]) {
    const bridge = load(nativeModule);
    assert.doesNotThrow(() => bridge.prewarmStoryVideo('https://media.example/story.mp4', 'viewer:1'));
    assert.doesNotThrow(() => bridge.clearStoryVideoWarmPool());
  }
});

test('only scoped HTTPS media with a usable authorization lifetime reaches the bridge', () => {
  const calls = [];
  const bridge = load({ warmStoryVideo: (...args) => { calls.push(args); } });
  const uri = 'https://media.example/story.mp4';
  bridge.prewarmStoryVideo(uri, null);
  bridge.prewarmStoryVideo('file:///tmp/private.mp4', 'viewer:1');
  bridge.prewarmStoryVideo(uri, 'viewer:1', Date.now() + 1000);
  bridge.prewarmStoryVideo(uri, 'viewer:1', Infinity);
  bridge.prewarmStoryVideo(uri, 'viewer:1', NaN);
  assert.equal(calls.length, 0);
  const deadline = Date.now() + 60000;
  bridge.prewarmStoryVideo(uri, 'viewer:1', deadline);
  assert.deepEqual(calls, [[uri, 'viewer:1', deadline]]);
});
