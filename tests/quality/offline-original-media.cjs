const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/services/offlineMediaCore.ts'), 'utf8');
const context = { exports: {}, AbortController,
  setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context);
const { createOfflineMediaCache, offlineMediaKeyInput, OFFLINE_MEDIA_TTL, OFFLINE_MEDIA_BYTES, OFFLINE_MEDIA_ITEM_BYTES } = context.exports;
const derive = (secret, id) => crypto.createHash('sha256').update(offlineMediaKeyInput(secret, id)).digest();
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const candidate = (id = '1', extra = {}) => ({ postId: `p${id}`, mediaId: `m${id}`, objectKey: `post-media/a/${id}.jpg`,
  kind: 'image', sourceVersion: 'version-1', uri: `https://media.test/${id}?token=never-persist-this`, ...extra });
function harness() {
  let manifest = null, key = null, time = 1000000, putGate = null, openGate = null, failPut = false, reportedBytes = null;
  const bytes = crypto.randomBytes(2048), disk = new Map(), plain = new Map(), calls = [];
  const io = {
    digest: async value => crypto.createHash('sha256').update(value).digest('hex'),
    readManifest: async () => manifest, writeManifest: async value => { manifest = value; },
    readKey: async () => key, createKey: async () => (key = crypto.randomBytes(32).toString('base64')),
    reset: async () => { key = null; manifest = null; disk.clear(); plain.clear(); calls.push('reset'); },
    cleanTemporary: async () => { plain.clear(); },
    prune: async keys => { for (const id of disk.keys()) if (!keys.includes(id)) disk.delete(id); },
    put: async (item, id, secret, signal) => {
      calls.push(`put:${item.mediaId}`); if (putGate) await putGate.promise;
      if (failPut) throw Error('offline');
      // Deliberately complete even after abort to exercise generation fencing.
      const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', derive(secret, id), nonce);
      disk.set(id, Buffer.concat([nonce, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]));
      return { bytes: reportedBytes ?? bytes.length, extension: item.kind === 'video' ? 'mp4' : 'jpg' };
    },
    open: async (entry, secret) => {
      calls.push(`open:${entry.mediaId}`); if (openGate) await openGate.promise;
      const encrypted = disk.get(entry.key), decipher = crypto.createDecipheriv('aes-256-gcm', derive(secret, entry.key), encrypted.subarray(0, 12));
      decipher.setAuthTag(encrypted.subarray(-16));
      plain.set(entry.key, Buffer.concat([decipher.update(encrypted.subarray(12, -16)), decipher.final()]));
      return `file:///cache/pc-offline-v1/active/${entry.key}.${entry.extension}`;
    },
    remove: async id => { disk.delete(id); plain.delete(id); }, removeOpen: async id => { plain.delete(id); },
  };
  return { io, bytes, disk, plain, calls, make: () => createOfflineMediaCache(io, () => time),
    manifest: () => manifest, setTime: value => { time = value; }, now: () => time,
    delayPut: value => { putGate = value; }, delayOpen: value => { openGate = value; },
    failPut: value => { failPut = value; }, reportedBytes: value => { reportedBytes = value; } };
}

test('original image and video bytes survive cold restart encrypted, without persisting grant URLs', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('account-a:session-1');
  await cache.save([candidate(), candidate('video', { kind: 'video', objectKey: 'post-media/a/original.mov' })]);
  assert.equal(h.disk.size, 2);
  for (const encrypted of h.disk.values()) assert.equal(encrypted.includes(h.bytes), false);
  assert.equal(h.manifest().includes('https:'), false); assert.equal(h.manifest().includes('never-persist'), false);
  const restarted = h.make(); await restarted.setScope('account-a:session-1');
  const [a, b] = await Promise.all([restarted.open('p1', 'm1'), restarted.open('pvideo', 'mvideo')]);
  assert.equal(a.kind, 'image'); assert.equal(b.kind, 'video');
  for (const value of h.plain.values()) assert.deepEqual(value, h.bytes);
  await restarted.setScope(null);
});

test('account and same-account session changes erase keys and cannot restore previous bytes', async () => {
  for (const next of ['account-b:session-2', 'account-a:session-2']) {
    const h = harness(), cache = h.make(); await cache.setScope('account-a:session-1'); await cache.save([candidate()]); await cache.open('p1', 'm1');
    const pending = cache.setScope(next);
    assert.equal(cache.peek('p1', 'm1'), null); await pending;
    assert.equal(h.disk.size, 0); assert.equal(h.plain.size, 0); assert.equal(await cache.open('p1', 'm1'), null);
  }
});

