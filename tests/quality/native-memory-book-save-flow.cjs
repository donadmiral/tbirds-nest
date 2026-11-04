const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const evidence = 'docs/quality/full-platform-audit-20261031/memory-book-save-test-repair';
const old = process.env.PLATINUM_MEMORY_SAVE_FLOW_BEFORE === '1';
const flows = [
  ['audit', 'tests/native/audit/flows/memory-cover-settings.yaml', 'memory-cover-settings.yaml.txt', 'AUDIT BOOK TITLE', 1],
  ['full', 'tests/native/flows/memory-navigation.yaml', 'memory-navigation.yaml.txt', 'THE LONG WAY HOME', 3],
];
function commands(file, platform) {
  const flatten = rows => rows.flatMap(row => row.runFlow?.commands
    ? (!row.runFlow.when?.platform || row.runFlow.when.platform === platform ? flatten(row.runFlow.commands) : []) : [row]);
  return flatten(YAML.parseAllDocuments(read(file))[1].toJSON());
}
const tap = row => typeof row?.tapOn === 'string' ? row.tapOn : row?.tapOn?.text;
function find(rows, predicate, after = -1) {
  const result = rows.findIndex((row, index) => index > after && predicate(row));
  assert.ok(result > after, 'required ordered command exists'); return result;
}
function nodes(source, predicate) {
  const result = []; const visit = node => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); };
  visit(source); return result;
}
const sourceText = read('src/screens/profile/MemoryAlbumScreen.tsx');
const source = ts.createSourceFile('MemoryAlbumScreen.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test('retained d46 failure entered the exact title then lost Save after Android hideKeyboard without a save request', () => {
  const folder = 'tests/fixtures/memory-save-d46-failure';
  const observed = JSON.parse(read(`${folder}/commands.json`));
  const title = observed.find(row => row.command.inputTextCommand?.text === 'AUDIT BOOK TITLE');
  assert.equal(title.metadata.status, 'COMPLETED');
  const hide = observed.find(row => row.metadata.sequenceNumber > title.metadata.sequenceNumber && row.command.hideKeyboardCommand);
  assert.equal(hide.metadata.status, 'COMPLETED');
  const failure = observed.find(row => row.command.scrollUntilVisible?.selector?.textRegex === 'Save memory book');
  assert.equal(failure.metadata.status, 'FAILED');
  assert.ok(hide.metadata.sequenceNumber < failure.metadata.sequenceNumber);
  assert.equal(observed.some(row => row.command.tapOnElement?.selector?.textRegex === 'Save memory book'), false);
  const receipt = JSON.parse(read(`${folder}/fixture-receipt.json`));
  assert.equal(receipt.requests.some(row => row.path.includes('save_memory_book_creative_presentation')), false);
});

test('actual Paper tint is a harmless text child inside the handled-taps settings ScrollView', () => {
  const heading = nodes(source, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Text'
    && node.children.some(child => ts.isJsxText(child) && child.text.trim() === 'Paper tint'));
  assert.equal(heading.length, 1);
  assert.equal(heading[0].openingElement.attributes.properties.some(prop => prop.name?.getText(source) === 'onPress'), false);
  let parent = heading[0].parent;
  while (parent && !(ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === 'ScrollView')) parent = parent.parent;
  assert.ok(parent);
  const values = Object.fromEntries(parent.openingElement.attributes.properties.filter(ts.isJsxAttribute)
    .map(prop => [prop.name.getText(source), prop.initializer && ts.isStringLiteral(prop.initializer) ? prop.initializer.text : null]));
  assert.equal(values.keyboardShouldPersistTaps, 'handled'); assert.equal(values.keyboardDismissMode, 'on-drag');
});

