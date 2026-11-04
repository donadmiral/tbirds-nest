'use strict';
// Execute the actual component. Only service delivery and React scheduling are
// controlled here, so command acknowledgement and detail refresh can be held apart.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const sessionId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const nodes = value => !value || typeof value !== 'object' ? []
  : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value)
  : Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : '';
function detail(overrides = {}, role = 'host') {
  return { role, capabilities: {}, members: [], invitation: null, reminded: false,
    session: { id: sessionId, title: 'Synthetic Live', topic: 'irl', state: 'live', viewer_count: 1,
      chat_mode: 'open', slow_mode_seconds: 0, description: '', replay_available: false,
      host: { id: ownerId, username: 'synthetic-host', full_name: 'Synthetic host', is_verified: false }, ...overrides } };
}
function compile(file) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  assert.equal((result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  return result.outputText;
}
const componentSource = compile('web/components/LiveSessionView.tsx');
const directorySource = compile('shared/liveDirectory.ts');

function harness(role = 'host') {
  const slots = [], effects = [], commands = [], reads = [];
  let cursor = 0, dirty = false, tree, serial = 0;
  const client = {}, identity = { owner: ownerId, scope: 'synthetic-owner-scope' };
  const navigation = { subscribe() { return () => {}; }, getSnapshot: () => identity, getServerSnapshot: () => identity };
  const playback = { session: null, close() {} };
  const same = (left, right) => left && right && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => {
        slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true;
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { fn, deps };
      return slots[index].fn;
    },
    useEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || !same(previous.deps, deps)) {
        slots[index] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot(); },
  };
  const directory = { exports: {} };
  vm.runInNewContext(directorySource, { module: directory, exports: directory.exports });
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'next/link': { __esModule: true, default: 'Link' },
    'lucide-react': new Proxy({}, { get: (_target, key) => key }),
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/navigationCache': { getNavigationStore: () => navigation },
    '@/lib/liveApi': {
      getLiveDetail(receivedClient, receivedId) {
        assert.equal(receivedClient, client); assert.equal(receivedId, sessionId);
        const request = deferred(); reads.push(request); return request.promise;
      },
      liveCommand(receivedClient, receivedId, action, payload, requestId) {
        assert.equal(receivedClient, client); assert.equal(receivedId, sessionId);
        const request = { ...deferred(), action, payload: plain(payload), requestId };
        commands.push(request); return request.promise;
      },
      liveError: error => error.message,
      record: value => !!value && typeof value === 'object' && !Array.isArray(value),
    },
    '../../shared/liveDirectory': directory.exports,
    './LiveIcon': { LiveIcon: 'LiveIcon' },
    './LivePlaybackProvider': { LivePlayerSlot: 'LivePlayerSlot', useLivePlayback: () => playback },
    './LiveChat': { LiveChat: 'LiveChat' }, './LiveStudio': { LiveStudio: 'LiveStudio' },
    './LiveInteractions': { LiveInteractions: 'LiveInteractions', LiveAnalyticsPanel: 'LiveAnalyticsPanel' },
    '@/lib/liveInteractions': { parseLiveInteractions() { throw Error('No synthetic interaction event was delivered.'); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(componentSource, { module, exports: module.exports, URLSearchParams,
    window: { location: { search: '' } },
    crypto: { randomUUID: () => `33333333-3333-4333-8333-${String(++serial).padStart(12, '0')}` },
    require(name) { assert.ok(Object.hasOwn(imports, name), 'Unexpected component import: ' + name); return imports[name]; },
  });
  function render() { cursor = 0; dirty = false; tree = module.exports.LiveSessionView({ id: sessionId }); return tree; }
  async function flush() {
    for (let pass = 0; pass < 12; pass++) {
      if (dirty || !tree) render();
      effects.splice(0).forEach(run => run());
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty && !effects.length) return tree;
    }
    throw Error('Component did not settle within the bounded React scheduling harness.');
  }
  const selector = label => nodes(tree).find(node => node.type === 'select' && node.props['aria-label'] === label);
  function choose(label, value) {
    const control = selector(label); assert.ok(control, label);
    if (control.props.disabled) return false;
    control.props.onChange({ target: { value } }); return true;
  }
  async function ready(overrides = {}) {
    await flush(); assert.equal(reads.length, 1); reads[0].resolve(detail(overrides, role)); await flush();
  }
  return { ready, flush, selector, choose, commands, reads, tree: () => tree };
}
function settings(h, { mode = 'open', slow = '0', busy = false } = {}) {
  for (const [label, value] of [['Who can chat', mode], ['Slow mode', slow]]) {
    const control = h.selector(label); assert.ok(control, label);
    assert.equal(control.props.disabled === true, busy, label + ' must reflect the command and refresh boundary');
    assert.equal(control.props.value, value, label + ' must show the confirmed server value');
    assert.equal(Object.hasOwn(control.props, 'defaultValue'), false, label + ' must follow later confirmed values');
  }
}

