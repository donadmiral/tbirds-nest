const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, TextEncoder });
  return exports;
}
const { automaticLiveStageScene: select, stableLiveStageSceneKey: key, LIVE_STAGE_SCENE_SETTLE_MS } = load('shared/liveStageScene.ts');
const { buildLiveLayout, validScene } = load('supabase/functions/live-core/provider.ts');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const member = n => ({ session_id: uuid(n + 100), user_id: uuid(n) });
const host = member(9), guest = member(2);
const scene = (participants, options = {}) => select({ participants, hostUserId: host.user_id, allowedGuestIds: participants.map(p => p.user_id).filter(Boolean), ...options });
const plain = value => JSON.parse(JSON.stringify(value));

test('one connected host is featured and exactly two cameras use the guest interview source', () => {
  assert.deepEqual(plain(scene([host])), { preset: 'host', participant_id: host.user_id, automatic: true });
  assert.deepEqual(plain(scene([host, guest])), { preset: 'interview', participant_id: guest.user_id, automatic: true });
});
test('three or more connected cameras make a stable host-first grid regardless of arrival order', () => {
  const participants = [member(3), host, guest];
  const expected = { preset: 'grid', participant_ids: [host.user_id, guest.user_id, member(3).user_id], automatic: true };
  assert.deepEqual(plain(scene(participants)), expected);
  assert.equal(key(scene(participants.reverse())), key(expected));
  assert.equal(key(scene(participants.map(p => ({ ...p, video: false, audio: true })))), key(expected));
  assert.equal(key(scene([...participants, { ...guest, session_id: uuid(222) } ])), key(expected));
});
test('actual stage cap and twelve-member maximum bound selection without dropping the host', () => {
  const participants = Array.from({ length: 20 }, (_, i) => member(i + 1));
  const capped = scene(participants, { maxMembers: 4 });
  assert.equal(capped.participant_ids.length, 4); assert.equal(capped.participant_ids[0], host.user_id);
  assert.equal(scene(participants, { maxMembers: 50 }).participant_ids.length, 12);
  assert.equal(scene(participants, { maxMembers: 2 }).preset, 'interview');
  assert.equal(scene(participants, { maxMembers: 1 }).preset, 'host');
});
test('manual screen, game, interview and camera choices suspend automatic commands', () => {
  for (const manualPreset of ['screen', 'game', 'host', 'grid', 'interview']) {
    assert.equal(scene([host, guest], { manualPreset }), null);
  }
  assert.equal(scene([host, guest], { manualPreset: null }).preset, 'interview');
  assert.equal(key(null), ''); assert.equal(LIVE_STAGE_SCENE_SETTLE_MS, 750);
});
test('only server-approved guests can join the automatic host layout', () => {
  const producer = member(4), camera = member(5), participants = [host, guest, producer, camera];
  assert.equal(select({ participants, hostUserId: host.user_id }).preset, 'host');
  assert.deepEqual(plain(scene(participants, { allowedGuestIds: [guest.user_id] })), {
    preset: 'interview', participant_id: guest.user_id, automatic: true,
  });
  assert.equal(scene(participants, { allowedGuestIds: [] }).preset, 'host');
});
test('invalid identities, absent host and non-connected entries cannot become stage sources', () => {
  assert.equal(scene([guest]), null);
  assert.equal(scene([host], { hostUserId: 'account-not-provider' }), null);
  assert.equal(scene([{ ...host, session_id: '' }, guest]), null);
  assert.equal(scene([host, { session_id: 'connected', user_id: 'unknown' }]).preset, 'host');
  assert.equal(scene([host, { session_id: 'connected' }]).preset, 'host');
});
test('departures update the canonical scene, while reorders and track events do not flap it', () => {
  const three = scene([host, guest, member(3)]), two = scene([guest, host]), one = scene([host]);
  assert.notEqual(key(three), key(two)); assert.notEqual(key(two), key(one));
  assert.equal(key(two), key(scene([{ ...host, audio: false }, { ...guest, video: true }])));
});
test('automatic scenes select the expected actual viewer video and audio allowlists', () => {
  for (const participants of [[host], [host, guest], [member(3), guest, host]]) {
    const context = { host_id: uuid(900), max_stage_members: 12, allowed_participants: participants.map(p => ({
      provider_identity: p.user_id, user_id: p === host ? uuid(900) : p.user_id, role: p === host ? 'host' : 'guest',
    })) };
    const presence = participants.map(p => ({ id: p.session_id, userId: p.user_id }));
    const selected = scene(participants); assert.equal(validScene(selected), true);
    const result = buildLiveLayout(selected, context, presence, false);
    const expected = [host, ...participants.filter(p => p !== host).sort((a, b) => a.user_id.localeCompare(b.user_id))].map(p => p.session_id);
    assert.deepEqual(plain(result.layout.participants.video), expected);
    assert.deepEqual(plain(result.layout.participants.audio), expected);
  }
});
