const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function loader() {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file);
    const result = {}; cache.set(file, result);
    const requireLocal = name => {
      const target = path.resolve(path.dirname(file), name);
      if (name.startsWith('.')) return load([target, target + '.ts'].find(value => fs.existsSync(value) && fs.statSync(value).isFile()));
      throw Error(name);
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports: result, require: requireLocal, URL, Request, Response, Headers, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout, fetch });
    return result;
  }
  return load;
}
const id = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const prefix = [1, 2, 3, 4].map(id).join('/') + '/';
const token = 'a'.repeat(64), base = 'https://fixture.supabase.co';
const source = file => `${base}/functions/v1/media-content/live-clips/${prefix}${file}?token=${token}`;
const playback = file => `https://media.fixture.test/playback/live-clips/${prefix}${file}/master.m3u8?token=${token}`;
const expiresAt = () => Date.now() + 120000;

test('published clip capabilities select only the same immutable rendered source', async () => {
  const media = loader()('shared/adaptiveMedia.ts');
  for (const file of ['horizontal.mp4', 'vertical.mp4']) {
    assert.equal(new URL(media.adaptiveProbeUrl(source(file))).searchParams.get('stream'), 'check');
    media.acceptAdaptiveMedia([{ source: source(file), hlsUrl: playback(file), sourceVersion: 'clip-v1', expiresAt: expiresAt() }]);
    assert.equal(media.knownAdaptiveMedia(source(file)).hlsUrl, playback(file));
  }
  media.clearAdaptiveMedia();
  media.acceptAdaptiveMedia([{ source: source('horizontal.mp4'), hlsUrl: playback('vertical.mp4'), sourceVersion: 'clip-v1', expiresAt: expiresAt() }]);
  assert.equal(media.knownAdaptiveMedia(source('horizontal.mp4')), null);
  let calls = 0;
  const ready = await media.resolveAdaptiveMedia(source('horizontal.mp4'), async () => {
    calls++; return Response.json({ ready: true, hlsUrl: playback('horizontal.mp4'), sourceVersion: 'clip-v1', expiresAt: expiresAt() });
  });
  assert.equal(ready.sourceVersion, 'clip-v1'); assert.equal(calls, 1);
});

test('clip discovery rejects direct Storage grants, unbound names and malformed provenance paths', () => {
  const media = loader()('shared/adaptiveMedia.ts');
  const valid = source('horizontal.mp4');
  for (const value of [
    valid.replace('/functions/v1/media-content/', '/storage/v1/object/sign/'),
    valid.replace('/functions/v1/media-content/', '/storage/v1/object/public/'),
    valid.replace('live-clips', 'chat-media'), valid.replace(id(2), 'not-a-session'),
    valid.replace(prefix, `${id(1)}/`), valid.replace(prefix, `${prefix}${id(5)}/`),
    source('thumbnail.jpg'), source('captions.vtt'), source('horizontal.mov'), source('original.mp4'),
    valid + '&token=' + token, valid + '&asset=master.m3u8', valid + '#other', valid.replace('https:', 'http:'),
  ]) assert.equal(media.adaptiveProbeUrl(value), null, value);
});

test('signing creates clip HLS only for an exact issued video ticket and ready response', async () => {
  const api = loader()('supabase/functions/content-media-sign/adaptive.ts');
  for (const [file, expected] of [['horizontal.mp4', true], ['vertical.mp4', true], ['thumbnail.jpg', false], ['captions.vtt', false], ['original.mp4', false]]) {
    const ticket = { bucket_id: 'live-clips', object_path: prefix + file, token, expires_at: new Date(expiresAt()).toISOString() };
    const result = await api.contentPlaybackReadiness(base, [ticket], async items => {
      assert.equal(items[0].path, ticket.object_path);
      return { origin: 'https://media.fixture.test', items: [{ token, version: 'clip-v1', hls: true }, { token: 'b'.repeat(64), version: 'other', hls: true }] };
    });
    assert.equal(result.size, 1); assert.equal(result.get(source(file)).sourceVersion, 'clip-v1');
    assert.equal(result.get(source(file)).playback?.hlsUrl, expected ? playback(file) : undefined);
  }
});

test('clip discovery relay retains the ticket and rejects invalid sources before redirection', () => {
  const { adaptiveRedirect } = loader()('supabase/functions/media-content/adaptive.ts');
  for (const url of [source('vertical.mp4'), source('vertical.mp4').replace('/functions/v1', '')]) {
    const response = adaptiveRedirect(new Request(url + '&stream=check'), 'https://media.fixture.test');
    assert.equal(response.status, 307);
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.pathname, '/playback/live-clips/' + prefix + 'vertical.mp4');
    assert.equal(destination.searchParams.get('token'), token);
    assert.equal(destination.searchParams.get('format'), 'json');
  }
  for (const url of [source('thumbnail.jpg'), source('original.mp4'), source('horizontal.mp4').replace(id(1), 'bad'), source('horizontal.mp4') + '&token=' + token]) {
    assert.equal(adaptiveRedirect(new Request(url + '&stream=check'), 'https://media.fixture.test').status, 400);
  }
});
