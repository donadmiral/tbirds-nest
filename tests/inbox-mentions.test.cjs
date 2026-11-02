const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const EPOCH = Date.UTC(2026, 10, 2, 12), DAY = 86400000;
const turn = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function runtime(overrides = {}) {
  let now = EPOCH, seq = 0; const timers = new Map(), modules = new Map();
  const clock = { now: () => now, count: () => timers.size,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; }, clearTimeout(id) { timers.delete(id); },
    async tick(ms) { const end = now + ms;
      while (true) { const task = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
        if (!task) break; now = task[1].at; timers.delete(task[0]); task[1].fn(); await turn(); }
      now = end; await turn(); },
  };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, AbortController, Date: ClockDate,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Math: Object.assign(Object.create(Math), { random: () => .5 }),
      require: name => { if (name in overrides) return overrides[name];
        if (name.startsWith('.')) return load(path.relative(root, path.resolve(root, path.dirname(file), name) + '.ts'));
        throw Error('Unexpected import ' + name); },
    }); return module.exports;
  }
  return { load, clock };
}
function client(reply, enabled = true) {
  const calls = [];
  return { calls, rpc(name, args) {
    const call = { name, args, token: null, signal: null };
    const query = { setHeader(_name, value) { call.token = value; return query; }, abortSignal(signal) { call.signal = signal; return query; },
      then(ok, bad) { calls.push(call); return Promise.resolve(name === 'get_paged_reader_capabilities'
        ? { data: { version: 1, books: false, inbox: enabled }, error: null } : reply(call)).then(ok, bad); } };
    return query;
  } };
}
const response = (since, items = []) => ({ data: { version: 1, since, items }, error: null });

test('mention reader pins the owner token, respects the effective server cutoff, and reuses capability discovery', async () => {
  const { load } = runtime(), { readInboxMentionTimes } = load('shared/inboxMentions.ts');
  const since = new Date(EPOCH - 7 * DAY).toISOString(), effective = new Date(EPOCH - 6 * DAY).toISOString();
  const sdk = client(() => response(effective, [{ conversation_id: 'a', latest_mention_at: new Date(EPOCH - DAY).toISOString() }]));
  const controller = new AbortController(), scope = { viewer: 'owner', token: 'pinned-token', signal: controller.signal, current: () => true };
  assert.equal((await readInboxMentionTimes(sdk, scope, ['a'], since)).get('a'), EPOCH - DAY);
  await readInboxMentionTimes(sdk, scope, ['a'], since);
  assert.equal(sdk.calls.filter(call => call.name === 'get_paged_reader_capabilities').length, 1);
  assert.ok(sdk.calls.every(call => call.token === 'Bearer pinned-token' && call.signal === controller.signal));
});

test('only disabled or genuinely missing mention RPCs choose compatibility; permissions never become a fallback success', async () => {
  const { load } = runtime(), { readInboxMentionTimes } = load('shared/inboxMentions.ts'), since = new Date(EPOCH - DAY).toISOString();
  const disabled = client(() => { throw Error('must not call'); }, false);
  assert.equal(await readInboxMentionTimes(disabled, { viewer: 'owner' }, ['a'], since), null);
  const missing = client(() => ({ error: { code: 'PGRST202', message: 'missing' }, data: null }));
  assert.equal(await readInboxMentionTimes(missing, { viewer: 'owner' }, ['a'], since), null);
  assert.equal(await readInboxMentionTimes(missing, { viewer: 'owner' }, ['a'], since), null);
  assert.equal(missing.calls.filter(call => call.name === 'get_inbox_mentions_v2').length, 1);
  const denied = client(() => ({ error: { code: '42501', message: 'denied' }, data: null }));
  await assert.rejects(readInboxMentionTimes(denied, { viewer: 'owner' }, ['a'], since), error => error.code === '42501');
});

test('mention response validation rejects unrequested IDs, duplicates, stale dates and incomplete contracts', async () => {
  const { load } = runtime(), { readInboxMentionTimes } = load('shared/inboxMentions.ts'), since = new Date(EPOCH - DAY).toISOString();
  const stamp = new Date(EPOCH).toISOString(), scope = { viewer: 'owner' };
  for (const data of [
    response(since, [{ conversation_id: 'foreign', latest_mention_at: stamp }]),
    response(since, [{ conversation_id: 'a', latest_mention_at: stamp }, { conversation_id: 'a', latest_mention_at: stamp }]),
    response(since, [{ conversation_id: 'a', latest_mention_at: new Date(EPOCH - 2 * DAY).toISOString() }]),
    response(new Date(EPOCH - 2 * DAY).toISOString()),
    { data: [], error: null },
  ]) await assert.rejects(readInboxMentionTimes(client(() => data), scope, ['a', 'b'], since), /incomplete|inconsistent/);
  const sdk = client(() => response(since));
  await assert.rejects(readInboxMentionTimes(sdk, scope, Array.from({length:51},(_,n)=>String(n)), since), /Invalid/);
  await assert.rejects(readInboxMentionTimes(sdk, scope, ['a','a'], since), /Invalid/);
  assert.equal(sdk.calls.length, 0);
});

