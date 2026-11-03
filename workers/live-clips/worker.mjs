import { mkdtemp, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { materializeSource } from './source.mjs';
import { renderClip } from './render.mjs';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const safeError = error => /^[a-z][a-z0-9_]{1,70}$/.test(error?.message || '') ? error.message : 'clip_worker_failed';
export function validateClipJob(job) {
  if (!job || !uuid(job.id) || !uuid(job.lease_id) || !uuid(job.clip_id) || !uuid(job.session_id) || !uuid(job.owner_id)
    || !Number.isSafeInteger(job.start_ms) || !Number.isSafeInteger(job.end_ms) || job.start_ms < 0
    || job.end_ms - job.start_ms < 1000 || job.end_ms - job.start_ms > 600000
    || typeof job.source_path !== 'string' || job.source_path.split('/').length !== 4
    || job.source_path.split('/')[0] !== 'live' || job.source_path.split('/')[1] !== job.session_id
    || !uuid(job.source_path.split('/')[2]) || job.source_path.split('/')[3] !== 'master.m3u8'
    || typeof job.output_prefix !== 'string' || job.output_prefix !== `${job.owner_id}/${job.session_id}/${job.clip_id}/${job.lease_id}/`)
    throw new Error('clip_job_invalid');
  return job;
}
/** One leased job per process. Fleet concurrency is admitted by the database. */
export function createClipWorker(api, { deadlineMs = 240000, tempRoot = os.tmpdir(), materialize = materializeSource,
  encode = renderClip, maxBytes = 536870912, fetcher = fetch, removeDirectory = rm } = {}) {
  let active = false;
  return {
    get active() { return active; },
    async drain(parentSignal) {
      if (active) return { state: 'busy' };
      active = true; const controller = new AbortController(), abort = () => controller.abort();
      const timer = setTimeout(abort, deadlineMs); timer.unref();
      parentSignal?.addEventListener('abort', abort, { once: true }); if (parentSignal?.aborted) abort();
      let job, directory;
      try {
        const disk = await statfs(tempRoot);
        if (Number(disk.bavail) * Number(disk.bsize) < maxBytes * 2 + 33554432) throw new Error('clip_scratch_unavailable');
        const claim = await api.claim(controller.signal);
        if (!claim) return { state: 'idle' };
        job = validateClipJob(claim);
        directory = await mkdtemp(path.join(tempRoot, 'pc-live-clip-'));
        // A fresh grant is requested after admission. A queued bearer URL is
        // never persisted, and ownership/revocation is checked again at finish.
        const url = await api.source(job, controller.signal);
        const source = await materialize({ url, startMs: job.start_ms, endMs: job.end_ms }, path.join(directory, 'source'),
          { signal: controller.signal, maxBytes, fetcher });
        const output = path.join(directory, 'output');
        const result = await encode(source, output, job, { signal: controller.signal, maxBytes });
        if (!await api.check(job, controller.signal)) throw new Error('clip_lease_or_authority_lost');
        for (const asset of result.assets) {
          if (!/^(?:horizontal\.mp4|vertical\.mp4|thumbnail\.jpg|captions\.vtt)$/.test(asset.name)) throw new Error('clip_asset_invalid');
          await api.upload(job, asset, path.join(output, asset.name), controller.signal);
        }
        if (!await api.complete(job, result, controller.signal)) throw new Error('clip_publication_rejected');
        return { state: 'ready', assets: result.assets.length, bytes: result.assets.reduce((sum, a) => sum + a.bytes, 0) };
      } catch (error) {
        let finished;
        if (job) { try { finished = await api.fail(job, { permanent: !!error.permanent, code: controller.signal.aborted ? 'clip_deadline' : safeError(error) }, AbortSignal.timeout(5000)); } catch {} }
        // Only the durable queue determines terminal failure. A permanent
        // encoder error can still be scheduled for retry by the current SQL.
        const state = finished?.ok === true && ['ready', 'failed'].includes(finished.state) ? finished.state : job ? 'retry' : 'unavailable';
        return { state, code: controller.signal.aborted ? 'clip_deadline' : safeError(error) };
      } finally {
        clearTimeout(timer); parentSignal?.removeEventListener('abort', abort);
        try { if (directory) await removeDirectory(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); }
        finally { active = false; }
      }
    },
  };
}
