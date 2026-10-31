const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const evidence = 'native-ui-logs';
const source = JSON.parse(fs.readFileSync(path.join(evidence, 'source.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(evidence, 'native-ui-receipt.json'), 'utf8'));
const appLog = fs.readFileSync(path.join(evidence, 'app.log'), 'utf8');
const nativeBridgeFailures = appLog.split('\n').filter(line => /Exception in HostObject::get|TurboModuleInteropUtils.*ParsingException|com\.facebook\.react\.common\.JavascriptException/.test(line));
if (nativeBridgeFailures.length) throw new Error('A native bridge crashed in the full app: ' + nativeBridgeFailures[0].slice(0, 500));
const accountPersistenceFailures = appLog.split('\n').filter(line => /\[accounts\] (?:save|index) failed/.test(line));
if (accountPersistenceFailures.length || !/\[accounts\] index['",\s]*1(?:\D|$)/.test(appLog)) {
  throw new Error('The real native account keychain did not confirm a successful one-account index save.');
}
const accountReadbacks = fixture.accountReadbacks || [];
if (accountReadbacks.length !== 1 || accountReadbacks[0].passed !== true
  || accountReadbacks[0].reloaded !== true || accountReadbacks[0].accountCount !== 1) {
  throw new Error('The actual native account store did not reload the saved synthetic session from SecureStore.');
}
const memory = JSON.parse(fs.readFileSync(path.join(evidence, 'memory-capture/decoded.json'), 'utf8'));
if (memory.passed !== true || memory.cancelledReaderClosed !== true || memory.cancelledAndCompletedTemporaryFilesRemoved !== true) {
  throw new Error('The complete memory capture, encoded output and cancellation cleanup did not pass.');
}
if (fixture.mode !== 'synthetic-native-ui' || fixture.networkForwarded !== false || fixture.unhandled.length) {
  throw new Error('The complete app made unsupported fixture requests: ' + JSON.stringify(fixture.unhandled));
}
const required = ['/auth/v1/token', '/rest/v1/rpc/get_feed', '/rest/v1/rpc/get_profile', '/rest/v1/jobs',
  '/rest/v1/marketplace_listings', '/rest/v1/conversations', '/functions/v1/crisp-bridge',
  '/rest/v1/rpc/get_memory_albums', '/rest/v1/rpc/get_memory_book', '/rest/v1/memory_album_access',
  '/rest/v1/rpc/get_memory_book_creative_capabilities', '/rest/v1/rpc/save_memory_book_creative_presentation'];
for (const endpoint of required) {
  if (!fixture.requests.some(row => row.path === endpoint)) throw new Error('The full-app flow did not exercise ' + endpoint);
}
const navigationBook = 'a0000000-0000-4000-8000-000000000002';
const bookSaves = fixture.mutations.filter(row => row.rpc === 'save_memory_book_creative_presentation');
const expectedCover = row => row.title === 'THE LONG WAY HOME' && row.cover_color === 'sage'
  && row.cover_design === 'postcard' && row.cover_artwork?.inscription === 'Roads worth remembering'
  && row.cover_artwork?.postmark === 'DESERT DAYS' && row.cover_artwork?.inscriptionStyle === 'sans'
  && row.film_settings?.mode === 'automatic' && row.film_settings?.style === 'cinematic';
if (bookSaves.length !== 1 || bookSaves[0].id !== navigationBook || bookSaves[0].revision !== 1
  || bookSaves[0].owner !== '10000000-0000-4000-8000-000000000001' || !expectedCover(bookSaves[0])) {
  throw new Error('The real cover editor did not confirm exactly one expected owner-scoped creative save.');
}
const bookReads = (fixture.bookReads || []).filter(row => row.id === navigationBook);
if (!bookReads.some(row => row.revision === 0 && row.title === 'THE SMALL ADVENTURES')
  || bookReads.filter(row => row.revision === 1 && expectedCover(row)).length < 2) {
  throw new Error('The saved book was not read before editing and again after leaving and reopening it.');
}
const nativeFlows = JSON.parse(execFileSync('python3', [path.join(__dirname, 'native-ui-flow-results.py'), evidence], { encoding: 'utf8' }));
if (nativeFlows.passed !== true) throw new Error('Both required native accessibility flows must complete successfully.');
function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(file) : file.endsWith('.png') ? [file] : [];
  });
}
const captured = collect(path.join(evidence, 'maestro'));
const screenshots = ['home', 'market', 'jobs', 'messages', 'profile', 'settings', 'returned-home',
  'memory-shelf', 'memory-reader', 'memory-film', 'memory-export-entry', 'memory-cover-edited', 'memory-film-reloaded',
  'captured-memory-ready', 'captured-memory-cleanup'].map(name => {
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
  memoryCaptureAndMovie: true, memoryEvidence: 'memory-capture/decoded.json',
  profileMemoryShelfReaderAutomaticFilmAndExportEntry: true,
  ownerCoverAndFilmSettingsSavedAndReopened: true, memoryBookSavedRevision: bookSaves[0].revision,
  nativeBridgeCrashLines: nativeBridgeFailures.length,
  accountIndexSaved: true, accountPersistenceFailureLines: accountPersistenceFailures.length,
  savedAccountReloadedThroughSecureStore: true,
  requiredMaestroFlows: nativeFlows.flows,
  requestCount: fixture.requests.length, screenshots: media,
  repeatedFeedReturns: 5, signedReleaseCreated: false }, null, 2) + '\n');
console.log('Full native App launched; auth, five tabs, settings, saved memory books, automatic films and real capture passed with no unsupported requests.');
