const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { patchLoadControl, patchMedia3Dependencies } = require('../../plugins/withMedia3Compatibility');
const { createAutolinkingOptionsLoader } = require('../../node_modules/expo-modules-autolinking/build/commands/autolinkingOptions');

const relative = 'android/src/main/java/expo/modules/video/player/DefaultLoadControl.java';
const installedSource = fs.readFileSync(path.join('node_modules/expo-video', relative), 'utf8');
// A developer may run this after a legitimate Android prebuild. Normalize
// only the two reviewed signatures; the plugin's hash guard still rejects
// any other installed-source change.
const original = installedSource
  .replace('public Allocator getAllocator(PlayerId playerId) {', 'public Allocator getAllocator() {')
  .replace('public boolean shouldContinuePreloading(\n    PlayerId playerId, Timeline timeline, MediaPeriodId mediaPeriodId, long bufferedDurationUs) {',
    'public boolean shouldContinuePreloading(\n    Timeline timeline, MediaPeriodId mediaPeriodId, long bufferedDurationUs) {');
const installed = require('expo-video/package.json').version;
const originalGradle = fs.readFileSync('node_modules/expo-video/android/build.gradle', 'utf8')
  .replace('def androidxMedia3Version = "1.11.1"', 'def androidxMedia3Version = "1.8.0"');

test('the real Expo options loader selects the adapted Android module sources and retains the Apple options', async () => {
  const loader = createAutolinkingOptionsLoader({ projectRoot: process.cwd() });
  assert.deepEqual((await loader.getPlatformOptions('android')).buildFromSource, ['expo-video', 'expo-file-system']);
  assert.equal((await loader.getPlatformOptions('apple')).buildFromSource, undefined);
});

