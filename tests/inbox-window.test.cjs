const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, overrides = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: name => {
    if (name in overrides) return overrides[name]; throw new Error('Unexpected dependency ' + name);
  }, AbortController, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const helper = load('shared/inboxWindow.ts');
const paged = load('shared/pagedReaders.ts');
const rows = (length, start = 0) => Array.from({ length }, (_, n) => ({ id: String(n + start), order: n + start, unread: 0 }));
const compare = (a, b) => a.order - b.order;
const options = { context: 'personal', search: '', order: 'activity', filter: 'all' };
function reader(values, extra = {}) {
  const calls = []; let live = values;
  return { calls, set(values) { live = values; }, async read(options) {
    calls.push(options);
    if (extra.override) { const result = await extra.override(options); if (result !== undefined) return result; }
    const all = options.ids ? live.filter(row => options.ids.includes(row.id)) : live;
    const offset = options.cursor?.offset ?? 0;
    const items = all.slice(offset, offset + options.limit);
    return { items, cursor: offset + items.length < all.length ? { viewer: 'owner', offset: offset + items.length } : null,
      summary: { total: 50000, archivedPersonal: 1200 }, badges: null, badgesIncluded: false };
  } };
}
const turn = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('opening an inbox with fifty thousand conversations reads only its first thirty and full summary', async () => {
  const r = reader(rows(50000));
  const window = await helper.refreshInboxWindow(r.read, options, null, () => true, compare);
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].limit, 30);
  assert.equal(window.items.length, 30); assert.equal(window.paging.summary.archivedPersonal, 1200);
  assert.equal(window.paging.summary.total, 50000); assert.ok(window.paging.cursor);
});

test('filter changes restart the server search rather than filtering only cached page one', async () => {
  const r = reader(rows(200));
  let window = await helper.refreshInboxWindow(r.read, options, null, () => true, compare);
  window = await helper.appendInboxWindow(r.read, options, window, () => true, compare);
  r.calls.length = 0; r.set([{ id: 'beyond-page-one', order: 999 }]);
  const changed = { ...options, search: '%_ literal', filter: 'groups' };
  window = await helper.refreshInboxWindow(r.read, changed, window, () => true, compare);
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].search, '%_ literal'); assert.equal(r.calls[0].cursor, null);
  assert.deepEqual(Array.from(window.items, row => row.id), ['beyond-page-one']);
});

test('refresh revalidates a displaced retained row and a deep link without loading all intervening pages', async () => {
  const original = rows(90), r = reader(original);
  let window = await helper.refreshInboxWindow(r.read, options, null, () => true, compare);
  window = await helper.appendInboxWindow(r.read, options, window, () => true, compare);
  const moved = { ...original[59], order: 5000 }, deep = { id: 'direct-link', order: 6000 };
  const live = [...rows(35, 1000).map((row, n) => ({ ...row, order: n - 100 })), ...original.filter(row => row.id !== '58' && row.id !== '59'), moved, deep];
  r.set(live); r.calls.length = 0;
  const refreshed = await helper.refreshInboxWindow(r.read, options, window, () => true, compare, [deep.id]);
  assert.equal(r.calls.filter(call => !call.ids).length, 2);
  assert.equal(r.calls.filter(call => call.ids).length, 1);
  assert.equal(r.calls.at(-1).limit, 50);
  assert.ok(refreshed.items.some(row => row.id === moved.id));
  assert.ok(!refreshed.items.some(row => row.id === '58'));
  assert.equal(refreshed.resolved.get(deep.id).order, 6000);
});

test('an active conversation outside the current filter remains resolvable without entering the filtered list', async () => {
  const r = reader([{ id: 'ordinary', order: 1 }, { id: 'active-group', order: 2, is_group: true }]);
  const result = await helper.refreshInboxWindow(r.read, options, null, row => !row.is_group, compare, ['active-group']);
  assert.deepEqual(Array.from(result.items, row => row.id), ['ordinary']);
  assert.equal(result.resolved.get('active-group').is_group, true);
});

