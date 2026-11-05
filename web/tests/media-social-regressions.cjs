const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Execute the production store with controlled auth and query results. These
// fixtures never contact Supabase or mutate a real member's social activity.
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/postInteractionState.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = { exports: {} };
const counters = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../shared/postCounters.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: counters, exports: counters.exports });
vm.runInNewContext(source, {
  module: compiled, exports: compiled.exports, require: name => {
    if (name === '@/lib/interactions') return {};
    if (name === '../../shared/postCounters') return counters.exports;
    return require(name);
  }, setTimeout, clearTimeout, queueMicrotask, Map, Set,
});
const { createPostInteractionStore } = compiled.exports;
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setImmediate(resolve)); };
const seed = (overrides = {}) => ({ liked: false, bookmarked: false, likesCount: 4, bookmarksCount: 2, ...overrides });

function harness() {
  let viewer = 'alice', authListener;
  let session = () => ({ data: { session: viewer ? { user: { id: viewer } } : null }, error: null });
  let queryOverride = null, actionOverride = null, counterOverride = null;
  const rows = new Map(), reads = [], writes = [], sessionReads = [], counterReads = [];
  const server = id => {
    if (!rows.has(id)) rows.set(id, { likesCount: 4, bookmarksCount: 2, liked: new Set(), bookmarked: new Set() });
    return rows.get(id);
  };
  function read(table, filters) {
    const key = Object.hasOwn(filters, 'id') ? 'id' : 'post_id';
    if (Array.isArray(filters[key])) {
      const values = filters[key].flatMap(id => {
        const result = read(table, { ...filters, [key]: id });
        return result.data ? [{ ...result.data, ...(table === 'posts' ? { id } : {}) }] : [];
      });
      return { data: values, error: null };
    }
    const row = server(filters.id || filters.post_id);
    if (table === 'posts') return { data: { likes_count: row.likesCount, bookmarks_count: row.bookmarksCount }, error: null };
    const found = (table === 'post_likes' ? row.liked : row.bookmarked).has(filters.user_id);
    return { data: found ? { post_id: filters.post_id } : null, error: null };
  }
  const client = {
    rpc: async (name, args) => { counterReads.push({ name, args }); return counterOverride ? counterOverride(name, args) : { data: null, error: { code: 'PGRST202' } }; },
    auth: {
      getSession: () => { sessionReads.push(viewer); return Promise.resolve().then(session); },
      onAuthStateChange: fn => { authListener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from(table) {
      const filters = {};
      const execute = () => {
        reads.push({ table, filters: { ...filters } });
        return Promise.resolve().then(() => queryOverride ? queryOverride(table, filters, read) : read(table, filters));
      };
      const chain = {
        select() { return chain; }, eq(key, value) { filters[key] = value; return chain; }, in(key, values) { filters[key] = values; return chain; },
        maybeSingle: execute, single: execute, then(ok, bad) { return execute().then(ok, bad); },
      };
      return chain;
    },
  };
  const mutate = kind => async (postId, on, expectedViewerId) => {
    const call = { kind, postId, on, expectedViewerId };
    writes.push(call);
    if (actionOverride) return actionOverride(call);
    const row = server(postId), set = kind === 'like' ? row.liked : row.bookmarked;
    const before = set.has(expectedViewerId);
    if (on) set.add(expectedViewerId); else set.delete(expectedViewerId);
    if (kind === 'like' && before !== on) row.likesCount += on ? 1 : -1;
    if (kind === 'bookmark' && before !== on) row.bookmarksCount += on ? 1 : -1;
    return true;
  };
  const store = createPostInteractionStore(client, { like: mutate('like'), bookmark: mutate('bookmark') });
  return {
    store, server, reads, writes, sessionReads, counterReads,
    mount(id = 'post', initial = seed(), listener = () => {}) {
      const stop = store.subscribe(id, listener); store.seed(id, initial); return stop;
    },
    setSession(fn) { session = fn; }, setQuery(fn) { queryOverride = fn; }, setAction(fn) { actionOverride = fn; }, setCounters(fn) { counterOverride = fn; },
    auth(id) { viewer = id; assert.ok(authListener, 'auth listener is installed'); authListener(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); },
  };
}

function authoritativeCounters(h, selected = ids => ids) {
  h.setCounters((_name, { p_ids }) => ({ data: selected(p_ids).map(id => ({ post_id: id,
    likes_count: h.server(id).likesCount, bookmarks_count: h.server(id).bookmarksCount,
    comments_count: 0, reposts_count: 0, views_count: 0 })), error: null }));
}

test('concurrent card refreshes use one counter read and two membership reads', async () => {
  const h = harness(); authoritativeCounters(h);
  const ids = ['one', 'two', 'three', 'four'];
  ids.forEach((id, index) => { h.mount(id); h.server(id).likesCount = 10 + index; });
  h.server('two').liked.add('alice'); h.server('four').bookmarked.add('alice');
  await flush(); await Promise.all(ids.map(id => h.store.refresh(id)));
  assert.equal(h.counterReads.length, 1);
  assert.equal(h.sessionReads.length, 3, 'startup plus one shared lookup before and after the batch');
  assert.deepEqual([...h.counterReads[0].args.p_ids], ids);
  assert.equal(h.reads.length, 2);
  assert.deepEqual(h.reads.map(row => row.table).sort(), ['post_bookmarks', 'post_likes']);
  assert.ok(h.reads.every(row => row.filters.user_id === 'alice'));
  assert.equal(h.store.snapshot('two').liked, true);
  assert.equal(h.store.snapshot('one').liked, false);
  assert.equal(h.store.snapshot('four').bookmarked, true);
  ids.forEach((id, index) => assert.equal(h.store.snapshot(id).likesCount, 10 + index));
});

test('large refreshes split counter and membership reads at one hundred post IDs', async () => {
  const h = harness(); authoritativeCounters(h);
  const ids = Array.from({ length: 201 }, (_, i) => `post-${i}`);
  ids.forEach(id => h.mount(id)); await flush();
  await Promise.all(ids.map(id => h.store.refresh(id)));
  assert.deepEqual(h.counterReads.map(row => row.args.p_ids.length), [100, 100, 1]);
  assert.equal(h.reads.length, 6);
  for (const row of h.reads) assert.ok(!Array.isArray(row.filters.post_id) || row.filters.post_id.length <= 100);
  ids.forEach(id => assert.equal(h.store.snapshot(id).pending, false));
});

test('at most two read batches run together and remaining work resumes after settlement', async () => {
  const h = harness(), wait = defer(); authoritativeCounters(h);
  const ids = Array.from({ length: 301 }, (_, i) => `post-${i}`);
  ids.forEach(id => h.mount(id)); await flush();
  h.setCounters((_name, { p_ids }) => wait.promise.then(() => ({ data: p_ids.map(id => ({ post_id: id,
    likes_count: 4, bookmarks_count: 2, comments_count: 0, reposts_count: 0, views_count: 0 })), error: null })));
  const work = Promise.all(ids.map(id => h.store.refresh(id))); await flush();
  assert.equal(h.counterReads.length, 2);
  assert.equal(h.reads.length, 4);
  wait.resolve(); await work;
  assert.deepEqual(h.counterReads.map(row => row.args.p_ids.length), [100, 100, 100, 1]);
  ids.forEach(id => assert.equal(h.store.snapshot(id).pending, false));
});

test('an account change discards queued read batches before they reach the database', async () => {
  const h = harness(), wait = defer();
  const ids = Array.from({ length: 301 }, (_, i) => `post-${i}`);
  ids.forEach(id => h.mount(id)); await flush();
  h.setCounters((_name, { p_ids }) => wait.promise.then(() => ({ data: p_ids.map(id => ({ post_id: id,
    likes_count: 99, bookmarks_count: 9, comments_count: 0, reposts_count: 0, views_count: 0 })), error: null })));
  const work = Promise.all(ids.map(id => h.store.refresh(id))); await flush();
  assert.equal(h.counterReads.length, 2);
  h.auth(null); wait.resolve(); await work; await flush();
  assert.equal(h.counterReads.length, 2, 'the other 101 posts never dispatch under the old account');
  ids.forEach(id => {
    assert.equal(h.store.snapshot(id).likesCount, 4);
    assert.equal(h.store.snapshot(id).pending, false);
    assert.equal(h.store.snapshot(id).liked, false);
  });
});

test('batched legacy fallback preserves keyed counters and membership', async () => {
  const h = harness(); h.mount('one'); h.mount('two'); await flush();
  h.server('two').bookmarked.add('alice'); h.server('two').likesCount = 11;
  await Promise.all(['one', 'two'].map(id => h.store.refresh(id)));
  assert.equal(h.counterReads.length, 1);
  assert.equal(h.reads.length, 3);
  assert.equal(h.store.snapshot('one').bookmarked, false);
  assert.equal(h.store.snapshot('two').bookmarked, true);
  assert.equal(h.store.snapshot('two').likesCount, 11);
});

test('a missing counter affects its own card without manufacturing a zero count', async () => {
  const h = harness(); authoritativeCounters(h, ids => ids.filter(id => id !== 'missing'));
  h.mount('present'); h.mount('missing', seed({ likesCount: 25 })); await flush();
  h.server('present').likesCount = 13;
  await Promise.all(['present', 'missing'].map(id => h.store.refresh(id)));
  assert.equal(h.store.snapshot('present').likesCount, 13);
  assert.equal(h.store.snapshot('present').uncertain, false);
  assert.equal(h.store.snapshot('missing').likesCount, 25);
  assert.equal(h.store.snapshot('missing').uncertain, true);
  assert.equal(h.store.snapshot('missing').pending, false);
});

for (const invalid of [null, [{ post_id: 'outside' }], [{ post_id: 'one' }, { post_id: 'one' }]]) {
  test(`malformed batched membership preserves prior values: ${JSON.stringify(invalid)}`, async () => {
    const h = harness(); authoritativeCounters(h); h.mount('one'); h.mount('two'); await flush();
    h.setQuery((table, filters, fallback) => table === 'post_likes' ? { data: invalid, error: null } : fallback(table, filters));
    await Promise.all(['one', 'two'].map(id => h.store.refresh(id)));
    for (const id of ['one', 'two']) {
      assert.equal(h.store.snapshot(id).likesCount, 4);
      assert.equal(h.store.snapshot(id).uncertain, true);
      assert.equal(h.store.snapshot(id).pending, false);
    }
  });
}

test('a previous account batch cannot publish its membership after an account switch', async () => {
  const h = harness(), old = defer(); authoritativeCounters(h);
  h.mount('one'); h.mount('two'); await flush();
  let holdOld = true;
  h.setQuery((table, filters, fallback) => {
    if (!holdOld) return fallback(table, filters);
    return old.promise.then(() => ({ data: [{ post_id: 'one' }, { post_id: 'two' }], error: null }));
  });
  const work = Promise.all(['one', 'two'].map(id => h.store.refresh(id))); await flush();
  holdOld = false; h.server('two').bookmarked.add('bob'); h.auth('bob'); await flush();
  old.resolve(); await work; await flush();
  assert.equal(h.store.snapshot('one').liked, false);
  assert.equal(h.store.snapshot('one').bookmarked, false);
  assert.equal(h.store.snapshot('two').bookmarked, true);
  assert.equal(h.store.snapshot('two').liked, false);
});

test('concurrent mutations reconcile one batch after their writes without replaying them', async () => {
  const h = harness(); authoritativeCounters(h); h.mount('one'); h.mount('two'); await flush();
  await Promise.all([h.store.set('one', 'like', true), h.store.set('two', 'bookmark', true)]);
  assert.equal(h.writes.length, 2);
  assert.equal(h.counterReads.length, 1);
  assert.equal(h.reads.length, 2);
  assert.equal(h.store.snapshot('one').liked, true);
  assert.equal(h.store.snapshot('one').likesCount, 5);
  assert.equal(h.store.snapshot('two').bookmarked, true);
  assert.equal(h.store.snapshot('two').bookmarksCount, 3);
});

test('shared seeds do not add per-card startup queries and unrelated posts stay isolated', async () => {
  const h = harness(); let first = 0, second = 0;
  h.mount('post', seed(), () => first++); h.mount('post', seed(), () => second++);
  h.mount('other', seed({ likesCount: 17 })); await flush();
  assert.equal(h.reads.length, 0);
  h.server('post').likesCount = 10;
  await h.store.set('post', 'like', true);
  assert.equal(h.store.snapshot('post').liked, true);
  assert.equal(h.store.snapshot('post').likesCount, 11, 'server total includes activity absent from the seed');
  assert.equal(h.store.snapshot('other').likesCount, 17);
  assert.ok(first > 0 && second > 0, 'both mounted copies receive updates');
  assert.equal(h.store.snapshot('post').pending, false);
  assert.equal(h.store.snapshot('post').error, null);
});

test('one authorized live batch updates mounted copies without per-card queries and rejects older account data', async () => {
  const h = harness(); h.mount(); h.mount(); await flush();
  assert.equal(h.store.applyLive('post', 'alice', seed({ liked: true, likesCount: 25 }), Date.now()), true);
  assert.equal(h.store.snapshot('post').likesCount, 25); assert.equal(h.reads.length, 0);
  h.store.seed('post', seed({ likesCount: 1 })); assert.equal(h.store.snapshot('post').likesCount, 25);
  assert.equal(h.store.applyLive('post', 'bob', seed({ likesCount: 100 }), Date.now() + 1), false);
  assert.equal(h.store.snapshot('post').likesCount, 25);
});

test('a feed batch cannot roll back a pending or recently confirmed optimistic mutation', async () => {
  const h = harness(), pending = defer(); h.mount(); await flush();
  const started = Date.now(); h.setAction(() => pending.promise);
  const mutation = h.store.set('post', 'like', true); await flush();
  assert.equal(h.store.applyLive('post', 'alice', seed(), started), false);
  assert.equal(h.store.snapshot('post').liked, true);
  h.server('post').liked.add('alice'); h.server('post').likesCount = 9; pending.resolve(true); await mutation;
  assert.equal(h.store.applyLive('post', 'alice', seed(), started), false);
  assert.equal(h.store.snapshot('post').likesCount, 9);
  const reads = h.reads.length;
  assert.equal(h.store.applyLive('post', 'alice', seed({ liked: true, likesCount: 12 }), Date.now() + 1), true);
  assert.equal(h.store.snapshot('post').likesCount, 12); assert.equal(h.reads.length, reads);
});

test('duplicate clicks while the initial session is pending produce one write', async () => {
  const h = harness(), session = defer();
  h.setSession(() => session.promise); h.mount();
  const first = h.store.set('post', 'like', true);
  assert.equal(h.store.snapshot('post').pending, true, 'lock is taken before awaiting auth');
  const second = h.store.set('post', 'like', true);
  session.resolve({ data: { session: { user: { id: 'alice' } } }, error: null });
  await Promise.all([first, second]);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].expectedViewerId, 'alice');
  assert.equal(h.store.snapshot('post').likesCount, 5);
});

