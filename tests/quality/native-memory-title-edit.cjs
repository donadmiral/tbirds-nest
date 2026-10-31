const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const YAML = require('yaml');

function inputAndSave() {
  const file = 'src/screens/profile/MemoryAlbumScreen.tsx';
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let input, save;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'TextInput'
      && node.attributes.properties.some(property => property.name?.getText(ast) === 'accessibilityLabel' && property.initializer?.text === 'Book title')) input = node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'saveSettings') save = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(input); assert.ok(save);
  const mutations = [], module = { exports: {} };
  const scope = { module, exports: module.exports, require: () => ({ jsx: (type, props) => ({ type, props }) }),
    TextInput: 'TextInput', title: 'THE SMALL ADVENTURES', setTitle: value => { scope.title = value; },
    t: { ink: { muted: '#777' } }, isDark: false, st: { input: {} }, bookId: 'book', album: { is_owner: true },
    saveLock: { current: false }, bookGeneration: { current: 1 }, viewerRef: { current: 'owner' }, ownerId: 'owner',
    presentationRevision: 0, aud: 'private', subtitle: '', color: 'sage', design: 'postcard', coverStoryId: null,
    coverArtwork: {}, filmSettings: {}, supabase: {}, setSettingsBusy() {}, setMutationError() {}, setSettings() {},
    saveMemoryCreativeBook: async (_client, payload) => { mutations.push(payload); }, load: async () => {}, memoryCreativeSaveError: error => String(error) };
  const compiled = ts.transpileModule(`export const input = () => (${input}); export const save = ${save};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, scope);
  return { ...module.exports, mutations };
}

test('the actual controlled title input and save callback reproduce the observed suffix after a mid-string backspace edit', async () => {
  const h = inputAndSave();
  const initial = h.input(); assert.equal(initial.props.value, 'THE SMALL ADVENTURES');
  assert.equal(initial.props.maxLength, 30); assert.equal(initial.props.onBlur, undefined);
  // Pinned Maestro eraseText sends Backspace at the current selection; it
  // does not move the caret. This controlled caret position reproduces the
  // exact retained suffix, without claiming the failed run saved its caret.
  const suffix = initial.props.value.slice(initial.props.value.indexOf('ENTURES'));
  initial.props.onChangeText(suffix);
  assert.equal(h.input().props.value, 'ENTURES');
  h.input().props.onChangeText('THE LONG WAY HOME' + suffix);
  await h.save(); assert.equal(h.mutations[0].draft.title, 'THE LONG WAY HOMEENTURES');
});

test('the actual title state and creative save preserve an explicitly selected full replacement', async () => {
  const h = inputAndSave(); h.input().props.onChangeText('');
  assert.equal(h.input().props.value, '');
  h.input().props.onChangeText('THE LONG WAY HOME');
  assert.equal(h.input().props.value, 'THE LONG WAY HOME');
  await h.save(); assert.equal(h.mutations.length, 1); assert.equal(h.mutations[0].draft.title, 'THE LONG WAY HOME');
  assert.equal(h.mutations[0].ownerId, 'owner'); assert.equal(h.mutations[0].revision, 0);
});

for (const [file, title] of [['tests/native/flows/memory-navigation.yaml', 'THE LONG WAY HOME'],
  ['tests/native/audit/flows/memory-cover-settings.yaml', 'AUDIT BOOK TITLE']]) {
  test(file + ' requires semantic Select All and an exact field-value readback before any save', () => {
    const commands = YAML.parseAllDocuments(fs.readFileSync(file, 'utf8'))[1].toJSON();
    const start = commands.findIndex(command => command.longPressOn === 'Book title'); assert.ok(start >= 0);
    assert.deepEqual(commands.slice(start, start + 5), [
      { longPressOn: 'Book title' }, { tapOn: 'Select [Aa]ll' }, { eraseText: 1 }, { inputText: title }, { copyTextFrom: 'Book title' },
    ]);
    const condition = commands[start + 5].assertTrue;
    assert.equal(typeof condition, 'string');
    const expression = condition.slice(2, -1);
    assert.equal(vm.runInNewContext(expression, { maestro: { copiedText: title } }), true);
    assert.equal(vm.runInNewContext(expression, { maestro: { copiedText: title + 'ENTURES' } }), false);
    assert.equal(vm.runInNewContext(expression, { maestro: { copiedText: 'Book title' } }), false);
    assert.ok(commands.findIndex(command => command.tapOn === 'Save memory book') > start + 5);
    assert.ok(commands.some(command => typeof command.assertVisible === 'string' && command.assertVisible.includes('book cover: ' + title)));
  });
}
