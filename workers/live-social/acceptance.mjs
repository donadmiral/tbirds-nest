import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateMedia, runOnce } from './pull.mjs';
import { runtimeInventory } from './runtime-policy.mjs';

/** Executes real scratch I/O and worker control flow with explicitly synthetic responses only. */
export async function acceptance() {
  const inventory = runtimeInventory();
  assert.equal(tmpdir(), '/scratch');
  const metadata = await stat('/usr/local/share/pc-live-social/base-image.json');
  assert.equal(metadata.uid, 0);
  assert.equal(metadata.mode & 0o777, 0o444);
  const uuid = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const origin = 'https://abcdefghijklmnopqrst.supabase.co', id = uuid(1), clip = uuid(2), lease = uuid(3);
  const source = origin + `/storage/v1/object/sign/live-clips/${uuid(4)}/${uuid(5)}/${clip}/${uuid(6)}/vertical.mp4?token=synthetic-only`;
  const job = { id, clip_id: clip, platform: 'x', account_id: '12345', access_token: 'synthetic-provider-token',
    phase: 'initial', progress: {}, reconcile_only: false, source_url: source, duration_ms: 15000,
    consent: { caption: 'Offline container acceptance only', title: 'Synthetic', format: 'vertical' } };
  const bytes = new Uint8Array(128).map((_, i) => i);
  const media = await privateMedia({ origin, maxBytes: 512 }, job, async () => new Response(bytes));
  try {
    assert.equal(media.size, bytes.length);
    const directories = (await readdir('/scratch')).filter(name => name.startsWith('pc-social-'));
    assert.equal(directories.length, 1);
    assert.equal((await stat(join('/scratch', directories[0]))).mode & 0o777, 0o700);
    assert.equal((await stat(join('/scratch', directories[0], 'clip.mp4'))).mode & 0o777, 0o600);
    assert.deepEqual([...await media.read(0, bytes.length)], [...bytes]);
  } finally { await media.close(); }
  const actions = [], requests = [];
  const call = async (action, fields) => {
    actions.push({ action, fields });
    return action === 'claim' ? { items: [{ id, lease_id: lease }] } : action === 'grant' ? job : { ok: true };
  };
  const fetcher = async (url, init = {}) => {
    url = String(url); requests.push(url);
    assert.equal(init.redirect, 'error');
    if (url === source) return new Response(bytes);
    assert.ok(url.startsWith('https://api.x.com/2/'));
    if (url.endsWith('/initialize')) return Response.json({ data: { id: '111' } });
    if (url.endsWith('/append') || url.endsWith('/finalize')) return Response.json({ data: {} });
    if (url.includes('media_id=')) return Response.json({ data: { processing_info: { state: 'succeeded' } } });
    assert.equal(url, 'https://api.x.com/2/tweets');
    assert.equal(actions.at(-1).action, 'check');
    assert.ok(actions.some(row => row.action === 'checkpoint' && row.fields.phase === 'publishing'));
    return Response.json({ data: { id: '222' } });
  };
  const result = await runOnce({ origin, secret: 'synthetic-broker-only', maxBytes: 512 }, { call, fetcher });
  assert.equal(result.state, 'published');
  assert.equal(actions.at(-1).action, 'finish');
  assert.equal(actions.at(-1).fields.provider_id, '222');
  assert.equal(requests.filter(url => url === 'https://api.x.com/2/tweets').length, 1);
  assert.equal((await readdir('/scratch')).filter(name => name.startsWith('pc-social-')).length, 0);
  return { schema_version: 1, ok: true, service: 'live-social', node_version: inventory.node_version,
    base_image: inventory.base.image, provider_responses: 'synthetic_offline_fixtures',
    base_metadata_owner_uid: metadata.uid, base_metadata_mode: '0444',
    private_scratch_permissions: true, actual_worker_flow_passed: true, scratch_cleanup_passed: true,
    hosted_provider_accepted: false, external_posts_created: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify(await acceptance()) + '\n'); }
  catch { process.stderr.write('{"ok":false,"error":"social_container_acceptance_failed"}\n'); process.exitCode = 1; }
}
