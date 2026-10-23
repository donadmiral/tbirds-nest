#!/usr/bin/env node
/** GET-only latency/soak probe. No writes, no automatic remote target discovery. */
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function validateTarget(value, { allowStaging = false, allowedHost = '' } = {}) {
  const target = new URL(value);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash) throw new Error('An HTTP(S) URL without credentials or fragment is required.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (!local && (!allowStaging || target.protocol !== 'https:' || !allowedHost || target.hostname !== allowedHost)) {
    throw new Error('Remote load is disabled. Opt in with --allow-staging and PERF_ALLOWED_STAGING_HOST matching an authorized staging hostname.');
  }
  return { target, local };
}
function percentile(values, fraction) { if (!values.length) return null; return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)]; }
async function run(options) {
  const { target, local } = validateTarget(options.url, options);
  const count = Number(options.requests ?? 100), concurrency = Number(options.concurrency ?? 4), rate = Number(options.rate ?? 5);
  const duration = Number(options.duration ?? 0), timeout = Number(options.timeout ?? 12000);
  const maxErrorRate = Number(options.maxErrorRate ?? 0), maxP95 = Number(options.maxP95 ?? 1500);
  if (!Number.isInteger(count) || count < 1 || count > 100000 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > (local ? 64 : 8)
    || !Number.isFinite(rate) || rate < 0.1 || rate > (local ? 1000 : 10) || !Number.isFinite(duration) || duration < 0 || duration > 3600
    || !Number.isFinite(timeout) || timeout < 100 || timeout > 60000
    || !Number.isFinite(maxErrorRate) || maxErrorRate < 0 || maxErrorRate > 1 || !Number.isFinite(maxP95) || maxP95 <= 0
    || (!duration && count / rate > 3600)) throw new Error('Invalid or excessive load budget.');
  const start = performance.now(), latencies = [], statuses = {}, errors = {};
  let issued = 0, completed = 0, failed = 0, contentMissing = 0, bytes = 0;
  async function worker() {
    while (issued < count && (!duration || performance.now() - start < duration * 1000)) {
      const number = issued++;
      const due = start + number * (1000 / rate);
      await delay(Math.max(0, due - performance.now()));
      if (duration && performance.now() - start >= duration * 1000) break;
      const began = performance.now();
      try {
        const headers = { Accept: 'text/html,application/json' };
        if (options.cookie) headers.Cookie = options.cookie;
        const response = await fetch(target, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
        statuses[response.status] = (statuses[response.status] ?? 0) + 1;
        const body = await response.text(); bytes += Buffer.byteLength(body);
        if (!response.ok) failed++;
        if (options.expect && !body.includes(options.expect)) { contentMissing++; if (response.ok) failed++; }
      } catch (error) { failed++; errors[error.name] = (errors[error.name] ?? 0) + 1; }
      latencies.push(performance.now() - began); completed++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = performance.now() - start, sorted = [...latencies].sort((a,b) => a-b);
  const report = { version: 1, measuredAt: new Date().toISOString(), target: target.origin + target.pathname, method: 'GET',
    durationMs: Math.round(elapsed), requestedRate: rate, concurrency, completed, failures: failed, contentMissing, statuses, errors,
    achievedRequestsPerSecond: completed / (elapsed / 1000), transferredBytes: bytes,
    latencyMs: { p50: percentile(sorted, .5), p95: percentile(sorted, .95), p99: percentile(sorted, .99), max: sorted.at(-1) ?? null },
    passed: completed > 0 && failed / completed <= maxErrorRate && (percentile(sorted,.95) ?? Infinity) <= maxP95,
    note: 'This measures only this target, request mix and budget. It does not establish production user capacity.' };
  return report;
}
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key,...value] = arg.replace(/^--/,'').split('='); return [key,value.length ? value.join('=') : true]; }));
  if (args.help || !args.url) { console.log('node tools/performance/http-load.cjs --url=http://127.0.0.1:3000/home --requests=100 --rate=5 --concurrency=4 --expect=data-feed-content --output=report.json\nOptional soak: --duration=300 --requests=100000. Remote: --allow-staging plus PERF_ALLOWED_STAGING_HOST. Auth only through PERF_COOKIE environment variable.'); return; }
  const report = await run({ ...args, url: args.url, allowStaging: args['allow-staging'] === true, allowedHost: process.env.PERF_ALLOWED_STAGING_HOST,
    cookie: process.env.PERF_COOKIE, maxP95: args['max-p95'], maxErrorRate: args['max-error-rate'] });
  if (args.output) fs.writeFileSync(args.output, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2)); if (!report.passed) process.exitCode = 1;
}
module.exports = { run, validateTarget, percentile };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode=1; });
