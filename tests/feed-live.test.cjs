const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../shared/feedLive.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const post = n => ({ id: uuid(n), authorId: uuid(1000 + n) });
const row = (n, likes = 1) => ({ post_id: uuid(n), content: 'Post ' + n, body: null, likes_count: likes,
  comments_count: 0, reposts_count: 0, bookmarks_count: 0, shares_count: 0, views_count: 0,
  viewer_liked: false, viewer_bookmarked: false, viewer_reposted: false,
  comment_id: null, comment_body: null, comment_author: null, delivery_healthy: true });

function harness(options = {}) {
  let now = 100000, timerId = 0, ownerCurrent = true, pending = false;
  let capability = { version: 1, enabled: true, configured: true, max_ids: 24 };
  let remove = async () => {};
  let reply = async (name, args) => ({ data: name === 'get_feed_live_capability' ? capability
    : args.p_ids.flatMap(id => server.has(id) ? [server.get(id)] : []), error: null });
  const timers = new Map(), channels = new Map(), joins = [], reads = [], applies = [], heads = [], access = [], modes = [], server = new Map();
  class ClockDate extends Date { static now() { return now; } }
  const module = { exports: {} };
  const setTimeout = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; };
  const clearTimeout = id => timers.delete(id);
  vm.runInNewContext(source, { module, exports: module.exports, Date: ClockDate, AbortController, setTimeout, clearTimeout, console });
  const client = {
    rpc(name, args) {
      const call = { name, args, at: now, signal: null }; reads.push(call);
      return { abortSignal(signal) { call.signal = signal; return Promise.resolve().then(() => reply(name, args, call)); } };
    },
    channel(name, config) {
      if (channels.has(name)) return channels.get(name); // Installed SDK reuses a topic.
      joins.push({ name, at: now });
      assert.equal(config.config.private, true);
      const channel = { name, event: null, callback: null, status: null,
        on(type, filter, callback) { assert.equal(type, 'broadcast'); this.event = filter.event; this.callback = callback; return this; },
        subscribe(callback) { this.status = callback; setTimeout(() => { if (channels.get(name) === this) callback('SUBSCRIBED'); }, 10); return this; } };
      channels.set(name, channel); return channel;
    },
    async removeChannel(channel) { await remove(channel); if (channels.get(channel.name) === channel) channels.delete(channel.name); },
  };
  const live = module.exports.createFeedLive({ client, owner: uuid(9000), current: () => ownerCurrent,
    mode: value => modes.push(value), hasPending: () => pending,
    apply: (ids, rows, requestedAt) => { applies.push({ ids: [...ids], rows: [...rows], requestedAt }); return options.apply?.(ids, rows, requestedAt); },
    head: async request => { heads.push(now); await options.head?.(request); },
    access: async (authors, request) => { access.push(authors); await options.access?.(authors, request); }, random: () => .5,
  });
  async function advance(ms) {
    await settle(); const until = now + ms; let work = 0;
    while (true) {
      const next = [...timers].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++work < 10000, 'timers must remain bounded');
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await settle();
    }
    now = until; await settle();
  }
  return { live, timers, channels, joins, reads, applies, heads, access, modes, server, advance, client, createLive: module.exports.createFeedLive,
    window: module.exports.feedLiveWindow, now: () => now,
    setReply(value) { reply = value; }, setCapability(value) { capability = value; }, setCurrent(value) { ownerCurrent = value; },
    setRemoval(value) { remove = value; },
    setPending(value) { pending = value; live.pendingChanged(); },
    emit(topic) { const channel = channels.get(topic); assert.ok(channel, topic); channel.callback({ payload: { content: 'UNTRUSTED' } }); },
    async start(posts = [post(1)]) { posts.forEach(value => server.set(value.id, row(Number(value.id.slice(-12))))); live.setWindow(posts); await live.start(); await advance(1000); },
  };
}

test('the interest window is bounded around the visible row and ignores invalid/duplicate identities', () => {
  const h = harness(), posts = Array.from({ length: 80 }, (_, index) => post(index + 1));
  assert.deepEqual(Array.from(h.window(posts, uuid(30)), value => value.id), posts.slice(26, 38).map(value => value.id));
  assert.equal(h.window(posts, null, 1000).length, 24);
  assert.equal(h.window([post(1), post(1), { id: 'bad', authorId: uuid(9) }], null).length, 1);
  h.live.dispose();
});

