#!/usr/bin/env node
'use strict';
// Evaluates recorded measurements. It neither generates load nor purchases
// capacity. Unknown observations and expired reservations always fail closed.
const fs = require('node:fs');
const STAGES = [100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000, 20000000];
const METRICS = {
  feed_p95_ms: 500,
  inbox_p95_ms: 400,
  write_p95_ms: 500,
  admin_p95_ms: 1500,
  server_error_ratio: 0.005,
  database_cpu_peak_ratio: 0.7,
  database_connections_peak_ratio: 0.7,
  replica_lag_seconds: 5,
  notification_oldest_seconds: 30,
  counter_snapshot_lag_seconds: 5,
  media_job_oldest_seconds: 300,
  regional_playback_p95_ms: 2500,
  playback_rebuffer_ratio: 0.01,
  recovery_seconds: 300,
};
const CAPACITIES = ['api_requests_per_second', 'realtime_connections', 'realtime_events_per_second', 'media_bytes_per_second', 'media_jobs_per_second', 'push_requests_per_second'];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function evaluate(receipt, now = Date.now()) {
  const failures = [];
  const fail = (ok, reason) => { if (!ok) failures.push(reason); };
  fail(receipt?.version === 1, 'A versioned measured receipt is required');
  fail(STAGES.includes(receipt?.dauEquivalent), 'Choose a defined staged DAU-equivalent target');
  fail(receipt?.kind === 'authenticated-mixed-load', 'The receipt must describe authenticated mixed load');
  fail(/^[0-9a-f]{40}$/.test(receipt?.sourceCommit ?? ''), 'An exact tested source commit is required');
  const endedAt = Date.parse(receipt?.endedAt ?? '');
  fail(Number.isFinite(endedAt) && endedAt <= now && now - endedAt <= 7 * 86400000, 'Measurements must be dated, complete, and no more than seven days old');
  const minimumDuration = receipt?.dauEquivalent >= 5000000 ? 86400 : 1800;
  fail(finite(receipt?.durationSeconds) && receipt.durationSeconds >= minimumDuration, `This stage requires at least ${minimumDuration} measured seconds`);
  for (const surface of ['web', 'native', 'admin', 'backend']) {
    fail(receipt?.releases?.[surface] === receipt?.sourceCommit && /^[0-9a-f]{40}$/.test(receipt?.releases?.[surface] ?? ''), `${surface} release must match the tested commit`);
  }
  for (const check of ['authorization', 'noCrossAccountData', 'counters', 'idempotency', 'messages', 'exports', 'viralPost', 'reconnectBurst', 'failureRecovery']) {
    fail(receipt?.correctness?.[check] === true, `Correctness evidence missing or failed: ${check}`);
  }
  for (const [key, ceiling] of Object.entries(METRICS)) {
    fail(finite(receipt?.metrics?.[key]) && receipt.metrics[key] <= ceiling, `Measured ${key} must be at most ${ceiling}`);
  }
  const regions = receipt?.regions;
  fail(Array.isArray(regions) && regions.length >= 3 && new Set(regions).size === regions.length && regions.every(r => typeof r === 'string' && /^[a-z][a-z0-9-]{1,39}$/.test(r)), 'Playback needs at least three distinct measured regions');
  for (const key of CAPACITIES) {
    const observed = receipt?.observedPeaks?.[key];
    const reservation = receipt?.reservations?.[key];
    fail(finite(observed) && observed > 0, `Observed peak missing: ${key}`);
    const confirmedAt = Date.parse(reservation?.confirmedAt ?? '');
    const validUntil = Date.parse(reservation?.validUntil ?? '');
    fail(finite(reservation?.limit) && reservation.limit >= observed * 1.3
      && Number.isFinite(confirmedAt) && confirmedAt <= now && validUntil > now
      && typeof reservation?.evidence === 'string' && reservation.evidence.length >= 8,
    `Current provider capacity with 30% reserve is required: ${key}`);
  }
  fail(finite(receipt?.cost?.projectedMonthlyUsd) && receipt.cost.projectedMonthlyUsd > 0
    && finite(receipt?.cost?.approvedMonthlyUsd) && receipt.cost.approvedMonthlyUsd >= receipt.cost.projectedMonthlyUsd
    && typeof receipt.cost.approvalEvidence === 'string' && receipt.cost.approvalEvidence.length >= 8,
  'A measured monthly cost projection must fit the explicitly approved budget');
  return { version: 1, passed: failures.length === 0, dauEquivalent: receipt?.dauEquivalent ?? null,
    sourceCommit: receipt?.sourceCommit ?? null, evaluatedAt: new Date(now).toISOString(), failures };
}

if (require.main === module) {
  try {
    const file = process.argv[2];
    if (!file || process.argv.length !== 3) throw new Error('Usage: node tools/performance/capacity-gate.cjs measured-receipt.json');
    if (fs.statSync(file).size > 1_000_000) throw new Error('Receipt exceeds the input budget');
    const result = evaluate(JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { evaluate, STAGES, METRICS, CAPACITIES };
