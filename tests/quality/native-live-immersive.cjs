const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const YAML = require('yaml');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { createFixture, FixtureWebSocket, OWNER, PEER } = require('../native/backend-fixture.cjs');
const { livePlaybackFixtureOverlay, liveFrameFixtureOverlay } = require('../../scripts/quality/native-ui-feed-video-overlay.cjs');

test('native immersive journey uses actual SDK contracts for story presence, reply, requests and producer approval', async () => {
  const fixture = createFixture(() => {}, { immersiveLive: true, feedVideoSource: async () => 'file:///packaged/native.mp4' });
  const client = createClient('https://uaulhuelcfkjwojtymmw.supabase.co', 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fixture.fetch }, realtime: { transport: FixtureWebSocket },
  });
  await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  const args = { p_filter: 'following', p_state: 'live', p_topic: null, p_cursor: null, p_limit: 24 };
  const directory = await client.rpc('live_directory', args);
  assert.equal(directory.error, null); assert.equal(directory.data.items.length, 2);
  assert.equal(directory.data.items[0].host.id, PEER);
  assert.deepEqual((await client.rpc('live_directory', { ...args, p_filter: 'mine', p_limit: 1 })).data.items, []);
  const viewer = directory.data.items[0].id, producer = directory.data.items[1].id;
  const detail = id => client.rpc('live_session', { p_session_id: id });
  let sequence = 0;
  const command = (id, action, payload = {}) => client.rpc('live_command', { p_session_id: id, p_action: action, p_payload: payload,
    p_request_id: '99000000-0000-4000-8000-' + String(++sequence).padStart(12, '0') });
  assert.equal((await detail(viewer)).data.role, 'viewer');
  assert.equal((await detail(viewer)).data.can_request_join, true);
  assert.equal((await client.rpc('feed_block_exists', { p_author: PEER })).data, false);
  const host = (await client.rpc('get_profile', { p_profile_id: PEER })).data;
  assert.equal(host.viewer_follows, false); assert.equal(host.viewer_requested, false);
  assert.equal((await command(viewer, 'request_join')).data.ok, true);
  assert.equal((await detail(viewer)).data.own_join_request.status, 'pending');
  assert.equal((await detail(viewer)).data.can_request_join, false);
  assert.equal((await command(viewer, 'cancel_join_request')).data.ok, true);
  assert.equal((await detail(viewer)).data.own_join_request, null);
  assert.equal((await detail(viewer)).data.can_request_join, true);
  const producerState = (await detail(producer)).data;
  assert.equal(producerState.can_request_join, false);
  assert.equal(producerState.role, 'producer'); assert.equal(producerState.join_requests[0].user_id, PEER);
  assert.equal((await command(producer, 'accept_join_request', { user_id: PEER })).data.ok, true);
  assert.equal((await detail(producer)).data.members[0].status, 'accepted');
  assert.equal((await detail(producer)).data.stage.available, 10);
  const message = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic chat broadcast did not traverse the actual Supabase channel')), 2000);
    const channel = client.channel((fixture.receipt.immersiveLive.enabled && producerState.chat_topic).replace(producer, viewer), { config: { private: true } });
    channel.on('broadcast', { event: 'message' }, event => { clearTimeout(timer); resolve(event.payload); });
    channel.subscribe(async state => { if (state === 'SUBSCRIBED') await command(viewer, 'chat', { body: '@qa_jordan Thanks for sharing this live.' }); });
  });
  assert.equal((await message).body, '@qa_jordan Thanks for sharing this live.');
  const ticket = await client.functions.invoke('live-playback', { body: { sessionId: viewer } });
  assert.equal(ticket.error, null);
  assert.deepEqual(fixture.nativeLiveVideoSource(ticket.data), { uri: 'file:///packaged/native.mp4', contentType: 'progressive', useCaching: false });
  assert.throws(() => fixture.nativeLiveVideoSource({ url: 'https://unapproved.invalid/live' }), /Unexpected/);
  fixture.recordLiveFrame(viewer); fixture.recordLiveProgress(viewer, 0); fixture.recordLiveProgress(viewer, 1);
  assert.deepEqual(fixture.receipt.immersiveLive.frames, [viewer]);
  assert.deepEqual(fixture.receipt.immersiveLive.progress, [{ id: viewer, seconds: 1 }]);
  assert.equal(fixture.receipt.immersiveLive.providerAcceptance, false);
  assert.equal(fixture.receipt.immersiveLive.providerStageConnected, false);
  assert.equal(fixture.receipt.immersiveLive.commands.length, 4);
  assert.ok(fixture.receipt.immersiveLive.commands.every(row => row.owner === OWNER));
  assert.deepEqual(fixture.receipt.unhandled, []);
  await client.removeAllChannels(); await client.auth.signOut();
});

