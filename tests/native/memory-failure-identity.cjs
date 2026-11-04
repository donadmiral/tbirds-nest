'use strict';

/** Failure-only evidence for the one packaged synthetic video. No player call,
 * network access, retained media bytes or success-path file read belongs here.
 * Native read/hash/write calls are synchronous on iOS. Their byte counts are
 * bounded, but a JavaScript timer cannot guarantee a wall-clock I/O deadline. */
const { BOOK, MEDIA, capability } = require('./memory-fixture.cjs');
const EXPECTED_BYTES = 54300;
const EXPECTED_SHA256 = 'e7a68e03487b0527b67426cf8a9a706a047a70535d571c17ead636b1806013f2';
const MAX_READ_BYTES = EXPECTED_BYTES + 1;
const MAX_RECORDS = 2;
const MAX_RECEIPT_BYTES = 8192;
const HASH_WAIT_MS = 1000;
const videoKey = Object.keys(MEDIA).find(key => MEDIA[key] === 'memory-capture-video.mp4');
const videoSource = capability(videoKey);
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const workName = new RegExp('^pc-memory-work-' + uuid + '$', 'i');
const videoName = new RegExp('^' + uuid + '\\.mp4$', 'i');
const safeNumber = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function failureKind(error) {
  try {
    if (error?.message === 'A memory video’s duration could not be read.') return 'timeout';
    if (error?.message === 'A memory video could not be read.') return 'media-error';
    if (error?.message === 'Memory movie export was cancelled.') return 'cancelled';
  } catch { /* Never emit arbitrary error data. */ }
  return 'other';
}