test('healthy idle feeds have no recurring reads and subscribe only to the nearby private window', async () => {
  const h = harness(); await h.start(Array.from({ length: 12 }, (_, index) => post(index + 1)));
  assert.equal(h.channels.size, 27, '12 posts + 12 authors + viewer + head + recovery');
  assert.equal(h.reads.filter(read => read.name === 'get_feed_live_state').length, 1);
  const total = h.reads.length; await h.advance(600000);
  assert.equal(h.reads.length, total); assert.equal(h.heads.length, 1, 'One initial join catch-up closes the final-insert gap');
  assert.equal(h.applies[0].rows[0].content, 'Post 1', 'Broadcast content is never used as displayed data');
  h.live.dispose(); await settle(); assert.equal(h.channels.size, 0); assert.equal(h.timers.size, 0);
});

test('a burst coalesces, updates during an in-flight read cannot lose the final change, and popular posts do not starve', async () => {
  const h = harness(); await h.start(); const held = defer(); let calls = 0;
  h.setReply(async (name, args) => {
    if (name === 'get_feed_live_capability') return { data: { version: 1, enabled: true, configured: true, max_ids: 24 } };
    calls++; return calls === 1 ? held.promise : { data: args.p_ids.map(() => row(1, 9)), error: null };
  });
  for (let i = 0; i < 1000; i++) h.emit('feed:post:' + uuid(1));
  await h.advance(2000); assert.equal(calls, 1);
  for (let i = 0; i < 1000; i++) h.emit('feed:post:' + uuid(1));
  held.resolve({ data: [row(1, 5)], error: null }); await settle();
  assert.equal(h.applies.at(-1).rows[0].likes_count, 5, 'Even a continuously changing post gets canonical progress');
  await h.advance(2500); assert.equal(calls, 2); assert.equal(h.applies.at(-1).rows[0].likes_count, 9);
  await h.advance(60000); assert.equal(calls, 2); h.live.dispose();
});

test('old responses cannot enter a removed-and-readded window, and missing authorized rows are applied as removals', async () => {
  const h = harness(); await h.start(); const held = defer(); let calls = 0;
  h.setReply(async () => ++calls === 1 ? held.promise : ({ data: [], error: null }));
  h.emit('feed:post:' + uuid(1)); await h.advance(2000);
  h.live.setWindow([post(2)]); h.live.setWindow([post(1)]);
  held.resolve({ data: [row(1, 500)], error: null }); await settle();
  assert.ok(h.applies.at(-1).rows.every(row => row.likes_count !== 500));
  await h.advance(2500); assert.deepEqual(h.applies.at(-1).ids, [uuid(1)]); assert.equal(h.applies.at(-1).rows.length, 0);
  h.live.dispose();
});

test('irrelevant global inserts cannot create unbounded head reads and a populated pill stops them', async () => {
  const h = harness(); await h.start();
  for (let i = 0; i < 60; i++) { h.emit('feed:head:v1'); await h.advance(1000); }
  assert.equal(h.heads.length, 4); h.heads.slice(1).forEach((at, index) => assert.ok(at - h.heads[index] >= 15000));
  h.setPending(true); await settle(); assert.equal(h.channels.has('feed:head:v1'), false);
  await h.advance(60000); assert.equal(h.heads.length, 4);
  h.setPending(false); await settle(); assert.equal(h.channels.has('feed:head:v1'), true);
  h.emit('feed:head:v1'); await h.advance(1000); assert.equal(h.heads.length, 5); h.live.dispose();
});

test('author and viewer invalidations coalesce canonical visibility checks without trusting their payload', async () => {
  const h = harness(); await h.start([post(1), post(2)]);
  h.access.length = 0;
  for (let i = 0; i < 1000; i++) h.emit('feed:author:' + post(1).authorId);
  await h.advance(2000); assert.equal(h.access.length, 1); assert.deepEqual(Array.from(h.access[0]), [post(1).authorId]);
  h.emit('feed:viewer:' + uuid(9000)); h.emit('feed:author:' + post(2).authorId); await h.advance(2500);
  assert.equal(h.access.length, 2); assert.equal(h.access[1], null); h.live.dispose();
});

