/** Run only after prepare-native-ui.cjs in a disposable audit checkout. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const manifest = require('../../tests/native/audit/manifest.json');
if (process.env.CI !== 'true' || process.env.EXPO_PUBLIC_APP_ENV !== 'qa'
  || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'native-ui-synthetic-no-provider-key') throw new Error('Synthetic QA-only audit preparation required.');
if (!/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '')) throw new Error('Bind the audit to the exact frozen CI commit.');
if (fs.existsSync('ios') || fs.existsSync('android')) throw new Error('Prepare the audit before native prebuild.');
const receipt = JSON.parse(fs.readFileSync('native-ui-logs/source.json', 'utf8'));
if (receipt.audit) throw new Error('Refusing a repeated audit overlay.');
if (receipt.commit !== process.env.GITHUB_SHA) throw new Error('Base preparation and audit commit disagree.');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const overlays = [];
function exact(file, from, to) {
  const before = fs.readFileSync(file, 'utf8');
  if (before.split(from).length !== 2) throw new Error('Expected one reviewed audit anchor: ' + file);
  const after = before.replace(from, to);
  const retained = 'overlays/audit__' + file.replaceAll('/', '__');
  fs.writeFileSync('native-ui-logs/' + retained, after);
  fs.writeFileSync(file, after);
  overlays.push({ file, before: hash(before), after: hash(after), retained });
}
exact('tests/native/entry.js', "from './backend-fixture.cjs'", "from './audit/backend-fixture.cjs'");
exact('tests/native/entry.js', "require('@daily-co/react-native-daily-js');",
  "require('@daily-co/react-native-daily-js');\nfixture.persistAuditBaseline();");
exact('src/navigation/AppNavigator.tsx', '<RootStack.Screen name="Main" component={MainTabsWithListener} />',
  '<RootStack.Screen name="NativeAuditLauncher" component={require(\'../../tests/native/audit/AuditLauncherScreen\').default} />\n              <RootStack.Screen name="Main" component={MainTabsWithListener} />');
receipt.audit = { mode: 'direct-route-entry-and-independent-journeys', applicationSourceCommit: process.env.GITHUB_SHA,
  manifestSha256: hash(fs.readFileSync('tests/native/audit/manifest.json')), overlays,
  inputs: Object.fromEntries(['scripts/quality/prepare-native-ui-audit.cjs', 'scripts/quality/native-ui-audit-runner.py',
    'scripts/quality/native-ui-audit-binary.py', 'tests/native/audit/manifest.json'].map(file => [file, hash(fs.readFileSync(file))])),
  limits: manifest.limits };
fs.writeFileSync('native-ui-logs/source.json', JSON.stringify(receipt, null, 2) + '\n');
console.log('Prepared independent QA audit entry without changing production providers or hosted transports.');
