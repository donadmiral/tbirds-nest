const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/components/VideoThumb.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function walk(n) { return !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.props?.children)]; }
function harness() {
  let cursor = 0, active, scope = 'account-a:1', timerId = 0;
  const instances = new Map(), requests = [], removed = [], listeners = new Set(), timers = new Map();
  const instance = name => { if (!instances.has(name)) instances.set(name, { slots: [], effects: [] }); return instances.get(name); };
  const react = {
    useState(value) { const {slots}=active,i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(value) { const {slots}=active,i = cursor++; return slots[i] ??= { current: value }; },
    useEffect(fn, deps) { const {slots,effects}=active,i = cursor++; if (!slots[i] || deps.some((d, j) => !Object.is(d, slots[i].deps[j]))) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    useSyncExternalStore(subscribe,snapshot) { const {slots}=active,i=cursor++; if(!(i in slots))slots[i]={cleanup:subscribe(()=>{})}; return snapshot(); },
  };
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(code, { module, exports: module.exports, setTimeout: fn => { timers.set(++timerId,fn);return timerId; }, clearTimeout: id => timers.delete(id), require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { View: 'View', Text: 'Text', ActivityIndicator: 'Spinner' };
    if (name === '../../shared/mediaDelivery') return { privateImageCachePolicy: uri => uri?.startsWith('public-') ? 'memory-disk' : 'none' };
    if (name === '../lib/navigationCache') return { navigationScope:()=>scope,subscribeNavigationScope:fn=>{listeners.add(fn);return()=>listeners.delete(fn);} };
    if (name === 'expo-file-system/legacy') return { deleteAsync:async uri=>{removed.push(uri);} };
    if (name === 'expo-image') return { Image: 'Image' };
    if (name === 'expo-video-thumbnails') return { getThumbnailAsync: (uri, options) => new Promise((resolve, reject) => requests.push({ uri, options, resolve, reject })) };
    throw Error(name);
  }});
  return { requests, removed,
    render(uri, posterUri, props={},name='default') { active=instance(name);cursor = 0; return module.exports.default({ uri, posterUri,...props }); },
    flush() { for(const {effects} of instances.values())while(effects.length)effects.shift()(); },
    changeScope(next) { scope=next;listeners.forEach(fn=>fn()); },
    deadlines() { const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn()); },
    dispose(name='default') { instance(name).slots.forEach(s => s?.cleanup?.());instances.delete(name); },
  };
}
test('reused video tiles immediately hide the old frame and ignore late results', async () => {
  const h = harness(); h.render('a'); h.flush(); await tick();h.requests[0].resolve({ uri: 'file:///cache/a.jpg' }); await tick();
  assert.equal(walk(h.render('a')).find(n => n.type === 'Image').props.source.uri, 'file:///cache/a.jpg');
  assert.equal(walk(h.render('b')).some(n => n.type === 'Image'), false); h.flush();await tick();
  h.render('c'); h.flush();await tick(); h.requests[1].resolve({ uri: 'file:///cache/b.jpg' }); await tick();
  assert.equal(walk(h.render('c')).some(n => n.type === 'Image'), false);
  h.requests[2].resolve({ uri: 'file:///cache/c.jpg' }); await tick();
  assert.equal(walk(h.render('c')).find(n => n.type === 'Image').props.source.uri, 'file:///cache/c.jpg');
  assert.ok(h.removed.includes('file:///cache/a.jpg'));assert.ok(h.removed.includes('file:///cache/b.jpg'));h.dispose();
});
test('short videos request their first frame once and failures expose a readable state', async () => {
  const h = harness(); h.render('short'); h.flush();await tick(); assert.equal(h.requests[0].options.time, 0); h.requests[0].reject(Error('Unavailable')); await tick();
  const tree = h.render('short'); assert.match(tree.props.accessibilityLabel, /unavailable/);
  assert.equal(walk(tree).some(n => n.type === 'Spinner'), false); assert.equal(tree.props.pointerEvents, 'none');
});