test('retained-ID requests are at most fifty IDs each and at most two concurrent requests', async () => {
  const pending = [], calls = []; let simultaneous = 0, maximum = 0;
  const read = async opts => { calls.push(opts); simultaneous++; maximum = Math.max(maximum, simultaneous);
    const gate = deferred(); pending.push(gate); await gate.promise; simultaneous--;
    return { items: opts.ids.map(id => ({ id })), cursor: null }; };
  const work = helper.readInboxIds(read, options, rows(151).map(row => row.id));
  await turn(); assert.equal(calls.length, 2); pending.splice(0).forEach(gate => gate.resolve());
  await turn(); assert.equal(calls.length, 4); pending.splice(0).forEach(gate => gate.resolve());
  assert.equal((await work).size, 151); assert.equal(maximum, 2);
  assert.ok(calls.every(call => call.ids.length <= 50 && call.limit === 50 && call.cursor === null));
});

test('ID lookup refuses partial or unexpected rows instead of treating them as authorization removals', async () => {
  await assert.rejects(helper.readInboxIds(async () => ({ items: [{ id: 'a' }], cursor: { more: true } }), options, ['a']), /could not be checked/);
  await assert.rejects(helper.readInboxIds(async () => ({ items: [{ id: 'other' }], cursor: null }), options, ['a']), /could not be checked/);
});

test('a failed ID batch waits for its noncooperative sibling before releasing the physical operation', async () => {
  const gate = deferred(); let calls = 0, settled = false;
  const pending = helper.readInboxIds(async () => { calls++; if (calls === 1) throw Error('offline');
    await gate.promise; return { items: [], cursor: null }; }, options, rows(60).map(row => row.id));
  const observed = pending.then(() => { settled = true; }, error => { settled = true; assert.match(error.message, /offline/); });
  await turn(); assert.equal(calls, 2); assert.equal(settled, false);
  gate.resolve(); await observed; assert.equal(settled, true);
});

test('live ordering overlaps deduplicate and a cursor for a different folder cannot be appended', async () => {
  const r = reader(rows(40));
  let window = await helper.refreshInboxWindow(r.read, options, null, () => true, compare);
  r.set([{ id: 'new-head', order: -1 }, ...rows(40)]);
  window = await helper.appendInboxWindow(r.read, options, window, () => true, compare);
  assert.equal(new Set(window.items.map(row => row.id)).size, window.items.length);
  assert.equal(window.items.length, 40);
  await assert.rejects(helper.appendInboxWindow(r.read, { ...options, folder: 'archived' },
    { ...window, paging: { ...window.paging, cursor: { offset: 1 } } }, () => true, compare), /filter changed/);
});

test('disabled capability permits only the initial fallback; failed page or summary never becomes empty success', async () => {
  assert.equal(await helper.refreshInboxWindow(async () => null, options, null, () => true, compare), null);
  await assert.rejects(helper.refreshInboxWindow(async () => ({ items: [], cursor: null }), options, null, () => true, compare), /totals/);
  await assert.rejects(helper.refreshInboxWindow(async () => { throw Error('permission denied'); }, options, null, () => true, compare), /permission denied/);
});

test('a newer receipt and access removal survive an older in-flight range refresh', () => {
  const guard = helper.createInboxMergeGuard(), before = guard.revision();
  guard.touch(['read', 'revoked']);
  const merged = guard.merge([{ id: 'read', unread: 9 }, { id: 'revoked', unread: 1 }, { id: 'ordinary' }], [{ id: 'read', unread: 0 }], before);
  assert.equal(merged.find(row => row.id === 'read').unread, 0); assert.ok(!merged.some(row => row.id === 'revoked'));
  const after = guard.revision(); assert.equal(guard.merge([{ id: 'read', unread: 1 }], [{ id: 'read', unread: 0 }], after)[0].unread, 1);
  guard.clear(); assert.equal(guard.merge([{ id: 'revoked' }], [], 0).length, 1);
});

test('a newer canonical removal fences an older authorized lookup until a genuinely later read reauthorizes it', () => {
  const guard = helper.createInboxMergeGuard(), targeted = guard.begin(), refresh = guard.begin();
  const removed = guard.commit([], [{ id: 'revoked' }], refresh, ['revoked']);
  assert.equal(removed.length, 0); assert.equal(guard.canApply('revoked', targeted), false);
  assert.equal(guard.commit([{ id: 'revoked' }], [], targeted, ['revoked']).length, 0);
  const later = guard.begin(); assert.equal(guard.commit([{ id: 'revoked' }], [], later, ['revoked']).length, 1);
});