function createFailureIdentityObserver(deps) {
  const records = [];
  return async function observe(details) {
    let record;
    let stage = 'file-state-failed';
    try {
      if (records.length >= MAX_RECORDS || deps.platform !== 'ios'
        || deps.env.EXPO_PUBLIC_APP_ENV !== 'qa'
        || deps.env.EXPO_PUBLIC_SUPABASE_URL !== 'https://uaulhuelcfkjwojtymmw.supabase.co'
        || deps.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'native-ui-synthetic-no-provider-key'
        || details.bookId !== BOOK || details.sourceUri !== videoSource) return false;
      const fixture = deps.runtime();
      if (fixture.receipt.mode !== 'synthetic-native-ui' || fixture.receipt.networkForwarded !== false
        || !fixture.receipt.media.some(row => row.key === videoKey && row.mode === 'normal'
          && row.phase === 'complete' && row.bytes === EXPECTED_BYTES)) return false;
      const cache = deps.cacheUri().replace(/\/+$/, '') + '/';
      if (!cache.startsWith('file:///') || typeof details.directory !== 'string'
        || !details.directory.startsWith(cache) || typeof details.uri !== 'string') return false;
      const directory = details.directory.replace(/\/+$/, '');
      if (!workName.test(directory.slice(cache.length)) || !details.uri.startsWith(directory + '/')
        || !videoName.test(details.uri.slice(directory.length + 1))) return false;

      record = { sequence: records.length + 1, phase: 'duration-read-rejected',
        failureKind: failureKind(details.error), signalAborted: details.signal?.aborted === true,
        atUnixMs: safeNumber(deps.now()), afterDurationRejection: true,
        beforeExportCleanup: true, synchronousNativeIoHasWallClockBound: false,
        expectedBytes: EXPECTED_BYTES, expectedSha256: EXPECTED_SHA256,
        exists: null, sizeBefore: null, sizeAfter: null, bytesRead: null,
        sha256: null, matchesExpected: null, outcome: 'pending' };
      records.push(record); // Reserve the bounded slot before the first await.
      const file = deps.createFile(details.uri);
      record.exists = file.exists === true;
      if (!record.exists) record.outcome = 'missing';
      else {
        record.sizeBefore = safeNumber(file.size);
        if (record.sizeBefore !== EXPECTED_BYTES) record.outcome = 'unexpected-size';
        else {
          let handle;
          let bytes;
          let closed = false;
          try {
            stage = 'open-failed'; handle = file.open();
            stage = 'read-failed'; bytes = handle.readBytes(MAX_READ_BYTES);
          } finally {
            if (handle) {
              try { handle.close(); closed = true; }
              catch (error) { stage = 'close-failed'; throw error; }
            }
          }
          if (!closed) throw new Error('Unreachable synthetic read state.');
          stage = 'file-state-failed';
          record.sizeAfter = safeNumber(file.size);
          record.bytesRead = bytes instanceof Uint8Array ? safeNumber(bytes.byteLength) : null;
          if (record.sizeAfter !== record.sizeBefore) record.outcome = 'size-changed';
          else if (record.bytesRead !== EXPECTED_BYTES) record.outcome = 'unexpected-read-size';
          else {
            stage = 'hash-failed';
            let timer;
            try {
              const expired = {};
              const timeout = new Promise(resolve => { timer = deps.setTimeout(() => resolve(expired), HASH_WAIT_MS); });
              const digest = await Promise.race([Promise.resolve(deps.hash(bytes)), timeout]);
              if (digest === expired) record.outcome = 'hash-wait-timeout';
              else if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) record.outcome = 'invalid-digest';
              else {
                record.sha256 = digest;
                record.matchesExpected = digest === EXPECTED_SHA256;
                record.outcome = record.matchesExpected ? 'fixture-matched' : 'fixture-mismatch';
              }
            } finally { if (timer !== undefined) deps.clearTimeout(timer); }
          }
        }
      }
    } catch {
      if (!record) return false;
      record.outcome = stage;
    }
    try {
      record.finishedAtUnixMs = safeNumber(deps.now());
      const json = JSON.stringify({ schema: 1, mode: 'failed-synthetic-video-identity',
        maximumRecords: MAX_RECORDS, maximumReadBytes: MAX_READ_BYTES,
        asynchronousHashWaitMs: HASH_WAIT_MS, records });
      // All emitted fields are ASCII allowlisted literals, booleans and numbers.
      if (json.length <= MAX_RECEIPT_BYTES) {
        const pending = deps.write(json);
        if (pending && typeof pending.then === 'function') Promise.resolve(pending).catch(() => {});
      }
    } catch { /* Preserve the original exporter error and cleanup. */ }
    return true;
  };
}

let nativeObserver;
async function observeDurationFailure(details) {
  try {
    const { Platform } = require('react-native');
    const env = { EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY };
    if (Platform.OS !== 'ios' || env.EXPO_PUBLIC_APP_ENV !== 'qa'
      || env.EXPO_PUBLIC_SUPABASE_URL !== 'https://uaulhuelcfkjwojtymmw.supabase.co'
      || env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'native-ui-synthetic-no-provider-key') return false;
    if (!nativeObserver) {
      const { Directory, File, Paths } = require('expo-file-system');
      const Crypto = require('expo-crypto');
      const { fixtureRuntime } = require('./fixture-runtime.cjs');
      nativeObserver = createFailureIdentityObserver({ platform: Platform.OS, env, runtime: fixtureRuntime,
        cacheUri: () => Paths.cache.uri, createFile: uri => new File(uri), now: Date.now, setTimeout, clearTimeout,
        hash: async bytes => {
          const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
          return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        },
        write: json => {
          const directory = new Directory(Paths.document, 'native-memory-capture');
          if (!directory.exists) directory.create();
          const file = new File(directory, 'failed-video-file-identity.json');
          if (!file.exists) file.create();
          file.write(json);
        },
      });
    }
    return await nativeObserver(details);
  } catch { return false; }
}

module.exports = { EXPECTED_BYTES, EXPECTED_SHA256, MAX_READ_BYTES, MAX_RECORDS,
  MAX_RECEIPT_BYTES, HASH_WAIT_MS, createFailureIdentityObserver, observeDurationFailure };
