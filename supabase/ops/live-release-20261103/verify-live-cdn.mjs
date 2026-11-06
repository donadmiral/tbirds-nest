#!/usr/bin/env node
// Authenticated operator acceptance. Fetches only the supplied isolated fixture;
// never uploads, creates a stream, calls Daily, or prints credentials/capabilities.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadConfiguration } from './verify-live-secrets.mjs';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const FILE = /^[a-z0-9][a-z0-9_-]{0,100}\.(?:m3u8|ts|m4s|mp4|vtt)$/;
const HASH = /^[a-f0-9]{64}$/;
const TIMEOUT = 8_000, MAX_METADATA = 65_536, MAX_ASSET = 2_097_152;
const FAILURE_CODES = new Set(['TIMEOUT', 'REQUEST_FAILED', 'UNEXPECTED_REDIRECT', 'RESPONSE_TOO_LARGE',
  'UNEXPECTED_HTTP_STATUS', 'INVALID_SIGNER_RESPONSE', 'SIGNER_CACHE_POLICY', 'ASSET_HASH_MISMATCH',
  'INVALID_PLAYLIST', 'FIXTURE_NOT_REACHABLE', 'HEAD_METADATA_MISMATCH', 'RANGE_MISMATCH',
  'CORS_MISMATCH', 'CACHE_POLICY_MISMATCH', 'CACHE_NOT_SHARED', 'CACHE_POP_CHANGED']);
class InputFailure extends Error {}
class ProbeFailure extends Error {}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ensure = (condition, code) => { if (!condition) throw new ProbeFailure(code); };
const fault = () => { throw new InputFailure('INVALID_FIXTURE'); };

export const HELP = [
  'Usage: node supabase/ops/live-release-20261103/verify-live-cdn.mjs --project-ref <ref> --env-file /protected/live.env --fixture-file /scratch/fixture.json',
  'Requires Node.js 22.6+. Reuses verify-live-secrets loadConfiguration and its five LIVE_* variables.',
  'Upload exactly the generated fixture files with their content_type and cache_control first.',
  'The script performs 15 bounded probes (20 HTTP requests on a passing fixture), with no provider/database writes.',
  'Only redacted probe names, statuses, timings, counts and fixed error codes are written.',
  'No signed URI, signature, response body, key, bearer, hostname or local file path is printed.',
  'Exit: 0 acceptance passed; 1 acceptance failed; 2 invalid inputs/configuration.',
].join('\n') + '\n';

export function validateFixture(value) {
  if (!record(value) || value.schema_version !== 1 || value.purpose !== 'isolated_cdn_acceptance'
    || !UUID.test(value.session_id || '') || !UUID.test(value.instance_id || '')
    || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value.bucket || '')
    || !/^[a-z]{2}-[a-z]+-\d$/.test(value.region || '')) fault();
  const prefix = 'live/' + value.session_id + '/' + value.instance_id + '/';
  if (value.prefix !== prefix || value.entrypoint !== prefix + 'master.m3u8'
    || !Array.isArray(value.files) || value.files.length < 3 || value.files.length > 8) fault();
  const seen = new Set(), files = [];
  for (const file of value.files) {
    if (!record(file) || !FILE.test(file.relative_path || '') || seen.has(file.relative_path)
      || file.storage_path !== prefix + file.relative_path || !Number.isSafeInteger(file.size)
      || file.size < 32 || file.size > MAX_ASSET || !HASH.test(file.sha256 || '')
      || !HASH.test(file.range_0_31_sha256 || '')) fault();
    seen.add(file.relative_path);
    files.push({ relative_path: file.relative_path, storage_path: file.storage_path, size: file.size,
      sha256: file.sha256, range_0_31_sha256: file.range_0_31_sha256 });
  }
  if (!seen.has('master.m3u8') || !files.some(file => !file.relative_path.endsWith('.m3u8'))) fault();
  return { schema_version: 1, purpose: value.purpose, session_id: value.session_id, instance_id: value.instance_id,
    bucket: value.bucket, region: value.region, prefix, entrypoint: value.entrypoint, files };
}

