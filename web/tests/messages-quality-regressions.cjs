const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const sources = {
  '@/lib/sessionHistory': compile(path.join(root, 'lib/sessionHistory.ts')),
  '../../shared/sessionHistory': compile(path.join(root, '../shared/sessionHistory.ts')),
  '../../shared/threadWindow': compile(path.join(root, '../shared/threadWindow.ts')),
  '../../shared/retainedMaps': compile(path.join(root, '../shared/retainedMaps.ts')),
  './messageHistory': compile(path.join(root, '../shared/messageHistory.ts')),
  '@/lib/messageNavigationMemory': compile(path.join(root, 'lib/messageNavigationMemory.ts')),
  '../../shared/navigationCache': compile(path.join(root, '../shared/navigationCache.ts')),
  '@/lib/profileLookup': compile(path.join(root, 'lib/profileLookup.ts')),
  '@/lib/withTimeout': compile(path.join(root, 'lib/withTimeout.ts')),
  '@/components/MessagesApp': compile(path.join(root, 'components/MessagesApp.tsx')),
  '@/components/ChatVideo': compile(path.join(root, 'components/ChatVideo.tsx')),
  '@/components/ForwardConversationPicker': compile(path.join(root, 'components/ForwardConversationPicker.tsx')),
  '@/components/MarketUnreadDot': compile(path.join(root, 'components/MarketUnreadDot.tsx')),
  '@/lib/messagesActual': compile(path.join(root, 'lib/messages.ts')),
  '../../shared/pagedReaders': compile(path.join(root, '../shared/pagedReaders.ts')),
  '../../shared/inboxWindow': compile(path.join(root, '../shared/inboxWindow.ts')),
  '../../shared/inboxRefreshQueue': compile(path.join(root, '../shared/inboxRefreshQueue.ts')),
  '../../shared/typingActivity': compile(path.join(root, '../shared/typingActivity.ts')),
  './recoveryReader': compile(path.join(root, '../shared/recoveryReader.ts')),
  '@/lib/messageOutbox': compile(path.join(root, 'lib/messageOutbox.ts')),
  '../../shared/messageDelivery': compile(path.join(root, '../shared/messageDelivery.ts')),
  '@/lib/messageActions': compile(path.join(root, 'lib/messageActions.ts')),
  '../../shared/messageContent': compile(path.join(root, '../shared/messageContent.ts')),
  '../../shared/chatAttachmentCards': compile(path.join(root, '../shared/chatAttachmentCards.ts')),
  '../../shared/messageHistory': compile(path.join(root, '../shared/messageHistory.ts')),
  '../../shared/messageReceipts': compile(path.join(root, '../shared/messageReceipts.ts')),
  '../../shared/storyMessageReference': compile(path.join(root, '../shared/storyMessageReference.ts')),
};
function moduleFor(code) { const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports, require: name => sources[name] ? moduleFor(sources[name]) : ({}) }); return module.exports; }
const history = moduleFor(sources['../../shared/messageHistory']);
const actions = moduleFor(sources['@/lib/messageActions']);
const safeChatMedia = moduleFor(compile(path.join(root, 'lib/chatMedia.ts')));
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const row = (n, props = {}) => ({ id: id(n), conversation_id: 'a', sender_id: 'me', receiver_id: 'other', text: 'Message ' + n, media_url: null, media_type: null, reply_to_id: null, created_at: '2026-10-20T10:00:00.123456+00:00', ...props });
const inboxRows = count => Array.from({ length: count }, (_, n) => ({ id: `chat${n}`, title: `Conversation chat${n}`, other_id: 'other',
  context: 'personal', is_group: false, unread: 0, last_message: `Preview ${n}`, last_message_time: new Date(Date.UTC(2026, 9, 30) - n * 60000).toISOString() }));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node?.type === 'RichText' ? node.props.text : text(node?.props?.children ?? '');
function nodes(tree) { const out = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; out.push(node); if (typeof node.type === 'function') walk(node.type(node.props)); else walk(node.props?.children); }; walk(tree); return out; }

