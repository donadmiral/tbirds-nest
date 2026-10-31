const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { createFixture, FixtureWebSocket, OWNER } = require('../native/backend-fixture.cjs');
const origin = 'https://uaulhuelcfkjwojtymmw.supabase.co';

test('fixture installation initializes the real WHATWG types behind React Native lazy fetch before overriding it', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const { installFixtureTransport } = require('../native/install-fixture-transport.cjs');
  const source = fs.readFileSync(require.resolve('whatwg-fetch'), 'utf8');
  const runtime = vm.createContext({ URL, URLSearchParams, setTimeout, clearTimeout, console });
  let initialized = 0;
  Object.defineProperty(runtime, 'fetch', {
    configurable: true,
    get() {
      initialized++;
      Object.defineProperty(runtime, 'fetch', { configurable: true, writable: true, value: undefined });
      vm.runInContext(source, runtime);
      return runtime.fetch;
    },
    set(value) { Object.defineProperty(runtime, 'fetch', { configurable: true, writable: true, value }); },
  });
  const fixture = createFixture();
  installFixtureTransport(fixture, FixtureWebSocket, runtime);
  assert.equal(initialized, 1);
  assert.equal(runtime.fetch, fixture.fetch);
  assert.equal(runtime.WebSocket, FixtureWebSocket);
  const headers = new runtime.Headers({ Authorization: 'Bearer synthetic' });
  assert.equal(headers.get('authorization'), 'Bearer synthetic');
  const response = new runtime.Response(JSON.stringify({ ready: true }), { headers: { 'Content-Type': 'application/json' } });
  assert.equal((await response.json()).ready, true);
});

test('native UI fixtures run the actual Supabase authentication and PostgREST adapters without a provider request', async () => {
  const fixture = createFixture();
  const client = createClient(origin, 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fixture.fetch },
  });
  const missing = await client.from('profiles').select('*');
  assert.equal(missing.status, 401);
  const wrong = await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'wrong' });
  assert.equal(wrong.error.code, 'invalid_credentials');
  const login = await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal(login.error, null);
  assert.equal(login.data.user.id, OWNER);
  assert.equal((await client.auth.getUser()).data.user.id, OWNER);
  const profile = await client.from('profiles').select('*').eq('id', OWNER).single();
  assert.equal(profile.error, null);
  assert.equal(profile.data.full_name, 'Alex Rivera');
  const feed = await client.rpc('get_feed', { p_cursor_key: null, p_cursor_id: null });
  assert.equal(feed.data.length, 2);
  assert.equal((await client.from('notifications').select('id', { count: 'exact', head: true })).count, 0);
  assert.equal(fixture.receipt.unhandled.length, 0);
  assert.equal(fixture.receipt.networkForwarded, false);
  await client.auth.signOut();
  assert.equal((await client.from('profiles').select('*')).status, 401);
});

test('an unimplemented endpoint or external provider is a recorded failure, never a green empty response', async () => {
  const fixture = createFixture();
  const remote = await fixture.fetch('https://example.com/provider');
  assert.equal(remote.status, 501);
  assert.equal(fixture.receipt.unhandled[0].path, 'https://example.com/provider');
  await fixture.fetch(origin + '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' }) });
  const unknown = await fixture.fetch(origin + '/rest/v1/rpc/unimplemented', { method: 'POST', body: '{}' });
  assert.equal(unknown.status, 501);
  assert.equal(fixture.receipt.unhandled.length, 2);
});

test('the full app connectivity probe has an explicit local health response and retains abort/offline failures', async () => {
  const fixture = createFixture();
  const health = await fixture.fetch(origin + '/auth/v1/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).name, 'Synthetic native UI Auth health');
  assert.equal(fixture.receipt.requests[0].owner, null);
  assert.equal(fixture.receipt.networkForwarded, false);
  assert.equal(fixture.receipt.unhandled.length, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fixture.fetch(origin + '/auth/v1/health', { signal: controller.signal }), { name: 'AbortError' });
  fixture.configure({ offline: true });
  await assert.rejects(fixture.fetch(origin + '/auth/v1/health'), /Synthetic offline/);
  fixture.configure({ offline: false });
  assert.equal((await fixture.fetch(origin + '/auth/v1/health', { method: 'POST' })).status, 501);
  assert.equal(fixture.receipt.unhandled.length, 1, 'only the actual GET health operation is implemented');
});

test('the isolated socket completes actual Phoenix join/heartbeat messages without opening a network socket', async () => {
  const socket = new FixtureWebSocket();
  await new Promise(resolve => { socket.onopen = resolve; });
  const response = new Promise(resolve => { socket.onmessage = event => resolve(JSON.parse(event.data)); });
  socket.send(JSON.stringify([null, '1', 'realtime:feed', 'phx_join', {}]));
  assert.deepEqual(await response, [null, '1', 'realtime:feed', 'phx_reply', { status: 'ok', response: { postgres_changes: [] } }]);
  socket.close();
  assert.equal(socket.readyState, FixtureWebSocket.CLOSED);
});