test('overlapping card and viewer actions share the same synchronous pending guard', async () => {
  const h = harness(), pending = defer(); h.mount(); h.mount(); await flush();
  h.setAction(() => pending.promise);
  const first = h.store.set('post', 'bookmark', true); await flush();
  await h.store.set('post', 'bookmark', false);
  assert.equal(h.writes.length, 1);
  h.server('post').bookmarked.add('alice'); pending.resolve(true); await first;
  assert.equal(h.store.snapshot('post').bookmarked, true);
  assert.equal(h.store.snapshot('post').pending, false);
});

test('bookmark confirmation uses stored membership and leaves authoritative likes intact', async () => {
  const h = harness(); h.mount(); h.server('post').likesCount = 13;
  await h.store.set('post', 'bookmark', true);
  assert.equal(h.store.snapshot('post').bookmarked, true);
  assert.equal(h.store.snapshot('post').bookmarksCount, 3);
  assert.equal(h.store.snapshot('post').likesCount, 13);
  await h.store.set('post', 'bookmark', false);
  assert.equal(h.store.snapshot('post').bookmarked, false);
  assert.equal(h.store.snapshot('post').bookmarksCount, 2);
  assert.deepEqual(h.writes.map(call => call.on), [true, false]);
});

for (const kind of ['like', 'bookmark']) {
  test(`a returned ${kind} failure restores confirmed state and exposes a recoverable error`, async () => {
    const h = harness(); h.mount(); h.setAction(() => false);
    await h.store.set('post', kind, true);
    const current = h.store.snapshot('post');
    assert.equal(current[kind === 'like' ? 'liked' : 'bookmarked'], false);
    assert.equal(current.likesCount, 4);
    assert.equal(current.pending, false);
    assert.equal(current.uncertain, false);
    assert.ok(current.error);
  });
}

