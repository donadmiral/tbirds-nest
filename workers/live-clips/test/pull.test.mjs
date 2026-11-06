import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPullScheduler, telemetry, writeHealth, HEALTH_FILENAME } from '../pull.mjs';
import { isHealthy } from '../health.mjs';

test('private scheduling serializes maintenance and one drain, then bounds idle/retry pressure', async () => {
  const stop = new AbortController(), waits = [], calls = [], results = [
    { state: 'idle' }, { state: 'ready' }, { state: 'retry' }, { state: 'unavailable' },
    { state: 'unavailable' }, { state: 'unavailable' }, { state: 'ready' },
  ];
  let index = 0, active = 0, maximum = 0;
  const loop = createPullScheduler({
    api: { maintain: async () => { calls.push('maintain'); assert.equal(active, 0); } },
    worker: { drain: async () => { active++; maximum = Math.max(maximum, active); calls.push('drain'); await Promise.resolve(); active--; return results[index++]; } },
    random: () => 0, sleep: async milliseconds => { waits.push(milliseconds); if (index === results.length) stop.abort(); },
  });
  await loop.run(stop.signal);
  assert.equal(maximum, 1); assert.equal(calls.length, results.length * 2);
  assert.deepEqual(calls, results.flatMap(() => ['maintain', 'drain']));
  assert.deepEqual(waits, [60000, 5000, 48000, 96000, 192000, 240000, 5000]);
  assert.equal(loop.health.stopping, true);
});

test('maintenance failure skips claiming; stop cancels a live cycle before admitting another', async () => {
  const stop = new AbortController(), events = []; let claims = 0, maintenance = 0;
  const loop = createPullScheduler({
    api: { maintain: async () => { maintenance++; throw Error('sensitive raw provider error'); } },
    worker: { drain: async () => { claims++; } }, emit: (...value) => events.push(value),
    sleep: async () => stop.abort(),
  });
  await loop.run(stop.signal);
  assert.equal(maintenance, 1); assert.equal(claims, 0);
  assert.deepEqual(events[0].slice(0, 2), ['drain', { state: 'unavailable', code: 'clip_worker_failed' }]);

  const cancel = new AbortController(); let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  const busy = createPullScheduler({ api: { maintain: async () => {} }, worker: { drain: async signal => {
    reached(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { state: 'retry', code: 'clip_deadline' };
  } }, sleep: async () => { throw Error('sleep after stop'); } });
  const running = busy.run(cancel.signal); await entered;
  await assert.rejects(busy.run(cancel.signal), /already_running/);
  cancel.abort(); await running;
  assert.equal(busy.health.stopping, true);
});

test('telemetry has fixed fields and cannot emit job metadata, signed URLs or raw error secrets', () => {
  let output = '';
  const emit = telemetry({ deployment: 'synthetic-renderer', now: () => 1000000, write: line => { output += line; } });
  const secret = 'synthetic-broker-canary-that-must-never-leak';
  emit('drain', { state: 'ready', code: secret, bytes: 128, assets: 4,
    title: secret, source_url: 'https://private.invalid/_live/' + secret, job_id: secret }, 1500);
  emit('heartbeat'); emit('fatal', { message: secret });
  const events = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(output.includes(secret), false); assert.equal(output.includes('https://'), false);
  assert.equal(events[0].code, 'clip_worker_failed'); assert.equal(events[0].Completed, 1);
  assert.equal(events[0].OutputBytes, 128); assert.equal(events[0].DrainDurationMs, 1500);
  assert.equal(events[0]._aws.CloudWatchMetrics[0].Namespace, 'PlatinumCircles/LiveClips');
  assert.equal(events[1].WorkerHeartbeat, 1);
  assert.deepEqual(events[2], { event: 'live_clip_worker', kind: 'fatal', deployment: 'synthetic-renderer', timestamp: new Date(1000000).toISOString() });
});

test('file health fails closed for stalled cycles, stale/future heartbeats, stopping and symlinks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pc-pull-health-')), now = 1000000;
  const file = path.join(directory, HEALTH_FILENAME);
  try {
    await writeHealth(directory, { cycle_started_ms: null, stopping: false }, () => now);
    assert.equal(await isHealthy(directory, now), true);
    assert.equal((await readFile(file, 'utf8')).includes('secret'), false);
    assert.equal(await isHealthy(directory, now + 90000), false);
    assert.equal(await isHealthy(directory, now - 1), false);
    await writeHealth(directory, { cycle_started_ms: now - 290000, stopping: false }, () => now);
    assert.equal(await isHealthy(directory, now), false);
    await writeHealth(directory, { cycle_started_ms: null, stopping: true }, () => now);
    assert.equal(await isHealthy(directory, now), false);
    await writeFile(file, 'x'.repeat(1025)); assert.equal(await isHealthy(directory, now), false);
    await rm(file); await symlink('/must-not-read', file); assert.equal(await isHealthy(directory, now), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
