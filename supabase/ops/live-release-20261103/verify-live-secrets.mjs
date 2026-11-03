#!/usr/bin/env node
// Operator acceptance only. No provider writes, database events, stream creation,
// or signed-URL fetches. Keep supplied secrets outside the repository.
import { createHmac, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

const ENV_NAMES = Object.freeze([
  'LIVE_DAILY_WEBHOOK_SECRET', 'LIVE_PLAYBACK_SIGNER_SECRET',
  'LIVE_CDN_SIGNING_KEY', 'LIVE_CDN_KEY_ID', 'LIVE_HLS_CDN_ORIGIN',
]);
const FILE_LIMIT = 32_768, RESPONSE_LIMIT = 16_384, REQUEST_TIMEOUT_MS = 8_000;
const FAILURE_CODES = new Set([
  'REQUEST_FAILED', 'TIMEOUT', 'RESPONSE_TOO_LARGE', 'UNEXPECTED_REDIRECT',
  'UNEXPECTED_HTTP_STATUS', 'CACHE_POLICY_MISSING', 'INVALID_JSON', 'UNEXPECTED_RESPONSE',
]);
class InputFailure extends Error {}
class ProbeFailure extends Error {}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const HELP = `Usage: node supabase/ops/live-release-20261103/verify-live-secrets.mjs --project-ref <20-character-ref> [--env-file /protected/operator/live.env]

Requires Node.js 22.6+ and these five variables:
  LIVE_DAILY_WEBHOOK_SECRET   Daily base64 HMAC secret (at least 32 decoded bytes)
  LIVE_PLAYBACK_SIGNER_SECRET Signer bearer secret (32–505 printable ASCII characters)
  LIVE_CDN_SIGNING_KEY        Exact CDN HMAC key text (at least 32 characters)
  LIVE_CDN_KEY_ID             CDN key ID, lowercase letters/digits/_/-, at most 16
  LIVE_HLS_CDN_ORIGIN         Exact HTTPS origin configured on the deployed signer

Use an existing protected environment or a regular, owner-only file (mode 0600).
The file is parsed as dotenv, never executed; with --env-file it is the sole source.
Never place secret values in command arguments, shell history, or a checked-in file.
Run only after the keys have been installed in the selected Supabase project.
The receipt contains only fixed probe names, status codes, timings, and safe errors.
Exit codes: 0 all probes passed; 1 acceptance failed; 2 input/configuration failure.
This does not fetch a signed URL or verify AWS delivery or Daily registration.
`;

function argumentsFor(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!['--project-ref', '--env-file'].includes(flag) || flag in values
      || typeof argv[i + 1] !== 'string' || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new InputFailure('INVALID_ARGUMENTS');
    }
    values[flag] = argv[i + 1];
  }
  if (!/^[a-z0-9]{20}$/.test(values['--project-ref'] || '')) throw new InputFailure('INVALID_PROJECT_REF');
  return { projectRef: values['--project-ref'], envFile: values['--env-file'] };
}

async function protectedEnvironment(filename) {
  let handle;
  const bytes = Buffer.alloc(FILE_LIMIT + 1);
  try {
    // O_NONBLOCK avoids hanging on a FIFO before fstat can reject it.
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new InputFailure('UNSAFE_SECRET_FILE');
    }
    if (stat.size > FILE_LIMIT) throw new InputFailure('SECRET_FILE_TOO_LARGE');
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > FILE_LIMIT) throw new InputFailure('SECRET_FILE_TOO_LARGE');
    return parseEnv(bytes.subarray(0, length).toString('utf8'));
  } catch (error) {
    if (error instanceof InputFailure) throw error;
    // Filesystem and parser errors may embed the filename or file contents.
    throw new InputFailure('SECRET_FILE_UNREADABLE');
  } finally {
    bytes.fill(0);
    await handle?.close().catch(() => {});
  }
}