test('chat close and reopen preserve confirmed values and block both selectors through command and refresh', async () => {
  const h = harness(); await h.ready();
  const staleHandler = h.selector('Who can chat').props.onChange;
  assert.equal(h.choose('Who can chat', 'closed'), true); await h.flush();
  settings(h, { busy: true }); assert.equal(h.commands.length, 1);
  assert.deepEqual(h.commands[0].payload, { chat_mode: 'closed' });
  assert.equal(h.commands[0].action, 'chat_settings');
  assert.equal(h.choose('Who can chat', 'open'), false); assert.equal(h.choose('Slow mode', '15'), false);
  staleHandler({ target: { value: 'open' } }); assert.equal(h.commands.length, 1, 'the existing immediate lock remains effective');
  h.commands[0].resolve({ ok: true }); await h.flush();
  assert.equal(h.reads.length, 2); settings(h, { busy: true });
  assert.equal(h.choose('Who can chat', 'open'), false, 'an acknowledged command still awaits its confirmed detail');
  h.reads[1].resolve(detail({ chat_mode: 'closed' })); await h.flush(); settings(h, { mode: 'closed' });
  assert.equal(h.choose('Who can chat', 'open'), true); await h.flush(); settings(h, { mode: 'closed', busy: true });
  assert.equal(h.commands.length, 2); assert.deepEqual(h.commands[1].payload, { chat_mode: 'open' });
  assert.notEqual(h.commands[1].requestId, h.commands[0].requestId);
  h.commands[1].resolve({ ok: true }); await h.flush(); settings(h, { mode: 'closed', busy: true });
  h.reads[2].resolve(detail()); await h.flush(); settings(h);
});

for (const control of [
  { label: 'Who can chat', value: 'followers', payload: { chat_mode: 'followers' }, confirmed: { chat_mode: 'followers' }, display: { mode: 'followers' } },
  { label: 'Slow mode', value: '15', payload: { slow_mode_seconds: 15 }, confirmed: { slow_mode_seconds: 15 }, display: { slow: '15' } },
]) test(control.label + ' rejection retains confirmed state and reuses the same failed intent request ID', async () => {
  const h = harness(); await h.ready();
  assert.equal(h.choose(control.label, control.value), true); await h.flush(); settings(h, { busy: true });
  h.commands[0].reject(new Error('Synthetic settings rejection')); await h.flush(); settings(h);
  assert.match(text(h.tree()), /Synthetic settings rejection/); assert.equal(h.reads.length, 1);
  assert.equal(h.choose(control.label, control.value), true); await h.flush(); settings(h, { busy: true });
  assert.equal(h.commands.length, 2); assert.equal(h.commands[1].requestId, h.commands[0].requestId);
  assert.deepEqual(h.commands[1].payload, control.payload);
  h.commands[1].resolve({ ok: true }); await h.flush(); settings(h, { busy: true });
  h.reads[1].resolve(detail(control.confirmed)); await h.flush(); settings(h, control.display);
});

test('an unconfirmed settings response keeps its confirmed value and retry identity', async () => {
  const h = harness(); await h.ready({ chat_mode: 'closed', slow_mode_seconds: 5 });
  h.choose('Who can chat', 'open'); await h.flush();
  settings(h, { mode: 'closed', slow: '5', busy: true });
  h.commands[0].resolve({ ok: false }); await h.flush(); settings(h, { mode: 'closed', slow: '5' });
  assert.match(text(h.tree()), /INVALID_SERVICE_RESPONSE/); assert.equal(h.reads.length, 1);
  h.choose('Who can chat', 'open'); await h.flush();
  assert.equal(h.commands.length, 2); assert.equal(h.commands[1].requestId, h.commands[0].requestId);
  h.commands[1].resolve({ ok: true }); await h.flush();
  h.reads[1].resolve(detail({ slow_mode_seconds: 5 })); await h.flush(); settings(h, { slow: '5' });
});

test('settings remain limited to the existing host, producer and moderator roles', async () => {
  for (const role of ['host', 'producer', 'moderator', 'viewer', 'guest', 'camera']) {
    const h = harness(role); await h.ready();
    const permitted = ['host', 'producer', 'moderator'].includes(role);
    assert.equal(!!h.selector('Who can chat'), permitted, role);
    assert.equal(!!h.selector('Slow mode'), permitted, role);
    assert.equal(h.commands.length, 0);
  }
});