export async function loadFixture(filename) {
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_METADATA) fault();
    const bytes = Buffer.alloc(MAX_METADATA + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, count);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (count > MAX_METADATA) fault();
    return validateFixture(JSON.parse(bytes.subarray(0, count).toString('utf8')));
  } catch (error) {
    if (error instanceof InputFailure) throw error;
    throw new InputFailure('FIXTURE_FILE_UNREADABLE');
  } finally { await handle?.close().catch(() => {}); }
}

async function boundedBytes(response, maximum, signal) {
  if (Number(response.headers.get('content-length') || 0) > maximum) {
    void response.body?.cancel().catch(() => {});
    throw new ProbeFailure('RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      ensure(!signal.aborted, 'TIMEOUT');
      const { done, value } = await reader.read();
      ensure(!signal.aborted, 'TIMEOUT');
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => {});
        throw new ProbeFailure('RESPONSE_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

function capability(config, fixture, expires, options = {}) {
  const keyId = options.keyId || config.LIVE_CDN_KEY_ID;
  const session = options.session || fixture.session_id, instance = options.instance || fixture.instance_id;
  const prefix = keyId + '.' + expires + '.' + session + '.' + instance;
  let signature = createHmac('sha256', config.LIVE_CDN_SIGNING_KEY).update('pc-live-v1.' + prefix).digest('hex');
  if (options.badSignature) signature = (signature[0] === '0' ? '1' : '0') + signature.slice(1);
  return config.LIVE_HLS_CDN_ORIGIN + '/_live/' + prefix + '.' + signature + '/';
}

function playlistReferences(bytes, byName) {
  const text = bytes.toString('utf8');
  ensure(text.startsWith('#EXTM3U\n') || text.startsWith('#EXTM3U\r\n'), 'INVALID_PLAYLIST');
  // This small synthetic fixture uses plain relative MPEG-TS references only.
  // Reject external URI attributes rather than silently skipping encrypted/map data.
  ensure(!/\bURI\s*=/i.test(text), 'INVALID_PLAYLIST');
  const refs = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  ensure(refs.length > 0 && refs.length <= 8 && refs.every(name => FILE.test(name) && byName.has(name)), 'INVALID_PLAYLIST');
  return refs;
}

export async function runCdnAcceptance(configuration, fixtureValue, {
  fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = TIMEOUT,
} = {}) {
  // Revalidate caller-provided configuration without reading the process environment.
  const { projectRef, config } = await loadConfiguration({ projectRef: configuration.projectRef }, configuration.config);
  const fixture = validateFixture(fixtureValue);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT) throw new InputFailure('INVALID_TIMEOUT');
  const probes = [], byName = new Map(fixture.files.map(file => [file.relative_path, file]));
  const checkedAt = new Date(now()).toISOString();
  const receipt = () => ({ schema_version: 1, project_ref: projectRef, checked_at: checkedAt,
    fixture_session_id: fixture.session_id, fixture_instance_id: fixture.instance_id, fixture_file_count: fixture.files.length,
    acceptance_scope: 'isolated_synthetic_cdn_delivery', provider_broadcast_verified: false, measured_capacity_verified: false,
    ok: probes.every(probe => probe.ok), passed: probes.filter(probe => probe.ok).length, total: probes.length, probes });
  const run = async (name, action) => {
    const controller = new AbortController(), started = performance.now();
    let status = null, timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new ProbeFailure('TIMEOUT')); }, timeoutMs);
    });
    const request = async (url, options = {}, maximum = MAX_ASSET) => {
      ensure(!controller.signal.aborted, 'TIMEOUT');
      const method = options.method || 'GET';
      // CloudFront applies its CORS policy when the browser supplies Origin.
      // Model the cross-origin HLS request, keeping this header off signer/S3.
      const browserHeaders = new URL(url).origin === config.LIVE_HLS_CDN_ORIGIN
        ? { Origin: 'https://platinumcircles.app' } : {};
      const response = await fetchImpl(url, { ...options, method, redirect: 'error', credentials: 'omit',
        signal: controller.signal, headers: { 'Accept-Encoding': 'identity', ...browserHeaders, ...options.headers } });
      status = response.status;
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new ProbeFailure('TIMEOUT');
      }
      if (response.redirected || (status >= 300 && status < 400)) throw new ProbeFailure('UNEXPECTED_REDIRECT');
      const bytes = method === 'HEAD' ? Buffer.alloc(0) : await boundedBytes(response, maximum, controller.signal);
      return { response, bytes };
    };
    try {
      const value = await Promise.race([deadline, action(request)]);
      probes.push({ name, ok: true, status, elapsed_ms: Math.round(performance.now() - started) });
      return { ok: true, value };
    } catch (error) {
      controller.abort();
      probes.push({ name, ok: false, status, elapsed_ms: Math.round(performance.now() - started),
        error: error instanceof ProbeFailure && FAILURE_CODES.has(error.message) ? error.message : 'REQUEST_FAILED' });
      return { ok: false };
    } finally { clearTimeout(timer); }
  };
  const asset = (result, file) => {
    ensure(result.response.status === 200, 'UNEXPECTED_HTTP_STATUS');
    ensure(result.bytes.length === file.size && hash(result.bytes) === file.sha256, 'ASSET_HASH_MISMATCH');
    const cache = result.response.headers.get('cache-control') || '';
    ensure(/\bprivate\b/i.test(cache) && /\bmax-age\s*=\s*1(?:\s|,|$)/i.test(cache), 'CACHE_POLICY_MISMATCH');
    ensure(result.response.headers.get('access-control-allow-origin') === '*', 'CORS_MISMATCH');
  };
  const seconds = () => Math.floor(now() / 1000);
  const signed = await run('signer_capability', async request => {
    const expires = seconds() + 90, expected = capability(config, fixture, expires) + fixture.entrypoint;
    const { response, bytes } = await request('https://' + projectRef + '.supabase.co/functions/v1/live-sign', {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.LIVE_PLAYBACK_SIGNER_SECRET },
      body: JSON.stringify({ sessionId: fixture.session_id, userId: randomUUID(), path: fixture.entrypoint,
        expiresAt: new Date(expires * 1000).toISOString() }),
    }, 16_384);
    ensure(response.status === 200, 'UNEXPECTED_HTTP_STATUS');
    ensure(/\bno-store\b/i.test(response.headers.get('cache-control') || '')
      && /\bno-store\b/i.test(response.headers.get('cdn-cache-control') || ''), 'SIGNER_CACHE_POLICY');
    let data;
    try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new ProbeFailure('INVALID_SIGNER_RESPONSE'); }
    ensure(record(data) && data.url === expected && data.expiresAt === new Date(expires * 1000).toISOString(), 'INVALID_SIGNER_RESPONSE');
    return data.url;
  });
  if (!signed.ok) return receipt();

  const manifest = await run('hls_manifest_and_segments', async request => {
    const queue = [{ name: 'master.m3u8', url: signed.value }], visited = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current.name)) continue;
      ensure(visited.size < 8, 'INVALID_PLAYLIST');
      visited.add(current.name);
      const file = byName.get(current.name), result = await request(current.url, {}, file.size);
      asset(result, file);
      if (current.name.endsWith('.m3u8')) {
        for (const name of playlistReferences(result.bytes, byName)) {
          // Relative resolution preserves the path capability in front of live/.
          queue.push({ name, url: new URL(name, current.url).href });
        }
      }
    }
    ensure(visited.size === fixture.files.length, 'FIXTURE_NOT_REACHABLE');
  });
  if (!manifest.ok) return receipt();
  const segment = fixture.files.find(file => !file.relative_path.endsWith('.m3u8'));
  const segmentUrl = () => capability(config, fixture, seconds() + 90) + segment.storage_path;
  await run('segment_head', async request => {
    const { response } = await request(segmentUrl(), { method: 'HEAD' });
    ensure(response.status === 200, 'UNEXPECTED_HTTP_STATUS');
    ensure(Number(response.headers.get('content-length')) === segment.size
      && response.headers.get('accept-ranges') === 'bytes', 'HEAD_METADATA_MISMATCH');
  });
  await run('segment_range', async request => {
    const { response, bytes } = await request(segmentUrl(), { headers: { Range: 'bytes=0-31' } }, 32);
    ensure(response.status === 206 && response.headers.get('content-range') === 'bytes 0-31/' + segment.size
      && bytes.length === 32 && hash(bytes) === segment.range_0_31_sha256, 'RANGE_MISMATCH');
  });
  await run('authenticated_options', async request => {
    const { response } = await request(segmentUrl(), { method: 'OPTIONS', headers: {
      Origin: 'https://platinumcircles.app', 'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'range',
    } }, 16_384);
    const allowed = (response.headers.get('access-control-allow-methods') || '').toUpperCase().split(/\s*,\s*/);
    const allowedHeaders = (response.headers.get('access-control-allow-headers') || '').toLowerCase().split(/\s*,\s*/);
    ensure(response.status === 204 && response.headers.get('access-control-allow-origin') === '*'
      && allowed.includes('GET') && allowed.includes('HEAD') && !allowed.includes('POST')
      && allowedHeaders.includes('range') && !allowedHeaders.includes('authorization'), 'CORS_MISMATCH');
  });
  await run('shared_cache_across_capabilities', async request => {
    const current = seconds();
    const first = await request(capability(config, fixture, current + 80) + segment.storage_path, {}, segment.size);
    const second = await request(capability(config, fixture, current + 85) + segment.storage_path, {}, segment.size);
    asset(first, segment); asset(second, segment);
    const firstPop = first.response.headers.get('x-amz-cf-pop'), secondPop = second.response.headers.get('x-amz-cf-pop');
    ensure(firstPop && firstPop === secondPop, 'CACHE_POP_CHANGED');
    ensure(/^(?:Hit|RefreshHit) from cloudfront$/i.test(second.response.headers.get('x-cache') || ''), 'CACHE_NOT_SHARED');
  });
  const deny = (name, buildUrl, options = {}) => run(name, async request => {
    const { response } = await request(buildUrl(), options, 16_384);
    ensure(response.status === 403, 'UNEXPECTED_HTTP_STATUS');
  });
  await deny('unsigned_denied', () => config.LIVE_HLS_CDN_ORIGIN + '/' + fixture.entrypoint);
  await deny('bad_signature_denied', () => capability(config, fixture, seconds() + 90, { badSignature: true }) + fixture.entrypoint);
  await deny('expired_denied', () => capability(config, fixture, seconds() - 60) + fixture.entrypoint);
  await deny('overlong_denied', () => capability(config, fixture, seconds() + 600) + fixture.entrypoint);
  await deny('wrong_session_denied', () => capability(config, fixture, seconds() + 90, { session: randomUUID() }) + fixture.entrypoint);
  await deny('wrong_key_id_denied', () => capability(config, fixture, seconds() + 90, {
    keyId: config.LIVE_CDN_KEY_ID === 'acceptancebad' ? 'denycheck1' : 'acceptancebad',
  }) + fixture.entrypoint);
  await deny('wrong_instance_scope_denied', () => capability(config, fixture, seconds() + 90, { instance: randomUUID() }) + fixture.entrypoint);
  await deny('write_method_denied', () => capability(config, fixture, seconds() + 90) + fixture.entrypoint, { method: 'POST' });
  await deny('unauthenticated_s3_denied', () => 'https://' + fixture.bucket + '.s3.' + fixture.region + '.amazonaws.com/' + fixture.entrypoint);
  return receipt();
}

function argumentsFor(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!['--project-ref', '--env-file', '--fixture-file'].includes(flag) || flag in values
      || !value || value.startsWith('--')) throw new InputFailure('INVALID_ARGUMENTS');
    values[flag] = value;
  }
  if (!values['--project-ref'] || !values['--env-file'] || !values['--fixture-file']) throw new InputFailure('INVALID_ARGUMENTS');
  return { projectRef: values['--project-ref'], envFile: values['--env-file'], fixtureFile: values['--fixture-file'] };
}

export async function main(argv = process.argv.slice(2), {
  fetchImpl = globalThis.fetch, environment = process.env, write = text => process.stdout.write(text),
} = {}) {
  if (argv.length === 1 && argv[0] === '--help') { write(HELP); return 0; }
  try {
    const args = argumentsFor(argv), fixture = await loadFixture(args.fixtureFile);
    const configuration = await loadConfiguration(args, environment);
    const result = await runCdnAcceptance(configuration, fixture, { fetchImpl });
    write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
  } catch (error) {
    const code = error instanceof InputFailure ? error.message : 'INPUT_OR_CONFIGURATION_INVALID';
    write(JSON.stringify({ schema_version: 1, ok: false, error: code }) + '\n');
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
