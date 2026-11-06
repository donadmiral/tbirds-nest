import { setTimeout as delay } from 'node:timers/promises';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { clipBackend } from './backend.mjs';
import { createClipWorker } from './worker.mjs';

const states = new Set(['idle', 'busy', 'ready', 'retry', 'failed', 'unavailable']);
const codes = new Set(['clip_deadline', 'clip_scratch_unavailable', 'clip_job_invalid', 'clip_lease_or_authority_lost',
  'clip_publication_rejected', 'clip_backend_unavailable', 'clip_backend_response_limit', 'clip_source_grant_invalid',
  'clip_upload_grant_invalid', 'clip_upload_failed', 'source_not_ready', 'source_download_failed', 'segment_download_failed',
  'recording_timeline_unavailable', 'source_budget', 'clip_output_budget', 'decode_failed', 'clip_worker_failed']);
const validCount = (number, maximum) => Number.isSafeInteger(number) && number >= 0 && number <= maximum;
export const HEALTH_FILENAME = 'pc-live-clips-health.json';

export function telemetry({ deployment, write = line => process.stdout.write(line), now = Date.now }) {
  if (typeof deployment !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(deployment)) throw Error('renderer_deployment_invalid');
  return (kind, result = {}, elapsedMs = 0) => {
    if (!['heartbeat', 'drain', 'stopping', 'fatal'].includes(kind)) return;
    const value = { event: 'live_clip_worker', kind, deployment, timestamp: new Date(now()).toISOString() };
    const metrics = {};
    if (kind === 'heartbeat') metrics.WorkerHeartbeat = 1;
    if (kind === 'drain') {
      value.state = states.has(result.state) ? result.state : 'unavailable';
      if (result.code) value.code = codes.has(result.code) ? result.code : 'clip_worker_failed';
      metrics.DrainCount = 1;
      metrics.Completed = value.state === 'ready' ? 1 : 0;
      metrics.Retry = value.state === 'retry' ? 1 : 0;
      metrics.Failed = value.state === 'failed' ? 1 : 0;
      metrics.Unavailable = value.state === 'unavailable' ? 1 : 0;
      metrics.DrainDurationMs = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.min(300000, Math.round(elapsedMs)) : 0;
      if (value.state === 'ready' && validCount(result.bytes, 536870912)) metrics.OutputBytes = result.bytes;
      if (value.state === 'ready' && validCount(result.assets, 4)) value.assets = result.assets;
    }
    if (Object.keys(metrics).length) {
      value._aws = { Timestamp: now(), CloudWatchMetrics: [{ Namespace: 'PlatinumCircles/LiveClips', Dimensions: [['deployment']],
        Metrics: Object.keys(metrics).map(Name => ({ Name, Unit: Name.endsWith('Ms') ? 'Milliseconds' : Name.endsWith('Bytes') ? 'Bytes' : 'Count' })) }] };
      Object.assign(value, metrics);
    }
    // The schema is constructed here: never spread job/error/provider objects.
    write(JSON.stringify(value) + '\n');
  };
}

/** Serial pull scheduler. Every process and the existing durable queue bound admission independently. */
export function createPullScheduler({ api, worker, emit = () => {}, now = Date.now, random = Math.random,
  sleep = (milliseconds, signal) => delay(milliseconds, undefined, { signal }) }, { idleMs = 60000 } = {}) {
  if (!Number.isInteger(idleMs) || idleMs < 10000 || idleMs > 300000) throw Error('renderer_poll_interval_invalid');
  let running = false;
  const health = { version: 1, heartbeat_ms: now(), cycle_started_ms: null, stopping: false };
  return {
    health,
    async run(signal) {
      if (running) throw Error('renderer_scheduler_already_running');
      running = true; let errors = 0;
      try {
        while (!signal.aborted) {
          health.cycle_started_ms = now();
          let result;
          try {
            const maintenance = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
            await api.maintain(maintenance);
            if (signal.aborted) break;
            result = await worker.drain(signal);
            if (!states.has(result?.state)) result = { state: 'unavailable' };
          } catch { result = { state: 'unavailable', code: 'clip_worker_failed' }; }
          const elapsed = now() - health.cycle_started_ms;
          health.cycle_started_ms = null;
          emit('drain', result, elapsed);
          if (signal.aborted) break;
          if (['retry', 'unavailable'].includes(result.state)) errors = Math.min(4, errors + 1);
          else errors = 0;
          const base = errors ? Math.min(300000, idleMs * 2 ** (errors - 1))
            : ['ready', 'failed'].includes(result.state) ? 5000 : idleMs;
          const jitter = Math.max(0, Math.min(1, Number(random()) || 0));
          const wait = errors ? Math.max(10000, Math.round(base * (0.8 + 0.2 * jitter))) : base;
          try { await sleep(wait, signal); } catch { if (!signal.aborted) throw Error('renderer_scheduler_failed'); }
        }
      } finally { running = false; health.stopping = true; health.cycle_started_ms = null; }
    },
  };
}

export async function writeHealth(directory, state, now = Date.now) {
  const filename = path.join(directory, HEALTH_FILENAME), temporary = filename + '.tmp';
  const value = { version: 1, heartbeat_ms: now(), cycle_started_ms: state.cycle_started_ms, stopping: state.stopping === true };
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, filename);
}

/** Production entrypoint has no HTTP listener and accepts no inbound scheduling token. */
export async function startPullWorker(env = process.env) {
  const api = clipBackend({ base: env.SUPABASE_URL, secret: env.LIVE_CLIP_WORKER_SECRET, cdnOrigin: env.LIVE_HLS_CDN_ORIGIN });
  const tempRoot = env.TMPDIR || os.tmpdir(), emit = telemetry({ deployment: env.RENDERER_DEPLOYMENT || 'local-renderer' });
  const idleMs = env.LIVE_CLIP_IDLE_MS ? Number(env.LIVE_CLIP_IDLE_MS) : 60000;
  await mkdir(tempRoot, { recursive: true });
  const worker = createClipWorker(api, { tempRoot }), stopping = new AbortController();
  const scheduler = createPullScheduler({ api, worker, emit }, { idleMs });
  let updating = false, ticks = 0, forcedStop;
  const pulse = async () => {
    if (updating) return;
    updating = true;
    try {
      await writeHealth(tempRoot, scheduler.health);
      if (ticks++ % 3 === 0) emit('heartbeat');
    } catch { emit('fatal'); stopping.abort(); }
    finally { updating = false; }
  };
  const stop = () => {
    if (stopping.signal.aborted) return;
    scheduler.health.stopping = true; emit('stopping'); stopping.abort();
    // Fargate stopTimeout is 30 seconds; leave the broker's five-second fail
    // call and local FFmpeg cancellation time to settle before forced exit.
    forcedStop = setTimeout(() => process.exit(0), 25000); forcedStop.unref();
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const heartbeat = setInterval(pulse, 20000);
  try { await pulse(); await scheduler.run(stopping.signal); }
  finally {
    clearInterval(heartbeat); clearTimeout(forcedStop);
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    await writeHealth(tempRoot, { ...scheduler.health, stopping: true }).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await startPullWorker(); }
  catch { process.stderr.write('{"event":"live_clip_worker","kind":"fatal","code":"renderer_startup_or_runtime_failed"}\n'); process.exitCode = 1; }
}
