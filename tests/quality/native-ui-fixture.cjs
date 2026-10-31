const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { createFixture, FixtureWebSocket, OWNER, PEER } = require('../native/backend-fixture.cjs');
const { BOOK, NAVIGATION_BOOK } = require('../native/memory-fixture.cjs');
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

test('observed Home ancillary requests return the exact synthetic unread and empty-announcement/ranking contracts', async () => {
  const fixture = createFixture();
  const client = createClient(origin, 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fixture.fetch },
  });
  await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  const unread = await client.rpc('get_context_unread');
  assert.equal(unread.error, null);
  assert.deepEqual(unread.data, { market: 0, jobs: 0, groups: 0, personal: 1 });
  const announcement = await client.from('announcements').select('id,title,body').eq('active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  assert.equal(announcement.error, null); assert.equal(announcement.data, null);
  const ranked = await client.rpc('get_trending_stories', { p_limit: 8 });
  assert.equal(ranked.error, null); assert.deepEqual(ranked.data, []);
  const catchup = await client.rpc('get_catchup_feed');
  assert.equal(catchup.data.length, 1, 'a story exists without claiming a trending-rank snapshot');
  await client.auth.signOut();
  await client.auth.signInWithPassword({ email: 'qa.jordan@example.invalid', password: 'FixtureOnly-2026!' });
  assert.deepEqual((await client.rpc('get_context_unread')).data, { market: 0, jobs: 0, groups: 0, personal: 0 });
  assert.equal(fixture.receipt.unhandled.length, 0); assert.equal(fixture.receipt.networkForwarded, false);
  await client.auth.signOut();
});

test('the Jobs screen application helper reads the versioned empty page through the actual Supabase adapter', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../../shared/hiring.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Error, Date });
  const fixture = createFixture();
  const client = createClient(origin, 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fixture.fetch },
  });
  await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  const page = await module.exports.loadMyApplicationPage(client);
  assert.deepEqual(page, { applications: [], has_more: false, cursor: null });
  assert.ok(fixture.receipt.requests.some(request => request.method === 'POST' && request.path === '/rest/v1/rpc/my_application_page'));
  assert.equal(fixture.receipt.unhandled.length, 0); assert.equal(fixture.receipt.networkForwarded, false);
  await client.auth.signOut();
});

test('native book fixtures persist a revisioned owner edit through actual Supabase adapters and a fresh shelf/read', async () => {
  const fixture = createFixture();
  const client = createClient(origin, 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fixture.fetch },
  });
  await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  const shelf = await client.rpc('get_memory_albums', { p_owner: OWNER });
  assert.equal(shelf.error, null); assert.equal(shelf.data.is_owner, true);
  assert.deepEqual(shelf.data.books.map(book => book.id), [NAVIGATION_BOOK]);
  assert.equal(shelf.data.books[0].pages, undefined, 'the shelf returns a summary, not private page payloads');
  const { data: book } = await client.rpc('get_memory_book', { p_album: NAVIGATION_BOOK });
  assert.equal(book.presentation_revision, 0); assert.equal(book.pages.length, 2);
  assert.ok(book.pages.every(page => page.media_type === 'text' && page.media_url === null));
  assert.deepEqual((await client.rpc('get_memory_book_creative_capabilities')).data, { version: 1, supported: true });
  const args = { p_album: NAVIGATION_BOOK, p_expected_revision: 0, p_audience: 'only_me', p_title: 'THE LONG WAY HOME',
    p_subtitle: book.subtitle, p_cover_color: 'sage', p_cover_design: 'postcard', p_cover_story_id: null,
    p_cover_artwork: { ...book.cover_artwork, inscription: 'Roads worth remembering', inscriptionStyle: 'sans', postmark: 'DESERT DAYS' },
    p_film_settings: { ...book.film_settings, style: 'cinematic' } };
  const badArtwork = await client.rpc('save_memory_book_creative_presentation', { ...args,
    p_cover_artwork: { ...args.p_cover_artwork, photoUrl: 'https://foreign.example/private' } });
  assert.equal(badArtwork.status, 400); assert.equal(fixture.receipt.mutations.length, 0);
  const save = await client.rpc('save_memory_book_creative_presentation', args);
  assert.equal(save.error, null); assert.equal(save.data.presentation_revision, 1);
  const stale = await client.rpc('save_memory_book_creative_presentation', args);
  assert.equal(stale.status, 409); assert.equal(stale.error.message, 'MEMORY_BOOK_CHANGED');
  assert.equal(fixture.receipt.mutations.length, 1);
  const fresh = await client.rpc('get_memory_book', { p_album: NAVIGATION_BOOK });
  assert.equal(fresh.data.title, 'THE LONG WAY HOME'); assert.equal(fresh.data.presentation_revision, 1);
  assert.deepEqual(fresh.data.cover_artwork, args.p_cover_artwork); assert.deepEqual(fresh.data.film_settings, args.p_film_settings);
  assert.equal((await client.rpc('get_memory_albums', { p_owner: OWNER })).data.books[0].title, 'THE LONG WAY HOME');
  const capture = await client.rpc('get_memory_book', { p_album: BOOK });
  assert.equal(capture.data.title, 'THE CAPTURED MOMENTS'); assert.equal(capture.data.presentation_revision, 0);
  assert.equal(fixture.receipt.bookReads[0].revision, 0); assert.equal(fixture.receipt.bookReads[0].title, 'THE SMALL ADVENTURES');
  assert.equal(fixture.receipt.bookReads.at(-1).revision, 1);
  assert.equal(fixture.receipt.unhandled.length, 0); assert.equal(fixture.receipt.networkForwarded, false);
  await client.auth.signOut();
});

test('private synthetic books deny another actor and reject a previous session token after an owner returns', async () => {
  const fixture = createFixture();
  const client = createClient(origin, 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fixture.fetch },
  });
  const login = await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  const token = login.data.session.access_token;
  await client.auth.signOut();
  const other = await client.auth.signInWithPassword({ email: 'qa.jordan@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal(other.data.user.id, PEER);
  const shelf = await client.rpc('get_memory_albums', { p_owner: OWNER });
  assert.deepEqual(shelf.data, { is_owner: false, books: [] });
  assert.equal((await client.rpc('get_memory_book', { p_album: NAVIGATION_BOOK })).data, null);
  assert.equal((await client.rpc('get_memory_book', { p_album: BOOK })).data, null);
  const wrongActor = await client.rpc('save_memory_book_creative_presentation', { p_album: NAVIGATION_BOOK, p_expected_revision: 0 });
  assert.equal(wrongActor.status, 403);
  await client.auth.signOut();
  await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  const oldSession = await client.rpc('save_memory_book_creative_presentation', { p_album: NAVIGATION_BOOK, p_expected_revision: 0 }).setHeader('Authorization', 'Bearer ' + token);
  assert.equal(oldSession.status, 403);
  assert.equal(fixture.receipt.mutations.length, 0); assert.equal(fixture.receipt.unhandled.length, 0);
  await client.auth.signOut();
});