test('hidden screens abort reads, disconnect, do no work, and catch up once on resume', async () => {
  const h = harness(); await h.start(); const held = defer(); let waiting = true;
  h.setReply(async (name, args) => name === 'get_feed_live_capability'
    ? ({ data: { version: 1, enabled: true, configured: true, max_ids: 24 } })
    : waiting ? held.promise : ({ data: args.p_ids.map(() => row(1, 8)) }));
  h.emit('feed:post:' + uuid(1)); await h.advance(2000);
  const call = h.reads.at(-1); h.live.setActive(false); await settle(); assert.equal(call.signal.aborted, true);
  const before = h.reads.length; await h.advance(600000); assert.equal(h.reads.length, before); assert.equal(h.channels.size, 0);
  waiting = false; h.live.setActive(true); await h.advance(3000); assert.equal(h.applies.at(-1).rows[0].likes_count, 8);
  held.resolve({ data: [row(1, 2)] }); await settle(); assert.equal(h.applies.at(-1).rows[0].likes_count, 8); h.live.dispose();
});

test('account changes and disposal fence stale snapshots and leave no background timers', async () => {
  const h = harness(); await h.start(); const held = defer(); h.setReply(() => held.promise);
  h.emit('feed:post:' + uuid(1)); await h.advance(2000); const previous = h.applies.length;
  h.setCurrent(false); h.live.dispose(); held.resolve({ data: [row(1, 9)] }); await settle();
  assert.equal(h.applies.length, previous); assert.equal(h.timers.size, 0); assert.equal(h.channels.size, 0);
});

test('older deployments retain legacy mode and a transient capability outage never revives global fanout', async () => {
  const h = harness(); h.setCapability({ version: 1, configured: false, enabled: false, max_ids: 24 });
  await h.start(); assert.equal(h.channels.size, 0); assert.equal(h.reads.length, 1);
  h.setCapability({ version: 1, configured: true, enabled: true, max_ids: 24 }); await h.live.start(); await h.advance(1000);
  assert.deepEqual(h.modes, [true]);
  h.setReply(async () => { throw new Error('Network unavailable'); }); await h.live.start();
  assert.deepEqual(h.modes, [true]); h.live.dispose();
});

test('worker backlog and disconnected channels use bounded recovery, then stop when delivery is healthy', async () => {
  const h = harness(); await h.start();
  h.server.set(uuid(1), { ...row(1, 2), delivery_healthy: false }); h.emit('feed:post:' + uuid(1)); await h.advance(2500);
  const before = h.reads.length; await h.advance(60000);
  assert.ok(h.reads.length - before >= 1 && h.reads.length - before <= 2);
  h.server.set(uuid(1), row(1, 3)); await h.advance(32000);
  const healthy = h.reads.length; await h.advance(60000); assert.equal(h.reads.length, healthy);
  const channel = h.channels.get('feed:post:' + uuid(1)); channel.status('CHANNEL_ERROR'); await h.advance(32000);
  assert.ok(h.reads.length > healthy); channel.status('SUBSCRIBED'); await h.advance(3000);
  const rejoined = h.reads.length; await h.advance(60000); assert.equal(h.reads.length, rejoined); h.live.dispose();
});

test('pending own mutations retry only their bounded IDs and fresh state is read after settlement', async () => {
  let pending = true;
  const h = harness({ apply: ids => pending ? ids : [] }); await h.start();
  assert.equal(h.reads.filter(read => read.name === 'get_feed_live_state').length, 1);
  pending = false; h.server.set(uuid(1), row(1, 12)); await h.advance(2500);
  assert.equal(h.applies.at(-1).rows[0].likes_count, 12);
  const final = h.reads.length; await h.advance(60000); assert.equal(h.reads.length, final); h.live.dispose();
});

