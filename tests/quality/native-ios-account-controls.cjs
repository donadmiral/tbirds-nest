const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');
const fixture = path.join(root, 'tests/quality/fixtures/ios-account-controls');
const evidence = JSON.parse(fs.readFileSync(path.join(fixture, 'observed.json'), 'utf8'));
const beforeMode = process.env.PLATINUM_IOS_ACCOUNT_FLOW_BEFORE === '1';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function flow(id, before = beforeMode) {
  const file = before ? path.join(fixture, `${id}.before.yaml`)
    : path.join(root, 'tests/native/audit/flows', `${id}.yaml`);
  return YAML.parseAllDocuments(fs.readFileSync(file, 'utf8'))[1].toJSON();
}
function flatten(rows, platform) {
  return rows.flatMap(row => row.runFlow?.commands
    ? (!row.runFlow.when?.platform || row.runFlow.when.platform === platform
      ? flatten(row.runFlow.commands, platform) : []) : [row]);
}
const commands = (id, platform = 'iOS', before = beforeMode) => flatten(flow(id, before), platform);
const tap = row => typeof row?.tapOn === 'string' ? row.tapOn : row?.tapOn?.text;
const matches = (nodes, value) => nodes.filter(node => ['text', 'hintText', 'accessibilityText']
  .some(key => node[key]?.toLowerCase() === value.toLowerCase()));
function box(value) {
  const [left, top, right, bottom] = value.match(/-?\d+/g).map(Number);
  return { left, top, right, bottom };
}
function index(rows, predicate, after = -1) {
  const value = rows.findIndex((row, i) => i > after && predicate(row));
  assert.ok(value > after, 'required ordered operation exists'); return value;
}

test('retained account failures and exact original flow bytes remain identified as failures', () => {
  assert.equal(evidence.sourceCommit, 'f5be97445ef7223baeb60dd10e8cded05630b6c1');
  assert.equal(evidence.consumerRunId, 41266020246);
  assert.equal(evidence.artifactId, 13069506923);
  assert.deepEqual([evidence.originalPassed, evidence.originalFailed], [21, 6]);
  for (const [id, record] of Object.entries(evidence.cases)) {
    assert.equal(sha(fs.readFileSync(path.join(fixture, `${id}.before.yaml`))), record.beforeFlowSha256);
    assert.equal(record.failedCommand.metadata.status, 'FAILED');
    for (const key of ['hierarchySha256', 'screenshotSha256', 'commandsSha256', 'receiptSha256']) {
      assert.match(record[key], /^[a-f0-9]{64}$/);
    }
  }
});

test('the iOS support notice remains fully required without an impossible bottom-centering condition', () => {
  const id = 'support-list-error', label = 'Your messages could not be loaded. Please try again.';
  const nodes = matches(evidence.cases[id].nodes, label);
  assert.ok(nodes.length > 0);
  const bounds = box(nodes[0].bounds);
  assert.deepEqual(bounds, { left: 31, top: 606, right: 362, bottom: 646 });
  assert.ok(bounds.top >= 0 && bounds.bottom <= 852, 'the original notice is fully in the viewport');
  assert.ok(bounds.bottom > 852 * 0.7, 'the original center requirement rejects this bottom-of-form position');
  const rows = commands(id), scroll = rows.find(row => row.scrollUntilVisible)?.scrollUntilVisible;
  assert.equal(scroll.element, label);
  assert.equal(scroll.direction, 'DOWN');
  assert.equal(scroll.centerElement, false);
  assert.equal(scroll.visibilityPercentage ?? 100, 100);
  assert.ok(rows.some(row => row.assertVisible === 'Try again'));
  assert.equal(evidence.cases[id].audit.mutations.length, 0);
});

for (const [id, placeholder, actualLabel] of [
  ['support-fresh-ticket-body', 'What happened, and what you expected', 'Message What happened, and what you expected'],
  ['support-reopen-error', 'Write to reopen this ticket', 'Reply Write to reopen this ticket'],
  ['support-reply-error', 'Write a reply', 'Reply Write a reply'],
]) {
  test(`${id}: target the unique actual iOS input while retaining the full placeholder contract`, () => {
    const nodes = evidence.cases[id].nodes;
    assert.equal(matches(nodes, placeholder).length, 0, 'the failed full-string selector is absent');
    const actual = matches(nodes, actualLabel);
    assert.equal(actual.length, 1, 'the recorded full label identifies one input');
    assert.equal(actual[0].enabled, 'true');
    const rows = commands(id), target = rows.find(row => tap(row) === actualLabel);
    assert.ok(target, 'use the complete observed field label, not a broad prefix or alternate success assertion');
    assert.equal(tap(target), actualLabel);
    assert.equal(evidence.cases[id].audit.mutations.length, 0, 'original failure occurred before submission');
    if (id === 'support-fresh-ticket-body') {
      const typed = index(rows, row => row.inputText === 'Fresh audit ticket');
      const returned = index(rows, row => row.pressKey === 'Enter', typed);
      const input = index(rows, row => tap(row) === actualLabel, returned);
      assert.ok(input > returned, 'blur the single-line subject before reaching the multiline body');
    }
  });
}