export async function loadConfiguration({ projectRef, envFile }, environment = process.env) {
  if (!/^[a-z0-9]{20}$/.test(projectRef || '')) throw new InputFailure('INVALID_PROJECT_REF');
  const source = envFile ? await protectedEnvironment(envFile) : environment;
  const config = Object.fromEntries(ENV_NAMES.map(name => [name, source[name]]));
  for (const name of ENV_NAMES) {
    if (typeof config[name] !== 'string' || !config[name]) throw new InputFailure(`MISSING_${name}`);
  }
  const hook = config.LIVE_DAILY_WEBHOOK_SECRET;
  if (hook.length > 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(hook)
    || Buffer.from(hook, 'base64').length < 32
    || Buffer.from(hook, 'base64').toString('base64') !== hook) {
    throw new InputFailure('INVALID_LIVE_DAILY_WEBHOOK_SECRET');
  }
  if (!/^[\x21-\x7e]{32,505}$/.test(config.LIVE_PLAYBACK_SIGNER_SECRET)) {
    throw new InputFailure('INVALID_LIVE_PLAYBACK_SIGNER_SECRET');
  }
  if (!/^[\x21-\x7e]{32,1024}$/.test(config.LIVE_CDN_SIGNING_KEY)) {
    throw new InputFailure('INVALID_LIVE_CDN_SIGNING_KEY');
  }
  if (!/^[a-z0-9_-]{1,16}$/.test(config.LIVE_CDN_KEY_ID)) throw new InputFailure('INVALID_LIVE_CDN_KEY_ID');
  try {
    const origin = new URL(config.LIVE_HLS_CDN_ORIGIN);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/'
      || origin.port || origin.search || origin.hash) throw new Error();
    config.LIVE_HLS_CDN_ORIGIN = origin.origin;
  } catch { throw new InputFailure('INVALID_LIVE_HLS_CDN_ORIGIN'); }
  return { projectRef, config };
}

async function boundedJson(response) {
  if (Number(response.headers.get('content-length') || 0) > RESPONSE_LIMIT) {
    void response.body?.cancel().catch(() => {});
    throw new ProbeFailure('RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProbeFailure('INVALID_JSON');
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT) {
        void reader.cancel().catch(() => {});
        throw new ProbeFailure('RESPONSE_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, length).toString('utf8')); }
  catch { throw new ProbeFailure('INVALID_JSON'); }
}

async function probe(base, spec, { fetchImpl, timeoutMs }) {
  const controller = new AbortController(), started = performance.now();
  let timer, status = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ProbeFailure('TIMEOUT')); }, timeoutMs);
  });
  try {
    await Promise.race([deadline, (async () => {
      const response = await fetchImpl(`${base}/${spec.endpoint}`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...spec.headers }, body: JSON.stringify(spec.body),
      });
      status = response.status;
      if (response.redirected || (status >= 300 && status < 400)) throw new ProbeFailure('UNEXPECTED_REDIRECT');
      if (status !== spec.status) throw new ProbeFailure('UNEXPECTED_HTTP_STATUS');
      if (!/\bno-store\b/i.test(response.headers.get('cache-control') || '')
        || !/\bno-store\b/i.test(response.headers.get('cdn-cache-control') || '')) {
        throw new ProbeFailure('CACHE_POLICY_MISSING');
      }
      const data = await boundedJson(response);
      if (!record(data) || !spec.accept(data)) throw new ProbeFailure('UNEXPECTED_RESPONSE');
    })()]);
    return { name: spec.name, ok: true, status, elapsed_ms: Math.round(performance.now() - started) };
  } catch (error) {
    controller.abort();
    return { name: spec.name, ok: false, status, elapsed_ms: Math.round(performance.now() - started),
      error: error instanceof ProbeFailure && FAILURE_CODES.has(error.message) ? error.message : 'REQUEST_FAILED' };
  } finally { clearTimeout(timer); }
}

