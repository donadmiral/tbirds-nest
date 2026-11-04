const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sessionId = id(900), ownerId = id(901);
const message = n => ({ id: id(n), session_id: sessionId, user_id: ownerId, body: 'Message ' + n,
  created_at: new Date(1700000000000 + n * 1000).toISOString(), author: { id: ownerId, full_name: 'Member' } });
const page = start => Array.from({ length: 50 }, (_, i) => message(start + i));
function hooks() {
  let cursor = 0, pending = [], layouts = [], slots = [];
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const jsx = (type, props) => ({ type, props: props || {} });
  const react = {
    Fragment: 'Fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) { slots[i] = { deps }; pending.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    useLayoutEffect(fn, deps) { const i = cursor++; if (!same(slots[i], deps)) { slots[i] = deps; layouts.push(fn); } },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot(); },
  };
  return { react, runtime: { jsx, jsxs: jsx, Fragment: 'Fragment' },
    render(component, props) { cursor = 0; return component(props); },
    async settle() { const work = [...layouts, ...pending]; layouts = []; pending = []; work.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); },
  };
}
function load(file, imports, context = {}) {
  const module = { exports: {} };
  const built = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, reportDiagnostics: true });
  assert.equal((built.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  vm.runInNewContext(built.outputText, { module, exports: module.exports, console, URL, Response, Date, Promise, Error,
    setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto, ...context,
    require(name) { assert.ok(name in imports, 'Unexpected import ' + name); return imports[name]; } });
  return module.exports;
}
function nodes(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.props?.children)]; }
const find = (tree, key, value) => nodes(tree).find(node => node.props?.[key] === value);
function harness({ initialPin = null, actualParent = false } = {}) {
  const h = hooks(), parentHooks = hooks(), channels = [], reads = [], commands = [], details = [], listeners = new Map();
  let detailBusy = false, canonicalDetail;
  const document = { visibilityState: 'visible', addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } };
  const client = {
    rpc(name, args) {
      if (name === 'live_session') {
        assert.equal(args.p_session_id, sessionId);
        return new Promise(resolve => details.push({ resolve(pinned, patch = {}) { resolve({ data: { ...canonicalDetail, pinned_message: pinned, ...patch }, error: null }); } }));
      }
      if (name === 'live_messages') {
        assert.equal(args.p_session_id, sessionId); assert.equal(args.p_limit, 50); assert.equal(args.p_before, null);
        return new Promise(resolve => reads.push({ resolve(items) { assert.ok(items.length <= 50); resolve({ data: { items, next_cursor: null }, error: null }); } }));
      }
      assert.equal(name, 'live_command'); assert.equal(args.p_session_id, sessionId);
      assert.ok((actualParent ? ['chat', 'pin', 'remove_message'] : ['chat']).includes(args.p_action));
      return new Promise(resolve => commands.push({ args, resolve(result) { resolve({ data: result, error: null }); }, reject(error) { resolve({ data: null, error }); } }));
    },
    channel(topic) { const channel = { topic, handlers: {}, on(_type, filter, callback) { channel.handlers[filter.event] = callback; return channel; }, subscribe(callback) { channel.status = callback; return channel; } }; channels.push(channel); return channel; },
    async removeChannel() {},
  };
  const directory = load('shared/liveDirectory.ts', {});
  const api = load('web/lib/liveApi.ts', { './supabase/client': {}, './withTimeout': { withTimeout: work => Promise.resolve(work) }, '../../shared/liveDirectory': directory });
  const component = load('web/components/LiveChat.tsx', { react: h.react, 'react/jsx-runtime': h.runtime,
    'lucide-react': { Heart: 'Heart', Flag: 'Flag', Pin: 'Pin', Send: 'Send', Trash2: 'Trash2' }, '@/lib/liveApi': api }, { document }).LiveChat;
  canonicalDetail = api.parseLiveDetail({ session: { id: sessionId, state: 'live', title: 'Conversation', host: { id: ownerId }, chat_mode: 'open', audience: 'public' },
    role: 'moderator', capabilities: { chat: true }, chat_topic: `live:${sessionId}:${id(902)}`, pinned_message: initialPin });
  let props = { client, ownerId, detail: canonicalDetail,
    async onRefresh() { if (detailBusy) return; detailBusy = true; try { props.detail = await api.getLiveDetail(client, sessionId); } finally { detailBusy = false; } },
    onPatch() {}, onInteraction() {}, onInteractionCounts() {} };
  const render = () => h.render(component, props);
  const identity = { owner: ownerId, scope: ownerId }, playback = { session: null, close() {} };
  const navigation = { subscribe: () => () => {}, getSnapshot: () => identity, getServerSnapshot: () => identity };
  const parent = actualParent ? load('web/components/LiveSessionView.tsx', {
    react: parentHooks.react, 'react/jsx-runtime': parentHooks.runtime, 'next/link': 'Link',
    'lucide-react': Object.fromEntries(['ArrowLeft', 'Bell', 'CalendarDays', 'Clapperboard', 'Radio', 'RefreshCw', 'Share2', 'Users'].map(name => [name, name])),
    '@/lib/supabase/client': { createClient: () => client }, '@/lib/navigationCache': { getNavigationStore: () => navigation }, '@/lib/liveApi': api,
    '../../shared/liveDirectory': directory, './LiveIcon': { LiveIcon: 'LiveIcon' }, './LivePlaybackProvider': { LivePlayerSlot: 'LivePlayerSlot', useLivePlayback: () => playback },
    './LiveGuestRequests': { LiveGuestRequests: 'LiveGuestRequests' },
    './LiveChat': { LiveChat: 'ActualChatSlot' }, './LiveStudio': { LiveStudio: 'LiveStudio' }, './LiveInteractions': { LiveInteractions: 'LiveInteractions', LiveAnalyticsPanel: 'LiveAnalyticsPanel' },
    '@/lib/liveInteractions': { parseLiveInteractions: () => null },
  }, { window: { location: { search: '' } }, URLSearchParams }).LiveSessionView : null;
  const renderParent = () => {
    const tree = parentHooks.render(parent, { id: sessionId });
    const chat = nodes(tree).find(node => node.type === 'ActualChatSlot');
    if (chat) props = chat.props;
    return tree;
  };
  const currentChat = () => channels.filter(c => c.topic === props.detail.chat_topic).at(-1);
  return { render, reads, commands, channels, details, settle: h.settle,
    async start() {
      if (actualParent) { renderParent(); await parentHooks.settle(); details[0].resolve(initialPin); await parentHooks.settle(); renderParent(); await parentHooks.settle(); }
      render(); await h.settle(); currentChat().status('SUBSCRIBED');
    },
    async history(index, items) { reads[index].resolve(items); await h.settle(); render(); await h.settle(); },
    async detail(index, pinned, patch = {}) {
      details[index].resolve(pinned, patch);
      if (actualParent) { await parentHooks.settle(); renderParent(); await parentHooks.settle(); }
      await h.settle(); render(); await h.settle();
    },
    async commitParent() { assert.ok(actualParent); renderParent(); await parentHooks.settle(); render(); await h.settle(); },
    emit(event, payload) { currentChat().handlers[event]({ payload }); },
    status(value) { currentChat().status(value); },
    gap() { document.visibilityState = 'hidden'; listeners.get('visibilitychange')(); document.visibilityState = 'visible'; listeners.get('visibilitychange')(); currentChat().status('SUBSCRIBED'); },
    bodies() { return nodes(render()).filter(n => n.type === 'p' && n.props.className === 'text-ink').map(n => n.props.children); },
    count() { return nodes(render()).filter(n => n.type === 'time').length; },
    pinnedBody() { return find(render(), 'className', 'break-words')?.props.children.at(-1) ?? null; },
    parentPin() { return props.detail.pinned_message; },
    parentPatch(value) { props.onPatch(value); },
    draft(value) { find(render(), 'aria-label', 'Message the live chat').props.onChange({ target: { value } }); },
    send() { return nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); },
  };
}

