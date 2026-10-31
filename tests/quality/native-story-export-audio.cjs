const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const soundId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const sourceId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const base = 'https://qa.example.supabase.co';
const delivery = base + '/functions/v1/media-content/music-audio/owner/track.wav?token=' + 'c'.repeat(64);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function wav(seconds = 2) {
  const rate = 8000, samples = rate * seconds, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * 880 * Math.PI * 2) * 4000), 44 + i * 2);
  return bytes;
}
function modules(imports) {
  const cache = new Map();
  const load = file => {
    const absolute = path.resolve(root, file); if (cache.has(absolute)) return cache.get(absolute);
    const exports = {}; cache.set(absolute, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, AbortController, URL, setTimeout, clearTimeout,
      require(name) { if (name in imports) return imports[name]; const relative = path.resolve(path.dirname(absolute), name); if (name.startsWith('.') && fs.existsSync(relative + '.ts')) return load(relative + '.ts'); throw Error('Unexpected import ' + name); },
    }); return exports;
  }; return load;
}
function harness(options = {}) {
  const voiceUri = 'file:///drafts/voice.wav', files = new Map([[voiceUri, options.voiceBytes || wav()]]), events = [], listeners = new Set();
  let owner = 'owner', revoked = false, active = true, authorized = 0, unsubscribe = 0;
  const data = { id: soundId, title: 'Original', url: base + '/storage/v1/object/public/music-audio/owner/track.wav', source: 'original', duration_sec: 2, max_excerpt_sec: 2 };
  const fileSystem = {
    cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' }, FileSystemSessionType: { FOREGROUND: 1 },
    async getInfoAsync(uri) { events.push(['stat', uri]); const value = files.get(uri); return value ? { exists: true, isDirectory: false, size: options.reportSize || value.length } : { exists: false }; },
    async readAsStringAsync(uri) { events.push(['read', uri]); return files.get(uri).toString('base64'); },
    async copyAsync({ from, to }) { events.push(['copy', from, to]); files.set(to, Buffer.from(files.get(from))); },
    async moveAsync({ from, to }) { events.push(['move', from, to]); files.set(to, files.get(from)); files.delete(from); },
    async deleteAsync(uri) { events.push(['delete', uri]); files.delete(uri); },
    createDownloadResumable(url, uri, settings, progress) {
      events.push(['download', url, settings]);
      return { cancelAsync: async () => { events.push(['cancel-download']); }, downloadAsync: async () => {
        if (options.beforeDownload) await options.beforeDownload();
        if (options.progressBytes) progress({ totalBytesWritten: options.progressBytes, totalBytesExpectedToWrite: options.progressBytes });
        files.set(uri, options.downloadBytes || wav());
        return { uri, status: options.status || 200 };
      } };
    },
  };
  const api = modules({
    'expo-file-system/legacy': fileSystem, 'expo-crypto': { randomUUID: () => sourceId },
    'base64-arraybuffer': { decode(value) { const buf = Buffer.from(value, 'base64'); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); } },
    './supabase': { SUPABASE_URL: base, supabase: { auth: {
      getSession: async () => ({ data: { session: { user: { id: owner } } }, error: null }),
      onAuthStateChange(listener) { listeners.add(listener); return { data: { subscription: { unsubscribe() { unsubscribe++; listeners.delete(listener); } } } }; },
    } } },
    './contentMedia': { hydrateSoundMedia: async rows => rows.map(row => ({ ...row, url: options.delivery || delivery })) },
    '../../shared/musicExportAuthorization': { authorizeLibraryAudioExport: async (_client, selection, use) => {
      authorized++; events.push(['rights', selection, use]);
      if (revoked) throw Error('Rights revoked');
      return data;
    } },
  })('src/services/storyExportAudio.ts');
  const controller = new AbortController();
  const prepare = (audio = { kind: 'sound', soundId, startSec: .25, durationSec: 1 }, volume = .4) => api.prepareStoryExportAudio(audio, volume, 'owner', controller.signal, () => { if (!active) throw Error('Draft changed'); });
  return { files, events, data, voiceUri, prepare, controller, revoke() { revoked = true; }, moveDraft() { active = false; },
    switch(next) { owner = next; for (const listener of listeners) listener(next ? 'SIGNED_IN' : 'SIGNED_OUT', next ? { user: { id: next } } : null); },
    get authorized() { return authorized; }, get unsubscribe() { return unsubscribe; },
  };
}

