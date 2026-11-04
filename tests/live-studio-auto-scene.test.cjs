const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const participant = (n, local = false) => ({ session_id: uuid(n + 100), user_id: uuid(n), user_name: `Person ${n}`, local,
  video: true, audio: false, tracks: { video: { state: 'playable' }, audio: { state: 'off' } } });
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const words = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(words).join('') : value?.props ? words(value.props.children) : '';
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ guests = [], trustedGuestIds = guests.map(p => p.user_id), state = 'live', autoDirect = true } = {}) {
  let cursor = 0, dirty = true, tree, timerId = 0, requestId = 0, mounted = true;
  const slots = [], effects = [], timers = new Map(), commands = [], handlers = new Map();
  let people = [participant(1, true), ...guests], activeControls = 0, maxActiveControls = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) {
      const current = { deps }; slots[i] = current; effects.push(() => { previous?.cleanup?.(); current.cleanup = fn(); });
    } },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const schedule = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; };
  const load = (file, imports = {}) => {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(code, { exports, setTimeout: schedule, clearTimeout: id => timers.delete(id), console,
      require(name) { if (!(name in imports)) throw Error(`Unexpected import: ${name}`); return imports[name]; } });
    return exports;
  };
  const instance = {
    on(name, fn) { handlers.set(name, fn); return instance; }, participants: () => Object.fromEntries(people.map(p => [p.session_id, p])),
    async join() { handlers.get('joined-meeting')?.(); }, async leave() {}, async destroy() {}, stopScreenShare() {},
    async setLocalVideo() {}, localAudio: () => false, localVideo: () => true,
  };
  const native = new Proxy({ StyleSheet: { create: s => s, absoluteFill: {} }, Platform: { OS: 'ios' }, Alert: { alert() {} } },
    { get: (value, key) => key in value ? value[key] : key });
  const LiveStudio = load('src/components/LiveStudio.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' }, '@expo/vector-icons': { Feather: 'Feather' },
    './SafeArea': { useSafeAreaInsets: () => ({ top: 50, bottom: 30, left: 0, right: 0 }) }, './LiveUi': { LiveIcon: 'LiveIcon' },
    '@daily-co/react-native-daily-js': { createCallObject: () => instance, supportedBrowser: () => ({ supportsScreenShare: true }) },
    '../theme/useTheme': { useTheme: () => ({ t: { ink: { primary: '#111', secondary: '#555', muted: '#777' }, surface: { raised: '#fff', sunken: '#eee' } } }) },
    '../services/devicePermissions': { ensureCameraPermission: async () => ({ granted: true }), ensureMicrophonePermission: async () => ({ granted: true }) },
    '../services/liveService': { liveStage: async () => ({ maxMembers: 12, canScreenShare: true, roomUrl: 'https://room.invalid', token: 'fixture' }),
      liveRequestId: () => uuid(++requestId + 1000), liveControl: (...args) => {
        activeControls++; maxActiveControls = Math.max(maxActiveControls, activeControls);
        return new Promise((resolve, reject) => commands.push({ args, resolve(value = {}) { activeControls--; resolve(value); }, reject(reason) { activeControls--; reject(reason); } }));
      } },
    './RemoteCallMedia': { RemoteCallMedia: 'RemoteCallMedia' }, '../contexts/CallContext': { useCallContext: () => ({ callState: 'idle' }) },
    '../contexts/LivePlaybackContext': { useLivePlayback: () => ({ close() {} }) }, '../stores/authStore': { useAuthStore: fn => fn({ profile: { id: uuid(900) } }) },
    '../services/liveMediaSession': { registerLiveStageRelease: () => () => {}, releaseLiveStageMedia: async () => {} },
    '../services/nativeCallRecovery': { settleCallOperation: value => Promise.resolve(value) }, '../hooks/useLiveStudioEvents': { useLiveStudioEvents() {} },
    '../../shared/liveStageScene': load('shared/liveStageScene.ts'), '../../shared/liveSetup': load('shared/liveSetup.ts'),
  }).LiveStudio;
  const props = { sessionId: uuid(700), canControl: true, streamState: state, onChanged() {}, autoPreview: true, immersive: true, autoDirect, automaticGuestIds: trustedGuestIds };
  const render = () => { if (!mounted) return; cursor = 0; dirty = false; tree = LiveStudio(props); while (effects.length) effects.shift()(); };
  const settle = async () => { for (let i = 0; i < 30; i++) { if (dirty && mounted) render(); await Promise.resolve(); } if (dirty && mounted) render(); };
  return {
    commands, settle, async start() { render(); await settle(); }, maxConcurrent: () => maxActiveControls,
    async emit(next, acceptedIds = next.filter(p => !p.local).map(p => p.user_id)) {
      people = next; props.automaticGuestIds = acceptedIds; handlers.get('participant-updated')?.(); await settle(); },
    async setState(value) { props.streamState = value; dirty = true; await settle(); },
    async click(label) { const node = nodes(tree).find(n => n.type === 'TouchableOpacity'
      && (n.props.accessibilityLabel === label || words(n) === label)); assert.ok(node, `Found ${label}`); assert.ok(!node.props.disabled, `${label} enabled`);
      node.props.onPress(); await settle(); },
    async tick() { const pending = [...timers].filter(([, t]) => t.delay === 750); for (const [id, timer] of pending) { timers.delete(id); timer.fn(); } await settle(); },
    scheduled: () => [...timers.values()].filter(t => t.delay === 750).length,
    async unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); await settle(); },
  };
}