function scenario(initial = [row(1)], options = {}) {
  let rows = [...initial], reactions = [], pins = {}, tree, dirty = true, effects = [], layoutEffects = [], cursor = 0;
  const slots = [], writes = [], reads = [], rpcs = [], listeners = [], timers = new Set(), browserEvents = new Map(), domEvents = new Map();
  const convs = options.conversations ?? ['a', 'b'].map(value => ({ id: value, title: 'Conversation ' + value, other_id: 'other', context: 'personal', is_group: !!options.group, unread: 0, last_message: '', last_message_time: null }));
  let inboxReadOverride;
  const intersections = new Set();
  let readOverride, writeOverride, rpcFailure = false;
  let authUser = 'me', authListener;
  const execute = async call => {
    const { table, op, filters, input, limit, filter } = call;
    if (op !== 'select') {
      writes.push(call); if (writeOverride) { const result = await writeOverride(call); if (result) return result; }
      if (table === 'messages') {
        if (op === 'insert') { const saved = row(100 + writes.length, { ...(Array.isArray(input) ? input[0] : input), created_at: '2026-10-20T11:00:00Z' }); rows.push(saved); return { data: saved, error: null }; }
        const found = rows.find(item => Object.entries(filters).every(([key, value]) => item[key] == value));
        if (found) Object.assign(found, input); return { data: found || null, error: found ? null : { message: 'denied' } };
      }
      if (table === 'message_reactions') {
        if (op === 'insert') reactions.push({ id: 'reaction', ...input });
        if (op === 'delete') reactions = reactions.filter(item => item.id !== filters.id);
        if (op === 'update') reactions.forEach(item => { if (item.id === filters.id) Object.assign(item, input); });
      }
      return { data: null, error: null };
    }
    reads.push(call); if (readOverride) { const result = await readOverride(call); if (result) return result; }
    if (table === 'conversations') return { data: { pinned_message_id: pins[filters.id] || null }, error: null };
    let data = table === 'messages' ? rows : table === 'message_reactions' ? reactions : [];
    data = data.filter(item => Object.entries(filters).every(([key, value]) => Array.isArray(value) ? value.includes(item[key]) : item[key] == value));
    if (filter) { const beforeId = filter.match(/id\.lt\.([^,)]+)/)?.[1]; data = data.filter(item => item.id < beforeId); }
    if (table === 'messages') data = history.mergeMessagePage([], data);
    if (limit) data = data.slice(0, limit);
    return { data: call.single ? data[0] || null : data, error: null };
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: authUser ? { user: { id: authUser }, access_token: 'synthetic-message-session' } : null }, error: null }), onAuthStateChange: callback => { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; } },
    from(table) { const call = { table, op: 'select', filters: {} }; const chain = {
      abortSignal() { return chain; }, setHeader(key,value) { call.headers = { ...call.headers, [key]: value }; return chain; }, select(value) { call.select = value; return chain; }, eq(k,v) { call.filters[k] = v; return chain; }, is(k,v) { call.filters[k] = v; return chain; }, in(k,v) { call.filters[k] = v; return chain; },
      order() { return chain; }, limit(value) { call.limit = value; return chain; }, or(value) { call.filter = value; return chain; }, maybeSingle() { call.single = true; return chain; }, single() { call.single = true; return chain; },
      insert(input) { call.op = 'insert'; call.input = input; return chain; }, update(input) { call.op = 'update'; call.input = input; return chain; }, upsert(input) { call.op = 'upsert'; call.input = input; return chain; }, delete() { call.op = 'delete'; return chain; },
      then(ok,bad) { return Promise.resolve().then(() => execute(call)).then(ok,bad); },
    }; return chain; },
    rpc: async (name, args) => {
      rpcs.push({ name, args }); if (rpcFailure) return { error: { message: 'denied' } };
      if (name === 'get_paged_reader_capabilities') return { data: { version: 1, inbox: !!options.paged, books: false }, error: null };
      if (name === 'get_inbox_unread_totals_v2') {
        if (inboxReadOverride) { const response = await inboxReadOverride({ totals: true, owner: authUser }); if (response) return response; }
        return { data: { version: 2, personal: 0, market: options.marketUnread ?? 87, jobs: 0 }, error: null };
      }
      if (name === 'get_inbox_page_v2') {
        if (inboxReadOverride) { const response = await inboxReadOverride(args); if (response) return response; }
        let all = convs.filter(row => row.context === args.p_context && !row.denied);
        if (args.p_ids) all = all.filter(row => args.p_ids.includes(row.id));
        else all = all.filter(row => !(args.p_exclude_community && row.is_group && row.group_type === 'community')
          && !(args.p_exclude_requests && row.request_pending)
          && (args.p_filter === 'groups' ? row.is_group : args.p_filter === 'unread' ? row.unread > 0 : true)
          && (!args.p_search?.trim() || (row.title + ' ' + (row.username ?? '')).toLowerCase().includes(args.p_search.trim().toLowerCase())));
        const offset = args.p_cursor?.offset ?? 0, items = all.slice(offset, offset + args.p_limit), more = offset + items.length < all.length;
        return { data: { version: 2, items, has_more: more, next_cursor: more ? { viewer: authUser, offset: offset + items.length } : null,
          summary: { total: convs.length, archived_personal: 0 }, badges_included: false }, error: null };
      }
      if (name === 'set_pinned_message') pins[args.p_conversation_id] = args.p_message_id;
      return { data: null, error: null };
    },
    channel() { const chain = { on(event, filter, callback) { listeners.push({ filter, callback }); return chain; }, subscribe() { return chain; } }; return chain; }, removeChannel() {},
    storage: { from() { return { upload: async () => options.uploadResponse ? options.uploadResponse() : ({ error: options.uploadFailure ? { message: 'offline' } : null }), getPublicUrl: () => ({ data: { publicUrl: 'https://media.test/file' } }) }; } },
  };
  const same = (a,b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
  const hooks = {
    memo: fn => fn,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value,slots[i])) { slots[i] = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn,deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps,deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
    useMemo(fn,deps) { return hooks.useCallback(fn,deps)(); },
    useEffect(fn,deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps,deps)) { const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    useLayoutEffect(fn,deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps,deps)) { const previous = slots[i]; slots[i] = { deps }; layoutEffects.push({cleanup:previous?.cleanup,create:() => { slots[i].cleanup = fn(); }}); } },
    useSyncExternalStore(subscribe, snapshot) { const [value, setValue] = hooks.useState(snapshot); hooks.useLayoutEffect(() => { const update = () => setValue(snapshot()); const unsubscribe = subscribe(update); update(); return unsubscribe; }, [subscribe, snapshot]); return value; },
  };
  hooks.useEffectEvent = callback => { const ref = hooks.useRef(callback); hooks.useLayoutEffect(() => { ref.current = callback; }); return hooks.useCallback((...args) => ref.current(...args), []); };
  const runtime = { jsx: (type,props,key) => ({ type,props,key }), jsxs: (type,props,key) => ({ type,props,key }), Fragment: 'Fragment' };
  const cache = new Map();
  const navValues = options.navigationValues || new Map();
  let navOwner = 'me', navScope = '1:me', navChanged = false, navRevision = 1;
  const navListeners = new Set();
  const navigationStore = { getSnapshot:()=>({owner:navOwner,scope:navScope,changed:navChanged,initialized:true}), cache:{
    read:(scope,key)=>scope===navScope?navValues.get(key)??null:null,
    save:(scope,key,value)=>{if(scope!==navScope)return false;navValues.set(key,value);return true;},
  }, subscribe(fn) { navListeners.add(fn); return () => navListeners.delete(fn); }};
  const stored = new Map();
  const location = { pathname: '/messages', search: options.search || '' };
  const browserHistory = { state: {}, pushState(state, _, url) { this.state = state; location.search = new URL(url, 'https://example.test').search; }, replaceState(state, _, url) { this.state = state; location.search = new URL(url, 'https://example.test').search; } };
  const browserDocument = { body: { style: {} }, visibilityState: options.hidden ? 'hidden' : 'visible', hasFocus: () => options.focused !== false,
    addEventListener(name, fn) { const set = browserEvents.get(name) || new Set(); set.add(fn); browserEvents.set(name, set); }, removeEventListener(name, fn) { browserEvents.get(name)?.delete(fn); } };
  const localStorage = { get length() { return stored.size; }, key: i => [...stored.keys()][i], getItem: key => stored.get(key) ?? null, setItem: (key,value) => stored.set(key,value), removeItem: key => stored.delete(key) }; 
  const historyStored = new Map();
  const sessionStorage = { get length() { return historyStored.size; }, key: i => [...historyStored.keys()][i], getItem: key => historyStored.get(key) ?? null, setItem: (key,value) => historyStored.set(key,value), removeItem: key => historyStored.delete(key) };
  const load = name => {
    if (cache.has(name)) return cache.get(name).exports;
    if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return runtime;
    if (name === '@/lib/supabase/client') return { createClient: () => client };
    if (name === '@/lib/navigationCache' || name === './navigationCache') return {getNavigationStore:()=>navigationStore};
    if (name === '@/lib/messages') {
      const actual = load('@/lib/messagesActual');
      return { ...actual, loadConversations: async (_owner,context='personal') => convs.filter(row=>row.context===context),
        loadConversationWindow: options.paged ? actual.loadConversationWindow : async (scope, readOptions) => {
          const items = convs.filter(row => row.context === readOptions.context);
          return { items, paging: null, resolved: new Map(items.map(row => [row.id, row])) };
        } };
    }
    if (name === '@/components/ForwardConversationPicker' && !options.forwardPicker) return { ForwardConversationPicker: props => runtime.jsx('div', { children:
      props.conversations.filter(row => row.id !== props.activeId && !row.request_pending).map(row => runtime.jsx('button', { disabled: props.busy, onClick: () => props.onSelect(row), children: row.title })) }) };
    if (name === '@/lib/chatMedia') return { signGroupAvatars: async rows => rows, signChatMedia: options.signChatMedia || (async rows => rows), isChatMediaUrl: safeChatMedia.isChatMediaUrl, withoutChatMedia: safeChatMedia.withoutChatMedia };
    if (name === '@/lib/feed') return { timeAgo: () => 'now' };
    if (name === 'next/link') return { __esModule: true, default: 'Link' };
    if (name === 'next/image') return { __esModule: true, default: 'img' };
    if (!sources[name]) return new Proxy({}, { get: (_,key) => String(key) });
    const module = { exports: {} }; cache.set(name,module);
    vm.runInNewContext(sources[name], { module, exports: module.exports, require: load, process:{env:options.env||{}}, Error, URLSearchParams, AbortController, crypto: require('node:crypto').webcrypto, sessionStorage,
      window: { localStorage, addEventListener: browserDocument.addEventListener, removeEventListener: browserDocument.removeEventListener, location, history: browserHistory, matchMedia: () => ({ matches: !!options.narrow, addEventListener() {}, removeEventListener() {} }), scrollTo() {} }, document: browserDocument,
      navigator: options.navigator || {}, MediaRecorder: options.MediaRecorder, Blob,
      queueMicrotask, setTimeout: (fn,delay) => setTimeout(fn, options.deadlineMs && delay === 12000 ? options.deadlineMs : delay), clearTimeout, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: fn => { const timer = setTimeout(fn,0); timers.add(timer); return timer; }, cancelAnimationFrame: clearTimeout,
      ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
      IntersectionObserver: class { constructor(callback) { this.callback = callback; } observe() { intersections.add(this.callback); } disconnect() { intersections.delete(this.callback); } },
    }); return module.exports;
  };
  const Component = options.marketBadge ? load('@/components/MarketUnreadDot').MarketUnreadDot
    : options.forwardPicker ? load('@/components/ForwardConversationPicker').ForwardConversationPicker : load('@/components/MessagesApp').MessagesApp;
  const dom = { children: [], style: {}, scrollTop: 0, scrollHeight: 100, clientHeight: 50, value: 'selected-file', getBoundingClientRect: () => ({ top: 0 }), addEventListener(name, fn) { domEvents.set(name, fn); }, removeEventListener(name) { domEvents.delete(name); } };
  const threadContent = { getBoundingClientRect: () => ({ top: -dom.scrollTop }) };
  const inboxEvents = new Map(), inboxDom = { scrollTop: 0, clientHeight: 800, getBoundingClientRect: () => ({ top: 0 }),
    addEventListener(name, fn) { inboxEvents.set(name, fn); }, removeEventListener(name) { inboxEvents.delete(name); } };
  const inboxContent = { getBoundingClientRect: () => ({ top: -inboxDom.scrollTop }) };
  function render() { for (let i=0; dirty && i<25; i++) { dirty=false; cursor=0; tree=Component(options.forwardPicker ? { owner: authUser, context: options.context || 'personal', activeId: options.activeId ?? null, conversations: [], paged: true, busy: false, onSelect: options.onSelect ?? (()=>{}) } : {context:options.context||'personal'}); nodes(tree).forEach(node => { if (node.props?.ref) node.props.ref.current=node.props['data-thread-window'] ? threadContent : node.props['data-inbox-window'] ? inboxContent : node.props['data-inbox-scroll'] ? inboxDom : dom; }); nodes(tree).filter(node => node.type === 'MeasuredThreadMessage').forEach(node => node.props.measure(node.props.id, 100)); const committed=layoutEffects; layoutEffects=[]; committed.forEach(effect => effect.cleanup?.()); committed.forEach(effect => effect.create()); const pending=effects; effects=[]; pending.forEach(effect => effect()); } assert.equal(dirty,false,'render settles'); }
  render();
  return { navigationValues:navValues, client, rows: () => rows, writes, reads, rpcs, dom, listeners, location,
    find: predicate => nodes(tree).find(predicate), all: predicate => nodes(tree).filter(predicate),
    get text() { return nodes(tree).filter(node => typeof node.type !== 'function').map(text).join(' '); },
    click(label) { const n = nodes(tree).find(node => (node.type==='button' || node.props?.role==='button') && (text(node).trim()===label || node.props?.['aria-label']===label || node.props?.title===label)); assert.ok(n,'missing button '+label); assert.ok(!n.props.disabled,'button disabled '+label); const result=n.props.onClick(); render(); return result; },
    open(name) { const n=nodes(tree).find(node => node.type==='button' && node.props?.['aria-label']==='Open conversation with Conversation '+name); assert.ok(n); const result=n.props.onClick(); render(); return result; },
    draft(value) { const n=nodes(tree).find(node => node.type==='textarea'); n.props.onChange({target:{value}}); render(); },
    changeUser(value) { authUser = value; navOwner=value;navScope=value?`${++navRevision}:${value}`:null;navChanged=true;navValues.clear();navListeners.forEach(fn=>fn());authListener?.('SIGNED_IN', value ? { user: { id: value } } : null); render(); },
    changeContext(value) {options.context=value;dirty=true;render();},
    setRead(fn) { readOverride=fn; }, setWrite(fn) { writeOverride=fn; }, setRpcFailure(value) { rpcFailure=value; },
    setInboxRead(fn) { inboxReadOverride=fn; },
    search(value) { const input = nodes(tree).find(node => node.type === 'input' && node.props?.['aria-label'] === 'Search conversations'); input.props.onChange({ target: { value } }); render(); },
    intersect() { for (const callback of [...intersections]) callback([{ isIntersecting: true }]); render(); },
    event(name, payload = {}) { for (const fn of browserEvents.get(name) || []) fn(payload); render(); },
    visible(value) { browserDocument.visibilityState = value ? 'visible' : 'hidden'; this.event('visibilitychange'); },
    focused(value) { options.focused = value; this.event('focus'); },
    scroll(top, height = 1000) { dom.scrollHeight = height; dom.scrollTop = top; domEvents.get('scroll')?.(); render(); },
    inboxScroll(top) { inboxDom.scrollTop = top; inboxEvents.get('scroll')?.(); render(); },
    async flush() { for(let i=0;i<8;i++){ await new Promise(resolve=>setImmediate(resolve)); render(); } },
    unmount() { slots.forEach(slot=>slot?.cleanup?.()); timers.forEach(clearTimeout); },
  };
}

