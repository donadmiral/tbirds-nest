import { boundedPushJson, servicePushAuthorized, validUuid, waitForPush } from '../_shared/pushDelivery.ts';
import { readAdmittedMedia } from './boundedRead.ts';
import { faststartRemux, INLINE_MAX_BYTES } from './remux.ts';
export type MediaJob = {
  job_id: string; lease_id: string; attempt: number; lease_until: string;
  source_id: string; source_version: string; source_bucket: string; source_path: string;
  source_bytes: number; source_etag: string; source_mime: string; output_bucket: string; output_path: string;
};
type Dependencies = {
  serviceKey: string;
  authorizeLegacyService?: (request: Request, signal: AbortSignal) => Promise<boolean>;
  rpc(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  download(job: MediaJob, signal: AbortSignal): Promise<Response>;
  upload(job: MediaJob, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  remove?(bucket: string, path: string, signal: AbortSignal): Promise<void>;
  deadlineMs?: number; maxJobs?: number;
};
const cleanEtag = (value: string | null) => value?.trim().replace(/^"|"$/g, '') || '';
const validPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 1024
  && !/[%\\\u0000-\u001f]|(^|\/)\.{1,2}(\/|$)|\/\//.test(value);
function validJob(value: unknown): value is MediaJob {
  const j = value as MediaJob | null;
  return !!j && validUuid(j.job_id) && validUuid(j.lease_id) && validUuid(j.source_id)
    && Number.isInteger(j.attempt) && j.attempt >= 1 && j.attempt <= 5
    && ['post-media', 'story-media'].includes(j.source_bucket) && j.output_bucket === 'derived-media'
    && validPath(j.source_path) && !j.source_path.includes('/_derived_v1/')
    && validPath(j.output_path) && j.output_path === j.source_path.split('/')[0] + '/_derived_v1/' + j.job_id + '/' + j.lease_id + (j.source_mime === 'video/quicktime' ? '.mov' : '.mp4')
    && typeof j.source_version === 'string' && j.source_version.length > 0 && j.source_version.length <= 128
    && typeof j.source_etag === 'string' && !!j.source_etag && !j.source_etag.startsWith('W/')
    && Number.isSafeInteger(j.source_bytes) && j.source_bytes > 0 && j.source_bytes <= INLINE_MAX_BYTES;
}
function retrySeconds(response: Response) {
  const value = response.headers.get('Retry-After') || '';
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.min(86400, Math.max(1, seconds)) : 30;
}
export function createDurableFaststartHandler(deps: Dependencies) {
  let draining = false;
  const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'POST required' });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Math.min(deps.deadlineMs ?? 35000, 45000))]);
    let acquired = false, current: MediaJob | undefined;
    const rpc = (name: string, args: Record<string, unknown>, useSignal = signal) => waitForPush(deps.rpc(name, args, useSignal), useSignal);
    const finish = (outcome: string, code: string | null = null, retry: number | null = null) => rpc('finish_media_processing_v1', {
      p_job_id: current!.job_id, p_lease_id: current!.lease_id, p_attempt: current!.attempt,
      p_outcome: outcome, p_error_code: code, p_retry_after_seconds: retry,
    });
    try {
      if (!await servicePushAuthorized(request, deps.serviceKey)
        && await deps.authorizeLegacyService?.(request, signal) !== true) return json(401, { error: 'Service authentication required' });
      const body = await boundedPushJson(request, signal, 32768);
      if (body.action === 'maintenance') {
        if (!deps.remove) return json(503, { error: 'Media maintenance unavailable' });
        const reconciled = await rpc('reconcile_media_processing_v1', { p_limit: 100 });
        const cleanups = await rpc('claim_media_cleanup_v1', { p_limit: 10 });
        if (!Array.isArray(cleanups) || cleanups.length > 10) throw new Error('INVALID_CLEANUP_PROOF');
        let removed = 0;
        for (const item of cleanups) {
          if (!validUuid(item.lease_id) || !validUuid(item.cleanup_lease) || !validUuid(item.object_id)
            || item.bucket !== 'derived-media' || !validPath(item.path)
            || !/^[0-9a-f-]{36}\/_derived_v1\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov)$/i.test(item.path)
            || item.path.split('/')[3].split('.')[0] !== item.lease_id) throw new Error('INVALID_CLEANUP_PROOF');
          // SQL sealed the path before returning it. The Storage guard forbids
          // overwrite/recreation, so cleanup cannot delete a replacement source.
          await waitForPush(deps.remove(item.bucket, item.path, signal), signal);
          if (await rpc('finish_media_cleanup_v1', { p_lease_id: item.lease_id, p_cleanup_lease: item.cleanup_lease }) === true) removed++;
        }
        const pruned = await rpc('prune_media_processing_v1', { p_limit: 100 });
        return json(200, { reconciled, removed, pruned });
      }
      if (body.action !== 'drain') {
        const r = body.record as Record<string, unknown> | undefined;
        if (body.type !== 'INSERT' || !r || !validUuid(r.id) || typeof r.version !== 'string' || !r.version || r.version.length > 128
          || !['post-media', 'story-media'].includes(String(r.bucket_id)) || !validPath(r.name)
          || !/\.(mp4|mov|m4v)$/i.test(r.name) || r.name.includes('/_derived_v1/')) return json(200, { state: 'ignored' });
        const queued = await rpc('enqueue_media_processing_v1', { p_bucket: r.bucket_id, p_path: r.name, p_object_id: r.id, p_version: r.version });
        return json(202, queued);
      }
      // This also limits overlapping requests inside a single isolate. The SQL
      // settings-row semaphore supplies the project-wide leased concurrency cap.
      if (draining) return json(202, { state: 'busy' });
      draining = true; acquired = true;
      let completed = 0;
      for (let n = 0; n < Math.min(4, Math.max(1, deps.maxJobs ?? 2)); n++) {
        const claims = await rpc('claim_media_processing_v1', { p_lane: 'inline', p_limit: 1 });
        if (!Array.isArray(claims) || !claims.length) break;
        if (claims.length !== 1 || !validJob(claims[0])) throw new Error('INVALID_JOB_PROOF');
        current = claims[0];
        const source = await waitForPush(deps.download(current, signal), signal);
        if (source.status === 429 || source.status === 503) {
          const retry = retrySeconds(source); void source.body?.cancel().catch(() => {});
          await finish('retry', 'upstream_throttled', retry); current = undefined; break;
        }
        if (cleanEtag(source.headers.get('ETag')) !== cleanEtag(current.source_etag)) {
          void source.body?.cancel().catch(() => {}); await finish('retry', 'etag_mismatch'); current = undefined; continue;
        }
        const bytes = await readAdmittedMedia(source, { expectedBytes: current.source_bytes, maxBytes: INLINE_MAX_BYTES, signal });
        const result = faststartRemux(bytes);
        if (!result.ok) {
          if (!await finish(result.reason === 'already_faststart' ? 'passthrough' : 'external', result.reason)) throw new Error('FINISH_NOT_CONFIRMED');
        } else {
          const valid = await rpc('check_media_processing_v1', { p_job_id: current.job_id, p_lease_id: current.lease_id, p_attempt: current.attempt });
          if (valid !== true) throw new Error('SOURCE_CHANGED');
          await waitForPush(deps.upload(current, result.buf, signal), signal);
          if (!await finish('ready')) throw new Error('FINISH_NOT_CONFIRMED');
        }
        completed++; current = undefined;
      }
      return json(200, { completed });
    } catch {
      // Use a separate short budget for durable failure recording. If the
      // process dies or that RPC fails, the same job becomes claimable on lease
      // expiry. A retry never reuses the previous attempt's output path.
      if (current) {
        try {
          const recovery = AbortSignal.timeout(3000);
          await rpc('finish_media_processing_v1', { p_job_id: current.job_id, p_lease_id: current.lease_id,
            p_attempt: current.attempt, p_outcome: 'retry', p_error_code: signal.aborted ? 'worker_deadline' : 'processing_unavailable' }, recovery);
        } catch { /* Lease expiry retains the durable retry. */ }
      }
      return json(503, { error: 'Media preparation unavailable; original retained' });
    } finally { if (acquired) draining = false; }
  };
}
