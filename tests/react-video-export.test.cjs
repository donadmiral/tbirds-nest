const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, imports = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name];
  }, setTimeout, clearTimeout, AbortController });
  return module.exports;
}

const shared = load('shared/reactVideoComposition.ts');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const calls = [], removed = [], copies = [], checks = [];
  let failure = null;
  const native = {
    reactVideoVersion: 1, reactCutoutVersion: 1,
    async composeReactVideo(request) {
      calls.push(plain(request));
      if (failure) throw failure;
      return { uri: request.outputUri, width: 720, height: 1280, duration: request.duration,
        bytes: 45000, segmentCount: request.segments.length, voiceMixed: request.voiceVolume > 0 };
    },
    async cancelReactVideo() {},
  };
  const bridge = load('modules/boomerang/reactComposition.ts', {
    'expo-modules-core': { requireOptionalNativeModule: () => native },
    'react-native': { Platform: { OS: 'ios' } },
    '../../shared/reactVideoComposition': shared,
  });
  const service = load('src/services/reactVideoExport.ts', {
    'expo-file-system/legacy': {
      cacheDirectory: 'file:///app/Library/Caches/',
      async deleteAsync(uri, options) { removed.push({ uri, options: plain(options) }); },
      async copyAsync(value) { copies.push(plain(value)); },
      async getInfoAsync() { return { exists: true, isDirectory: false, size: 40000 }; },
    },
    'expo-crypto': { randomUUID: () => 'fake-uuid-1234' },
    'expo-image-manipulator': { SaveFormat: { JPEG: 'jpeg' }, async manipulateAsync() { return { uri: 'file:///app/Library/Caches/photo.jpg' }; } },
    'expo-video': {},
    'react-native': { Image: { async getSize() { return { width: 720, height: 1280 }; } } },
    '../../modules/boomerang/reactComposition': bridge,
    '../../shared/reactVideoComposition': shared,
    './reactSourceAccess': {
      async assertReactSourceAccess(source) { checks.push(source); },
      async prepareReactPostSource(source) { return source; },
    },
  });
  return { ...service, calls, removed, copies, checks, fail(error) { failure = error; } };
}

const take = () => ({
  source: { uri: 'file:///app/source.jpg', kind: 'image', creatorName: 'musa' },
  sourceUri: 'file:///app/Library/Caches/source.jpg', cameraUri: 'file:///app/Library/Caches/camera.mov',
  segments: [{ start: 0, end: 293 / 30, sourceStart: 0, playing: false, volume: 0 }],
  trimStart: 0, trimEnd: 293 / 30, layout: 'pip',
  faceRect: { x: .65, y: .56, width: .3, height: .38 }, sourceZoom: 1, voiceVolume: 1,
});

test('iOS caption and source-credit capture paths reach the real export bridge as file URIs', async () => {
  const h = fixture();
  const input = { ...take(), overlayUri: '/private/var/mobile/Containers/Data/Application/app/tmp/React artwork #1?.png' };
  // This is the installed iOS view-shot tmpfile return shape. Before the
  // boundary conversion it failed validateReactRequest with the reported text.
  const result = await h.exportReactTake(input);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].overlayUri, 'file:///private/var/mobile/Containers/Data/Application/app/tmp/React%20artwork%20%231%3F.png');
  assert.equal(h.calls[0].duration, 293 / 30);
  assert.equal(h.calls[0].segments[0].end, 293 / 30);
  assert.equal(result.uri, 'file:///app/Library/Caches/pc-react-export-fake-uuid-1234.mp4');
  assert.equal(h.checks.length, 2, 'Source access remains checked before and after export');
});

test('already escaped file URIs are preserved and captures without artwork omit the native option', async () => {
  const h = fixture();
  await h.exportReactTake({ ...take(), overlayUri: 'file:///app/tmp/React%20art.png' });
  assert.equal(h.calls[0].overlayUri, 'file:///app/tmp/React%20art.png');
  await h.exportReactTake(take());
  assert.equal('overlayUri' in h.calls[1], false);
});

test('text-only source snapshots use the iOS absolute path and remain disposable', async () => {
  const h = fixture();
  const stage = await h.stageReactSource({ uri: '', kind: 'image', postId: 'original-post', text: 'Original text.' }, undefined, '/private/var/app/tmp/post text.png');
  assert.equal(h.copies.length, 1);
  assert.equal(h.copies[0].from, 'file:///private/var/app/tmp/post%20text.png');
  assert.equal(stage.uri, 'file:///app/Library/Caches/photo.jpg');
  await stage.dispose();
  await h.discardReactFile('/private/var/app/tmp/post text.png');
  assert.ok(h.removed.some(entry => entry.uri === 'file:///private/var/app/tmp/post%20text.png'));
  assert.ok(h.removed.some(entry => entry.uri === stage.uri));
});

test('native absolute photo and camera paths normalize without changing their contents', async () => {
  const h = fixture();
  await h.exportReactTake({ ...take(), sourceUri: '/private/var/app/tmp/source.jpg', cameraUri: '/private/var/app/tmp/camera.mov' });
  assert.equal(h.calls[0].sourceUri, 'file:///private/var/app/tmp/source.jpg');
  assert.equal(h.calls[0].cameraUri, 'file:///private/var/app/tmp/camera.mov');
});

test('normalization does not authorize remote files, remote file hosts, or relative capture paths', async () => {
  for (const overlayUri of ['https://example.com/art.png', 'file://host/art.png', 'file:///app/art.png?x=1', 'file:///app/art.png#x', '//host/art.png', 'art.png', '/app/\0.png']) {
    const h = fixture();
    await assert.rejects(h.exportReactTake({ ...take(), overlayUri }), /local photo or video/);
    assert.equal(h.calls.length, 0);
    await h.discardReactFile(overlayUri);
    assert.equal(h.removed.some(entry => entry.uri === overlayUri), false);
  }
});

test('an export failure still removes only its unfinished output and retains the recorded take', async () => {
  const h = fixture();
  h.fail(new Error('Native encode failed.'));
  await assert.rejects(h.exportReactTake({ ...take(), overlayUri: '/app/tmp/art.png' }), /Native encode failed/);
  assert.deepEqual(h.removed, [{ uri: 'file:///app/Library/Caches/pc-react-export-fake-uuid-1234.mp4', options: { idempotent: true } }]);
});
