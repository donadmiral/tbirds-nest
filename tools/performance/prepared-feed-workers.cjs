'use strict';
const { performance } = require('node:perf_hooks');
const { distribution } = require('./bounded-workload.cjs');
const policy = Object.freeze(require('../../supabase/ops/prepared-feed-worker-v2/policy.json'));

// Mirror the deployable pg_cron policy: independent, non-overlapping lanes.
// A slow lane resumes when its current statement finishes. It never creates
// overlapping statements or an unbounded queue of missed timer callbacks.
function startPreparedFeedWorkers(runTick, onTick = () => {}) {
  if (typeof runTick !== 'function') throw Error('An explicit worker operation is required');
  const began = performance.now(), pendingTimers = new Map(), samples = [];
  let stopping = false, failure = null, prepared = 0, inFlight = 0, peakInFlight = 0;
  function requestStop() {
    stopping = true;
    for (const [timer, resolve] of pendingTimers) { clearTimeout(timer); resolve(); }
    pendingTimers.clear();
  }
  const pause = ms => new Promise(resolve => {
    const timer = setTimeout(() => { pendingTimers.delete(timer); resolve(); }, Math.max(0, ms));
    pendingTimers.set(timer, resolve);
  });
  async function lane(workerId) {
    let due = performance.now();
    while (!stopping) {
      if (performance.now() < due) await pause(due - performance.now());
      if (stopping) return;
      const started = performance.now();
      inFlight++; peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        const row = await runTick(workerId, policy.jobsPerTick);
        if (row?.enabled !== true || row.failed !== 0 || !Number.isInteger(row.prepared)
          || row.prepared < 0 || row.prepared > policy.jobsPerTick) {
          throw Object.assign(Error('Prepared worker did not satisfy its bounded contract'), { code: 'prepared_worker_failed' });
        }
        prepared += row.prepared;
        samples.push({ workerId, prepared: row.prepared, serviceMs: performance.now() - started });
        await onTick({ workerId, prepared: row.prepared, totalPrepared: prepared, elapsedMs: performance.now() - began });
      } catch (error) {
        failure ||= error;
        requestStop();
      } finally { inFlight--; }
      due = Math.max(due + policy.intervalMs, performance.now());
    }
  }
  const done = Promise.all(Array.from({ length: policy.lanes }, (_, index) => lane(index)));
  return {
    done,
    requestStop,
    async stop() { requestStop(); await done; },
    get failure() { return failure; },
    get prepared() { return prepared; },
    get ticks() { return samples.length; },
    metrics() {
      const elapsedMs = performance.now() - began;
      return { policy, elapsedMs, ticks: samples.length, prepared, peakInFlight,
        preparedPerSecond: prepared / (elapsedMs / 1000),
        serviceMs: distribution(samples.map(row => row.serviceMs)),
        busyServiceMs: distribution(samples.filter(row => row.prepared > 0).map(row => row.serviceMs)),
        preparedByLane: Array.from({ length: policy.lanes }, (_, workerId) => samples.filter(row => row.workerId === workerId).reduce((sum, row) => sum + row.prepared, 0)),
        failed: !!failure };
    },
  };
}
module.exports = { policy, startPreparedFeedWorkers };