test('a valid PostgreSQL microsecond above the strict server cutoff is not rejected by millisecond parsing', async () => {
  const { load } = runtime(), { readInboxMentionTimes } = load('shared/inboxMentions.ts');
  const since = '2026-11-01T00:00:00.123456+00:00';
  const sdk = client(() => response(since, [{ conversation_id: 'a', latest_mention_at: '2026-11-01T00:00:00.123457+00:00' }]));
  assert.equal((await readInboxMentionTimes(sdk, { viewer: 'owner' }, ['a'], since)).get('a'), Date.parse(since));
});

test('an aborted or replacement-owner mention response cannot be committed', async () => {
  const { load } = runtime(), { readInboxMentionTimes } = load('shared/inboxMentions.ts'), gate = deferred();
  const since = new Date(EPOCH - DAY).toISOString(), sdk = client(() => gate.promise); let current = true;
  const promise = readInboxMentionTimes(sdk, { viewer: 'owner', current: () => current }, ['a'], since); await turn();
  current = false; gate.resolve(response(since, [{ conversation_id: 'a', latest_mention_at: new Date(EPOCH).toISOString() }]));
  await assert.rejects(promise, error => error.name === 'AbortError');
  const controller = new AbortController(); controller.abort(); const count = sdk.calls.length;
  await assert.rejects(readInboxMentionTimes(sdk, { viewer: 'owner', signal: controller.signal }, ['a'], since), error => error.name === 'AbortError');
  assert.equal(sdk.calls.length, count);
});

test('151 loaded conversations use at most fifty IDs per request and two actual transports, with no idle polling', async () => {
  const { load, clock } = runtime(), { createInboxMentions } = load('shared/inboxMentions.ts');
  const pending = [], calls = [], published = []; let active = 0, maximum = 0;
  const reader = createInboxMentions({ clock: clock.now, paged: () => true, legacy: () => { throw Error('No legacy scan'); },
    read: async (ids, since, signal) => { calls.push({ ids, since, signal }); active++; maximum = Math.max(maximum, active);
      const gate = deferred(); pending.push(gate); await gate.promise; active--; return new Map(ids.map(id => [id, EPOCH - 1000])); },
    onChange: (times, verified) => published.push({ times, verified }),
  });
  reader.update(Array.from({length:151},(_,n)=>({id:String(n),activity:'first'}))); await clock.tick(200);
  assert.equal(calls.length, 2); pending.splice(0).forEach(gate => gate.resolve()); await turn();
  assert.equal(calls.length, 4); pending.splice(0).forEach(gate => gate.resolve()); await turn();
  assert.equal(maximum, 2); assert.ok(calls.every(call => call.ids.length <= 50 && Date.parse(call.since) === EPOCH + 200 - 7 * DAY));
  assert.equal(Object.keys(published.at(-1).times).length, 151); assert.equal(published.at(-1).verified, true);
  await clock.tick(60000); assert.equal(calls.length, 4); reader.dispose(); assert.equal(clock.count(), 0);
});

test('avatar, unread and repeated render updates do not rescan unchanged activity; a real final preview change does', async () => {
  const { load, clock } = runtime(), { createInboxMentions } = load('shared/inboxMentions.ts'), calls = [], published = [];
  const reader = createInboxMentions({ clock: clock.now, paged: () => true, legacy: () => { throw Error('No legacy scan'); },
    read: async ids => { calls.push(ids); return new Map([['a', EPOCH - 1000]]); }, onChange: (times, verified) => published.push({ times, verified }) });
  reader.update([{ id:'a',activity:'same preview' }]); await clock.tick(200);
  for (let n = 0; n < 100; n++) reader.update([{ id:'a',activity:'same preview',avatar:String(n),unread:n }]);
  await clock.tick(60000); assert.equal(calls.length, 1);
  reader.update([{ id:'a',activity:'new message' }]); await clock.tick(200); assert.equal(calls.length, 2);
  assert.equal(published.at(-1).times.a, EPOCH - 1000); reader.dispose();
});

test('removed and re-added conversations cannot accept a late mention from their earlier incarnation', async () => {
  const { load, clock } = runtime(), { createInboxMentions } = load('shared/inboxMentions.ts'), gates = [], calls = [], published = [];
  const reader = createInboxMentions({ clock: clock.now, paged: () => true, legacy: () => { throw Error('No legacy scan'); },
    read: ids => { calls.push(ids); const gate = deferred(); gates.push(gate); return gate.promise; }, onChange: (times, verified) => published.push({ times, verified }) });
  reader.update([{ id:'a',activity:'old' }]); await clock.tick(200);
  reader.update([]); reader.update([{ id:'a',activity:'new' }]); gates[0].resolve(new Map([['a', EPOCH - 1000]])); await turn();
  assert.equal(published.length, 0); await clock.tick(800); assert.equal(calls.length, 2);
  gates[1].resolve(new Map([['a', EPOCH + 500]])); await turn(); assert.equal(published.at(-1).times.a, EPOCH + 500);
  reader.update([]); assert.equal(Object.keys(published.at(-1).times).length, 0); assert.equal(published.at(-1).verified, false); reader.dispose();
});