test('encrypted fallback stays visible until the real video poster displays and disappears on expiry or account change', () => {
  const h = harness(), fallback = 'data:image/jpeg;base64,/9j/abcd';
  const props = { allowDecode: false, fallbackPosterUri: fallback };
  const first = walk(h.render('video', 'real-cover', props)).filter(node => node.type === 'Image');
  assert.equal(first.length, 2); assert.equal(first[0].props.cachePolicy, 'none');
  assert.equal(first[0].props.source.uri, fallback); assert.equal(first[1].props.source.uri, 'real-cover');
  first[1].props.onDisplay();
  assert.equal(walk(h.render('video', 'real-cover', props)).filter(node => node.type === 'Image').length, 1);
  first[1].props.onError(); first[1].props.onDisplay();
  const failed = walk(h.render('video', 'real-cover', props)).filter(node => node.type === 'Image');
  assert.equal(failed.length, 1); assert.equal(failed[0].props.source.uri, fallback);
  assert.equal(walk(h.render('video', null, { allowDecode: false })).some(node => node.type === 'Image'), false);
  h.render('video', null, props); h.changeScope('account-b:2');
  assert.equal(walk(h.render('video', null, props)).some(node => node.type === 'Image'), false);
  h.dispose();
});
test('a missing cached image fails visibly and a new signed URL gets a fresh frame', async () => {
  const h = harness(); h.render('signed-one'); h.flush();await tick(); h.requests[0].resolve({ uri: 'file:///cache/gone.jpg' }); await tick();
  walk(h.render('signed-one')).find(n => n.type === 'Image').props.onError();
  assert.match(h.render('signed-one').props.accessibilityLabel, /unavailable/);
  h.render('signed-two'); h.flush();await tick(); assert.equal(h.requests[1].uri, 'signed-two');
  h.requests[1].resolve({ uri: 'file:///cache/renewed.jpg' }); await tick();
  assert.equal(walk(h.render('signed-two')).find(n => n.type === 'Image').props.source.uri, 'file:///cache/renewed.jpg');
  assert.deepEqual(h.removed,['file:///cache/gone.jpg']);h.dispose();
});

test('a selected cover loads without decoding video, and a failed cover falls back to a frame', async () => {
  const h = harness();
  const selected = h.render('movie', 'signed-cover.jpg'); h.flush();
  assert.equal(walk(selected).find(n => n.type === 'Image').props.source.uri, 'signed-cover.jpg');
  assert.equal(h.requests.length, 0);
  walk(selected).find(n => n.type === 'Image').props.onError();
  assert.equal(walk(h.render('movie', 'signed-cover.jpg')).some(n => n.type === 'Image'), false); h.flush();await tick();
  assert.equal(h.requests[0].uri, 'movie');
  h.requests[0].resolve({ uri: 'file:///cache/fallback-frame.jpg' }); await tick();
  assert.equal(walk(h.render('movie', 'signed-cover.jpg')).find(n => n.type === 'Image').props.source.uri, 'file:///cache/fallback-frame.jpg');
  assert.equal(walk(h.render('other-movie', 'new-signed-cover.jpg')).find(n => n.type === 'Image').props.source.uri, 'new-signed-cover.jpg');
  h.dispose();
});

test('playback surfaces never start competing thumbnail decoders, including when the supplied cover fails', async () => {
  const h = harness();
  const missing = h.render('feed-video', null, { allowDecode: false }); h.flush(); await tick();
  assert.equal(h.requests.length, 0);
  assert.equal(walk(missing).some(node => node.type === 'Spinner'), false);
  const covered = h.render('feed-video', 'feed-cover', { allowDecode: false }); h.flush();
  walk(covered).find(node => node.type === 'Image').props.onError();
  h.render('feed-video', 'feed-cover', { allowDecode: false }); h.flush(); await tick();
  assert.equal(h.requests.length, 0);
  h.dispose();
});

