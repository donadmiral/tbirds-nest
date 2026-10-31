const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

test('Simulator entitlement reader verifies actual Mach-O/plist fixtures and rejects missing or mismatched identities', () => {
  execFileSync('python3', ['tests/native/test_simulator_entitlements.py', '-v'], {
    cwd: root, encoding: 'utf8', timeout: 10000, stdio: 'pipe',
  });
});

const script = fs.readFileSync(path.join(root, 'scripts/quality/test-ios-app-ui.sh'), 'utf8');
const blocks = [...script.matchAll(/python3 - <<'PY'\n([\s\S]*?)\nPY/g)].map(match => match[1])
  .filter(source => source.includes('simulator-host-entitlements'));
assert.equal(blocks.length, 1, 'exercise the actual before/after signing check');

for (const scenario of ['valid', 'empty-host', 'changed-embedded', 'non-adhoc', 'host-app-entitlement']) {
  test('actual Simulator signing check: ' + scenario, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-qa-signing-'));
    const logs = path.join(directory, 'native-ui-logs'); fs.mkdirSync(logs);
    try {
      const before = { embeddedSections: { __entitlements: { sha256: 'same' }, __ents_der: { sha256: 'same-der' } },
        simulatedEntitlements: { 'application-identifier': 'local.app.platinumcircles.mobile.qa' } };
      const after = structuredClone(before);
      if (scenario === 'changed-embedded') after.embeddedSections.__ents_der.sha256 = 'changed';
      fs.writeFileSync(path.join(logs, 'simulator-entitlements-before-resign.json'), JSON.stringify(before));
      fs.writeFileSync(path.join(logs, 'simulator-entitlements.json'), JSON.stringify(after));
      for (const suffix of ['-before-resign', '']) {
        fs.writeFileSync(path.join(logs, 'simulator-signature' + suffix + '.log'),
          scenario === 'non-adhoc' && !suffix ? 'Authority=Developer' : 'Signature=adhoc');
        const host = scenario === 'empty-host' ? '' : scenario === 'host-app-entitlement' && !suffix
          ? '<plist version="1.0"><dict><key>application-identifier</key><string>wrong</string></dict></plist>'
          : '<plist version="1.0"><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>';
        fs.writeFileSync(path.join(logs, 'simulator-host-entitlements' + suffix + '.plist'), host);
      }
      const run = () => execFileSync('python3', ['-c', blocks[0]], { cwd: directory, encoding: 'utf8', timeout: 10000, stdio: 'pipe' });
      if (scenario === 'valid' || scenario === 'empty-host') run();
      else assert.throws(run, /Ad-hoc signing changed|Expected only local ad-hoc|Unexpected application entitlements/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
}
