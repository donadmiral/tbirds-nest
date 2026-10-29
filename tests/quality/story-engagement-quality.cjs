const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const countdown = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'shared/storyCountdownReminder.ts'), 'utf8')), countdown);
const input = { userId: 'viewer', storyId: 'story', stickerId: 'countdown', title: 'Opening', target: new Date(Date.now() + 600000).toISOString() };
function ports(overrides = {}) {
  const calls = [];
  return { calls, getPermissions: async () => ({ granted: true }), requestPermissions: async () => ({ granted: true }), scheduled: async () => [],
    schedule: async value => { calls.push(['schedule', value]); return value.identifier; }, cancel: async id => { calls.push(['cancel', id]); }, record: async () => { calls.push(['record']); return { id: 'response' }; }, ...overrides };
}
test('denying countdown notifications never records success or schedules a local reminder', async () => {
  const io = ports({ getPermissions: async () => ({ granted: false }), requestPermissions: async () => ({ granted: false }) });
  await assert.rejects(countdown.exports.setStoryCountdownReminder(input, io), /Allow notifications/);
  assert.equal(io.calls.length, 0);
});
test('expired or invalid countdowns do not ask for notification access', async () => {
  const io = ports({ getPermissions: () => { throw Error('should not ask'); } });
  for (const target of ['not-a-date', new Date(Date.now() - 100).toISOString()]) await assert.rejects(countdown.exports.setStoryCountdownReminder({ ...input, target }, io), /ended|valid end time/);
});
test('countdown scheduling must succeed before recording, and repeated taps reuse the same reminder', async () => {
  const io = ports();
  const id = await countdown.exports.setStoryCountdownReminder(input, io);
  assert.deepEqual(io.calls.map(x => x[0]), ['schedule', 'record']);
  assert.equal(id, 'story-countdown:viewer:story:countdown');
  io.scheduled = async () => [{ identifier: id }];
  await countdown.exports.setStoryCountdownReminder(input, io);
  assert.equal(io.calls.filter(x => x[0] === 'schedule').length, 1);
  const failed = ports({ schedule: async () => { throw Error('device rejected'); } });
  await assert.rejects(countdown.exports.setStoryCountdownReminder(input, failed), /device rejected/); assert.equal(failed.calls.length, 0);
});
test('a failed countdown response rolls back only the newly scheduled reminder', async () => {
  const io = ports({ record: async () => { throw Error('response rejected'); } });
  await assert.rejects(countdown.exports.setStoryCountdownReminder(input, io), /response rejected/);
  assert.deepEqual(io.calls.map(x => x[0]), ['schedule', 'cancel']);
  assert.equal(io.calls[0][1].identifier, io.calls[1][1]);
  const existing = ports({ scheduled: async () => [{ identifier: countdown.exports.countdownReminderId(input.userId, input.storyId, input.stickerId) }], record: io.record });
  await assert.rejects(countdown.exports.setStoryCountdownReminder(input, existing), /response rejected/); assert.equal(existing.calls.length, 0);
  const empty = ports({ record: async () => null });
  await assert.rejects(countdown.exports.setStoryCountdownReminder(input, empty), /could not be confirmed/); assert.deepEqual(empty.calls.map(x => x[0]), ['schedule', 'cancel']);
});

