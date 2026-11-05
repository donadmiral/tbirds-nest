const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, 'tests/native/flows', name), 'utf8');
const originalSource = read('memory-capture.yaml');
const retainedSource = read('retained-ios-memory-capture.yaml');
const parse = source => YAML.parseAllDocuments(source).map(document => {
  assert.deepEqual(document.errors, []);
  return document.toJSON();
});

test('retained iOS capture preserves the original identity and every post-handoff command', () => {
  const [originalConfig, original] = parse(originalSource);
  const [retainedConfig, retained] = parse(retainedSource);
  assert.deepEqual(retainedConfig, originalConfig);
  assert.equal(original[0].openLink, 'platinum-circles-qa://ui-fixture/memory');
  assert.deepEqual(retained, original.slice(3));
  const marker = '- extendedWaitUntil:\n    visible: Native capture acceptance';
  assert.equal(retainedSource.slice(retainedSource.indexOf(marker)),
    originalSource.slice(originalSource.indexOf(marker)));
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(retained)).digest('hex'),
    'f01285384b6e22f2974312be89fa55e8844384ae00c74862c496a72b51405d76');
});

test('external handoff cannot replace real destination, account, cancellation or completion checks', () => {
  const [, retained] = parse(retainedSource);
  assert.deepEqual(retained[0], { extendedWaitUntil: {
    visible: 'Native capture acceptance', timeout: 30000,
  } });
  assert.deepEqual(retained[1], { extendedWaitUntil: {
    visible: 'Saved account readback passed', timeout: 15000,
  } });
  assert.ok(retained.some(command => command.tapOn === 'Open cancellation movie'));
  assert.ok(retained.some(command => command.tapOn === 'Open complete movie'));
  assert.ok(retained.some(command => command.extendedWaitUntil?.visible === 'Save movie to Photos'
    && command.extendedWaitUntil.timeout === 180000));
  assert.equal(retained.filter(command => command.extendedWaitUntil?.visible
    === 'Memory capture cleanup passed').length, 2);
  assert.doesNotMatch(JSON.stringify(retained), /openLink|launchApp|clearState|clearKeychain|stopApp|optional/);
});
