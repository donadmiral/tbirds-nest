import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { taskRoleAws } from './aws.mjs';
import { transcriptionBackend } from './backend.mjs';
import { createTranscriptionWorker } from './worker.mjs';
import { codes } from './protocol.mjs';
export const HEALTH_FILENAME = 'pc-live-transcription-health.json';
const states = new Set(['idle', 'disabled', 'deferred', 'draft', 'cleaned', 'failed', 'revoked', 'unavailable']);
export function telemetry({ deployment, write = value => process.stdout.write(value), now = Date.now }) {
  if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(deployment || '')) throw Error('CONFIGURATION_INVALID');
  return (kind, result = {}, elapsed = 0) => {
    if (!['heartbeat', 'drain', 'stopping', 'fatal'].includes(kind)) return;
    const row = { event: 'live_transcription_worker', kind, deployment, timestamp: new Date(now()).toISOString() }, metrics = {};
    if (kind === 'heartbeat') metrics.WorkerHeartbeat = 1;
    if (kind === 'drain') {
      row.state = states.has(result.state) ? result.state : 'unavailable';
      if (result.code) row.code = codes.has(result.code) ? result.code : 'AWS_UNAVAILABLE';
      Object.assign(metrics, { DrainCount: 1, Drafts: row.state === 'draft' ? 1 : 0, Failed: row.state === 'failed' ? 1 : 0,
        Unavailable: row.state === 'unavailable' ? 1 : 0, Revoked: row.state === 'revoked' ? 1 : 0,
        CapacityDeferred: ['CAPACITY_LIMIT', 'DAILY_LIMIT'].includes(row.code) ? 1 : 0,
        CleanupPending: result.cleanup_pending === true || row.code === 'CLEANUP_PENDING' ? 1 : 0,
        DrainDurationMs: Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(100000, Math.round(elapsed)) : 0 });
    }
    if (Object.keys(metrics).length) {
      row._aws = { Timestamp: now(), CloudWatchMetrics: [{ Namespace: 'PlatinumCircles/LiveTranscription', Dimensions: [['deployment']],
        Metrics: Object.keys(metrics).map(Name => ({ Name, Unit: Name.endsWith('Ms') ? 'Milliseconds' : 'Count' })) }] };
      Object.assign(row, metrics);
    }
    // Build the entire schema here. Never spread job, exception or AWS bodies.
    write(JSON.stringify(row) + '\n');
  };
}
export function createScheduler(worker, { idleMs = 60000, now = Date.now, emit = () => {}, random = Math.random,
  sleep = (ms, signal) => delay(ms, undefined, { signal }) } = {}) {
  if (!Number.isInteger(idleMs) || idleMs < 10000 || idleMs > 300000) throw Error('CONFIGURATION_INVALID');
  const health = { version: 1, cycle_started_ms: null, stopping: false }; let running = false;
  return { health, async run(signal) {
    if (running) throw Error('SCHEDULER_ALREADY_RUNNING'); running = true; let failures = 0;
    try {
      while (!signal.aborted) {
        health.cycle_started_ms = now(); let result;
        try { result = await worker.drain(signal); } catch { result = { state: 'unavailable', code: 'AWS_UNAVAILABLE' }; }
        emit('drain', result, now() - health.cycle_started_ms); health.cycle_started_ms = null;
        if (signal.aborted) break;
        // RunTask is a bounded drain, not an always-running idle daemon.
        if (['idle', 'disabled'].includes(result.state) || result.code === 'DAILY_LIMIT') break;
        const degraded = result.state === 'unavailable' || result.state === 'deferred' && ['BROKER_UNAVAILABLE', 'AWS_UNAVAILABLE', 'AWS_RATE_LIMITED', 'DAILY_LIMIT'].includes(result.code);
        failures = degraded ? Math.min(4, failures + 1) : 0;
        const base = failures ? Math.min(300000, idleMs * 2 ** (failures - 1)) : ['draft', 'cleaned'].includes(result.state) ? 5000 : idleMs;
        const wait = Math.round(base * (failures ? 0.8 + Math.max(0, Math.min(1, Number(random()) || 0)) * 0.2 : 1));
        try { await sleep(wait, signal); } catch { if (!signal.aborted) throw Error('SCHEDULER_FAILED'); }
      }
    } finally { health.stopping = true; health.cycle_started_ms = null; running = false; }
  } };
}
export async function writeHealth(directory, health) {
  const filename = path.join(directory, HEALTH_FILENAME), temporary = filename + '.tmp';
  await writeFile(temporary, JSON.stringify({ version: 1, heartbeat_ms: Date.now(), cycle_started_ms: health.cycle_started_ms, stopping: health.stopping }), { mode: 0o600 });
  await rename(temporary, filename);
}
export async function start(env = process.env) {
  const config = loadConfig(env), emit = telemetry({ deployment: config.deployment });
  if (!config.enabled) { emit('drain', { state: 'disabled' }); return; }
  if (config.taskDeadline <= Date.now()) { emit('stopping'); return; }
  await mkdir(config.tempRoot, { recursive: true, mode: 0o700 });
  const aws = taskRoleAws(config, env), api = transcriptionBackend(config);
  const worker = createTranscriptionWorker({ config, api, aws }), stopping = new AbortController();
  const scheduler = createScheduler(worker, { idleMs: config.idleMs, emit });
  let pulseBusy = false, pulses = 0, forcedStop;
  const pulse = async () => {
    if (pulseBusy) return; pulseBusy = true;
    try { await writeHealth(config.tempRoot, scheduler.health); if (pulses++ % 3 === 0) emit('heartbeat'); }
    catch { emit('fatal'); stopping.abort(); } finally { pulseBusy = false; }
  };
  const stop = () => { if (stopping.signal.aborted) return; scheduler.health.stopping = true; emit('stopping'); stopping.abort();
    forcedStop = setTimeout(() => process.exit(0), 25000); forcedStop.unref(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const taskDeadline = setTimeout(stop, Math.max(0, config.taskDeadline - Date.now()));
  const heartbeat = setInterval(pulse, 20000);
  try { await pulse(); await scheduler.run(stopping.signal); }
  finally { clearInterval(heartbeat); clearTimeout(taskDeadline); clearTimeout(forcedStop); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    aws.destroy(); await writeHealth(config.tempRoot, { ...scheduler.health, stopping: true }).catch(() => {}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await start(); } catch { process.stderr.write('{"event":"live_transcription_worker","kind":"fatal","code":"CONFIGURATION_OR_RUNTIME_FAILED"}\n'); process.exitCode = 1; }
}