test('a thrown response after a committed write reconciles to success without replaying it', async () => {
  const h = harness(); h.mount();
  h.setAction(() => { h.server('post').liked.add('alice'); h.server('post').likesCount = 9; throw new Error('response lost'); });
  await h.store.set('post', 'like', true);
  const current = h.store.snapshot('post');
  assert.equal(current.liked, true); assert.equal(current.likesCount, 9);
  assert.equal(current.error, null); assert.equal(current.pending, false);
  assert.equal(h.writes.length, 1);
});

test('a thrown uncommitted write ends pending and reports the server-confirmed failure', async () => {
  const h = harness(); h.mount(); h.setAction(() => { throw new Error('offline'); });
  await h.store.set('post', 'like', true);
  assert.equal(h.store.snapshot('post').liked, false);
  assert.equal(h.store.snapshot('post').pending, false);
  assert.ok(h.store.snapshot('post').error);
});

test('failed recovery preserves the previous total and retry only reads before another write', async () => {
  const h = harness(); h.mount('post', seed({ likesCount: 8 }));
  h.setAction(() => false); h.setQuery(() => ({ data: null, error: { message: 'read denied' } }));
  await h.store.set('post', 'like', true);
  assert.equal(h.store.snapshot('post').liked, false);
  assert.equal(h.store.snapshot('post').likesCount, 8);
  assert.equal(h.store.snapshot('post').uncertain, true);
  assert.equal(h.store.snapshot('post').pending, false);
  await h.store.set('post', 'bookmark', true);
  assert.equal(h.writes.length, 1, 'unknown state cannot send another mutation');
  h.setQuery(null); h.server('post').likesCount = 12; h.server('post').liked.add('alice');
  await h.store.refresh('post');
  assert.equal(h.writes.length, 1, 'retry confirms the result instead of replaying a toggle');
  assert.equal(h.store.snapshot('post').liked, true);
  assert.equal(h.store.snapshot('post').likesCount, 12);
  assert.equal(h.store.snapshot('post').uncertain, false);
  assert.equal(h.store.snapshot('post').error, null);
});

