const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto').webcrypto;

const root = path.resolve(__dirname, '..');
const actor = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const post = '20000000-0000-4000-8000-000000000001';
const conversation = '30000000-0000-4000-8000-000000000001';
const pause = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

/** Execute the real sharing helper, real platform outbox and real delivery
 * reconciliation. Only the storage transport, Auth and PostgREST are fakes. */
function runtime(platform, options = {}) {
  const disk = options.disk || { web: new Map(), native: null };
  const cache = new Map(), events = [], persistedAtPost = [];
  const rows = options.rows || new Map();
  let authCalls = 0, posts = 0;
  const server = {
    account: actor, offline: false, lostResponse: false, denied: false, rows,
    get posts() { return posts; }, get authCalls() { return authCalls; },
    auth: { async getSession() {
      const call = ++authCalls;
      if (options.authGate?.call === call) await options.authGate.promise;
      events.push('auth');
      return { data: { session: server.account ? { user: { id: server.account } } : null }, error: null };
    } },
    from(table) {
      assert.equal(table, 'messages');
      let input, filters = {};
      const query = {
        select() { return query; }, eq(key, value) { filters[key] = value; return query; },
        single() { return query; }, maybeSingle() { return query; },
        insert(values) { input = values[0]; return query; },
        async abortSignal() {
          if (server.offline) throw Error('offline');
          if (!input) return { data: [...rows.values()].find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) || null, error: null };
          posts++; events.push('POST');
          persistedAtPost.push(persisted().some(row => row.id === input.id && row.shared_post_id === input.shared_post_id));
          if (server.denied) return { data: null, error: { code: '42501' } };
          const row = { ...input, created_at: new Date().toISOString() };
          rows.set(input.id, row);
          if (server.lostResponse) { server.lostResponse = false; server.offline = true; throw Error('accepted response lost'); }
          return { data: row, error: null };
        },
      };
      return query;
    },
  };
  const webStorage = {
    get length() { return disk.web.size; }, key: index => [...disk.web.keys()][index], getItem: key => disk.web.get(key) ?? null,
    setItem(key, value) { if (options.failWrites) throw Error('storage unavailable'); disk.web.set(key, value); events.push('persist'); options.onWrite?.(server); },
    removeItem: key => disk.web.delete(key),
  };
  const nativeStorage = {
    async getItem() { if (options.hydrationGate) await options.hydrationGate; return disk.native; },
    async setItem(_key, value) {
      if (options.writeGate) await options.writeGate;
      if (options.failWrites) throw Error('storage unavailable');
      disk.native = value; events.push('persist'); options.onWrite?.(server);
    },
    async removeItem() { disk.native = null; },
  };
  function persisted() {
    return platform === 'web' ? [...disk.web.values()].map(value => JSON.parse(value)) : JSON.parse(disk.native || '{"state":{"outbox":[]}}').state.outbox;
  }
  function load(relative) {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} }; cache.set(file, module.exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const requireModule = name => {
      if (name === '@react-native-async-storage/async-storage') return nativeStorage;
      if (name === 'react-native') return { AppState: { addEventListener() { return { remove() {} }; } } };
      if (name.endsWith('/supabase') || name === './supabase') return { supabase: server };
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts')));
      return require(name);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: requireModule, crypto, AbortController, setTimeout, clearTimeout,
      setInterval: () => 0, fetch: async () => ({ status: 200 }), window: { localStorage: webStorage }, process: { env: {} }, console });
    return module.exports;
  }
  const helper = load(platform === 'web' ? 'web/lib/postSharing.ts' : 'src/services/postSharing.ts');
  return {
    server, disk, events, persistedAtPost, persisted,
    share: (overrides = {}) => platform === 'web'
      ? helper.sharePostToConversation(server, overrides.actor ?? actor, overrides.post ?? post, overrides.conversation ?? conversation, overrides.receiver === undefined ? other : overrides.receiver)
      : helper.sharePostToConversation(overrides.actor ?? actor, overrides.post ?? post, overrides.conversation ?? conversation, overrides.receiver === undefined ? other : overrides.receiver),
  };
}

