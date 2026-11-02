const { test } = require('node:test');
const assert = require('node:assert/strict');
const { model, calculate, csv } = require('../tools/performance/capacity-model.cjs');
const config = require('../tools/performance/capacity-scenarios.json');
const base = config.scenarios.find(s => s.name === 'base');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12, `${actual} != ${expected}`);

test('5M base workload uses active minutes rather than treating DAU as concurrent users', () => {
  const r = model(5000000, base);
  close(r.concurrency.averageActive, 104166.66666666667);
  close(r.concurrency.peakActive, 520833.3333333333);
  close(r.concurrency.peakRealtimeConnections, 442708.3333333333);
  assert.equal(r.applicationRequests.perDay, 1000000000);
  close(r.applicationRequests.peakPerSecond, 57870.37037037037);
});

test('media units convert megabits to bytes and preserve CDN delivery despite origin hits', () => {
  const r = model(5000000, base);
  assert.equal(r.media.videoBytesPerDay, 1125000000000000);
  assert.equal(r.media.imageBytesPerDay, 12000000000000);
  close(r.media.totalDecimalPetabytesPerDay, 1.137);
  close(r.media.totalDecimalPetabytesPer30Days, 34.11);
  close(r.media.illustrativeOriginBytesPerDay, 56850000000000);
  const noCache = model(5000000, { ...base, illustrativeMediaByteCacheHitRatio: 0 });
  const allCache = model(5000000, { ...base, illustrativeMediaByteCacheHitRatio: 1 });
  assert.equal(noCache.media.totalBytesPerDay, allCache.media.totalBytesPerDay);
  assert.equal(allCache.media.illustrativeOriginBytesPerDay, 0);
  assert.equal(noCache.media.illustrativeOriginBytesPerDay, noCache.media.totalBytesPerDay);
  assert.equal(noCache.media.candidateProxyAuthorizationChecks.perDay, allCache.media.candidateProxyAuthorizationChecks.perDay);
});

test('source-derived background polling is separate and honors platform and screen shares', () => {
  const r = model(5000000, base);
  assert.equal(r.sourcePolling.nativeHealthRequests.perDay, 1440000000);
  close(r.sourcePolling.webCallRecoverySqlReads.perDay, 108000000);
  assert.equal(r.sourcePolling.chatTypingReads.perDay, 300000000);
  close(r.sourcePolling.nativeInboxTypingReads.perDay, 205714285.7142857);
  const web = model(5000000, { ...base, nativeShareOfActiveTime: 0, chatOpenFraction: 0, webIdleCallRecoveryFraction: 0 });
  assert.equal(web.sourcePolling.nativeHealthRequests.perDay, 0);
  assert.equal(web.sourcePolling.nativeInboxTypingReads.perDay, 0);
  assert.equal(web.sourcePolling.chatTypingReads.perDay, 0);
  assert.equal(web.sourcePolling.webCallRecoverySqlReads.perDay, 0);
  const noProxy = model(5000000, { ...base, candidateProxyMediaRequestFraction: 0 });
  assert.equal(noProxy.media.candidateProxyAuthorizationChecks.perDay, 0);
});

test('growth targets scale demand, never turn a model into measured capacity', () => {
  const r = calculate(config);
  assert.equal(r.results.length, 9);
  assert.match(r.kind, /not-a-load-test/);
  const five = r.results.find(x => x.dau === 5000000 && x.scenario === 'base');
  const twenty = r.results.find(x => x.dau === 20000000 && x.scenario === 'base');
  close(twenty.applicationRequests.peakPerSecond, five.applicationRequests.peakPerSecond * 4);
  close(twenty.media.totalBytesPerDay, five.media.totalBytesPerDay * 4);
  assert.equal(csv(r).trim().split('\n').length, 10);
});

test('invalid assumptions cannot silently produce plausible capacity numbers', () => {
  for (const dau of [0, -1, 1.5, NaN, Infinity, '5000000']) assert.throws(() => model(dau, base));
  for (const change of [{ peakFactor: 0 }, { nativeShareOfActiveTime: 1.1 }, { averageVideoMbps: -1 }, { activeMinutesPerDau: 1440, peakFactor: 2 }, { averageVideoMinutesPerDau: 40 }, { postRetentionDays: 0 }, { applicationRequestsPerDau: '200' }, { name: 'csv,formula' }, { averageVideoMbps: 1e308 }]) assert.throws(() => model(5000000, { ...base, ...change }));
  assert.throws(() => calculate({ ...config, dauTargets: [5000000, 5000000] }));
});