test('web rejoin removes unverified old history and preserves fresh broadcasts and removals during the canonical read', async () => {
  const app = harness(); await app.start(); await app.history(0, page(1));
  for (let n = 51; n <= 150; n++) app.emit('message', message(n));
  assert.equal(app.count(), 150); assert.ok(app.bodies().includes('Message 75'));
  app.gap();
  // Removal75 happened while unsubscribed and is outside the latest canonical50.
  app.emit('message', message(151)); app.emit('message_removed', { id: id(125) });
  await app.history(1, page(101));
  assert.equal(app.bodies().includes('Message 75'), false);
  assert.ok(app.bodies().includes('Message 151'));
  assert.equal(app.bodies().includes('Message 125'), false);
  assert.equal(app.count(), 51);
  for (let n = 152; n <= 400; n++) app.emit('message', message(n));
  assert.equal(app.count(), 150, 'the existing history bound remains enforced');
});

for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) test('web ' + status + ' retires old history before the same channel resubscribes', async () => {
  const app = harness(); await app.start(); await app.history(0, page(1));
  for (let n = 51; n <= 150; n++) app.emit('message', message(n));
  const channelCount = app.channels.length;
  app.status(status); app.status('SUBSCRIBED'); await app.history(1, page(101));
  assert.equal(app.bodies().includes('Message 75'), false);
  assert.equal(app.count(), 50); assert.equal(app.channels.length, channelCount);
});

