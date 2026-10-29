// An optimization may only rewrite an already-published, verified object version.
const VIDEO_BUCKETS = new Set(['post-media', 'story-media']);
const MAX_BYTES = 200 * 1024 * 1024;
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const etag = (value: unknown) => typeof value === 'string' && !value.startsWith('W/') ? value.trim().replace(/^"|"$/g, '') : '';
type Dependencies = {
  serviceKey: string;
  db: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
  download: (bucket: string, path: string, version: string, lease: string) => Promise<{ blob: Blob; etag: string | null }>;
  update: (bucket: string, path: string, bytes: Uint8Array, contentType: string, metadata: Record<string, unknown>) => Promise<{ error: unknown }>;
  remux: (bytes: Uint8Array) => { ok: true; buf: Uint8Array } | { ok: false; reason: string };
};
async function serviceAuthorized(request: Request, key: string) {
  const supplied = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!supplied || key.length < 32) return false;
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(supplied), digest(key)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export function createFaststartHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const reply = (message: string, status = 200) => new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'POST') return reply('POST required', 405);
    if (!await serviceAuthorized(request, deps.serviceKey)) return reply('Service authentication required', 401);
    let leaseId: string | null = null;
    try {
      const payload = await request.json();
      const record = payload?.record;
      if (payload?.type !== 'INSERT' || !object(record)) return reply('ignored');
      const bucket = record.bucket_id, path = record.name, version = record.version;
      if (typeof bucket !== 'string' || !VIDEO_BUCKETS.has(bucket)) return reply('bucket not watched');
      if (typeof path !== 'string' || !/\.(mp4|mov|m4v)$/i.test(path)
        || /%|\\|(^|\/)\.{1,2}(\/|$)|\/\//.test(path)) return reply('not an eligible video path');
      if (!uuid(record.id) || typeof version !== 'string' || !version || version.length > 128) return reply('object generation unavailable');
      const claimed = await deps.db.rpc('claim_faststart_video_remux', {
        p_bucket: bucket, p_object_path: path, p_object_id: record.id, p_object_version: version,
      });
      if (claimed.error || !object(claimed.data) || !uuid(claimed.data.lease_id)) return reply('skip: no registered provenance');
      leaseId = claimed.data.lease_id;
      const proof = claimed.data;
      if (proof.object_id !== record.id || proof.object_version !== version || !etag(proof.etag)
        || !object(proof.metadata)) return reply('skip: invalid object proof');
      const source = await deps.download(bucket, path, version, leaseId);
      if (etag(source.etag) !== etag(proof.etag)) return reply('skip: downloaded version changed');
      if (source.blob.size > MAX_BYTES) return reply('too large, left alone');
      const result = deps.remux(new Uint8Array(await source.blob.arrayBuffer()));
      if (!result.ok) return reply('skip: ' + result.reason);
      const current = await deps.db.rpc('check_faststart_video_remux', { p_lease_id: leaseId });
      if (current.error || current.data !== true) return reply('skip: object access changed');
      // The SQL trigger compares the stored version again at the actual commit.
      // No upsert fallback, owner write, object deletion or retry against a new version.
      const updated = await deps.update(bucket, path, result.buf, source.blob.type || 'video/mp4', {
        ...proof.metadata, platinum_faststart_lease: leaseId,
      });
      return reply(updated.error ? 'rewrite not confirmed' : 'remuxed');
    } catch {
      return reply('processing unavailable; no unguarded retry');
    } finally {
      if (leaseId) {
        try { await deps.db.rpc('release_faststart_video_remux', { p_lease_id: leaseId }); } catch { /* The capability expires automatically. */ }
      }
    }
  };
}