test('a failing paired read and ignored abort keep physical concurrency bounded and preserve foreground final work', async () => {
  const { load, clock } = runtime(), { createInboxMentions } = load('shared/inboxMentions.ts'), gates = [], calls = [], published = [];
  let active = 0, maximum = 0;
  const reader = createInboxMentions({ clock: clock.now, paged: () => true, legacy: () => { throw Error('No legacy scan'); },
    read: async (ids, since, signal) => { const gate = deferred(); gates.push(gate); calls.push({ ids, signal }); active++; maximum = Math.max(maximum, active);
      try { return await gate.promise; } finally { active--; } }, onChange: (times, verified) => published.push({ times, verified }) });
  const rows = Array.from({length:55},(_,n)=>({id:String(n),activity:'old'})); reader.update(rows); await clock.tick(200);
  gates[0].reject(Error('offline')); await turn(); reader.setActive(false); reader.update(rows.map(row => ({...row,activity:'final'})));
  assert.ok(calls.every(call => call.signal.aborted)); reader.setActive(true); await clock.tick(60000); assert.equal(calls.length, 2);
  gates[1].resolve(new Map()); await turn(); await clock.tick(200); assert.equal(calls.length, 4);
  gates[2].resolve(new Map([['0', EPOCH + 500]])); gates[3].resolve(new Map()); await turn();
  assert.equal(maximum, 2); assert.equal(published.at(-1).times['0'], EPOCH + 500); reader.dispose();
});

test('a missing new RPC uses the legacy authorized mapping but publishes only loaded IDs', async () => {
  const { load, clock } = runtime(), { createInboxMentions } = load('shared/inboxMentions.ts'), published = []; let bounded = 0, legacy = 0;
  const reader = createInboxMentions({ clock: clock.now, paged: () => true,
    read: async () => { bounded++; return null; }, legacy: async since => { legacy++; assert.equal(Date.parse(since), EPOCH + 200 - 7 * DAY);
      return new Map([['a',EPOCH-1],['off-page',EPOCH-1]]); }, onChange: (times, verified) => published.push({ times, verified }) });
  reader.update([{id:'a',activity:'message'}]); await clock.tick(200);
  assert.equal(bounded, 1); assert.equal(legacy, 1); assert.deepEqual(Object.keys(published.at(-1).times), ['a']);
  reader.dispose();
});

test('amnesty is persisted once per owner and covers older mentions on pages loaded later without hiding new mentions', () => {
  let state;
  const store = { create: () => initializer => {
    const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
    state = initializer(set, () => state); return { getState: () => state };
  } };
  const { load } = runtime({ zustand: store, 'zustand/middleware': { persist: fn => fn, createJSONStorage: fn => fn },
    '@react-native-async-storage/async-storage': {} });
  const drafts = load('src/stores/draftStore.ts').useDraftStore;
  const first = drafts.getState().ensureMentionAmnesty('owner'); assert.equal(first, EPOCH);
  const oldOnLaterPage = EPOCH - DAY, newOnLaterPage = EPOCH + 1000;
  assert.equal(oldOnLaterPage > Math.max(drafts.getState().openedTimes['later'] ?? 0, drafts.getState().mentionAmnesty.owner), false);
  assert.equal(newOnLaterPage > Math.max(drafts.getState().openedTimes['later'] ?? 0, drafts.getState().mentionAmnesty.owner), true);
  drafts.getState().markOpened('a'); assert.equal(drafts.getState().ensureMentionAmnesty('owner'), first);
  assert.equal(drafts.getState().ensureMentionAmnesty('another-owner'), 0);
  assert.equal(drafts.getState().mentionAmnesty.owner, first);
});

test('an established opened-time store keeps its prior mention semantics and composer contents', () => {
  let state;
  const { load } = runtime({ zustand: { create: () => initializer => { const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
    state = initializer(set, () => state); return { getState: () => state }; } },
    'zustand/middleware': { persist: fn => fn, createJSONStorage: fn => fn }, '@react-native-async-storage/async-storage': {} });
  const drafts = load('src/stores/draftStore.ts').useDraftStore;
  drafts.getState().setDraft('a', 'unsent text'); drafts.getState().markOpened('a');
  assert.equal(drafts.getState().ensureMentionAmnesty('owner'), 0);
  assert.equal(drafts.getState().drafts.a, 'unsent text'); assert.equal(drafts.getState().openedTimes.a, EPOCH);
});
