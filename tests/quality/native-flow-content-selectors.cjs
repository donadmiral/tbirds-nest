const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parse = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findAll(node, predicate) {
  const found = [];
  function visit(value) { if (predicate(value)) found.push(value); ts.forEachChild(value, visit); }
  visit(node); return found;
}
function variable(file, name) {
  const parsed = parse(file);
  const matches = findAll(parsed, node => ts.isVariableDeclaration(node) && node.name.getText(parsed) === name);
  assert.equal(matches.length, 1, 'Actual source variable must be unambiguous: ' + name);
  return matches[0].initializer.getText(parsed);
}
const jsx = (type, props) => ({ type, props });
function evaluate(expression, values = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule('module.exports = (' + expression + ');', {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { ...values, module, exports: module.exports, require: name => {
    assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx };
  } });
  return module.exports;
}

// Read the real synthetic account/content values without opening a provider connection.
const fixtureFile = 'tests/native/backend-fixture.cjs';
const fixtureContext = Object.fromEntries(['OWNER', 'PEER', 'SECOND', 'CONVERSATION', 'created'].map(name => [name, evaluate(variable(fixtureFile, name))]));
fixtureContext.makeProfile = evaluate(variable(fixtureFile, 'makeProfile'), fixtureContext);
fixtureContext.profiles = evaluate(variable(fixtureFile, 'profiles'), fixtureContext);
function fixtureRow(table) {
  const parsed = parse(fixtureFile);
  const rows = findAll(parsed, node => ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'rows')[0].initializer;
  const field = rows.properties.find(property => property.name.getText(parsed) === table);
  return evaluate(field.initializer.getText(parsed), fixtureContext)[0];
}

const hosts = Object.fromEntries(['TouchableOpacity', 'View', 'Text', 'ExpoImage', 'Feather', 'Ionicons',
  'VerifiedBadge', 'Swipeable', 'Image', 'TierName'].map(name => [name, name]));
const context = { ...hosts, s: new Proxy({}, { get: () => ({}) }),
  t: { surface: { raised: '#fff' }, ink: { primary: '#111', muted: '#777' }, status: { danger: '#f00' } },
  savedIds: new Set(), savingIds: new Set(), appliedMap: {}, busyMap: {}, posterLogos: {},
  profile: fixtureContext.profiles[0], userId: fixtureContext.OWNER, computeMatchScore: () => 0,
  STATUS_META: {}, categoryLabel: value => value, formatTime: () => '302d', cardWidth: 178, priceLabel: () => '$12',
  useDraftStore: { getState: () => ({ drafts: {} }) }, storyRings: {}, typingConvIds: new Set(),
  mentionTimes: {}, openedTimes: {}, avatarColor: () => '#111', initials: () => 'JE', relTime: () => '302d',
};
function render(file, name, item) { return evaluate(variable(file, name), context)({ item }); }
const glyphs = JSON.parse(read('node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json'));

// Project the installed iOS Fabric recursive label contract: explicit labels win,
// otherwise native descendant labels are joined with ', '. This is source-level
// inference for unreached screens, not a claim of a new native runtime snapshot.
function label(node, text = false) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(child => label(child, text)).filter(Boolean).join(text ? '' : ', ');
  if (typeof node !== 'object') return String(node);
  if (node.props.accessibilityLabel != null) return node.props.accessibilityLabel;
  if (node.type === 'TierName') return node.props.text;
  if (node.type === 'Feather') return String.fromCodePoint(glyphs[node.props.name]);
  return label(node.props.children, node.type === 'Text' || text);
}
const commands = YAML.parseAllDocuments(read('tests/native/flows/navigation.yaml'))[1].toJSON();
function waitSelector(id) {
  const index = commands.findIndex(command => command.tapOn?.id === id);
  assert.ok(index >= 0);
  const wait = commands[index + 1].extendedWaitUntil;
  assert.equal(wait.timeout, 15000); assert.equal(typeof wait.visible, 'string');
  return wait.visible;
}
function matcher(pattern) {
  // Maestro uses Java regex full-string matching. Its inline DOTALL flag is
  // represented by the equivalent JS flag for these selector contract checks.
  return new RegExp('^(?:' + pattern.replace(/^\(\?s\)/, '') + ')$', 's');
}

