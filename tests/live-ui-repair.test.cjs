const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const theme = { ink: { primary: '#101e3e', secondary: '#536077', muted: '#7c8796' }, surface: { raised: '#fff', sunken: '#f1eee8' } };
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, imports) {
  const module = { exports: {} };
  const output = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true }, reportDiagnostics: true });
  assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  vm.runInNewContext(output.outputText, { module, exports: module.exports, console, URL, Date, Promise, Error, setTimeout, clearTimeout,
    require(name) { if (name in imports) return imports[name]; throw new Error(`Unexpected import ${name} in ${file}`); } });
  return module.exports;
}
function hooks() {
  let cursor = 0, pending = [], slots = [];
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment',
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial; return [slots[id], value => { slots[id] = typeof value === 'function' ? value(slots[id]) : value; }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useEffect(fn, deps) { const id = cursor++; if (!same(slots[id], deps)) { slots[id] = deps; pending.push(fn); } },
    useCallback(fn, deps) { const id = cursor++; if (!slots[id] || !same(slots[id].deps, deps)) slots[id] = { fn, deps }; return slots[id].fn; },
  };
  return { react, render(component, props) { cursor = 0; return component(props); }, async settle() { const work = pending; pending = []; work.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); } };
}
function nodes(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.props?.children)]; }
const by = (tree, key, value) => nodes(tree).find(node => node.props?.[key] === value);
const words = value => Array.isArray(value) ? value.map(words).join('') : typeof value === 'string' ? value : value?.props ? words(value.props.children) : '';
const rn = new Proxy({ StyleSheet: { create: x => x, hairlineWidth: 1 }, Platform: { OS: 'ios' }, Keyboard: { addListener: () => ({ remove() {} }), dismiss() {} }, Alert: { alert() {} } }, { get: (obj, key) => key in obj ? obj[key] : key });
const directory = load('shared/liveDirectory.ts', {});
const setup = load('shared/liveSetup.ts', {});
function common(h) { return { react: h.react, 'react-native': rn, '@expo/vector-icons': { Feather: 'Feather' } }; }
function quickStart(options = {}) {
  const h = hooks(), calls = [], routes = [], caps = options.caps || { create: true, broadcast: true, recording: true };
  let serial = 0, reject = options.reject;
  const component = load('src/screens/feed/NewLiveScreen.tsx', { ...common(h),
    '../../components/SafeArea': { SafeAreaView: 'SafeAreaView' },
    '../../components/LiveUi': { LiveIcon: 'LiveIcon', LiveChoice: 'LiveChoice', LIVE_AUDIENCES: [['public','Public'],['followers','Followers'],['invite','Invitation only']] },
    '../../theme/useTheme': { useTheme: () => ({ t: theme }) },
    '../../stores/authStore': { useAuthStore: fn => fn({ profile: { id: 'owner' } }) },
    '../../../shared/liveDirectory': directory,
    '../../../shared/liveSetup': setup,
    '../../services/liveService': { liveObject: v => !!v && typeof v === 'object', liveRpc: async () => ({ capabilities: caps }), liveRequestId: () => `request-${++serial}`,
      liveCommand: async (...args) => { calls.push(args); if (reject) throw new Error('Temporarily unavailable'); return { session_id: '11111111-1111-4111-8111-111111111111' }; } },
  }).default;
  const props = { route: {params: {schedule: options.schedule===true}}, navigation: { goBack() {}, replace: (...args) => routes.push(args) } };
  return { h, calls, routes, render: () => h.render(component, props), allow: () => { reject = false; } };
}
test('Live uses a camera icon rather than the Channels radio symbol', () => {
  const h = hooks(), ui = load('src/components/LiveUi.tsx', { ...common(h), './SafeArea': { SafeAreaView: 'SafeAreaView' }, '../theme/useTheme': { useTheme: () => ({ t: theme }) }, '../../shared/liveDirectory': directory });
  const tree = h.render(ui.LiveIcon, { color: '#000' });
  assert.ok(by(tree, 'name', 'video')); assert.equal(by(tree, 'name', 'radio'), undefined);
});
test('directory has three simple tabs and keeps topics behind closed filters', () => {
  const h = hooks(), ui = load('src/components/LiveUi.tsx', { ...common(h), './SafeArea': { SafeAreaView: 'SafeAreaView' }, '../theme/useTheme': { useTheme: () => ({ t: theme }) }, '../../shared/liveDirectory': directory });
  let started = 0;
  const props = { filter: 'for_you', view: 'live', topic: 'all', query: '', onFilter() {}, onView() {}, onTopic() {}, onQuery() {}, onBack() {}, onCreate: () => started++, onClips() {} };
  let tree = h.render(ui.LiveDirectoryHeader, props);
  assert.equal(nodes(tree).filter(n => n.props?.accessibilityRole === 'tab').length, 3);
  assert.equal(nodes(tree).find(n => n.type === 'Modal').props.visible, false);
  assert.equal(nodes(tree).some(n => n.type === 'TextInput'), false);
  by(tree, 'accessibilityLabel', 'Start live').props.onPress(); assert.equal(started, 1);
  by(tree, 'accessibilityLabel', 'Filters').props.onPress();
  tree = h.render(ui.LiveDirectoryHeader, props);
  assert.equal(nodes(tree).find(n => n.type === 'Modal').props.visible, true);
  assert.ok(nodes(tree).filter(n => n.props?.accessibilityRole === 'radio').length > 10);
});
test('preview accepts an optional title and opens Studio without starting a broadcast', async () => {
  const app = quickStart(); app.render(); await app.h.settle(); const tree = app.render();
  const button = by(tree, 'testID', 'live-preview-button'); assert.equal(button.props.disabled, false);
  button.props.onPress(); await app.h.settle();
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0][0], 'create'); assert.equal(app.calls[0][2].title, 'Live stream');
  assert.equal(app.routes[0][0], 'LiveSession'); assert.equal(app.routes[0][1].openStudio, true); assert.equal(app.routes[0][1].previewCamera, true);
  assert.equal(app.calls.some(call => call[0] === 'start'), false);
});
test('capability denial cannot be hidden by the redesigned Go live UI', async () => {
  const app = quickStart({ caps: { create: true, broadcast: false, recording: false } }); app.render(); await app.h.settle(); const tree = app.render();
  assert.equal(by(tree, 'testID', 'live-preview-button').props.disabled, true);
  by(tree, 'testID', 'live-preview-button').props.onPress(); await app.h.settle(); assert.equal(app.calls.length, 0);
  assert.match(words(tree), /Broadcasting is not enabled/);
});
test('a failed create retains its idempotency key and does not navigate', async () => {
  const app = quickStart({ reject: true }); app.render(); await app.h.settle();
  by(app.render(), 'testID', 'live-preview-button').props.onPress(); await app.h.settle();
  assert.equal(app.routes.length, 0); app.allow();
  by(app.render(), 'testID', 'live-preview-button').props.onPress(); await app.h.settle();
  assert.equal(app.calls.length, 2); assert.equal(app.calls[0][3], app.calls[1][3]); assert.equal(app.routes.length, 1);
});
test('scheduling never opens the camera automatically', async () => {
  const app=quickStart();app.render();await app.h.settle();
  by(app.render(),'accessibilityLabel','Schedule for later').props.onPress();
  by(app.render(),'testID','live-preview-button').props.onPress();await app.h.settle();
  assert.equal(app.calls.length,1);assert.ok(Date.parse(app.calls[0][2].scheduled_at)>Date.now());
  assert.equal(app.routes[0][1].previewCamera,false);assert.equal(app.routes[0][1].openStudio,false);
});

