const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const base = 'https://project.example';
const privateURI = (name = 'photo.png', bucket = 'story-media') => `${base}/functions/v1/media-content/${bucket}/owner/${name}?token=${'a'.repeat(64)}`;
const plain = value => JSON.parse(JSON.stringify(value));

function loader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (Object.hasOwn(overrides, file)) return overrides[file];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { module, exports: module.exports, URL, AbortController, Uint8Array, setTimeout, clearTimeout, setInterval, clearInterval,
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (!name.startsWith('.')) throw new Error('Unexpected dependency: ' + name);
        return load(path.resolve(path.dirname(file), name + '.ts'));
      } });
    return module.exports;
  }
  return load;
}
function fileSystem() {
  const files = new Map(), handles = [], writes = [], deleted = [], directories = [];
  let sequence = 0;
  const uri = parts => parts.map((part, index) => {
    const value = typeof part === 'string' ? part : part.uri;
    return index ? value.replace(/^\/+/, '') : value.replace(/\/$/, '');
  }).join('/');
  class File {
    constructor(...parts) { this.uri = uri(parts); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length ?? 0; }
    create() { if (this.exists) throw new Error('Exists'); files.set(this.uri, Buffer.alloc(0)); }
    delete() { deleted.push(this.uri); files.delete(this.uri); }
    async bytes() { return new Uint8Array(files.get(this.uri)); }
    open() {
      const file = this; let offset = 0;
      const handle = { closed: false,
        readBytes(length) { const data = files.get(file.uri) ?? Buffer.alloc(0), chunk = data.subarray(offset, offset + length); offset += chunk.length; return new Uint8Array(chunk); },
        writeBytes(data) { writes.push(data.byteLength); files.set(file.uri, Buffer.concat([files.get(file.uri), Buffer.from(data)])); },
        close() { handle.closed = true; },
      }; handles.push(handle); return handle;
    }
  }
  class Directory {
    constructor(...parts) { this.uri = uri(parts); }
    create() { directories.push(this.uri); }
    delete() { deleted.push(this.uri); for (const name of files.keys()) if (name.startsWith(this.uri + '/')) files.delete(name); }
  }
  return { files, handles, writes, deleted, directories, File, Directory,
    Paths: { cache: 'file:///cache', availableDiskSpace: 1024 * 1024 * 1024 },
    crypto: { randomUUID: () => `test-uuid-${String(++sequence).padStart(8, '0')}` },
  };
}
function filesFixture({ chunks = [new Uint8Array([1, 2, 3])], pending = false } = {}) {
  const system = fileSystem(), controller = new AbortController();
  let fetches = 0, cancels = 0, index = 0, release = 0;
  const reader = { async read() { if (pending) return new Promise(() => {}); return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }; },
    async cancel() { cancels++; }, releaseLock() { release++; } };
  const load = loader({ 'expo-file-system': system, 'expo-crypto': system.crypto,
    'expo/fetch': { fetch: async () => { fetches++; return { ok: true, headers: { get: () => null }, body: { getReader: () => reader } }; } },
    [path.join(root, 'src/services/supabase.ts')]: { SUPABASE_URL: base },
  });
  const exports = load('src/services/memoryMovieFiles.ts');
  return { ...system, controller, ...exports, fetches: () => fetches, cancels: () => cancels, released: () => release };
}