test('a completed download from a previous account cannot reappear after signout', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1');
  const pause = gate(); h.delayPut(pause); const work = cache.save([candidate()]);
  while (!h.calls.includes('put:m1')) await new Promise(resolve => setImmediate(resolve));
  await cache.setScope(null); pause.resolve(); await work;
  assert.equal(h.disk.size, 0); assert.equal(h.plain.size, 0); assert.equal(cache.peek('p1', 'm1'), null);
});

test('fresh visibility denial invalidates an in-flight decrypt before it can publish', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1'); await cache.save([candidate()]);
  const pause = gate(); h.delayOpen(pause); const opening = cache.open('p1', 'm1');
  while (!h.calls.includes('open:m1')) await new Promise(resolve => setImmediate(resolve));
  const revoked = cache.reconcile(['p1'], new Set());
  assert.equal(cache.peek('p1', 'm1'), null); pause.resolve();
  assert.equal(await opening, null); await revoked;
  assert.equal(h.disk.size, 0); assert.equal(h.plain.size, 0);
});

test('visibility reconciliation does not wait for the network and rejects a late revoked download', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1');
  const pause = gate(); h.delayPut(pause); const downloading = cache.save([candidate()]);
  while (!h.calls.includes('put:m1')) await new Promise(resolve => setImmediate(resolve));
  await cache.reconcile(['p1'], new Set());
  pause.resolve(); await downloading; assert.equal(h.disk.size, 0);
});

test('failed source replacement removes the old same-ID original before the next cold launch', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1'); await cache.save([candidate()]); await cache.open('p1', 'm1');
  h.failPut(true); const replacing = cache.save([candidate('1', { objectKey: 'post-media/a/new.jpg' })]);
  assert.equal(cache.peek('p1', 'm1'), null); await replacing;
  const restarted = h.make(); await restarted.setScope('a:1'); assert.equal(await restarted.open('p1', 'm1'), null);
});

test('tampered encrypted bytes are discarded, with no partially decrypted image published', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1'); await cache.save([candidate()]);
  h.disk.values().next().value[20] ^= 1;
  assert.equal(await cache.open('p1', 'm1'), null); assert.equal(h.disk.size, 0); assert.equal(h.plain.size, 0);
});

test('byte cap evicts oldest originals and the display cache never exceeds eight open files', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1'); h.reportedBytes(OFFLINE_MEDIA_ITEM_BYTES);
  await cache.save(Array.from({ length: 10 }, (_, i) => candidate(String(i))));
  const manifest = JSON.parse(h.manifest());
  assert.ok(manifest.entries.reduce((sum, item) => sum + item.bytes, 0) <= OFFLINE_MEDIA_BYTES);
  assert.equal(manifest.entries[0].mediaId, 'm5');
  h.reportedBytes(1000); await cache.save(Array.from({ length: 15 }, (_, i) => candidate(String(i + 10))));
  for (let i = 10; i < 25; i++) await cache.open(`p${i}`, `m${i}`);
  assert.equal(h.plain.size, 8);
});

test('backgrounding removes decrypted files and expiry prevents old bytes from reopening', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1'); await cache.save([candidate()]); await cache.open('p1', 'm1');
  cache.setForeground(false); assert.equal(cache.peek('p1', 'm1'), null); await cache.ready(); assert.equal(h.plain.size, 0); assert.equal(h.disk.size, 1);
  cache.setForeground(true); assert.ok(await cache.open('p1', 'm1'));
  h.setTime(h.now() + OFFLINE_MEDIA_TTL); assert.equal(cache.peek('p1', 'm1'), null); assert.equal(await cache.open('p1', 'm1'), null);
});

test('repeated requests share a single download and a single decrypt', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1');
  await Promise.all([cache.save([candidate()]), cache.save([candidate()])]);
  await Promise.all([cache.open('p1', 'm1'), cache.open('p1', 'm1')]);
  assert.equal(h.calls.filter(call => call === 'put:m1').length, 1); assert.equal(h.calls.filter(call => call === 'open:m1').length, 1);
});


test('same-path object replacement invalidates old bytes even if new download fails', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1'); await cache.save([candidate()]); await cache.open('p1', 'm1');
  h.failPut(true); await cache.save([candidate('1', { sourceVersion: 'version-2' })]);
  assert.equal(cache.peek('p1', 'm1'), null);
  const restarted = h.make(); await restarted.setScope('a:1'); assert.equal(await restarted.open('p1', 'm1'), null);
});