test('cursor is stable at timestamp ties and retains microsecond ordering', () => {
  const a=row(1), b=row(2), c=row(9,{created_at:'2026-10-20T10:00:00.123455+00:00'});
  assert.match(history.olderMessageFilter(a), /and\(created_at.eq.*id.lt/);
  assert.deepEqual(Array.from(history.mergeMessagePage([a,c],[b,a]),x=>x.id),[b.id,a.id,c.id]);
  assert.throws(()=>history.olderMessageFilter({...a,id:'bad,filter'}));
  assert.throws(()=>history.olderMessageFilter({...a,created_at:null}));
});
test('web loads only latest page then older equal-timestamp rows without duplicates', async () => {
  const app=scenario(Array.from({length:55},(_,i)=>row(i+1))); await app.flush(); await app.open('a'); await app.flush();
  assert.equal(app.all(n=>n.type==='p' && /^Message \d+$/.test(text(n))).length,50);
  assert.equal(app.reads.find(c=>c.table==='messages').limit,50);
  await app.click('Load older messages'); await app.flush();
  assert.equal(app.all(n=>n.type==='p' && /^Message \d+$/.test(text(n))).length,55);
  assert.ok(app.reads.some(c=>c.table==='messages' && c.filter?.includes('id.lt.'))); app.unmount();
});
test('out-of-order history response cannot overwrite the newly opened conversation', async () => {
  const app=scenario([row(1),row(2,{conversation_id:'b',text:'Conversation B content'})]); await app.flush();
  const wait=deferred(); app.setRead(call=>call.table==='messages' && call.filters.conversation_id==='a' ? wait.promise : null);
  const first=app.open('a'); await app.flush(); await app.open('b'); await app.flush();
  wait.resolve({data:[row(1)],error:null}); await first; await app.flush();
  assert.ok(app.text.includes('Conversation B content')); assert.ok(!app.text.includes('Message 1')); app.unmount();
});
test('history failure is visible and can be retried', async () => {
  const app=scenario(); await app.flush(); app.setRead(call=>call.table==='messages'?{data:null,error:{message:'offline'}}:null);
  await app.open('a'); await app.flush(); assert.ok(app.text.includes('Messages could not be loaded.'));
  app.setRead(null); await app.click('Try again'); await app.flush(); assert.ok(app.text.includes('Message 1')); app.unmount();
});
test('authorized text appears while private attachments sign, without exposing canonical URLs', async () => {
  const media = 'https://media.test/storage/v1/object/authenticated/chat-media/a/one.mp4';
  const thumbnail = 'https://media.test/storage/v1/object/public/chat-media/a/one.jpg';
  const original = row(1, { media_type: 'video', media_url: media, thumbnail_url: thumbnail });
  const gate = deferred(), app = scenario([original], { signChatMedia: () => gate.promise });
  await app.flush(); const opening = app.open('a'); await app.flush();
  assert.ok(app.text.includes('Message 1')); assert.ok(app.text.includes('Loading attachment…'));
  assert.ok(!app.text.includes('Attachment unavailable'));
  assert.equal(app.all(n => ['img', 'video', 'audio'].includes(n.type)).length, 0);
  gate.resolve([{ ...original, media_url: 'https://media.test/granted-one.mp4', thumbnail_url: 'https://media.test/granted-one.jpg' }]);
  await opening; await app.flush();
  const player = app.find(n => n.type === 'video');
  assert.equal(player.props.src, 'https://media.test/granted-one.mp4');
  assert.equal(player.props.poster, 'https://media.test/granted-one.jpg');
  assert.equal(player.key, original.id + ':https://media.test/granted-one.mp4');
  assert.ok(!app.text.includes('Loading attachment…')); app.unmount();
});
test('attachment failure leaves the authorized conversation readable with a recoverable attachment state', async () => {
  const original = row(1, { media_type: 'image', media_url: 'https://media.test/storage/v1/object/public/chat-media/a/one.jpg' });
  const app = scenario([original], { signChatMedia: async () => { throw new Error('signer unavailable'); } });
  await app.flush(); await app.open('a'); await app.flush();
  assert.ok(app.text.includes('Message 1')); assert.ok(app.text.includes('Some attachments could not load.'));
  assert.ok(app.text.includes('Attachment unavailable')); assert.ok(!app.text.includes('Loading attachment…'));
  assert.equal(app.all(n => n.type === 'img').length, 0); app.unmount();
});
test('returning to a still-signing conversation settles its restored pending attachments after failure', async () => {
  const original = row(1, { media_type: 'image', media_url: 'https://media.test/storage/v1/object/public/chat-media/a/one.jpg' });
  const gate = deferred(), first = scenario([original], { signChatMedia: () => gate.promise });
  await first.flush(); const opening = first.open('a'); await first.flush();
  assert.ok(first.text.includes('Loading attachment…')); first.unmount();
  gate.resolve([original]); await opening;
  const next = scenario([original], { navigationValues: first.navigationValues, signChatMedia: async () => { throw new Error('signer unavailable'); } });
  await next.flush(); assert.ok(next.text.includes('Message 1')); assert.ok(!next.text.includes('Loading attachment…'));
  assert.ok(next.text.includes('Attachment unavailable')); next.unmount();
});
test('an attachment result cannot restore a conversation after its owner changes', async () => {
  const original = row(1, { media_type: 'audio', media_url: 'https://media.test/storage/v1/object/public/chat-media/a/one.m4a' });
  const gate = deferred(), app = scenario([original, row(2, { conversation_id: 'b', text: 'B is current' })], {
    signChatMedia: rows => rows[0]?.conversation_id === 'a' ? gate.promise : Promise.resolve(rows),
  });
  await app.flush(); const first = app.open('a'); await app.flush();
  await app.open('b'); await app.flush();
  gate.resolve([{ ...original, media_url: 'https://media.test/late-a.m4a' }]); await first; await app.flush();
  assert.ok(app.text.includes('B is current')); assert.ok(!app.text.includes('Message 1'));
  assert.equal(app.all(n => n.type === 'audio').length, 0); app.unmount();
});
test('a new session for the same account fences old attachment completion and reloads grants', async () => {
  const original = row(1, { media_type: 'audio', media_url: 'https://media.test/storage/v1/object/public/chat-media/a/one.m4a' });
  const gate = deferred(); let reads = 0;
  const app = scenario([original], { signChatMedia: rows => ++reads === 1 ? gate.promise : Promise.resolve(rows.map(message => ({ ...message, media_url: 'https://media.test/current.m4a' }))) });
  await app.flush(); const old = app.open('a'); await app.flush(); app.changeUser('me');
  await new Promise(resolve => setTimeout(resolve, 1)); await app.flush();
  gate.resolve([{ ...original, media_url: 'https://media.test/old-session.m4a' }]); await old; await app.flush();
  assert.ok(reads >= 2); const player = app.find(n => n.type === 'audio');
  assert.equal(player.key, original.id + ':https://media.test/current.m4a');
  assert.equal(app.find(n => n.type === 'source').props.src, 'https://media.test/current.m4a'); app.unmount();
});
test('reply and confirmed edit execute through real composer handlers', async () => {
  const app=scenario(); await app.flush(); await app.open('a'); await app.flush();
  app.click('Reply'); app.draft('Answer'); await app.click('Send'); await app.flush();
  const insertion=app.writes.find(c=>c.table==='messages'&&c.op==='insert'); assert.equal(insertion.input[0].reply_to_id,id(1));
  app.click('Edit'); app.draft('Revised'); await app.click('Send'); await app.flush();
  assert.ok(app.rows().some(m=>m.text==='Revised'&&m.edited_at)); app.unmount();
});
test('failed edits retain the draft and reaction removal clears its visible count', async () => {
  const app=scenario(); await app.flush(); await app.open('a'); await app.flush();
  app.click('Edit'); app.draft('Keep this draft'); app.setWrite(call=>call.op==='update'?{error:{message:'offline'}}:null);
  await app.click('Send'); await app.flush(); assert.equal(app.find(n=>n.type==='textarea').props.value,'Keep this draft'); assert.ok(app.text.includes('Your edit could not be saved.'));
  app.setWrite(null); app.click('Cancel'); app.click('React ❤️'); await app.flush();
  assert.ok(app.all(n=>n.type==='button'&&n.props['aria-label']==='React ❤️').some(n=>n.props['aria-pressed']===true));
  app.click('React ❤️'); await app.flush(); assert.ok(!app.all(n=>n.type==='button'&&n.props['aria-label']==='React ❤️').some(n=>n.props['aria-pressed']===true)); app.unmount();
});
test('pin failure reports error without success; confirmed pin is visible and removable', async () => {
  const app=scenario(); await app.flush(); await app.open('a'); await app.flush(); app.setRpcFailure(true);
  app.click('Pin'); await app.flush(); assert.ok(app.text.includes('could not be pinned')); assert.ok(!app.text.includes('Pinned ·'));
  app.setRpcFailure(false); app.click('Pin'); await app.flush(); assert.ok(app.text.includes('Pinned · Message 1'));
  app.click('Unpin'); await app.flush(); assert.ok(!app.text.includes('Pinned ·')); app.unmount();
});
test('forwarding fetches canonical media reference and rejects limited-view/payment rows', async () => {
  const original=row(1,{media_type:'image',media_url:'https://media.test/canonical'}), app=scenario([original]);
  await actions.forwardMessage(app.client,{...original,media_url:'https://media.test/expired-signed'}, {id:'b',is_group:true},'me');
  const write=app.writes.find(c=>c.op==='insert'); assert.equal(write.input.media_url,original.media_url); assert.equal(write.input.receiver_id,null); assert.equal(write.input.forwarded_from_id,original.id);
  assert.equal(actions.canForwardMessage({...original,view_limit:1}),false); assert.equal(actions.canForwardMessage({...original,payment_id:'p'}),false); app.unmount();
});
test('failed attachment preserves selection and shows recoverable error', async () => {
  const app=scenario(undefined,{uploadFailure:true}); await app.flush(); await app.open('a'); await app.flush();
  const input=app.find(n=>n.type==='input'&&n.props.type==='file'); await input.props.onChange({target:{files:[{name:'test.jpg',type:'image/jpeg'}]}}); await app.flush();
  assert.ok(app.text.includes('Upload failed.')); assert.equal(app.dom.value,'selected-file'); app.unmount();
});
test('limited-view attachments never render a direct media URL on web', async()=>{
  const app=scenario([row(1,{media_type:'image',media_url:'https://media.test/private',view_limit:1})]);await app.flush();await app.open('a');await app.flush();
  assert.ok(app.text.includes('Limited-view attachment'));assert.equal(app.all(n=>['img','video','audio'].includes(n.type)).length,0);assert.equal(app.all(n=>n.type==='button'&&text(n)==='Forward').length,0);app.unmount();
});
test('draft is preserved per conversation and delayed send remains in original conversation',async()=>{
  const app=scenario([row(1),row(2,{conversation_id:'b'})]);await app.flush();await app.open('a');await app.flush();app.draft('Keep in A');await app.open('b');await app.flush();assert.equal(app.find(n=>n.type==='textarea').props.value,'');await app.open('a');await app.flush();assert.equal(app.find(n=>n.type==='textarea').props.value,'Keep in A');
  const wait=deferred();app.setWrite(call=>call.table==='messages'&&call.op==='insert'?wait.promise:null);const send=app.click('Send');await app.flush();await app.open('b');await app.flush();wait.resolve({data:{...app.writes.find(c=>c.table==='messages'&&c.op==='insert').input[0],created_at:'2026-10-20T11:00:00Z'},error:null});await send;await app.flush();
  // The inbox should show A's confirmed preview, but B must not gain A's bubble.
  assert.equal(app.all(n=>n.type==='p'&&text(n)==='Keep in A').length,0);
  assert.equal(app.find(n=>n.type==='textarea').props.value,'');
  assert.ok(app.text.includes('Keep in A'));assert.equal(app.writes.find(c=>c.table==='messages').input[0].conversation_id,'a');app.unmount();
});
test('account changes discard private drafts and ignore a previous account send completion',async()=>{
  const app=scenario();await app.flush();await app.open('a');await app.flush();app.draft('Private old draft');
  const wait=deferred();app.setWrite(call=>call.table==='messages'&&call.op==='insert'?wait.promise:null);const send=app.click('Send');await app.flush();
  app.changeUser('new-user');await new Promise(resolve=>setTimeout(resolve,1));await app.flush();await app.open('a');await app.flush();
  assert.equal(app.find(n=>n.type==='textarea').props.value,'');
  wait.resolve({data:row(10,{text:'Private old draft'}),error:null});await send;await app.flush();
  assert.ok(!app.text.includes('Private old draft'));app.unmount();
});
test('voice upload finishing after a chat switch releases the upload lock',async()=>{
  const wait=deferred();let uploads=0;
  class Recorder { static isTypeSupported(){return true;} constructor(){this.state='inactive';this.mimeType='audio/webm';} start(){this.state='recording';} stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['voice'])});this.onstop?.();} }
  const app=scenario([row(1),row(2,{conversation_id:'b'})],{navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},MediaRecorder:Recorder,uploadResponse:()=>++uploads===1?wait.promise:{error:null}});
  await app.flush();await app.open('a');await app.flush();await app.click('Record a voice message');await app.flush();
  const sending=app.click('Send voice note');await app.flush();assert.equal(uploads,1);await app.open('b');await app.flush();
  wait.resolve({error:null});await sending;await app.flush();
  const file=app.find(n=>n.type==='input'&&n.props.type==='file');await file.props.onChange({target:{files:[{name:'after.jpg',type:'image/jpeg'}]}});await app.flush();
  assert.equal(uploads,2);assert.ok(app.writes.some(c=>c.table==='messages'&&c.input[0]?.conversation_id==='b'));app.unmount();
});
test('late microphone permission after leaving chat releases tracks without starting recorder',async()=>{
  const wait=deferred();let stopped=0,started=0;class Recorder{static isTypeSupported(){return true;}constructor(){started++;}}
  const app=scenario([row(1),row(2,{conversation_id:'b'})],{navigator:{mediaDevices:{getUserMedia:()=>wait.promise}},MediaRecorder:Recorder});await app.flush();await app.open('a');await app.flush();const request=app.click('Record a voice message');await app.open('b');await app.flush();wait.resolve({getTracks:()=>[{stop(){stopped++;}}]});await request;await app.flush();assert.equal(stopped,1);assert.equal(started,0);app.unmount();
});