test('the Expo library compile scope changes only its guarded Media3 version scalar', () => {
  const adapted = patchMedia3Dependencies(originalGradle, installed);
  assert.equal(adapted.replace('def androidxMedia3Version = "1.11.1"', 'def androidxMedia3Version = "1.8.0"'), originalGradle);
  assert.equal(patchMedia3Dependencies(adapted, installed), adapted);
  assert.equal((adapted.match(/implementation "androidx\.media3:/g) || []).length, 6);
  assert.throws(() => patchMedia3Dependencies(originalGradle + '\n', installed), /differs from the reviewed distribution/);
  assert.throws(() => patchMedia3Dependencies(originalGradle, '3.0.17'), /pinned expo-video version/);
});

test('the installed pinned Expo load control changes only the two Media3 interface signatures', () => {
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), 'edc43515ed73af65f4ec142684f7e95ee2b9f84475619df7fcfa28a0f0ff3ae1');
  assert.equal(patchLoadControl(installedSource, installed), patchLoadControl(original, installed));
  const adapted = patchLoadControl(original, installed);
  const restored = adapted.replace('public Allocator getAllocator(PlayerId playerId) {', 'public Allocator getAllocator() {')
    .replace('public boolean shouldContinuePreloading(\n    PlayerId playerId, Timeline timeline, MediaPeriodId mediaPeriodId, long bufferedDurationUs) {',
      'public boolean shouldContinuePreloading(\n    Timeline timeline, MediaPeriodId mediaPeriodId, long bufferedDurationUs) {');
  assert.equal(restored, original);
  assert.match(adapted, /public Allocator getAllocator\(PlayerId playerId\) \{\s+return allocator;/);
  assert.equal(patchLoadControl(adapted, installed), adapted);
});

test('unknown distributions, unexpected changes and a changed version fail closed', () => {
  for (const source of [original + '\n', original.replace('return allocator;', 'return null;'), original.replace('getAllocator()', 'changedAllocator()')]) {
    assert.throws(() => patchLoadControl(source, installed), /differs from the reviewed distribution/);
  }
  assert.throws(() => patchLoadControl(original, '3.0.17'), /pinned expo-video version/);
  assert.throws(() => patchLoadControl(patchLoadControl(original, installed), '3.0.17'), /pinned expo-video version/);
});

test('the actual Android plugin applies idempotently to a disposable installed package and leaves iOS unregistered', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-media3-plugin-'));
  const sourceFile = path.join(directory, 'node_modules/expo-video', relative);
  const gradleFile = path.join(directory, 'node_modules/expo-video/android/build.gradle');
  let captured;
  const module = { exports: {} };
  const ownRequire = name => name === '@expo/config-plugins' ? { withDangerousMod: (config, value) => {
    assert.equal(value[0], 'android'); captured = value[1]; return config;
  } } : require(name);
  ownRequire.resolve = require.resolve;
  try {
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, original);
    fs.writeFileSync(gradleFile, originalGradle);
    fs.writeFileSync(path.join(directory, 'node_modules/expo-video/package.json'), JSON.stringify({ name: 'expo-video', version: installed }));
    vm.runInNewContext(fs.readFileSync('plugins/withMedia3Compatibility.js', 'utf8'), { module, require: ownRequire });
    const config = { modRequest: { projectRoot: directory } };
    assert.equal(module.exports(config), config); assert.equal(await captured(config), config);
    const adapted = fs.readFileSync(sourceFile, 'utf8'); assert.equal(adapted, patchLoadControl(original, installed));
    assert.equal(fs.readFileSync(gradleFile, 'utf8'), patchMedia3Dependencies(originalGradle, installed));
    await captured(config); assert.equal(fs.readFileSync(sourceFile, 'utf8'), adapted);
    fs.writeFileSync(sourceFile, original);
    fs.writeFileSync(gradleFile, originalGradle + '// unexpected');
    await assert.rejects(captured(config), /Gradle source differs/);
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), original, 'both source inputs validate before either is written');
    fs.writeFileSync(gradleFile, originalGradle);
    fs.writeFileSync(sourceFile, original + '// unexpected');
    await assert.rejects(captured(config), /differs from the reviewed distribution/);
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), original + '// unexpected');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('the app, production module, standalone instrumentation and graph verifier select the same reviewed dependency', () => {
  const plugins = JSON.parse(fs.readFileSync('app.json')).expo.plugins;
  assert.equal(plugins.filter(value => value === './plugins/withMedia3Compatibility').length, 1);
  for (const file of ['modules/boomerang/android/build.gradle', 'scripts/quality/android-story-export/build.gradle']) {
    const source = fs.readFileSync(file, 'utf8');
    const coordinates = [...source.matchAll(/implementation 'androidx\.media3:([^:]+):([^']+)'/g)];
    assert.deepEqual(coordinates.map(row => [row[1], row[2]]), [['media3-transformer', '1.11.1'], ['media3-effect', '1.11.1'], ['media3-common', '1.11.1']]);
  }
  const graph = fs.readFileSync('scripts/quality/android-media-dependencies.init.gradle', 'utf8');
  assert.match(graph, /resolved\.any \{ it\.version != '1\.11\.1' \}/);
  assert.match(graph, /modules\.containsAll\(required\)/);
  for (const file of ['scripts/quality/test-android-story-audio.sh',
    'scripts/quality/android-story-export/src/androidTest/java/expo/modules/boomerang/StoryAudioExportTest.kt',
    'scripts/quality/android-story-export/src/androidTest/java/expo/modules/boomerang/MemoryMovieExportTest.kt']) {
    assert.match(fs.readFileSync(file, 'utf8'), /1\.11\.1/); assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /1\.8\.1/);
  }
  const fullApp = fs.readFileSync('scripts/quality/test-android-app-ui.sh', 'utf8');
  const abi = fullApp.indexOf('python3 scripts/quality/native-ui-android-media-abi.py --apk');
  assert.ok(abi > fullApp.indexOf(':app:assembleRelease'));
  assert.ok(abi < fullApp.indexOf('cp "$apk" native-audit-build/app-release.apk'));
  assert.ok(abi < fullApp.indexOf('"$adb_bin" install -r "$apk"'));
  assert.match(fullApp, /platinumStoryMediaConfiguration=releaseRuntimeClasspath -PplatinumRequireExpoVideoSource=true/);
  const compile = fs.readFileSync('scripts/quality/compile-android-native.sh', 'utf8');
  assert.match(compile, /platinumRequireExpoVideoSource=true/);
  assert.match(compile, /native-ui-android-media-abi\.py/);
});

test('the exact full-app B-frame video is packaged into instrumentation and retained by its source manifest', () => {
  const gradle = fs.readFileSync('scripts/quality/android-story-export/build.gradle', 'utf8');
  const source = fs.readFileSync('scripts/quality/android-story-export/src/androidTest/java/expo/modules/boomerang/MemoryMovieExportTest.kt', 'utf8');
  assert.match(gradle, /from '\.\.\/\.\.\/\.\.\/tests\/native\/assets'[\s\S]*include 'memory-capture-video\.mp4'/);
  assert.match(gradle, /dependsOn 'copyMemoryCaptureFixture'/);
  assert.match(source, /@Test fun reorderedBFramesSurviveTheTrimEndBeforeTheNextPage/);
  assert.match(source, /context\.assets\.open\("memory-capture-video\.mp4"\)/);
  assert.match(source, /Every in-range source frame must reach the video page",45/);
  assert.match(source, /after-before<=40_000/);
  assert.match(fs.readFileSync('scripts/quality/test-android-story-audio.sh', 'utf8'), /fixtures\.append\(root \/ 'tests\/native\/assets\/memory-capture-video\.mp4'\)/);
});
