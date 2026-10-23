// node --test tests/chat-media-cache.test.cjs
// Baseline comparison: node tests/chat-media-cache.test.cjs --baseline
// Executes both real helpers with synthetic Auth/Functions and a controlled clock.
/* global __dirname */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
// Sealed original blobs also exist in published parent 309c750c; no local-only commit is required.
const baseline = {
  'src/services/chatMediaService.ts': 'eabe22330246947d37017994a94fe991d4f4657c',
  'web/lib/chatMedia.ts': '59d64dfb0fe136449ee2fcd69f19b0c8b6161539',
};
const ttl = 60 * 1000;
const plain = (value) => JSON.parse(JSON.stringify(value));
const session = (id) => id ? { user: { id } } : null;
const row = (id = 'message-1', file = 'one.jpg') => ({
  id, media_url: `https://qa.example.test/storage/v1/object/public/chat-media/u/${file}`,
  text: 'Keep caller fields', thumbnail_url: 'unchanged-thumbnail',
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function client(label = 'first') {
  const callbacks = new Set();
  const state = {
    userId: 'account-a', calls: [], registrations: 0, unsubscriptions: 0,
    sessionCalls: 0, sessionImpl: null, invokeImpl: null, lastCallback: null,
  };
  const api = {
    auth: {
      async getSession() {
        state.sessionCalls += 1;
        return state.sessionImpl ? state.sessionImpl() : { data: { session: session(state.userId) }, error: null };
      },
      onAuthStateChange(callback) {
        state.registrations += 1;
        state.lastCallback = callback;
        callbacks.add(callback);
        return { data: { subscription: { unsubscribe() {
          state.unsubscriptions += 1;
          callbacks.delete(callback);
        } } } };
      },
    },
    functions: {
      async invoke(name, args) {
        const call = { name, args: plain(args), userId: state.userId, index: state.calls.length + 1 };
        state.calls.push(call);
        return state.invokeImpl ? state.invokeImpl(call) : response(call);
      },
    },
  };
  function response(call) {
    return { data: { urls: Object.fromEntries(call.args.body.messageIds.map((id) =>
      [id, `https://signed.example.test/${label}/${call.userId}/${id}?request=${call.index}`])) }, error: null };
  }
  function emit(event, userId) {
    state.userId = userId;
    for (const callback of callbacks) {
      assert.equal(callback(event, session(userId)), undefined, 'Auth callback must remain synchronous');
    }
  }
  return { api, state, emit, response, callbacks };
}

function harness(file) {
  let current = client();
  let now = 1_800_000_000_000;
  const imports = {
    '@/lib/supabase/client': { createClient: () => current.api },
    './supabase': { get supabase() { return current.api; } },
  };
  const source = process.argv.includes('--baseline')
    ? execFileSync('git', ['show', baseline[file]], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  class Clock extends Date { static now() { return now; } }
  const context = {
    exports: {}, Date: Clock, console: { log() {} },
    require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`); return imports[name]; },
  };
  vm.runInNewContext(compiled, context, { filename: file });
  return {
    ...context.exports,
    get client() { return current; },
    replaceClient(next) { current = next; },
    advance(ms) { now += ms; },
  };
}

for (const file of ['web/lib/chatMedia.ts', 'src/services/chatMediaService.ts']) {
  test(`${file}: same account reuses media until the short one-minute cache expiry`, async () => {
    const h = harness(file);
    const first = await h.signChatMediaMap([row()]);
    h.client.emit('TOKEN_REFRESHED', 'account-a');
    h.client.emit('SIGNED_IN', 'account-a');
    h.advance(ttl - 1);
    assert.deepEqual(plain(await h.signChatMediaMap([row()])), plain(first));
    assert.equal(h.client.state.calls.length, 1);
    h.advance(1);
    const expired = await h.signChatMediaMap([row()]);
    assert.notEqual(expired['message-1'], first['message-1']);
    assert.equal(h.client.state.calls.length, 2);
    assert.equal(h.client.state.calls[0].name, 'chat-media-sign');
    assert.deepEqual(h.client.state.calls[0].args, { body: { messageIds: ['message-1'] } });
  });

  test(`${file}: a changed canonical locator cannot reuse the same message's URL`, async () => {
    const h = harness(file);
    const first = await h.signChatMediaMap([row()]);
    const changed = await h.signChatMediaMap([row('message-1', 'replacement.jpg')]);
    assert.equal(h.client.state.calls.length, 2);
    assert.notEqual(changed['message-1'], first['message-1']);
  });

  test(`${file}: account switching and sign-out while idle clear old capabilities`, async () => {
    const h = harness(file);
    const first = await h.signChatMediaMap([row()]);
    h.client.emit('SIGNED_IN', 'account-b');
    assert.match((await h.signChatMediaMap([row()]))['message-1'], /account-b/);
    h.client.emit('SIGNED_IN', 'account-a');
    assert.notEqual((await h.signChatMediaMap([row()]))['message-1'], first['message-1']);
    const before = h.client.state.calls.length;
    h.client.emit('SIGNED_OUT', null);
    h.client.emit('SIGNED_IN', 'account-a');
    await h.signChatMediaMap([row()]);
    assert.equal(h.client.state.calls.length, before + 1);
  });

  test(`${file}: pending account switch discards both cached hits and late results`, async () => {
    const h = harness(file);
    await h.signChatMediaMap([row('cached')]);
    const started = deferred(), result = deferred();
    h.client.state.invokeImpl = (call) => { started.resolve(call); return result.promise; };
    const pending = h.signChatMediaMap([row('cached'), row('pending')]);
    const call = await started.promise;
    h.client.emit('SIGNED_IN', 'account-b');
    result.resolve(h.client.response(call));
    assert.deepEqual(plain(await pending), {});
    h.client.state.invokeImpl = null;
    const fresh = await h.signChatMediaMap([row('cached'), row('pending')]);
    assert.ok(Object.values(fresh).every((url) => url.includes('account-b')));
  });

  test(`${file}: signing out and back in during a batch fences the old session`, async () => {
    const h = harness(file);
    const started = deferred(), result = deferred();
    h.client.state.invokeImpl = (call) => { started.resolve(call); return result.promise; };
    const rows = Array.from({ length: 101 }, (_, i) => row(`message-${i}`));
    const pending = h.signChatMediaMap(rows);
    const call = await started.promise;
    h.client.emit('SIGNED_OUT', null);
    h.client.emit('SIGNED_IN', 'account-a');
    result.resolve(h.client.response(call));
    assert.deepEqual(plain(await pending), {});
    assert.equal(h.client.state.calls.length, 1, 'must not start another batch for an obsolete session');
    h.client.state.invokeImpl = null;
    await h.signChatMediaMap([rows[0]]);
    assert.equal(h.client.state.calls.length, 2, 'late result must not repopulate the cache');
  });

  test(`${file}: a switch during the second batch also discards completed first-batch results`, async () => {
    const h = harness(file);
    const started = deferred(), result = deferred();
    h.client.state.invokeImpl = (call) => {
      if (call.index === 1) return h.client.response(call);
      started.resolve(call);
      return result.promise;
    };
    const pending = h.signChatMediaMap(Array.from({ length: 101 }, (_, i) => row(`message-${i}`)));
    const call = await started.promise;
    assert.deepEqual(h.client.state.calls.map((c) => c.args.body.messageIds.length), [100, 1]);
    h.client.emit('SIGNED_IN', 'account-b');
    result.resolve(h.client.response(call));
    assert.deepEqual(plain(await pending), {});
  });

  test(`${file}: a rejected stale request cannot return earlier cached hits`, async () => {
    const h = harness(file);
    await h.signChatMediaMap([row('cached')]);
    const started = deferred(), result = deferred();
    h.client.state.invokeImpl = (call) => { started.resolve(call); return result.promise; };
    const pending = h.signChatMediaMap([row('cached'), row('pending')]);
    await started.promise;
    h.client.emit('SIGNED_OUT', null);
    result.reject(new Error('Synthetic network interruption'));
    assert.deepEqual(plain(await pending), {});
  });

  test(`${file}: an obsolete getSession result cannot restore the previous account`, async () => {
    const h = harness(file);
    const started = deferred(), result = deferred();
    h.client.state.sessionImpl = () => { started.resolve(); return result.promise; };
    const pending = h.signChatMediaMap([row()]);
    assert.equal(h.client.state.sessionCalls, 1, 'must read the cache account before using signed media');
    await started.promise;
    h.client.emit('SIGNED_IN', 'account-b');
    result.resolve({ data: { session: session('account-a') }, error: null });
    assert.deepEqual(plain(await pending), {});
    assert.equal(h.client.state.calls.length, 0);
    h.client.state.sessionImpl = null;
    assert.match((await h.signChatMediaMap([row()]))['message-1'], /account-b/);
  });

  test(`${file}: initial-session delivery during getSession keeps valid first loads working`, async () => {
    const h = harness(file);
    const result = deferred();
    h.client.state.sessionImpl = () => result.promise;
    const pending = h.signChatMediaMap([row()]);
    h.client.emit('INITIAL_SESSION', 'account-a');
    result.resolve({ data: { session: session('account-a') }, error: null });
    assert.match((await pending)['message-1'], /account-a/);
    assert.equal(h.client.state.calls.length, 1);
  });

  test(`${file}: getSession also detects a changed account when no event has arrived`, async () => {
    const h = harness(file);
    await h.signChatMediaMap([row()]);
    h.client.state.userId = 'account-b';
    assert.match((await h.signChatMediaMap([row()]))['message-1'], /account-b/);
    assert.equal(h.client.state.calls.length, 2);
  });

  test(`${file}: null sessions and Auth failures never expose public-form private locators`, async () => {
    const h = harness(file);
    const rows = [row()];
    h.client.state.userId = null;
    assert.equal((await h.signChatMedia(rows))[0].media_url, null);
    h.client.state.sessionImpl = () => ({ data: { session: session('account-a') }, error: new Error('Synthetic Auth failure') });
    assert.equal((await h.signChatMedia(rows))[0].media_url, null);
    h.client.state.sessionImpl = () => { throw new Error('Synthetic Auth rejection'); };
    assert.equal((await h.signChatMedia(rows))[0].media_url, null);
    assert.equal(h.client.state.calls.length, 0);
  });

  for (const failure of ['returned', 'thrown']) {
    test(`${file}: ${failure} signing failure retains partial success without a public fallback`, async () => {
      const h = harness(file);
      h.client.state.invokeImpl = (call) => {
        if (call.index === 1) return h.client.response(call);
        if (failure === 'thrown') throw new Error('Synthetic signing rejection');
        return { data: null, error: new Error('Synthetic signing error') };
      };
      const rows = Array.from({ length: 101 }, (_, i) => row(`message-${i}`));
      const before = plain(rows);
      const result = await h.signChatMedia(rows);
      assert.match(result[0].media_url, /signed\.example\.test/);
      assert.equal(result[0].text, rows[0].text);
      assert.equal(result[0].thumbnail_url, rows[0].thumbnail_url);
      assert.equal(result[100].media_url, null);
      assert.deepEqual(rows, before, 'must not mutate canonical caller rows');
    });
  }

  test(`${file}: empty and public non-chat media do not create an Auth subscription`, async () => {
    const h = harness(file);
    const rows = [{ id: 'external', media_url: 'https://public.example.test/photo.jpg' }, { id: 'text', media_url: null }];
    assert.equal(await h.signChatMedia(rows), rows);
    assert.deepEqual(plain(await h.signChatMediaMap([])), {});
    assert.equal(h.client.state.registrations, 0);
    assert.equal(h.client.state.calls.length, 0);
  });

  test(`${file}: one listener per client; replacement unsubscribes and fences old work`, async () => {
    const h = harness(file);
    const old = h.client;
    await h.signChatMediaMap([row('cached')]);
    await h.signChatMediaMap([row('cached')]);
    assert.equal(old.state.registrations, 1);
    const started = deferred(), result = deferred();
    old.state.invokeImpl = (call) => { started.resolve(call); return result.promise; };
    const pending = h.signChatMediaMap([row('pending')]);
    const call = await started.promise;
    const next = client('replacement');
    h.replaceClient(next);
    const fresh = await h.signChatMediaMap([row('cached')]);
    assert.match(fresh.cached, /replacement/);
    assert.equal(old.state.unsubscriptions, 1);
    assert.equal(old.callbacks.size, 0);
    assert.equal(next.state.registrations, 1);
    old.state.lastCallback('SIGNED_OUT', null); // Already queued callback from a retired client.
    result.resolve(old.response(call));
    assert.deepEqual(plain(await pending), {});
    assert.deepEqual(plain(await h.signChatMediaMap([row('cached')])), plain(fresh));
    assert.equal(next.state.calls.length, 1, 'retired callbacks must not clear the current cache');
  });

  test(`${file}: only requested, string-valued response URLs enter the cache`, async () => {
    const h = harness(file);
    h.client.state.invokeImpl = () => ({ data: { urls: { wanted: 'https://signed.example.test/valid', unrelated: 'https://signed.example.test/wrong', bad: 42 } }, error: null });
    assert.deepEqual(plain(await h.signChatMediaMap([row('wanted'), row('bad')])), { wanted: 'https://signed.example.test/valid' });
    h.client.state.invokeImpl = null;
    await h.signChatMediaMap([row('unrelated')]);
    assert.equal(h.client.state.calls.length, 2);
  });
}
