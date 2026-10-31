const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function load(file, mocks, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console: { log() {} }, setTimeout, clearTimeout, ...globals,
    require: name => { if (!(name in mocks)) throw Error('Unmocked ' + name); return mocks[name]; },
  });
  return module.exports;
}
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function provider(options = {}) {
  let context, stateIndex = 0, timerId = 0;
  const states = [], effects = [], timers = new Map(), callbacks = new Map(), calls = [], queued = [], alerts = [], heartbeats = [];
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    createElement: (_type, props) => { context = props.value; return null; },
    useState: value => { const index = stateIndex++; states[index] = value; return [value, next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useRef: current => ({ current }), useCallback: fn => fn, useEffect: fn => effects.push(fn),
  };
  const call = {
    on: (name, handler) => callbacks.set(name, handler), participants: () => ({ local: {}, other: {} }),
    join: async () => { callbacks.get('joined-meeting')?.(); },
    leave: async () => calls.push(['leave']), destroy: () => calls.push(['destroy']),
    setLocalAudio: on => calls.push(['audio', on]), setLocalVideo: on => calls.push(['video', on]),
    setNativeInCallAudioMode: mode => calls.push(['route', mode]), sendAppMessage() {}, setBandwidth() {},
  };
  const svc = {
    initiateCall: async () => ({ id: 'outgoing' }), initiateGroupCall: async () => ({ id: 'group', provider_identity: 'membership' }),
    acceptCall: async () => true, joinGroupCall: async () => true, joinGroupCallMembership: async () => 'membership', getCall: async () => ({ status: 'active' }),
    getDailyToken: async () => ({ roomUrl: 'https://test.daily.co/test', token: 'test' }), markMissed: async () => true,
    ...options.service,
  };
  const chain = { on() { return this; }, subscribe() { return this; }, unsubscribe() {} };
  let heartbeat;
  const query = { select() { return this; }, eq(key, value) { if (heartbeat) heartbeat.filters[key] = value; return this; },
    update(payload) { heartbeat = { payload, filters: {} }; heartbeats.push(heartbeat); return this; },
    then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
    maybeSingle: async () => ({ data: { provider_identity: 'membership' } }) };
  const { CallProvider } = load('src/contexts/CallContext.tsx', {
    react, 'react-native': { Platform: { OS: options.platform ?? 'ios' }, Alert: { alert: (...args) => alerts.push(args) },
      PermissionsAndroid: { PERMISSIONS: { RECORD_AUDIO: 'mic', CAMERA: 'cam' }, RESULTS: { GRANTED: 'granted' }, request: async () => options.cameraDenied ? 'denied' : 'granted', requestMultiple: async () => ({ mic: options.denied ? 'denied' : 'granted', cam: 'granted' }) },
      AppState: { addEventListener: () => ({ remove() {} }) },
    },
    'expo-camera': { Camera: { requestMicrophonePermissionsAsync: async () => ({ granted: !options.denied }), requestCameraPermissionsAsync: async () => ({ granted: !options.cameraDenied, status: options.cameraDenied ? 'denied' : 'granted' }) } },
    '@daily-co/react-native-daily-js': { createCallObject: () => { calls.push(['create']); return call; } },
    '../services/callService': { callService: svc },
    '../services/audioService': { audioService: { stopAll: async () => {}, resetSession: async () => {}, stopAndSwitchToVoiceChat: async () => {}, playRingback: async () => {} } },
    '../services/nativeCallService': { nativeCallService: { endNativeCall() {}, endAllNativeCalls() {}, reportConnected() {}, startOutgoingCall() {} } },
    '../services/supabase': { supabase: { channel: () => chain, removeChannel() {}, from: () => query,
      auth: { getSession: async () => ({ data: { session: { user: { id: 'actor' } } } }) } } },
    '../stores/authStore': { useAuthStore: () => ({ profile: { id: 'actor' } }) },
    '../services/nativeCallRecovery': { settleCallOperation: async promise => promise, queueNativeCallClose: async (...args) => queued.push(args), flushNativeCallCloses: async () => {} },
  }, {
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms, interval: true }); return id; }, clearInterval: id => timers.delete(id),
  });
  CallProvider({ children: null }); effects.forEach(fn => fn());
  const params = { callId: 'incoming', channelId: 'channel', otherUserId: 'other', otherUserName: 'Other', otherUserAvatar: null, isVideo: true, isIncoming: true, isGroupCall: false, conversationId: 'conversation' };
  return { context, states, callbacks, timers, calls, queued, alerts, params, call, heartbeats,
    unlock() { for (const [id, timer] of timers) if (timer.ms === 300 && !timer.interval) { timers.delete(id); timer.fn(); } },
    async start(override) { context.startCall({ ...params, ...override }); await tick(); },
  };
}