test('received private videos open only the authorized viewer and never a direct media element',async()=>{
 const app=scenario([row(1,{sender_id:'other',media_type:'video',media_url:'https://media.test/private.mp4',view_limit:1})],{env:{NEXT_PUBLIC_PRIVATE_MEDIA_SESSIONS_ENABLED:'true'}});await app.flush();await app.open('a');await app.flush();
 assert.equal(app.all(n=>['img','video','audio'].includes(n.type)).length,0);
 await app.click('Open private attachment');await app.flush();
 const viewer=app.find(n=>n.type==='PrivateMediaViewer');assert.ok(viewer);assert.equal(viewer.props.messageId,id(1));assert.equal(viewer.props.userId,'me');
 viewer.props.onConsumed(0);await app.flush();assert.ok(app.text.includes('Viewed'));
 app.changeUser('new-user');await app.flush();assert.equal(app.find(n=>n.type==='PrivateMediaViewer'),undefined);app.unmount();
});
test('old realtime callbacks cannot insert a former account message into the same reopened chat',async()=>{
 const app=scenario();await app.flush();await app.open('a');await app.flush();
 const old=app.listeners.find(l=>l.filter.table==='messages'&&l.filter.event==='INSERT');assert.ok(old);
 app.changeUser('new-user');await new Promise(resolve=>setTimeout(resolve,1));await app.flush();await app.open('a');await app.flush();
 await old.callback({new:row(999,{text:'Old account private event'})});await app.flush();assert.ok(!app.text.includes('Old account private event'));app.unmount();
});
test('sent message bubble preserves its dark navy and white text pair in either theme',async()=>{
 const app=scenario();await app.flush();await app.open('a');await app.flush();
 assert.ok(app.find(n=>n.props?.className?.includes('bg-[#0B1E3D] text-white')));app.unmount();
});

