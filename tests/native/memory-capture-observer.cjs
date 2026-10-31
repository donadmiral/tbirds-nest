const { Directory, File, Paths } = require('expo-file-system');
const Crypto = require('expo-crypto');
const { requireNativeModule } = require('expo-modules-core');
const { fixtureRuntime } = require('./fixture-runtime.cjs');
const folder = () => new Directory(Paths.document, 'native-memory-capture');
const listeners = new Set();
let status = 'Ready for the actual capture';
const receipt = { version: 1, mode: 'full-production-memory-capture', networkForwarded: false,
  nativeMemoryVersion: null, attempts: [] };
function update(next) {
  if (next) status = next;
  const directory = folder(); if (!directory.exists) directory.create();
  const file = new File(directory, 'receipt.json'); if (!file.exists) file.create();
  file.write(JSON.stringify(receipt, null, 2));
  listeners.forEach(listener => listener(status));
}
async function retain(uri, name, maximum) {
  const source = new File(uri);
  if (!source.exists || source.size < 1 || source.size > maximum) throw new Error('The actual captured evidence is missing or exceeds its bound.');
  const directory = folder(); if (!directory.exists) directory.create();
  const target = new File(directory, name); if (target.exists) throw new Error('An actual capture evidence file would be overwritten.');
  source.copy(target);
  const bytes = await target.bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return { file: name, bytes: target.size, sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') };
}
function workFiles() {
  return Paths.cache.list().filter(file => /^pc-memory-(?:work-|image-|export-)/.test(file.name)).map(file => file.uri).sort();
}
async function cleaned(attempt) {
  const deadline = Date.now() + 10000;
  while (true) {
    const leftover = workFiles().filter(uri => !attempt.baseline.includes(uri));
    const captures = attempt.captureUris.filter(uri => new File(uri).exists);
    if (!leftover.length && !captures.length) {
      attempt.cleanup = { passed: true, workFiles: 0, captureFiles: 0 };
      update('Memory capture cleanup passed'); return;
    }
    if (Date.now() > deadline) {
      attempt.cleanup = { passed: false, workFiles: leftover.length, captureFiles: captures.length };
      update('Memory capture cleanup failed'); throw new Error('The actual export left temporary files after closing.');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function observeExport(actualExport, options) {
  const fixture = fixtureRuntime();
  const attempt = { number: receipt.attempts.length + 1, baseline: workFiles(), captureUris: [], captures: [],
    progress: [], started: Date.now(), status: 'running' };
  if (attempt.baseline.length) throw new Error('A previous memory export left private temporary files.');
  receipt.nativeMemoryVersion = requireNativeModule('Boomerang').memoryMovieVersion;
  receipt.attempts.push(attempt); update('The real memory exporter is running');
  let prepared;
  try {
    prepared = await actualExport({ ...options,
      capture: async (value, signal) => {
        const uri = await options.capture(value, signal);
        attempt.captureUris.push(uri);
        try {
          const retained = await retain(uri, `attempt-${attempt.number}-capture-${String(attempt.captures.length).padStart(2, '0')}.png`, 32 * 1024 * 1024);
          attempt.captures.push({ ...retained, page: value.item.page.id, kind: value.item.kind,
            card: value.item.movie.titleCard, layer: value.layer, clock: value.clock, duration: value.item.movie.durationSec });
          update(); return uri;
        } catch (error) { try { new File(uri).delete(); } catch {} throw error; }
      },
      progress: value => { attempt.progress.push(value); update(); options.progress(value); },
    });
    await prepared.assertRights();
    attempt.movie = { ...await retain(prepared.result.uri, `attempt-${attempt.number}-movie.mp4`, 64 * 1024 * 1024),
      width: prepared.result.width, height: prepared.result.height, duration: prepared.result.duration,
      memories: prepared.memories };
    attempt.status = 'ready'; attempt.finished = Date.now(); update('The actual captured movie is ready');
    const release = () => { prepared.release(); void cleaned(attempt).catch(() => {}); };
    return { ...prepared, release };
  } catch (error) {
    prepared?.release();
    attempt.status = options.signal.aborted ? 'cancelled' : 'failed';
    attempt.error = error instanceof Error ? error.message : String(error);
    attempt.finished = Date.now();
    attempt.media = fixture.receipt.media.slice();
    await cleaned(attempt); update(); throw error;
  }
}
module.exports = { observeExport, getStatus: () => status,
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