for (const invalidCount of [null, -1, '5', Number.NaN]) {
  test(`invalid count ${String(invalidCount)} cannot replace a known total`, async () => {
    const h = harness(); h.mount('post', seed({ likesCount: 8 }));
    h.setQuery((table, filters, fallback) => table === 'posts' ? { data: { likes_count: invalidCount, bookmarks_count: 2 }, error: null } : fallback(table, filters));
    await h.store.set('post', 'like', true);
    assert.equal(h.store.snapshot('post').likesCount, 8);
    assert.equal(h.store.snapshot('post').uncertain, true);
    assert.equal(h.store.snapshot('post').pending, false);
  });
}

test('an already existing like is not counted twice and a no-op removal uses the server total', async () => {
  const h = harness(); h.mount(); h.server('post').liked.add('alice'); h.server('post').likesCount = 7;
  await h.store.set('post', 'like', true);
  assert.equal(h.store.snapshot('post').likesCount, 7);
  h.server('post').liked.delete('alice'); h.server('post').likesCount = 6;
  await h.store.set('post', 'like', false);
  assert.equal(h.store.snapshot('post').likesCount, 6);
  assert.equal(h.store.snapshot('post').liked, false);
});

test('late feed seeds cannot overwrite a confirmed shared mutation', async () => {
  const h = harness(); h.mount(); await h.store.set('post', 'like', true);
  h.store.seed('post', seed({ likesCount: 2 }));
  assert.equal(h.store.snapshot('post').liked, true);
  assert.equal(h.store.snapshot('post').likesCount, 5);
});

