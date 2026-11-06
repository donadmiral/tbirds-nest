import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clipBackend } from '../backend.mjs';
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = 'https://abcdefghijklmnopqrst.supabase.co', cdnOrigin = 'https://live.synthetic.invalid';
const secret = 'synthetic-clip-broker-secret-0123456789';
const job = { id: id(1), lease_id: id(2), owner_id: id(3), session_id: id(4), clip_id: id(5),
  source_path: `live/${id(4)}/${id(6)}/master.m3u8`, output_prefix: `${id(3)}/${id(4)}/${id(5)}/${id(2)}/` };
const bytes = Buffer.from('synthetic encoded video');
const asset = { name: 'vertical.mp4', bytes: bytes.length, content_type: 'video/mp4', sha256: createHash('sha256').update(bytes).digest('hex') };
const metadata = { live_clip_id: job.clip_id, live_clip_job_id: job.id, live_clip_lease_id: job.lease_id, sha256: asset.sha256 };
const grant = () => ({ bucket: 'live-clips', path: job.output_prefix + asset.name, bytes: asset.bytes, content_type: asset.content_type, metadata,
  url: `${base}/storage/v1/object/upload/sign/live-clips/${job.output_prefix}${asset.name}?token=synthetic` });
const backend = fetcher => clipBackend({ base, cdnOrigin, secret, fetcher, now: () => 1000000 });

test('signed upload streams only the exact granted asset and provenance without a service or broker bearer', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pc-clip-upload-'));
  try {
    const file = path.join(directory, asset.name); await writeFile(file, bytes); let uploads = 0;
    const api = backend(async (url, init) => {
      if (String(url).endsWith('/functions/v1/live-clip-worker')) {
        assert.equal(init.headers.Authorization, `Bearer ${secret}`); assert.equal(init.redirect, 'error');
        assert.deepEqual(JSON.parse(init.body), { action: 'upload', id: job.id, lease_id: job.lease_id, asset });
        return Response.json({ data: grant() });
      }
      uploads++; assert.equal(String(url), grant().url); assert.equal(init.method, 'PUT');
      assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.apikey, undefined);
      assert.equal(init.headers['x-upsert'], 'false'); assert.equal(init.headers['Content-Length'], String(bytes.length));
      assert.deepEqual(JSON.parse(Buffer.from(init.headers['x-metadata'], 'base64').toString()), metadata);
      assert.deepEqual(Buffer.from(await new Response(init.body).arrayBuffer()), bytes);
      return Response.json({ Key: `live-clips/${grant().path}` });
    });
    await api.upload(job, asset, file, AbortSignal.timeout(2000)); assert.equal(uploads, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('forged upload host, lease path and provenance are rejected before reading a local file', async () => {
  for (const bad of [
    { url: grant().url.replace(base, 'https://attacker.invalid') },
    { path: grant().path.replace(job.lease_id, id(9)) },
    { metadata: { ...metadata, live_clip_lease_id: id(9) } },
    { bytes: asset.bytes + 1 },
  ]) {
    let calls = 0;
    const api = backend(async () => { calls++; return Response.json({ data: { ...grant(), ...bad } }); });
    await assert.rejects(api.upload(job, asset, '/must-not-be-read', AbortSignal.timeout(1000)), /clip_upload_grant_invalid/);
    assert.equal(calls, 1);
  }
});

test('finish accepts ready only, including idempotent ready replies, and never masks revoked authority', async () => {
  for (const data of [{ ok: true, state: 'ready' }, { ok: true, state: 'ready', duplicate: true },
    { ok: true, state: 'failed' }, { ok: true, state: 'queued' }, { ok: false, state: 'lease_lost' }]) {
    const api = backend(async () => Response.json({ data }));
    assert.equal(await api.complete(job, {}, AbortSignal.timeout(1000)), data.ok && data.state === 'ready');
  }
});

test('source grants require the authorized origin, exact recording and a current bounded expiry', async () => {
  const valid = { url: `${cdnOrigin}/_live/capability/${job.source_path}`, expires_at: new Date(1120000).toISOString() };
  for (const bad of [{ url: valid.url.replace(cdnOrigin, 'https://attacker.invalid') },
    { url: valid.url.replace(job.session_id, id(7)) }, { expires_at: new Date(999999).toISOString() },
    { expires_at: new Date(1120001).toISOString() }, { expires_at: null }]) {
    await assert.rejects(backend(async () => Response.json({ data: { ...valid, ...bad } })).source(job), /clip_source_grant_invalid/);
  }
  assert.equal(await backend(async () => Response.json({ data: valid })).source(job), valid.url);
});

test('oversized broker replies are cancelled before allocating an unbounded body', async () => {
  let cancelled = false;
  const api = backend(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1048577)); }, cancel() { cancelled = true; } })));
  await assert.rejects(api.claim(), /clip_backend_response_limit/); assert.equal(cancelled, true);
});
