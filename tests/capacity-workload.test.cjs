const { test } = require('node:test');
const assert = require('node:assert/strict');
const { budget, distribution, runWorkload } = require('../tools/performance/bounded-workload.cjs');

test('workload refuses unbounded or invalid durations, arrivals and workers', () => {
  for (const input of [{ seconds: 0 }, { seconds: 121 }, { rate: 501 }, { concurrency: 33 },
    { rate: NaN }, { seconds: 120, rate: 500 }, { maxScheduleLagMs: 0 }]) assert.throws(() => budget(input));
  assert.equal(budget().seconds, 30);
  assert.deepEqual(distribution([3, 1, 2]), { count: 3, p50: 2, p95: 3, p99: 3, max: 3 });
});

test('paced load executes its complete budget without exceeding worker concurrency', async () => {
  let active = 0, peak = 0;
  const result = await runWorkload({ seconds: 1, rate: 30, concurrency: 2 }, async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 45));
    active--;
    return { bytes: 100 };
  });
  assert.equal(result.passed, true);
  assert.equal(result.completed, 30);
  assert.equal(result.decodedResultBytes, 3000);
  assert.equal(result.peakInFlight, peak);
  assert.ok(peak <= 2);
  assert.ok(result.elapsedMs >= 950);
});

test('a saturated arrival schedule stops and cannot pass with fewer completed operations', async () => {
  const result = await runWorkload({ seconds: 1, rate: 100, concurrency: 1, maxScheduleLagMs: 25 }, async () => {
    await new Promise(resolve => setTimeout(resolve, 80));
  });
  assert.equal(result.passed, false);
  assert.equal(result.stopReason, 'arrival_schedule_exceeded');
  assert.ok(result.unissued > 0);
});

test('failed operations stop new work and never disclose private error details', async () => {
  const result = await runWorkload({ seconds: 1, rate: 100, concurrency: 1 }, async () => {
    throw new Error('postgres://private:secret@example.invalid');
  });
  assert.equal(result.passed, false);
  assert.equal(result.failures, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.errors.operation_failed, 1);
  assert.doesNotMatch(JSON.stringify(result), /secret|postgres:\/\//);
});