test('invalid dates cannot create a stream', async () => {
  const app=quickStart({schedule:true});app.render();await app.h.settle();
  by(app.render(),'accessibilityLabel','Scheduled date').props.onChangeText('invalid');
  by(app.render(),'testID','live-preview-button').props.onPress();await app.h.settle();assert.equal(app.calls.length,0);
  assert.match(words(app.render()),/Choose a date/);
});

test('feed uses the same shared component for all five tabs', () => {
  assert.match(read('src/screens/feed/FeedScreen.tsx'), /<FeedNavigationTabs selected=\{feedMode\}/);
  const source=read('src/components/live/FeedNavigationTabs.tsx');
  assert.match(source, /fontSize: 15/);assert.match(source,/height: 3/);assert.match(source,/marginTop: 5/);
  const h=hooks();const ui=load('src/components/live/FeedNavigationTabs.tsx',{...common(h),'../../theme/useTheme':{useTheme:()=>({t:theme})},'./LiveIcon':{LiveIcon:'LiveIcon'}});
  let selected='';const tree=h.render(ui.FeedNavigationTabs,{selected:'latest',onSelect:v=>{selected=v;},onLive:()=>{selected='live';}});
  const tabs=nodes(tree).filter(n=>n.props?.accessibilityRole==='tab');assert.equal(tabs.length,5);
  for(const tab of tabs)assert.strictEqual(tab.props.style,tabs[0].props.style);
  by(tree,'testID','feed-tab-live').props.onPress();assert.equal(selected,'live');
  by(tree,'testID','feed-tab-discover').props.onPress();assert.equal(selected,'discover');
});
test('Go live is above optional studio tools and never called by the preview effect', () => {
  const source = read('src/components/LiveStudio.tsx');
  assert.ok(source.indexOf('testID="live-start-button"') < source.indexOf('Stream tools'));
  assert.match(source, /else \{ await instance.setLocalVideo\(true\); update\(\); \}/);
  const effect = source.slice(source.indexOf('if (autoPreview &&'), source.indexOf('const sendControl'));
  assert.match(effect, /void preview\(\)/); assert.doesNotMatch(effect, /sendControl|liveControl/);
});
test('directory keeps bounded fetching and preview keeps native media teardown', () => {
  const directory = read('src/screens/feed/LiveStreamsScreen.tsx'); assert.match(directory, /p_limit:24/); assert.match(directory, /slice\(-96\)/);
  const studio = read('src/components/LiveStudio.tsx'); assert.match(studio, /releaseLiveStageMedia/); assert.match(studio, /previous\.destroy\(\)/);
  const form = read('src/screens/feed/NewLiveScreen.tsx'); assert.match(form, /KeyboardAvoidingView/); assert.match(form, /Dismiss keyboard/);
});
test('all edited native files parse as TypeScript JSX', () => {
  for (const file of ['src/components/LiveUi.tsx','src/components/LiveStudio.tsx','src/screens/feed/NewLiveScreen.tsx','src/screens/feed/LiveStreamsScreen.tsx','src/screens/feed/LiveSessionScreen.tsx','src/screens/feed/FeedScreen.tsx']) {
    const parsed = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.deepEqual(parsed.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], file);
  }
});