test('private sessions remain disabled by default during the phone and server cutover',async()=>{
 const app=scenario([row(1,{sender_id:'other',media_type:'image',media_url:'https://media.test/private.jpg',view_limit:1})]);await app.flush();await app.open('a');await app.flush();
 assert.ok(app.text.includes('Open in phone app'));assert.equal(app.find(n=>n.type==='PrivateMediaViewer'),undefined);
 assert.equal(app.find(n=>n.type==='button'&&text(n)==='Open private attachment'),undefined);
 assert.equal(app.rpcs.some(c=>c.name.includes('private_media')),false);app.unmount();
});

test('hidden or unfocused web chat does not acknowledge read until it becomes visible and focused',async()=>{
  const app=scenario([row(1,{sender_id:'other',receiver_id:'me'})],{hidden:true});await app.flush();await app.open('a');await app.flush();
  assert.equal(app.rpcs.filter(c=>c.name.startsWith('mark_conversation_read')).length,0);
  app.focused(false);app.visible(true);await app.flush();assert.equal(app.rpcs.filter(c=>c.name.startsWith('mark_conversation_read')).length,0);
  app.focused(true);await app.flush();const reads=app.rpcs.filter(c=>c.name.startsWith('mark_conversation_read'));assert.equal(reads.length,1);assert.equal(reads[0].name,'mark_conversation_read');assert.equal(reads[0].args.p_conv_id,'a');app.unmount();
});
test('new messages received while reading history stay unread until returning to latest',async()=>{
  const app=scenario([row(1,{sender_id:'other',receiver_id:'me'})]);await app.flush();await app.open('a');await app.flush();await new Promise(r=>setTimeout(r,5));await app.flush();
  const before=app.rpcs.filter(c=>c.name.startsWith('mark_conversation_read')).length;app.scroll(0);
  const receive=app.listeners.find(l=>l.filter.table==='messages'&&l.filter.event==='INSERT');await receive.callback({new:row(2,{sender_id:'other',receiver_id:'me'})});await app.flush();await new Promise(r=>setTimeout(r,45));await app.flush();
  assert.equal(app.rpcs.filter(c=>c.name.startsWith('mark_conversation_read')).length,before);
  app.scroll(950);await app.flush();assert.equal(app.rpcs.filter(c=>c.name.startsWith('mark_conversation_read')).length,before+1);app.unmount();
});
test('GIF and sticker actions use durable message delivery and preserve the chosen media kind',async()=>{
  for (const [button,kind] of [['GIFs','gif'],['Stickers','sticker']]) {
    const app=scenario();await app.flush();await app.open('a');await app.flush();app.click(button);await app.flush();
    const picker=app.find(n=>n.type==='GifPicker');assert.ok(picker);await picker.props.onPick({url:'https://media.giphy.com/media/example/giphy.gif',width:300,height:200});await app.flush();
    const write=app.writes.find(c=>c.table==='messages'&&c.op==='insert');assert.equal(write.input[0].media_type,kind);assert.equal(write.input[0].conversation_id,'a');assert.match(write.input[0].id,/^[0-9a-f-]{36}$/);app.unmount();
  }
});
test('story replies expose the authorized story route without copying story media',async()=>{
  const storyId=id(42),app=scenario([row(1,{media_type:'link',media_url:JSON.stringify({pcStory:1,storyId})})]);await app.flush();await app.open('a');await app.flush();
  assert.ok(app.find(n=>n.type==='Link'&&n.props.href==='/story/'+storyId));assert.equal(app.all(n=>['img','video'].includes(n.type)).length,0);app.unmount();
});