test('a playback poster cannot borrow an unretained generated private frame from another tile', async () => {
  const h = harness();
  h.render('private-video', null, {}, 'tile'); h.flush(); await tick();
  h.requests[0].resolve({ uri: 'file:///cache/private-frame.jpg' }); await tick();
  const poster = h.render('private-video', null, { allowDecode: false }, 'player'); h.flush();
  assert.equal(walk(poster).some(node => node.type === 'Image'), false);
  h.dispose('tile');
  assert.deepEqual(h.removed, ['file:///cache/private-frame.jpg']);
  assert.equal(h.requests.length, 1);
  h.dispose('player');
});

test('account changes immediately hide old generated frames, remove owned files, and reject late decoder output',async()=>{
  const h=harness();h.render('signed-a');h.flush();await tick();h.requests[0].resolve({uri:'file:///cache/account-a.jpg'});await tick();
  h.render('signed-pending',null,{},'second');h.flush();await tick();
  h.changeScope('account-b:2');
  assert.equal(walk(h.render('signed-a')).some(n=>n.type==='Image'),false);h.flush();await tick();
  assert.ok(h.removed.includes('file:///cache/account-a.jpg'));
  h.requests[1].resolve({uri:'file:///cache/late-a.jpg'});await tick();
  assert.ok(h.removed.includes('file:///cache/late-a.jpg'));
  assert.equal(walk(h.render('signed-a')).some(n=>n.type==='Image'),false);
  h.requests[2].resolve({uri:'file:///cache/account-b.jpg'});await tick();
  assert.equal(walk(h.render('signed-a')).find(n=>n.type==='Image').props.source.uri,'file:///cache/account-b.jpg');
  h.dispose();h.dispose('second');assert.equal(h.removed.some(uri=>uri==='signed-a'||uri==='signed-pending'),false);
});

test('private frames are shared only while used and last release deletes their generated file',async()=>{
  const h=harness();h.render('signed-shared');h.render('signed-shared',null,{},'second');h.flush();await tick();
  assert.equal(h.requests.length,1);h.requests[0].resolve({uri:'file:///cache/shared.jpg'});await tick();
  h.dispose();assert.equal(h.removed.length,0);h.dispose('second');assert.deepEqual(h.removed,['file:///cache/shared.jpg']);
  h.render('signed-shared');h.flush();await tick();assert.equal(h.requests.length,2);h.requests[1].reject(Error('Done'));await tick();h.dispose();
});

test('public preview cache evicts generated files while leaving source movies and supplied posters alone',async()=>{
  const h=harness();
  for(let i=0;i<102;i++){
    h.render(`public-${i}`);h.flush();await tick();h.requests[i].resolve({uri:`file:///cache/public-${i}.jpg`});await tick();h.dispose();
  }
  assert.equal(h.removed.length,2);assert.deepEqual(h.removed,['file:///cache/public-0.jpg','file:///cache/public-1.jpg']);
  h.render('public-movie','public-cover',{contentFit:'contain'});h.flush();await tick();
  const image=walk(h.render('public-movie','public-cover',{contentFit:'contain'})).find(n=>n.type==='Image');
  assert.equal(image.props.contentFit,'contain');assert.equal(h.requests.length,102);
  h.changeScope(null);assert.equal(h.removed.length,102);assert.equal(h.removed.includes('public-cover'),false);h.dispose();
});

test('preview deadlines show a truthful fallback without exceeding two actual native decoders',async()=>{
  const h=harness();
  for(let i=0;i<13;i++)h.render(`pending-${i}`,null,{},`tile-${i}`);
  h.flush();await tick();assert.equal(h.requests.length,2);h.deadlines();
  for(let i=0;i<13;i++)assert.match(h.render(`pending-${i}`,null,{},`tile-${i}`).props.accessibilityLabel,/unavailable/);
  assert.equal(h.requests.length,2);
  h.changeScope('account-b:2');await tick();
  h.requests[0].resolve({uri:'file:///cache/abandoned-0.jpg'});h.requests[1].resolve({uri:'file:///cache/abandoned-1.jpg'});await tick();
  assert.equal(h.requests.length,2,'Old queued work never starts after account invalidation');
  assert.deepEqual(h.removed.sort(),['file:///cache/abandoned-0.jpg','file:///cache/abandoned-1.jpg']);
  for(let i=0;i<13;i++)h.dispose(`tile-${i}`);
});
