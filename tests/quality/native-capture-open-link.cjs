const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const flow = YAML.parseAllDocuments(fs.readFileSync(path.join(root,
  'tests/native/flows/memory-capture.yaml'), 'utf8'))[1].toJSON();
const recorded = fs.readFileSync(path.join(root,
  'docs/quality/native-full-app-20261031/ios-e173b2db/capture-open-link-ax.json'));
const hierarchy = JSON.parse(recorded);

function nodes(node) { return [node, ...(node.children || []).flatMap(nodes)]; }
function labels(tree) { return nodes(tree).map(node => node.attributes?.accessibilityText).filter(Boolean); }
function matches(pattern, value) { return new RegExp('^(?:' + pattern + ')$').test(value); }
const open = flow.findIndex(command => Object.hasOwn(command, 'openLink'));
const readiness = flow[open + 1].runFlow;
const confirmation = flow[open + 2].runFlow;

// This projects only the pinned Maestro 2.11.0 condition contract: platform and
// visible are both required, and text selectors use full-string regex matching.
// It is not a local execution of Maestro or proof of a new Simulator interaction.
// Official tag c8c361be: Orchestra.evaluateCondition checks platform first, then
// the visible selector; IOSDriver.openLink forwards the URL without autoVerify.
function actionsFor(platform, visibleLabels) {
  assert.deepEqual(Object.keys(confirmation.when).sort(), ['platform', 'visible']);
  return platform === confirmation.when.platform
    && visibleLabels.some(value => matches(confirmation.when.visible, value))
    ? confirmation.commands : [];
}

test('iOS waits for the late exact system prompt or actual destination before choosing Open', () => {
  assert.deepEqual(readiness.when, { platform: 'iOS' });
  assert.equal(readiness.commands.length, 1);
  const wait = readiness.commands[0].extendedWaitUntil;
  assert.deepEqual(wait, { visible: '^(?:Open in “Platinum QA”\\?|Native capture acceptance)$', timeout: 30000 });
  const snapshots = [[], ['Unrelated Open control'], labels(hierarchy)];
  const first = snapshots.findIndex(values => values.some(value => matches(wait.visible, value)));
  assert.equal(first, 2, 'An absent prompt must not cause the condition to be skipped before it arrives.');
  assert.deepEqual(actionsFor('iOS', snapshots[first]), [{ tapOn: 'Open' }]);
  assert.ok(matches(wait.visible, 'Native capture acceptance'));
  for (const wrong of ['Open', 'Open in “Another App”?', 'Open in “Platinum QA”!',
    'Native capture acceptance later', '']) assert.equal(matches(wait.visible, wrong), false);
});

test('the iOS handoff condition and semantic Open target match the retained real system alert', () => {
  assert.equal(crypto.createHash('sha256').update(recorded).digest('hex'),
    'df636b1b3ce9ddcf2439db86478f543415a28e24f9e9ea487f0603edb7237696');
  const actions = actionsFor('iOS', labels(hierarchy));
  assert.deepEqual(actions, [{ tapOn: 'Open' }]);
  const targets = nodes(hierarchy).filter(node =>
    matches(actions[0].tapOn, node.attributes?.accessibilityText || ''));
  assert.equal(targets.length, 1, 'the recorded alert has one exact Open target');
  assert.equal(targets[0].attributes.enabled, 'true');
  assert.equal(targets[0].attributes.bounds, '[197,446][331,490]');
});

test('an identical-looking Android alert never triggers the iOS handoff action', () => {
  assert.deepEqual(actionsFor('Android', labels(hierarchy)), []);
});

test('another app title or nonliteral punctuation cannot authorize an Open tap', () => {
  for (const prompt of ['Open in “Another App”?', 'Open in “Platinum QA”',
    'Open in “Platinum QA”!', 'Open in “Platinum QA”? Continue']) {
    assert.deepEqual(actionsFor('iOS', [prompt, 'Cancel', 'Open']), [], prompt);
  }
});

test('no handoff dialog leaves unrelated Open controls untouched', () => {
  assert.deepEqual(actionsFor('iOS', ['Native capture acceptance', 'Open']), []);
  assert.deepEqual(actionsFor('iOS', []), []);
});

test('confirmation handling preserves the required route, storage and export assertions', () => {
  assert.equal(open, 0);
  assert.equal(flow[open].openLink, 'platinum-circles-qa://ui-fixture/memory');
  assert.deepEqual(flow[open + 3], { extendedWaitUntil: {
    visible: 'Native capture acceptance', timeout: 30000,
  } });
  assert.deepEqual(flow[open + 4], { extendedWaitUntil: {
    visible: 'Saved account readback passed', timeout: 15000,
  } });
  const waits = flow.filter(command => command.extendedWaitUntil).map(command => command.extendedWaitUntil);
  assert.ok(waits.some(wait => wait.visible === 'Save movie to Photos' && wait.timeout === 180000));
  assert.equal(waits.filter(wait => wait.visible === 'Memory capture cleanup passed').length, 2);
  assert.equal(flow.filter(command => Object.hasOwn(command, 'openLink')).length, 1);
  assert.equal(flow.filter(command => Object.hasOwn(command, 'runFlow')).length, 2);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(flow.slice(open + 3))).digest('hex'),
    'f01285384b6e22f2974312be89fa55e8844384ae00c74862c496a72b51405d76',
    'Every original destination, storage, cancellation and completed-export action must remain unchanged.');
  const source = JSON.stringify(flow);
  assert.doesNotMatch(source, /launchApp|clearState|clearKeychain|stopApp|autoVerify|optional|Sign in/);
});

test('the first active download is closed immediately after its visible progress requirement', () => {
  const progress = flow.findIndex(command => command.extendedWaitUntil?.visible
    === 'Reading the movie’s video timing…');
  assert.ok(progress > 0);
  assert.deepEqual(flow[progress], { extendedWaitUntil: {
    visible: 'Reading the movie’s video timing…', timeout: 15000,
  } });
  assert.deepEqual(flow[progress + 1], { tapOn: {
    text: 'Close movie export', waitToSettleTimeoutMs: 1000,
  } }, 'A no-op progress tap can consume the real download deadline before cancellation.');
  assert.deepEqual(flow[progress + 2], { extendedWaitUntil: {
    visible: 'Memory capture cleanup passed', timeout: 15000,
  } });
  assert.deepEqual(flow[progress + 3], { tapOn: 'Open complete movie' });
  assert.equal(flow.filter(command => command.tapOn === 'Reading the movie’s video timing…'
    || command.tapOn?.text === 'Reading the movie’s video timing…').length, 0);
});