test('a repeated web subscription refreshes unverified history even without an intermediate error callback', async () => {
  const app = harness(); await app.start(); await app.history(0, page(1));
  for (let n = 51; n <= 150; n++) app.emit('message', message(n));
  app.status('SUBSCRIBED'); app.emit('message', message(151)); await app.history(1, page(101));
  assert.equal(app.bodies().includes('Message 75'), false); assert.ok(app.bodies().includes('Message 151')); assert.equal(app.count(), 51);
});

test('a retired web history response cannot repopulate a gap or finish its replacement loading state', async () => {
  const app = harness(); await app.start(); app.gap();
  await app.history(0, page(1));
  assert.equal(app.count(), 0);
  assert.ok(nodes(app.render()).some(n => n.type === 'p' && n.props.children === 'Loading chat…'));
  app.emit('message', message(151)); await app.history(1, page(101));
  assert.equal(app.count(), 51); assert.ok(app.bodies().includes('Message 151')); assert.equal(app.bodies().includes('Message 1'), false);
});

for (const event of ['pin', 'unpin', 'remove']) test('canonical web detail cannot overwrite a newer realtime ' + event + ' across auto or visibility reconnect', async () => {
  for (const gap of ['auto', 'visibility']) for (const commitParent of [false, true]) {
    const app = harness({ actualParent: true, initialPin: message(75) }); await app.start(); await app.history(0, page(101));
    if (gap === 'auto') { app.status('CHANNEL_ERROR'); app.status('SUBSCRIBED'); } else app.gap();
    assert.equal(app.details.length, 2, 'The existing parent single-flight guard admits one reconnect read');
    if (event === 'remove') app.emit('message_removed', { id: id(75) });
    else app.emit('pin', { message: event === 'pin' ? message(2) : null });
    const expected = event === 'pin' ? 'Message 2' : null;
    assert.equal(app.pinnedBody(), expected);
    if (commitParent) await app.commitParent();
    await app.history(1, page(101));
    await app.detail(1, message(75), { capabilities: { chat: false } });
    assert.equal(app.pinnedBody(), expected, gap + ': a newer ' + event + ' wins regardless of parent render order');
    assert.equal(app.parentPin()?.id ?? null, event === 'pin' ? id(2) : null, 'The parent also retains the later pin state');
    assert.equal(find(app.render(), 'aria-label', 'Message the live chat').props.disabled, true, 'Other canonical fields still apply');
    assert.equal(app.details.length, gap === 'visibility' ? 3 : 2);
    // Visibility and resubscribe overlap. The merged parent coalesces them into
    // one final read, which starts after the pin event and confirms its state.
    if (gap === 'visibility') {
      await app.detail(2, event === 'pin' ? message(2) : null, { capabilities: { chat: false } });
      assert.equal(app.pinnedBody(), expected);
      assert.equal(app.details.length, 3);
    }
  }
});

test('canonical web detail cannot overwrite a confirmed local pin or removal while reconnecting', async () => {
  for (const action of ['pin', 'remove_message']) {
    const app = harness({ actualParent: true, initialPin: message(101) }); await app.start(); await app.history(0, page(101));
    app.status('CHANNEL_ERROR'); app.status('SUBSCRIBED'); await app.history(1, page(101));
    const controls = nodes(app.render()).filter(n => n.props?.['aria-label'] === (action === 'pin' ? 'Pin message' : 'Remove message'));
    controls[action === 'pin' ? 1 : 0].props.onClick();
    assert.equal(app.commands.length, 1); assert.equal(app.commands[0].args.p_action, action);
    app.commands[0].resolve({ ok: true }); await app.settle();
    await app.detail(1, message(101));
    const expectedId = action === 'pin' ? id(102) : null;
    assert.equal(app.parentPin()?.id ?? null, expectedId);
    assert.equal(app.pinnedBody(), action === 'pin' ? 'Message 102' : null);
  }
});