test('native permissions are confirmed before creating or accepting a call on Android and iOS', async () => {
  for (const platform of ['android', 'ios']) {
    let accepted = 0;
    const h = provider({ platform, denied: true, service: { acceptCall: async () => { accepted++; return true; } } });
    await h.start();
    assert.equal(accepted, 0); assert.equal(h.calls.filter(row => row[0] === 'create').length, 0);
    assert.match(h.alerts[0][1], /microphone/); assert.equal(h.states[0], 'idle');
  }
});

test('a cancelled outgoing request closes its late-created session without reviving media', async () => {
  let complete;
  const h = provider({ service: { initiateCall: () => new Promise(resolve => { complete = resolve; }) } });
  h.context.startCall({ ...h.params, isIncoming: false, callId: null }); await tick();
  h.context.endCall(); await tick(); complete({ id: 'late-session' }); await tick();
  assert.equal(h.states[0], 'idle'); assert.equal(h.calls.length, 0);
  assert.equal(h.queued.at(-1)[1].callId, 'late-session');
});

test('poor quality alone does not start a disconnect timeout; actual Daily events reconnect', async () => {
  const h = provider(); await h.start(); assert.equal(h.states[0], 'active');
  h.callbacks.get('network-quality-change')({ quality: 40, threshold: 'low' });
  assert.equal(h.states[0], 'degraded');
  assert.equal([...h.timers.values()].filter(timer => !timer.interval && timer.ms >= 15000).length, 0);
  h.callbacks.get('network-connection')({ type: 'signaling', event: 'interrupted' });
  assert.equal(h.states[0], 'reconnecting');
  h.callbacks.get('network-connection')({ type: 'signaling', event: 'connected' }); await tick();
  assert.equal(h.states[0], 'active');
  assert.equal([...h.timers.values()].filter(timer => !timer.interval && timer.ms === 30000).length, 0);
});

test('unhold and reconnect preserve the user mic, camera and speaker choices', async () => {
  const h = provider(); await h.start();
  h.context.toggleMute(); h.unlock(); h.context.toggleVideo(); h.unlock(); h.context.toggleSpeaker(); h.unlock();
  h.context.toggleHold(); h.unlock(); h.context.toggleHold(); h.unlock();
  assert.deepEqual(h.calls.filter(row => row[0] === 'audio').at(-1), ['audio', false]);
  assert.deepEqual(h.calls.filter(row => row[0] === 'video').at(-1), ['video', false]);
  h.callbacks.get('network-connection')({ type: 'sfu', event: 'interrupted' });
  h.callbacks.get('network-connection')({ type: 'sfu', event: 'connected' }); await tick();
  assert.deepEqual(h.calls.filter(row => row[0] === 'route').at(-1), ['route', 'voice']);
});

test('late navigation cleanup cannot reset a newer active call', async () => {
  const h = provider(); await h.start(); h.context.clearCallState(); assert.equal(h.states[0], 'active');
});

test('group heartbeat is bound to the exact admitted identity so an old device cannot renew a later rejoin', async () => {
  const h = provider(); await h.start({ isGroupCall: true });
  assert.ok(h.heartbeats.length > 0);
  for (const heartbeat of h.heartbeats) assert.deepEqual(heartbeat.filters,
    { call_session_id: 'incoming', user_id: 'actor', status: 'joined', provider_identity: 'membership' });
});

