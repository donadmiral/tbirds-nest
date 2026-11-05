const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, demandFor, METRICS, CAPACITIES } = require('../tools/performance/capacity-gate.cjs');
const now = Date.parse('2026-11-02T12:00:00Z');
function fixture() {
  const sha = 'a'.repeat(40);
  const demand = demandFor(5000000);
  const peaks = { ...Object.fromEntries(CAPACITIES.map(k => [k,100])),
    api_requests_per_second: demand.peakApiRps, media_bytes_per_second: demand.peakMediaBytesPerSecond,
    realtime_connections: demand.peakRealtimeConnections };
  return { version: 1, kind: 'authenticated-mixed-load', dauEquivalent: 5000000,
    sourceCommit: sha, endedAt: new Date(now - 60000).toISOString(), durationSeconds: 86400,
    releases: { web: sha, native: sha, admin: sha, backend: sha },
    correctness: Object.fromEntries(['authorization','noCrossAccountData','counters','idempotency','messages','exports','viralPost','reconnectBurst','failureRecovery'].map(k => [k,true])),
    metrics: Object.fromEntries(Object.entries(METRICS).map(([k,v]) => [k,v / 2])),
    regions: ['us-west','eu-west','ap-south'],
    traffic: { scenarioSha256: demand.scenarioSha256, distinctAuthenticatedAccounts: demand.minimumDistinctAccounts,
      successfulApiOperations: Math.ceil(demand.averageApiRps * 86400), deliveredMediaBytes: Math.ceil(demand.averageMediaBytesPerSecond * 86400),
      droppedArrivals: 0, scheduleLagP95Ms: 1,
      peakWindows: [{ startedAtSeconds: 0, durationSeconds: 900, apiRequestsPerSecond: demand.peakApiRps,
        mediaBytesPerSecond: demand.peakMediaBytesPerSecond, realtimeConnections: demand.peakRealtimeConnections }] },
    observedPeaks: peaks,
    reservations: Object.fromEntries(CAPACITIES.map(k => [k,{ limit: peaks[k] * 1.3, confirmedAt: new Date(now-86400000).toISOString(), validUntil: new Date(now+86400000).toISOString(), evidence: 'synthetic-fixture-only' }])),
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
  const r = fixture(); r.reservations.realtime_connections.limit = r.observedPeaks.realtime_connections * 1.29;
  r.reservations.media_bytes_per_second.validUntil = new Date(now-1).toISOString();
  assert.equal(evaluate(r, now).failures.length, 2);
});
test('a tiny test with a five-million label cannot pass acceptance', () => {
  const r = fixture();
  r.observedPeaks = Object.fromEntries(CAPACITIES.map(k => [k,100]));
  r.traffic.successfulApiOperations = 1200;
  r.traffic.deliveredMediaBytes = 100000;
  r.traffic.distinctAuthenticatedAccounts = 16;
  const result = evaluate(r, now);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.includes('sustained demand')));
  assert.ok(result.failures.some(f => f.includes('distinct authenticated')));
  assert.ok(result.failures.some(f => f.includes('modeled stage demand')));
});
test('short or overlapping peak windows, stale model assumptions and dropped arrivals fail closed', () => {
  for (const change of [
    r => { r.traffic.peakWindows[0].durationSeconds = 899; },
    r => { r.traffic.peakWindows = Array(2).fill({ ...r.traffic.peakWindows[0], durationSeconds: 450 }); },
    r => { r.traffic.peakWindows[0].startedAtSeconds = 86400; },
    r => { r.traffic.peakWindows[0].apiRequestsPerSecond = 100; },
    r => { r.traffic.scenarioSha256 = '0'.repeat(64); },
    r => { r.traffic.droppedArrivals = 1; },
    r => { r.traffic.scheduleLagP95Ms = 1001; },
  ]) { const r = fixture(); change(r); assert.equal(evaluate(r, now).passed, false); }
});
test('model requirements scale with the requested stage, never fixture size', () => {
  const small = demandFor(100000), large = demandFor(5000000);
  assert.equal(large.peakApiRps, small.peakApiRps * 50);
  assert.equal(large.scenarioSha256, small.scenarioSha256);
  assert.ok(large.minimumDistinctAccounts > 500000);
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
