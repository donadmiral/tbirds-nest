const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness(overrides = {}) {
  let now = Date.parse('2026-11-01T12:00:00Z'), id = 0;
  const timers = new Map(), modules = new Map();
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const globals = {
    Date: ClockDate, AbortController, Promise, Error, console,
    setTimeout(fn, ms) { const key = ++id; timers.set(key, { fn, due: now + ms }); return key; },
    clearTimeout(key) { timers.delete(key); }, ...overrides,
  };
  function load(relative) {
    const file = path.resolve(root, relative);
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    modules.set(file, module.exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { ...globals, module, exports: module.exports, require(name) {
      if (overrides.require) { const resolved = overrides.require(name); if (resolved) return resolved; }
      return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts')));
    } });
    return module.exports;
  }
  async function advance(ms) {
    await settle(); const until = now + ms; let count = 0;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      assert.ok(++count < 10000, 'timer loop must remain bounded');
      now = next[1].due; timers.delete(next[0]); next[1].fn(); await settle();
    }
    now = until; await settle();
  }
  return { load, advance, globals, timers, now: () => now, iso: () => new ClockDate().toISOString() };
}

test('healthy realtime removes the recurring read and reconnect still recovers missed state', async () => {
  const h = harness(), { createRecoveryReader } = h.load('shared/recoveryReader.ts');
  let reads = 0;
  const reader = createRecoveryReader({ intervalMs: 30000, maxIntervalMs: 30000, random: () => .5, read: async () => { reads++; } });
  reader.setConnected(true); await settle();
  await h.advance(600000); assert.equal(reads, 1, 'ten healthy minutes need only the entry snapshot');
  reader.setConnected(false); await h.advance(30000); assert.equal(reads, 2);
  reader.setConnected(true); await settle(); assert.equal(reads, 3, 'reconnect must reconcile a missed insert');
  await h.advance(600000); assert.equal(reads, 3);
  reader.dispose(); assert.equal(h.timers.size, 0);
});

test('recovery requests coalesce, pause aborts them, and late work cannot own a resumed read', async () => {
  const h = harness(), { createRecoveryReader } = h.load('shared/recoveryReader.ts');
  const pending = [], published = [];
  const reader = createRecoveryReader({ intervalMs: 3000, random: () => .5, read: async signal => {
    const work = deferred(); pending.push({ ...work, signal }); const value = await work.promise;
    if (!signal.aborted) published.push(value);
  } });
  reader.setConnected(true); await settle();
  for (let i = 0; i < 50; i++) reader.refresh();
  assert.equal(pending.length, 1);
  reader.setActive(false); assert.equal(pending[0].signal.aborted, true);
  await h.advance(60000); assert.equal(pending.length, 1);
  reader.setActive(true); await settle(); assert.equal(pending.length, 2);
  pending[0].resolve('old-account'); await settle();
  reader.refresh(); await settle(); assert.equal(pending.length, 2, 'late completion must not clear the new flight');
  pending[1].resolve('current-account'); await settle(); assert.equal(pending.length, 3, 'many refreshes queue only one reconciliation');
  pending[2].resolve('current-account'); await settle();
  assert.deepEqual(published, ['current-account', 'current-account']);
  reader.dispose(); assert.equal(h.timers.size, 0);
});

test('disposing before the first microtask starts no recovery or health request', async () => {
  const h = harness(), { createRecoveryReader } = h.load('shared/recoveryReader.ts'), { createNetworkRecovery } = h.load('shared/networkRecovery.ts');
  let reads = 0;
  const reader = createRecoveryReader({ intervalMs: 3000, read: async () => { reads++; } });
  reader.refresh(); reader.dispose();
  const network = createNetworkRecovery({ probe: async () => { reads++; }, flush: async () => false, hasWork: () => false, setOnline() {} });
  network.start(); network.dispose(); await settle(); assert.equal(reads, 0); assert.equal(h.timers.size, 0);
});

test('hung reads time out and failed recovery backs off within its finite budget', async () => {
  const h = harness(), { createRecoveryReader } = h.load('shared/recoveryReader.ts');
  const calls = []; let healthy = false;
  const reader = createRecoveryReader({ intervalMs: 3000, maxIntervalMs: 12000, timeoutMs: 1000, random: () => .5, read: async signal => {
    calls.push({ at: h.now(), signal }); if (healthy) return;
    if (calls.length === 1) await new Promise(() => {}); else throw new Error('offline');
  } });
  reader.setConnected(true); await h.advance(1000); assert.equal(calls[0].signal.aborted, true);
  await h.advance(3000); assert.equal(calls.length, 2);
  await h.advance(6000); assert.equal(calls.length, 3);
  await h.advance(12000); assert.equal(calls.length, 4);
  healthy = true; await h.advance(12000); assert.equal(calls.length, 5);
  await h.advance(600000); assert.equal(calls.length, 5, 'successful read stops fallback while subscribed');
  reader.dispose();
});

