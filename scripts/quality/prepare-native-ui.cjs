const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { memoryFailureIdentityOverlay, memoryDependencyFiles } = require('./native-ui-memory-failure-overlay.cjs');
const { EXPECTED_BYTES, EXPECTED_SHA256 } = require('../../tests/native/memory-failure-identity.cjs');
if (process.env.CI !== 'true' || process.env.EXPO_PUBLIC_APP_ENV !== 'qa'
  || process.env.EXPO_PUBLIC_SUPABASE_URL !== 'https://uaulhuelcfkjwojtymmw.supabase.co'
  || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'native-ui-synthetic-no-provider-key') {
  throw new Error('Full-app UI tests require a disposable QA checkout and the synthetic transport key.');
}
if (fs.existsSync('ios') || fs.existsSync('android')) throw new Error('Refusing to overwrite an existing native project.');
if (fs.existsSync('metro.config.js')) throw new Error('Refusing to replace an existing Metro configuration.');
const original = fs.readFileSync('index.js', 'utf8');
if (original.includes('tests/native')) throw new Error('This checkout already contains a UI entry overlay.');
fs.mkdirSync('native-ui-logs/screenshots', { recursive: true });
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const file = path.join(directory, item.name);
    return item.isDirectory() ? files(file) : /\.(?:[cm]?[jt]sx?|swift|kt|ya?ml|sh|py|png|mp4)$/.test(file) ? [file] : [];
  });
}
const source = ['App.tsx', 'index.js', 'app.config.js', 'app.json', 'package.json', 'package-lock.json', ...files('src'), ...files('shared'),
  'plugins/withMedia3Compatibility.js', 'modules/boomerang/android/build.gradle', 'scripts/quality/android-media-dependencies.init.gradle',
  'scripts/quality/native-ui-android-media-abi.py',
  ...files('modules/boomerang/ios'), ...files('modules/boomerang/android/src/main'), ...files('tests/native'),
  'modules/boomerang/memoryComposition.ts', 'scripts/quality/native-ui-feed-video-overlay.cjs',
  'scripts/quality/prepare-native-ui.cjs', 'scripts/quality/native-ui-auth-overlay.cjs', 'scripts/quality/native-ui-navigation-overlay.cjs', 'scripts/quality/native-ui-input-overlay.cjs', 'scripts/quality/native-ui-memory-failure-overlay.cjs', 'scripts/quality/native-ui-ios-entitlements.py', 'scripts/quality/native-ui-ios-url-trace.py', 'scripts/quality/native-ui-ios-input-trace.py', 'scripts/quality/verify-native-ui.cjs',
  'scripts/quality/install-native-ui-tools.sh', 'scripts/quality/run-native-ui-flows.sh', 'scripts/quality/native-ui-flow-results.py', 'scripts/quality/test-ios-app-ui.sh',
  'scripts/quality/test-android-app-ui.sh', 'scripts/quality/native-ui-xvfb-readiness.py', 'scripts/quality/native-ui-emulator-diagnostics.py', 'scripts/quality/native-ui-emulator-graphics.py', 'scripts/quality/native-ui-emulator-host-diagnostics.py', 'scripts/quality/verify-native-ui-memory.py', '.github/workflows/native-app-ui.yml', '.github/workflows/live-native-input-diagnostics.yml'];