test('native library export stages a private verified excerpt, rechecks rights, and removes only its own files', async () => {
  const h = harness(), prepared = await h.prepare();
  assert.equal(prepared.layer.start, .25); assert.equal(prepared.layer.duration, 1); assert.equal(prepared.layer.volume, .4); assert.equal(prepared.layer.loop, true);
  assert.match(prepared.layer.uri, /^file:\/\/\/cache\/pc-story-audio-.*\.wav$/);
  const transfer = h.events.find(event => event[0] === 'download'); assert.equal(transfer[2].cache, false); assert.equal(transfer[2].sessionType, 1);
  assert.equal(h.authorized, 2); await prepared.assertRights(); assert.equal(h.authorized, 3);
  await prepared.release(); assert.deepEqual([...h.files.keys()], [h.voiceUri]); assert.equal(h.unsubscribe, 1);
});

test('native own voiceover uses one pass and never deletes the draft recording', async () => {
  const h = harness(), prepared = await h.prepare({ kind: 'voiceover', localUri: h.voiceUri, durationSec: 2, rightsAttested: true });
  assert.equal(prepared.layer.loop, false); assert.equal(prepared.layer.start, 0); assert.equal(h.authorized, 0);
  await prepared.assertRights(); await prepared.release(); assert.deepEqual([...h.files.keys()], [h.voiceUri]);
});

test('native voiceover refuses missing attestation and unverified remote sources', async () => {
  for (const audio of [{ kind: 'voiceover', localUri: 'file:///drafts/voice.wav' }, { kind: 'voiceover', url: delivery, rightsAttested: true }]) {
    const h = harness(); await assert.rejects(h.prepare(audio), /confirmed publication rights/);
    assert.equal(h.events.some(event => event[0] === 'download' || event[0] === 'copy'), false); assert.equal(h.unsubscribe, 1);
  }
});

test('native export refuses public/signed storage and foreign URLs before downloading audio', async () => {
  for (const url of ['https://foreign.example/audio.wav', base + '/storage/v1/object/public/music-audio/owner/track.wav', base + '/storage/v1/object/sign/music-audio/owner/track.wav?token=legacy']) {
    const h = harness({ delivery: url }); await assert.rejects(h.prepare(), /Private audio delivery/);
    assert.equal(h.events.some(event => event[0] === 'download'), false); assert.deepEqual([...h.files.keys()], [h.voiceUri]);
  }
});

test('native download cancellation removes a partial file and a late native write', async () => {
  const pending = deferred(), h = harness({ beforeDownload: () => pending.promise });
  const work = h.prepare(); await flush(); assert.ok(h.events.some(event => event[0] === 'download'));
  h.controller.abort(); await assert.rejects(work, /cancelled/);
  pending.resolve(); await flush();
  assert.ok(h.events.some(event => event[0] === 'cancel-download')); assert.deepEqual([...h.files.keys()], [h.voiceUri]); assert.equal(h.unsubscribe, 1);
});

test('native account A to B to A during soundtrack download cannot revive the old export', async () => {
  const pending = deferred(), h = harness({ beforeDownload: () => pending.promise });
  const work = h.prepare(); await flush(); h.switch('other'); h.switch('owner'); pending.resolve();
  await assert.rejects(work, /account changed/); assert.deepEqual([...h.files.keys()], [h.voiceUri]);
});

test('native revocation after audio staging makes final rights check fail and staging remains releasable', async () => {
  const h = harness(), prepared = await h.prepare(); h.revoke();
  await assert.rejects(prepared.assertRights(), /revoked/); await prepared.release(); assert.deepEqual([...h.files.keys()], [h.voiceUri]);
});

test('native exported audio must fit its actual verified file and current excerpt allowance', async () => {
  const h = harness(); await assert.rejects(h.prepare({ kind: 'sound', soundId, startSec: 1.5, durationSec: 1 }), /exceeds/);
  assert.deepEqual([...h.files.keys()], [h.voiceUri]);
  const short = harness(); short.data.max_excerpt_sec = 1;
  await assert.rejects(short.prepare({ kind: 'sound', soundId, durationSec: 2 }), /exceeds/);
});

test('native corrupt or over-limit downloads never enter the encoder', async () => {
  for (const options of [{ downloadBytes: Buffer.from('not audio') }, { progressBytes: 51 * 1024 * 1024 }, { reportSize: 51 * 1024 * 1024 }]) {
    const h = harness(options); await assert.rejects(h.prepare()); assert.deepEqual([...h.files.keys()], [h.voiceUri]);
  }
});

test('native final soundtrack permission checks observe draft changes and do not reuse released files', async () => {
  const h = harness(), prepared = await h.prepare(); h.moveDraft(); await assert.rejects(prepared.assertRights(), /Draft changed/); await prepared.release();
  const next = harness(), closed = await next.prepare(); await closed.release(); await assert.rejects(closed.assertRights(), /account changed/);
});
