const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const evidence = 'docs/quality/native-full-app-20261031/native-audit-social-flow-followup';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const baseline = process.env.PLATINUM_SOCIAL_FLOW_BASELINE === '1';
const manifest = JSON.parse(read(baseline ? `${evidence}/before/manifest.json` : 'tests/native/audit/manifest.json'));
const flow = id => YAML.parseAllDocuments(read(baseline ? `${evidence}/before/${id}.yaml.txt`
  : `tests/native/audit/flows/${id}.yaml`)).map(doc => doc.toJSON());
const parse = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node, predicate) {
  const nodes = [];
  const visit = child => { if (predicate(child)) nodes.push(child); ts.forEachChild(child, visit); };
  visit(node); assert.equal(nodes.length, 1, 'actual source expression must be unambiguous'); return nodes[0];
}
function actualFunction(file, name) {
  const source = parse(file);
  return find(source, node => ts.isFunctionDeclaration(node) && node.name?.getText(source) === name).getText(source);
}
function conditional(file, condition, trueText) {
  const source = parse(file);
  return find(source, node => ts.isConditionalExpression(node)
    && node.condition.getText(source).replaceAll(' ', '') === condition.replaceAll(' ', '')
    && node.whenTrue.getText(source).includes(trueText)).getText(source);
}
const host = (type, props) => ({ type, props });
const styles = new Proxy({}, { get: () => ({}) });
const base = { View: 'View', Text: 'Text', Feather: 'Feather', ScrollView: 'ScrollView',
  RefreshControl: 'RefreshControl', TouchableOpacity: 'TouchableOpacity', s: styles, st: styles,
  getTheme: () => ({ ink: { faint: '#777' } }), NAVY: '#0b1e3d', refreshing: false,
  onRefresh() {}, markAllRead() {} };
function execute(expression, context = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(`module.exports = (${expression});`, {
    fileName: 'actual-render-expression.tsx',
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { ...base, ...context, module, exports: module.exports, require(name) {
    assert.equal(name, 'react/jsx-runtime'); return { jsx: host, jsxs: host };
  } });
  return module.exports;
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node !== 'object') return String(node);
  return text(node.props.children);
}
function labels(value) {
  if (Array.isArray(value)) return value.flatMap(labels);
  if (!value || typeof value !== 'object') return [];
  return [...['text', 'hintText', 'accessibilityText'].map(key => value.attributes?.[key]).filter(Boolean),
    ...Object.entries(value).filter(([key]) => key !== 'attributes').flatMap(([, child]) => labels(child))];
}

test('Trend entry uses the actual normalized header and requires a resolved empty result instead of accepting the error header', () => {
  const id = 'feed-trendfeed', item = manifest.cases.find(row => row.id === id);
  const source = 'src/screens/feed/TrendFeedScreen.tsx';
  const tag = execute(actualFunction(source, 'cleanTag'))(item.state.routes[0].params.tag);
  assert.equal(tag, '#memories');
  const observed = labels(JSON.parse(read(`${evidence}/observed/${id}.ax.json`)));
  assert.ok(observed.includes(tag));
  assert.ok(observed.includes('Could not load posts for this topic.'));
  assert.equal(observed.includes('No posts found'), false, 'unknown fixture errors must not satisfy the new result check');
  const rows = flow(id)[1];
  const header = rows.find(row => row.extendedWaitUntil)?.extendedWaitUntil;
  assert.equal(header.visible, tag); assert.equal(header.timeout, 15000);
  const loaded = rows.find(row => row.extendedWaitUntil?.visible === 'No posts found')?.extendedWaitUntil;
  assert.ok(loaded); assert.equal(loaded.timeout, 15000);
  const actualEmpty = execute(conditional(source, 'posts.length === 0', 'No posts found'), { posts: [], tag });
  assert.ok(text(actualEmpty).includes('No posts found'));
  const description = `No one has posted with ${tag} yet.`;
  assert.ok(text(actualEmpty).includes(description));
  assert.ok(rows.some(row => row.assertVisible === description));
  assert.equal(item.expected, tag);
});

test('empty activity requires the actual empty state and absence of an unread-only action, without claiming a positive mark-read test', () => {
  const id = 'notifications-empty-controls', item = manifest.cases.find(row => row.id === id);
  const source = 'src/screens/notifications/NotificationsScreen.tsx';
  const parsed = parse(source);
  const unread = find(parsed, node => ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'unreadTotal');
  const count = rows => execute(unread.initializer.getText(parsed), { rows });
  const header = conditional(source, 'unreadTotal > 0', 'Mark all read');
  assert.equal(count([]), 0);
  assert.equal(execute(header, { unreadTotal: count([]) }), null);
  assert.equal(text(execute(header, { unreadTotal: count([{ unread_in_group: 1 }]) })), 'Mark all read');
  const body = conditional(source, 'error && rows.length === 0', 'Could not load your activity');
  assert.ok(text(execute(body, { error: null, rows: [] })).includes('Nothing yet'));
  const failure = text(execute(body, { error: 'No synthetic contract', rows: [] }));
  assert.ok(failure.includes('Could not load your activity')); assert.equal(failure.includes('Nothing yet'), false);
  const [config, rows] = flow(id);
  assert.equal(config.name, 'Audit empty notifications'); assert.equal(item.name, config.name);
  assert.equal(rows.filter(row => row.assertVisible === 'Nothing yet').length, 2);
  assert.ok(rows.some(row => row.assertNotVisible === 'Mark all read'));
  assert.equal(rows.some(row => row.tapOn === 'Mark all read'), false);
  assert.match(item.coverage, /Positive Mark all read remains untested/);
  assert.equal(rows.find(row => row.extendedWaitUntil)?.extendedWaitUntil.timeout, 15000);
});