test('typing updates render from authorized events and expire without a network read', async () => {
  const h = harness(), { createTypingActivity } = h.load('shared/typingActivity.ts');
  let reads = 0; const changes = [];
  const typing = createTypingActivity({ random: () => .5,
    read: async () => { reads++; return []; }, accept: row => row.conversation_id === 'chat' && row.user_id !== 'me',
    onChange: rows => changes.push(Array.from(rows, row => row.user_id)),
  });
  typing.status('SUBSCRIBED'); await settle();
  const row = user => ({ conversation_id: 'chat', user_id: user, is_typing: true, updated_at: h.iso() });
  typing.change({ eventType: 'UPDATE', new: row('other') }); assert.deepEqual(changes.at(-1), ['other']);
  typing.change({ eventType: 'UPDATE', new: row('me') });
  typing.change({ eventType: 'UPDATE', new: { ...row('foreign'), conversation_id: 'different-chat' } });
  await h.advance(2000); typing.change({ eventType: 'UPDATE', new: row('other') });
  assert.equal(changes.length, 1, 'renewing the same indicator does not rerender it');
  await h.advance(6999); assert.deepEqual(changes.at(-1), ['other']);
  await h.advance(1); assert.deepEqual(changes.at(-1), []);
  await h.advance(600000); assert.equal(reads, 1, 'no three-second healthy typing polling');
  typing.change({ eventType: 'UPDATE', new: row('other') });
  typing.change({ eventType: 'UPDATE', new: { ...row('other'), is_typing: false } });
  assert.deepEqual(changes.at(-1), []); assert.equal(reads, 1);
  typing.dispose(); assert.equal(h.timers.size, 0);
});

test('a delayed typing snapshot cannot undo a newer stop event or repopulate a hidden chat', async () => {
  const h = harness(), { createTypingActivity } = h.load('shared/typingActivity.ts');
  const pending = [], changes = [];
  const typing = createTypingActivity({ random: () => .5, read: signal => { const work = deferred(); pending.push({ ...work, signal }); return work.promise; },
    accept: () => true, onChange: rows => changes.push(rows.length),
  });
  typing.status('SUBSCRIBED'); await settle();
  const row = { conversation_id: 'chat', user_id: 'other', is_typing: true, updated_at: h.iso() };
  typing.change({ eventType: 'UPDATE', new: row });
  typing.change({ eventType: 'UPDATE', new: { ...row, is_typing: false } });
  pending[0].resolve([row]); await settle(); assert.deepEqual(changes, [1, 0]);
  typing.refresh(); await settle(); typing.setActive(false);
  assert.equal(pending[1].signal.aborted, true);
  pending[1].resolve([row]); await settle(); assert.deepEqual(changes, [1, 0]);
  await h.advance(60000); assert.equal(pending.length, 2);
  typing.setActive(true); await settle(); assert.equal(pending.length, 3);
  typing.dispose(); pending[2].resolve([{ ...row, updated_at: h.iso() }]); await settle(); assert.deepEqual(changes, [1, 0]);
});

test('inbox typing retains its eight-second cutoff and disconnected reads remain bounded', async () => {
  const h = harness(), { createTypingActivity } = h.load('shared/typingActivity.ts');
  let reads = 0; const changes = [];
  const typing = createTypingActivity({ intervalMs: 3500, lifetimeMs: 8000, random: () => .5, read: async () => { reads++; return []; },
    accept: row => row.conversation_id === 'inbox-chat', onChange: rows => changes.push(rows.length),
  });
  typing.status('SUBSCRIBED'); await settle();
  typing.change({ eventType: 'UPDATE', new: { conversation_id: 'inbox-chat', user_id: 'other', is_typing: true, updated_at: h.iso() } });
  await h.advance(7999); assert.deepEqual(changes, [1]); await h.advance(1); assert.deepEqual(changes, [1, 0]);
  typing.status('CHANNEL_ERROR'); await h.advance(7000); assert.equal(reads, 3);
  typing.setActive(false); await h.advance(70000); assert.equal(reads, 3);
  typing.dispose();
});

