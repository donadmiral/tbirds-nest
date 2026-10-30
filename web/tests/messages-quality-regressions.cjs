const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const sources = {
  '@/lib/profileLookup': compile(path.join(root, 'lib/profileLookup.ts')),
  '@/lib/withTimeout': compile(path.join(root, 'lib/withTimeout.ts')),
  '@/components/MessagesApp': compile(path.join(root, 'components/MessagesApp.tsx')),
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
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const row = (n, props = {}) => ({ id: id(n), conversation_id: 'a', sender_id: 'me', receiver_id: 'other', text: 'Message ' + n, media_url: null, media_type: null, reply_to_id: null, created_at: '2026-10-20T10:00:00.123456+00:00', ...props });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node?.type === 'RichText' ? node.props.text : text(node?.props?.children ?? '');
function nodes(tree) { const out = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; out.push(node); if (typeof node.type === 'function') walk(node.type(node.props)); else walk(node.props?.children); }; walk(tree); return out; }

function scenario(initial = [row(1)], options = {}) {
  let rows = [...initial], reactions = [], pins = {}, tree, dirty = true, effects = [], layoutEffects = [], cursor = 0;
  const slots = [], writes = [], reads = [], rpcs = [], listeners = [], timers = new Set(), browserEvents = new Map(), domEvents = new Map();
  const convs = ['a', 'b'].map(value => ({ id: value, title: 'Conversation ' + value, other_id: 'other', context: 'personal', is_group: !!options.group, unread: 0, last_message: '', last_message_time: null }));
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
    auth: { getSession: async () => ({ data: { session: authUser ? { user: { id: authUser } } : null }, error: null }), onAuthStateChange: callback => { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; } },
    from(table) { const call = { table, op: 'select', filters: {} }; const chain = {
      abortSignal() { return chain; }, select(value) { call.select = value; return chain; }, eq(k,v) { call.filters[k] = v; return chain; }, is(k,v) { call.filters[k] = v; return chain; }, in(k,v) { call.filters[k] = v; return chain; },
      order() { return chain; }, limit(value) { call.limit = value; return chain; }, or(value) { call.filter = value; return chain; }, maybeSingle() { call.single = true; return chain; }, single() { call.single = true; return chain; },
      insert(input) { call.op = 'insert'; call.input = input; return chain; }, update(input) { call.op = 'update'; call.input = input; return chain; }, upsert(input) { call.op = 'upsert'; call.input = input; return chain; }, delete() { call.op = 'delete'; return chain; },
      then(ok,bad) { return Promise.resolve().then(() => execute(call)).then(ok,bad); },
    }; return chain; },
    rpc: async (name, args) => { rpcs.push({ name, args }); if (rpcFailure) return { error: { message: 'denied' } }; if (name === 'set_pinned_message') pins[args.p_conversation_id] = args.p_message_id; return { data: null, error: null }; },
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
    useLayoutEffect(fn,deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps,deps)) { const previous = slots[i]; slots[i] = { deps }; layoutEffects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    useSyncExternalStore(subscribe, snapshot) { const [value, setValue] = hooks.useState(snapshot); hooks.useLayoutEffect(() => { const update = () => setValue(snapshot()); const unsubscribe = subscribe(update); update(); return unsubscribe; }, [subscribe, snapshot]); return value; },
  };
  hooks.useEffectEvent = callback => { const ref = hooks.useRef(callback); hooks.useLayoutEffect(() => { ref.current = callback; }); return hooks.useCallback((...args) => ref.current(...args), []); };
  const runtime = { jsx: (type,props,key) => ({ type,props,key }), jsxs: (type,props,key) => ({ type,props,key }), Fragment: 'Fragment' };
  const cache = new Map();
  const stored = new Map();
  const location = { pathname: '/messages', search: options.search || '' };
  const browserHistory = { state: {}, pushState(state, _, url) { this.state = state; location.search = new URL(url, 'https://example.test').search; }, replaceState(state, _, url) { this.state = state; location.search = new URL(url, 'https://example.test').search; } };
  const browserDocument = { body: { style: {} }, visibilityState: options.hidden ? 'hidden' : 'visible', hasFocus: () => options.focused !== false,
    addEventListener(name, fn) { const set = browserEvents.get(name) || new Set(); set.add(fn); browserEvents.set(name, set); }, removeEventListener(name, fn) { browserEvents.get(name)?.delete(fn); } };
  const localStorage = { get length() { return stored.size; }, key: i => [...stored.keys()][i], getItem: key => stored.get(key) ?? null, setItem: (key,value) => stored.set(key,value), removeItem: key => stored.delete(key) }; 
  const load = name => {
    if (cache.has(name)) return cache.get(name).exports;
    if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return runtime;
    if (name === '@/lib/supabase/client') return { createClient: () => client };
    if (name === '@/lib/messages') return { loadConversations: async () => convs };
    if (name === '@/lib/chatMedia') return { signChatMedia: async rows => rows, isChatMediaUrl: () => false };
    if (name === '@/lib/feed') return { timeAgo: () => 'now' };
    if (name === 'next/link') return { __esModule: true, default: 'Link' };
    if (name === 'next/image') return { __esModule: true, default: 'img' };
    if (!sources[name]) return new Proxy({}, { get: (_,key) => String(key) });
    const module = { exports: {} }; cache.set(name,module);
    vm.runInNewContext(sources[name], { module, exports: module.exports, require: load, process:{env:options.env||{}}, Error, URLSearchParams, AbortController, crypto: require('node:crypto').webcrypto,
      window: { localStorage, addEventListener: browserDocument.addEventListener, removeEventListener: browserDocument.removeEventListener, location, history: browserHistory, matchMedia: () => ({ matches: !!options.narrow, addEventListener() {}, removeEventListener() {} }), scrollTo() {} }, document: browserDocument,
      navigator: options.navigator || {}, MediaRecorder: options.MediaRecorder, Blob,
      setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: fn => { const timer = setTimeout(fn,0); timers.add(timer); return timer; }, cancelAnimationFrame: clearTimeout,
      ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    }); return module.exports;
  };
  const Component = load('@/components/MessagesApp').MessagesApp;
  const dom = { children: [], style: {}, scrollTop: 0, scrollHeight: 100, clientHeight: 50, value: 'selected-file', addEventListener(name, fn) { domEvents.set(name, fn); }, removeEventListener(name) { domEvents.delete(name); } };
  function render() { for (let i=0; dirty && i<25; i++) { dirty=false; cursor=0; tree=Component({}); nodes(tree).forEach(node => { if (node.props?.ref) node.props.ref.current=dom; }); const committed=layoutEffects; layoutEffects=[]; committed.forEach(effect => effect()); const pending=effects; effects=[]; pending.forEach(effect => effect()); } assert.equal(dirty,false,'render settles'); }
  render();
  return { client, rows: () => rows, writes, reads, rpcs, dom, listeners, location,
    find: predicate => nodes(tree).find(predicate), all: predicate => nodes(tree).filter(predicate),
    get text() { return nodes(tree).filter(node => typeof node.type !== 'function').map(text).join(' '); },
    click(label) { const n = nodes(tree).find(node => (node.type==='button' || node.props?.role==='button') && (text(node).trim()===label || node.props?.['aria-label']===label || node.props?.title===label)); assert.ok(n,'missing button '+label); assert.ok(!n.props.disabled,'button disabled '+label); const result=n.props.onClick(); render(); return result; },
    open(name) { const n=nodes(tree).find(node => node.type==='button' && node.props?.['aria-label']==='Open conversation with Conversation '+name); assert.ok(n); const result=n.props.onClick(); render(); return result; },
    draft(value) { const n=nodes(tree).find(node => node.type==='textarea'); n.props.onChange({target:{value}}); render(); },
    changeUser(value) { authUser = value; authListener('SIGNED_IN', value ? { user: { id: value } } : null); render(); },
    setRead(fn) { readOverride=fn; }, setWrite(fn) { writeOverride=fn; }, setRpcFailure(value) { rpcFailure=value; },
    event(name, payload = {}) { for (const fn of browserEvents.get(name) || []) fn(payload); render(); },
    visible(value) { browserDocument.visibilityState = value ? 'visible' : 'hidden'; this.event('visibilitychange'); },
    focused(value) { options.focused = value; this.event('focus'); },
    scroll(top, height = 1000) { dom.scrollHeight = height; dom.scrollTop = top; domEvents.get('scroll')?.(); render(); },
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