test('native Live overlays replace only the declared synthetic media boundary and observe real frame/time events', () => {
  for (const [file, overlay] of [['src/contexts/LivePlaybackContext.tsx', livePlaybackFixtureOverlay], ['src/screens/feed/LiveSessionScreen.tsx', liveFrameFixtureOverlay]]) {
    const original = fs.readFileSync(file, 'utf8'), changed = overlay(original);
    assert.equal(ts.createSourceFile(file, changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0);
    assert.throws(() => overlay(changed), /Expected/);
    assert.ok(changed.includes('fixtureRuntime()'));
  }
  const source = fs.readFileSync('scripts/quality/verify-native-ui.cjs', 'utf8');
  assert.match(source, /immersive\.frames\.includes\(viewerLive\)/);
  assert.match(source, /immersive\.progress\.some/);
  assert.match(source, /rows\.length !== 1/);
});

test('native Clips entry reads only the existing non-recording viewer fixture and leaves all mutations unsupported', async () => {
  const fixture = createFixture(() => {}, { immersiveLive: true });
  const client = createClient('https://uaulhuelcfkjwojtymmw.supabase.co', 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fixture.fetch },
  });
  await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  const sessionId = '90000000-0000-4000-8000-000000000001';
  const args = { p_session_id: sessionId, p_cursor: null, p_limit: 24, p_sort: 'newest' };
  const library = await client.rpc('live_clip_library', args);
  assert.equal(library.error, null); assert.deepEqual(library.data, { items: [], next_cursor: null });
  const context = await client.rpc('live_clip_context', { p_session_id: sessionId });
  assert.equal(context.error, null);
  assert.equal(context.data.session_id, sessionId);
  for (const key of ['can_clip', 'can_manage', 'recording_available', 'viewer_clipping']) assert.equal(context.data[key], false);
  assert.equal(context.data.available_start_ms, 0); assert.equal(context.data.max_duration_ms, 600000);
  assert.ok(Number.isSafeInteger(context.data.available_end_ms) && context.data.available_end_ms >= 0);
  assert.deepEqual(context.data.settings, { viewer_clipping: false, review_required: true, watermark_required: true,
    watermark: true, brand_text: 'Platinum Circles', copyright_policy: 'standard', can_manage: false, approved_user_ids: [] });
  assert.deepEqual(fixture.receipt.unhandled, []);
  assert.equal(fixture.receipt.requests.filter(row => row.path === '/rest/v1/rpc/live_clip_library').length, 1);
  assert.equal(fixture.receipt.requests.filter(row => row.path === '/rest/v1/rpc/live_clip_context').length, 1);
  for (const [rpc, payload] of [
    ['live_clip_library', { ...args, p_session_id: '90000000-0000-4000-8000-000000000099' }],
    ['live_clip_context', { p_session_id: '90000000-0000-4000-8000-000000000002' }],
    ['live_clip_library', { ...args, p_admin: true }],
    ['live_clip_command', { p_session_id: sessionId, p_action: 'create', p_payload: {} }],
  ]) {
    const response = await client.rpc(rpc, payload);
    assert.equal(response.error?.code, 'NATIVE_UI_UNHANDLED'); assert.equal(response.status, 501);
  }
  assert.equal(fixture.receipt.unhandled.length, 4);
  assert.equal(fixture.receipt.mutations.length, 0);
  assert.equal(fixture.receipt.immersiveLive.providerAcceptance, false);
  await client.auth.signOut();
});

test('the installed native Clips round trip requires a dismissed sheet and usable screen without changing earlier Live requirements', () => {
  const flow = YAML.parseAllDocuments(fs.readFileSync('tests/native/flows/live-immersive.yaml', 'utf8'))[1].toJSON();
  const start = flow.findIndex(command => command.tapOn === 'More live tools');
  assert.ok(start >= 0, 'Exercise the actual tools entry');
  const expected = [
    { tapOn: 'More live tools' }, { tapOn: 'Clips' }, { tapOn: 'Open clips' },
    { extendedWaitUntil: { visible: 'Clip library', timeout: 15000 } },
    { assertNotVisible: 'Close live tools' },
    { extendedWaitUntil: { visible: 'Your clips will appear here', timeout: 15000 } },
    { assertNotVisible: 'Creator clip controls' },
    { tapOn: 'Refresh' },
    { extendedWaitUntil: { visible: 'Your clips will appear here', timeout: 15000 } },
    { takeScreenshot: 'live-clips-library' }, { tapOn: '^Back$' },
    { extendedWaitUntil: { visible: { id: 'native-live-player' }, timeout: 15000 } },
    { assertVisible: { id: 'live-overlay-chat' } }, { assertNotVisible: 'Clip library' },
  ];
  assert.deepEqual(flow.slice(start, start + expected.length), expected);
  const original = [...flow.slice(0, start), ...flow.slice(start + expected.length)];
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex'), 'e97d080f0b0f3e8d98126e4a891450939bb6429422ecbaa92d8cba92fd051b90',
    'All original Live actions, assertions, deadlines and screenshots remain unchanged');
});