test('sign-out invalidates an outstanding write and clears private membership', async () => {
  const h = harness(), pending = defer(); h.mount(); await flush();
  h.setAction(() => pending.promise);
  const work = h.store.set('post', 'bookmark', true); await flush();
  h.auth(null); pending.resolve(true); await work; await flush();
  assert.equal(h.store.snapshot('post').bookmarked, false);
  assert.equal(h.store.snapshot('post').liked, false);
  assert.equal(h.store.snapshot('post').pending, false);
  assert.equal(h.writes.length, 1);
});

test('an A-to-B-to-A switch cannot publish the original account generation response', async () => {
  const h = harness(), old = defer(); h.mount(); await flush();
  h.setAction(() => old.promise);
  const work = h.store.set('post', 'like', true); await flush();
  h.auth('bob'); await flush(); h.auth('alice'); await flush();
  h.server('post').likesCount = 21;
  await h.store.refresh('post');
  old.resolve(true); await work; await flush();
  assert.equal(h.store.snapshot('post').liked, false);
  assert.equal(h.store.snapshot('post').likesCount, 21);
  assert.equal(h.store.snapshot('post').pending, false);
  assert.equal(h.writes.length, 1);
});

test('a dispatched write that settles after A-to-B-to-A is freshly reconciled for the current account', async () => {
  const h = harness(), old = defer(); h.mount(); await flush();
  h.setAction(() => old.promise);
  const work = h.store.set('post', 'like', true); await flush();
  h.auth('bob'); await flush(); h.auth('alice'); await flush();
  assert.equal(h.store.snapshot('post').liked, false, 'pre-commit refresh sees the previous server state');
  h.server('post').liked.add('alice'); h.server('post').likesCount = 12;
  old.resolve(true); await work; await flush();
  assert.equal(h.store.snapshot('post').liked, true);
  assert.equal(h.store.snapshot('post').likesCount, 12);
  assert.equal(h.store.snapshot('post').pending, false);
  assert.equal(h.writes.length, 1, 'settlement causes a fresh read, never a replayed write');
});