const viewer = fs.readFileSync(path.join(root, 'src/screens/stories/StoryViewerScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('viewer.tsx', viewer, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, context) {
  let source; function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) source = node.initializer.arguments[0].getText(ast); ts.forEachChild(node, visit); } visit(ast);
  assert.ok(source, name); const exports = {}; vm.runInNewContext(compile('export const run = ' + source), { exports, ...context }); return exports.run;
}
function answerScenario(work) {
  const sheet = { stickerId: 'question', prompt: 'What happened?' }, edits = [], responses = [], alerts = [];
  const context = { answerText: 'Keep my answer', questionAnswer: sheet, currentStory: { id: 'story' }, myId: 'viewer', responseBusy: { current: new Set() }, viewerRef: { current: 'viewer' }, storiesRef: { current: [{ id: 'story' }] }, storyIndexRef: { current: 0 }, answerSheet: { current: sheet },
    storiesService: { submitStickerResponse: work }, dispatchEngagement: value => responses.push(value), setQuestionAnswer: value => edits.push(['sheet', value]), setAnswerText: value => edits.push(['text', value]), setAnswerSending: value => edits.push(['sending', value]), resumeFrom() {},
    Haptics: { notificationAsync: async () => {}, NotificationFeedbackType: { Success: 'success' } }, Alert: { alert: (...args) => alerts.push(args) } };
  return { context, edits, responses, alerts, send: callback('sendQuestionAnswer', context) };
}
test('failed native question sends keep the sheet and answer and release the send lock', async () => {
  const h = answerScenario(async () => { throw Error('Offline'); }); await h.send();
  assert.equal(h.responses.length, 0); assert.equal(h.edits.some(x => x[0] === 'text' || x[0] === 'sheet'), false);
  assert.deepEqual(h.edits.at(-1), ['sending', false]); assert.equal(h.context.responseBusy.current.size, 0); assert.equal(h.alerts[0][1], 'Offline');
});
test('native question double taps submit once and stale completions cannot change another account', async () => {
  let resolve, calls = 0;
  const h = answerScenario(() => { calls++; return new Promise(done => { resolve = done; }); });
  const first = h.send(); await h.send(); assert.equal(calls, 1);
  h.context.viewerRef.current = 'another-viewer'; resolve({ text_value: 'Keep my answer' }); await first;
  assert.equal(h.responses.length, 0); assert.equal(h.edits.some(x => x[0] === 'text' || x[0] === 'sheet'), false);
});
test('native Add yours cancellation never records a joined response or discards the current story', async () => {
  const calls = []; const run = callback('handleAddYours', { currentStory: { id: 'source' }, ImagePicker: { launchImageLibraryAsync: async () => ({ canceled: true }) }, saveAndGoBack: () => calls.push('back'), navigation: { navigate: () => calls.push('navigate') }, storiesService: { submitStickerResponse: () => calls.push('joined') } });
  await run({ id: 'prompt', text: 'Your view' }); assert.deepEqual(calls, []);
});

function settings(work) {
  const calls = [], updates = [], alerts = [], state = [];
  const context = { currentStory: { id: 'story', user_id: 'owner' }, myId: 'owner', settingsBusy: { current: new Set() }, viewerRef: { current: 'owner' }, storiesRef: { current: [{ id: 'story' }] }, storyIndexRef: { current: 0 },
    setSettingsSaving: value => state.push(value), setStories: value => updates.push(value), Alert: { alert: (...args) => alerts.push(args) },
    supabase: { from(table) { const query = { update(patch) { calls.push([table, patch]); return query; }, eq(key, value) { calls.push([key, value]); return query; }, select() { return query; }, maybeSingle: work }; return query; } },
  };
  return { context, calls, updates, alerts, state, run: callback('changeStorySettings', context) };
}
test('story privacy switches keep their confirmed value when a write is rejected or changes zero rows', async () => {
  for (const result of [{ data: null, error: { message: 'Denied' } }, { data: null, error: null }]) {
    const h = settings(async () => result); await h.run({ allow_replies: false }); assert.equal(h.updates.length, 0); assert.equal(h.alerts[0][0], 'Setting not saved'); assert.equal(h.state.at(-1), null);
    assert.ok(h.calls.some(c => c[0] === 'user_id' && c[1] === 'owner'));
  }
});
test('story privacy writes deduplicate taps and a late response never changes the next account', async () => {
  let resolve;
  const h = settings(() => new Promise(done => { resolve = done; })); const first = h.run({ allow_replies: false }); await h.run({ allow_replies: true });
  assert.equal(h.calls.filter(c => c[0] === 'stories').length, 1); h.context.viewerRef.current = 'next'; resolve({ data: { id: 'story' }, error: null }); await first;
  assert.equal(h.updates.length, 0); assert.equal(h.context.settingsBusy.current.size, 0);
});
