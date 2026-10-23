// Run: node tests/quality/auth-regressions.cjs
// Compare the same behavioral checks with the original revision:
// node tests/quality/auth-regressions.cjs --baseline
// No network, native modules, or real accounts are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'efbd0e38d774bd1574c066350dae6748fdb1cdca:src/stores/authStore.ts'], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, 'src/stores/authStore.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const session = (id, token = id) => ({ user: { id }, refresh_token: token });
const profile = (id, extra = {}) => ({ id, username: id, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

function harness(options = {}) {
  let state, now = 0, timerId = 0, callback, currentSession = Object.hasOwn(options, 'session') ? options.session : session('a');
  const timers = new Map(), links = new Set(), storage = new Map(), queries = [], logs = [], remembered = [], writes = [], cachedIds = [], toasts = [], snapshots = [];
  const responses = [];
  if (options.cached) storage.set('pc-profile-cache', JSON.stringify(options.cached));
  if (options.consumed) storage.set('pc-consumed-recovery', options.consumed);
  const fakeSetTimeout = (fn, ms = 0) => { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; };
  async function tick(ms = 0) {
    const end = now + ms;
    await flush();
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn(); await flush();
    }
    now = end; await flush();
  }
  const supabase = {
    auth: {
      getSession: () => options.getSession ? options.getSession() : Promise.resolve({ data: { session: currentSession } }),
      onAuthStateChange: (cb) => { callback = cb; return { data: { subscription: { unsubscribe: () => { callback = null; } } } }; },
      signOut: async () => { if (options.signOut) await options.signOut(); currentSession = null; callback?.('SIGNED_OUT', null); return { error: null }; },
    },
    from(table) {
      let id, update;
      const chain = {
        select() { return chain; },
        eq(_key, value) { id = value; return chain; },
        update(value) { update = value; return chain; },
        upsert(value) { writes.push({ table, value }); return Promise.resolve({ error: null }); },
        single: read,
        maybeSingle: read,
        then(resolve, reject) { writes.push({ table, id, value: update }); return Promise.resolve({ error: options.activationError ?? null }).then(resolve, reject); },
      };
      function read() {
        queries.push({ table, id });
        const response = responses.shift();
        return response === undefined ? Promise.resolve({ data: profile(id), error: null }) : typeof response === 'function' ? response(id) : Promise.resolve(response);
      }
      return chain;
    },
    rpc: () => Promise.resolve({ error: null }),
  };
  const storageApi = {
    getItem: async (key) => options.getItem ? options.getItem(key, storage) : storage.get(key) ?? null,
    setItem: async (key, value) => { storage.set(key, value); },
    removeItem: async (key) => { storage.delete(key); },
  };
  const modules = {
    zustand: { create: (initializer) => {
      const set = (next) => { state = { ...state, ...(typeof next === 'function' ? next(state) : next) }; snapshots.push(state); };
      state = initializer(set, () => state);
      return { getState: () => state };
    } },
    '@react-native-async-storage/async-storage': { default: storageApi },
    'expo-linking': { getInitialURL: async () => options.initialUrl ?? null, addEventListener: (_type, fn) => { links.add(fn); return { remove: () => links.delete(fn) }; } },
    'react-native-flash-message': { showMessage: (value) => toasts.push(value) },
    '../services/supabase': { supabase, setCachedUserId: (value) => cachedIds.push(value) },
    '../services/notificationBootstrap': { registerForPushNotifications: async () => {}, lastPushToken: null },
    '../services/nativeCallService': { nativeCallService: null },
    './accountsStore': { useAccountsStore: { getState: () => ({ remember: async (...args) => { remembered.push(args); } }) } },
  };
  const context = { exports: {}, require: (name) => { if (!modules[name]) throw Error(`Unexpected require: ${name}`); return modules[name]; }, setTimeout: fakeSetTimeout, clearTimeout: (id) => timers.delete(id), console: { log: (...args) => logs.push(args.join(' ')) }, Promise };
  vm.runInNewContext(compiled, context, { filename: 'authStore.js' });
  return {
    get state() { return context.exports.useAuthStore.getState(); },
    queries, responses, timers, links, storage, remembered, writes, cachedIds, toasts, snapshots, logs,
    tick,
    emit(event, value) { currentSession = value; callback?.(event, value); },
    warm(url) { for (const cb of links) cb({ url }); },
  };
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }
async function ready(options = {}) { const h = harness(options); const init = h.state.initialize(); await flush(); await init; return h; }

test('cached launch opens while the profile request is slow', async () => {
  const h = harness({ cached: profile('a') }); h.responses.push(deferred().promise);
  const init = h.state.initialize(); await flush(); await init;
  assert.equal(h.state.loading, false); assert.equal(h.state.profile.id, 'a');
});
test('token refresh preserves the current profile on a returned network error', async () => {
  const h = await ready(); h.responses.push({ data: null, error: { message: 'offline' } });
  h.emit('TOKEN_REFRESHED', session('a', 'new')); await h.tick();
  assert.equal(h.state.profile?.id, 'a'); assert.equal(h.state.session.refresh_token, 'new');
});
test('manual profile refresh preserves the profile on a thrown network error', async () => {
  const h = await ready(); h.responses.push(() => Promise.reject(Error('offline')));
  await h.state.refreshProfile(); assert.equal(h.state.profile?.id, 'a');
});
test('token refresh updates the session without waiting for its profile fetch', async () => {
  const h = await ready(); h.responses.push(deferred().promise);
  h.emit('TOKEN_REFRESHED', session('a', 'new')); await h.tick();
  assert.equal(h.state.session.refresh_token, 'new'); assert.equal(h.state.loading, false);
});
test('a stale refresh cannot restore a signed-out profile', async () => {
  const h = await ready(); const pending = deferred(); h.responses.push(pending.promise);
  const refresh = h.state.refreshProfile(); await h.state.signOut();
  pending.resolve({ data: profile('a'), error: null }); await refresh;
  assert.equal(h.state.session, null); assert.equal(h.state.profile, null); assert.equal(h.cachedIds.at(-1), null);
});
test('a stale profile result cannot repopulate the cache after sign-out', async () => {
  const h = await ready(); const pending = deferred(); h.responses.push(pending.promise);
  const refresh = h.state.refreshProfile(); await h.state.signOut();
  pending.resolve({ data: profile('a'), error: null }); await refresh;
  assert.equal(h.storage.has('pc-profile-cache'), false);
});
test('setSession clears a different account profile immediately', async () => {
  const h = await ready(); h.state.setSession(session('b'));
  assert.equal(h.state.profile, null); assert.equal(h.cachedIds.at(-1), 'b');
});
test('setSession invalidates an older profile refresh', async () => {
  const h = await ready(); const pending = deferred(); h.responses.push(pending.promise);
  const refresh = h.state.refreshProfile(); h.state.setSession(session('b'));
  pending.resolve({ data: profile('a'), error: null }); await refresh;
  assert.equal(h.state.session.user.id, 'b'); assert.equal(h.state.profile, null);
});
test('switching accounts discards an out-of-order auth profile result', async () => {
  const h = await ready(); const old = deferred(); h.responses.push(old.promise);
  h.emit('SIGNED_IN', session('b')); await h.tick(); h.emit('SIGNED_IN', session('c')); await h.tick();
  old.resolve({ data: profile('b'), error: null }); await flush();
  assert.equal(h.state.session.user.id, 'c'); assert.equal(h.state.profile.id, 'c');
});
test('sign-out invalidates reads before its deferred event handler runs', async () => {
  const h = await ready(); const pending = deferred(); h.responses.push(pending.promise);
  const refresh = h.state.refreshProfile(); h.emit('SIGNED_OUT', null);
  pending.resolve({ data: profile('a', { username: 'stale' }), error: null }); await refresh;
  assert.notEqual(h.state.profile?.username, 'stale'); await h.tick(); assert.equal(h.state.profile, null);
});
test('startup does not miss sign-out while getSession is pending', async () => {
  const pending = deferred(); const h = harness({ getSession: () => pending.promise });
  const init = h.state.initialize(); await flush(); h.emit('SIGNED_OUT', null); await h.tick();
  pending.resolve({ data: { session: session('a') } }); await init;
  assert.equal(h.state.session, null); assert.equal(h.state.loading, false);
});
test('startup does not overwrite an account switch while getSession is pending', async () => {
  const pending = deferred(); const h = harness({ getSession: () => pending.promise });
  const init = h.state.initialize(); await flush(); h.emit('SIGNED_IN', session('b')); await h.tick();
  pending.resolve({ data: { session: session('a') } }); await init;
  assert.equal(h.state.session.user.id, 'b'); assert.equal(h.state.profile.id, 'b');
});
test('late INITIAL_SESSION cannot undo sign-out', async () => {
  const h = await ready(); await h.state.signOut(); h.emit('INITIAL_SESSION', session('a')); await h.tick();
  assert.equal(h.state.session, null); assert.equal(h.state.profile, null);
});
test('late INITIAL_SESSION can recover a timed-out launch', async () => {
  const h = harness({ getSession: () => deferred().promise }); const init = h.state.initialize();
  await h.tick(6000); await init; h.emit('INITIAL_SESSION', session('a')); await h.tick();
  assert.equal(h.state.session?.user.id, 'a'); assert.equal(h.state.profile?.id, 'a');
});

test('late getSession can recover a timed-out launch without a second auth event', async () => {
  const pending = deferred(); const h = harness({ getSession: () => pending.promise }); const init = h.state.initialize();
  await h.tick(6000); await init; pending.resolve({ data: { session: session('a') } }); await flush();
  assert.equal(h.state.session?.user.id, 'a'); assert.equal(h.state.profile?.id, 'a');
});
test('late getSession cannot recover a launch after explicit sign-out', async () => {
  const pending = deferred(); const h = harness({ getSession: () => pending.promise }); const init = h.state.initialize();
  await h.tick(6000); await init; await h.state.signOut(); pending.resolve({ data: { session: session('a') } }); await flush();
  assert.equal(h.state.session, null); assert.equal(h.state.profile, null);
});
test('background profile metadata is not attached to another account session', async () => {
  const h = await ready(); const pending = deferred(); h.responses.push(pending.promise);
  const refresh = h.state.refreshProfile(); h.state.setSession(session('b')); const before = h.remembered.length;
  pending.resolve({ data: profile('a'), error: null }); await refresh; await flush();
  assert.equal(h.remembered.length, before);
});

test('INITIAL_SESSION can finish launch when getSession hangs', async () => {
  const h = harness({ getSession: () => deferred().promise }); const init = h.state.initialize(); await flush();
  h.emit('INITIAL_SESSION', session('a')); await flush();
  assert.equal(h.state.loading, false); assert.equal(h.state.profile?.id, 'a');
  await h.tick(6000); await init;
});
test('uncached startup stops waiting at the profile deadline and reuses its request', async () => {
  const h = harness(); const pending = deferred(); h.responses.push(pending.promise); const init = h.state.initialize();
  await flush(); await h.tick(8000); await init;
  assert.equal(h.state.loading, false); assert.equal(h.queries.length, 1);
  pending.resolve({ data: profile('a'), error: null }); await flush(); assert.equal(h.state.profile?.id, 'a');
});
test('uncached auth events stop waiting at the profile deadline and heal later', async () => {
  const h = await ready({ session: null }); const pending = deferred(); h.responses.push(pending.promise);
  h.emit('SIGNED_IN', session('a')); await h.tick(); await h.tick(8000);
  assert.equal(h.state.loading, false); assert.equal(h.state.session?.user.id, 'a'); assert.equal(h.queries.length, 1);
  pending.resolve({ data: profile('a'), error: null }); await flush(); assert.equal(h.state.profile?.id, 'a');
});
test('profile healing shares one in-flight read across repeated retries', async () => {
  const h = await ready(); const pending = deferred(); h.responses.push(pending.promise, pending.promise, pending.promise);
  const before = h.queries.length; const reads = [h.state.healProfile(), h.state.healProfile(), h.state.refreshProfile()];
  assert.equal(h.queries.length - before, 1); pending.resolve({ data: profile('a'), error: null }); await Promise.all(reads);
});
test('successful launch clears all timeout timers', async () => {
  const h = await ready(); assert.equal(h.timers.size, 0);
});
test('reinitializing removes the previous recovery URL listener', async () => {
  const h = await ready(); await h.state.initialize(); assert.equal(h.links.size, 1);
});
test('recovery URLs are not logged', async () => {
  const url = 'platinum://auth/callback?type=recovery&access_token=private-test-token';
  const h = await ready({ initialUrl: url }); h.warm(`${url}&warm=1`);
  assert.equal(h.logs.some((line) => line.includes('private-test-token')), false); assert.equal(h.state.isPasswordRecovery, true);
});
test('consumed recovery links do not reopen recovery', async () => {
  const url = 'platinum://auth/callback?type=recovery&access_token=test';
  const h = await ready({ initialUrl: url, consumed: url }); h.warm(url); assert.equal(h.state.isPasswordRecovery, false);
});
test('recovery events retain the recovery gate while loading the matching profile', async () => {
  const h = await ready(); h.emit('PASSWORD_RECOVERY', session('b')); await h.tick();
  assert.equal(h.state.isPasswordRecovery, true); assert.equal(h.state.profile?.id, 'b'); assert.equal(h.state.session.user.id, 'b');
});

test('a same-tick token refresh cannot discard the password recovery gate', async () => {
  const h = await ready(); h.emit('PASSWORD_RECOVERY', session('a')); h.emit('TOKEN_REFRESHED', session('a', 'new')); await h.tick();
  assert.equal(h.state.isPasswordRecovery, true); assert.equal(h.state.session.refresh_token, 'new');
});
test('suppressed recovery events do not reopen the recovery gate', async () => {
  const h = await ready(); h.state.setSuppressRecoveryRedirect(true); h.emit('PASSWORD_RECOVERY', session('a')); await h.tick();
  assert.equal(h.state.isPasswordRecovery, false); assert.equal(h.state.suppressRecoveryRedirect, true);
});

test('suppressed recovery sign-out clears the recovery gate and launch spinner', async () => {
  const h = await ready(); h.state.setSuppressRecoveryRedirect(true); h.state.setPasswordRecovery(true);
  h.emit('SIGNED_OUT', null); await h.tick(); assert.equal(h.state.isPasswordRecovery, false); assert.equal(h.state.loading, false); assert.equal(h.state.session, null);
});
test('a genuine missing profile is not replaced with a stale cached profile', async () => {
  const h = await ready(); h.responses.push({ data: null, error: null }); await h.state.refreshProfile();
  assert.equal(h.state.profile, null); assert.equal(h.storage.has('pc-profile-cache'), false);
});
test('a failed account-reactivation update does not announce success', async () => {
  const h = harness({ activationError: { message: 'unavailable' } }); h.responses.push({ data: profile('a', { deactivated_at: '2026-01-01' }), error: null });
  await h.state.initialize(); await h.tick(600); assert.equal(h.toasts.length, 0); assert.equal(h.state.profile.deactivated_at, '2026-01-01');
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
  }
  console.log(`${tests.length - failed}/${tests.length} auth regression checks passed`);
  process.exitCode = failed ? 1 : 0;
})();
