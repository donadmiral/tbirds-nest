const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const babel = require('@babel/core');
const { createFixture } = require('../native/backend-fixture.cjs');
const { ORIGIN, BOOK, MEDIA } = require('../native/memory-fixture.cjs');
const root = path.resolve(__dirname, '../..');
const compiled = new Map();
const es = value => ({ __esModule: true, default: value });
const plain = value => JSON.parse(JSON.stringify(value));

function load(file, imports, flow = false, globals = {}) {
  if (!compiled.has(file)) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    compiled.set(file, flow ? babel.transformSync(source, {
      presets: [require.resolve('@react-native/babel-preset')], configFile: false, babelrc: false, filename: file,
    }).code : ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText);
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(file), { ...globals, __DEV__: false, module, exports: module.exports,
    require(name) {
      if (name.startsWith('@babel/runtime/helpers/')) return require(name);
      if (!Object.hasOwn(imports, name)) throw Error('Unexpected dependency: ' + file + ': ' + name);
      return imports[name];
    } });
  return module.exports;
}

// Execute the installed Asset class and RN release resolver, plus the actual QA
// fetch adapter and authority fixture. Only native file/resource delivery is
// simulated; bytes come from the real three packaged assets, without a network.
async function assetsRuntime(platform, options = {}) {
  const Platform = { OS: platform }, PixelRatio = { get: () => 1 };
  const names = Object.values(MEDIA), bytes = names.map(name => fs.readFileSync(path.join(root, 'tests/native/assets', name)));
  const metadata = names.map((name, i) => ({ __packager_asset: true,
    fileSystemLocation: '/project/tests/native/assets', httpServerLocation: '/assets/tests/native/assets',
    name: name.replace(/\.[^.]+$/, ''), type: path.extname(name).slice(1), scales: [1],
    hash: crypto.createHash('md5').update(bytes[i]).digest('hex'),
    ...(name.endsWith('.png') ? { width: bytes[i].readUInt32BE(16), height: bytes[i].readUInt32BE(20) } : {}),
  }));
  const registry = { getAssetByID: id => metadata[id - 1] };
  const utils = load('node_modules/react-native/Libraries/Image/AssetUtils.js', { '../Utilities/PixelRatio': es(PixelRatio) }, true);
  const support = load('node_modules/@react-native/assets-registry/path-support.js', {}, true);
  const resolver = load('node_modules/react-native/Libraries/Image/AssetSourceResolver.js', {
    '../Utilities/PixelRatio': es(PixelRatio), '../Utilities/Platform': es(Platform), './AssetUtils': utils,
    '@react-native/assets-registry/path-support': support, invariant: require('invariant'),
  }, true);
  const resolved = load('node_modules/react-native/Libraries/Image/resolveAssetSource.js', {
    '../NativeModules/specs/NativeSourceCode': es({ getConstants: () => ({
      scriptURL: platform === 'android' ? 'assets://index.android.bundle' : 'file:///bundle/main.jsbundle',
    }) }), './AssetSourceResolver': resolver, './AssetUtils': utils, '@react-native/assets-registry/registry': registry,
  }, true);
  const platformUtils = load('node_modules/expo-asset/src/PlatformUtils.ts', {
    'expo-constants': es({}), 'expo-modules-core': {
      requireOptionalNativeModule: () => ({ isEnabled: false, localAssets: {} }),
      requireNativeModule: () => { throw Error('Expo Go is absent in the actual release harness'); },
    }, './AssetUris': { getManifestBaseUrl() { throw Error('No remote manifest'); } },
  });
  assert.equal(platformUtils.IS_ENV_WITH_LOCAL_ASSETS, false, 'the actual scripts disable Expo Updates');
  const uris = names.map((_, i) => resolved.default(i + 1).uri);
  const files = new Map(), downloads = [], handles = [];
  const { Asset } = load('node_modules/expo-asset/src/Asset.ts', {
    '@react-native/assets-registry/registry': registry, 'expo-modules-core': { Platform },
    './AssetSources': { selectAssetSource() { throw Error('Unexpected updates resolution'); } },
    './AssetUris': { getFileExtension: uri => uri.split('.').at(-1) }, './ImageAssets': {},
    './LocalAssets': { getLocalAssetUri: () => null }, './PlatformUtils': platformUtils, './resolveAssetSource': resolved,
    './ExpoAsset': { async downloadAsync(uri, hash, type) {
      const index = uris.indexOf(uri); assert.ok(index >= 0, 'only registered asset URIs reach the native resource API');
      downloads.push({ uri, hash, type });
      const local = options.localUri || (uri.startsWith('file://') ? uri : `file:///cache/ExponentAsset-${hash}.${type}`);
      files.set(local, bytes[index]); return local;
    } },
  });
  class File {
    constructor(uri) { this.uri = uri; }
    get exists() { return options.missing !== true && files.has(this.uri); }
    get size() { return options.size ?? files.get(this.uri)?.length ?? 0; }
    open() {
      const data = files.get(this.uri); assert.ok(data); let offset = 0;
      const state = { uri: this.uri, closed: 0 }; handles.push(state);
      return { readBytes(length) { assert.equal(state.closed, 0); const value = data.subarray(offset, offset + length); offset += value.length; return value; },
        close() { state.closed++; assert.equal(state.closed, 1); } };
    }
  }
  const fixture = createFixture();
  const login = await fixture.fetch(ORIGIN + '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({
    email: fixture.profiles[0].email, password: 'FixtureOnly-2026!',
  }) });
  const session = await login.json(); assert.ok(session.access_token);
  const signed = await fixture.fetch(ORIGIN + '/functions/v1/content-media-sign', { method: 'POST',
    headers: { authorization: 'Bearer ' + session.access_token }, body: JSON.stringify({ delivery: 'no-store', references: [{ kind: 'memory_album', id: BOOK }] }),
  });
  const { urls } = await signed.json(); assert.equal(urls.length, 3);
  const imports = { 'expo-asset': { Asset }, 'expo-file-system': { File }, 'react-native': { Platform },
    './fixture-runtime.cjs': { fixtureRuntime: () => fixture } };
  names.forEach((name, i) => { imports['./assets/' + name] = options.moduleUri && i === 0 ? { uri: options.moduleUri } : i + 1; });
  const adapter = load('tests/native/expo-fetch-fixture.cjs', imports, false, { Headers });
  return { Asset, adapter, fixture, urls, names, bytes, downloads, handles };
}

