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
function common(h) { return { react: h.react, 'react-native': rn, '@expo/vector-icons': { Feather: 'Feather' }, './live/LiveIcon': load('src/components/live/LiveIcon.tsx', { react: h.react, 'react-native-svg': { __esModule: true, default: 'Svg', Path: 'Path', Rect: 'Rect' } }) }; }
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
test('Live uses one camera mark with internal lettering across native surfaces', () => {
  const h = hooks(), ui = load('src/components/LiveUi.tsx', { ...common(h), './SafeArea': { SafeAreaView: 'SafeAreaView' }, '../theme/useTheme': { useTheme: () => ({ t: theme }) }, '../../shared/liveDirectory': directory });
  const tree = h.render(ui.LiveIcon, { color: '#000' });
  assert.equal(tree.type, 'Svg'); assert.equal(tree.props.accessible, false); assert.ok(nodes(tree).some(node => node.type === 'Rect')); assert.equal(nodes(tree).filter(node => node.type === 'Path').length, 2); assert.equal(by(tree, 'name', 'radio'), undefined);
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

function clipDestinationPicker(results) {
  const h = hooks(), searches = [], publications = [];
  let changed = 0;
  const clip = { id: '11111111-1111-4111-8111-111111111111', session_id: '22222222-2222-4222-8222-222222222222', title: 'Recorded moment', state: 'ready', formats: ['vertical'], start_ms: 0, end_ms: 8000, caption: '' };
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const component = load('src/components/LiveClipActions.tsx', {
    react: h.react,
    'react-native': { View: 'View', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-clipboard': {}, 'expo-media-library': {}, 'expo-sharing': {}, 'expo-video': {},
    '../../shared/liveDirectory': directory,
    '../theme/useTheme': { useTheme: () => ({ t: theme }) },
    '../contexts/LivePlaybackContext': {},
    '../services/liveClipService': { nativeClipCommand: async (...args) => { publications.push(args); return { ok: true, post_id: 'created-post' }; } },
    '../services/devicePermissions': {},
    '../services/liveService': {
      liveObject: object, liveRows: (value, limit) => Array.isArray(value) ? value.filter(object).slice(0, limit) : [],
      liveText: (value, limit = 2000) => typeof value === 'string' ? value.slice(0, limit) : '', liveRequestId: () => 'stable-publication-request',
      liveRpc: async (name, args) => { assert.equal(name, 'live_clip_get'); assert.equal(args.p_clip_id, clip.id); return { clip, permissions: { can_manage: true, can_publish: true }, publication_history: { items: [] } }; },
    },
    '../services/supabase': { supabase: { rpc: async (name, args) => { searches.push({ name, args }); return { data: results, error: null }; } } },
    '../utils/profileRead': { profileRead: value => value },
    '../services/liveWebHandoff': {},
  }).LiveClipActions;
  const render = () => h.render(component, { clip, onChanged: () => changed++, onClose() {} });
  const button = (tree, label) => nodes(tree).find(node => node.type === 'TouchableOpacity' && words(node) === label);
  return { h, render, button, searches, publications, changed: () => changed };
}

test('native clip channel search retains authorized collaborators and publishes to the selected channel', async () => {
  const id = number => `33333333-3333-4333-8333-${String(number).padStart(12, '0')}`;
  const results = [
    { id: id(1), name: 'Owned channel', my_role: 'owner' },
    { id: id(2), name: 'Collaborating channel', my_role: 'collaborator' },
    { id: id(3), name: 'Admin channel', my_role: 'admin' },
    { id: id(4), name: 'Moderated channel', my_role: 'moderator' },
    { id: id(5), name: 'Member channel', my_role: 'member' },
    { id: id(6), name: 'Unknown role channel', my_role: 'unexpected' },
    { id: id(7), name: 'No role channel', my_role: null },
    { id: 'invalid-id', name: 'Invalid channel identity', my_role: 'collaborator' },
  ];
  const app = clipDestinationPicker(results);
  app.render(); await app.h.settle(); app.button(app.render(), 'Channel').props.onPress();
  app.render(); await app.h.settle();
  by(app.render(), 'accessibilityLabel', 'Search channel name').props.onChangeText('  Design  ');
  app.button(app.render(), 'Search destinations').props.onPress(); await app.h.settle();
  let tree = app.render();
  assert.equal(app.searches.length, 1); assert.equal(app.searches[0].name, 'get_channels_page');
  assert.equal(app.searches[0].args.p_query, 'Design'); assert.equal(app.searches[0].args.p_limit, 20); assert.equal(app.searches[0].args.p_offset, 0);
  assert.ok(Number.isFinite(Date.parse(app.searches[0].args.p_as_of)));
  assert.ok(app.button(tree, 'Owned channel')); assert.ok(app.button(tree, 'Collaborating channel'));
  for (const label of ['Admin channel', 'Moderated channel', 'Member channel', 'Unknown role channel', 'No role channel', 'Invalid channel identity']) assert.equal(app.button(tree, label), undefined, label);
  assert.equal(app.button(tree, 'Publish clip').props.disabled, true);
  app.button(tree, 'Collaborating channel').props.onPress(); tree = app.render();
  assert.equal(app.button(tree, 'Publish clip').props.disabled, false);
  app.button(tree, 'Publish clip').props.onPress(); await app.h.settle();
  assert.equal(app.publications.length, 1); assert.equal(app.publications[0][2], 'publish');
  assert.equal(app.publications[0][3].destination, 'channel'); assert.equal(app.publications[0][3].target_id, id(2));
  assert.equal(app.publications[0][3].format, 'vertical'); assert.equal(app.changed(), 1);
});

test('native clip community search continues to require membership independently of channel roles', async () => {
  const memberId = '44444444-4444-4444-8444-444444444444';
  const app = clipDestinationPicker([
    { id: memberId, name: 'Joined community', is_member: true, my_role: 'member' },
    { id: '55555555-5555-4555-8555-555555555555', name: 'Unjoined community', is_member: false, my_role: 'owner' },
    { id: 'invalid-id', name: 'Invalid community identity', is_member: true },
  ]);
  app.render(); await app.h.settle(); app.button(app.render(), 'Community').props.onPress();
  app.render(); await app.h.settle();
  by(app.render(), 'accessibilityLabel', 'Search community name').props.onChangeText('Community');
  app.button(app.render(), 'Search destinations').props.onPress(); await app.h.settle();
  const tree = app.render(); assert.equal(app.searches[0].name, 'get_communities_page');
  assert.ok(app.button(tree, 'Joined community')); assert.equal(app.button(tree, 'Unjoined community'), undefined); assert.equal(app.button(tree, 'Invalid community identity'), undefined);
  app.button(tree, 'Joined community').props.onPress(); app.button(app.render(), 'Publish clip').props.onPress(); await app.h.settle();
  assert.equal(app.publications[0][3].destination, 'community'); assert.equal(app.publications[0][3].target_id, memberId);
});
