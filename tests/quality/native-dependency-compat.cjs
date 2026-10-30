const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '../..');
const fromPackage = name => createRequire(require.resolve(`${name}/package.json`));
const metroParents = ['@expo/metro', '@react-native/community-cli-plugin'];
function metroAssets(parent) {
  const pkg = fromPackage(parent).resolve('metro/package.json');
  const file = path.join(path.dirname(pkg), 'src/Assets.js');
  return { file, api: require(file) };
}
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platinum-dependency-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function png(width, height) {
  const data = new PNG({ width, height });
  data.data.fill(255);
  return PNG.sync.write(data);
}

test('Expo and React Native resolve one compatible Metro maintenance family and load their real config', () => {
  const versions = new Set();
  for (const parent of metroParents) {
    const request = fromPackage(parent);
    for (const name of Object.keys(request(`${parent}/package.json`).dependencies).filter(n => /^metro(?:-|$)/.test(n))) {
      const version = request(`${name}/package.json`).version;
      assert.match(version, /^0\.83\./, `${parent}: ${name} must stay on the reviewed patch line`);
      versions.add(version);
    }
  }
  assert.equal(versions.size, 1, 'the adapter and CLI must use one Metro patch family');
  const { getDefaultConfig } = require('expo/metro-config');
  const config = getDefaultConfig(root);
  assert.ok(config.resolver.assetExts.includes('png'));
  assert.ok(config.resolver.sourceExts.includes('tsx'));
  assert.equal(typeof require(config.transformer.babelTransformerPath).transform, 'function');
});

test('both actual Metro asset pipelines preserve dimensions, scale variants and non-image assets', async t => {
  const dir = temporary(t);
  const basic = png(3, 2);
  fs.writeFileSync(path.join(dir, 'fixture.png'), basic);
  fs.writeFileSync(path.join(dir, 'fixture@2x.png'), png(6, 4));
  fs.writeFileSync(path.join(dir, 'sound.wav'), Buffer.from('synthetic audio metadata fixture'));
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="19" height="11"><rect width="19" height="11"/></svg>');
  for (const parent of metroParents) {
    const { api } = metroAssets(parent);
    assert.deepEqual(api.getAssetSize('png', basic, 'fixture.png'), { width: 3, height: 2 });
    assert.deepEqual(api.getAssetSize('svg', svg, 'fixture.svg'), { width: 19, height: 11 });
    assert.throws(() => api.getAssetSize('png', Buffer.alloc(0), 'empty.png'), /empty/);
    const asset = await api.getAssetData(path.join(dir, 'fixture.png'), 'fixture.png', [], 'ios', '/assets');
    assert.equal(asset.width, 3); assert.equal(asset.height, 2);
    assert.deepEqual(asset.scales, [1, 2]); assert.equal(asset.files.length, 2);
    assert.match(asset.hash, /^[a-f0-9]{32}$/);
    const audio = await api.getAssetData(path.join(dir, 'sound.wav'), 'sound.wav', [], 'ios', '/assets');
    assert.equal(audio.width, undefined); assert.equal(audio.height, undefined);
    assert.equal(audio.type, 'wav');
  }
});

test('disguised zero-length ICNS, HEIF and JXL containers are rejected without hanging Metro', () => {
  const icns = Buffer.alloc(32);
  icns.write('icns'); icns.writeUInt32BE(32, 4);
  icns.write('ic07', 8); icns.writeUInt32BE(8, 12); icns.write('ic08', 16);
  const heif = Buffer.alloc(32);
  heif.write('ftyp', 4); heif.write('heic', 8);
  const jxl = Buffer.alloc(32);
  jxl.write('JXL ', 4);
  for (const parent of metroParents) {
    for (const [kind, data] of [['ICNS', icns], ['HEIF', heif], ['JXL', jxl]]) {
      // Deliberately bounded subprocesses prevent the old parser from hanging
      // the test runner or consuming unbounded memory during regression proof.
      const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e',
        `const assets=require(process.argv[1]);try{assets.getAssetSize('png',Buffer.from(process.argv[2],'base64'),'fixture.png');process.exitCode=2}catch(e){process.stdout.write('rejected')}`,
        metroAssets(parent).file, data.toString('base64')], { timeout: 2000, maxBuffer: 16384, encoding: 'utf8' });
      assert.equal(result.error, undefined, `${parent} ${kind}: parser exceeded its bounded execution`);
      assert.equal(result.status, 0, `${parent} ${kind}: expected a controlled invalid-image error`);
      assert.equal(result.stdout, 'rejected');
    }
  }
});

