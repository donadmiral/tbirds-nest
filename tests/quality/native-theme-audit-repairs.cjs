const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = process.env.PLATINUM_THEME_SOURCE_ROOT || path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = (source, file, requireModule, globals = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, require: requireModule, ...globals }, { filename: file });
  return module.exports;
};
const light = compile(read('src/constants/tokens/light.ts'), 'light.ts').light;
const dark = compile(read('src/constants/tokens/dark.ts'), 'dark.ts').dark;
const lightsOut = compile(read('src/constants/tokens/lightsOut.ts'), 'lightsOut.ts', () => ({ dark })).lightsOut;
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
const textOf = node => Array.isArray(node) ? node.map(textOf).join('') : node && typeof node === 'object' ? textOf(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
function rgba(value) {
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('');
    assert.ok(hex.length === 6 || hex.length === 8, `Unsupported hex color ${value}`);
    const values = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    return values.concat(hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1);
  }
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value);
  assert.ok(match, `Unsupported color ${value}`);
  return match.slice(1, 4).map(Number).concat(match[4] == null ? 1 : Number(match[4]));
}
const blend = (fg, bg) => { const a = rgba(fg); return a.slice(0, 3).map((v, i) => v * a[3] + bg[i] * (1 - a[3])); };
const luma = rgb => rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
function contrast(fg, bg, canvas) { const back = blend(bg, rgba(canvas)), front = blend(fg, back), a = luma(front), b = luma(back); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }
function theme() {
  let mode = 'light', subscriptions = 0;
  const state = () => ({ mode, resolved: mode === 'light' ? 'light' : 'dark' });
  const store = select => { subscriptions++; return select(state()); }; store.getState = state;
  const api = compile(read('src/theme/useTheme.ts'), 'useTheme.ts', name => name === 'react' ? { useMemo: fn => fn() } : name === 'react-native' ? { StyleSheet: { create: v => v } } : name.endsWith('/light') ? { light } : name.endsWith('/dark') ? { dark } : name.endsWith('/lightsOut') ? { lightsOut } : { useThemeStore: store });
  return { ...api, set: value => { mode = value; }, get subscriptions() { return subscriptions; } };
}
function styles(file, api, name) {
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression; const constants = {};
  for (const statement of tree.statements) if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) {
    if (d.initializer && (ts.isStringLiteral(d.initializer) || ts.isNumericLiteral(d.initializer))) constants[d.name.getText(tree)] = ts.isNumericLiteral(d.initializer) ? Number(d.initializer.text) : d.initializer.text;
    if (d.initializer?.getText(tree).startsWith('themedSheet(') && (!name || d.name.getText(tree) === name)) expression = d.initializer.getText(tree);
  }
  assert.ok(expression, file);
  const tokens = Object.assign({}, ...['spacing','radius','typography'].map(name => compile(read('src/constants/tokens/' + name + '.ts'), name + '.ts')));
  return compile('export const value = ' + expression, file, () => ({}), { ...api, ...tokens, ...constants, StyleSheet: { hairlineWidth: .5, absoluteFillObject: {} }, Platform: { OS: 'ios' }, Dimensions: { get: () => ({ width: 390, height: 844 }) }, SCREEN_W: 390, SCREEN_H: 844, TILE_W: 177, HAIR: .5 }).value;
}
function component(file, api, options = {}) {
  let index = 0;
  const react = { useState: initial => { const key = index++; return [Object.hasOwn(options.states || {}, key) ? options.states[key] : typeof initial === 'function' ? initial() : initial, () => {}]; }, useRef: v => ({ current: v }), useCallback: fn => fn, useMemo: fn => fn(), useEffect: () => {} };
  const native = new Proxy({ StyleSheet: { create: v => v, hairlineWidth: .5 }, Platform: { OS: 'ios' }, Alert: { alert() {} } }, { get: (target, key) => target[key] || key });
  const render = compile(read(file), file, name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return runtime;
    if (name === 'react-native') return native;
    if (name.endsWith('/theme/useTheme')) return api;
    if (name === 'expo-application') return options.application || { nativeApplicationVersion: '1.1.0', nativeBuildVersion: '42' };
    if (name.endsWith('/components/SafeArea')) return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === '@react-navigation/native') return { useNavigation: () => ({ goBack() {} }), useRoute: () => ({ params: { businessId: 'business', businessName: 'Audit business' } }), useFocusEffect() {} };
    if (name.endsWith('/stores/authStore')) return { useAuthStore: () => ({ profile: { id: 'owner' } }) };
    if (name.endsWith('/shared/verification')) return { currentVerificationStatus: () => options.verificationStatus || null };
    if (name.endsWith('/services/supabase')) return { supabase: {} };
    if (name === '@expo/vector-icons') return { Feather: 'Icon' };
    if (name.endsWith('/skeletons')) return { ListRowSkeleton: 'Skeleton' };
    return { __esModule: true, default: name };
  }).default;
  return () => { index = 0; return render(); };
}
const prefix = 'src/screens/profile/';
const pairs = {
  AboutScreen: [['backChev','safe'],['backLbl','safe'],['headerTitle','safe'],['appName','safe'],['tagline','safe'],['versionTxt','versionPill'],['cardTitle','card'],['body','card'],['foot','safe']],
  ApplyVerificationScreen: [['backLbl','safe'],['headerTitle','safe'],['lede','safe'],['tierTxt','tierChip'],['tierTxtOn','tierChipOn'],['fieldLabel','safe'],['catTxt','catChip'],['catTxtOn','catChipOn'],['input','input'],['note','safe'],['submitTxt','submit'],['statusTier','statusCard'],['statusLine','statusCard'],['statusReason','statusCard'],['reapplyTxt','reapply']],
  BusinessInboxScreen: [['headerTitle','safe'],['headerSub','safe'],['name','safe'],['time','safe'],['preview','safe'],['previewUnread','safe'],['ctxTxt','ctxChip'],['avTxt','avFb'],['unreadTxt','unreadDot'],['errTxt','safe'],['emptyTitle','safe'],['emptySub','safe']],
  CampaignsScreen: [['headerTitle','safe'],['headerSub','safe'],['emptyTitle','safe'],['emptySub','safe'],['newBtnTxt','newBtn'],['cardTitle','card'],['window','card'],['metricNum','card'],['metricLbl','card'],['sheetTitle','sheet'],['pickTxt','sheet'],['noPosts','sheet'],['pickedExcerpt','pickedExcerpt'],['fieldLbl','sheet'],['input','sheet'],['durTxt','durChip'],['backTxt','sheet'],['goTxt','goBtn']],
};
const measurements = [];
for (const [screen, matrix] of Object.entries(pairs)) for (const mode of ['light','dark','lightsOut']) test(`${screen} actual style pairs remain readable in ${mode}`, () => {
  const api = theme(), sheet = styles(prefix + screen + '.tsx', api); api.set(mode); const canvas = api.getTheme().surface.canvas;
  for (const [fg, bg] of matrix) {
    const ratio = contrast(sheet[fg].color, sheet[bg].backgroundColor || canvas, canvas);
    measurements.push({ screen, mode, foregroundStyle: fg, backgroundStyle: bg, foreground: sheet[fg].color, background: sheet[bg].backgroundColor || canvas, ratio });
    assert.ok(Number.isFinite(ratio) && ratio >= 4.5, `${screen}.${fg} on ${bg} in ${mode}: ${ratio.toFixed(3)}:1`);
  }
});
for (const screen of Object.keys(pairs)) test(`${screen} actual render subscribes and follows light/dark/lightsOut/light status chrome`, () => {
  const api = theme(), render = component(prefix + screen + '.tsx', api);
  for (const mode of ['light','dark','lightsOut','light']) {
    api.set(mode); const before = api.subscriptions, tree = render(), bar = walk(tree).find(n => n.type === 'StatusBar');
    assert.equal(api.subscriptions, before + 1, 'screen must subscribe, not only read proxy properties');
    assert.equal(bar.props.barStyle, mode === 'light' ? 'dark-content' : 'light-content');
    assert.equal(bar.props.backgroundColor, api.getTheme().surface.canvas);
    assert.equal(flatten(tree.props.style).backgroundColor, api.getTheme().surface.canvas);
  }
});
for (const [version, build, expected] of [['1.1.0','42','Version 1.1.0 (42)'],['1.1.0',null,'Version 1.1.0'],[null,'42','Build 42'],[null,null,'Version unavailable']]) test(`About reports native metadata ${expected}`, () => {
  const tree = component(prefix + 'AboutScreen.tsx', theme(), { application: { nativeApplicationVersion: version, nativeBuildVersion: build } })();
  assert.ok(walk(tree).some(node => node.type === 'Text' && textOf(node) === expected));
  assert.equal(textOf(tree).includes('Version 1.0.0 (100)'), false);
});
test('Verification actual form input/placeholder and successful or rejected status remain readable', () => {
  for (const mode of ['light','dark','lightsOut']) {
    const api = theme(); api.set(mode);
    const form = component(prefix + 'ApplyVerificationScreen.tsx', api, { states: { 0: { account_type: 'personal' }, 2: null } })();
    const inputs = walk(form).filter(n => n.type === 'TextInput'); assert.ok(inputs.length >= 2);
    for (const input of inputs) { const style = flatten(input.props.style); assert.ok(contrast(input.props.placeholderTextColor, style.backgroundColor, api.getTheme().surface.canvas) >= 4.5); }
    for (const status of ['approved','rejected']) {
      const tree = component(prefix + 'ApplyVerificationScreen.tsx', api, { verificationStatus: status, states: { 0: { account_type: 'personal' }, 2: { tier: 'official' } } })();
      const node = walk(tree).find(n => n.type === 'Text' && textOf(n).startsWith(status === 'approved' ? 'Approved.' : 'Not approved'));
      assert.ok(node); assert.ok(contrast(flatten(node.props.style).color, api.getTheme().surface.raised, api.getTheme().surface.canvas) >= 4.5);
    }
  }
});
test('Business inbox actual selected/unselected tabs keep paired readable ink', () => {
  for (const mode of ['light','dark','lightsOut']) {
    const api = theme(); api.set(mode);
    const tree = component(prefix + 'BusinessInboxScreen.tsx', api, { states: { 0: [{ conversation_id: 'one', is_request: false }], 1: false } })();
    const list = walk(tree).find(n => n.type === 'FlatList'); assert.ok(list);
    const buttons = walk(list.props.ListHeaderComponent).filter(n => n.type === 'TouchableOpacity'); assert.equal(buttons.length, 2);
    for (const button of buttons) { const label = walk(button).find(n => n.type === 'Text'); assert.ok(contrast(label.props.style.color, button.props.style.backgroundColor, api.getTheme().surface.canvas) >= 4.5); }
  }
});
test('Campaign actual selected durations, input placeholders and busy spinner match their surfaces', () => {
  for (const mode of ['light','dark','lightsOut']) {
    const api = theme(); api.set(mode);
    const tree = component(prefix + 'CampaignsScreen.tsx', api, { states: { 2: false, 3: true, 5: { id: 'post', content: 'Audit post' }, 9: true } })();
    const sheet = styles(prefix + 'CampaignsScreen.tsx', api);
    for (const input of walk(tree).filter(n => n.type === 'TextInput')) assert.ok(contrast(input.props.placeholderTextColor, sheet.sheet.backgroundColor, api.getTheme().surface.canvas) >= 4.5);
    const duration = walk(tree).find(n => n.type === 'TouchableOpacity' && textOf(n) === '7 days'); assert.ok(duration);
    assert.ok(contrast(flatten(walk(duration).find(n => n.type === 'Text').props.style).color, flatten(duration.props.style).backgroundColor, api.getTheme().surface.canvas) >= 4.5);
    const spinner = walk(tree).find(n => n.type === 'ActivityIndicator'); assert.ok(spinner); assert.ok(contrast(spinner.props.color, sheet.goBtn.backgroundColor, api.getTheme().surface.canvas) >= 4.5);
  }
});
test('Campaign actual active, paused and ended labels retain readable status colors', () => {
  for (const mode of ['light','dark','lightsOut']) {
    const api = theme(); api.set(mode);
    const tree = component(prefix + 'CampaignsScreen.tsx', api, { states: { 0: [{ id: 'campaign' }], 2: false } })();
    const list = walk(tree).find(node => node.type === 'FlatList' && node.props.renderItem); assert.ok(list);
    for (const status of ['active','paused','ended']) {
      const row = list.props.renderItem({ item: { id: 'campaign', status } });
      const chip = walk(row).find(node => node.type === 'TouchableOpacity');
      const text = walk(chip).find(node => node.type === 'Text');
      assert.ok(contrast(flatten(text.props.style).color, flatten(chip.props.style).backgroundColor, api.getTheme().surface.canvas) >= 4.5);
    }
  }
});
test('RGBA and shorthand-hex audit composition is finite and handles alpha explicitly', () => {
  assert.deepEqual(rgba('#fff'), [255,255,255,1]); assert.deepEqual(rgba('#0008'), [0,0,0,136/255]);
  assert.ok(contrast('#000000FF','#fff','#fff') > 20); assert.equal(contrast('rgba(0,0,0,0)','#fff','#fff'),1);
});
const verifiedPairs = JSON.parse(fs.readFileSync(path.join(__dirname, 'native-theme-verified-pairs.json'), 'utf8')).pairs;
for (const file of [...new Set(verifiedPairs.map(pair => pair.file))]) test(`${file} inspected text pairs stay readable in all three palettes`, () => {
  const api = theme(), sheets = new Map();
  const sheetFor = name => { if (!sheets.has(name)) sheets.set(name, styles(file, api, name)); return sheets.get(name); };
  for (const mode of ['light','dark','lightsOut']) {
    api.set(mode); const canvas = api.getTheme().surface.canvas;
    for (const pair of verifiedPairs.filter(pair => pair.file === file)) {
      const sheet = sheetFor(pair.sheet);
      const fg = Object.assign({}, ...pair.foregroundStyles.map(key => sheet[key]));
      const bg = Object.assign({}, ...pair.backgroundStyles.map(key => sheet[key]));
      const ratio = contrast(fg.color, bg.backgroundColor || canvas, canvas);
      measurements.push({ file, mode, foregroundStyle: pair.foregroundStyles.join('+'), backgroundStyle: pair.backgroundStyles.join('+'), foreground: fg.color, background: bg.backgroundColor || canvas, ratio });
      assert.ok(Number.isFinite(ratio) && ratio >= pair.threshold, `${file}.${pair.foregroundStyles.join('+')} in ${mode}: ${ratio.toFixed(3)}:1`);
      if (pair.boundedMediaScrim) for (const underlying of ['#FFFFFF','#000000']) assert.ok(contrast(fg.color, bg.backgroundColor, underlying) >= 4.5, `${file} media scrim over ${underlying} must preserve readable text`);
    }
  }
});
for (const file of [...new Set(verifiedPairs.map(pair => pair.file))].filter(file => !file.includes('/auth/'))) test(`${file} subscribes to active theme and renders any status bar with current palette`, () => {
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && n.body?.statements.some(st => st.getText(tree).includes('useTheme()')));
  assert.ok(fn, 'palette-dependent component must subscribe to theme');
  const binding = fn.body.statements.find(st => st.getText(tree).includes('useTheme()')).getText(tree);
  const bars = []; const visit = n => { if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(tree) === 'StatusBar') bars.push(n.getText(tree)); ts.forEachChild(n, visit); }; visit(fn);
  const api = theme();
  const render = compile('export function render(){' + binding + ';return [' + bars.join(',') + '];}', file, () => runtime, { ...api, StatusBar: 'StatusBar' }).render;
  for (const mode of ['light','dark','lightsOut','light']) {
    api.set(mode); const before = api.subscriptions, actual = render(); assert.equal(api.subscriptions, before + 1);
    for (const bar of actual) assert.equal(bar.props.barStyle, file.endsWith('/CallScreen.tsx') ? 'light-content' : mode === 'light' ? 'dark-content' : 'light-content');
  }
});
test.after(() => {
  if (process.env.PLATINUM_THEME_ARTIFACTS) { fs.mkdirSync(process.env.PLATINUM_THEME_ARTIFACTS, { recursive: true }); fs.writeFileSync(path.join(process.env.PLATINUM_THEME_ARTIFACTS,'contrast-pairs.json'), JSON.stringify({ sourceRoot: root, scope: 'Actual palette/style factories and controlled component render hosts; no device-pixel acceptance.', measurements },null,2)+'\n'); }
});
