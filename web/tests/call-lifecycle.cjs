const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const deferred = () => { let resolve, reject; return { promise: new Promise((r, j) => { resolve = r; reject = j; }), resolve, reject }; };
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function harness(options = {}) {
  const handlers = new Map(), slots = [], storage = new Map(), intervals = new Map(), permissionLocks = [], removedFrames = [];
  let frameHandlers = new Map();
  const document = { documentElement: { dataset: {} } };
  class CustomEvent { constructor(type,options={}) { this.type=type; this.detail=options.detail; } }
  let cursor = 0, dirty = true, effects = [], tree, authListener, starts = 0, ended = 0, frames = 0, destroyed = 0, stopped = 0, recovering = 0, timerId = 0;
  const wait = deferred(), roomWait = deferred(), mediaWait = options.mediaWait;
  const session = { id: id(10), initiator_id: id(1), receiver_id: id(2), is_group_call: false, status: 'ringing', created_at: new Date().toISOString(), is_video: false };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useRef: v => { const i = cursor++; return slots[i] ??= { current: v }; },
    useState: v => { const i = cursor++; if (!(i in slots)) slots[i] = typeof v === 'function' ? v() : v; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; dirty = true; }]; },
    useCallback: (f, d) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, d)) slots[i] = { fn: f, deps: d }; return slots[i].fn; },
    useEffect: (f, d) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, d)) { const previous = slots[i]; slots[i] = { deps: d }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = f(); }); } },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const browser = {
    dispatchEvent(event) { for (const cb of handlers.get(event.type) ?? []) cb(event); return true; },
    addEventListener: (name, cb) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(cb); },
    removeEventListener: (name, cb) => handlers.get(name)?.delete(cb),
    localStorage: { get length() { return storage.size; }, key: i => [...storage.keys()][i], getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: id(1) }, access_token: 'fixture-token' } } }), onAuthStateChange: cb => { authListener = cb; return { data: { subscription: { unsubscribe() {} } } }; } },
    channel: () => { const c = { on: () => c, subscribe: cb => { if (cb) queueMicrotask(() => cb('SUBSCRIBED')); return c; } }; return c; }, removeChannel() {},
    from(table) { const q = { select: () => q, eq: () => q, update: () => q, maybeSingle: async () => ({ data: table === 'profiles' ? { full_name: 'Caller' } : session }), then: ok => Promise.resolve({ data: session }).then(ok) }; return q; },
  };
  const calls = {
    startOneToOneCall: async () => { starts++; return wait.promise; }, getDailyRoom: () => roomWait.promise,
    endCall: async () => { ended++; if (options.closeWait) await options.closeWait.promise; if (options.closeFails) throw new Error('offline'); }, leaveGroupCall: async () => { ended++; },
    getPendingIncomingCalls: async () => { recovering++; return typeof options.incoming === 'function' ? options.incoming() : options.incoming ?? []; },
    isCallInvitationOpen: s => s.status === 'ringing' && Date.now() < Date.parse(s.created_at) + 90000,
    setCallStatus: async () => {}, declineGroupCall: async () => {},
  };
  function load(file, overrides = {}) {
    const module = { exports: {} };
    const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(output, { module, exports: module.exports, window: browser, document, CustomEvent, Date, Error, Set, Promise, setTimeout, clearTimeout,
      setInterval: (cb, ms) => { const n = ++timerId; intervals.set(n, {cb,ms}); return n; }, clearInterval: n => intervals.delete(n),
      navigator: { mediaDevices: { getUserMedia: () => { permissionLocks.push(callMedia.isCallMediaActive()); return options.mediaError ? Promise.reject(options.mediaError) : mediaWait ? mediaWait.promise : Promise.resolve({ getTracks: () => [{ stop: () => stopped++ }] }); } } }, process: { env: {} },
      require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx: (t, p) => ({ type: t, props: p }), jsxs: (t, p) => ({ type: t, props: p }) }
        : name === '@/lib/supabase/client' ? { createClient: () => client } : name === '@/lib/calls' ? calls : overrides[name] ?? (name === '@daily-co/daily-js' ? { __esModule: true, default: { createFrame() { const frameId=++frames, ownHandlers=new Map(), destroyWait=options.destroyWait; frameHandlers=ownHandlers; return { on: (name, cb) => ownHandlers.set(name, cb), join: async () => {}, iframe: () => ({remove(){if(!removedFrames.includes(frameId))removedFrames.push(frameId);}}), destroy: async () => { destroyed++; ownHandlers.get('left-meeting')?.(); if(destroyWait)await destroyWait.promise; } }; } } } : new Proxy({}, { get: (_, key) => String(key) })),
    });
    return module.exports;
  }
  const recovery = load('../lib/callRecovery.ts');
  const callMedia = load('../lib/callMedia.ts');
  const component = load('../components/WebCallLayer.tsx', { '@/lib/callRecovery': recovery, '@/lib/callMedia': callMedia });
  const walk = (n, fn) => { if (Array.isArray(n)) return n.forEach(v => walk(v, fn)); if (!n || typeof n !== 'object') return; fn(n); walk(n.props?.children, fn); };
  const render = () => { for (let n = 0; dirty && n < 20; n++) { dirty = false; cursor = 0; tree = component.WebCallLayer(); walk(tree, n => { if (n.props?.ref) n.props.ref.current = {}; }); const p = effects; effects = []; p.forEach(f => f()); } assert.equal(dirty, false); };
  const event = (name, detail) => { for (const cb of handlers.get(name) ?? []) cb({ detail }); render(); };
  const button = label => { let found; walk(tree, n => { if (n.props?.['aria-label'] === label || n.props?.title === label) found = n; }); return found; };
  render();
  return { wait, roomWait, session, options, permissionLocks, removedFrames, callMedia,
    get mediaLocked(){return callMedia.isCallMediaActive();}, get datasetLocked(){return document.documentElement.dataset.platinumCallActive;}, get starts() { return starts; }, get ended() { return ended; }, get frames() { return frames; }, get destroyed() { return destroyed; }, get stopped() { return stopped; }, get recovering() { return recovering; },
    get text() { return JSON.stringify(tree); }, get pending() { return recovery.pendingCallCloses(id(1)).length; },
    start() { event('pc-start-call', { receiverId: id(2), isVideo: false }); }, cancel() { button('End call').props.onClick(); render(); },
    answer(){button('Answer').props.onClick();render();}, decline(){button('Decline').props.onClick();render();}, tick(ms){for(const timer of intervals.values())if(timer.ms===ms)void timer.cb();render();},
    event, mediaEvent(name, detail) { frameHandlers.get(name)?.(detail); render(); }, hasButton: label => !!button(label),
    changeUser() { authListener('SIGNED_IN', { user: { id: id(3) }, access_token: 'other-fixture-token' }); render(); },
    async flush() { for (let i = 0; i < 5; i++) { await new Promise(r => setImmediate(r)); render(); } }, unmount() { slots.forEach(s => s?.cleanup?.()); },
  };
}