const hashes = Object.fromEntries(source.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const memoryFixturePath = 'tests/native/assets/memory-capture-video.mp4';
if (fs.statSync(memoryFixturePath).size !== EXPECTED_BYTES || hashes[memoryFixturePath] !== EXPECTED_SHA256) {
  throw new Error('The failure-only memory diagnostic requires the exact reviewed synthetic video.');
}
const memoryFailureIdentity = { fixture: memoryFixturePath, bytes: EXPECTED_BYTES, sha256: EXPECTED_SHA256,
  failureOnly: true, maximumRecords: 2, maximumReadBytes: EXPECTED_BYTES + 1,
  synchronousNativeIoHasWallClockBound: false,
  originalService: 'src/services/memoryMovieExport.ts',
  receipt: 'memory-capture/failed-video-file-identity.json' };
// Capture installed distributions before overlays; this does not change SDK resolution or code.
const dependencyFiles = {
  '@supabase/supabase-js': ['package.json', 'dist/index.cjs', 'dist/index.mjs'],
  '@supabase/auth-js': ['package.json', 'src/lib/locks.ts', 'dist/main/index.js', 'dist/module/index.js', 'dist/main/lib/locks.js', 'dist/module/lib/locks.js'],
  'react-native': ['package.json', 'index.js', 'Libraries/Pressability/Pressability.js', 'Libraries/Pressability/PressabilityPerformanceEventEmitter.js', 'Libraries/Pressability/PressabilityTypes.js', 'Libraries/Utilities/PixelRatio.js', 'Libraries/Utilities/Dimensions.js'],
  'react-native-view-shot': ['package.json', 'src/index.js', 'ios/RNViewShot.mm', 'android/src/main/java/fr/greweb/reactnativeviewshot/RNViewShotModule.java', 'android/src/main/java/fr/greweb/reactnativeviewshot/ViewShot.java'],
  ...memoryDependencyFiles,
};
const lockPackages = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages;
const dependencyProvenance = Object.fromEntries(Object.entries(dependencyFiles).map(([name, selected]) => {
  const relativeRoot = 'node_modules/' + name, manifest = JSON.parse(fs.readFileSync(path.join(relativeRoot, 'package.json'), 'utf8'));
  const locked = lockPackages[relativeRoot];
  return [name, {
    installedVersion: manifest.version, lockedVersion: locked?.version ?? null,
    matchesLockedVersion: manifest.version === locked?.version,
    requireEntry: path.relative(process.cwd(), require.resolve(name, { paths: [process.cwd()] })).split(path.sep).join('/'),
    main: manifest.main ?? null, module: manifest.module ?? null,
    files: Object.fromEntries(selected.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(relativeRoot, file))).digest('hex')])),
  }];
}));
const overlays = [];
fs.mkdirSync('native-ui-logs/overlays', { recursive: true });
function overlay(file, value, reason) {
  const before = fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
  fs.writeFileSync(file, value);
  const after = crypto.createHash('sha256').update(value).digest('hex');
  const retained = 'overlays/' + file.replaceAll('/', '__');
  fs.writeFileSync(path.join('native-ui-logs', retained), value);
  overlays.push({ file, before, after, reason, retained });
}
const authSource = 'src/services/supabase.ts';
const { nativeAuthOverlay } = require('./native-ui-auth-overlay.cjs');
overlay(authSource, nativeAuthOverlay(fs.readFileSync(authSource, 'utf8')),
  'Disposable QA-only lock and auth-storage timing observation. Original SDK processLock, timeouts, arguments, results and errors are preserved; no keys or session contents are recorded.');
overlay(memoryFailureIdentity.originalService,
  memoryFailureIdentityOverlay(fs.readFileSync(memoryFailureIdentity.originalService, 'utf8')),
  'Disposable QA-only file identity observation after the original duration call rejects and before export cleanup. Only the exact synthetic iOS video is read. No success-path read, player operation, timeout, result or original error changes. Synchronous post-failure I/O has no guaranteed wall-clock deadline.');
