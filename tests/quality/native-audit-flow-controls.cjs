const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');
const evidence = 'docs/quality/native-full-app-20261031/native-audit-android-flow-repair';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const baseline = process.env.PLATINUM_AUDIT_FLOW_BASELINE === '1';
const flow = id => YAML.parseAllDocuments(read(baseline
  ? `${evidence}/before/${id}.yaml.txt` : `tests/native/audit/flows/${id}.yaml`))[1].toJSON();
const before = id => YAML.parseAllDocuments(read(`${evidence}/before/${id}.yaml.txt`))[1].toJSON();
const manifest = JSON.parse(read(baseline ? `${evidence}/before/manifest.json` : 'tests/native/audit/manifest.json'));
const observed = JSON.parse(read(`${evidence}/observed/failures.json`));
const changed = ['stories-storycomposer', 'settings-appearance', 'market-createlisting', 'auth-forgot-password',
  'auth-signup-entry', 'auth-business-entry', 'support-fresh-ticket-body', 'support-reopen-error',
  'support-reply-error', 'memory-film-export-entry', 'feed-article-draft', 'support-missing-ticket', 'support-list-error'];

function attributes(value) {
  if (Array.isArray(value)) return value.flatMap(attributes);
  if (!value || typeof value !== 'object') return [];
  return [...(value.attributes ? [value.attributes] : []), ...Object.entries(value)
    .filter(([key]) => key !== 'attributes').flatMap(([, child]) => attributes(child))];
}
const ax = id => attributes(JSON.parse(read(`${evidence}/observed/${id}.ax.json`)));
// cli-2.11.0 Filters.textMatches checks text, hint and accessibility labels with
// full-string regex OR exact literal equality. This projects that selector
// contract only; it does not execute a native gesture or recreate layout.
function matches(pattern, value) {
  if (value == null) return false;
  const flags = pattern.startsWith('(?s)') ? 's' : pattern.startsWith('(?i)') ? 'i' : '';
  const expression = pattern.replace(/^\(\?[si]\)/, '');
  return [String(value), String(value).replaceAll('\n', ' ')].some(text => pattern === text
    || new RegExp(`^(?:${expression})$`, flags).test(text));
}
const matching = (nodes, pattern) => nodes.filter(node => ['text', 'hintText', 'accessibilityText']
  .some(field => matches(pattern, node[field])));
function commands(id, platform = 'Android') {
  const flatten = rows => rows.flatMap(row => row.runFlow?.commands
    ? (!row.runFlow.when?.platform || row.runFlow.when.platform === platform ? flatten(row.runFlow.commands) : [])
    : [row]);
  return flatten(flow(id));
}
const tapText = command => typeof command.tapOn === 'string' ? command.tapOn : command.tapOn?.text;
function indexOf(rows, predicate, message, after = -1) {
  const index = rows.findIndex((row, i) => i > after && predicate(row));
  assert.ok(index >= 0, message); return index;
}
function scrollBefore(rows, target, tap, direction = 'DOWN') {
  const at = indexOf(rows, row => row.scrollUntilVisible?.element === target, `scroll to ${target} before its action`);
  assert.ok(at < tap, 'semantic scroll precedes the target action');
  assert.equal(rows[at].scrollUntilVisible.direction, direction);
  assert.equal(rows[at].scrollUntilVisible.centerElement, true, 'avoid the retained system-nav overlap');
}
function hiddenByKeyboard(id, missing) {
  const nodes = ax(id);
  assert.ok(nodes.some(node => node.class === 'com.android.inputmethod.keyboard.Key'), 'retained keyboard is present');
  assert.equal(matching(nodes, missing).length, 0, 'target is absent from the retained visible hierarchy');
}
function hideBetween(rows, start, end) {
  assert.ok(rows.slice(start + 1, end).includes('hideKeyboard'), 'dismiss the observed Android keyboard before the next target');
}
function parseSource(file) { return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function findAll(node, predicate) {
  const result = [];
  const visit = value => { if (predicate(value)) result.push(value); ts.forEachChild(value, visit); };
  visit(node); return result;
}
function initializer(file, name) {
  const source = parseSource(file);
  const nodes = findAll(source, node => ts.isVariableDeclaration(node) && node.name.getText(source) === name);
  assert.equal(nodes.length, 1, `${name} is unambiguous in actual production source`);
  return nodes[0].initializer.getText(source);
}
function evaluate(expression, values) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(`module.exports = (${expression});`, {
    fileName: 'actual-component-expression.tsx',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module, exports: module.exports, ...values });
  return module.exports;
}