test('unsubscribed surfaces receive no late result and other posts remain unchanged', async () => {
  const h = harness(), pending = defer(); let notifications = 0;
  const stop = h.mount('post', seed(), () => notifications++); await flush();
  h.setAction(() => pending.promise);
  const work = h.store.set('post', 'like', true); await flush();
  stop(); const before = notifications;
  h.mount('other', seed({ likesCount: 33 }));
  pending.resolve(true); await work; await flush();
  assert.equal(notifications, before);
  assert.equal(h.store.snapshot('other').likesCount, 33);
  assert.equal(h.store.snapshot('other').liked, false);
});

test('remounting during a pending write waits for that write before confirming state', async () => {
  const h = harness(), pending = defer(); const stop = h.mount(); await flush();
  h.setAction(() => pending.promise);
  const work = h.store.set('post', 'bookmark', true); await flush();
  stop(); h.mount(); await flush();
  assert.equal(h.store.snapshot('post').pending, true);
  assert.equal(h.reads.length, 0, 'remount must not read the pre-commit state as a final result');
  await h.store.set('post', 'bookmark', true);
  assert.equal(h.writes.length, 1);
  h.server('post').bookmarked.add('alice'); h.server('post').bookmarksCount = 3;
  pending.resolve(true); await work;
  assert.equal(h.store.snapshot('post').bookmarked, true);
  assert.equal(h.store.snapshot('post').bookmarksCount, 3);
  assert.equal(h.store.snapshot('post').pending, false);
});

test('remounting a touched post reconciles external removal instead of restoring stale feed seeds', async () => {
  const h = harness(); const stop = h.mount(); await h.store.set('post', 'bookmark', true);
  assert.equal(h.store.snapshot('post').bookmarked, true); stop();
  h.server('post').bookmarked.delete('alice'); h.server('post').bookmarksCount = 2;
  h.mount('post', seed({ bookmarked: true, bookmarksCount: 3 })); await flush();
  assert.equal(h.store.snapshot('post').bookmarked, false);
  assert.equal(h.store.snapshot('post').bookmarksCount, 2);
  assert.equal(h.store.snapshot('post').pending, false);
  assert.equal(h.writes.length, 1, 'external Saved changes are refreshed without another mutation');
});