test('canonical web detail reconciles missed pins and later reads when no newer pin event arrived', async () => {
  for (const gap of ['auto', 'visibility']) for (const canonicalPin of [null, message(2)]) {
    const app = harness({ actualParent: true, initialPin: message(75) }); await app.start(); await app.history(0, page(101));
    if (gap === 'auto') { app.status('CHANNEL_ERROR'); app.status('SUBSCRIBED'); } else app.gap();
    app.parentPatch({ session: { id: sessionId, state: 'reconnecting' } });
    await app.history(1, page(101)); await app.detail(1, canonicalPin);
    assert.equal(app.pinnedBody(), canonicalPin?.body ?? null, 'A non-pin patch must not suppress canonical reconciliation');
    if (gap === 'visibility') await app.detail(2, canonicalPin);
    app.emit('pin', { message: message(3) }); await app.commitParent();
    app.status('CHANNEL_ERROR'); app.status('SUBSCRIBED'); await app.history(2, page(101)); await app.detail(app.details.length - 1, null);
    assert.equal(app.pinnedBody(), null, 'A later read reconciles changes after the prior event');
  }
});

test('an unrelated removal cannot suppress a canonical web unpin or replacement', async () => {
  for (const gap of ['auto', 'visibility']) for (const canonicalPin of [null, message(2)]) {
    const app = harness({ actualParent: true, initialPin: message(75) }); await app.start(); await app.history(0, page(101));
    if (gap === 'auto') { app.status('CHANNEL_ERROR'); app.status('SUBSCRIBED'); } else app.gap();
    app.emit('message_removed', { id: id(130) });
    await app.history(1, page(101)); await app.detail(1, canonicalPin);
    assert.equal(app.parentPin()?.id ?? null, canonicalPin?.id ?? null);
    assert.equal(app.pinnedBody(), canonicalPin?.body ?? null);
    assert.equal(app.bodies().includes('Message 130'), false);
  }
});

test('a pending canonical web pin cannot resurrect its removed target when a different pin was displayed', async () => {
  const app = harness({ actualParent: true, initialPin: message(75) }); await app.start(); await app.history(0, page(101));
  app.status('CHANNEL_ERROR'); app.status('SUBSCRIBED'); app.emit('message_removed', { id: id(2) });
  await app.history(1, page(101)); await app.detail(1, message(2));
  assert.equal(app.parentPin(), null); assert.equal(app.pinnedBody(), null);
});

test('a web history gap does not retire a pending send or leave its busy state locked', async () => {
  const app = harness(); await app.start(); await app.history(0, page(1)); app.draft('Keep this send');
  const sending = app.send(); assert.equal(app.commands.length, 1); app.gap(); await app.history(1, page(101));
  app.commands[0].resolve({ ok: true, message: message(151) }); await sending;
  assert.equal(find(app.render(), 'aria-label', 'Message the live chat').props.value, '');
  assert.ok(app.bodies().includes('Message 151'));
  app.draft('Another message'); assert.equal(find(app.render(), 'aria-label', 'Send chat message').props.disabled, false);
});

test('a failed web send keeps its draft and request identity across a history gap', async () => {
  const app = harness(); await app.start(); await app.history(0, page(1)); app.draft('Retry this send');
  const first = app.send(); app.commands[0].reject(Error('Temporary service failure')); await first;
  app.gap(); await app.history(1, page(101));
  assert.equal(find(app.render(), 'aria-label', 'Message the live chat').props.value, 'Retry this send');
  const second = app.send(); assert.equal(app.commands[1].args.p_request_id, app.commands[0].args.p_request_id);
  assert.equal(app.commands[1].args.p_payload.body, 'Retry this send'); app.commands[1].resolve({ ok: true }); await second;
  assert.equal(find(app.render(), 'aria-label', 'Message the live chat').props.value, '');
});