test('rapid repeated call clicks create one server session and cancel closes a late session', async () => {
  const h = harness(); await h.flush(); h.start(); h.start(); await h.flush(); assert.equal(h.starts, 1); h.wait.resolve(h.session); await h.flush(); h.cancel(); h.roomWait.resolve({ roomUrl: 'https://call', token: 'fixture' }); await h.flush(); assert.equal(h.frames, 0); assert.equal(h.ended, 1); h.unmount();
});
test('account switch fences a delayed room credential response and preserves old account close intent', async () => {
  const h = harness(); await h.flush(); h.start(); h.wait.resolve(h.session); await h.flush(); h.changeUser(); h.roomWait.resolve({ roomUrl: 'https://call', token: 'fixture' }); await h.flush(); assert.equal(h.frames, 0); assert.equal(h.pending, 1); assert.equal(h.ended, 0); h.unmount();
});
test('hanging up destroys a joined frame once even when destroy emits left-meeting', async () => {
  const h = harness(); await h.flush(); h.start(); h.wait.resolve(h.session); h.roomWait.resolve({ roomUrl: 'https://call', token: 'fixture' }); await h.flush(); assert.equal(h.frames, 1); h.cancel(); await h.flush(); assert.equal(h.destroyed, 1); assert.equal(h.ended, 1); h.unmount();
});
test('denied microphone permission does not ring or answer a server call', async () => {
  const error = new Error('blocked'); error.name = 'NotAllowedError'; const h = harness({ mediaError: error }); await h.flush(); h.start(); await h.flush(); assert.equal(h.starts, 0); assert.match(h.text, /Allow microphone/); h.unmount();
});
test('canceling an unanswered permission prompt stops late tracks without creating a call', async () => {
  const mediaWait = deferred(); const h = harness({ mediaWait }); await h.flush(); h.start(); h.cancel(); let stopped = 0; mediaWait.resolve({ getTracks: () => [{ stop: () => stopped++ }] }); await h.flush(); assert.equal(stopped, 1); assert.equal(h.starts, 0); h.unmount();
});
test('a recoverable Daily transport interruption shows reconnecting without tearing down the call', async () => {
  const h = harness(); await h.flush(); h.start(); h.wait.resolve(h.session); h.roomWait.resolve({ roomUrl: 'https://call', token: 'fixture' }); await h.flush();
  h.mediaEvent('network-connection', { type: 'sfu', event: 'interrupted' }); assert.match(h.text, /Reconnecting/); assert.equal(h.ended, 0);
  h.mediaEvent('network-connection', { type: 'signaling', event: 'interrupted' }); h.mediaEvent('network-connection', { type: 'sfu', event: 'connected' }); assert.match(h.text, /Reconnecting/);
  h.mediaEvent('network-connection', { type: 'signaling', event: 'connected' }); assert.doesNotMatch(h.text, /Reconnecting/); assert.equal(h.destroyed, 0); h.unmount();
});
test('failed hangup closes local media immediately and retries its server update on reconnect', async () => {
  const h = harness({ closeFails: true }); await h.flush(); h.start(); h.wait.resolve(h.session); h.roomWait.resolve({ roomUrl: 'https://call', token: 'fixture' }); await h.flush(); h.cancel(); await h.flush(); assert.equal(h.destroyed, 1); assert.equal(h.pending, 1); assert.match(h.text, /connection returns/);
  h.options.closeFails = false; h.event('online'); await h.flush(); assert.equal(h.pending, 0); assert.equal(h.ended, 2); assert.doesNotMatch(h.text, /connection returns/); h.unmount();
});
test('initial and reconnect recovery finds missed invitations without a realtime insert', async () => {
  let incoming = []; const h = harness({ incoming: () => incoming }); await h.flush(); assert.equal(h.hasButton('Answer'), false); incoming = [{ ...h.session, initiator_id: id(2), receiver_id: id(1) }]; h.event('focus'); await h.flush(); assert.equal(h.hasButton('Answer'), true); assert.match(h.text, /Caller/); h.unmount();
});
test('incoming recovery resolving after account switch cannot display the old account invitation', async () => {
  const pending = deferred(); const h = harness({ incoming: () => pending.promise }); await h.flush(); h.changeUser(); h.options.incoming = []; pending.resolve([{ ...h.session, receiver_id: id(1) }]); await h.flush(); assert.equal(h.hasButton('Answer'), false); h.unmount();
});