function recovery(options = {}, store = new Map()) {
  let actor = 'actor';
  const calls = [];
  const svc = {
    getCall: async id => options.getCall ? options.getCall(id) : ({ status: options.status ?? 'active' }),
    endCall: async (...args) => { calls.push(['end', ...args]); return !options.offline; },
    markMissed: async (...args) => { calls.push(['missed', ...args]); return !options.offline; },
    recordCallEvent: async id => calls.push(['event', id]),
    leaveGroupCallMembership: async (...args) => { calls.push(['guarded-leave', ...args]); if (options.offline) throw Error('offline'); },
    declineGroupCall: async (...args) => { calls.push(['decline', ...args]); if (options.offline) throw Error('offline'); },
  };
  const api = load('src/services/nativeCallRecovery.ts', {
    '@react-native-async-storage/async-storage': { getItem: async key => store.get(key) ?? null, setItem: async (key, value) => store.set(key, value) },
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: actor } } } }) } } },
    './callService': { callService: svc },
  });
  return { api, store, calls, options, switchActor: value => { actor = value; } };
}

test('failed native hangup survives process restart and retries the accepted-before-media race', async () => {
  const first = recovery({ offline: true });
  await first.api.queueNativeCallClose('actor', { callId: 'call', group: false, duration: 0 });
  await assert.rejects(first.api.flushNativeCallCloses('actor'));
  assert.match([...first.store.values()][0], /call/);
  const restored = recovery({}, first.store); await restored.api.flushNativeCallCloses('actor');
  assert.deepEqual(restored.calls[0], ['end', 'call', 0]);
  assert.equal([...restored.store.values()][0], '[]');
});

test('pending hangups cannot replay under a different signed-in account', async () => {
  const h = recovery(); await h.api.queueNativeCallClose('actor', { callId: 'call', group: false, duration: 5 });
  h.switchActor('other'); await h.api.flushNativeCallCloses('actor'); assert.equal(h.calls.length, 0);
  h.switchActor('actor'); await h.api.flushNativeCallCloses('actor'); assert.equal(h.calls[0][0], 'end');
});

test('group retry carries the exact original membership and unguarded failures are never queued', async () => {
  const h = recovery({ offline: true });
  await h.api.queueNativeCallClose('actor', { callId: 'group', group: true, providerIdentity: 'old-membership', duration: 0 });
  await assert.rejects(h.api.flushNativeCallCloses('actor'));
  assert.deepEqual(h.calls[0], ['guarded-leave', 'group', 'old-membership']);
  await assert.rejects(h.api.queueNativeCallClose('actor', { callId: 'other-group', group: true, duration: 0 }));
  assert.doesNotMatch([...h.store.values()][0], /other-group/);
});