test('the exact retained Paper tint hit reached the keyboard and changed the title before Save', () => {
  const record = evidence.cases['memory-cover-settings'];
  assert.ok(record.driverExcerpt.some(line => line.includes('x=42, y=576, width=309, height=13')));
  assert.ok(record.driverExcerpt.some(line => line.includes('Try tapping at (196, 582)')));
  assert.ok(record.keyboardExcerpt.some(line => line.includes('03:49:10.973546') && line.includes('UIRemoteKeyboardWindow')));
  assert.ok(record.keyboardExcerpt.some(line => line.includes('03:49:11.257969') && line.includes('Keyboard inserts text')));
  assert.ok(record.keyboardExcerpt.some(line => line.includes('03:49:13.739571') && line.includes('AUDIT BOOK TITLET')));
  const receiptBytes = fs.readFileSync(path.join(fixture, 'memory-cover-settings-receipt.json'));
  assert.equal(sha(receiptBytes), record.receiptSha256);
  const receipt = JSON.parse(receiptBytes);
  const saves = receipt.mutations.filter(row => row.rpc === 'save_memory_book_creative_presentation');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].title, 'AUDIT BOOK TITLET');
  assert.equal(receipt.bookReads.at(-1).title, saves[0].title);
  const rows = commands('memory-cover-settings');
  const typed = index(rows, row => row.inputText === 'AUDIT BOOK TITLE');
  const returned = index(rows, row => row.pressKey === 'Enter', typed);
  const rechecked = index(rows, row => row.copyTextFrom === 'Book title', returned);
  assert.equal(rows[rechecked + 1].assertTrue, '${maestro.copiedText === "AUDIT BOOK TITLE"}');
  index(rows, row => tap(row) === 'Save memory book', rechecked);
  assert.equal(rows.some(row => tap(row) === 'Paper tint'), false, 'do not tap the known keyboard-overlapped heading on iOS');
});

test('the actual title and subject are single-line inputs whose installed RN Return behavior blurs', () => {
  for (const [file, label] of [
    ['src/screens/profile/MemoryAlbumScreen.tsx', 'Book title'],
    ['src/screens/profile/ContactSupportScreen.tsx', 'Subject'],
  ]) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found = [];
    function visit(node) {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'TextInput') {
        const props = node.attributes.properties;
        if (props.some(p => p.name?.getText(source) === 'accessibilityLabel' && p.initializer?.text === label)) found.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(source); assert.equal(found.length, 1);
    const names = found[0].attributes.properties.map(p => p.name?.getText(source));
    for (const name of ['multiline', 'blurOnSubmit', 'submitBehavior', 'onSubmitEditing']) assert.equal(names.includes(name), false);
  }
  const rn = read('node_modules/react-native/Libraries/Components/TextInput/TextInput.js');
  const from = rn.indexOf('  const multiline = props.multiline ?? false;');
  const to = rn.indexOf('  const accessible =', from);
  assert.ok(from >= 0 && to > from);
  const scope = { props: {}, module: { exports: null } };
  const js = ts.transpileModule(`${rn.slice(from, to)}\nmodule.exports = submitBehavior;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, scope);
  assert.equal(scope.module.exports, 'blurAndSubmit');
});

test('all five Android paths and original iOS user-visible assertions, deadlines and Save accounting remain strict', () => {
  for (const id of Object.keys(evidence.cases)) {
    assert.deepEqual(commands(id, 'Android'), commands(id, 'Android', true), `${id}: Android behavior unchanged`);
    const original = commands(id, 'iOS', true), actual = commands(id);
    for (const row of original.filter(row => row.assertVisible || row.assertTrue || row.extendedWaitUntil || row.inputText)) {
      assert.ok(actual.some(candidate => JSON.stringify(candidate) === JSON.stringify(row)), `${id}: preserve ${JSON.stringify(row)}`);
    }
    assert.equal(actual.filter(row => row.runFlow === '_signin.yaml').length, 1);
    assert.doesNotMatch(JSON.stringify(actual), /"optional":true|"point":|"retryTapIfNoChange":true/);
  }
  const rows = commands('memory-cover-settings');
  assert.equal(rows.filter(row => tap(row) === 'Save memory book').length, 1);
  const save = index(rows, row => tap(row) === 'Save memory book');
  const reopened = index(rows, row => tap(row) === 'Edit memory book', save);
  const readback = index(rows, row => row.copyTextFrom === 'Book title', reopened);
  assert.equal(rows[readback + 1].assertTrue, '${maestro.copiedText === "AUDIT BOOK TITLE"}');
});