test('outgoing permission prompts lock other media before device access and cancellation unlocks it', async () => {
  const mediaWait=deferred(),h=harness({mediaWait});await h.flush();assert.equal(h.mediaLocked,false);h.start();
  assert.deepEqual(h.permissionLocks,[true]);assert.equal(h.datasetLocked,'true');h.cancel();await h.flush();assert.equal(h.mediaLocked,false);assert.equal(h.datasetLocked,undefined);
  mediaWait.resolve({getTracks:()=>[{stop(){}}]});await h.flush();assert.equal(h.starts,0);h.unmount();
});
test('denied outgoing permission releases its media owner without opening a call', async () => {
  const mediaError=Object.assign(new Error('denied'),{name:'NotAllowedError'}),h=harness({mediaError});await h.flush();h.start();await h.flush();
  assert.deepEqual(h.permissionLocks,[true]);assert.equal(h.mediaLocked,false);assert.equal(h.frames,0);h.unmount();
});
test('incoming invitations pause media until decline and cannot overlap an outgoing start', async () => {
  let incoming=[];const h=harness({incoming:()=>incoming});await h.flush();incoming=[{...h.session,initiator_id:id(2),receiver_id:id(1)}];h.event('focus');await h.flush();
  assert.equal(h.mediaLocked,true);assert.equal(h.datasetLocked,'true');h.start();await h.flush();assert.equal(h.starts,0);
  h.decline();await h.flush();assert.equal(h.mediaLocked,false);assert.equal(h.hasButton('Answer'),false);h.unmount();
});
test('a failed answer permission attempt retains the still-actionable invitation media owner', async () => {
  let incoming=[];const mediaError=Object.assign(new Error('denied'),{name:'NotAllowedError'}),h=harness({mediaError,incoming:()=>incoming});await h.flush();incoming=[{...h.session,initiator_id:id(2),receiver_id:id(1)}];h.event('focus');await h.flush();
  h.answer();await h.flush();assert.equal(h.mediaLocked,true);assert.equal(h.hasButton('Answer'),true);assert.equal(h.frames,0);h.decline();await h.flush();assert.equal(h.mediaLocked,false);h.unmount();
});
test('a call keeps media paused through iframe teardown and releases independently of network closure', async () => {
  const destroyWait=deferred(),closeWait=deferred(),h=harness({destroyWait,closeWait});await h.flush();h.start();h.wait.resolve(h.session);h.roomWait.resolve({roomUrl:'https://call',token:'fixture'});await h.flush();
  h.cancel();await h.flush();assert.equal(h.destroyed,1);assert.equal(h.mediaLocked,true);assert.equal(h.removedFrames.length,0);
  destroyWait.resolve();await h.flush();assert.equal(h.mediaLocked,false);assert.deepEqual(h.removedFrames,[1]);assert.equal(h.pending,1);closeWait.resolve();await h.flush();assert.equal(h.pending,0);h.unmount();
});
test('an old frame cleanup cannot release a new call owner or remove its iframe', async () => {
  const destroyWait=deferred(),h=harness({destroyWait});await h.flush();h.start();h.wait.resolve(h.session);h.roomWait.resolve({roomUrl:'https://call',token:'fixture'});await h.flush();h.cancel();await h.flush();
  h.options.destroyWait=null;h.start();await h.flush();assert.equal(h.frames,2);assert.equal(h.mediaLocked,true);
  destroyWait.resolve();await h.flush();assert.equal(h.mediaLocked,true);assert.deepEqual(h.removedFrames,[1]);
  h.cancel();await h.flush();assert.equal(h.mediaLocked,false);assert.deepEqual(h.removedFrames,[1,2]);h.unmount();
});
test('expired invitations cannot be accepted after a delayed permission prompt', async () => {
  let incoming=[];const mediaWait=deferred(),h=harness({mediaWait,incoming:()=>incoming});await h.flush();const invite={...h.session,initiator_id:id(2),receiver_id:id(1)};incoming=[invite];h.event('focus');await h.flush();h.answer();
  h.session.status='ended';h.tick(5000);await h.flush();assert.equal(h.hasButton('Answer'),false);assert.equal(h.mediaLocked,true);
  mediaWait.resolve({getTracks:()=>[{stop(){}}]});await h.flush();assert.equal(h.frames,0);assert.equal(h.mediaLocked,false);h.unmount();
});
test('media ownership releases are idempotent and preserve the newer owner', async () => {
  const h=harness();await h.flush();const old=h.callMedia.acquireCallMedia(),next=h.callMedia.acquireCallMedia();old();old();assert.equal(h.mediaLocked,true);assert.equal(h.datasetLocked,'true');next();assert.equal(h.mediaLocked,false);assert.equal(h.datasetLocked,undefined);h.unmount();
});
