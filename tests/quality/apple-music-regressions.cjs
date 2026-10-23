// Exercise provider boundaries and cryptography without Apple credentials or real accounts.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require(name) { if (!(name in imports)) throw new Error(name); return imports[name]; }, URL, Request, Response, fetch, AbortController, TextEncoder, Uint8Array, btoa, atob, crypto: webcrypto, setTimeout, clearTimeout }, { filename: file });
  return exports;
}
const music = load('shared/appleMusic.ts');
const token = load('supabase/functions/apple-music/token.ts');
const { createAppleMusicHandler } = load('supabase/functions/apple-music/handler.ts', { '../../../shared/appleMusic.ts': music, './token.ts': token });
const envValues = { APPLE_MUSIC_TEAM_ID: 'ABCDEFGHIJ', APPLE_MUSIC_KEY_ID: '1234567890', APPLE_MUSIC_PRIVATE_KEY: 'PRIVATE KEY', APPLE_MUSIC_ALLOWED_ORIGINS: 'https://platinumcircles.info' };
function fixture(overrides = {}) {
  const calls = [];
  const handler = createAppleMusicHandler({ env: key => envValues[key], authenticate: async () => ({ id: 'qa-user' }), now: () => 100000,
    sign: async (_credentials, origin) => { calls.push({ origin }); return { token: 'synthetic', expiresAt: 700000 }; },
    fetch: async (url, options) => { calls.push({ url: String(url), authorization: options.headers.Authorization }); return Response.json({ results: { songs: { data: [{ type: 'songs', id: '123', attributes: { name: 'Example', artistName: 'Artist', previews: [{ url: 'https://audio.invalid/file.m4a' }] } }], next: '/next' } } }); }, ...overrides });
  return { calls, request: (body, origin = 'https://platinumcircles.info') => handler(new Request('https://function.invalid/apple-music', { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) })) };
}

test('only canonical HTTPS Apple song links are accepted', () => {
  assert.equal(music.parseAppleMusicLink('https://music.apple.com/zw/album/example/456?i=123').id, '123');
  for (const url of ['http://music.apple.com/zw/song/123', 'https://music.apple.com.evil.test/zw/song/123', 'https://music.apple.com@evil.test/zw/song/123', 'https://music.apple.com/zw/album/example/123', 'https://music.apple.com/zw/song/NaN', 'javascript:alert(1)']) assert.equal(music.parseAppleMusicLink(url), null, url);
});
test('catalog output strips playable audio and rejects untrusted artwork', () => {
  const track = music.appleMusicTrackFromCatalog({ type: 'songs', id: '123', attributes: { name: 'A', artistName: 'B', artwork: { url: 'https://evil.test/{w}.jpg' }, previews: [{ url: 'https://audio.invalid' }] } }, 'zw');
  assert.equal(track.artworkUrl, null); assert.equal(track.previews, undefined); assert.equal(track.url, 'https://music.apple.com/zw/song/123');
});
test('signed ES256 token is short-lived, origin-bound and cryptographically valid', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = await webcrypto.subtle.exportKey('pkcs8', pair.privateKey);
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64')}\n-----END PRIVATE KEY-----`;
  const signed = await token.signMusicDeveloperToken({ teamId: 'ABCDEFGHIJ', keyId: '1234567890', privateKey }, 'https://platinumcircles.info', 100000);
  const [header, claims, signature] = signed.token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: '1234567890' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { iss: 'ABCDEFGHIJ', iat: 100, exp: 700, origin: ['https://platinumcircles.info'] });
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${claims}`)), true);
});
test('anonymous accounts and missing sessions cannot access tokens or catalog', async () => {
  for (const user of [null, { id: 'guest', anonymous: true }]) {
    const f = fixture({ authenticate: async () => user });
    assert.equal((await f.request({ action: 'token' })).status, 401); assert.equal(f.calls.length, 0);
  }
});
test('wrong origin and originless token requests are rejected before signing', async () => {
  const f = fixture();
  assert.equal((await f.request({ action: 'token' }, 'https://evil.test')).status, 403);
  assert.equal((await f.request({ action: 'token' }, null)).status, 400);
  assert.equal(f.calls.length, 0);
});
test('browser receives token for its exact allowed origin and no-store response', async () => {
  const f = fixture(); const response = await f.request({ action: 'token' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(f.calls[0].origin, 'https://platinumcircles.info');
});
test('missing credentials are an explicit unavailable state, never fake results', async () => {
  const f = fixture({ env: key => key === 'APPLE_MUSIC_ALLOWED_ORIGINS' ? envValues[key] : '' });
  assert.equal((await (await f.request({ action: 'status' })).json()).configured, false);
  assert.equal((await f.request({ action: 'search', term: 'song', storefront: 'zw' })).status, 503);
  assert.equal(f.calls.length, 0);
});
test('native catalog uses server token and returns only normalized references', async () => {
  const f = fixture(); const response = await f.request({ action: 'search', term: 'A & B', storefront: 'ZW', offset: 20 }, null);
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.nextOffset, 40); assert.equal(body.tracks[0].previews, undefined);
  assert.equal(f.calls[0].origin, undefined); assert.match(f.calls[1].url, /^https:\/\/api\.music\.apple\.com\/v1\/catalog\/zw\/search\?/);
  assert.equal(new URL(f.calls[1].url).searchParams.get('term'), 'A & B');
});
test('invalid queries do not touch Apple', async () => {
  for (const body of [{ action: 'search', term: 'a', storefront: 'zw' }, { action: 'search', term: 'song', storefront: '../us' }, { action: 'search', term: 'song', storefront: 'zw', offset: -1 }, { action: 'track', id: '../123', storefront: 'zw' }]) {
    const f = fixture(); assert.equal((await f.request(body)).status, 400); assert.equal(f.calls.length, 0);
  }
});
test('provider rate limits and errors remain failures', async () => {
  for (const [upstream, expected] of [[429, 429], [404, 404], [401, 503], [500, 503]]) {
    const f = fixture({ fetch: async () => new Response(null, { status: upstream }) });
    assert.equal((await f.request({ action: 'track', id: '123', storefront: 'zw' })).status, expected);
  }
});
test('repeated per-user requests are bounded', async () => {
  const f = fixture(); for (let i = 0; i < 30; i++) assert.equal((await f.request({ action: 'status' })).status, 200);
  assert.equal((await f.request({ action: 'status' })).status, 429);
});