test('pausing cancels external head/access batches and fences callbacks through a later resume', async () => {
  const hold = defer(), requests = [];
  const h = harness({ head: async request => { requests.push(request); await hold.promise; },
    access: async (_authors, request) => { requests.push(request); await hold.promise; } });
  await h.start(); assert.equal(requests.length, 2); assert.ok(requests.every(request => request.current()));
  h.live.setActive(false); await settle();
  assert.ok(requests.every(request => request.signal.aborted && !request.current()));
  h.live.setActive(true); await h.advance(1000);
  assert.ok(requests.slice(0, 2).every(request => !request.current()), 'Old generation never becomes current again');
  hold.resolve(); await settle(); h.live.dispose(); await settle(); assert.equal(h.timers.size, 0);
});

test('recovery hints and changed recovery generations reconcile final outage writes within explicit budgets', async () => {
  const h = harness(); await h.start(); h.access.length = 0; const before = h.reads.length;
  h.server.set(uuid(1), row(1, 30)); h.emit('feed:recovery:v1'); await h.advance(2500);
  assert.equal(h.applies.at(-1).rows[0].likes_count, 30); assert.equal(h.access.length, 1);
  for (let i = 0; i < 30; i++) { h.emit('feed:recovery:v1'); await h.advance(1000); }
  assert.ok(h.access.length <= 3, 'A global recovery stream cannot sweep retained pages every two seconds');
  assert.ok(h.reads.length - before <= 17, 'Hot window reads remain coalesced');
  h.setCapability({ version: 1, configured: true, enabled: true, max_ids: 24, recovery_generation: 2 });
  const accessBefore = h.access.length; await h.live.start(); await h.advance(18000);
  assert.ok(h.access.length > accessBefore, 'A client that missed the recovery hint still catches the generation at its normal probe');
  h.live.dispose();
});

test('rapid scroll windows coalesce subscription churn while still preparing the final visible IDs', async () => {
  const h = harness(); await h.start(Array.from({ length: 12 }, (_, index) => post(index + 1)));
  const before = h.joins.length;
  for (let page = 1; page <= 5; page++) {
    const posts = Array.from({ length: 12 }, (_, index) => post(page * 100 + index));
    posts.forEach(post => h.server.set(post.id, row(Number(post.id.slice(-12)))));
    h.live.setWindow(posts); await h.advance(400);
  }
  await h.advance(2500);
  assert.ok(h.joins.length - before <= 48, 'Five disjoint windows need at most two actual subscription replacements');
  assert.equal(h.channels.size, 27); assert.ok(h.channels.has('feed:post:' + uuid(500)));
  assert.ok(h.applies.some(batch => batch.rows.some(row => row.post_id === uuid(500)))); h.live.dispose();
});

test('rapid pause/resume waits for the SDK leave before reusing a topic', async () => {
  const h = harness(), held = defer(); await h.start(); const before = h.joins.length;
  h.setRemoval(() => held.promise); h.live.setActive(false); h.live.setActive(true); await h.advance(1000);
  assert.equal(h.joins.length, before, 'Never subscribe a new owner to a leaving channel');
  held.resolve(); await h.advance(1000); assert.equal(h.joins.length, before * 2);
  h.server.set(uuid(1), row(1, 19)); h.emit('feed:post:' + uuid(1)); await h.advance(2500);
  assert.equal(h.applies.at(-1).rows[0].likes_count, 19); h.live.dispose(); await settle(); assert.equal(h.channels.size, 0);
});

test('overlapping feed owners share a topic lease without one owner unsubscribing the other', async () => {
  const h = harness(); await h.start(); const before = h.joins.length, received = [];
  const peer = h.createLive({ client: h.client, owner: uuid(9000), current: () => true, mode() {},
    apply: (_ids, rows) => { received.push(...rows); }, head: async () => {}, hasPending: () => false, access: async () => {}, random: () => .5 });
  peer.setWindow([post(1)]); await peer.start(); await h.advance(1000);
  assert.equal(h.joins.length, before, 'One SDK subscription serves both live owners');
  h.live.dispose(); await settle(); assert.equal(h.channels.size, before);
  h.server.set(uuid(1), row(1, 40)); h.emit('feed:post:' + uuid(1)); await h.advance(2500);
  assert.equal(received.at(-1).likes_count, 40); peer.dispose(); await settle(); assert.equal(h.channels.size, 0);
});