test('private downloads stream in bounded writes and dispose only their own workspace', async () => {
  const f = filesFixture({ chunks: [new Uint8Array(150000)] }), owned = new f.MemoryMovieFiles(f.controller.signal);
  f.files.set('file:///cache/unrelated.png', Buffer.from('keep'));
  const uri = await owned.download(privateURI(), 150000);
  assert.equal(f.files.get(uri).length, 150000); assert.ok(f.writes.every(size => size <= 65536));
  assert.ok(f.handles.every(handle => handle.closed)); assert.equal(f.cancels(), 1); assert.equal(f.released(), 1);
  owned.dispose(); owned.dispose(); assert.equal(f.files.has(uri), false); assert.equal(f.files.has('file:///cache/unrelated.png'), true);
});
test('unknown-length downloads enforce the byte ceiling before a chunk reaches disk', async () => {
  const f = filesFixture({ chunks: [new Uint8Array([1, 2]), new Uint8Array([3, 4])] }), owned = new f.MemoryMovieFiles(f.controller.signal);
  await assert.rejects(owned.download(privateURI(), 3), /exceed/);
  assert.deepEqual(f.writes, [2]); assert.equal(f.files.size, 0); assert.ok(f.handles.every(handle => handle.closed)); owned.dispose();
});
test('cancelling a blocked media reader closes it and removes the partial file', async () => {
  const f = filesFixture({ pending: true }), owned = new f.MemoryMovieFiles(f.controller.signal);
  const work = owned.download(privateURI(), 100); await new Promise(resolve => setImmediate(resolve)); f.controller.abort();
  await assert.rejects(work, /cancelled/); assert.ok(f.cancels() >= 1); assert.equal(f.files.size, 0); assert.ok(f.handles.every(handle => handle.closed)); owned.dispose();
});
test('foreign links and unapproved public objects never start a download', async () => {
  const f = filesFixture(), owned = new f.MemoryMovieFiles(f.controller.signal);
  for (const uri of ['https://foreign.example/a.png', base + '/storage/v1/object/public/story-media/photo.png', base + '/storage/v1/object/public/avatars/photo.png?token=no']) {
    await assert.rejects(owned.download(uri, 100, 'png', true), /fresh private/);
  }
  assert.equal(f.fetches(), 0); assert.equal(f.files.size, 0); owned.dispose();
});
test('local copies validate size and retain their source through export cleanup', async () => {
  const f = filesFixture(), owned = new f.MemoryMovieFiles(f.controller.signal), source = 'file:///cache/source.png'; f.files.set(source, Buffer.alloc(70000, 9));
  await assert.rejects(owned.copy(source, 69999), /too large/); await assert.rejects(owned.copy('content://external/photo', 100000), /not a local/);
  const copy = await owned.copy(source, 70000); assert.equal(f.files.get(copy).length, 70000); assert.ok(f.writes.every(size => size <= 65536));
  owned.dispose(); assert.equal(f.files.has(source), true); assert.equal(f.files.has(copy), false);
});
test('a low-space constructor allocates no workspace and timed steps release their listener', async () => {
  const f = filesFixture(); f.Paths.availableDiskSpace = 100;
  assert.throws(() => new f.MemoryMovieFiles(f.controller.signal), /Free some space/); assert.equal(f.directories.length, 0);
  await assert.rejects(f.memoryMovieStep(new Promise(() => {}), f.controller.signal, 'specific timeout', 5), /specific timeout/);
  assert.equal(await f.memoryMovieStep(Promise.resolve(42), f.controller.signal, 'unused'), 42);
});

const recipe = { width: 720, height: 1280, trimStart: 0, trimEnd: 2, speed: 1, volume: 0, fit: 'contain', scale: 1, x: 0, y: 0, matrix: [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0] };
const request = () => ({ id: 'memory-request-1', outputUri: 'file:///cache/pc-memory-export-test.mp4', width: 720, height: 1280,
  scenes: [{ id: 'scene-first-1', inputUri: 'file:///cache/one.png', inputKind: 'image', recipe, layers: [], motion: { fromScale: 1, toScale: 1, x: 0, y: 0 }, transition: { fadeSec: 0 } }] });