export async function runAcceptance({ projectRef, config }, {
  fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (!/^[a-z0-9]{20}$/.test(projectRef || '')) throw new InputFailure('INVALID_PROJECT_REF');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REQUEST_TIMEOUT_MS) throw new InputFailure('INVALID_TIMEOUT');
  const base = `https://${projectRef}.supabase.co/functions/v1`, probes = [];
  const run = async spec => { probes.push(await probe(base, spec, { fetchImpl, timeoutMs })); };
  const checkedAt = new Date(now()).toISOString(), testEvent = { test: 'test' };
  for (const kind of ['valid', 'invalid_signature', 'expired_timestamp']) {
    const timestamp = String(Math.floor(now() / 1000) - (kind === 'expired_timestamp' ? 600 : 0));
    const signature = createHmac('sha256', Buffer.from(config.LIVE_DAILY_WEBHOOK_SECRET, 'base64'))
      .update(`${timestamp}.${JSON.stringify(testEvent)}`).digest();
    if (kind === 'invalid_signature') signature[0] ^= 0xff;
    await run({ name: `webhook_${kind}`, endpoint: 'live-provider-webhook', body: testEvent,
      headers: { 'X-Webhook-Timestamp': timestamp, 'X-Webhook-Signature': signature.toString('base64') },
      status: kind === 'valid' ? 200 : 401,
      accept: data => kind === 'valid' ? data.ok === true : data.error === 'INVALID_SIGNATURE' });
    signature.fill(0);
  }

  // Synthetic IDs refer to no application session or user. The signer is pure;
  // these short-lived, nonexistent paths are never fetched or printed.
  const session = randomUUID(), instance = randomUUID(), user = randomUUID();
  const path = `live/${session}/${instance}/master.m3u8`;
  const authorization = { Authorization: `Bearer ${config.LIVE_PLAYBACK_SIGNER_SECRET}` };
  const canonical = () => ({ sessionId: session, userId: user, path, expiresAt: new Date(now() + 90_000).toISOString() });
  const body = canonical(), expires = Math.floor(Date.parse(body.expiresAt) / 1000);
  const prefix = `${config.LIVE_CDN_KEY_ID}.${expires}.${session}.${instance}`;
  // The CDN contract uses the exact key text as UTF-8, not base64-decoded bytes.
  const signature = createHmac('sha256', config.LIVE_CDN_SIGNING_KEY).update(`pc-live-v1.${prefix}`).digest('hex');
  const expectedUrl = `${config.LIVE_HLS_CDN_ORIGIN}/_live/${prefix}.${signature}/${path}`;
  await run({ name: 'signer_canonical_capability', endpoint: 'live-sign', headers: authorization, body, status: 200,
    accept: data => data.url === expectedUrl && data.expiresAt === new Date(expires * 1000).toISOString() });
  const reject = async (name, rejectedBody, headers = authorization, status = 400, error = 'INVALID_REQUEST') =>
    run({ name, endpoint: 'live-sign', headers, body: rejectedBody, status, accept: data => data.error === error });
  await reject('signer_missing_bearer', canonical(), {}, 401, 'AUTH_REQUIRED');
  await reject('signer_invalid_bearer', canonical(), { Authorization: 'Bearer invalid-acceptance-probe' }, 401, 'AUTH_REQUIRED');
  await reject('signer_expired', { ...canonical(), expiresAt: new Date(now() - 60_000).toISOString() });
  await reject('signer_excessive_ttl', { ...canonical(), expiresAt: new Date(now() + 600_000).toISOString() });
  await reject('signer_cross_session', { ...canonical(), sessionId: randomUUID() });
  await reject('signer_path_traversal', { ...canonical(), path: `live/${session}/${instance}/../master.m3u8` });
  return { schema_version: 1, project_ref: projectRef, checked_at: checkedAt,
    ok: probes.every(result => result.ok), passed: probes.filter(result => result.ok).length, total: probes.length, probes };
}

export async function main(argv = process.argv.slice(2), {
  environment = process.env, fetchImpl = globalThis.fetch, write = text => process.stdout.write(text),
} = {}) {
  if (argv.length === 1 && argv[0] === '--help') { write(HELP); return 0; }
  try {
    const configuration = await loadConfiguration(argumentsFor(argv), environment);
    const receipt = await runAcceptance(configuration, { fetchImpl });
    write(JSON.stringify(receipt, null, 2) + '\n');
    return receipt.ok ? 0 : 1;
  } catch (error) {
    // Never output arbitrary exception text, response bodies, URLs, or headers.
    const code = error instanceof InputFailure ? error.message : 'HELPER_FAILED';
    write(JSON.stringify({ schema_version: 1, ok: false, error: code }) + '\n');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
