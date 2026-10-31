const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = file => ts.transpileModule(source(file), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, allowJs: true },
}).outputText;
const dailySource = source('node_modules/@daily-co/react-native-daily-js/dist/index.js');
const backgroundSource = compile('node_modules/react-native-background-timer/index.js');
const lockSource = source('node_modules/@supabase/auth-js/dist/main/lib/locks.js');
const diagnosticSource = source('tests/native/auth-diagnostics.cjs');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

// Real SDK/Daily/BackgroundTimer implementations share one isolated VM global.
// Only native modules, app screens and timer delivery are synthetic; host timers
// are never replaced and no provider, network or device operation is performed.
function runtime({ platform = 'android', qa = false, env = {} } = {}) {
  let now = 0, nativeId = 0, backgroundDelivery, dailyExports, appWork, callbackRuns = 0;
  const nativeTimers = new Map(), backgroundSchedules = new Map(), warnings = [], events = [];
  const result = { retained: 'original result reference' };
  const fixture = { fetch() { throw Error('Unexpected fixture transport request'); }, configure() {} };
  const linking = { prefixes: [], config: { screens: {} } };
  let runtimeInstalled = false, transportInstalled = false, dailyLoads = 0;
  const setNative = (callback, delay) => { const id = ++nativeId; nativeTimers.set(id, { callback, due: now + delay }); return id; };
  const clearNative = id => nativeTimers.delete(id);
  class Emitter {
    addListener(name, callback) { if (name === 'backgroundTimer.timeout') backgroundDelivery = callback; return { remove() {} }; }
  }
  const reactNative = {
    NativeModules: {
      RNBackgroundTimer: { setTimeout(id, delay) { backgroundSchedules.set(id, now + delay); }, start() {}, stop() {} },
      DailyNativeUtils: {}, WebRTCModule: {},
    },
    NativeEventEmitter: Emitter, DeviceEventEmitter: new Emitter(), NativeAppEventEmitter: new Emitter(),
    Platform: { OS: platform, select: options => options[platform] || options.default },
    AppState: { currentState: 'active', addEventListener() { return { remove() {} }; } },
    Linking: { addEventListener() { return { remove() {} }; } },
  };
  const sandbox = {
    console: { log() {}, error() {}, warn: (...args) => warnings.push(args.map(String).join(' ')) },
    process: { env: { EXPO_PUBLIC_APP_ENV: 'qa', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key', ...env } },
    setTimeout: setNative, clearTimeout: clearNative, setInterval: setNative, clearInterval: clearNative,
  };
  sandbox.global = sandbox;
  const context = vm.createContext(sandbox);
  function evaluate(text, filename, requireDependency) {
    const module = { exports: {} };
    const fn = vm.runInContext('(function(require,module,exports){\n' + text + '\n})', context, { filename });
    fn(requireDependency, module, module.exports);
    return module.exports;
  }
  const background = evaluate(backgroundSource, 'react-native-background-timer/index.js', name => {
    assert.equal(name, 'react-native'); return reactNative;
  }).default;
  const lock = evaluate(lockSource, '@supabase/auth-js/lib/locks.js', name => {
    assert.equal(name, './helpers');
    return { supportsLocalStorage: () => false }; // Native environment has no browser localStorage.
  }).processLock;
  const diagnostics = evaluate(diagnosticSource, 'tests/native/auth-diagnostics.cjs', () => {
    throw Error('The pure diagnostic factory must not load native filesystem modules.');
  }).createAuthDiagnostics({ now: () => now, wallNow: () => 1700000000000 + now });
  function loadDaily() {
    if (dailyExports) return dailyExports;
    if (qa) {
      assert.ok(runtimeInstalled && transportInstalled, 'QA guards and synthetic transports must precede Daily initialization.');
      assert.equal(sandbox.fetch, fixture.fetch);
    }
    events.push('daily'); dailyLoads++;
    dailyExports = evaluate(dailySource, '@daily-co/react-native-daily-js/dist/index.js', name => {
      if (name === 'react-native') return reactNative;
      if (name === 'react-native-background-timer') return background;
      if (name === '@daily-co/react-native-webrtc') return { registerGlobals() { sandbox.window = sandbox; } };
      if (name === './iOSCallObjectBundleCache') return { initialize() {} };
      if (name === 'base-64') return { encode: text => Buffer.from(text).toString('base64'), decode: text => Buffer.from(text, 'base64').toString() };
      if (['@daily-co/daily-js', './DailyMediaView', '@react-native-async-storage/async-storage', 'react-native-url-polyfill/auto', 'react-native-get-random-values'].includes(name)) return {};
      throw Error('Unexpected Daily dependency: ' + name);
    });
    return dailyExports;
  }
  function startAuth() {
    if (!appWork) {
      events.push('auth');
      appWork = diagnostics.wrapLock(lock)('synthetic-startup', 5000, async () => { callbackRuns++; return result; });
      // Models the existing AppNavigator path: auth dependencies are evaluated
      // before CallContext, whose import also requests this cached Daily module.
      loadDaily();
    }
    return appWork;
  }
  function App() {}
  function requireEntry(name) {
    if (name === 'expo') return { registerRootComponent(app) { assert.equal(app, App); events.push('registered'); } };
    if (name === '@daily-co/react-native-daily-js') return loadDaily();
    if (name === './App' || name === '../../App') { startAuth(); return { default: App }; }
    if (name === 'react-native') return reactNative;
    if (name === 'react-native-url-polyfill/auto') return {};
    if (name === 'expo-file-system/legacy') return { documentDirectory: 'synthetic:///', writeAsStringAsync: async () => {} };
    if (name === './backend-fixture.cjs') return { createFixture() { events.push('fixture'); return fixture; }, FixtureWebSocket: class {} };
    if (name === './fixture-runtime.cjs') return { installFixtureRuntime(value) { assert.equal(value, fixture); runtimeInstalled = true; events.push('runtime'); } };
    if (name === './install-fixture-transport.cjs') return { installFixtureTransport(value) { assert.equal(value, fixture); transportInstalled = true; sandbox.fetch = fixture.fetch; events.push('transport'); } };
    if (name === '../../src/navigation/linking') {
      // Treat the first app dependency as auth-capable, so the QA bootstrap
      // contract remains correct even if linking later acquires an auth import.
      events.push('linking'); startAuth(); return { linking };
    }
    if (name === '@react-navigation/native') return {
      CommonActions: require('@react-navigation/routers/lib/commonjs/CommonActions'),
      getActionFromState: require('@react-navigation/core/lib/commonjs/getActionFromState').default,
    };
    throw Error('Unexpected entry dependency: ' + name);
  }
  function loadEntry(file) { return evaluate(compile(file), file, requireEntry); }
  async function completeStartup() {
    now = 100;
    assert.equal(await appWork, result);
    assert.equal(callbackRuns, 1);
    return { nativeTimers: nativeTimers.size, backgroundCallbacks: Object.keys(background.callbacks).length };
  }
  function deliverTimers(at) {
    now = at;
    for (const [id, timer] of [...nativeTimers]) if (timer.due <= at) { nativeTimers.delete(id); timer.callback(); }
    for (const [id, due] of [...backgroundSchedules]) if (due <= at) { backgroundSchedules.delete(id); backgroundDelivery(id); }
  }
  return { loadEntry, startAuth, completeStartup, deliverTimers, warnings, events, linking, lock, diagnostics,
    get dailyLoads() { return dailyLoads; }, get callbackRuns() { return callbackRuns; },
  };
}

test('actual Android Daily timer replacement leaves the earlier SDK acquisition timeout alive after fulfilled auth', async () => {
  const r = runtime(); r.startAuth();
  assert.deepEqual(await r.completeStartup(), { nativeTimers: 1, backgroundCallbacks: 0 });
  assert.equal(r.warnings.length, 0);
  const phases = r.diagnostics.snapshot().events;
  assert.notEqual(phases[0].timerApis.setTimeout.id, phases[1].timerApis.setTimeout.id);
  assert.notEqual(phases[0].timerApis.clearTimeout.id, phases[1].timerApis.clearTimeout.id);
  r.deliverTimers(5000);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /acquisition timed out after 5000ms/);
});

test('actual production entry initializes Daily once before auth and the SDK cancels its original acquisition timeout', async () => {
  const r = runtime(); r.loadEntry('index.js');
  assert.deepEqual(await r.completeStartup(), { nativeTimers: 0, backgroundCallbacks: 0 });
  assert.ok(r.events.indexOf('daily') < r.events.indexOf('auth'));
  assert.equal(r.dailyLoads, 1);
  assert.equal(r.events.filter(event => event === 'registered').length, 1);
  r.deliverTimers(5000); assert.deepEqual(r.warnings, []);
  const phases = r.diagnostics.snapshot().events;
  assert.ok(phases.every(row => row.timerApis.setTimeout.id === phases[0].timerApis.setTimeout.id && row.timerApis.clearTimeout.id === phases[0].timerApis.clearTimeout.id));
});

test('actual QA entry installs its guarded transports before Daily and initializes timers before linking or App auth', async () => {
  const r = runtime({ qa: true }); r.loadEntry('tests/native/entry.js');
  assert.deepEqual(await r.completeStartup(), { nativeTimers: 0, backgroundCallbacks: 0 });
  assert.ok(r.events.indexOf('transport') < r.events.indexOf('daily'));
  assert.ok(r.events.indexOf('daily') < r.events.indexOf('linking'));
  assert.ok(r.events.indexOf('daily') < r.events.indexOf('auth'));
  assert.equal(r.dailyLoads, 1);
  assert.deepEqual(r.linking.prefixes, ['platinum-circles-qa://']);
  assert.equal(r.linking.config.screens.NativeMemoryCaptureFixture, 'ui-fixture/memory');
  r.deliverTimers(5000); assert.deepEqual(r.warnings, []);
});

test('production or real-provider QA configuration cannot initialize Daily or app auth', () => {
  for (const env of [{ EXPO_PUBLIC_APP_ENV: 'production' }, { EXPO_PUBLIC_SUPABASE_ANON_KEY: 'not-the-synthetic-key' }]) {
    const r = runtime({ qa: true, env });
    assert.throws(() => r.loadEntry('tests/native/entry.js'), /isolated native UI entry cannot use a provider credential or production configuration/);
    assert.equal(r.dailyLoads, 0); assert.equal(r.callbackRuns, 0); assert.equal(r.events.length, 0);
  }
});

test('actual iOS Daily entry does not replace timer registries during an existing SDK acquisition', async () => {
  const r = runtime({ platform: 'ios' }); r.startAuth();
  assert.deepEqual(await r.completeStartup(), { nativeTimers: 0, backgroundCallbacks: 0 });
  r.deliverTimers(5000); assert.deepEqual(r.warnings, []);
  const phases = r.diagnostics.snapshot().events;
  assert.equal(phases[0].timerApis.setTimeout.id, phases[1].timerApis.setTimeout.id);
  assert.equal(phases[0].timerApis.clearTimeout.id, phases[1].timerApis.clearTimeout.id);
});

test('bootstrapped actual SDK lock still excludes work and rejects at its configured 5000 ms acquisition deadline', async () => {
  const r = runtime(); r.loadEntry('index.js'); await r.completeStartup();
  const entered = deferred(), release = deferred(); let waiterCalls = 0;
  const holder = r.lock('contention', 5000, async () => { entered.resolve(); await release.promise; return 'holder'; });
  await entered.promise;
  const waiter = r.lock('contention', 5000, async () => { waiterCalls++; return 'waiter'; });
  const rejected = assert.rejects(waiter, error => error.isAcquireTimeout === true);
  r.deliverTimers(5100);
  await rejected;
  assert.equal(waiterCalls, 0); assert.equal(r.warnings.length, 1);
  release.resolve(); assert.equal(await holder, 'holder');
});