test('all 17 retained UI failures have valid fixture contracts and exact failed-command evidence', () => {
  assert.equal(observed.sourceCommit, 'b568bd7b75bd25ad919afd8eac8d52300a5c3fcc');
  assert.equal(observed.recoveryRunId, 41231522956);
  assert.equal(observed.cases.length, 17);
  for (const item of observed.cases) {
    assert.equal(item.fixture.passed, true, item.id);
    assert.equal(item.lastCommands.at(-1).status, 'FAILED', item.id);
    assert.ok(ax(item.id).length > 0, item.id);
    assert.deepEqual(item.evidence.map(row => row.kind).sort(), ['SCREENSHOT', 'SCREEN_HIERARCHY']);
  }
});

test('text-story entry completes the actual initial editor before requiring the original Next control', () => {
  const id = 'stories-storycomposer', rows = commands(id), nodes = ax(id);
  assert.equal(manifest.cases.find(item => item.id === id).state.routes[0].params.mode, 'text');
  assert.ok(matching(nodes, 'Save text sticker').some(node => node.clickable === 'true'));
  assert.equal(matching(nodes, 'Next').length, 0);
  const ready = indexOf(rows, row => row.extendedWaitUntil?.visible === 'Save text sticker', 'wait for actual text editor');
  const input = indexOf(rows, row => row.inputText === 'Audit story text', 'enter a synthetic text sticker', ready);
  const done = indexOf(rows, row => tapText(row) === 'Save text sticker', 'save the editor', input);
  const next = indexOf(rows, row => row.extendedWaitUntil?.visible === 'Next', 'retain original Next assertion', done);
  assert.equal(rows[next].extendedWaitUntil.timeout, 15000);
  const file = 'src/screens/stories/StoryComposerScreen.tsx';
  let editorOpen = true, keyboardDismissed = false, stickers = [];
  const close = evaluate(initializer(file, 'closeTextEditor'), { useCallback: fn => fn,
    Keyboard: { dismiss: () => { keyboardDismissed = true; } }, setTextEditorOpen: value => { editorOpen = value; },
    setStickerText() {}, setEditingStickerId() {} });
  evaluate(initializer(file, 'saveSticker'), { useCallback: fn => fn, stickerText: rows[input].inputText,
    editingStickerId: null, updateStickers: fn => { stickers = fn(stickers); }, closeTextEditor: close,
    storyLayerWindow: () => ({ start: 0, end: 15 }), stickerStartSec: null, stickerEndSec: null,
    active: { durationSec: 15 }, stickerBgEnabled: false, stickerFontSize: 0, stickerOpacity: 1,
    stickerTextAlign: 'center', stickerAnim: 'none', stickerStyle: 'classic', stickerColor: '#fff',
    newStickerId: () => 'synthetic-sticker', nextStickerNy: () => 0.4, resolveTextMentions() {},
  })();
  assert.equal(editorOpen, false); assert.equal(keyboardDismissed, true);
  assert.equal(stickers[0].text, 'Audit story text');
});

test('listing entry checks the real Photos step instead of a Details field that has not been entered', () => {
  const id = 'market-createlisting', rows = commands(id), nodes = ax(id);
  const file = 'src/screens/market/CreateListingScreen.tsx';
  const steps = evaluate(initializer(file, 'STEPS'), {});
  const initial = evaluate(initializer(file, '[step, setStep]'), { useState: value => [value, () => {}] })[0];
  assert.equal(steps[initial], 'Photos');
  assert.ok(matching(nodes, 'Photos').length); assert.ok(matching(nodes, '1 of 4').length);
  assert.equal(matching(nodes, 'Title').length, 0);
  const ready = rows.find(row => row.extendedWaitUntil)?.extendedWaitUntil;
  assert.equal(ready.visible, steps[initial]); assert.equal(ready.timeout, 15000);
  assert.ok(rows.some(row => row.assertVisible === '1 of 4'));
  assert.ok(rows.some(row => row.assertVisible === 'Add up to 10 photos. The first one is your cover.'));
  assert.equal(manifest.cases.find(item => item.id === id).expected, 'Photos');
});

