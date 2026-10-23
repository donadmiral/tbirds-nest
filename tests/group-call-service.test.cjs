const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function harness(options = {}) {
  const rpcs = [], reads = [], pushes = [];
  const client = {
    rpc: async (name, args) => { rpcs.push({ name, args }); return { data: name === 'start_group_call_membership' ? { session_id: 'canonical-session', provider_identity: 'membership' } : null, error: options.errorRpc === name ? { message: 'denied' } : null }; },
    from(table) {
      assert.equal(table, 'call_sessions');
      const query = { table }; reads.push(query);
      return { select() { return this; }, eq(key, value) { query[key] = value; return this; },
        single: async () => ({ data: options.readError ? null : {
          id: 'canonical-session', initiator_id: 'server-user', is_group_call: true,
          agora_channel: null, status: 'ringing', conversation_id: 'group', is_video: true,
        }, error: options.readError ? { message: 'offline' } : null }),
      };
    },
    functions: { invoke: async (name, args) => { pushes.push({ name, args }); return {}; } },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/callService.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({ supabase: client }) });
  return { service: module.exports.callService, rpcs, reads, pushes };
}
test('native group start uses one server-authorized shared session, regardless of caller/channel input', async () => {
  const h = harness(); const call = await h.service.initiateGroupCall({ callerId: 'client-input', conversationId: 'group', channelId: 'legacy-channel', isVideo: true });
  assert.equal(h.rpcs.length, 1); assert.equal(h.rpcs[0].name, 'start_group_call_membership');
  assert.equal(JSON.stringify(h.rpcs[0].args), JSON.stringify({ p_conversation_id: 'group', p_is_video: true }));
  assert.equal(call.id, 'canonical-session'); assert.equal(call.channel_id, call.id); assert.equal(call.caller_id, 'server-user');
  assert.equal(h.reads[0].id, call.id); assert.equal(h.pushes[0].args.body.callId, call.id);
});
test('failed server admission creates no member rows or push', async () => {
  const h = harness({ errorRpc: 'start_group_call_membership' });
  assert.equal(await h.service.initiateGroupCall({ conversationId: 'group' }), null);
  assert.equal(h.reads.length, 0); assert.equal(h.pushes.length, 0);
});
test('failed session lookup leaves the created membership and does not notify receivers', async () => {
  const h = harness({ readError: true });
  assert.equal(await h.service.initiateGroupCall({ conversationId: 'group' }), null);
  assert.equal(h.rpcs[1].name, 'leave_group_call_membership'); assert.equal(h.rpcs[1].args.p_session_id, 'canonical-session'); assert.equal(h.rpcs[1].args.p_provider_identity, 'membership');
  assert.equal(h.pushes.length, 0);
});
test('join updates participant membership through the canonical RPC and reports denial', async () => {
  const h = harness(); assert.equal(await h.service.joinGroupCall('session', 'user'), true);
  assert.equal(h.rpcs[0].name, 'join_group_call'); assert.equal(h.rpcs[0].args.p_session_id, 'session');
  assert.equal(h.reads.length, 0);
  assert.equal(await harness({ errorRpc: 'join_group_call' }).service.joinGroupCall('session', 'user'), false);
});
test('leave and decline change only the authenticated participant via RPC', async () => {
  const h = harness(); await h.service.leaveGroupCall('session', 'user'); await h.service.declineGroupCall('session', 'user');
  assert.deepEqual(h.rpcs.map(call => call.name), ['leave_group_call', 'decline_group_call']);
  assert.ok(h.rpcs.every(call => Object.keys(call.args).join() === 'p_session_id')); assert.equal(h.reads.length, 0);
});
test('leave and decline do not conceal server errors', async () => {
  await assert.rejects(harness({ errorRpc: 'leave_group_call' }).service.leaveGroupCall('session', 'user'));
  await assert.rejects(harness({ errorRpc: 'decline_group_call' }).service.declineGroupCall('session', 'user'));
});
test('empty identity/session requests cannot mutate a call', async () => {
  const h = harness(); assert.equal(await h.service.joinGroupCall('', 'user'), false);
  await h.service.leaveGroupCall('session', ''); await h.service.declineGroupCall('', 'user');
  assert.equal(h.rpcs.length, 0);
});

test('the real call setup waits for membership and never requests media credentials after denial', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/contexts/CallContext.tsx'), 'utf8');
  const ast = ts.createSourceFile('CallContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let setup;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'doStartCall') setup = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(setup);
  const events = []; let admit;
  const admission = new Promise(resolve => { admit = resolve; });
  const module = { exports: {} };
  const code = ts.transpileModule('export const setup = ' + setup, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console: { log() {} },
    Platform: { OS: 'ios' }, Camera: { requestMicrophonePermissionsAsync: async () => ({ granted: true }) }, Alert: { alert() {} }, attemptRef: { current: 1 }, endCall() {}, myIdRef: { current: 'member' }, endingRef: { current: false },
    callIdRef: { current: null }, callObjRef: { current: null }, activeCallRef: { current: { isGroupCall: true } }, stateRef: { current: 'connecting' },
    callService: { joinGroupCallMembership: () => { events.push('join'); return admission; }, getDailyToken: () => { events.push('token'); } },
    setErrorMsg: message => events.push(message), transitionTo: state => events.push(state),
    audioService: { stopAll: async () => {} }, cleanupSubscription() {}, clearRingingTimeout() {}, clearReconnectTimeout() {}, clearDegradedTimeout() {}, resetState() {}, setCallState() {},
  });
  const pending = module.exports.setup({ callId: 'session', isGroupCall: true, isIncoming: true }, 1, 'member');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(events, ['join']); admit(false); await pending;
  assert.deepEqual(events, ['join', 'Could not join this group call.', 'failed']);
});