test('native healthy traffic eliminates the five-second heartbeat, and foreground still checks immediately', async () => {
  const h = harness(), { createNetworkRecovery } = h.load('shared/networkRecovery.ts');
  let probes = 0, flushes = 0;
  const network = createNetworkRecovery({ random: () => .5, probe: async () => { probes++; }, flush: async () => { flushes++; return false; }, hasWork: () => false, setOnline() {} });
  network.start(); await settle();
  for (let i = 0; i < 100; i++) network.outcome(true);
  await h.advance(600000); assert.equal(probes, 1, 'old loop would issue 121 probes including entry'); assert.equal(flushes, 0);
  network.setActive(false); network.outcome(false); await h.advance(600000); assert.equal(probes, 1);
  network.setActive(true); await settle(); assert.equal(probes, 2);
  network.dispose(); assert.equal(h.timers.size, 0);
});

test('native outage retains two-miss truth, backs off, and real recovery resumes durable pending work', async () => {
  const h = harness(), { createNetworkRecovery } = h.load('shared/networkRecovery.ts');
  const online = []; let probes = 0, flushes = 0, pending = true;
  const network = createNetworkRecovery({ random: () => .5, probe: async () => { probes++; throw new Error('offline'); },
    hasWork: () => pending, flush: async () => { flushes++; pending = false; return false; }, setOnline: state => online.push(state),
  });
  network.start(); await settle(); assert.deepEqual(online, []);
  await h.advance(5000); assert.deepEqual(online, [false]); assert.equal(probes, 2);
  for (let i = 0; i < 100; i++) network.outcome(false);
  await h.advance(9999); assert.equal(probes, 2, 'failed requests cannot bypass outage backoff');
  network.outcome(true); assert.deepEqual(online, [false, true]);
  await settle(); assert.equal(flushes, 1, 'reconnected queued delivery resumes without an extra heartbeat delay');
  await h.advance(600000); assert.equal(probes, 2); assert.equal(flushes, 1);
  network.dispose();
});

test('pending outbox retries stop when confirmed, pause in background, and do not overlap', async () => {
  const h = harness(), { createNetworkRecovery } = h.load('shared/networkRecovery.ts');
  let pending = true, attempts = 0, running = 0, maximum = 0;
  const wait = deferred();
  const network = createNetworkRecovery({ random: () => .5, probe: async () => {}, hasWork: () => pending,
    flush: async () => { attempts++; running++; maximum = Math.max(maximum, running); if (attempts === 1) await wait.promise; running--; if (attempts === 3) pending = false; return pending; }, setOnline() {},
  });
  network.start(); await h.advance(5000); assert.equal(attempts, 1);
  for (let i = 0; i < 20; i++) { network.workQueued(); network.outcome(true); }
  await h.advance(60000); assert.equal(attempts, 1);
  network.setActive(false); wait.resolve(); await settle(); await h.advance(60000); assert.equal(attempts, 1);
  network.setActive(true); await h.advance(5000); assert.equal(attempts, 2);
  await h.advance(10000); assert.equal(attempts, 3); assert.equal(maximum, 1);
  await h.advance(600000); assert.equal(attempts, 3); network.dispose();
});

test('a real response supersedes an old stalled health check and disposal fences late failures', async () => {
  const h = harness(), { createNetworkRecovery } = h.load('shared/networkRecovery.ts');
  const pending = [], online = [];
  const network = createNetworkRecovery({ random: () => .5, probe: signal => { const work = deferred(); pending.push({ ...work, signal }); return work.promise; },
    flush: async () => false, hasWork: () => false, setOnline: state => online.push(state),
  });
  network.start(); await settle(); for (let i = 0; i < 20; i++) network.outcome(false); assert.equal(pending.length, 1);
  network.outcome(true); assert.equal(pending[0].signal.aborted, true); pending[0].reject(Error('late timeout')); await settle();
  await h.advance(60000); assert.equal(pending.length, 1); assert.deepEqual(online, []);
  network.outcome(false); await settle(); assert.equal(pending.length, 2);
  network.dispose(); pending[1].reject(Error('after shutdown')); await settle(); assert.equal(h.timers.size, 0); assert.deepEqual(online, []);
});

test('network observers never turn a completed HTTP request into a failure', () => {
  const h = harness(), activity = h.load('shared/networkActivity.ts'); let seen = 0;
  const remove = activity.subscribeNetworkActivity(() => { throw Error('observer failed'); });
  activity.subscribeNetworkActivity(() => { seen++; });
  activity.reportNetworkActivity(true); assert.equal(seen, 1); remove(); activity.reportNetworkActivity(false); assert.equal(seen, 2);
});