for (const platform of ['android', 'ios']) for (const index of [0, 1, 2]) {
  test(`${platform} actual adapter reads only the registered packaged asset ${index + 1}`, async () => {
    const r = await assetsRuntime(platform);
    if (platform === 'android' && index < 2) {
      const original = r.Asset.fromModule(index + 1);
      assert.equal(original.downloaded, true, 'installed image compatibility shortcut is the original mismatch');
      assert.match(original.localUri, /^[a-z0-9_]+$/);
      await original.downloadAsync(); assert.equal(r.downloads.length, 0, 'the public instance shortcut does not create a file');
    }
    const response = await r.adapter.fetch(r.urls[index].url, { credentials: 'omit', redirect: 'error' });
    const reader = response.body.getReader(), chunks = [];
    for (;;) { const part = await reader.read(); if (part.done) break; chunks.push(part.value); }
    assert.deepEqual(Buffer.concat(chunks), r.bytes[index]);
    assert.equal(r.downloads.length, 1); assert.equal(r.handles[0].closed, 1);
    assert.equal(r.fixture.receipt.networkForwarded, false);
    assert.equal(r.fixture.receipt.media.at(-1).phase, 'complete');
  });
}

test('unissued media and forbidden request options cannot reach asset delivery', async () => {
  const r = await assetsRuntime('android');
  await assert.rejects(r.adapter.fetch('https://unissued.invalid/file', { credentials: 'omit', redirect: 'error' }), /not authorized/);
  for (const init of [{ credentials: 'include', redirect: 'error' }, { credentials: 'omit', redirect: 'follow' },
    { credentials: 'omit', redirect: 'error', method: 'POST' }]) {
    await assert.rejects(r.adapter.fetch(r.urls[0].url, init), /Unexpected synthetic memory request options/);
  }
  assert.equal(r.downloads.length, 0); assert.equal(r.handles.length, 0);
});

test('remote and arbitrary asset schemes are rejected before the native resource API', async () => {
  for (const uri of ['https://provider.invalid/photo.png', 'http://localhost/photo.png', 'content://provider/photo', 'data:image/png;base64,AA==', 'ftp://provider/photo.png']) {
    const r = await assetsRuntime('android', { moduleUri: uri });
    await assert.rejects(r.adapter.fetch(r.urls[0].url, { credentials: 'omit', redirect: 'error' }), /must be packaged/);
    assert.equal(r.downloads.length, 0); assert.equal(r.handles.length, 0);
  }
});

test('materialized file scheme, presence and byte bounds still fail closed', async () => {
  for (const options of [{ localUri: 'https://provider.invalid/copied.png' }, { missing: true }, { size: 0 }, { size: 8 * 1024 * 1024 + 1 }]) {
    const r = await assetsRuntime('android', options);
    await assert.rejects(r.adapter.fetch(r.urls[0].url, { credentials: 'omit', redirect: 'error' }), /not a local file|size is invalid/);
    assert.equal(r.handles.length, 0);
  }
});

test('real adapter cancellation closes a held second chunk exactly once', async () => {
  const r = await assetsRuntime('android'); r.fixture.configure({ memoryMode: 'cancel' });
  const abort = new AbortController();
  const response = await r.adapter.fetch(r.urls[2].url, { credentials: 'omit', redirect: 'error', signal: abort.signal });
  const reader = response.body.getReader(); assert.equal((await reader.read()).value.length, 1024);
  const held = reader.read(); const rejected = assert.rejects(held, error => error.name === 'AbortError');
  abort.abort(); await rejected; await reader.cancel(); reader.releaseLock();
  assert.equal(r.handles[0].closed, 1);
  assert.equal(r.fixture.receipt.media.at(-1).phase, 'cancelled');
  assert.equal(r.fixture.receipt.media.at(-1).bytes, 1024);
});

