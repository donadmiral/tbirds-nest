const { test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { policy, startPreparedFeedWorkers } = require('../tools/performance/prepared-feed-workers.cjs');

test('prepared workers cap concurrency, preserve tick spacing and never overlap a lane', async () => {
  const active = new Set(), starts = Array.from({ length: policy.lanes }, () => []);
  let peak = 0, pool;
  pool = startPreparedFeedWorkers(async (workerId, jobs) => {
    assert.equal(jobs, 1);assert.equal(active.has(workerId), false);
    active.add(workerId);peak = Math.max(peak, active.size);starts[workerId].push(performance.now());
    await new Promise(resolve => setTimeout(resolve, 25));active.delete(workerId);
    return { enabled: true, failed: 0, prepared: 1 };
  }, ({ totalPrepared }) => { if (totalPrepared >= policy.lanes * 2) pool.requestStop(); });
  await pool.done;
  assert.equal(pool.failure, null);assert.equal(peak, policy.lanes);
  assert.equal(pool.prepared, policy.lanes * 2);
  for (const times of starts) { assert.equal(times.length, 2);assert.ok(times[1] - times[0] >= policy.intervalMs - 10); }
  assert.equal(pool.metrics().peakInFlight, policy.lanes);
});

test('a slow lane completes before its next invocation and cannot accumulate overlapping work', async () => {
  const active = new Set();let peak = 0, completed = 0, pool;
  pool = startPreparedFeedWorkers(async workerId => {
    assert.equal(active.has(workerId), false);active.add(workerId);peak = Math.max(peak, active.size);
    await new Promise(resolve => setTimeout(resolve, policy.intervalMs + 20));
    active.delete(workerId);completed++;
    return { enabled: true, failed: 0, prepared: 1 };
  }, () => { if (completed > policy.lanes) pool.requestStop(); });
  await pool.done;
  assert.equal(pool.failure, null);assert.equal(completed, policy.lanes * 2);assert.ok(peak <= policy.lanes);
});

test('worker errors stop new scheduling and remain failures', async () => {
  const failure = Object.assign(Error('fixture'), { code: 'fixture_failure' });
  const pool = startPreparedFeedWorkers(async () => { throw failure; });
  await pool.done;
  assert.equal(pool.failure, failure);assert.equal(pool.prepared, 0);assert.equal(pool.metrics().failed, true);
  const invalid = startPreparedFeedWorkers(async () => ({ enabled: true, failed: 0, prepared: 2 }));
  await invalid.done;assert.equal(invalid.failure.code, 'prepared_worker_failed');
});