function incoming(options = {}) {
  const effects = [], cleanups = [], nativeEnds = [], state = [], channelCallbacks = new Map(), routes = [], started = [], dismissed = [];
  let nativeCallbacks, onIncoming, foregroundAction, ended = 0, guard = null, actor = 'actor', revision = 1;
  const record = { id: 'incoming', caller_id: 'caller', receiver_id: 'actor', channel_id: 'channel', conversation_id: null,
    is_video: true, status: 'ringing', is_group_call: false, created_at: new Date().toISOString() };
  const react = { createElement() {}, useRef: current => ({ current }), useState: initial => [initial, value => state.push(value)],
    useCallback: fn => fn, useEffect: fn => effects.push(fn), useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  const query = { select() { return this; }, eq() { return this; }, gt() { return this; }, order() { return this; }, limit() { return this; },
    setHeader() { return this; }, abortSignal() { return this; }, then(fn) { return Promise.resolve(fn({ data: [] })); },
    single: async () => ({ data: { id: 'caller', full_name: 'Caller' } }), maybeSingle: async () => ({ data: {} }), };
  const auth = Object.assign(() => ({ profile: { id: 'actor' } }), { getState: () => ({ session: { user: { id: actor }, access_token: actor + '-token' } }) });
  const component = load('src/components/IncomingCallListener.tsx', {
    react, '../theme/useTheme': { themedSheet: () => ({}) }, '@react-navigation/native': { useNavigation: () => ({ navigate: (...args) => routes.push(args) }) },
    '../lib/navigationCache': { navigationScope: () => revision + ':' + actor, navigationRevision: () => revision, subscribeNavigationScope: () => () => {} },
    '../services/incomingCallAccess': {
      async withIncomingCallSession(payload, action, _deadline, signal) {
        const original = actor, originalRevision = revision;
        const current = () => actor === original && revision === originalRevision && !signal?.aborted;
        const ensure = () => { if (!current()) throw Error('account changed'); };
        if (payload.recipientId && payload.recipientId !== actor) throw Error('wrong recipient');
        return action({ userId: actor, request: { accessToken: actor + '-token', signal }, current, ensure });
      },
      async readIncomingCall(payload, session) {
        if (options.holdRead) await options.holdRead(); session.ensure();
        if (record.status !== 'ringing') return null;
        const current = options.distinctCalls ? { ...record, id: payload.callId } : record;
        return { call: current, payload: { callId: current.id, callerName: 'Stored caller', isVideo: current.is_video, recipientId: actor } };
      },
      async declineIncomingCall() { if (options.failDecline) throw Error('offline'); return true; },
    },
    '../services/androidCallNotification': { consumeInitialCallNotification: () => options.initial ?? Promise.resolve(null),
      listenForegroundCallActions: callback => { foregroundAction = callback; return () => {}; }, dismissIncomingCall: async id => { dismissed.push(id); } },
    '../services/nativeCallService': { nativeCallService: { listen: cb => { nativeCallbacks = cb; return () => {}; }, listenForVoipPushes: () => () => {}, available: () => false,
      endNativeCall: id => nativeEnds.push(id), endAllNativeCalls: () => nativeEnds.push('*') } },
    '../stores/authStore': { useAuthStore: auth },
    '../contexts/CallContext': { useCallContext: () => ({ callState: options.active ? 'active' : 'idle', activeCall: options.active ? { callId: 'current' } : null,
      startCall: payload => started.push(payload), endCall: () => { ended++; } }) },
    '../services/callService': { callService: { getCall: async () => record, listRingingCalls: async () => options.recoverIncoming ? [record] : [], declineCall: async () => {},
      subscribeToIncomingCalls: (_id, cb) => { onIncoming = cb; return { unsubscribe() {} }; } } },
    '../services/supabase': { supabase: { from: () => query, removeChannel() {}, channel: () => ({ on(_type, filter, cb) { channelCallbacks.set(filter.table + ':' + (filter.filter ?? ''), cb); return this; }, subscribe() { return this; }, unsubscribe() {} }) } },
    'react-native': { Alert: { alert() {} }, AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' }, Vibration: { vibrate() {}, cancel() {} } },
    '@expo/vector-icons': {}, './SafeArea': { useSafeAreaInsets: () => ({ top: 0 }) },
    '../services/audioService': { audioService: { stopAll: async () => {} } },
    '../services/notificationBootstrap': { setActiveCallNavId: id => { guard = id; }, clearCallNavGuard: () => { guard = null; }, isCallNavActive: id => id ? guard === id : guard !== null },
  }, { AbortController, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} }).default;
  component(); effects.forEach(fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); });
  return { nativeCallbacks, nativeEnds, record, state, channelCallbacks, routes, started, dismissed,
    ended: () => ended, receive: () => onIncoming(record), foreground: (payload, action) => foregroundAction(payload, action),
    switchActor(next) { actor = next; revision++; }, cleanup: () => cleanups.forEach(fn => fn()) };
}

test('an old OS end callback cannot terminate the current native call', async () => {
  const h = incoming({ active: true });
  h.nativeCallbacks.onEnd('old-call'); await tick(); assert.equal(h.ended(), 0);
  h.nativeCallbacks.onEnd('current'); assert.equal(h.ended(), 1);
  h.cleanup(); h.nativeCallbacks.onEnd('current'); assert.equal(h.ended(), 1);
});

test('accepting an incoming call removes the banner without ending CallKit calls', async () => {
  const h = incoming(); h.receive(); await tick();
  const callback = h.channelCallbacks.get('call_sessions:id=eq.incoming'); assert.ok(callback);
  callback({ new: { status: 'active' } });
  assert.deepEqual(h.nativeEnds, []);
  h.cleanup();
});

test('bounded cleanup does not wait forever on a stuck native provider promise', async () => {
  const h = recovery();
  await assert.rejects(h.api.settleCallOperation(new Promise(() => {}), 5), /timed out/);
});