test('compact chat Back preserves the draft and cannot reopen itself from an old deep link', async () => {
  const app = scenario(undefined, { narrow: true, search: '?c=a' }); await app.flush();
  assert.ok(app.find(node => node.type === 'textarea'));
  app.draft('Saved before exit'); await app.click('Back to conversations'); await app.flush();
  assert.equal(app.find(node => node.type === 'textarea'), undefined);
  assert.equal(app.location.search, '');
  await app.open('a'); await app.flush();
  assert.equal(app.find(node => node.type === 'textarea').props.value, 'Saved before exit');
  app.unmount();
});

test('Escape cancels an edit first, restores the unsent draft, then returns to the inbox', async () => {
  const app = scenario(undefined, { narrow: true }); await app.flush(); await app.open('a'); await app.flush();
  app.draft('Original draft'); app.click('Edit'); app.draft('Uncommitted edit');
  app.event('keydown', { key: 'Escape', preventDefault() {} }); await app.flush();
  assert.equal(app.find(node => node.type === 'textarea').props.value, 'Original draft');
  assert.equal(app.writes.filter(call => call.table === 'messages' && call.op === 'update').length, 0);
  app.event('keydown', { key: 'Escape', preventDefault() {} }); await app.flush();
  assert.equal(app.find(node => node.type === 'textarea'), undefined);
  app.unmount();
});

test('browser Back closes a compact conversation without a stale history response restoring it', async () => {
  const app = scenario(undefined, { narrow: true }); await app.flush();
  const wait = deferred(); app.setRead(call => call.table === 'messages' ? wait.promise : null);
  const opening = app.open('a'); await app.flush();
  app.location.search = ''; app.event('popstate');
  wait.resolve({ data: [row(1)], error: null }); await opening; await app.flush();
  assert.equal(app.find(node => node.type === 'textarea'), undefined);
  assert.ok(!app.text.includes('Message 1')); app.unmount();
});

test('returning to Messages restores loaded inbox, selected thread, draft and scroll before its background read',async()=>{
  const original=scenario([row(1)]);await original.flush();await original.open('a');await original.flush();original.draft('Keep this draft');original.scroll(240,1000);original.unmount();
  const saved=original.navigationValues.get('messages:personal');assert.equal(saved.active.id,'a');assert.equal(saved.top,240);assert.equal(saved.draft,'Keep this draft');
  const resumed=scenario([row(1)],{navigationValues:original.navigationValues}),gate=deferred();resumed.setRead(call=>call.table==='messages'?gate.promise:null);
  assert.ok(resumed.text.includes('Message 1'));assert.equal(resumed.find(n=>n.type==='textarea').props.value,'Keep this draft');assert.equal(resumed.dom.scrollTop,240);
  await resumed.flush();assert.ok(resumed.text.includes('Message 1'));assert.ok(!resumed.text.includes('Loading messages'));
  gate.resolve({data:null,error:{message:'offline'}});await resumed.flush();assert.ok(resumed.text.includes('Message 1'));assert.ok(resumed.text.includes('Messages could not be loaded.'));resumed.unmount();
});

test('restored thread refresh removes revoked older messages without losing authorized pages or a typed draft',async()=>{
  const rows=Array.from({length:55},(_,i)=>row(i+1)),original=scenario(rows);await original.flush();await original.open('a');await original.flush();await original.click('Load older messages');await original.flush();original.draft('Unsent');original.unmount();
  const resumed=scenario(rows.filter(r=>r.id!==id(1)),{navigationValues:original.navigationValues});
  assert.equal(resumed.all(n=>n.type==='p'&&/^Message \d+$/.test(text(n))).length,55);
  await resumed.flush();assert.equal(resumed.all(n=>n.type==='p'&&/^Message \d+$/.test(text(n))).length,54);
  assert.ok(!resumed.all(n=>n.type==='p').some(n=>text(n)==='Message 1'));assert.ok(resumed.all(n=>n.type==='p').some(n=>text(n)==='Message 2'));
  assert.equal(resumed.find(n=>n.type==='textarea').props.value,'Unsent');resumed.unmount();
});

test('navigation memory never persists limited-view media capabilities or reuses a different business context',async()=>{
  const original=scenario([row(1,{view_limit:1,media_url:'https://signed.invalid/private',_private_media_url:'https://signed.invalid/private',_private_thumbnail_url:'https://signed.invalid/thumb'})]);await original.flush();await original.open('a');await original.flush();original.draft('Personal');original.unmount();
  const cached=original.navigationValues.get('messages:personal');assert.equal(cached.messages[0].media_url,null);assert.equal(cached.messages[0]._private_media_url,undefined);assert.equal(cached.messages[0]._private_thumbnail_url,undefined);
  const market=scenario([],{navigationValues:original.navigationValues,context:'market'});assert.ok(!market.text.includes('Personal'));assert.equal(market.find(n=>n.type==='textarea'),undefined);await market.flush();market.unmount();
});

