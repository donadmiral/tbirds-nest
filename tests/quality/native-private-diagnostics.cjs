const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const signedUrl = 'https://qa.invalid/storage/v1/object/sign/post-media/person/photo.jpg?token=synthetic-media-capability';
const pushToken = 'ExponentPushToken[synthetic-private-push-token-83910472]';
const rotatedToken = 'ExponentPushToken[synthetic-rotated-private-token-92741038]';
const userId = 'synthetic-private-account-16384029';
const deviceName = 'Synthetic private device';
const projectId = 'synthetic-project-92741';
const providerError = new Error([signedUrl, pushToken, rotatedToken, userId, deviceName].join(' '));
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
const privateValues = [signedUrl, 'synthetic-media-capability', pushToken, pushToken.slice(-8), rotatedToken, rotatedToken.slice(-8), userId, userId.slice(0, 8), deviceName, projectId];
function capture() {
  const logs = [];
  return { logs, console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(name => [name, (...values) => logs.push({ name, values })])) };
}
function assertPrivate(logs) {
  assert.ok(logs.length > 0, 'diagnostic events were actually emitted');
  for (const event of logs) { assert.equal(event.values.length, 1); assert.equal(typeof event.values[0], 'string'); }
  const text = JSON.stringify(logs);
  for (const value of privateValues) assert.equal(text.includes(value), false, 'private values and partial identifiers stay outside diagnostics');
}

for (const name of ['SingleImage', 'CarouselImageItem']) {
  test(name + ' load failure reports its event without logging signed media or provider error text', () => {
    const source = fs.readFileSync(path.join(root, 'src/components/MediaRenderer.tsx'), 'utf8');
    const ast = ts.createSourceFile('MediaRenderer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(component);
    let handler;
    const visit = node => {
      if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onError') handler = node.initializer.expression;
      ts.forEachChild(node, visit);
    };
    visit(component); assert.ok(handler);
    const sink = capture(), statuses = [], module = { exports: {} };
    vm.runInNewContext(compile('module.exports = ' + handler.getText(ast)), {
      module, exports: module.exports, console: sink.console,
      item: { url: signedUrl }, setStatus: value => statuses.push(value),
    });
    module.exports({ nativeEvent: { error: providerError.message } });
    assertPrivate(sink.logs);
    assert.deepEqual(statuses, name === 'SingleImage' ? ['error'] : []);
  });
}

function pushHarness(options = {}) {
  const sink = capture(), saved = [];
  let rotation, voip;
  const notifications = {
    setNotificationHandler() {},
    setNotificationCategoryAsync: async () => { if (options.channelFails) throw providerError; },
    setNotificationChannelAsync: async () => { if (options.channelFails) throw providerError; },
    getPermissionsAsync: async () => ({ status: options.denied ? 'denied' : 'granted' }),
    requestPermissionsAsync: async () => ({ status: 'denied' }),
    getExpoPushTokenAsync: async argument => { assert.equal(argument.projectId, projectId); return { data: pushToken }; },
    addPushTokenListener: listener => { rotation = listener; return { remove() {} }; },
    AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2, MAX: 5 },
    AndroidNotificationVisibility: { PRIVATE: 0, PUBLIC: 1 },
  };
  const imports = {
    'expo-device': { isDevice: true, deviceName },
    'expo-notifications': notifications,
    'expo-constants': { default: { expoConfig: { extra: { eas: { projectId } } } } },
    'react-native': { AppState: { currentState: 'active' }, Platform: { OS: options.android ? 'android' : 'ios' } },
    './pushTokenService': { pushTokenService: {
      saveToken: async (...args) => { saved.push({ kind: 'push', args }); if (options.saveFails) throw providerError; },
      saveVoipToken: async (...args) => { saved.push({ kind: 'voip', args }); },
    } },
    './nativeCallService': { nativeCallService: { registerVoipToken: listener => { voip = listener; } } },
    './callBackgroundTask': { registerIncomingCallTask: async () => {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/services/notificationBootstrap.ts'), 'utf8')), {
    module, exports: module.exports, console: sink.console, setTimeout: () => 1, clearTimeout() {},
    require(name) { assert.ok(name in imports, 'Unexpected import: ' + name); return imports[name]; },
  });
  return { ...sink, saved, register: () => module.exports.registerForPushNotifications(userId), rotate: () => rotation({ data: rotatedToken }), voip: () => voip('synthetic-private-voip-token') };
}

test('push registration and rotation persist complete tokens without exposing token suffixes or account identifiers', async () => {
  const run = pushHarness(); assert.equal(await run.register(), pushToken);
  assert.deepEqual(run.saved[0].args, [userId, pushToken, deviceName]);
  run.voip(); await flush();
  assert.deepEqual(run.saved.find(value => value.kind === 'voip').args, [pushToken, 'synthetic-private-voip-token']);
  run.rotate(); await flush();
  assert.deepEqual(run.saved.filter(value => value.kind === 'push')[1].args, [userId, rotatedToken, deviceName]);
  assertPrivate(run.logs);
});

test('push channel and token persistence failures log fixed outcomes without serializing provider errors', async () => {
  const run = pushHarness({ android: true, channelFails: true, saveFails: true });
  await run.register(); run.rotate(); await flush();
  assert.equal(run.saved.filter(value => value.kind === 'push').length, 2);
  assert.ok(run.logs.some(value => value.values[0] === 'TOKEN_SAVE_ERROR'));
  assert.ok(run.logs.some(value => value.values[0] === 'TOKEN_ROTATE_SAVE_ERROR'));
  assertPrivate(run.logs);
});

test('denied push permission reports a non-sensitive outcome and never persists a token', async () => {
  const run = pushHarness({ denied: true }); assert.equal(await run.register(), null);
  assert.equal(run.saved.length, 0); assertPrivate(run.logs);
});