test('PostCSS does not read an absolute or parent source-map path from untrusted CSS', t => {
  const dir = temporary(t), publicDir = path.join(dir, 'public');
  fs.mkdirSync(publicDir);
  const marker = 'SYNTHETIC_PRIVATE_SOURCE_MAP_FIXTURE';
  const privateMap = path.join(dir, 'private.map');
  fs.writeFileSync(privateMap, JSON.stringify({ version: 3, sources: ['private.scss'], sourcesContent: [marker], names: [], mappings: 'AAAA' }));
  const postcss = fromPackage('@expo/metro-config')('postcss');
  for (const [url, from] of [[privateMap, undefined], [privateMap, path.join(publicDir, 'input.css')], ['../private.map', path.join(publicDir, 'input.css')]]) {
    const parsed = postcss.parse(`a{color:red}/*# sourceMappingURL=${url} */`, { from });
    assert.equal(parsed.source.input.map?.text?.includes(marker) || false, false);
  }
});

test('Expo actual PostCSS loader still runs configured plugins, nested rules and source maps', async t => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'postcss.config.js'), `module.exports={map:true,plugins:[root=>root.walkDecls('color',decl=>{decl.value='blue'})]};`);
  const request = fromPackage('@expo/metro-config');
  const configRoot = path.dirname(request.resolve('@expo/metro-config/package.json'));
  const { transformPostCssModule } = require(path.join(configRoot, 'build/transform-worker/postcss.js'));
  const result = await transformPostCssModule(dir, { src: '@media screen{a{color:red;--space:2px}}', filename: path.join(dir, 'input.css') });
  assert.equal(result.hasPostcss, true);
  assert.match(result.src, /color:blue/); assert.match(result.src, /@media screen/);
  assert.match(result.src, /--space:2px/); assert.match(result.src, /sourceMappingURL=data:/);
});

test('tooling UUID implementations reject undersized v5 output buffers', () => {
  for (const parent of ['xcode', '@expo/ngrok']) {
    const uuid = fromPackage(parent)('uuid');
    assert.throws(() => uuid.v5('fixture', '6ba7b810-9dad-11d1-80b4-00c04fd430c8', Buffer.alloc(8), 4), RangeError);
  }
});

test('the actual Xcode project generator retains unique 24-character identifiers', () => {
  const project = require('xcode').project('/tmp/platinum-synthetic.xcodeproj/project.pbxproj');
  project.hash = { project: { objects: { PBXBuildFile: {} } } };
  const ids = new Set();
  for (let i = 0; i < 100; i++) {
    const id = project.generateUuid(); assert.match(id, /^[A-F0-9]{24}$/); ids.add(id);
  }
  assert.equal(ids.size, 100);
});