test('an account change after navigation restore drops the selected thread and late retained-page result',async()=>{
  const original=scenario([row(1)]);await original.flush();await original.open('a');await original.flush();original.unmount();
  const next=scenario([row(1)],{navigationValues:original.navigationValues}),gate=deferred();next.setRead(call=>call.table==='messages'?gate.promise:null);await next.flush();next.changeUser('other-account');
  assert.ok(!next.text.includes('Message 1'));gate.resolve({data:[row(1)],error:null});await next.flush();assert.ok(!next.text.includes('Message 1'));assert.equal(next.navigationValues.size,0);next.unmount();
});

test('changing message business context on a mounted screen restores only that context and preserves the departing draft',async()=>{
 const app=scenario([row(1)]);await app.flush();await app.open('a');await app.flush();app.draft('Private personal draft');
 app.changeContext('market');assert.ok(!app.text.includes('Message 1'));assert.equal(app.find(n=>n.type==='textarea'),undefined);await app.flush();
 assert.equal(app.navigationValues.get('messages:personal').draft,'Private personal draft');
 app.changeContext('personal');assert.ok(app.text.includes('Message 1'));assert.equal(app.find(n=>n.type==='textarea').props.value,'Private personal draft');await app.flush();app.unmount();
});

test('paged web inbox opens thirty rows and scrolls through the complete inbox without duplicate cards', async () => {
  const conversations = inboxRows(95), app = scenario([], { conversations, paged: true });
  await app.flush();
  const cards = () => app.all(node => node.type === 'button' && node.props?.['aria-label']?.startsWith('Open conversation with'));
  assert.equal(cards().length, 30);
  const first = app.rpcs.filter(call => call.name === 'get_inbox_page_v2');
  assert.equal(first.length, 1); assert.equal(first[0].args.p_limit, 30); assert.equal(first[0].args.p_include_deleted, true);
  app.intersect(); await app.flush(); assert.equal(cards().length, 60);
  app.intersect(); await app.flush(); assert.equal(cards().length, 90);
  app.intersect(); await app.flush(); assert.equal(cards().length, 95);
  assert.equal(new Set(cards().map(node => node.key)).size, 95);
  app.unmount(); assert.equal(app.navigationValues.get('messages:personal').inboxPaging.cursor, null);
});

test('long web inbox reading retains 120 conversations and restores authorized earlier pages', async () => {
  const conversations = inboxRows(240), app = scenario([], { conversations, paged: true }); await app.flush();
  const cards = () => app.all(node => node.type === 'button' && node.props['aria-label']?.startsWith('Open conversation with Conversation chat'));
  const visited = new Set();
  for (let n = 0; n < 8; n++) {
    cards().forEach(node => visited.add(node.key)); assert.ok(cards().length <= 120);
    const pages = app.all(node => node.type === 'MeasuredHistoryPage');
    assert.ok(pages.length); pages.forEach(node => node.props.measure(node.props.index, 100)); await app.flush();
    app.inboxScroll(pages.at(-1).props.index * 100 + 1); await app.flush();
    if (n < 7) { app.intersect(); await app.flush(); }
  }
  assert.equal(visited.size, 240); assert.ok(!cards().some(node => node.key === 'chat0'));
  conversations[1].denied = true; app.inboxScroll(0); await app.flush();
  assert.equal(cards()[0].key, 'chat0'); assert.ok(!cards().some(node => node.key === 'chat1'));
  assert.ok(app.rpcs.filter(call => call.args.p_ids).every(call => call.args.p_ids.length <= 50));
  assert.ok(cards().length <= 120); app.unmount();
});

test('web search and Unread find authorized conversations beyond the first page', async () => {
  const conversations = inboxRows(100); conversations[95].title = 'Literal %_ needle'; conversations[95].unread = 4;
  const app = scenario([], { conversations, paged: true }); await app.flush();
  app.search('%_ needle'); await new Promise(resolve => setTimeout(resolve, 270)); await app.flush();
  assert.ok(app.text.includes('Literal %_ needle')); assert.ok(!app.text.includes('Conversation chat0'));
  const search = app.rpcs.filter(call => call.name === 'get_inbox_page_v2').at(-1);
  assert.equal(search.args.p_search, '%_ needle'); assert.equal(search.args.p_cursor, null);
  app.search(''); await new Promise(resolve => setTimeout(resolve, 270)); await app.flush();
  app.click('Unread'); await new Promise(resolve => setTimeout(resolve, 270)); await app.flush();
  assert.ok(app.text.includes('Literal %_ needle'));
  assert.equal(app.rpcs.filter(call => call.name === 'get_inbox_page_v2').at(-1).args.p_filter, 'unread');
  app.unmount();
});

test('a direct link outside page one resolves by ID and opens its messages without downloading the whole inbox', async () => {
  const conversations = inboxRows(500), app = scenario([row(1, { conversation_id: 'chat450', text: 'Direct conversation content' })],
    { conversations, paged: true, search: '?c=chat450' });
  await app.flush(); assert.ok(app.text.includes('Direct conversation content'));
  const reads = app.rpcs.filter(call => call.name === 'get_inbox_page_v2');
  assert.equal(reads.length, 2); assert.equal(reads[0].args.p_limit, 30);
  assert.deepEqual(Array.from(reads[1].args.p_ids), ['chat450']); assert.equal(reads[1].args.p_limit, 50);
  app.unmount();
});

test('browser navigation to an unloaded conversation uses authorized lookup and a later Back cannot reopen it', async () => {
  const conversations = inboxRows(100), app = scenario([row(1, { conversation_id: 'chat90', text: 'Unloaded conversation' })], { conversations, paged: true });
  await app.flush(); app.location.search = '?c=chat90'; app.event('popstate'); await app.flush();
  assert.ok(app.text.includes('Unloaded conversation'));
  const gate = deferred(); let delayed = false;
  app.setInboxRead(args => { if (args.p_ids?.includes('chat91')) { delayed = true; return gate.promise; } });
  app.location.search = '?c=chat91'; app.event('popstate'); await app.flush(); assert.equal(delayed, true);
  app.location.search = ''; app.event('popstate');
  gate.resolve({ data: { version: 2, items: [conversations[91]], has_more: false, next_cursor: null, summary: { total: 100, archived_personal: 0 } }, error: null });
  await app.flush(); assert.equal(app.find(node => node.type === 'textarea'), undefined); app.unmount();
});

test('returning to a paged inbox revalidates loaded tails and retains a selected chat outside the first page', async () => {
  const conversations = inboxRows(80), messages = [row(1, { conversation_id: 'chat70', text: 'Retained active chat' })];
  const first = scenario(messages, { conversations, paged: true }); await first.flush();
  first.intersect(); await first.flush(); first.intersect(); await first.flush();
  await first.open('chat70'); await first.flush(); first.draft('Retained draft'); first.unmount();
  conversations[65].denied = true;
  const restored = scenario(messages, { conversations, paged: true, navigationValues: first.navigationValues });
  assert.ok(restored.text.includes('Retained active chat')); await restored.flush();
  assert.ok(restored.text.includes('Retained active chat')); assert.equal(restored.find(node => node.type === 'textarea').props.value, 'Retained draft');
  assert.ok(!restored.all(node => node.type === 'button').some(node => node.props?.['aria-label'] === 'Open conversation with Conversation chat65'));
  assert.ok(restored.rpcs.some(call => call.name === 'get_inbox_page_v2' && call.args.p_ids?.includes('chat65')));
  restored.unmount();
});

