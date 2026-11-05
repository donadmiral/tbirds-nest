const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const overlays = require('../../scripts/quality/native-connected-observation-overlay.cjs');

test('connected observations parse and preserve the original native image/video/cache operations', () => {
  const carousel = overlays.carousel(fs.readFileSync('src/components/PostCarousel.tsx', 'utf8'));
  const cache = overlays.cache(fs.readFileSync('src/services/offlineFeedMedia.ts', 'utf8'));
  for (const [name, source] of [['PostCarousel.tsx', carousel], ['offlineFeedMedia.ts', cache]]) {
    const result = ts.transpileModule(source, { fileName: name, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } });
    assert.deepEqual(result.diagnostics, []);
  }
  assert.ok(carousel.includes('hasFrame && owns && sourceReady && musicClock.playing && musicClock.time > 0.2'));
  assert.ok(carousel.includes('if (currentSurface.current === surface) setPaintedSurface(surface)'));
  assert.ok(carousel.includes('activeRequest.current === request && failedRequestRef.current !== request'));
  assert.ok(cache.includes('await transformMediaFile(destination, output, await fileKey(secret, key), false)'));
  assert.ok(cache.includes('await transformMediaFile(`${sealed}${entry.key}.bin`, output, await fileKey(secret, entry.key), true)'));
  assert.ok(cache.includes('FileSystem.createDownloadResumable(candidate.uri, destination'));
  assert.ok(cache.includes('!isContentCapability(item.url, SUPABASE_URL)'));
  assert.throws(() => overlays.carousel(carousel));
  assert.throws(() => overlays.cache(cache));
});

test('connected observer preserves real fetch response/rejection and records no credentials or capabilities', async () => {
  let latest, receiveNetwork;
  const response = { status: 206 }, failure = new Error('offline'), calls = [];
  let offline = false;
  const runtime = { fetch: function (...args) { calls.push(args); return offline ? Promise.reject(failure) : Promise.resolve(response); } };
  const exported = {};
  vm.runInNewContext(fs.readFileSync('tests/native/connected-observer.cjs', 'utf8'), {
    module: exported, globalThis: runtime, URL, Date, Math, Set, Map, Number, Promise,
    require: name => name === 'expo-file-system/legacy' ? { documentDirectory: 'file:///qa/', writeAsStringAsync: async (_file, text) => { latest = JSON.parse(text); } }
      : name === '../../src/stores/netStore' ? { useNetStore: { getState: () => ({ online: true }), subscribe: handler => { receiveNetwork = handler; } } }
        : assert.fail('Unexpected connected observation dependency'),
  });
  exported.exports.install();
  assert.equal(receiveNetwork, undefined, 'Normal App modules load before the passive reachability subscription');
  exported.exports.observeConnectivity();
  const url = 'https://uaulhuelcfkjwojtymmw.supabase.co/functions/v1/media-content/post-media/qa/image.png?token=private-capability';
  const init = { headers: { Authorization: 'Bearer private-session' }, body: 'private-password' };
  assert.equal(await runtime.fetch(url, init), response);
  assert.deepEqual(calls[0], [url, init]);
  offline = true;
  await assert.rejects(runtime.fetch(url, init), error => error === failure);
  receiveNetwork({ online: false }, { online: true });
  for (const currentTime of [.1, .25, .26, .5, .75]) exported.exports.recordVideo({ postId: 'post', mediaId: 'media',
    sourceClass: 'decrypted-local', currentTime, firstFrame: true, playing: true });
  exported.exports.record('test', { token: 'private-token', url, password: 'private-password', sourceVersion: url, kind: 'image' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(latest.connectedBackend, true);
  assert.ok(latest.events.some(row => row.type === 'http-result' && row.status === 206));
  assert.ok(latest.events.some(row => row.type === 'http-failed'));
  assert.ok(latest.events.some(row => row.type === 'network-state' && row.isConnected === false));
  assert.deepEqual(latest.events.filter(row => row.type === 'video-progress').map(row => row.currentTime), [.25, .5]);
  assert.equal(JSON.stringify(latest).includes('private-'), false);
  assert.equal(JSON.stringify(latest).includes('https:'), false);
});

test('every external connected observer dependency exists in the installed project', () => {
  const source = fs.readFileSync('tests/native/connected-observer.cjs', 'utf8');
  const dependencies = [...source.matchAll(/require\('([^']+)'\)/g)].map(match => match[1]);
  for (const name of dependencies) {
    if (name.startsWith('.')) assert.ok(fs.existsSync(require('node:path').resolve('tests/native', name + '.ts')));
    else {
      const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
      assert.ok(require('../../package.json').dependencies[packageName], 'Connected observer dependency must be declared');
      assert.ok(['', '.ts', '.tsx', '.js', '.cjs'].some(extension => {
        try { return !!require.resolve(name + extension); } catch { return false; }
      }), 'Connected observer dependency must resolve with the installed Metro source extensions');
    }
  }
});