test('the actual ngrok wrapper generates a v4 tunnel name without starting a process or network request', async () => {
  const request = fromPackage('@expo/ngrok'), source = request.resolve('@expo/ngrok');
  const module = { exports: {} }, calls = [];
  const fakeProcess = { getProcess: async () => 'http://127.0.0.1:0' };
  class NgrokClient { async startTunnel(opts) { calls.push({ ...opts }); return { public_url: 'https://synthetic.invalid' }; } }
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name === './src/process') return fakeProcess;
      if (name === './src/client') return { NgrokClient, NgrokClientError: Error };
      return request(name.startsWith('.') ? path.resolve(path.dirname(source), name) : name);
    },
  }, { filename: source });
  assert.equal(await module.exports.connect({ addr: 8081 }), 'https://synthetic.invalid');
  assert.equal(calls.length, 1);
  assert.match(calls[0].name, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('CallKeep config plugin matches Expo 54 and retains explicit calling permissions in modifier preview', async () => {
  const semver = require('semver');
  const installed = require('@config-plugins/react-native-callkeep/package.json');
  assert.equal(semver.satisfies(require('expo/package.json').version, installed.peerDependencies.expo), true);
  const { compileModsAsync } = require('expo/config-plugins');
  const actual = require(path.join(root, 'app.json')).expo;
  const config = require('@config-plugins/react-native-callkeep').default({
    name: 'Synthetic dependency preview', slug: 'synthetic-dependency-preview',
    ios: { bundleIdentifier: 'com.example.dependency', infoPlist: { UIBackgroundModes: actual.ios.infoPlist.UIBackgroundModes } },
    android: { package: 'com.example.dependency', permissions: actual.android.permissions },
  });
  const result = await compileModsAsync(config, { projectRoot: root, platforms: ['ios', 'android'], introspect: true });
  const plist = result._internal.modResults.ios.infoPlist;
  assert.ok(plist.UIBackgroundModes.includes('audio')); assert.ok(plist.UIBackgroundModes.includes('voip'));
  const manifest = result._internal.modResults.android.manifest.manifest;
  const permissions = new Set(manifest['uses-permission'].map(row => row.$['android:name']));
  for (const permission of ['RECORD_AUDIO', 'READ_PHONE_NUMBERS', 'FOREGROUND_SERVICE_MICROPHONE', 'FOREGROUND_SERVICE_PHONE_CALL'])
    assert.ok(permissions.has(`android.permission.${permission}`), permission);
  const services = manifest.application[0].service;
  assert.ok(services.some(row => row.$['android:name'] === 'io.wazo.callkeep.VoiceConnectionService'));
});

test('Daily supports the installed storage and WebRTC peers and preserves its real iOS bundle-cache behavior', async () => {
  const semver = require('semver');
  const request = fromPackage('@daily-co/react-native-daily-js');
  const info = request('@daily-co/react-native-daily-js/package.json');
  for (const name of ['@react-native-async-storage/async-storage', '@daily-co/react-native-webrtc']) {
    assert.equal(semver.satisfies(request(`${name}/package.json`).version, info.peerDependencies[name]), true, name);
  }
  const source = path.join(path.dirname(request.resolve('@daily-co/react-native-daily-js/package.json')), 'dist/iOSCallObjectBundleCache.js');
  const storage = new Map(), module = { exports: {} };
  const adapter = {
    async getItem(key) { return storage.get(key) ?? null; },
    async setItem(key, value) { storage.set(key, value); },
    async removeItem(key) { storage.delete(key); },
  };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), {
    module, exports: module.exports, Headers, Date,
    require(name) { if (name === '@react-native-async-storage/async-storage') return adapter; throw new Error(name); },
  }, { filename: source });
  const cache = module.exports.default;
  assert.equal(await cache.get('https://synthetic.invalid/call.js'), null);
  cache.initialize(adapter);
  const url = 'https://synthetic.invalid/call.js';
  await cache.set(url, 'synthetic inert bundle text', new Headers({ 'cache-control': 'max-age=60', etag: 'fixture-etag' }));
  assert.equal((await cache.get(url)).code, 'synthetic inert bundle text');
  const key = [...storage.keys()][0], record = JSON.parse(storage.get(key));
  record.expiry = Date.now() - 1000; storage.set(key, JSON.stringify(record));
  assert.equal((await cache.get(url)).refetchHeaders.get('if-none-match'), 'fixture-etag');
  storage.set(key, 'malformed JSON'); assert.equal(await cache.get(url), null);
  assert.equal(storage.has(key), false);
});