test('Appearance matches complete actual grouped segments and verifies the selected Lights out state', () => {
  const rows = commands('settings-appearance');
  const pattern = rows.map(tapText).find(value => value?.includes('Appearance') && value !== 'Search settings');
  const actual = matching(ax('settings-appearance'), pattern).filter(node => node.clickable === 'true');
  assert.equal(actual.length, 1);
  assert.equal(actual[0].accessibilityText, '\uf1a7, Appearance, Follows your phone, \uf130');
  for (const text of ['Search settings', 'Other Appearance, Light', 'Appearance, Light, unrelated', 'Appearance, Unknown']) {
    assert.equal(matches(pattern, text), false, text);
  }
  const selected = rows.find(row => typeof row.assertVisible === 'string' && row.assertVisible.includes('Lights out'));
  assert.ok(selected, 'check the result of selecting Lights out');
  assert.ok(matches(selected.assertVisible, '\uf1a7, Appearance, Lights out, \uf130'));
  assert.equal(matches(selected.assertVisible, actual[0].accessibilityText), false);
});

test('sign-up targets the full retained nested-text link and scrolls to the original Sign Up assertion', () => {
  const rows = commands('auth-signup-entry');
  const tap = indexOf(rows, row => tapText(row)?.includes('New here'), 'use complete visible sign-up link');
  const pattern = tapText(rows[tap]);
  assert.equal(matching(ax('auth-signup-entry'), pattern).filter(node => node.clickable === 'true').length, 1);
  assert.equal(matches(pattern, 'Create an account'), false);
  assert.equal(matches(pattern, 'New here Create an account'), false, 'literal question mark is required');
  scrollBefore(rows, pattern, tap);
  const button = indexOf(rows, row => row.assertVisible === 'Sign Up', 'retain Sign Up assertion');
  scrollBefore(rows, 'Sign Up', button);
  assert.ok(rows.some(row => row.assertVisible === 'Create your account'));
});

test('password reset dismisses the observed autofocus keyboard and reaches Send code before empty-input validation', () => {
  const rows = commands('auth-forgot-password');
  hiddenByKeyboard('auth-forgot-password', 'Send code');
  const ready = indexOf(rows, row => row.assertVisible === 'Reset password', 'same reset entry');
  const tap = indexOf(rows, row => tapText(row) === 'Send code', 'same send action');
  hideBetween(rows, ready, tap); scrollBefore(rows, 'Send code', tap);
  assert.ok(rows.slice(tap + 1).some(row => row.assertVisible === 'Enter your email address'));
  assert.match(read('src/screens/auth/LoginScreen.tsx'), /autoFocus\s+returnKeyType="send"\s+onSubmitEditing=\{handleSendCode\}/);
});

test('business entry scrolls the actual login footer instead of treating its absence above the fold as failure', () => {
  const rows = commands('auth-business-entry');
  assert.equal(matching(ax('auth-business-entry'), 'Business sign-in').length, 0);
  assert.match(read('src/screens/auth/LoginScreen.tsx'), /navigate\('BusinessSignIn'\)[\s\S]{0,200}>Business sign-in<\/Text>/);
  const tap = indexOf(rows, row => tapText(row) === 'Business sign-in', 'preserve the business sign-in action');
  scrollBefore(rows, 'Business sign-in', tap);
  assert.ok(rows.some(row => row.assertVisible === 'Business handle'));
  const code = indexOf(rows, row => row.assertVisible === 'Personal access code', 'preserve personal access code assertion');
  scrollBefore(rows, 'Personal access code', code);
});