test('an earlier range completion cannot suppress a later-started final targeted update', () => {
  const guard = helper.createInboxMergeGuard(), range = guard.begin(), targeted = guard.begin();
  const first = guard.commit([{ id: 'busy', unread: 1 }], [], range, ['busy']);
  const last = guard.commit([{ id: 'busy', unread: 2 }], first, targeted, ['busy']);
  assert.equal(last[0].unread, 2);
  const newer = guard.begin(); guard.commit([{ id: 'busy', unread: 3 }], last, newer, ['busy']);
  assert.equal(guard.commit([{ id: 'busy', unread: 1 }], [{ id: 'busy', unread: 3 }], targeted, ['busy'])[0].unread, 3);
});

test('appending a page stamps only the new page and leaves older-row targeted work eligible', () => {
  const guard = helper.createInboxMergeGuard(), targeted = guard.begin(), nextPage = guard.begin();
  const appended = guard.commit([{ id: 'old', unread: 0 }, { id: 'new' }], [{ id: 'old', unread: 0 }], nextPage, ['new']);
  assert.equal(guard.canApply('old', targeted), true);
  assert.equal(guard.commit([{ id: 'old', unread: 4 }, { id: 'new' }], appended, targeted, ['old'])[0].unread, 4);
});

function clock() {
  let now = 0, next = 0; const tasks = new Map();
  return { setTimeout(fn, delay) { const id = ++next; tasks.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { tasks.delete(id); }, async tick(ms) { const end = now + ms;
      while (true) { const entry = [...tasks].filter(([, value]) => value.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
        if (!entry) break; now = entry[1].at; tasks.delete(entry[0]); entry[1].fn(); await turn(); }
      now = end; await turn(); }, count: () => tasks.size };
}

test('continuous inbox events make bounded progress and keep the final event during a pending read', async () => {
  const time = clock(), queue = load('shared/inboxRefreshQueue.ts', {}, time), gate = deferred(), calls = [];
  const worker = queue.createInboxRefreshQueue({ random: () => .5, read: async (ids, signal) => { calls.push({ ids, signal }); if (calls.length === 1) await gate.promise; } });
  worker.changed('a'); await time.tick(100); worker.changed('a'); await time.tick(100);
  assert.equal(calls.length, 1);
  worker.changed('a'); worker.changed('final'); gate.resolve(); await turn(); await time.tick(800);
  assert.equal(calls.length, 2); assert.deepEqual(Array.from(calls[1].ids).sort(), ['a', 'final']);
  await time.tick(60000); assert.equal(calls.length, 2); worker.dispose(); assert.equal(time.count(), 0);
});

test('background pauses abort old reads and resume with one canonical range refresh', async () => {
  const time = clock(), queue = load('shared/inboxRefreshQueue.ts', {}, time), gate = deferred(), calls = [];
  const worker = queue.createInboxRefreshQueue({ read: async (ids, signal) => { calls.push({ ids, signal }); if (calls.length === 1) await gate.promise; } });
  worker.changed('a'); await time.tick(200); worker.setActive(false); assert.equal(calls[0].signal.aborted, true);
  for (let n = 0; n < 10; n++) worker.changed('late-' + n);
  await time.tick(60000); assert.equal(calls.length, 1);
  worker.setActive(true); await time.tick(200); assert.equal(calls.length, 1, 'a noncooperative old transport still owns the slot');
  gate.resolve(); await turn(); await time.tick(200); assert.equal(calls.length, 2); assert.equal(calls[1].ids, null);
  worker.dispose(); assert.equal(time.count(), 0);
});

test('inbox refresh failure retains invalidations with bounded backoff and at most fifty IDs per batch', async () => {
  const time = clock(), queue = load('shared/inboxRefreshQueue.ts', {}, time), calls = []; let failures = 0;
  const worker = queue.createInboxRefreshQueue({ random: () => .5, read: async ids => { calls.push(ids); if (!failures++) throw Error('offline'); } });
  for (let n = 0; n < 75; n++) worker.changed(String(n));
  await time.tick(200); assert.equal(calls[0].length, 50);
  await time.tick(1999); assert.equal(calls.length, 1); await time.tick(1); assert.equal(calls.length, 2);
  await time.tick(800); assert.equal(calls.length, 3); assert.ok(calls.every(batch => batch.length <= 50));
  const delivered = new Set(calls.slice(1).flat()); assert.equal(delivered.size, 75); worker.dispose();
});

test('a timed-out noncooperative inbox transport keeps its slot and eventually delivers the final queued event', async () => {
  const time = clock(), queue = load('shared/inboxRefreshQueue.ts', {}, time), gate = deferred(), calls = [], errors = [];
  const worker = queue.createInboxRefreshQueue({ random: () => .5, onError: error => errors.push(error),
    read: async (ids, signal) => { calls.push({ ids, signal }); if (calls.length === 1) await gate.promise; } });
  worker.changed('first'); await time.tick(200); await time.tick(12000);
  assert.equal(errors.length, 1); assert.equal(calls[0].signal.aborted, true);
  worker.changed('final'); await time.tick(60000); assert.equal(calls.length, 1);
  gate.resolve(); await turn(); await time.tick(2000);
  assert.equal(calls.length, 2); assert.deepEqual(Array.from(calls[1].ids).sort(), ['final', 'first']);
  assert.equal(errors.length, 1); worker.dispose(); assert.equal(time.count(), 0);
});

test('native paged adapter keeps deferred private avatars, pinned order and full archive counts without legacy fanout', async () => {
  const nav = load('shared/navigationCache.ts').createNavigationCache(); nav.setScope('session-a');
  const gate = deferred(), calls = [];
  const client = { from() { throw Error('Legacy fanout must not run'); }, rpc(name, args) {
    const call = { name, args }, chain = { setHeader(k,v) { call.token = v; return chain; }, abortSignal(signal) { call.signal = signal; return chain; }, then(ok, bad) {
      calls.push(call); return Promise.resolve(name === 'get_paged_reader_capabilities' ? { data: { version: 1, inbox: true, books: false }, error: null }
        : { data: { version: 2, items: [{ id: 'group', is_group: true, title: 'Team', avatar: 'private-photo', unread: 3,
          is_pinned: true, is_archived: false, is_muted: false, context: 'personal', last_message: 'Ready now' }], has_more: true,
          next_cursor: { viewer: 'a', after: 'group' }, summary: { total: 900, archived_personal: 123 } }, error: null }).then(ok, bad); } }; return chain;
  } };
  const service = load('src/services/navigationInbox.ts', { '../../shared/messageReceipts': load('shared/messageReceipts.ts'),
    '../../shared/pagedReaders': paged, '../../shared/inboxWindow': helper,
    '../lib/navigationCache': { navigationCache: nav, navigationScope: () => nav.scope() },
    '../stores/authStore': { useAuthStore: { getState: () => ({ session: { user: { id: 'a' }, access_token: 'owner-token' } }) } },
    './supabase': { supabase: client }, './chatMediaService': { isChatMediaUrl: url => url?.startsWith('private-'), signGroupAvatars: () => gate.promise },
  });
  const one = service.refreshNavigationInbox('a'), two = service.refreshNavigationInbox('a'); assert.equal(one, two);
  const items = await one;
  assert.equal(items[0].last_message, 'Ready now'); assert.equal(items[0].group_avatar_url, null);
  assert.equal(calls.length, 2); assert.equal(calls[1].args.p_limit, 30); assert.equal(calls[1].args.p_folder, 'active');
  assert.ok(calls.every(call => call.token === 'Bearer owner-token'));
  assert.equal(nav.read('session-a', 'inbox:personal:paging').summary.archivedPersonal, 123);
  nav.save('session-a', 'inbox:personal', items.map(row => ({ ...row, unread_count: 8 })));
  gate.resolve([{ id: 'group', group_avatar_url: 'authorized-photo' }]); await turn();
  assert.equal(nav.read('session-a', 'inbox:personal')[0].unread_count, 8);
  assert.equal(nav.read('session-a', 'inbox:personal')[0].group_avatar_url, 'authorized-photo');
});
