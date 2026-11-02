#!/usr/bin/env node
'use strict';

// Offline planning arithmetic. This program never sends traffic or certifies capacity.
const fs = require('node:fs');
const path = require('node:path');
const SECONDS_PER_DAY = 86400;

function number(input, key, { min = 0, max = Infinity, integer = false } = {}) {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`Invalid ${key}: expected ${integer ? 'integer' : 'number'} from ${min} to ${max}.`);
  }
  return value;
}

function validateScenario(s) {
  if (!s || typeof s !== 'object' || !/^[a-z][a-z0-9-]{0,40}$/.test(s.name ?? '')) throw new Error('A stable scenario name is required.');
  number(s, 'activeMinutesPerDau', { min: 0.01, max: 1440 });
  number(s, 'peakFactor', { min: 1, max: 100 });
  number(s, 'applicationRequestsPerDau', { min: 1 });
  for (const key of ['nativeShareOfActiveTime', 'webIdleCallRecoveryFraction', 'candidateProxyMediaRequestFraction', 'realtimeFraction', 'chatOpenFraction', 'nativeInboxOpenFraction', 'illustrativeMediaByteCacheHitRatio']) number(s, key, { max: 1 });
  for (const key of ['averageVideoMinutesPerDau', 'averageVideoMbps', 'imagesViewedPerDau', 'averageImageBytes', 'mediaHttpRequestsPerDau', 'postsCreatedPerDau', 'likesPerDau', 'viewEventsPerDau', 'messagesSentPerDau', 'uploadsPerDau', 'averageUploadBytes']) number(s, key);
  if (s.averageVideoMinutesPerDau > s.activeMinutesPerDau) throw new Error('Video minutes cannot exceed modeled active minutes.');
  for (const key of ['registeredAccountsPerDau', 'storedUploadMultiplier']) number(s, key, { min: 1 });
  for (const key of ['postRetentionDays', 'messageRetentionDays', 'viewEventRetentionDays', 'uploadRetentionDays']) number(s, key, { min: 1, integer: true });
  return s;
}

function model(dau, scenario) {
  number({ dau }, 'dau', { min: 1, max: 1000000000, integer: true });
  const s = validateScenario(scenario);
  const averageConcurrent = dau * s.activeMinutesPerDau / 1440;
  const peakConcurrent = averageConcurrent * s.peakFactor;
  if (peakConcurrent > dau) throw new Error('Modeled peak concurrent users exceed DAU. Use an explicit multi-session model instead.');
  const dailyRate = events => ({ perDay: events, averagePerSecond: events / SECONDS_PER_DAY, peakPerSecond: events / SECONDS_PER_DAY * s.peakFactor });
  const videoBytes = dau * s.averageVideoMinutesPerDau * 60 * s.averageVideoMbps * 1000000 / 8;
  const imageBytes = dau * s.imagesViewedPerDau * s.averageImageBytes;
  const mediaBytes = videoBytes + imageBytes;
  const activeSeconds = dau * s.activeMinutesPerDau * 60;
  // Source-derived intervals, conditional on mounted clients using the reviewed code.
  // Native runtimes can remain mounted longer than active minutes, so this omits that extra traffic.
  const polling = {
    nativeHealthRequests: dailyRate(activeSeconds * s.nativeShareOfActiveTime / 5),
    webCallRecoverySqlReads: dailyRate(activeSeconds * (1 - s.nativeShareOfActiveTime) * s.webIdleCallRecoveryFraction * 2 / 30),
    chatTypingReads: dailyRate(activeSeconds * s.chatOpenFraction / 3),
    nativeInboxTypingReads: dailyRate(activeSeconds * s.nativeShareOfActiveTime * s.nativeInboxOpenFraction / 3.5),
  };
  const unnecessaryPolls = Object.values(polling).reduce((sum, row) => sum + row.perDay, 0);
  const posts = dau * s.postsCreatedPerDau;
  const messages = dau * s.messagesSentPerDau;
  const views = dau * s.viewEventsPerDau;
  const uploads = dau * s.uploadsPerDau;
  const result = {
    scenario: s.name,
    dau,
    registeredAccountsAssumption: dau * s.registeredAccountsPerDau,
    concurrency: {
      averageActive: averageConcurrent,
      peakActive: peakConcurrent,
      peakRealtimeConnections: peakConcurrent * s.realtimeFraction,
    },
    applicationRequests: dailyRate(dau * s.applicationRequestsPerDau),
    mediaHttpRequests: dailyRate(dau * s.mediaHttpRequestsPerDau),
    media: {
      videoBytesPerDay: videoBytes,
      imageBytesPerDay: imageBytes,
      totalBytesPerDay: mediaBytes,
      totalDecimalPetabytesPerDay: mediaBytes / 1e15,
      totalDecimalPetabytesPer30Days: mediaBytes * 30 / 1e15,
      averageDeliveredGigabitsPerSecond: mediaBytes * 8 / SECONDS_PER_DAY / 1e9,
      peakDeliveredGigabitsPerSecond: mediaBytes * 8 / SECONDS_PER_DAY / 1e9 * s.peakFactor,
      illustrativeByteCacheHitRatio: s.illustrativeMediaByteCacheHitRatio,
      illustrativeOriginBytesPerDay: mediaBytes * (1 - s.illustrativeMediaByteCacheHitRatio),
      candidateProxyAuthorizationChecks: dailyRate(dau * s.mediaHttpRequestsPerDau * s.candidateProxyMediaRequestFraction * 2),
    },
    sourcePolling: { ...polling, totalNetworkOperations: dailyRate(unnecessaryPolls) },
    events: {
      postsCreated: dailyRate(posts),
      likes: dailyRate(dau * s.likesPerDau),
      viewEvents: dailyRate(views),
      messagesSent: dailyRate(messages),
      uploads: dailyRate(uploads),
    },
    sustainedRetentionIllustration: {
      posts: posts * s.postRetentionDays,
      messages: messages * s.messageRetentionDays,
      rawViewEvents: views * s.viewEventRetentionDays,
      originalUploadBytesPerDay: uploads * s.averageUploadBytes,
      totalUploadBytesPerDay: uploads * s.averageUploadBytes * s.storedUploadMultiplier,
      retainedUploadBytes: uploads * s.averageUploadBytes * s.storedUploadMultiplier * s.uploadRetentionDays,
    },
  };
  function requireFinite(value) {
    for (const item of Object.values(value)) {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Assumptions produce a non-finite derived workload.');
      if (item && typeof item === 'object') requireFinite(item);
    }
  }
  requireFinite(result);
  return result;
}