function bridgeFixture(platform = 'android', version = 1) {
  const calls = [], native = { memoryMovieVersion: version,
    composeMemoryMovie: async value => { calls.push(['compose', value]); return { uri: value.outputUri, width: 720, height: 1280, duration: 2, bytes: 4000, sceneCount: 1, soundtrackMixed: false }; },
    prepareMemoryMovieImage: async value => { calls.push(['prepare', value]); return { uri: value.outputUri, width: 720, height: 1280, bytes: 4000 }; },
    cancelMemoryMovie: async id => { calls.push(['cancel', id]); },
  };
  const load = loader({ 'react-native': { Platform: { OS: platform } }, 'expo-modules-core': { requireOptionalNativeModule: () => native } });
  return { native, calls, ...load('modules/boomerang/memoryComposition.ts') };
}
test('whole-book capability requires the complete supported native contract on each phone platform', () => {
  for (const platform of ['ios', 'android']) { assert.equal(bridgeFixture(platform, 1).memoryMovieCompositionAvailable, true); for (const version of [0, 2, undefined]) assert.equal(bridgeFixture(platform, version === undefined ? null : version).memoryMovieCompositionAvailable, false); }
  assert.equal(bridgeFixture('web').memoryMovieCompositionAvailable, false);
});
test('invalid scene and normalized-image acknowledgements cannot become saved files', async () => {
  const f = bridgeFixture(); f.native.composeMemoryMovie = async value => ({ uri: value.outputUri, width: 720, height: 1280, duration: 8, bytes: 4000, sceneCount: 1, soundtrackMixed: false });
  await assert.rejects(f.composeMemoryMovie(request()), /could not be verified/);
  f.native.prepareMemoryMovieImage = async value => ({ uri: value.outputUri, width: 4000, height: 6000, bytes: 5000 });
  await assert.rejects(f.prepareMemoryMovieImage({ id: 'image-request-1', inputUri: 'file:///cache/a.jpg', outputUri: 'file:///cache/pc-memory-image-a.png' }), /could not be verified/);
});
test('abort reaches the native job and rejects a late successful encoder response', async () => {
  const f = bridgeFixture(), controller = new AbortController(); let finish;
  f.native.composeMemoryMovie = value => new Promise(resolve => { finish = () => resolve({ uri: value.outputUri, width: 720, height: 1280, duration: 2, bytes: 4000, sceneCount: 1, soundtrackMixed: false }); });
  const work = f.composeMemoryMovie(request(), controller.signal); controller.abort(); finish(); await assert.rejects(work, /cancelled/);
  assert.deepEqual(f.calls, [['cancel', 'memory-request-1']]);
});
test('pre-aborted exports and unavailable builds never invoke native encoding', async () => {
  const f = bridgeFixture(), controller = new AbortController(); controller.abort(); await assert.rejects(f.composeMemoryMovie(request(), controller.signal), /cancelled/); assert.equal(f.calls.length, 0);
  const old = bridgeFixture('android', 0); await assert.rejects(old.composeMemoryMovie(request()), /new Android build/); assert.equal(old.calls.length, 0);
});

