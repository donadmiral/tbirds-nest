const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

function load(file, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, setTimeout, clearTimeout, require(name) {
    assert.ok(name in imports, `Unmapped import: ${name}`);
    return imports[name];
  } }, { filename: file });
  return exports;
}

const deadlines = load('shared/soundtrackPicker.ts');
const availability = load('shared/originalAudioAvailability.ts', { './soundtrackPicker': deadlines });
const music = load('shared/soundtrack.ts');
const exportsApi = load('shared/musicExportAuthorization.ts', {
  './originalAudioAvailability': availability, './soundtrack': music, './soundtrackPicker': deadlines,
});
const soundId = '10000000-0000-4000-8000-000000000001';
const selection = { soundId, startSec: 45, durationSec: 15 };
const baseTrack = { id: soundId, source: 'original', title: 'Verified recording', url: 'canonical', duration_sec: 90, max_excerpt_sec: 30 };
function fixture(options = {}) {
  const calls = [];
  const caps = options.capabilities ?? { version: 2, uploadsEnabled: false, catalogEnabled: false };
  const track = { ...baseTrack, ...options.track };
  const client = { rpc(name, args) {
    calls.push({ name, args });
    if (name === 'get_original_audio_capabilities') return Promise.resolve({ data: caps, error: options.capabilityError ?? null });
    if (name.startsWith('authorize_')) return Promise.resolve({ data: options.denied ? null : track, error: options.authorizationError ?? null });
    return Promise.resolve({ data: [track], error: null });
  } };
  return { calls, client, caps, track };
}

test('catalogue availability requires an explicit recognized server version and true boolean', async () => {
  for (const capabilities of [null, [], {}, { version: 3, catalogEnabled: true }, { version: 1, catalogEnabled: true }, { version: 2, catalogEnabled: 'true' }]) {
    const data = await availability.audioLibraryCapabilities({ rpc: async () => ({ data: capabilities, error: null }) });
    assert.equal(availability.librarySourceAvailable('library', data), false);
  }
  const h = fixture({ capabilities: { version: 2, uploadsEnabled: false, catalogEnabled: true } });
  const data = await availability.audioLibraryCapabilities(h.client);
  assert.equal(availability.librarySourceAvailable('library', data), true);
  assert.equal(availability.librarySourceAvailable('original', data), true);
  assert.equal(availability.librarySourceAvailable('licensed', data), false);
  assert.equal(await availability.originalAudioReady(h.client), false);
});

test('a missing capability is unavailable while a broken internal function remains a visible retry error', async () => {
  const missing = fixture({ capabilityError: { code: 'PGRST202', message: 'Could not find the function' } });
  assert.equal(await availability.audioLibraryCapabilities(missing.client), null);
  const broken = fixture({ capabilityError: { code: '42883', message: 'function private.internal_permission_check does not exist' } });
  await assert.rejects(() => availability.audioLibraryCapabilities(broken.client), /could not be checked/);
});

for (const surface of ['native', 'web']) {
  test(`${surface} soundtrack readers require catalogue readiness and hydrate only authorized matching rows`, async () => {
    const h = fixture({ track: { source: 'library' } });
    const hydrated = [];
    const imports = {
      '../../shared/soundtrackPicker': deadlines,
      '../../shared/originalAudioAvailability': availability,
      '../../shared/musicAvailability': load('shared/musicAvailability.ts'),
      './contentMedia': { hydrateSoundMedia: async rows => { hydrated.push(...rows); return rows.map(row => ({ ...row, url: 'private-delivery' })); } },
      ...(surface === 'native' ? { './supabase': { supabase: h.client } } : { './supabase/client': { createClient: () => h.client } }),
    };
    const service = load(surface === 'native' ? 'src/services/soundtrackService.ts' : 'web/lib/soundtrack.ts', imports);
    assert.equal((await service.listSoundtracks('post', '', h.client)).length, 0);
    await assert.rejects(() => service.getSoundtrack(soundId, 'post', h.client), /no longer available/);
    assert.equal(hydrated.length, 0);
    h.caps.catalogEnabled = true;
    for (const use of ['post', 'story', 'memory_album']) {
      assert.equal((await service.listSoundtracks(use, 'library', h.client)).length, 1);
      assert.equal((await service.getSoundtrack(soundId, use, h.client)).url, 'private-delivery');
    }
    h.track.id = '10000000-0000-4000-8000-000000000002';
    await assert.rejects(() => service.getSoundtrack(soundId, 'post', h.client), /no longer available/);
  });
}

test('export uses the installed contract and preserves excerpts after the first 30 seconds', async () => {
  for (const version of [1, 2]) {
    const h = fixture({ capabilities: { version, uploadsEnabled: false, catalogEnabled: false } });
    const actual = await exportsApi.authorizeLibraryAudioExport(h.client, selection, 'story');
    assert.equal(actual.id, soundId);
    assert.equal(actual.duration_sec, 90);
    assert.equal(h.calls[1].name, version === 1 ? 'authorize_original_audio_export' : 'authorize_music_audio_export');
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1].args)), { p_sound_id: soundId, p_use: 'story' });
  }
});

test('catalogue exports require the current server gate, even with a plausible authorization response', async () => {
  const h = fixture({ track: { source: 'library' } });
  await assert.rejects(() => exportsApi.authorizeLibraryAudioExport(h.client, selection, 'memory_album'), /permission/);
  h.caps.catalogEnabled = true;
  assert.equal((await exportsApi.authorizeLibraryAudioExport(h.client, selection, 'memory_album')).source, 'library');
  h.caps.catalogEnabled = false;
  await assert.rejects(() => exportsApi.authorizeLibraryAudioExport(h.client, selection, 'memory_album'), /permission/);
});

test('v2 authorization denial never falls back to legacy export permission', async () => {
  const h = fixture({ authorizationError: { code: '42501', message: 'Revoked' } });
  await assert.rejects(() => exportsApi.authorizeLibraryAudioExport(h.client, selection, 'post'), /permission/);
  assert.deepEqual(h.calls.map(call => call.name), ['get_original_audio_capabilities', 'authorize_music_audio_export']);
});

test('export rejects wrong tracks, unsupported sources and changed excerpt limits', async () => {
  for (const track of [
    { id: '10000000-0000-4000-8000-000000000002' }, { source: 'unknown' }, { duration_sec: 50 },
    { duration_sec: NaN }, { max_excerpt_sec: 10 }, { max_excerpt_sec: Infinity }, { title: null }, { url: '' },
  ]) {
    const h = fixture({ track });
    await assert.rejects(() => exportsApi.authorizeLibraryAudioExport(h.client, selection, 'story'), /permission/);
  }
});

test('invalid local excerpts are rejected before any server call', async () => {
  for (const excerpt of [{ ...selection, startSec: -1 }, { ...selection, durationSec: 0 }, { ...selection, durationSec: Infinity }, { ...selection, soundId: 'old-url' }]) {
    const h = fixture();
    await assert.rejects(() => exportsApi.authorizeLibraryAudioExport(h.client, excerpt, 'story'), /invalid/);
    assert.equal(h.calls.length, 0);
  }
});
