const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
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
  assert.equal((await command(viewer, 'request_join')).data.ok, true);
  assert.equal((await detail(viewer)).data.own_join_request.status, 'pending');
  assert.equal((await command(viewer, 'cancel_join_request')).data.ok, true);
  assert.equal((await detail(viewer)).data.own_join_request, null);
  const producerState = (await detail(producer)).data;
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