test('a message for an unloaded chat makes one canonical ID read and no full inbox reload', async () => {
  const conversations = inboxRows(100), app = scenario([], { conversations, paged: true }); await app.flush();
  const start = app.rpcs.length;
  const listener = app.listeners.find(item => item.filter.table === 'messages' && item.filter.event === '*');
  listener.callback({ new: { id: 'new-message', conversation_id: 'chat90' } });
  listener.callback({ new: { id: 'newer-message', conversation_id: 'chat90' } });
  await new Promise(resolve => setTimeout(resolve, 220)); await app.flush();
  const reads = app.rpcs.slice(start).filter(call => call.name === 'get_inbox_page_v2');
  assert.equal(reads.length, 1); assert.deepEqual(Array.from(reads[0].args.p_ids), ['chat90']);
  assert.ok(app.text.includes('Conversation chat90')); app.unmount();
});

test('a receipt cannot be rolled back by an older full inbox response', async () => {
  const conversations = inboxRows(40); conversations[0].unread = 9;
  const app = scenario([row(1, { conversation_id: 'chat0', sender_id: 'other', receiver_id: 'me' })], { conversations, paged: true }); await app.flush();
  const gate = deferred(); let delayed = false;
  app.setInboxRead(args => { if (!args.p_ids && !delayed) { delayed = true; return gate.promise; } });
  app.event('focus'); await new Promise(resolve => setTimeout(resolve, 220)); await app.flush(); assert.equal(delayed, true);
  await app.open('chat0'); await app.flush();
  gate.resolve({ data: { version: 2, items: conversations.slice(0, 30), has_more: true,
    next_cursor: { viewer: 'me', offset: 30 }, summary: { total: 40, archived_personal: 0 } }, error: null });
  await app.flush(); app.unmount();
  assert.equal(app.navigationValues.get('messages:personal').conversations.find(row => row.id === 'chat0').unread, 0);
});

test('a late paged response cannot publish private conversations across an account round trip', async () => {
  const conversations = inboxRows(40), app = scenario([], { conversations, paged: true }); await app.flush();
  const gate = deferred(); let delayed = false;
  app.setInboxRead(args => { if (!args.p_ids && !delayed) { delayed = true; return gate.promise; } });
  app.event('focus'); await new Promise(resolve => setTimeout(resolve, 220)); await app.flush();
  app.changeUser('other-account'); app.changeUser('me'); await new Promise(resolve => setTimeout(resolve, 1)); await app.flush();
  gate.resolve({ data: { version: 2, items: [{ ...conversations[0], title: 'STALE PRIVATE CONVERSATION' }], has_more: false,
    next_cursor: null, summary: { total: 1, archived_personal: 0 } }, error: null });
  await app.flush(); assert.ok(!app.text.includes('STALE PRIVATE CONVERSATION')); app.unmount();
});

test('forwarding paginates its complete independent destination list including community chats', async () => {
  const conversations = inboxRows(75); conversations[70].is_group = true; conversations[70].group_type = 'community';
  let selected;
  const app = scenario([], { conversations, paged: true, forwardPicker: true, activeId: 'chat0', onSelect: row => { selected = row; } });
  await app.flush(); assert.equal(app.all(node => node.type === 'button').length, 29);
  app.intersect(); await app.flush(); app.intersect(); await app.flush();
  assert.ok(app.text.includes('Conversation chat70')); app.click('Conversation chat70'); assert.equal(selected.id, 'chat70');
  const reads = app.rpcs.filter(call => call.name === 'get_inbox_page_v2');
  assert.ok(reads.every(call => call.args.p_exclude_community === false && call.args.p_search === '' && call.args.p_filter === 'all'));
  app.unmount();
});

test('the Market badge reads the complete exact total without loading any conversation page', async () => {
  const app = scenario([], { paged: true, marketBadge: true, marketUnread: 8700 }); await app.flush();
  assert.ok(app.text.includes('9+')); assert.equal(app.rpcs.filter(call => call.name === 'get_inbox_unread_totals_v2').length, 1);
  assert.equal(app.rpcs.filter(call => call.name === 'get_inbox_page_v2').length, 0);
  assert.equal(app.reads.filter(call => ['messages','conversations','conversation_members'].includes(call.table)).length, 0);
  const before = app.rpcs.length; app.visible(false); app.event('focus'); await app.flush(); assert.equal(app.rpcs.length, before);
  app.visible(true); await app.flush(); assert.equal(app.rpcs.filter(call => call.name === 'get_inbox_unread_totals_v2').length, 2); app.unmount();
});

test('a delayed Market unread result cannot cross a rapid account round trip', async () => {
  const app = scenario([], { paged: true, marketBadge: true, marketUnread: 2 }); await app.flush();
  const gate = deferred(); let held = false;
  app.setInboxRead(args => { if (args.totals && !held) { held = true; return gate.promise; } });
  app.event('focus'); await app.flush(); assert.equal(held, true);
  app.changeUser('other-account'); app.changeUser('me'); await app.flush();
  gate.resolve({ data: { version: 2, personal: 0, market: 8, jobs: 0 }, error: null }); await app.flush();
  assert.equal(app.text.trim(), '2'); app.unmount();
});

test('an old authorized direct lookup cannot reopen a conversation removed by a newer full refresh', async () => {
  const conversations = inboxRows(100), app = scenario([row(1, { conversation_id: 'chat90', text: 'Revoked secret' })], { conversations, paged: true });
  await app.flush(); const gate = deferred(); let held = false;
  const old = { ...conversations[90] };
  app.setInboxRead(args => { if (args.p_ids?.includes('chat90') && !held) { held = true; return gate.promise; } });
  app.location.search = '?c=chat90'; app.event('popstate'); await app.flush(); assert.equal(held, true);
  conversations[90].denied = true; app.event('focus'); await new Promise(resolve => setTimeout(resolve, 220)); await app.flush();
  gate.resolve({ data: { version: 2, items: [old], has_more: false, next_cursor: null, summary: { total: 99, archived_personal: 0 } }, error: null });
  await app.flush(); assert.ok(!app.text.includes('Revoked secret')); assert.equal(app.find(node => node.type === 'textarea'), undefined);
  assert.ok(!app.all(node => node.type === 'button').some(node => node.props?.['aria-label'] === 'Open conversation with Conversation chat90')); app.unmount();
});

test('a queued web full refresh holds its real transport across timeout and hidden-visible recovery', async () => {
  const conversations = inboxRows(60), app = scenario([], { conversations, paged: true, deadlineMs: 40 }); await app.flush();
  const gate = deferred(); let held = false;
  const before = app.rpcs.filter(call => call.name === 'get_inbox_page_v2').length;
  app.setInboxRead(args => { if (!args.p_ids && !held) { held = true; return gate.promise; } });
  app.event('focus'); await new Promise(resolve => setTimeout(resolve, 280)); await app.flush(); assert.equal(held, true);
  app.visible(false); app.visible(true); await new Promise(resolve => setTimeout(resolve, 220)); await app.flush();
  assert.equal(app.rpcs.filter(call => call.name === 'get_inbox_page_v2').length, before + 1);
  gate.resolve({ data: null, error: { message: 'late abort' } }); await app.flush();
  await new Promise(resolve => setTimeout(resolve, 220)); await app.flush();
  assert.equal(app.rpcs.filter(call => call.name === 'get_inbox_page_v2').length, before + 2);
  assert.ok(app.text.includes('Conversation chat0')); app.unmount();
});