test('fresh Support ticket dismisses the subject keyboard and scrolls to the unique editable body placeholder', () => {
  const rows = commands('support-fresh-ticket-body');
  const target = 'What happened, and what you expected';
  hiddenByKeyboard('support-fresh-ticket-body', target);
  assert.match(read('src/screens/profile/ContactSupportScreen.tsx'), /<TextInput accessibilityLabel="Message"[^>]+value=\{body\}/);
  assert.ok(read('src/screens/profile/ContactSupportScreen.tsx').includes(`placeholder={isAppeal ? 'Your case for restoration' : '${target}'}`));
  // The same actual form is retained without the keyboard in the list-error
  // case. Its unique full placeholder belongs to an editable node, whereas
  // the short Message field label is not a sufficient target contract.
  const inputs = matching(ax('support-list-error'), target);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].class, 'android.widget.EditText');
  assert.equal(inputs[0].clickable, 'true');
  assert.equal(matches(target, 'Message'), false);
  const input = indexOf(rows, row => row.inputText === 'Fresh audit ticket', 'preserve subject');
  const tap = indexOf(rows, row => tapText(row) === target, 'target the body by its unique full placeholder');
  hideBetween(rows, input, tap); scrollBefore(rows, target, tap);
  assert.ok(rows.some(row => row.inputText === 'My original question must remain visible.'));
  assert.ok(rows.some(row => row.assertVisible === 'My original question must remain visible.'));
  assert.ok(rows.some(row => row.assertVisible === 'Sent'));
});

for (const [id, draft] of [['support-reopen-error', 'Please reopen this synthetic ticket.'],
  ['support-reply-error', 'Please retain this draft after failure.']]) {
  test(`${id} clears the observed keyboard before Send and retains the failure/draft/retry checks`, () => {
    const rows = commands(id);
    hiddenByKeyboard(id, 'Send');
    const input = indexOf(rows, row => row.inputText === draft, 'preserve the intended draft');
    const send = indexOf(rows, row => tapText(row) === 'Send', 'preserve Send', input);
    hideBetween(rows, input, send);
    for (const label of ['Reply not confirmed', draft, 'Send']) {
      assert.ok(rows.slice(send + 1).some(row => row.assertVisible === label), label);
    }
    if (id === 'support-reopen-error') assert.ok(rows.some(row => row.assertVisible === 'Solved'));
  });
}

test('article draft dismisses the title keyboard, finds the actual body, then restores the original title assertion', () => {
  const rows = commands('feed-article-draft');
  const body = 'Write the piece. Paragraphs are preserved exactly as you write them. Use the toolbar for headings, emphasis, quotes, links and images.';
  hiddenByKeyboard('feed-article-draft', body);
  assert.ok(read('src/screens/feed/ArticleComposeScreen.tsx').includes(`placeholder="${body}"`));
  const title = indexOf(rows, row => row.inputText === 'An audit article', 'preserve title entry');
  const tap = indexOf(rows, row => tapText(row) === body, 'preserve exact body input');
  hideBetween(rows, title, tap); scrollBefore(rows, body, tap);
  const input = indexOf(rows, row => row.inputText === 'A synthetic article paragraph kept inside the audit.', 'same body', tap);
  const check = indexOf(rows, row => row.assertVisible === 'An audit article', 'same title check', input);
  hideBetween(rows, input, check); scrollBefore(rows, 'An audit article', check, 'UP');
});

test('film entry scrolls beyond the retained cover before the same play/pause/export/close journey', () => {
  const id = 'memory-film-export-entry', rows = commands(id);
  const target = 'Play continuous memory film with original music';
  const nodes = ax(id);
  assert.ok(matching(nodes, 'THE SMALL ADVENTURES').length);
  assert.equal(matching(nodes, target).length, 0);
  assert.ok(read('src/screens/profile/MemoryAlbumScreen.tsx').includes(`accessibilityLabel="${target}"`));
  const tap = indexOf(rows, row => tapText(row) === target, 'same film action');
  scrollBefore(rows, target, tap);
  const original = before(id), originalTap = indexOf(original, row => tapText(row) === target, 'original film action');
  assert.deepEqual(flow(id).slice(flow(id).findIndex(row => tapText(row) === target)), original.slice(originalTap));
});

