const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../shared/notificationPreferences.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleValue, exports: moduleValue.exports, AbortController, setTimeout, clearTimeout, Promise, Date });
const { categoryEnabled, notificationAllowed, pushEnabled, createNotificationPreferenceEditor } = moduleValue.exports;
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const copy = value => JSON.parse(JSON.stringify(value));

test('master pause silences every category and restoring it preserves individually muted categories', () => {
  const profile = { notif_prefs: { all: false, likes: false, messages: true } };
  for (const type of ['message', 'incoming_call', 'payment_received', 'system', 'job_referral']) assert.equal(notificationAllowed(profile, type), false);
  profile.notif_prefs.all = true;
  assert.equal(notificationAllowed(profile, 'message'), true);
  assert.equal(notificationAllowed(profile, 'incoming_call'), true);
  assert.equal(notificationAllowed(profile, 'like'), false);
  assert.equal(pushEnabled(profile), true);
});

test('explicit category enable recovers old master-toggle booleans and per-type disables', () => {
  const profile = { notif_messages: false, notif_connections: false, notif_jobs: false,
    notif_prefs: { message: false, message_reaction: false, follow: false, job_application: false } };
  assert.equal(categoryEnabled(profile, 'messages'), false);
  assert.equal(categoryEnabled(profile, 'message_reactions'), false);
  assert.equal(notificationAllowed(profile, 'message'), false);
  profile.notif_prefs.messages = true; profile.notif_prefs.followers = true; profile.notif_prefs.jobs = true;
  for (const type of ['message', 'message_request', 'follow', 'connection_accepted', 'job_application', 'job_referral']) assert.equal(notificationAllowed(profile, type), true, type);
  assert.equal(notificationAllowed(profile, 'message_reaction'), false);
});

test('quiet hours handle midnight, local offsets and exact boundaries equally for calls and ordinary pushes', () => {
  const profile = { quiet_from: 22, quiet_to: 7, quiet_tz_offset_min: 120 };
  for (const type of ['message', 'incoming_call']) {
    assert.equal(notificationAllowed(profile, type, Date.parse('2026-10-31T20:00:00Z')), false);
    assert.equal(notificationAllowed(profile, type, Date.parse('2026-10-31T04:59:59Z')), false);
    assert.equal(notificationAllowed(profile, type, Date.parse('2026-10-31T05:00:00Z')), true);
  }
  assert.equal(notificationAllowed({ quiet_from: 8, quiet_to: 8 }, 'message'), true);
});

test('unknown, missing and deactivated accounts never receive pushes', () => {
  assert.equal(notificationAllowed(null, 'message'), false);
  assert.equal(notificationAllowed({ deactivated_at: '2026-10-31' }, 'message'), false);
  assert.equal(notificationAllowed({ deleted_at: '2026-10-31' }, 'incoming_call'), false);
  assert.equal(notificationAllowed({ notif_prefs: { updates: false } }, 'future_type'), false);
});

function harness(options = {}) {
  let current = true, profile = { notif_prefs: { likes: false }, notif_messages: true };
  const states = [], writes = [];
  const editor = createNotificationPreferenceEditor({
    isCurrent: () => current, read: options.read || (async () => copy(profile)), timeoutMs: options.timeoutMs,
    write: async (key, enabled, signal) => {
      writes.push({ key, enabled, signal });
      if (options.write) return options.write(key, enabled, signal);
      profile.notif_prefs[key] = enabled;
      return copy(profile.notif_prefs);
    },
    onState: value => states.push(value),
  });
  return { editor, states, writes, invalidate() { current = false; }, profile: () => profile };
}

test('a full off/on/remount journey persists master state and category choices', async () => {
  const h = harness(); await h.editor.load();
  assert.equal(await h.editor.set('all', false), true);
  assert.equal(pushEnabled(h.editor.getState().profile), false);
  await h.editor.load(); assert.equal(pushEnabled(h.editor.getState().profile), false);
  assert.equal(await h.editor.set('all', true), true);
  assert.equal(categoryEnabled(h.editor.getState().profile, 'likes'), false);
  assert.deepEqual(h.writes.map(({ key, enabled }) => ({ key, enabled })), [{ key: 'all', enabled: false }, { key: 'all', enabled: true }]);
  h.editor.dispose();
});

test('rapid repeated taps cannot race full JSON snapshots or overwrite another device category', async () => {
  const gate = deferred(); const h = harness({ write: () => gate.promise }); await h.editor.load();
  const save = h.editor.set('messages', false);
  assert.equal(await h.editor.set('jobs', false), false);
  await turn(); assert.equal(h.writes.length, 1);
  gate.resolve({ messages: false, jobs: false, likes: false });
  assert.equal(await save, true);
  assert.equal(categoryEnabled(h.editor.getState().profile, 'jobs'), false);
  h.editor.dispose();
});

test('a stale refresh cannot overwrite an optimistic choice or its confirmed database result', async () => {
  const refresh = deferred(); let reads = 0;
  const h = harness({ read: () => ++reads === 1 ? Promise.resolve({ notif_prefs: {} }) : refresh.promise });
  await h.editor.load(); const loading = h.editor.load(); await turn();
  assert.equal(await h.editor.set('all', false), true);
  refresh.resolve({ notif_prefs: { all: true } }); await loading;
  assert.equal(pushEnabled(h.editor.getState().profile), false);
  h.editor.dispose();
});

test('database rejection and malformed confirmations restore the saved choice and show an issue', async () => {
  for (const write of [async () => { throw Error('RLS denied'); }, async () => ({}), async () => ({ all: true })]) {
    const h = harness({ write }); await h.editor.load();
    assert.equal(await h.editor.set('all', false), false);
    assert.equal(pushEnabled(h.editor.getState().profile), true);
    assert.equal(h.editor.getState().pending, null);
    assert.match(h.editor.getState().issue, /could not be saved/);
    h.editor.dispose();
  }
});

test('switching accounts during load or save suppresses late data and status changes', async () => {
  const gate = deferred(); const h = harness({ write: () => gate.promise }); await h.editor.load();
  const pending = h.editor.set('all', false); await turn(); const count = h.states.length;
  h.invalidate(); gate.resolve({ all: false }); assert.equal(await pending, false); assert.equal(h.states.length, count);
  h.editor.dispose();
  const read = deferred(), other = harness({ read: () => read.promise }); const loading = other.editor.load(); await turn();
  const before = other.states.length; other.invalidate(); read.resolve({ notif_prefs: { messages: false } }); await loading;
  assert.equal(other.states.length, before); other.editor.dispose();
});

test('timeout aborts transport, unlocks controls and keeps established preferences', async () => {
  const h = harness({ write: () => new Promise(() => {}), timeoutMs: 10 }); await h.editor.load();
  assert.equal(await h.editor.set('all', false), false);
  assert.equal(h.writes[0].signal.aborted, true);
  assert.equal(h.editor.getState().pending, null);
  assert.equal(pushEnabled(h.editor.getState().profile), true);
  h.editor.dispose();
});

test('disposal before the scheduled request prevents transport and later callbacks entirely', async () => {
  const h = harness(); await h.editor.load();
  const pending = h.editor.set('all', false), count = h.states.length;
  h.editor.dispose(); await pending;
  assert.equal(h.writes.length, 0); assert.equal(h.states.length, count);
});
