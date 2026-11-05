import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createGateway } from '../gateway.mjs';
import { encryptedCache, memoryCache } from '../cache.mjs';
import { validateJob } from '../config.mjs';
import { createMediaBroker } from '../../../supabase/functions/media-broker/handler.mjs';

const id = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const token = 'b'.repeat(64), secret = 'test-only-secret-'.repeat(4);
const source = [1, 2, 3, 4].map(id).join('/') + '/vertical.mp4';
const creator = id(5), job = id(6), lease = id(7);
const prefix = `${creator}/_renditions_v2/${job}/${lease}/`;
function fixture() {
  let time = Date.now(), allowed = true, fetches = 0;
  const calls = [];
  const api = {
    base: 'https://fixture.supabase.co',
    async rpc(name, args) {
      calls.push({ name, args });
      if (args.p_token !== token || args.p_bucket !== 'live-clips' || args.p_path !== source) return null;
      if (name === 'resolve_media_delivery') return allowed ? { bucket: 'live-clips', path: source, version: 'clip-v1', expiresAt: time + 300000 } : null;
      if (name === 'resolve_media_rendition_v2') {
        if (!allowed || args.p_source_version !== 'clip-v1') return null;
        const name = args.p_name || 'master.m3u8';
        return { leaseId: lease, sourceVersion: 'clip-v1', bucket: 'adaptive-media', path: prefix + name, name, version: 'rendition-v1', etag: 'clip-etag', bytes: 4,
          mime: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
          playlist: name === 'master.m3u8' ? '#EXTM3U\nr0/index.m3u8\n' : name.endsWith('.m3u8') ? '#EXTM3U\nseg00000.ts\n#EXT-X-ENDLIST\n' : null,
          cacheToken: 'internal.storage.token', cacheTokenExpiresAt: new Date(time + 3300000).toISOString() };
      }
      throw Error(name);
    },
    async fetch(url) { fetches++; assert.equal(new URL(url).searchParams.get('token'), 'internal.storage.token'); return new Response('clip', { headers: { ETag: '"clip-etag"', 'Content-Length': '4' } }); },
  };
  const cache = encryptedCache(memoryCache(128, () => time), secret, api.base);
  const handler = createGateway(api, { cache, secret, publicOrigin: 'https://media.fixture.test', now: () => time });
  const root = `https://media.fixture.test/playback/live-clips/${source}/master.m3u8?token=${token}`;
  return { root, calls, run: (url = root) => handler(new Request(url)), deny() { allowed = false; }, advance(ms) { time += ms; }, get fetches() { return fetches; } };
}
async function segment(h) {
  const root = await h.run(); assert.equal(root.status, 200);
  const text = await root.text(); assert.equal(text.includes('internal.storage.token'), false);
  const rendition = text.split('\n').find(value => value.startsWith('https:'));
  const response = await h.run(rendition); assert.equal(response.status, 200);
  return (await response.text()).split('\n').find(value => value.startsWith('https:'));
}

test('published clip master and segments use the same current ticket, source version and private output lease', async () => {
  const h = fixture(), url = await segment(h);
  assert.equal(await (await h.run(url)).text(), 'clip');
  assert.ok(h.calls.every(call => call.args.p_bucket === 'live-clips' && call.args.p_path === source && call.args.p_token === token));
  assert.ok(h.calls.filter(call => call.name === 'resolve_media_rendition_v2').every(call => call.args.p_source_version === 'clip-v1'));
  const discovery = await h.run(h.root + '&format=json');
  assert.equal((await discovery.json()).hlsUrl, h.root);
});

test('published clip revocation and path substitution stop delivery without exposing cached output rights', async () => {
  const h = fixture(), url = await segment(h);
  const changed = new URL(url); changed.pathname = changed.pathname.replace('vertical.mp4', 'horizontal.mp4');
  assert.equal((await h.run(changed.href)).status, 403);
  assert.equal((await h.run(h.root.replace(token, 'a'.repeat(64)))).status, 403);
  h.deny(); h.advance(30001);
  const before = h.fetches; assert.equal((await h.run(url)).status, 403); assert.equal(h.fetches, before);
});

test('clip gateway rejects malformed, nonvideo and duplicated-ticket paths before authority calls', async () => {
  for (const change of [value => value.replace('vertical.mp4', 'thumbnail.jpg'), value => value.replace('vertical.mp4', 'original.mp4'), value => value.replace(id(2), 'bad'), value => value + '&token=' + token]) {
    const h = fixture(); assert.equal((await h.run(change(h.root))).status, 400); assert.equal(h.calls.length, 0);
  }
});

test('clip worker accepts a provenanced guest creator without relaxing ordinary upload ownership or budgets', () => {
  const input = { job_id: job, lease_id: lease, attempt: 1, lease_until: new Date(Date.now() + 900000).toISOString(), source_id: id(8), source_version: 'clip-v1', source_bucket: 'live-clips', source_path: source,
    source_owner: creator, source_bytes: 4, source_etag: 'clip-etag', output_bucket: 'adaptive-media', output_prefix: prefix, output_max_bytes: 805306368, duration_max_seconds: 600 };
  assert.equal(validateJob(input), input);
  for (const patch of [{ source_path: source.replace(id(2), 'bad') }, { source_path: source.replace('vertical.mp4', 'thumbnail.jpg') }, { source_bucket: 'post-media' }, { source_bucket: 'chat-media' }, { source_bytes: 536870913 }, { output_prefix: `${id(1)}/_renditions_v2/${job}/${lease}/` }]) {
    assert.throws(() => validateJob({ ...input, ...patch }), /invalid_job/);
  }
});

test('clip broker retains gateway role enforcement and exact path validation before resolving tickets', async () => {
  let allowed = true; const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'authorize_media_broker_v2') return 'gateway';
    if (name === 'resolve_media_delivery') return allowed && args.p_path === source ? { bucket: 'live-clips', path: source, version: 'clip-v1' } : null;
    throw Error(name);
  };
  const handler = createMediaBroker({ base: 'https://fixture.supabase.co', rpc, storage: {} });
  const request = (path = source) => new Request('https://fixture.supabase.co/functions/v1/media-broker', { method: 'POST', headers: { Authorization: `Bearer ${id(9)}.${token}`, 'X-Media-Request-ID': randomUUID(), 'X-Media-Issued-At': new Date().toISOString(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ticket', args: { p_token: token, p_bucket: 'live-clips', p_path: path } }) });
  const current = await handler(request()); assert.equal(current.status, 200); assert.equal((await current.json()).data.version, 'clip-v1');
  allowed = false; assert.equal((await (await handler(request())).json()).data, null);
  const before = calls.length; assert.equal((await handler(request(source.replace('vertical.mp4', 'captions.vtt')))).status, 400); assert.equal(calls.length, before);
});