test('missing-ticket assertion matches the actual explicit unavailable state without accepting a spinner or a valid ticket', () => {
  const id = 'support-missing-ticket';
  const pattern = flow(id).find(row => row.extendedWaitUntil)?.extendedWaitUntil.visible;
  const actual = 'This ticket is not available to this account.';
  assert.ok(read('src/screens/profile/TicketScreen.tsx').includes(`>${actual}</Text>`));
  assert.ok(matches(pattern, actual));
  for (const wrong of ['Loading support ticket', 'Audit support question', 'This ticket is available to this account.']) {
    assert.equal(matches(pattern, wrong), false);
  }
  assert.equal(manifest.cases.find(item => item.id === id).expected, pattern);
  assert.equal(flow(id).find(row => row.extendedWaitUntil).extendedWaitUntil.timeout, 15000);
});

test('Support list failure reaches the repaired notice below the form and retains the mandatory error assertion', () => {
  const rows = commands('support-list-error');
  const notice = 'Your messages could not be loaded. Please try again.';
  const source = read('src/screens/profile/ContactSupportScreen.tsx');
  assert.ok(source.includes(`setListError('${notice}')`));
  assert.ok(source.indexOf('{listError ?') > source.indexOf("'Send appeal' : 'Send'"), 'actual notice is after the submit section');
  const send = ax('support-list-error').find(node => node.text === 'Send');
  assert.equal(send.bounds, '[143,587][176,608]', 'retained form already reaches the system navigation region');
  const error = indexOf(rows, row => row.extendedWaitUntil?.visible === '(?i).*(could not load|try again|retry).*', 'same mandatory error check');
  scrollBefore(rows, notice, error);
  assert.equal(rows[error].extendedWaitUntil.timeout, 15000);
  assert.ok(rows.some(row => row.assertVisible === 'Try again'), 'retry remains reachable');
});

test('the repair preserves 85 case identities, fixture scenarios, setup, original postconditions and deadlines', () => {
  const expectedManifest = JSON.parse(read(`${evidence}/before/manifest.json`));
  expectedManifest.cases.find(item => item.id === 'market-createlisting').expected = 'Photos';
  expectedManifest.cases.find(item => item.id === 'support-missing-ticket').expected = 'This ticket is not available to this account.';
  // Separate source/AX-backed follow-up: preserve every route and fixture while
  // correcting the normalized topic label and the empty activity coverage name.
  expectedManifest.cases.find(item => item.id === 'feed-trendfeed').expected = '#memories';
  const emptyActivity = expectedManifest.cases.find(item => item.id === 'notifications-empty-controls');
  emptyActivity.name = 'Audit empty notifications';
  emptyActivity.coverage = 'Empty activity state and absence of the unread-only Mark all read action. Positive Mark all read remains untested.';
  assert.deepEqual(manifest, expectedManifest);
  assert.equal(manifest.cases.length, 85);
  for (const id of changed) {
    const original = before(id), actual = flow(id);
    const opened = original.findIndex(row => row.tapOn?.id === 'native-audit-open-case');
    if (opened >= 0) assert.deepEqual(actual.slice(0, opened + 1), original.slice(0, opened + 1), id);
    else assert.deepEqual(actual[0], original[0], id);
    for (const row of original.filter(item => item.assertVisible)) {
      assert.ok(actual.some(value => JSON.stringify(value) === JSON.stringify(row)), `${id}: retain ${row.assertVisible}`);
    }
    for (const row of original.filter(item => item.extendedWaitUntil)) {
      const label = id === 'market-createlisting' ? 'Photos' : id === 'support-missing-ticket'
        ? 'This ticket is not available to this account.' : row.extendedWaitUntil.visible;
      const wait = actual.find(item => item.extendedWaitUntil?.visible === label)?.extendedWaitUntil;
      assert.ok(wait, `${id}: preserve mandatory readiness check`);
      assert.equal(wait.timeout, row.extendedWaitUntil.timeout, id);
    }
    assert.doesNotMatch(JSON.stringify(actual), /"optional":true|"point":|"retryTapIfNoChange":true/);
    assert.equal(actual.filter(row => row.runFlow === '_signin.yaml' || row.runFlow === '_signedout.yaml').length, 1, id);
  }
});