test('Market waits for the actual card label retained in the iPhone accessibility tree', () => {
  const item = fixtureRow('marketplace_listings');
  const card = render('src/screens/market/MarketScreen.tsx', 'renderItem', item);
  const pattern = waitSelector('main-tab-market');
  assert.equal(pattern, card.props.accessibilityLabel, 'the exact production label is the assertion');
  const observed = JSON.parse(read('docs/quality/native-full-app-20261031/ios-ab281bca/market-ax.json'));
  function values(value) {
    if (Array.isArray(value)) return value.flatMap(values);
    if (!value || typeof value !== 'object') return [];
    return [value.accessibilityText, ...Object.values(value).flatMap(values)].filter(Boolean);
  }
  assert.ok(values(observed).some(value => value === pattern), 'the selector must match actual retained iPhone AX');
  assert.ok(matcher(pattern).test(label(card)));
  assert.equal(matcher(pattern).test(label(render('src/screens/market/MarketScreen.tsx', 'renderItem', { ...item, title: 'Different journal' }))), false);
});

test('Jobs requires the exact title alone or the actual grouped title and company', () => {
  const item = fixtureRow('jobs'), matches = matcher(waitSelector('main-tab-jobs'));
  const card = render('src/screens/jobs/JobsScreen.tsx', 'renderJob', item);
  assert.equal(card.props.accessibilityLabel, undefined, 'this card uses native descendant grouping');
  assert.ok(matches.test(item.title), 'Android can expose the standalone title');
  assert.ok(matches.test(label(card)), 'the inferred iOS group retains both expected title and company');
  assert.equal(matches.test(label(render('src/screens/jobs/JobsScreen.tsx', 'renderJob', { ...item, company: 'Wrong company' }))), false);
  assert.equal(matches.test(label(render('src/screens/jobs/JobsScreen.tsx', 'renderJob', { ...item, title: item.title + ' intern' }))), false);
  assert.equal(matches.test('Not ' + item.title), false);
});

test('Messages preserves the exact peer and literal preview in grouped rows and repeated returns', () => {
  const item = { ...fixtureRow('conversations'), other_name: fixtureContext.profiles[1].full_name,
    other_user_id: fixtureContext.PEER, unread_count: 1 };
  const pattern = waitSelector('main-tab-messages'), matches = matcher(pattern);
  const row = render('src/screens/messages/ConversationsScreen.tsx', 'renderItem', item);
  assert.ok(matches.test(item.last_message), 'the question mark is literal in the standalone preview');
  assert.ok(matches.test(label(row)), 'the grouped peer and preview remain required together');
  assert.equal(matches.test(item.last_message.slice(0, -1)), false, 'omitting the literal question mark must fail');
  assert.equal(matches.test(label(render('src/screens/messages/ConversationsScreen.tsx', 'renderItem', { ...item, other_name: 'Wrong person' }))), false);
  assert.equal(matches.test(label(render('src/screens/messages/ConversationsScreen.tsx', 'renderItem', { ...item, last_message: 'Different conversation preview' }))), false);
  const repeat = commands.find(command => command.repeat).repeat;
  assert.equal(repeat.times, 3); assert.equal(repeat.commands[1].assertVisible, pattern);
});

test('Edit profile accepts its actual icon-plus-label group while standalone profile and settings checks remain exact', () => {
  const parsed = parse('src/components/ProfileHeader.tsx');
  const nodes = findAll(parsed, node => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(parsed) === 'TouchableOpacity'
    && findAll(node, child => ts.isJsxText(child) && child.getText(parsed).trim() === 'Edit profile').length > 0);
  assert.equal(nodes.length, 1);
  const button = evaluate(nodes[0].getText(parsed), { ...context, onEdit() {} });
  const pattern = commands.find(command => typeof command.assertVisible === 'string' && command.assertVisible.includes('Edit profile')).assertVisible;
  assert.ok(matcher(pattern).test('Edit profile'));
  assert.ok(matcher(pattern).test(label(button)), 'installed Feather glyph precedes the unchanged label');
  assert.equal(matcher(pattern).test('Edit profile picture'), false);
  assert.equal(waitSelector('main-tab-profile'), fixtureContext.profiles[0].full_name);
  const settings = commands.findIndex(command => command.tapOn === 'Settings');
  assert.equal(commands[settings + 1].extendedWaitUntil.visible, 'Settings');
  assert.equal(commands[settings + 1].extendedWaitUntil.timeout, 15000);
});