test('a late session lookup cannot replace a newer auth event or write for its old viewer', async () => {
  const h = harness(), old = defer(); h.mount(); await flush();
  h.setSession(() => old.promise);
  const work = h.store.set('post', 'like', true); await flush();
  h.setSession(() => ({ data: { session: { user: { id: 'bob' } } }, error: null }));
  h.server('post').bookmarked.add('bob'); h.auth('bob'); await flush();
  old.resolve({ data: { session: { user: { id: 'alice' } } }, error: null });
  await work; await flush();
  assert.equal(h.writes.length, 0);
  assert.equal(h.store.snapshot('post').bookmarked, true);
  assert.equal(h.store.snapshot('post').liked, false);
  assert.equal(h.store.snapshot('post').pending, false);
});

test('a previous account read cannot overwrite a newer account snapshot', async () => {
  const h = harness(), old = defer(); let delayOld = true; h.mount(); await flush();
  h.setQuery((table, filters, fallback) => {
    if (!delayOld) return fallback(table, filters);
    const result = table === 'posts' ? { data: { likes_count: 99, bookmarks_count: 8 }, error: null }
      : { data: { post_id: 'post' }, error: null };
    return old.promise.then(() => result);
  });
  const work = h.store.refresh('post'); await flush(); delayOld = false;
  h.auth('bob'); await flush();
  old.resolve(); await work; await flush();
  assert.equal(h.store.snapshot('post').liked, false);
  assert.equal(h.store.snapshot('post').bookmarked, false);
  assert.equal(h.store.snapshot('post').likesCount, 4);
  assert.equal(h.store.snapshot('post').bookmarksCount, 2);
  assert.equal(h.store.snapshot('post').pending, false);
});

test('a session lookup error sends no interaction and provides recovery feedback', async () => {
  const h = harness(); h.setSession(() => ({ data: { session: null }, error: { message: 'unavailable' } })); h.mount();
  await h.store.set('post', 'like', true);
  assert.equal(h.writes.length, 0);
  assert.equal(h.store.snapshot('post').pending, false);
  assert.equal(h.store.snapshot('post').liked, false);
  assert.ok(h.store.snapshot('post').error);
});

test('a signed-out save preserves the known bookmark count without sending a write', async () => {
  const h = harness(); h.setSession(() => ({ data: { session: null }, error: null }));
  h.mount('post', seed({ bookmarksCount: 6 }));
  await h.store.set('post', 'bookmark', true);
  assert.equal(h.writes.length, 0);
  assert.equal(h.store.snapshot('post').bookmarked, false);
  assert.equal(h.store.snapshot('post').bookmarksCount, 6);
  assert.equal(h.store.snapshot('post').pending, false);
  assert.match(h.store.snapshot('post').error, /sign in/i);
});

function interactionBoundary(client) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/interactions.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports,
    require: name => name === '@/lib/supabase/client' ? { createClient: () => client } : require(name) });
  return module.exports;
}

test('the actual write boundary rejects an invalidated generation after its delayed identity lookup', async () => {
  for (const [name, on] of [['toggleLike', true], ['toggleBookmark', false]]) {
    const session = defer(); let current = true, dispatched = 0;
    const boundary = interactionBoundary({ auth: { getSession: () => session.promise },
      from() { dispatched++; throw new Error('A stale action must never reach the table'); } });
    const work = boundary[name]('post', on, 'alice', () => current);
    current = false; // Includes an A-to-B-to-A transition with the same final ID.
    session.resolve({ data: { session: { user: { id: 'alice' } } }, error: null });
    assert.equal(await work, false);
    assert.equal(dispatched, 0);
  }
});

test('the actual write boundary does not confirm a success for an expired generation', async () => {
  const write = defer(); let current = true, dispatched = 0;
  const boundary = interactionBoundary({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' } } }, error: null }) },
    from() { return { insert() { dispatched++; return write.promise; } }; },
  });
  const work = boundary.toggleLike('post', true, 'alice', () => current); await flush();
  assert.equal(dispatched, 1);
  current = false; write.resolve({ error: null });
  assert.equal(await work, false);
});