test('denied camera upgrade preserves audio call without enabling the camera', async () => {
  const h = provider({ platform: 'android', cameraDenied: true }); await h.start({ isVideo: false });
  await h.context.toggleVideo();
  assert.equal(h.states[0], 'active');
  assert.equal(h.calls.some(row => row[0] === 'video' && row[1]), false);
  assert.match(h.alerts[0][1], /camera access/);
});

test('incoming calls missed before subscription are reconciled on startup', async () => {
  const h = incoming({ recoverIncoming: true }); await tick();
  assert.equal(h.state.some(banner => banner?.callId === 'incoming'), true); h.cleanup();
});

test('account switching during a pending status lookup prevents the subsequent hangup write', async () => {
  let resolve;
  const h = recovery({ getCall: () => new Promise(done => { resolve = done; }) });
  await h.api.queueNativeCallClose('actor', { callId: 'call', group: false, duration: 1 });
  const pending = h.api.flushNativeCallCloses('actor'); await tick();
  h.switchActor('other'); resolve({ status: 'active' }); await pending;
  assert.equal(h.calls.length, 0);
});


test('old native callbacks cannot end or reopen a call after an A-to-B-to-A session change', async () => {
  const h = incoming({ active: true }); h.switchActor('other'); h.switchActor('actor');
  h.nativeCallbacks.onEnd('current'); await h.nativeCallbacks.onAnswer('incoming');
  assert.equal(h.ended(), 0); assert.equal(h.routes.length, 0); h.cleanup();
});

test('simultaneous native answers navigate once using stored caller metadata', async () => {
  const h = incoming(); await Promise.all([h.nativeCallbacks.onAnswer('incoming'), h.nativeCallbacks.onAnswer('incoming')]);
  assert.equal(h.routes.length, 1); assert.equal(h.started.length, 1);
  assert.equal(h.routes[0][1].callerName, 'Stored caller'); h.cleanup();
});

test('a late initial Notifee response cannot replace a newer live action', async () => {
  let resolve; const initial = new Promise(done => { resolve = done; });
  const h = incoming({ initial });
  h.foreground({ callId: 'incoming', callerName: 'Untrusted', recipientId: 'actor' }, 'decline'); await tick();
  resolve({ payload: { callId: 'incoming', callerName: 'Old', recipientId: 'actor' }, answer: true }); await tick();
  assert.equal(h.routes.length, 0); assert.equal(h.started.length, 0); assert.equal(h.dismissed.length, 1); h.cleanup();
});

test('failed foreground declines do not remove the retryable native notification', async () => {
  const h = incoming({ failDecline: true }); h.foreground({ callId: 'incoming', callerName: 'Call', recipientId: 'actor' }, 'decline');
  await tick(); assert.equal(h.dismissed.length, 0); h.cleanup();
});

test('pending incoming lookup is aborted on listener unmount and cannot revive a banner or route', async () => {
  let resolve; const gate = new Promise(done => { resolve = done; });
  const h = incoming({ holdRead: () => gate }); const answer = h.nativeCallbacks.onAnswer('incoming'); await tick();
  h.cleanup(); resolve(); await answer; await tick();
  assert.equal(h.routes.length, 0); assert.equal(h.state.some(value => value?.callId), false);
});


test('two different native answers cannot race into separate call screens before React updates', async () => {
  const h = incoming({ distinctCalls: true });
  await Promise.all([h.nativeCallbacks.onAnswer('incoming'), h.nativeCallbacks.onAnswer('second-incoming')]);
  assert.equal(h.routes.length, 1); assert.equal(h.started.length, 1); h.cleanup();
});

test('a native hangup cancels an answer lookup that has not completed', async () => {
  let resolve;
  const gate = new Promise(done => { resolve = done; });
  const h = incoming({ holdRead: () => gate });
  const answer = h.nativeCallbacks.onAnswer('incoming'); await tick();
  h.nativeCallbacks.onEnd('incoming'); await tick(); resolve(); await answer;
  assert.equal(h.routes.length, 0); assert.equal(h.started.length, 0); h.cleanup();
});

test('a native hangup after startCall but before the next React render ends that call', async () => {
  const h = incoming(); await h.nativeCallbacks.onAnswer('incoming');
  assert.equal(h.started.length, 1); h.nativeCallbacks.onEnd('incoming');
  assert.equal(h.ended(), 1); h.cleanup();
});