for (const platform of ['web', 'native']) {
  test(`${platform}: pending share keeps its ID across retries and reload after a lost accepted response`, async () => {
    const first = runtime(platform); first.server.lostResponse = true;
    assert.equal((await first.share()).status, 'pending');
    await pause();
    assert.equal(first.server.posts, 1); assert.equal(first.persisted().length, 1);
    const savedId = first.persisted()[0].id;
    assert.equal((await first.share()).status, 'pending'); await pause();
    assert.equal(first.persisted()[0].id, savedId); assert.equal(first.server.posts, 1);
    const reloaded = runtime(platform, { disk: first.disk, rows: first.server.rows });
    const recovered = await reloaded.share(); await pause();
    assert.equal(recovered.status, 'confirmed'); assert.equal(recovered.row.id, savedId);
    assert.equal(reloaded.server.posts, 0, 'reconcile accepted message without a second POST');
    assert.equal(reloaded.persisted().length, 0);
  });

  test(`${platform}: share is durably persisted before POST and a write failure prevents POST`, async () => {
    const success = runtime(platform); assert.equal((await success.share()).status, 'confirmed');
    assert.deepEqual(success.persistedAtPost, [true]);
    assert.ok(success.events.indexOf('persist') < success.events.indexOf('POST'));
    const failure = runtime(platform, { failWrites: true });
    await assert.rejects(failure.share(), /storage|save/i); assert.equal(failure.server.posts, 0);
    assert.equal(failure.persisted().length, 0);
  });

  test(`${platform}: account change after persistence retains the share without a POST`, async () => {
    const h = runtime(platform, { onWrite: server => { server.account = other; } });
    assert.equal((await h.share()).status, 'pending'); await pause();
    assert.equal(h.server.posts, 0); assert.equal(h.persisted()[0].sender_id, actor);
    const initialMismatch = runtime(platform); initialMismatch.server.account = other;
    await assert.rejects(initialMismatch.share(), /Sign in/);
    assert.equal(initialMismatch.server.posts, 0); assert.equal(initialMismatch.persisted().length, 0);
  });

  test(`${platform}: concurrent duplicate taps share one persisted message and POST`, async () => {
    const h = runtime(platform);
    const result = await Promise.all([h.share(), h.share(), h.share()]); await pause();
    assert.ok(result.every(row => row.status === 'confirmed'));
    assert.equal(new Set(result.map(row => row.row.id)).size, 1); assert.equal(h.server.posts, 1);
  });

  test(`${platform}: definite denial retains the same reviewable share for an explicit retry`, async () => {
    const h = runtime(platform); h.server.denied = true;
    assert.equal((await h.share()).status, 'rejected'); await pause();
    const denied = h.persisted()[0]; assert.ok(denied); assert.equal(denied.shared_post_id, post);
    if (platform === 'web') assert.equal(denied._delivery, 'rejected'); else assert.equal(denied.failed, true);
    h.server.denied = false; const result = await h.share(); await pause();
    assert.equal(result.status, 'confirmed'); assert.equal(result.row.id, denied.id); assert.equal(h.persisted().length, 0);
  });

  test(`${platform}: recipient and conversation boundaries do not reuse an unrelated pending ID`, async () => {
    const h = runtime(platform); h.server.offline = true;
    await h.share(); await h.share({ receiver: null }); await h.share({ conversation: 'different-conversation' }); await pause();
    assert.equal(h.persisted().length, 3); assert.equal(new Set(h.persisted().map(row => row.id)).size, 3);
  });
}

test('native: hydration and durable-write waits complete before network delivery', async () => {
  const hydration = deferred(), write = deferred();
  const h = runtime('native', { hydrationGate: hydration.promise, writeGate: write.promise });
  const pending = h.share(); await pause();
  assert.equal(h.server.authCalls, 0); assert.equal(h.server.posts, 0);
  hydration.resolve(); await pause(); assert.equal(h.server.posts, 0); assert.equal(h.persisted().length, 0);
  write.resolve(); assert.equal((await pending).status, 'confirmed'); assert.deepEqual(h.persistedAtPost, [true]);
});

test('web: duplicate taps with a delayed Auth response cannot create another share after the first confirms', async () => {
  const gate = deferred();
  const h = runtime('web', { authGate: { call: 2, promise: gate.promise } });
  const first = h.share(), second = h.share();
  await pause();
  // Without the share-level lock, call 2 belongs to the second tap and the
  // first POST completes while it waits. With the lock, call 2 is the first
  // tap's pre-delivery session check, so allow that one operation to continue.
  if (h.server.posts === 0) gate.resolve();
  const firstResult = await first;
  gate.resolve(); const secondResult = await second;
  assert.equal(firstResult.status, 'confirmed'); assert.equal(secondResult.status, 'confirmed');
  assert.equal(h.server.posts, 1);
  assert.equal(firstResult.row.id, secondResult.row.id);
});