function calculate(config) {
  if (config?.version !== 1 || !Array.isArray(config.dauTargets) || !config.dauTargets.length || !Array.isArray(config.scenarios) || !config.scenarios.length) throw new Error('Expected version 1, dauTargets and scenarios.');
  if (new Set(config.dauTargets).size !== config.dauTargets.length || new Set(config.scenarios.map(s => s.name)).size !== config.scenarios.length) throw new Error('Duplicate DAU target or scenario.');
  const results = config.dauTargets.flatMap(dau => config.scenarios.map(s => model(dau, s)));
  return {
    version: 1,
    kind: 'assumption-based-workload-model-not-a-load-test',
    evidence: 'No network, traffic, server timing or supported-capacity measurement is performed by this calculator.',
    units: 'Decimal bytes, GB=1e9 and PB=1e15. Peak factors are planning assumptions, not measured percentiles.',
    caveats: [
      'DAU is shared across phone and web, not a separate allowance for each platform. Admin workload is additional.',
      'Application requests exclude media transfer and the separately listed background polls. Do not sum them with observed totals without deduplication.',
      'Polling is conditional on reviewed client code and modeled screen shares. The total combines health HTTP requests and PostgREST reads, not database QPS.',
      'nativeShareOfActiveTime partitions active session-time, not distinct people. Web call recovery uses the explicit idle fraction and assumes scans finish within the interval. Overlap guards, busy calls and slow requests can reduce it.',
      'One active user is modeled as one active session. Extra devices, open tabs, retries, reconnect storms and inactive mounted runtimes add demand.',
      'Media cache ratio is an illustrative byte hit ratio, not a measured request hit ratio. It does not remove authorization or ticket work automatically.',
      'Candidate media proxy checks use an explicit eligible request fraction and apply only when that delivery path is configured and deployed.',
      'Retained counts assume sustained DAU for the stated retention period. View events are not a prediction of unique post_seen rows.',
      'Upload multiplier is hypothetical. CDN bytes are still delivered to users even when origin cache hits improve.',
      'A larger DAU scenario is a load target, not a capacity guarantee, architecture approval, or estimate of the cloud bill.',
    ],
    assumptions: config,
    results,
  };
}

function csv(report) {
  const columns = ['scenario', 'dau', 'average_active', 'peak_active', 'peak_realtime_connections', 'application_requests_per_day', 'peak_application_rps', 'media_PB_per_day', 'media_PB_per_30_days', 'peak_delivery_Gbps', 'modeled_extra_poll_operations_per_day', 'peak_modeled_extra_poll_operations_per_second'];
  const rows = report.results.map(r => [r.scenario, r.dau, r.concurrency.averageActive, r.concurrency.peakActive, r.concurrency.peakRealtimeConnections, r.applicationRequests.perDay, r.applicationRequests.peakPerSecond, r.media.totalDecimalPetabytesPerDay, r.media.totalDecimalPetabytesPer30Days, r.media.peakDeliveredGigabitsPerSecond, r.sourcePolling.totalNetworkOperations.perDay, r.sourcePolling.totalNetworkOperations.peakPerSecond]);
  return [columns, ...rows].map(row => row.join(',')).join('\n') + '\n';
}

function main(argv) {
  const opts = {};
  for (const arg of argv) {
    const match = /^--(input|output|csv)=(.+)$/.exec(arg);
    if (!match || opts[match[1]]) throw new Error('Usage: capacity-model.cjs --input=scenarios.json [--output=results.json] [--csv=results.csv]');
    opts[match[1]] = match[2];
  }
  if (!opts.input) throw new Error('--input is required. This tool reads local JSON only.');
  const paths = [opts.input, opts.output, opts.csv].filter(Boolean).map(p => path.resolve(p));
  if (new Set(paths).size !== paths.length) throw new Error('Input, JSON output and CSV output paths must differ.');
  const report = calculate(JSON.parse(fs.readFileSync(opts.input, 'utf8')));
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opts.output) fs.writeFileSync(opts.output, json);
  else process.stdout.write(json);
  if (opts.csv) fs.writeFileSync(opts.csv, csv(report));
}

module.exports = { model, calculate, csv, validateScenario };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