test('Schedule entry never opens an unscheduled camera preview',async()=>{
  const app=quickStart({schedule:true});app.render();await app.h.settle();const tree=app.render();
  assert.ok(by(tree,'accessibilityLabel','Scheduled date'));assert.ok(by(tree,'accessibilityLabel','Scheduled time'));
  assert.equal(by(tree,'testID','live-preview-button').props.accessibilityLabel,'Schedule stream');
  by(tree,'testID','live-preview-button').props.onPress();await app.h.settle();assert.equal(app.calls.length,1);assert.equal(app.routes[0][1].previewCamera,false);
});

test('Live tools exposes clips without crowding the directory',()=>{
  const h=hooks(),ui=load('src/components/LiveUi.tsx',{...common(h),'./SafeArea':{SafeAreaView:'SafeAreaView'},'../theme/useTheme':{useTheme:()=>({t:theme})},'../../shared/liveDirectory':directory});
  let clips=0,schedules=0;const props={filter:'for_you',view:'live',topic:'all',query:'',onFilter(){},onView(){},onTopic(){},onQuery(){},onBack(){},onCreate(){},onClips(){clips++;},onSchedule(){schedules++;}};
  let tree=h.render(ui.LiveDirectoryHeader,props);by(tree,'accessibilityLabel','Schedule a live stream').props.onPress();assert.equal(schedules,1);
  by(tree,'accessibilityLabel','Your Live tools').props.onPress();tree=h.render(ui.LiveDirectoryHeader,props);
  assert.equal(nodes(tree).filter(n=>n.type==='Modal')[1].props.visible,true);by(tree,'accessibilityLabel','My clips').props.onPress();assert.equal(clips,1);
});
test('preview retains signed studio events and never unmutes automatically',()=>{
  const source=read('src/components/LiveStudio.tsx');assert.match(source,/useLiveStudioEvents\(sessionId, owner, onChanged\)/);
  const preview=source.slice(source.indexOf('const preview ='),source.indexOf('const sendControl'));
  assert.doesNotMatch(preview,/setLocalAudio\(true\)/);assert.doesNotMatch(preview,/liveControl\(/);
});

test('switching from Schedule to Live now discards the scheduled timestamp',async()=>{
 const app=quickStart({schedule:true});app.render();await app.h.settle();by(app.render(),'accessibilityLabel','Live now').props.onPress();
 assert.equal(by(app.render(),'accessibilityLabel','Scheduled date'),undefined);by(app.render(),'testID','live-preview-button').props.onPress();await app.h.settle();
 assert.equal(app.calls[0][2].scheduled_at,undefined);assert.equal(app.routes[0][1].previewCamera,true);
});
test('scheduling is usable when only immediate broadcasting is disabled',async()=>{
 const app=quickStart({schedule:true,caps:{create:true,broadcast:false,recording:false}});app.render();await app.h.settle();
 assert.equal(by(app.render(),'testID','live-preview-button').props.disabled,false);by(app.render(),'testID','live-preview-button').props.onPress();await app.h.settle();
 assert.equal(app.calls.length,1);assert.equal(app.calls[0][2].recording_enabled,false);assert.equal(app.routes[0][1].openStudio,false);
});
test('web studio stays mounted across watch tabs and immediate setup selects studio',()=>{
 const source=read('web/components/LiveSessionView.tsx');assert.match(source,/entry.get\('studio'\)/);assert.match(source,/<div hidden=\{tab!=='studio'\}><LiveStudio/);
 assert.match(read('web/app/live/new/page.tsx'),/studio=1&preview=1/);
 const studio=read('web/components/LiveStudio.tsx');assert.match(studio,/autoPreviewUsed/);assert.match(studio,/setLocalVideo\(true\)/);assert.doesNotMatch(studio,/setLocalAudio\(true\)/);
});
test('operations desk exposes disabled backend capability gates',()=>{
 const source=read('admin-web/components/LiveOperations.tsx');assert.match(source,/Live service readiness/);assert.match(source,/readiness.broadcast===false/);
});
