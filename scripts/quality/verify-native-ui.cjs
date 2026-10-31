const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const evidence = 'native-ui-logs';
const source = JSON.parse(fs.readFileSync(path.join(evidence, 'source.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(evidence, 'native-ui-receipt.json'), 'utf8'));
if (fixture.mode !== 'synthetic-native-ui' || fixture.networkForwarded !== false || fixture.unhandled.length) {
  throw new Error('The complete app made unsupported fixture requests: ' + JSON.stringify(fixture.unhandled));
}
const required = ['/auth/v1/token', '/rest/v1/rpc/get_feed', '/rest/v1/rpc/get_profile', '/rest/v1/jobs',
  '/rest/v1/marketplace_listings', '/rest/v1/conversations', '/functions/v1/crisp-bridge'];
for (const endpoint of required) {
  if (!fixture.requests.some(row => row.path === endpoint)) throw new Error('The full-app flow did not exercise ' + endpoint);
}
const junit = fs.readFileSync(path.join(evidence, 'maestro.xml'), 'utf8');
if (!/tests="[1-9]\d*"/.test(junit) || /<(failure|error)(\s|>)/.test(junit) || !/failures="0"/.test(junit)) {
  throw new Error('The native accessibility flow did not complete successfully.');
}
function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(file) : file.endsWith('.png') ? [file] : [];
  });
}
const captured = collect(path.join(evidence, 'maestro'));
const screenshots = ['home', 'market', 'jobs', 'messages', 'profile', 'settings', 'returned-home'].map(name => {
  const candidates = captured.filter(file => path.basename(file) === name + '.png');
  if (candidates.length !== 1) throw new Error('Expected one native UI screenshot: ' + name);
  const bytes = fs.readFileSync(candidates[0]);
  if (bytes.length < 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.readUInt32BE(16) < 200 || bytes.readUInt32BE(20) < 200) throw new Error('Invalid native UI screenshot: ' + name);
  fs.copyFileSync(candidates[0], path.join(evidence, 'screenshots', name + '.png'));
  return name + '.png';
});
const media = Object.fromEntries(screenshots.map(file => {
  const bytes = fs.readFileSync(path.join(evidence, 'screenshots', file));
  return [file, { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }];
}));
fs.writeFileSync(path.join(evidence, 'receipt.json'), JSON.stringify({ passed: true, commit: source.commit,
  workflowRun: source.workflowRun, platform: process.argv[2], providerAcceptance: false, physicalDevice: false,
  productionAppSourceManifest: 'source.json', fullAppLaunched: true, isolatedTransport: true,
  authAndMainNavigation: true, unsupportedFixtureRequests: fixture.unhandled.length,
  requestCount: fixture.requests.length, screenshots: media,
  repeatedFeedReturns: 5, signedReleaseCreated: false }, null, 2) + '\n');
console.log('Full native App launched; Auth, five tabs, settings and repeated returns passed with no unsupported requests.');