test('the inscription has a harmless Writing style heading in the same scroll content and only the postmark is single-line', () => {
  const creative = ts.createSourceFile('MemoryCreativeControls.tsx', read('src/components/memory/MemoryCreativeControls.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const attributes = node => Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute)
    .map(prop => [prop.name.getText(creative), prop.initializer?.getText(creative) ?? true]));
  const inputs = nodes(creative, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(creative) === 'TextInput');
  const inscription = inputs.find(node => attributes(node).testID === '"memory-cover-inscription"');
  const postmark = inputs.find(node => attributes(node).testID === '"memory-cover-postmark"');
  assert.ok(inscription); assert.ok(postmark);
  assert.equal(attributes(inscription).multiline, true);
  for (const property of ['multiline', 'submitBehavior', 'blurOnSubmit', 'onSubmitEditing']) {
    assert.equal(attributes(postmark)[property], undefined, 'the postmark preserves the installed single-line Return behavior');
  }
  const choices = nodes(creative, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(creative) === 'Choices'
    && attributes(node).label === '"Writing style"');
  assert.equal(choices.length, 1);
  const heading = nodes(creative, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(creative) === 'Text'
    && node.children.some(child => ts.isJsxExpression(child) && child.expression?.getText(creative) === 'label'));
  assert.equal(heading.length, 2, 'Choices and Toggle each render a label');
  const choiceHeading = heading.find(node => {
    let parent = node.parent;
    while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent;
    return parent?.name?.text === 'Choices';
  });
  assert.ok(choiceHeading);
  assert.equal(choiceHeading.openingElement.attributes.properties.some(prop => prop.name?.getText(creative) === 'onPress'), false);
  const control = nodes(source, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'MemoryCoverControls');
  assert.equal(control.length, 1);
  let parent = control[0].parent;
  while (parent && !(ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === 'ScrollView')) parent = parent.parent;
  assert.ok(parent);
  assert.equal(parent.openingElement.attributes.properties.find(prop => prop.name?.getText(source) === 'keyboardShouldPersistTaps')?.initializer?.text, 'handled');
});

test('installed RN handled-tap responder blurs the input without invoking the actual modal Back dismissal', () => {
  const rn = read('node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js');
  const input = {}, heading = {}; let focused = input, settings = true;
  const host = { props: { keyboardShouldPersistTaps: 'handled' }, _keyboardIsDismissible: () => true,
    _observedScrollSinceBecomingResponder: false, _becameResponderWhileAnimating: false };
  const scope = { host, __DEV__: false, TextInputState: { currentlyFocusedInput: () => focused, blurTextInput: value => { assert.equal(value, input); focused = null; } } };
  function actualHandler(name) {
    const start = rn.indexOf(`  ${name}:`); assert.ok(start >= 0);
    const expressionStart = rn.indexOf(' = (', start) + 3;
    const end = rn.indexOf('\n  };', expressionStart) + 4;
    const expression = rn.slice(expressionStart, end);
    const script = ts.transpileModule(`result = (function () { return (${expression}); }).call(host);`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const context = { ...scope }; vm.runInNewContext(script, context); return context.result;
  }
  assert.equal(actualHandler('_handleStartShouldSetResponder')({ target: heading }), true);
  actualHandler('_handleResponderRelease')({ target: heading, nativeEvent: { touches: [] } });
  assert.equal(focused, null); assert.equal(settings, true);
  const modal = nodes(source, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Modal'
    && node.openingElement.attributes.properties.some(prop => prop.name?.getText(source) === 'visible' && prop.initializer?.getText(source) === '{settings}'))[0];
  const close = modal.openingElement.attributes.properties.find(prop => prop.name?.getText(source) === 'onRequestClose').initializer.expression.getText(source);
  const context = { saveLock: { current: false }, setSettings: value => { settings = value; } };
  vm.runInNewContext(ts.transpileModule(`handler = (${close});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.handler(); assert.equal(settings, false, 'Back is a real modal-close action and must not be used for keyboard dismissal');
});

for (const [label, current, before, title, dismissals] of flows) {
  for (const platform of ['Android', 'iOS']) {
    test(`${label} ${platform}: exact edit, harmless keyboard exit, one Save, and persisted title after reopening are mandatory`, () => {
      const rows = commands(old ? `${evidence}/before/${before}` : current, platform);
      const open = find(rows, row => tap(row) === 'Edit memory book');
      const save = find(rows, row => tap(row) === 'Save memory book', open);
      const inside = rows.slice(open + 1, save);
      assert.equal(inside.includes('hideKeyboard'), false, 'never send Android Back while the settings modal is open');
      assert.equal(inside.some(row => row === 'back' || row.pressKey === 'BACK'), false);
      const iosAudit = label === 'audit' && platform === 'iOS';
      assert.equal(inside.filter(row => tap(row) === 'Paper tint').length, iosAudit ? 0 : dismissals);
      if (iosAudit) {
        const returned = find(rows, row => row.pressKey === 'Enter', open);
        const afterBlur = find(rows, row => row.copyTextFrom === 'Book title', returned);
        assert.equal(rows[afterBlur + 1].assertTrue, '${maestro.copiedText === "' + title + '"}');
        assert.ok(afterBlur < save, 'the real title must still match after keyboard dismissal');
      }
      assert.ok(inside.some(row => row.assertVisible === 'Save memory book'));
      const select = find(rows, row => tap(row) === 'Select [Aa]ll', open);
      const erase = find(rows, row => row.eraseText === 1, select);
      const type = find(rows, row => row.inputText === title, erase);
      const copied = find(rows, row => row.copyTextFrom === 'Book title', type);
      assert.equal(rows[copied + 1].assertTrue, '${maestro.copiedText === "' + title + '"}');
      if (label === 'full' && platform === 'iOS') {
        const returned = find(rows, row => row.pressKey === 'Enter', copied + 1);
        const firstScroll = find(rows, row => row.scrollUntilVisible?.element === 'Paper tint', copied + 1);
        assert.ok(returned < firstScroll, 'dismiss the single-line title keyboard before scrolling the reduced sheet');
        assert.equal(rows[returned + 1].assertVisible, 'Book settings', 'Return must preserve the settings modal');
        const inscription = find(rows, row => row.inputText === 'Roads worth remembering', firstScroll);
        const inscriptionScroll = find(rows, row => row.scrollUntilVisible?.element === 'Paper tint', inscription);
        assert.deepEqual(rows.slice(inscription + 1, inscriptionScroll), [
          { tapOn: 'Writing style' }, { assertVisible: 'Book settings' },
        ], 'tap the visible heading inside the real scroll content without submitting the multiline field');
        const postmark = find(rows, row => row.inputText === 'DESERT DAYS', inscriptionScroll);
        const postmarkScroll = find(rows, row => row.scrollUntilVisible?.element === 'Paper tint', postmark);
        assert.deepEqual(rows.slice(postmark + 1, postmarkScroll), [
          { pressKey: 'Enter' }, { assertVisible: 'Book settings' },
        ], 'dismiss the single-line postmark keyboard before the next global scroll');
        assert.equal(inside.filter(row => row.pressKey === 'Enter').length, 2);
      } else if (label === 'full') {
        assert.equal(inside.some(row => row.pressKey === 'Enter'), false, 'the passing Android keyboard interactions remain unchanged');
        assert.equal(inside.some(row => tap(row) === 'Writing style'), false, 'the iOS heading dismissal must not change Android');
      }
      assert.ok(copied < save); assert.equal(rows.filter(row => tap(row) === 'Save memory book').length, 1);
      const closed = find(rows, row => row.extendedWaitUntil?.notVisible === 'Book settings', save);
      assert.equal(rows[closed].extendedWaitUntil.timeout, 15000);
      const reopened = find(rows, row => tap(row) === 'Edit memory book', closed);
      const persisted = find(rows, row => row.copyTextFrom === 'Book title', reopened);
      assert.equal(rows[persisted + 1].assertTrue, '${maestro.copiedText === "' + title + '"}');
      find(rows, row => tap(row) === 'Cancel memory book edits', persisted);
      assert.equal(rows.some(row => JSON.stringify(row).includes('optional')), false);
    });
  }
}
