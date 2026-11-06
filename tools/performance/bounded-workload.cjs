'use strict';
const { performance } = require('node:perf_hooks');
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

function budget(input = {}) {
  const result = { seconds: 30, rate: 20, concurrency: 8, maxScheduleLagMs: 1000, maxP95Ms: 500, ...input };
  for (const [name, low, high, integer] of [
    ['seconds', 1, 120, true], ['rate', 1, 500, true], ['concurrency', 1, 32, true],
    ['maxScheduleLagMs', 1, 5000, false], ['maxP95Ms', 1, 10000, false],
  ]) {
    if (!Number.isFinite(result[name]) || result[name] < low || result[name] > high || (integer && !Number.isInteger(result[name]))) {
      throw Error(`Invalid bounded workload ${name}`);
    }
  }
  if (result.seconds * result.rate > 20000) throw Error('The bounded workload exceeds 20000 operations');
  return result;
}
function distribution(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const at = p => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
  return { count: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1) ?? null };
}

/** Open-loop arrival budget, bounded workers, no remote transport or credentials. */
async function runWorkload(input, operation) {
  const plan = budget(input);
  if (typeof operation !== 'function') throw Error('An explicit local operation is required');
  const planned = plan.seconds * plan.rate;
  const began = performance.now();
  const samples = [];
  let next = 0, inFlight = 0, peakInFlight = 0, stopReason = null;
  async function worker(workerId) {
    while (!stopReason) {
      const sequence = next++;
      if (sequence >= planned) return;
      const due = began + sequence * 1000 / plan.rate;
      await sleep(due - performance.now());
      if (stopReason) return;
      const started = performance.now();
      const scheduleLagMs = Math.max(0, started - due);
      if (scheduleLagMs > plan.maxScheduleLagMs) {
        stopReason = 'arrival_schedule_exceeded';
        return;
      }
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      let error = null, bytes = 0;
      try {
        const result = await operation({ workerId, sequence });
        bytes = Number.isSafeInteger(result?.bytes) && result.bytes >= 0 ? result.bytes : 0;
      } catch (failure) {
        // Do not persist connection strings, SQL payloads, tokens, or user data.
        error = /^[A-Za-z0-9_]{1,40}$/.test(failure?.code || '') ? failure.code : 'operation_failed';
        stopReason ||= 'operation_failed';
      } finally {
        inFlight--;
      }
      const ended = performance.now();
      samples.push({ sequence, serviceMs: ended - started, endToEndMs: ended - due, scheduleLagMs, bytes, error });
    }
  }
  await Promise.all(Array.from({ length: plan.concurrency }, (_, index) => worker(index)));
  const elapsedMs = performance.now() - began;
  const errors = samples.filter(row => row.error);
  const serviceMs = distribution(samples.map(row => row.serviceMs));
  return {
    plan, planned, completed: samples.length, failures: errors.length, unissued: planned - samples.length,
    stopReason, elapsedMs, achievedOperationsPerSecond: samples.length / (elapsedMs / 1000), peakInFlight,
    decodedResultBytes: samples.reduce((sum, row) => sum + row.bytes, 0),
    serviceMs, endToEndMs: distribution(samples.map(row => row.endToEndMs)),
    scheduleLagMs: distribution(samples.map(row => row.scheduleLagMs)),
    errors: Object.fromEntries([...new Set(errors.map(row => row.error))].map(code => [code, errors.filter(row => row.error === code).length])),
    passed: !stopReason && samples.length === planned && errors.length === 0 && serviceMs.p95 <= plan.maxP95Ms,
  };
}
module.exports = { budget, distribution, runWorkload };