test('the native chat typing effect fences a delayed account response and releases its lifecycle listeners', async () => {
  const h = harness(), { createTypingActivity } = h.load('shared/typingActivity.ts');
  const source = fs.readFileSync(path.join(root, 'src/screens/messages/ChatScreen.tsx'), 'utf8');
  const ast = ts.createSourceFile('ChatScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('const typing = createTypingActivity')) effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(effect);
  const waiting = deferred(), accountScopeRef = { current: 1 }, changes = []; let removed = 0, stateListener, event;
  const channel = { on(_type, filter, handler) { assert.equal(filter.filter, 'conversation_id=eq.chat'); event = handler; return this; }, subscribe(callback) { callback('SUBSCRIBED'); return this; } };
  const query = { select() { return this; }, eq(key, value) { assert.equal(key, 'conversation_id'); assert.equal(value, 'chat'); return this; }, abortSignal(signal) { return waiting.promise.then(value => signal.aborted ? { data: [], error: null } : value); } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule('export const run = ' + effect, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { ...h.globals, module, exports: module.exports, createTypingActivity, conversationId: 'chat', currentUserId: 'me', focused: true, accountScopeRef, activeConversation: { current: 'chat' },
      setOtherTyping: value => changes.push(value), setTypingUserId() {},
      AppState: { currentState: 'active', addEventListener(_name, callback) { stateListener = callback; return { remove() { removed++; } }; } },
      supabase: { from: table => { assert.equal(table, 'conversation_typing'); return query; }, channel: () => channel, removeChannel() { removed++; } },
    });
  const cleanup = module.exports.run(); await settle(); assert.deepEqual(changes, [false]);
  accountScopeRef.current = 2;
  const row = { conversation_id: 'chat', user_id: 'other', is_typing: true, updated_at: h.iso() };
  event({ eventType: 'UPDATE', new: row }); waiting.resolve({ data: [row], error: null }); await settle();
  assert.deepEqual(changes, [false], 'old account events and delayed reads cannot set typing');
  stateListener('background'); cleanup(); assert.equal(removed, 2); assert.equal(h.timers.size, 0);
});

test('incoming-call snapshots retain recipient filters, bounds, abort signals and both invitation types', async () => {
  const traces = []; let h;
  const direct = { id: 'direct', initiator_id: 'caller', receiver_id: 'me', is_group_call: false, status: 'ringing' };
  const group = { id: 'group', initiator_id: 'caller', receiver_id: null, is_group_call: true, status: 'active' };
  const client = { from(table) {
    const trace = { table, filters: {} }; traces.push(trace);
    const query = { select() { return this; }, eq(key, value) { trace.filters[key] = value; return this; },
      in(key, value) { trace.filters[key] = value; return this; }, gte(key, value) { trace.filters[key] = value; return this; },
      order() { return this; }, limit(value) { trace.limit = value; return this; }, abortSignal(value) { trace.signal = value; return this; },
      then(ok, bad) { const data = table === 'call_participants' ? [{ call_session_id: 'group' }] : [{ ...(trace.filters.id ? group : direct), created_at: h.iso() }]; return Promise.resolve({ data, error: null }).then(ok, bad); },
    }; return query;
  } };
  h = harness({ require: name => name === '@/lib/supabase/client' ? { createClient: () => client } : undefined });
  const calls = h.load('web/lib/calls.ts'), signal = new AbortController().signal;
  const result = await calls.getPendingIncomingCalls('me', signal);
  assert.deepEqual(Array.from(result, row => row.id), ['direct', 'group']); assert.equal(traces.length, 3);
  assert.equal(traces[0].filters.receiver_id, 'me'); assert.equal(traces[1].filters.user_id, 'me');
  assert.deepEqual(Array.from(traces[2].filters.id), ['group']);
  traces.forEach(query => { assert.equal(query.limit, 10); assert.equal(query.signal, signal); });
});

test('incoming-call read errors retry empty recovery but retain an independent actionable invitation', async () => {
  let includeDirect = false, h;
  const client = { from(table) {
    const query = { select() { return this; }, eq() { return this; }, gte() { return this; }, order() { return this; }, limit() { return this; },
      then(ok, bad) {
        return Promise.resolve(table === 'call_participants' ? { data: null, error: Error('participant query unavailable') }
          : { data: includeDirect ? [{ id: 'call', receiver_id: 'me', is_group_call: false, status: 'ringing', created_at: h.iso() }] : [], error: null }).then(ok, bad);
      },
    }; return query;
  } };
  h = harness({ require: name => name === '@/lib/supabase/client' ? { createClient: () => client } : undefined });
  const calls = h.load('web/lib/calls.ts');
  await assert.rejects(calls.getPendingIncomingCalls('me'), /participant query unavailable/);
  includeDirect = true; assert.equal((await calls.getPendingIncomingCalls('me'))[0].id, 'call');
});