const bridges = [
  ['modules/boomerang/ios/BoomerangModule.swift', /Constant\("memoryMovieVersion"\) \{ ([01]) \}/g],
  ['modules/boomerang/android/src/main/java/expo/modules/boomerang/BoomerangModule.kt', /"memoryMovieVersion" to ([01])/g],
];
const versions = bridges.map(([file, pattern]) => {
  const matches = [...fs.readFileSync(file, 'utf8').matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Expected one reviewed memory capability declaration in ' + file);
  return Number(matches[0][1]);
});
if (versions[0] !== versions[1]) throw new Error('The two native memory capability declarations disagree.');
const capabilityMode = versions[0] === 0 ? 'qa-capability-overlay' : 'production-capability';
if (versions[0] === 0) for (const [file, pattern] of bridges) {
  overlay(file, fs.readFileSync(file, 'utf8').replace(pattern, match => match.replace('0', '1')),
    'Disposable QA-only declaration: exercise the independently accepted renderer through the real JS capability check.');
}
const navigator = 'src/navigation/AppNavigator.tsx';
const { navigationTimingOverlay, inboxTimingOverlay } = require('./native-ui-navigation-overlay.cjs');
const inputOverlays = require('./native-ui-input-overlay.cjs');
const { feedVideoOverlay, feedRefreshOverlay } = require('./native-ui-feed-video-overlay.cjs');
overlay('src/components/PostCarousel.tsx', feedVideoOverlay(fs.readFileSync('src/components/PostCarousel.tsx', 'utf8')),
  'Disposable native playback accessibility observation of actual first frame, ownership, source readiness and progressing native clock. No player callbacks or behavior changes.');
overlay('src/screens/feed/FeedScreen.tsx', feedRefreshOverlay(fs.readFileSync('src/screens/feed/FeedScreen.tsx', 'utf8')),
  'Disposable observation of the original refresh promise and actual get_feed request count before and after it. Original work, results and errors remain unchanged.');
const navigatorSource = inputOverlays.navigationInputOverlay(navigationTimingOverlay(fs.readFileSync(navigator, 'utf8')));
for (const [file, transform] of [
  ['src/components/LiveUi.tsx', inputOverlays.liveUiInputOverlay],
  ['src/screens/feed/LiveStreamsScreen.tsx', inputOverlays.liveDirectoryInputOverlay],
  ['src/screens/feed/NewLiveScreen.tsx', inputOverlays.newLiveInputOverlay],
  ['src/screens/profile/MemoryAlbumScreen.tsx', inputOverlays.memoryInputOverlay],
]) overlay(file, transform(fs.readFileSync(file, 'utf8')),
  'Disposable QA-only bounded touch, press, navigation, lifecycle and commit observations. Original callbacks, state updates, transport requests and visible content are preserved. No input payloads or identities are recorded.');
const inbox = 'src/screens/messages/ConversationsScreen.tsx';
overlay(inbox, inboxTimingOverlay(fs.readFileSync(inbox, 'utf8')),
  'Disposable QA-only committed inbox, native row layout and animation-frame timestamps. No loading, navigation or content behavior changes.');
const anchor = '<RootStack.Screen name="MemoryAlbum"          component={MemoryAlbumScreen} />';
if (navigatorSource.split(anchor).length !== 2) throw new Error('Expected the single authenticated memory route anchor.');
overlay(navigator, navigatorSource.replace(anchor, anchor + '\n                <RootStack.Screen name="NativeMemoryCaptureFixture" component={require(\'../../tests/native/MemoryCaptureFixtureScreen\').default} />'),
  'Register one synthetic capture route and observe tab presses plus sanitized root navigation commits inside the unchanged production auth, call and safe-area providers.');
overlay('metro.config.js', "module.exports = require('./tests/native/metro-config.cjs')(__dirname);\n",
  'Only packaged synthetic bytes for expo/fetch; production capture/export delegation records actual returned files. No network fallback.');
overlay('index.js', "require('./tests/native/entry');\n", 'Install the isolated synthetic HTTP/Realtime transport before the actual App imports.');
fs.writeFileSync('native-ui-logs/source.json', JSON.stringify({ commit: process.env.GITHUB_SHA, workflowRun: process.env.GITHUB_RUN_ID,
  mode: 'Complete production App and screens with isolated synthetic transports and a CI-only capture route',
  capabilityMode, sourceMemoryCapability: versions[0], overlays, hashes, dependencyProvenance, memoryFailureIdentity }, null, 2) + '\n');
console.log('Saved exact production/fixture/dependency hashes and explicit disposable overlays. Renderer and export success path are unchanged; the exporter has a failure-only synthetic-file identity observer before cleanup.');