function pipelineFixture() {
  const system = fileSystem(), controller = new AbortController(), events = [], stopped = { value: false };
  const page = { id: 'story-id-0001', story_id: 'story-id-0001', media_type: 'image', media_url: privateURI(), caption: 'Visible memory writing' };
  const book = { id: 'book-id-0001', title: 'Our days', can_view: true, pages: [page], presentation_revision: 1 };
  const guard = { book, check: async () => { events.push(['access']); return book; }, stop: () => { stopped.value = true; } };
  let lastRequest, captureFailure = false, accessFailure = false;
  const dependencies = { 'expo-file-system': system, 'expo-crypto': system.crypto,
    'expo-asset': { Asset: { fromModule: () => { throw new Error('A score was not selected'); } } },
    'expo-video': { createVideoPlayer: () => { throw new Error('No video in this fixture'); } },
    'expo/fetch': { fetch: async () => ({ ok: true, headers: { get: () => null }, body: { getReader: () => { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: new Uint8Array([1, 2, 3]) }; }, async cancel() {}, releaseLock() {} }; } } }) },
    [path.join(root, 'src/services/supabase.ts')]: { supabase: {}, SUPABASE_URL: base },
    [path.join(root, 'shared/memoryMovieAccess.ts')]: { openMemoryMovieAccess: async () => guard },
    [path.join(root, 'src/services/contentMedia.ts')]: { hydrateMemoryAlbumMedia: async books => { events.push(['hydrate']); if (accessFailure) throw new Error('Book access revoked'); return books; }, hydrateSoundMedia: async tracks => tracks },
    [path.join(root, 'modules/boomerang/memoryComposition.ts')]: {
      prepareMemoryMovieImage: async value => { events.push(['normalize', value]); system.files.set(value.outputUri, Buffer.alloc(32)); return { uri: value.outputUri, width: 720, height: 1280, bytes: 32 }; },
      composeMemoryMovie: async value => { events.push(['encode']); lastRequest = value; system.files.set(value.outputUri, Buffer.alloc(4000)); return { uri: value.outputUri, width: 720, height: 1280, duration: 6, bytes: 4000, sceneCount: value.scenes.length, soundtrackMixed: !!value.soundtrack }; },
    },
  };
  const load = loader(dependencies), service = load('src/services/memoryMovieExport.ts');
  const options = { bookId: book.id, expected: { title: book.title, pages: book.pages, revision: 1 }, signal: controller.signal, originalAudio: true, scoreVolume: null, reduceMotion: false,
    capture: async value => { events.push(['capture', value]); if (captureFailure) throw new Error('Artwork did not render'); const uri = 'file:///cache/capture-' + events.length + '.png'; system.files.set(uri, Buffer.alloc(80)); return uri; }, progress() {}, onInvalid() {},
  };
  return { ...system, controller, events, stopped, options, service, request: () => lastRequest,
    failCapture: () => { captureFailure = true; }, revoke: () => { accessFailure = true; } };
}
test('native preparation captures writing and every artwork layer from authorized private sources', async () => {
  const f = pipelineFixture(), movie = await f.service.exportNativeMemoryMovie(f.options), request = f.request();
  assert.equal(request.scenes.length, 1); assert.equal(request.scenes[0].inputKind, 'image'); assert.equal(request.scenes[0].layers.length, 1);
  const captured = f.events.filter(event => event[0] === 'capture'); assert.deepEqual(captured.map(event => event[1].layer), ['background', 'overlay']);
  assert.equal(captured[0][1].item.page.caption, 'Visible memory writing'); assert.match(captured[0][1].item.uri, /^file:\/\/\/cache\/pc-memory-work-/);
  const normalized = f.events.find(event => event[0] === 'normalize')[1]; assert.match(normalized.outputUri, /^file:\/\/\/cache\/pc-memory-image-[^/]+\.png$/);
  assert.ok(f.events.filter(event => event[0] === 'access').length >= 4); assert.equal(f.stopped.value, false); assert.equal(f.files.has(movie.result.uri), true);
  await movie.assertRights(); movie.release(); movie.release(); assert.equal(f.stopped.value, true); assert.equal(f.files.size, 0);
});
test('capture errors and revoked artwork links fail the whole native preparation and clean temporary bytes', async () => {
  for (const mode of ['capture', 'revoked']) {
    const f = pipelineFixture(); if (mode === 'capture') f.failCapture(); else f.revoke();
    await assert.rejects(f.service.exportNativeMemoryMovie(f.options), /did not render|revoked/);
    assert.equal(f.events.some(event => event[0] === 'encode'), false); assert.equal(f.stopped.value, true); assert.equal(f.files.size, 0);
  }
});
test('cancelling during capture cannot submit a partial native scene and removes captured files', async () => {
  const f = pipelineFixture(), capture = f.options.capture;
  f.options.capture = async value => { const uri = await capture(value); f.controller.abort(); return uri; };
  await assert.rejects(f.service.exportNativeMemoryMovie(f.options), /cancelled/);
  assert.equal(f.events.some(event => event[0] === 'encode'), false); assert.equal(f.stopped.value, true); assert.equal(f.files.size, 0);
});
test('reduced-motion preparation emits a still transform and zero fade in the actual native request', async () => {
  const f = pipelineFixture(); f.options.reduceMotion = true;
  const movie = await f.service.exportNativeMemoryMovie(f.options);
  assert.deepEqual(plain(f.request().scenes[0].motion), { fromScale: 1, toScale: 1, x: 0, y: 0 }); assert.equal(f.request().scenes[0].transition.fadeSec, 0); movie.release();
});