const getStateFromPath = require('@react-navigation/core/lib/commonjs/getStateFromPath').default;
const getActionFromState = require('@react-navigation/core/lib/commonjs/getActionFromState').default;
const CommonActions = require('@react-navigation/routers/lib/commonjs/CommonActions');
const StackRouter = require('@react-navigation/routers/lib/commonjs/StackRouter').default;
function entryRuntime() {
  const { linking } = load('src/navigation/linking.ts', { 'expo-linking': { createURL: () => 'platinum-circles-qa:///' },
    '@react-navigation/native': { getStateFromPath } });
  const receipt = { requests: ['already-authenticated-navigation'], accountReadbacks: [] };
  const fixture = { receipt, configure() {} }, events = [], listeners = [];
  const auth = { session: { owner: 'unchanged synthetic owner' } }, accounts = { stored: 1 };
  const imports = { 'react-native-url-polyfill/auto': {}, 'react-native': { Linking: { addEventListener: (_name, listener) => listeners.push(listener) } },
    'expo-file-system/legacy': { documentDirectory: 'file:///documents/', writeAsStringAsync() { throw Error('No receipt mutation during route setup'); } },
    './backend-fixture.cjs': { createFixture: () => { events.push('fixture'); return fixture; }, FixtureWebSocket: class {} },
    './install-fixture-transport.cjs': { installFixtureTransport: value => { assert.equal(value, fixture); events.push('transport'); } },
    './fixture-runtime.cjs': { installFixtureRuntime: value => { assert.equal(value, fixture); events.push('runtime'); } },
    expo: { registerRootComponent: () => events.push('registered') }, '@daily-co/react-native-daily-js': {},
    '../../src/navigation/linking': { linking }, '@react-navigation/native': { CommonActions, getActionFromState }, '../../App': { default() {} } };
  load('tests/native/entry.js', imports, false, { process: { env: { EXPO_PUBLIC_APP_ENV: 'qa', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key' } },
    URL, setTimeout() { throw Error('Route setup cannot schedule new fixture writes'); }, clearTimeout() {} });
  return { linking, fixture, receipt, auth, accounts, events, listeners };
}

test('actual QA capture link resets navigator routes while retaining the app runtime and cumulative receipt', () => {
  const r = entryRuntime(), originalReceipt = r.fixture.receipt, events = r.events.slice();
  const state = r.linking.getStateFromPath('ui-fixture/memory', r.linking.config);
  const router = StackRouter({ initialRouteName: 'Main' });
  const options = { routeNames: ['Main', 'MemoryAlbum', 'NativeMemoryCaptureFixture'], routeParamList: {}, routeGetIdList: {} };
  const initial = router.getInitialState(options);
  const prior = router.getStateForAction(initial, { type: 'PUSH', payload: { name: 'MemoryAlbum' } }, options);
  const oldAction = getActionFromState(state, r.linking.config);
  const oldResult = router.getStateForAction(prior, oldAction, options);
  assert.equal(oldAction.type, 'NAVIGATE'); assert.ok(oldResult.routes.some(route => route.key === prior.routes.at(-1).key));
  const action = r.linking.getActionFromState(state, r.linking.config);
  const next = router.getStateForAction(prior, action, options);
  assert.equal(action.type, 'RESET'); assert.deepEqual(plain(next.routes.map(route => route.name)), ['NativeMemoryCaptureFixture']);
  assert.ok(!next.routes.some(route => route.key === prior.routes.at(-1).key));
  assert.equal(r.fixture.receipt, originalReceipt); assert.deepEqual(r.receipt.requests, ['already-authenticated-navigation']);
  assert.deepEqual(r.auth, { session: { owner: 'unchanged synthetic owner' } }); assert.deepEqual(r.accounts, { stored: 1 });
  assert.deepEqual(r.events, events, 'no provider reinstall, App registration, fixture replacement or auth operation occurs');
});

test('noncapture links preserve the installed default action semantics', () => {
  const { linking } = entryRuntime();
  for (const path of ['feed', 'post/synthetic-post', 'ui-fixture/memory?offline=1']) {
    const state = linking.getStateFromPath(path, linking.config); assert.ok(state);
    assert.deepEqual(plain(linking.getActionFromState(state, linking.config)), plain(getActionFromState(state, linking.config)), path);
  }
});

test('a similar route name, wrong path or multiroute state cannot use the capture-only route replacement', () => {
  const { linking } = entryRuntime();
  for (const state of [
    { routes: [{ name: 'MemoryAlbum', path: 'ui-fixture/memory' }] },
    { routes: [{ name: 'NativeMemoryCaptureFixture', path: 'ui-fixture/other' }] },
    { routes: [{ name: 'Main' }, { name: 'NativeMemoryCaptureFixture', path: 'ui-fixture/memory' }] },
  ]) assert.deepEqual(plain(linking.getActionFromState(state, linking.config)), plain(getActionFromState(state, linking.config)));
});
