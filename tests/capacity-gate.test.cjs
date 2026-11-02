const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, METRICS, CAPACITIES } = require('../tools/performance/capacity-gate.cjs');
const now = Date.parse('2026-11-02T12:00:00Z');
function fixture() {
  const sha = 'a'.repeat(40);
  return { version: 1, kind: 'authenticated-mixed-load', dauEquivalent: 5000000,
    sourceCommit: sha, endedAt: new Date(now - 60000).toISOString(), durationSeconds: 86400,
    releases: { web: sha, native: sha, admin: sha, backend: sha },
    correctness: Object.fromEntries(['authorization','noCrossAccountData','counters','idempotency','messages','exports','viralPost','reconnectBurst','failureRecovery'].map(k => [k,true])),
    metrics: Object.fromEntries(Object.entries(METRICS).map(([k,v]) => [k,v / 2])),
    regions: ['us-west','eu-west','ap-south'],
    observedPeaks: Object.fromEntries(CAPACITIES.map(k => [k,100])),
    reservations: Object.fromEntries(CAPACITIES.map(k => [k,{ limit: 130, confirmedAt: new Date(now-86400000).toISOString(), validUntil: new Date(now+86400000).toISOString(), evidence: 'synthetic-fixture-only' }])),
    cost: { projectedMonthlyUsd: 100, approvedMonthlyUsd: 120, approvalEvidence: 'synthetic-fixture-only' },
  };
}
test('complete synthetic evidence exercises acceptance, never certifies a live project', () => assert.equal(evaluate(fixture(), now).passed, true));
test('offline assumptions and absent metrics never pass', () => {
  assert.equal(evaluate({}, now).passed, false);
  const r = fixture(); r.kind = 'assumption-only'; delete r.metrics.feed_p95_ms;
  const result = evaluate(r, now);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.includes('authenticated')));
  assert.ok(result.failures.some(f => f.includes('feed_p95')));
});
test('five-million stage needs the full soak and every release', () => {
  const r = fixture(); r.durationSeconds = 86399; r.releases.native = 'b'.repeat(40);
  assert.equal(evaluate(r, now).failures.length, 2);
});
test('capacity reserves expire and must cover measured peaks plus headroom', () => {
  const r = fixture(); r.reservations.realtime_connections.limit = 129;
  r.reservations.media_bytes_per_second.validUntil = new Date(now-1).toISOString();
  assert.equal(evaluate(r, now).failures.length, 2);
});
test('a successful traffic rate cannot excuse correctness failures or overspend', () => {
  const r = fixture(); r.correctness.noCrossAccountData = false; r.cost.projectedMonthlyUsd = 121;
  assert.equal(evaluate(r, now).failures.length, 2);
});
test('future, stale, nonnumeric and missing observations are rejected', () => {
  for (const endedAt of [new Date(now+1).toISOString(),new Date(now-8*86400000).toISOString()]) {
    const r=fixture();r.endedAt=endedAt;assert.equal(evaluate(r,now).passed,false);
  }
  for (const value of [null,undefined,NaN,Infinity,-1,'0']) {
    const r=fixture();r.metrics.server_error_ratio=value;assert.equal(evaluate(r,now).passed,false);
  }
});
