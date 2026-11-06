'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const { BOOK, MEDIA, capability } = require('../native/memory-fixture.cjs');
const identity = require('../native/memory-failure-identity.cjs');
const { memoryFailureIdentityOverlay, restoreMemoryFailureIdentityOverlay, memoryDependencyFiles } = require('../../scripts/quality/native-ui-memory-failure-overlay.cjs');
const actual = fs.readFileSync(path.join(root, 'src/services/memoryMovieExport.ts'), 'utf8');
const fixtureBytes = fs.readFileSync(path.join(root, 'tests/native/assets/memory-capture-video.mp4'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const videoKey = Object.keys(MEDIA).find(key => MEDIA[key] === 'memory-capture-video.mp4');
const env = { EXPO_PUBLIC_APP_ENV: 'qa', EXPO_PUBLIC_SUPABASE_URL: 'https://uaulhuelcfkjwojtymmw.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key' };
const directory = 'file:///cache/pc-memory-work-11111111-2222-3333-4444-555555555555';
const uri = directory + '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.mp4';
const details = { bookId: BOOK, sourceUri: capability(videoKey), uri, directory,
  signal: { aborted: false }, error: new Error('A memory video’s duration could not be read.') };

function observer(options = {}) {
  const calls = [], writes = [];
  let reads = 0;
  const file = {
    get exists() { calls.push('exists'); return options.exists ?? true; },
    get size() { calls.push('size'); return reads ? options.sizeAfter ?? identity.EXPECTED_BYTES : options.sizeBefore ?? identity.EXPECTED_BYTES; },
    open() {
      calls.push('open'); if (options.openError) throw options.openError;
      return {
        readBytes(maximum) { calls.push(['read', maximum]); reads++; if (options.readError) throw options.readError;
          return options.bytes ?? new Uint8Array(fixtureBytes); },
        close() { calls.push('close'); if (options.closeError) throw options.closeError; },
      };
    },
  };
  const fixture = { receipt: { mode: 'synthetic-native-ui', networkForwarded: false,
    media: [{ key: videoKey, phase: 'complete', mode: 'normal', bytes: identity.EXPECTED_BYTES }] } };
  const deps = { platform: 'ios', env, runtime: () => fixture, cacheUri: () => 'file:///cache/',
    createFile(value) { calls.push(['file', value]); options.onFile?.(); return file; },
    now: () => 123, setTimeout, clearTimeout,
    hash(bytes) { calls.push(['hash', bytes.length]); if (options.hashError) throw options.hashError;
      return options.hash ? options.hash(bytes) : sha(bytes); },
    write(value) { calls.push('write'); writes.push(JSON.parse(value)); if (options.writeError) throw options.writeError; },
    ...options.deps,
  };
  return { observe: identity.createFailureIdentityObserver(deps), calls, writes, deps, fixture };
}

test('the diagnostic binds the exact packaged bytes and records only a bounded failed-file fingerprint', async () => {
  assert.equal(fixtureBytes.length, identity.EXPECTED_BYTES);
  assert.equal(sha(fixtureBytes), identity.EXPECTED_SHA256);
  const r = observer(); assert.equal(await r.observe(details), true);
  assert.deepEqual(r.calls, [['file', uri], 'exists', 'size', 'open', ['read', 54301], 'close', 'size', ['hash', 54300], 'write']);
  const receipt = r.writes[0], row = receipt.records[0];
  assert.equal(row.outcome, 'fixture-matched'); assert.equal(row.matchesExpected, true);
  assert.equal(row.sha256, identity.EXPECTED_SHA256); assert.equal(row.sizeBefore, 54300); assert.equal(row.sizeAfter, 54300);
  assert.equal(row.bytesRead, 54300); assert.equal(row.failureKind, 'timeout');
  assert.equal(row.afterDurationRejection, true); assert.equal(row.beforeExportCleanup, true);
  assert.equal(row.synchronousNativeIoHasWallClockBound, false);
  assert.equal(receipt.asynchronousHashWaitMs, 1000);
});

for (const [name, change] of [
  ['Android', r => { r.deps.platform = 'android'; }],
  ['production', r => { r.deps.env = { ...env, EXPO_PUBLIC_APP_ENV: 'production' }; }],
  ['provider credential', r => { r.deps.env = { ...env, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'private-provider-token' }; }],
  ['different project', r => { r.deps.env = { ...env, EXPO_PUBLIC_SUPABASE_URL: 'https://private.invalid' }; }],
  ['missing fixture', r => { r.deps.runtime = () => { throw Error('missing'); }; }],
  ['different fixture mode', r => { r.fixture.receipt.mode = 'live-provider'; }],
  ['forwarded network', r => { r.fixture.receipt.networkForwarded = true; }],
  ['incomplete synthetic download', r => { r.fixture.receipt.media[0].phase = 'chunk'; }],
  ['cancel fixture', r => { r.fixture.receipt.media[0].mode = 'cancel'; }],
  ['wrong completed size', r => { r.fixture.receipt.media[0].bytes = 1024; }],
]) test(name + ' never inspects a local file', async () => {
  const r = observer(); change(r); assert.equal(await r.observe(details), false);
  assert.deepEqual(r.calls, []); assert.deepEqual(r.writes, []);
});

for (const [name, value] of [
  ['another book', { bookId: 'private-book' }],
  ['another source', { sourceUri: capability(Object.keys(MEDIA)[0]) }],
  ['arbitrary source', { sourceUri: 'https://private.invalid/?token=secret' }],
  ['outside cache', { directory: directory.replace('/cache/', '/Documents/') }],
  ['nested work directory', { directory: directory + '/child', uri: directory + '/child/a.mp4' }],
  ['path traversal', { uri: directory + '/../aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.mp4' }],
  ['another work directory', { uri: uri.replace('11111111', '99999999') }],
  ['query', { uri: uri + '?private=value' }],
  ['wrong extension', { uri: uri.replace('.mp4', '.png') }],
]) test(name + ' never inspects a local file', async () => {
  const r = observer(); assert.equal(await r.observe({ ...details, ...value }), false);
  assert.deepEqual(r.calls, []); assert.deepEqual(r.writes, []);
});

for (const [name, options, outcome] of [
  ['missing', { exists: false }, 'missing'],
  ['short size', { sizeBefore: 1024 }, 'unexpected-size'],
  ['oversized', { sizeBefore: 54301 }, 'unexpected-size'],
  ['changed size', { sizeAfter: 54301 }, 'size-changed'],
  ['short read', { bytes: new Uint8Array(1024) }, 'unexpected-read-size'],
  ['one extra byte', { bytes: new Uint8Array(54301) }, 'unexpected-read-size'],
  ['wrong bytes', { bytes: new Uint8Array(54300) }, 'fixture-mismatch'],
  ['open failure', { openError: Error('private path') }, 'open-failed'],
  ['read failure', { readError: Error('private path') }, 'read-failed'],
  ['close failure', { closeError: Error('private path') }, 'close-failed'],
  ['hash failure', { hashError: Error('private bytes') }, 'hash-failed'],
  ['malformed digest', { hash: () => 'private-token' }, 'invalid-digest'],
]) test(name + ' is classified without changing the exporter outcome', async () => {
  const r = observer(options); assert.equal(await r.observe(details), true);
  assert.equal(r.writes[0].records[0].outcome, outcome);
  assert.equal(JSON.stringify(r.writes).includes('private'), false);
  if (outcome === 'unexpected-size' || outcome === 'missing') assert.equal(r.calls.includes('open'), false);
  if (options.readError) assert.equal(r.calls.filter(x => x === 'close').length, 1);
  if (outcome !== 'fixture-mismatch' && outcome !== 'invalid-digest' && outcome !== 'hash-failed') {
    assert.equal(r.calls.some(x => Array.isArray(x) && x[0] === 'hash'), false);
  }
});

test('an unresolved hash uses a bounded asynchronous wait and still closes the file first', async () => {
  let fire;
  const r = observer({ hash: () => new Promise(() => {}), deps: {
    setTimeout(fn, ms) { assert.equal(ms, 1000); fire = fn; return 7; }, clearTimeout(id) { assert.equal(id, 7); },
  } });
  const pending = r.observe(details); assert.equal(r.calls.includes('close'), true);
  fire(); await pending;
  assert.equal(r.writes[0].records[0].outcome, 'hash-wait-timeout');
  assert.equal(r.writes[0].records[0].synchronousNativeIoHasWallClockBound, false);
});

test('retention is capped, output is allowlisted, and diagnostic writes cannot escape', async () => {
  const r = observer(); const secret = 'private-uri-account-token-text';
  const extra = { ...details, error: Error(secret), private: secret,
    get player() { throw Error('No player access'); }, get payload() { throw Error('No payload access'); } };
  await r.observe(extra); await r.observe(extra); assert.equal(await r.observe(extra), false);
  assert.equal(r.calls.filter(x => Array.isArray(x) && x[0] === 'file').length, 2);
  const encoded = JSON.stringify(r.writes.at(-1)); assert.ok(encoded.length < identity.MAX_RECEIPT_BYTES);
  for (const value of [secret, details.sourceUri, uri, directory, BOOK, videoKey]) assert.equal(encoded.includes(value), false);
  const allowed = new Set(['sequence', 'phase', 'failureKind', 'signalAborted', 'atUnixMs', 'afterDurationRejection',
    'beforeExportCleanup', 'synchronousNativeIoHasWallClockBound', 'expectedBytes', 'expectedSha256', 'exists',
    'sizeBefore', 'sizeAfter', 'bytesRead', 'sha256', 'matchesExpected', 'outcome', 'finishedAtUnixMs']);
  for (const row of r.writes.at(-1).records) assert.ok(Object.keys(row).every(key => allowed.has(key)));
  const broken = observer({ writeError: Error(secret) }); await assert.doesNotReject(broken.observe(details));
  const rejected = observer({ deps: { write: () => Promise.reject(Error(secret)) } });
  await assert.doesNotReject(rejected.observe(details)); await new Promise(resolve => setImmediate(resolve));
});

function declarations(source) {
  const ast = ts.createSourceFile('memoryMovieExport.ts', source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['videoDuration', 'exportNativeMemoryMovie'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
}

function exporter(source, options = {}) {
  const calls = []; let disposed = false, playerReleased = false, observerImports = 0;
  const marker = options.error ?? Error('A memory video’s duration could not be read.');
  const book = { pages: [{ id: 'synthetic-video', media_type: 'video' }], film_settings: {}, soundtrack: null };
  class File { constructor(...parts) { this.uri = parts.join('/'); } get exists() { return false; } delete() { calls.push('file-delete'); } }
  class MemoryMovieFiles {
    constructor() { this.directory = { uri: directory }; }
    check() {}
    async download() { calls.push('download'); return uri; }
    dispose() { assert.equal(disposed, false); disposed = true; calls.push('work-delete'); }
  }
  const r = observer({ onFile() { assert.equal(playerReleased, true); assert.equal(disposed, false); calls.push('diagnostic-file'); } });
  const actualResult = { uri: 'synthetic-output', width: 720, height: 1280, duration: 3 };
  const module = { exports: {} };
  const globals = { module, exports: module.exports, AbortController, console,
    setInterval: () => 1, clearInterval: () => { calls.push('timer-clear'); },
    remove: () => {}, File, Paths: { cache: 'file:///cache' }, Crypto: { randomUUID: () => 'fixture' },
    MemoryMovieFiles, supabase: {}, contentObject: () => ({ key: videoKey }), SUPABASE_URL: env.EXPO_PUBLIC_SUPABASE_URL,
    createVideoPlayer(value) { assert.equal(value, uri); calls.push('player-create');
      return { status: options.fail ? 'loading' : 'readyToPlay', duration: 3,
        set muted(value) { assert.equal(value, true); calls.push('mute'); }, pause() { calls.push('pause'); },
        addListener(name) { calls.push(['listen', name]); return { remove() { calls.push(['remove', name]); } }; },
        release() { assert.equal(playerReleased, false); playerReleased = true; calls.push('player-release'); },
      }; },
    memoryMovieStep(work, signal, label) { return options.fail && label === 'A memory video’s duration could not be read.' ? Promise.reject(marker) : work; },
    openMemoryMovieAccess: async () => ({ book, check: async () => book, stop() { calls.push('access-stop'); } }),
    planMemoryMovie: () => ({ scenes: [{ kind: 'video', sourceIndex: 0 }], selectedCount: 1, estimated: false }),
    memoryFilmItems: () => [{ id: 'synthetic-video', uri: details.sourceUri }],
    memoryMovieLimit: () => null, hydrateMemoryAlbumMedia: async () => [book], memoryMovieTimeline: () => [],
    readSoundtrack: () => null, validateMemoryMovieRequest: () => {}, composeMemoryMovie: async () => actualResult,
    require(name) { assert.equal(name, '../../tests/native/memory-failure-identity.cjs'); observerImports++;
      if (options.importError) throw options.importError;
      return { observeDurationFailure(value) {
        assert.equal(value.error, marker); assert.equal(playerReleased, true); assert.equal(disposed, false);
        calls.push('observe'); if (options.observerError) throw options.observerError;
        return r.observe(value);
      } }; },
  };
  const compiled = ts.transpileModule(declarations(source), { reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.deepEqual(compiled.diagnostics?.filter(row => row.category === ts.DiagnosticCategory.Error), []);
  vm.runInNewContext(compiled.outputText, globals);
  const run = () => module.exports.exportNativeMemoryMovie({ bookId: BOOK, expected: {}, signal: new AbortController().signal,
    originalAudio: true, scoreVolume: null, reduceMotion: false, capture() { throw Error('No capture in this scoped harness'); },
    progress() {}, onInvalid() {} });
  return { run, calls, r, marker, actualResult, state: () => ({ disposed, playerReleased, observerImports }) };
}

test('the overlay reverses exactly and keeps the duration helper and outer cleanup byte-identical', () => {
  const generated = memoryFailureIdentityOverlay(actual);
  assert.equal(restoreMemoryFailureIdentityOverlay(generated), actual);
  assert.throws(() => memoryFailureIdentityOverlay(generated), /unchanged memory duration/);
  assert.throws(() => memoryFailureIdentityOverlay(actual.replace('await videoDuration(uri,signal)', 'await changed(uri,signal)')), /unchanged memory duration/);
  const duration = source => declarations(source).split('/** All sources')[0].split('export async function')[0];
  assert.equal(duration(generated), duration(actual));
  assert.equal(generated.includes('}catch(error){release();throw error;}finally{if(!finished)release();}'), true);
});

test('the real exporter success path never imports the diagnostic or reads/hashes evidence', async () => {
  const before = exporter(actual), after = exporter(memoryFailureIdentityOverlay(actual));
  const a = await before.run(), b = await after.run();
  assert.equal(a.result, before.actualResult); assert.equal(b.result, after.actualResult);
  assert.equal(a.memories, b.memories); assert.deepEqual(before.calls, after.calls);
  assert.equal(after.state().observerImports, 0); assert.deepEqual(after.r.calls, []);
  a.release(); b.release(); assert.deepEqual(before.calls, after.calls);
  assert.equal(after.calls.filter(x => x === 'work-delete').length, 1);
});

test('the actual duration failure releases its player before inspection and deletes work after identical error rethrow', async () => {
  const r = exporter(memoryFailureIdentityOverlay(actual), { fail: true });
  await assert.rejects(r.run(), error => error === r.marker);
  assert.ok(r.calls.indexOf('player-release') < r.calls.indexOf('diagnostic-file'));
  assert.ok(r.calls.indexOf('diagnostic-file') < r.calls.indexOf('work-delete'));
  assert.equal(r.calls.filter(x => x === 'player-release').length, 1);
  assert.equal(r.calls.filter(x => x === 'work-delete').length, 1);
  assert.equal(r.r.writes[0].records[0].outcome, 'fixture-matched');
});

for (const failure of ['importError', 'observerError']) test(failure + ' leaves the actual error and cleanup intact', async () => {
  const r = exporter(memoryFailureIdentityOverlay(actual), { fail: true, [failure]: Error('diagnostic failure') });
  await assert.rejects(r.run(), error => error === r.marker);
  assert.equal(r.calls.filter(x => x === 'player-release').length, 1);
  assert.equal(r.calls.filter(x => x === 'work-delete').length, 1);
});

test('dependency provenance points to installed JS and native implementations without modifying them', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'))).packages;
  for (const [name, files] of Object.entries(memoryDependencyFiles)) {
    const packageRoot = path.join(root, 'node_modules', name);
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json')));
    assert.equal(manifest.version, lock['node_modules/' + name].version);
    assert.ok(files.includes(manifest.main));
    for (const file of files) assert.match(sha(fs.readFileSync(path.join(packageRoot, file))), /^[0-9a-f]{64}$/);
  }
});

test('simultaneous failures reserve only two records before hashing completes', async () => {
  const finish = [];
  const r = observer({ hash: () => new Promise(resolve => finish.push(resolve)) });
  const first = r.observe(details), second = r.observe(details);
  assert.equal(await r.observe(details), false); assert.equal(finish.length, 2);
  finish[1](identity.EXPECTED_SHA256); finish[0](identity.EXPECTED_SHA256);
  await Promise.all([first, second]);
  assert.equal(r.writes.at(-1).records.length, 2);
  assert.ok(r.writes.at(-1).records.every(row => row.outcome === 'fixture-matched'));
});

function nativeObserver(platform = 'ios', settings = env) {
  const module = { exports: {} }, calls = [], writes = [];
  const fixture = { receipt: { mode: 'synthetic-native-ui', networkForwarded: false,
    media: [{ key: videoKey, phase: 'complete', mode: 'normal', bytes: 54300 }] } };
  class Directory {
    constructor(parent, name) { this.uri = parent + '/' + name; }
    get exists() { return true; }
  }
  class File {
    constructor(parent, name) { this.uri = name ? parent.uri + '/' + name : parent; calls.push(['file', this.uri]); }
    get exists() { return this.uri === uri; }
    get size() { assert.equal(this.uri, uri); return 54300; }
    open() { return { readBytes(maximum) { calls.push(['read', maximum]); return new Uint8Array(fixtureBytes); }, close() { calls.push('close'); } }; }
    create() { calls.push('receipt-create'); }
    write(value) { calls.push('receipt-write'); writes.push(JSON.parse(value)); }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'tests/native/memory-failure-identity.cjs'), 'utf8'), {
    module, exports: module.exports, process: { env: settings }, Date, Uint8Array, setTimeout, clearTimeout,
    require(name) {
      calls.push(['require', name]);
      if (name === './memory-fixture.cjs') return require('../native/memory-fixture.cjs');
      if (name === 'react-native') return { Platform: { OS: platform } };
      if (name === 'expo-file-system') return { Directory, File, Paths: { cache: { uri: 'file:///cache/' }, document: 'file:///documents' } };
      if (name === 'expo-crypto') return { CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
        async digest(algorithm, bytes) { assert.equal(algorithm, 'SHA-256'); calls.push(['digest', bytes.byteLength]);
          const result = crypto.createHash('sha256').update(bytes).digest();
          return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength); } };
      if (name === './fixture-runtime.cjs') return { fixtureRuntime: () => fixture };
      throw Error('Unexpected diagnostic module');
    },
  });
  return { api: module.exports, calls, writes };
}

test('the native wrapper uses public File and Crypto APIs and the existing artifact folder only', async () => {
  const r = nativeObserver(); await r.api.observeDurationFailure(details);
  assert.equal(r.writes[0].records[0].sha256, identity.EXPECTED_SHA256);
  assert.deepEqual(r.calls.filter(x => Array.isArray(x) && x[0] === 'file'), [
    ['file', uri], ['file', 'file:///documents/native-memory-capture/failed-video-file-identity.json'],
  ]);
  assert.equal(r.calls.filter(x => Array.isArray(x) && x[0] === 'digest').length, 1);
});

for (const [name, platform, settings] of [
  ['Android', 'android', env],
  ['production', 'ios', { ...env, EXPO_PUBLIC_APP_ENV: 'production' }],
  ['real key', 'ios', { ...env, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'private-provider-key' }],
  ['other project', 'ios', { ...env, EXPO_PUBLIC_SUPABASE_URL: 'https://private.invalid' }],
]) test('native wrapper rejects ' + name + ' before loading file/crypto bindings', async () => {
  const r = nativeObserver(platform, settings); assert.equal(await r.api.observeDurationFailure(details), false);
  assert.equal(r.calls.some(x => Array.isArray(x) && ['expo-file-system', 'expo-crypto'].includes(x[1])), false);
  assert.deepEqual(r.writes, []);
});
