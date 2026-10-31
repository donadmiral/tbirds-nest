const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
const source = ['App.tsx', 'index.js', 'app.config.js', 'package-lock.json', ...files('src'), ...files('shared'),
  ...files('modules/boomerang/ios'), ...files('modules/boomerang/android/src/main'), ...files('tests/native'),
  'modules/boomerang/memoryComposition.ts',
  'scripts/quality/prepare-native-ui.cjs', 'scripts/quality/native-ui-auth-overlay.cjs', 'scripts/quality/native-ui-ios-entitlements.py', 'scripts/quality/verify-native-ui.cjs',
  'scripts/quality/install-native-ui-tools.sh', 'scripts/quality/test-ios-app-ui.sh',
  'scripts/quality/test-android-app-ui.sh', 'scripts/quality/verify-native-ui-memory.py', '.github/workflows/native-app-ui.yml'];
const hashes = Object.fromEntries(source.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
// Capture installed distributions before overlays; this does not change SDK resolution or code.
const dependencyFiles = {
  '@supabase/supabase-js': ['package.json', 'dist/index.cjs', 'dist/index.mjs'],
  '@supabase/auth-js': ['package.json', 'src/lib/locks.ts', 'dist/main/index.js', 'dist/module/index.js', 'dist/main/lib/locks.js', 'dist/module/lib/locks.js'],
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
const navigatorSource = fs.readFileSync(navigator, 'utf8');
const anchor = '<RootStack.Screen name="MemoryAlbum"          component={MemoryAlbumScreen} />';
if (navigatorSource.split(anchor).length !== 2) throw new Error('Expected the single authenticated memory route anchor.');
overlay(navigator, navigatorSource.replace(anchor, anchor + '\n                <RootStack.Screen name="NativeMemoryCaptureFixture" component={require(\'../../tests/native/MemoryCaptureFixtureScreen\').default} />'),
  'Register one synthetic capture route inside the unchanged production auth, call and safe-area providers.');
overlay('metro.config.js', "module.exports = require('./tests/native/metro-config.cjs')(__dirname);\n",
  'Only packaged synthetic bytes for expo/fetch; production capture/export delegation records actual returned files. No network fallback.');
overlay('index.js', "require('./tests/native/entry');\n", 'Install the isolated synthetic HTTP/Realtime transport before the actual App imports.');
fs.writeFileSync('native-ui-logs/source.json', JSON.stringify({ commit: process.env.GITHUB_SHA, workflowRun: process.env.GITHUB_RUN_ID,
  mode: 'Complete production App and screens with isolated synthetic transports and a CI-only capture route',
  capabilityMode, sourceMemoryCapability: versions[0], overlays, hashes, dependencyProvenance }, null, 2) + '\n');
console.log('Saved exact production/fixture hashes and explicit disposable overlays; renderer and export service are unchanged.');
