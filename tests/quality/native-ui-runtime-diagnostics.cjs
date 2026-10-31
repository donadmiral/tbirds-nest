const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../scripts/quality/verify-native-ui.cjs'), 'utf8');
const prefix = source.slice(0, source.indexOf('const memory ='));
assert.ok(prefix.includes('accountPersistenceFailures'));

function verify(appLog, accountReadbacks = [{ passed: true, reloaded: true, accountCount: 1 }]) {
  vm.runInNewContext(prefix, { require: name => name === 'node:fs' ? {
    readFileSync: file => file.endsWith('app.log') ? appLog : file.endsWith('native-ui-receipt.json') ? JSON.stringify({ accountReadbacks }) : '{}',
  } : require(name) });
}

test('full-app runtime verifier requires an actual saved account index on both native log formats', () => {
  verify("10-31 04:18:02.335 I ReactNativeJS: '[accounts] index', 1\n");
  verify("2026-10-31 I PlatinumQA [com.facebook.react.log:javascript] '[accounts] index', 1\n");
  assert.throws(() => verify('Running main'), /real native account keychain/);
});

test('full-app runtime verifier requires the later actual account-store readback', () => {
  const success = "'[accounts] index', 1\n";
  assert.throws(() => verify(success, []), /reload the saved synthetic session/);
  assert.throws(() => verify(success, [{ passed: false, reloaded: true, accountCount: 1 }]), /reload the saved synthetic session/);
  assert.throws(() => verify(success, [{ passed: true, reloaded: false, accountCount: 1 }]), /reload the saved synthetic session/);
});

test('a caught keychain failure or native bridge crash cannot be masked by a later successful log', () => {
  const success = "'[accounts] index', 1\n";
  assert.throws(() => verify("'[accounts] save failed', 'A required entitlement is not present.'\n" + success), /real native account keychain/);
  assert.throws(() => verify("'[accounts] index failed', 'failure'\n" + success), /real native account keychain/);
  assert.throws(() => verify('Exception in HostObject::get\n' + success), /native bridge crashed/);
});
