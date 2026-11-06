const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness() {
  let now = 0, sequence = 0;
  const timers = new Map();
  const globals = { Promise, Error, Date, AbortController, Set, Map, Math: Object.create(Math),
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  globals.Math.random = () => .5;
  function compile(source, extra = {}) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { ...globals, ...extra, module, exports: module.exports });
    return module.exports;
  }
  function effect(file, needle, extra) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let result;
    function visit(node) {
      if (ts.isCallExpression(node) && ['useEffect', 'useFocusEffect'].includes(node.expression.getText(ast)) && node.arguments[0]?.getText(ast).includes(needle)) result = node.arguments[0].getText(ast);
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(result, needle);
    return compile('module.exports = ' + result, { useCallback: fn => fn, ...extra });
  }
  async function advance(ms) {
    await settle(); const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await settle();
    }
    now = end; await settle();
  }
  const recovery = compile(fs.readFileSync(path.join(root, 'shared/recoveryReader.ts'), 'utf8'));
  const queue = compile(fs.readFileSync(path.join(root, 'shared/inboxRefreshQueue.ts'), 'utf8'));
  const continuity = compile(fs.readFileSync(path.join(root, 'shared/readContinuity.ts'), 'utf8'));
  return { effect, advance, timers, ...recovery, ...queue, ...continuity };
}
function groupFixture({ focused = true, active = true, response } = {}) {
  const h = harness(), calls = [], published = [];
  let foreground;
  const scope = { current: 'owner:group' };
  const state = { currentState: active ? 'active' : 'background', addEventListener(_name, fn) { foreground = fn; return { remove() { foreground = null; } }; } };
  const stop = h.effect('src/screens/messages/ChatScreen.tsx', 'const reader = createRecoveryReader', {
    createRecoveryReader: h.createRecoveryReader, isReadAccessDenied: h.isReadAccessDenied,
    isGroup: true, conversationId: 'group', currentUserId: 'me', focused,
    receiptScope: scope.current, receiptScopeRef: scope, AppState: state,
    setReceiptState(value) { published.push(value); },
    supabase: { from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const request = { select(value) { call.select = value; return request; }, eq(...args) { call.filters.push(args); return request; }, neq(...args) { call.filters.push(args); return request; },
        abortSignal(signal) { call.signal = signal; return response ? response(call) : Promise.resolve({ data: [{ user_id: 'other', last_read_at: null }], error: null }); } };
      return request;
    } },
  })();
  return { ...h, calls, published, scope, stop: stop || (() => {}), foreground(value) { foreground?.(value); } };
}
test('native group receipt polling is single-flight and one snapshot serves both UI uses', async () => {
  const pending = deferred(), h = groupFixture({ response: () => pending.promise });
  await settle(); assert.equal(h.calls.length, 1);
  await h.advance(9000); assert.equal(h.calls.length, 1);
  pending.resolve({ data: [{ user_id: 'other', last_read_at: null }], error: null }); await settle();
  assert.equal(h.published.length, 1);
  await h.advance(6000); assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[0].filters, [['conversation_id', 'group'], ['user_id', 'me']]);
  h.stop(); assert.equal(h.timers.size, 0);
});
test('group reads pause in background and never run on an unfocused screen', async () => {
  const hidden = groupFixture({ focused: false }); await hidden.advance(60000); assert.equal(hidden.calls.length, 0);
  const h = groupFixture({ active: false }); await h.advance(60000); assert.equal(h.calls.length, 0);
  h.foreground('active'); await settle(); assert.equal(h.calls.length, 1);
  h.foreground('background'); await h.advance(60000); assert.equal(h.calls.length, 1); h.stop();
});
test('group receipt completion cannot cross account or disposal boundaries', async () => {
  for (const dispose of [false, true]) {
    const pending = deferred(), h = groupFixture({ response: () => pending.promise }); await settle();
    if (dispose) h.stop(); else h.scope.current = 'next-owner:group';
    pending.resolve({ data: [{ user_id: 'private-member', last_read_at: null }], error: null }); await settle();
    assert.equal(h.published.length, 0); h.stop();
  }
});
test('group receipt outages preserve prior UI while explicit denial clears it', async () => {
  for (const denied of [false, true]) {
    const h = groupFixture({ response: async () => ({ data: null, error: { code: denied ? '42501' : 'NETWORK', message: denied ? 'permission denied' : 'offline' } }) });
    await settle(); assert.equal(h.published.length, denied ? 1 : 0);
    if (denied) assert.equal(h.published[0].rows.length, 0);
    h.stop();
  }
});
test('notification bursts coalesce and late events produce only one trailing refresh', async () => {
  const h = harness(), first = deferred(), calls = [];
  let event, status, foreground, removed = false;
  const channel = { on(_kind, filter, callback) { assert.equal(filter.filter, 'recipient_id=eq.me'); event = callback; return channel; }, subscribe(fn) { status = fn; return channel; } };
  const stop = h.effect('src/screens/notifications/NotificationsScreen.tsx', 'const updates = createInboxRefreshQueue', {
    createInboxRefreshQueue: h.createInboxRefreshQueue, userId: 'me',
    load(signal) { calls.push(signal); return calls.length === 1 ? first.promise : Promise.resolve(); },
    setError() {}, setLoading() {}, setRefreshing() {},
    AppState: { currentState: 'active', addEventListener(_name, fn) { foreground = fn; return { remove() {} }; } },
    supabase: { channel() { return channel; }, removeChannel() { removed = true; } },
  })();
  status('SUBSCRIBED'); for (let i = 0; i < 100; i++) event();
  await h.advance(200); assert.equal(calls.length, 1);
  for (let i = 0; i < 100; i++) event();
  await h.advance(3000); assert.equal(calls.length, 1);
  first.resolve(); await settle(); await h.advance(800); assert.equal(calls.length, 2);
  await h.advance(60000); assert.equal(calls.length, 2, 'healthy idle activity does not poll');
  foreground('background'); event(); await h.advance(60000); assert.equal(calls.length, 2);
  foreground('active'); await h.advance(200); assert.equal(calls.length, 3);
  stop(); event(); await h.advance(60000); assert.equal(calls.length, 3); assert.equal(removed, true); assert.equal(h.timers.size, 0);
});