test('native start command immediately broadcasts an already connected guest', async () => {
  const h = harness({ guests: [participant(2)], state: 'backstage' }); await h.start();
  assert.equal(h.commands.length, 0); await h.click('Go live');
  assert.equal(h.commands[0].args[1], 'start');
  assert.deepEqual(plain(h.commands[0].args[3]), { preset: 'interview', participant_id: uuid(2), automatic: true, orientation: 'portrait' });
  h.commands[0].resolve(); await h.settle(); await h.setState('live'); await h.tick();
  assert.equal(h.commands.length, 1, 'confirmed start is not resent as an identical scene');
});

test('guest joining while a scene is in flight is sent once after that command settles', async () => {
  const h = harness(); await h.start(); await h.tick(); assert.equal(h.commands.length, 1);
  await h.emit([participant(1, true), participant(2), participant(3)]); await h.tick();
  assert.equal(h.commands.length, 1);
  h.commands[0].resolve(); await h.settle(); await h.tick();
  assert.equal(h.commands.length, 2);
  assert.deepEqual(plain(h.commands[1].args[3]), { preset: 'grid', participant_ids: [uuid(1), uuid(2), uuid(3)], automatic: true, orientation: 'portrait' });
  assert.equal(h.maxConcurrent(), 1);
  h.commands[1].resolve(); await h.settle();
  await h.emit([participant(3), { ...participant(1, true), audio: true }, participant(2)]); await h.tick();
  assert.equal(h.commands.length, 2, 'track state and order changes do not resend the scene');
});

test('manual layout selection cancels a pending automatic scene and preserves the chosen source', async () => {
  const h = harness({ guests: [participant(2)] }); await h.start(); assert.equal(h.scheduled(), 1);
  await h.click('screen'); await h.tick(); assert.equal(h.commands.length, 0);
  await h.emit([participant(1, true), participant(2), participant(3)]); await h.tick(); assert.equal(h.commands.length, 0);
  await h.click('Apply layout'); assert.equal(h.commands[0].args[3].preset, 'screen');
  h.commands[0].resolve(); await h.settle();
});

test('choosing a featured camera suspends automatic mode before applying the source', async () => {
  const h = harness({ guests: [participant(2)] }); await h.start(); assert.equal(h.scheduled(), 1);
  await h.click('Person 2'); await h.tick(); assert.equal(h.commands.length, 0);
  await h.click('Apply layout');
  assert.deepEqual(plain(h.commands[0].args[3]), { preset: 'host', participant_id: uuid(2), orientation: 'portrait' });
  h.commands[0].resolve(); await h.settle();
});

test('room staff and unapproved participants stay out of automatic viewer scenes', async () => {
  const h = harness({ guests: [participant(2), participant(3), participant(4)], trustedGuestIds: [uuid(2)] });
  await h.start(); await h.tick();
  assert.deepEqual(plain(h.commands[0].args[3]), { preset: 'interview', participant_id: uuid(2), automatic: true, orientation: 'portrait' });
  h.commands[0].resolve(); await h.settle();
  await h.emit([participant(1, true), participant(3), participant(4)], []); await h.tick();
  assert.deepEqual(plain(h.commands[1].args[3]), { preset: 'host', participant_id: uuid(1), automatic: true, orientation: 'portrait' });
  h.commands[1].resolve(); await h.settle();
});

test('automatic retry is explicit and reuses the same idempotency key', async () => {
  const h = harness(); await h.start(); await h.tick(); const first = h.commands[0];
  first.reject(new Error('temporary provider issue')); await h.settle(); await h.tick();
  assert.equal(h.commands.length, 1);
  await h.click('Retry guest layout'); await h.tick(); assert.equal(h.commands.length, 2);
  assert.equal(h.commands[1].args[2], first.args[2]);
  h.commands[1].resolve(); await h.settle();
});

test('unmount removes pending scene work and a non-host never auto-directs the stage', async () => {
  const h = harness(); await h.start(); assert.equal(h.scheduled(), 1);
  await h.unmount(); await h.tick(); assert.equal(h.commands.length, 0);
  const producer = harness({ autoDirect: false, guests: [participant(2)] }); await producer.start(); await producer.tick();
  assert.equal(producer.commands.length, 0);
});