test('a delayed old decrypt cannot resurrect an entry invalidated by a failed version replacement', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1'); await cache.save([candidate()]);
  const pause = gate(); h.delayOpen(pause); const opening = cache.open('p1', 'm1');
  while (!h.calls.includes('open:m1')) await new Promise(resolve => setImmediate(resolve));
  h.failPut(true); const replacing = cache.save([candidate('1', { sourceVersion: 'version-2' })]);
  pause.resolve(); assert.equal(await opening, null); await replacing;
  assert.equal(cache.peek('p1', 'm1'), null); assert.equal(h.disk.size, 0);
});

test('swapping valid ciphertext between two same-account media files fails authentication', async () => {
  const h = harness(), cache = h.make(); await cache.setScope('a:1'); await cache.save([candidate('1'), candidate('2')]);
  const keys = [...h.disk.keys()], first = h.disk.get(keys[0]);
  h.disk.set(keys[0], h.disk.get(keys[1])); h.disk.set(keys[1], first);
  assert.equal(await cache.open('p1', 'm1'), null); assert.equal(await cache.open('p2', 'm2'), null);
  assert.equal(h.disk.size, 0); assert.equal(h.plain.size, 0);
});


test('backgrounding during cold key read preserves initialization for the same-session foreground', async () => {
  const h = harness(), first = h.make(); await first.setScope('a:1'); await first.save([candidate()]);
  const pause = gate(), readKey = h.io.readKey; let reading = false;
  h.io.readKey = async () => { reading = true; await pause.promise; return readKey(); };
  const restarted = h.make(), initializing = restarted.setScope('a:1');
  while (!reading) await new Promise(resolve => setImmediate(resolve));
  restarted.setForeground(false); pause.resolve(); await initializing;
  restarted.setForeground(true); await restarted.setScope('a:1');
  assert.ok(await restarted.open('p1', 'm1')); assert.equal(h.disk.size, 1);
});


test('a completed offline download does not replace playing network video, but supplies startup and failure recovery', () => {
  const context = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/lib/offlinePlaybackSelection.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  const choose = context.exports.selectOfflinePlayback;
  const playing = choose(null, 'v1', 'https://source/v1', null);
  assert.equal(choose(playing, 'v1', 'https://source/v1', 'file:///original').uri, 'https://source/v1');
  assert.equal(choose(playing, 'v1', 'https://renewed/v1', null).uri, 'https://source/v1');
  assert.equal(choose(playing, 'v1', 'https://renewed/v1', null, true).uri, 'https://renewed/v1');
  const cold = choose(null, 'v1', 'https://source/v1', 'file:///original');
  assert.equal(cold.uri, 'file:///original');
  assert.equal(choose(cold, 'v1', 'https://renewed/v1', 'file:///original').uri, 'file:///original');
  assert.equal(choose(playing, 'v1', 'https://source/v1', 'file:///original', true).uri, 'file:///original');
  assert.equal(choose(cold, 'v2', 'https://source/v2', null).uri, 'https://source/v2');
});

test('new restricted media revokes an existing cache entry before the data-saver early return', async () => {
  const file = fs.readFileSync(path.join(__dirname, '../../src/services/offlineFeedMedia.ts'), 'utf8');
  const ast = ts.createSourceFile('offlineFeedMedia.ts', file, ts.ScriptTarget.Latest, true);
  const policy = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'restricted'));
  const save = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'saveOfflineFeedMedia');
  const reconciled = [], saved = [];
  const context = { exports: {}, secureMediaAvailable: true,
    useAuthStore: { getState: () => ({ session: { user: { id: 'a' } } }) },
    useSettingsStore: { getState: () => ({ uploadQuality: 'data-saver' }) },
    offlineFeedMedia: { reconcile: async (ids, eligible) => reconciled.push({ ids, eligible: [...eligible] }), save: async (...args) => saved.push(args) } };
  vm.runInNewContext(ts.transpileModule(policy.getText(ast) + '\n' + save.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  await context.exports.saveOfflineFeedMedia('a', [
    { post_id: 'normal', media: [{ id: '1' }] },
    { post_id: 'sensitive', media: [{ id: '2', is_sensitive: true }] },
    { post_id: 'once', media: [{ id: '3', view_once: true }] },
    { post_id: 'private', media: [] },
  ], new Set(['normal', 'sensitive', 'once']), () => true);
  assert.deepEqual(reconciled[0].eligible, ['normal']); assert.equal(saved.length, 0);
});
