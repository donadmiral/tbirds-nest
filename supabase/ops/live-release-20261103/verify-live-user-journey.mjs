#!/usr/bin/env node
// Read-only acceptance of an operator-created private fixture. Uses three real
// application sessions, never a service/provider/signing key. No lifecycle writes.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PROJECTS = ['uaulhuelcfkjwojtymmw', 'prlkikhckbifseosbukl'];
const ROLES = ['host', 'viewer', 'outsider'];
const FAILURE_CODES = new Set(['REQUEST_FAILED', 'TIMEOUT', 'RESPONSE_TOO_LARGE', 'UNEXPECTED_REDIRECT', 'INVALID_JSON',
  'AUTHENTICATION_FAILED', 'ACCOUNT_SCOPE_MISMATCH', 'PRIVATE_FIXTURE_REQUIRED', 'SESSION_PHASE_MISMATCH', 'ACCESS_NOT_DENIED',
  'PLAYBACK_NOT_READY', 'PLAYBACK_GRANT_INVALID', 'PLAYLIST_INVALID', 'MEDIA_RANGE_INVALID', 'CLIP_NOT_READY',
  'CLIP_PHASE_MISMATCH', 'CLIP_GRANT_INVALID', 'CAPTIONS_INVALID', 'THUMBNAIL_INVALID', 'CACHE_POLICY_INVALID',
  'REQUEST_BUDGET_EXCEEDED', 'READ_ONLY_CONTRACT_VIOLATION']);
class InputFailure extends Error {}
class ProbeFailure extends Error {}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ensure = (value, code) => { if (!value) throw new ProbeFailure(code); };
const jwt = value => {
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')); }
  catch { return null; }
};
export const HELP = `Usage: node verify-live-user-journey.mjs --project-ref <qa-or-production-ref> --session-id <uuid> --clip-id <uuid> --phase <live|replay|revoked> --env-file /protected/test-accounts.env

Required protected-file variables:
  SUPABASE_ANON_KEY              Publishable key or legacy anon JWT only
  LIVE_E2E_HOST_ACCESS_TOKEN     Active ordinary application user JWT
  LIVE_E2E_VIEWER_ACCESS_TOKEN   Different accepted viewer user JWT
  LIVE_E2E_OUTSIDER_ACCESS_TOKEN Different uninvited user JWT
  LIVE_E2E_CDN_ORIGIN            Exact configured HTTPS CDN origin

Requires a private invite-only session created by the host. The ready clip must
be published as a replay highlight so the accepted viewer may read it. Live and
replay phases require different clips created in the stated phase. Revoked phase
expects the formerly accepted viewer to have been removed by the host.
Only identity/session/clip reads, playback grants, and bounded media GETs occur.
Never calls live-stage, live-control, live_command, or live_clip_command. No polling.
At most 40 requests; each request has an 8-second deadline and a bounded response.
No credentials, signed URLs, response bodies, user names, or emails are logged.
Exit 0 all probes passed, 1 acceptance failed, 2 invalid inputs. Node 22.6+.
`;

export function validateConfiguration(options, source, now = Date.now()) {
  if (!PROJECTS.includes(options.projectRef) || !UUID.test(options.sessionId || '') || !UUID.test(options.clipId || '')
    || !['live', 'replay', 'revoked'].includes(options.phase)) throw new InputFailure('INVALID_FIXTURE_ARGUMENTS');
  const apiKey = source.SUPABASE_ANON_KEY;
  if (typeof apiKey !== 'string' || apiKey.length > 8192 || !/^[A-Za-z0-9._-]{20,}$/.test(apiKey)
    || (!apiKey.startsWith('sb_publishable_') && jwt(apiKey)?.role !== 'anon')) throw new InputFailure('PUBLIC_API_KEY_REQUIRED');
  const tokens = {};
  for (const role of ROLES) {
    const value = source[`LIVE_E2E_${role.toUpperCase()}_ACCESS_TOKEN`];
    const claims = typeof value === 'string' && value.length < 16384 ? jwt(value) : null;
    if (!claims || claims.role !== 'authenticated' || !UUID.test(claims.sub || '') || !UUID.test(claims.session_id || '')
      || !Number.isFinite(claims.exp) || claims.exp * 1000 < now + 180000) throw new InputFailure('ACTIVE_TEST_USER_SESSIONS_REQUIRED');
    tokens[role] = value;
  }
  if (new Set(ROLES.map(role => jwt(tokens[role]).sub)).size !== ROLES.length) throw new InputFailure('THREE_DISTINCT_TEST_USERS_REQUIRED');
  let cdn;
  try {
    cdn = new URL(source.LIVE_E2E_CDN_ORIGIN);
    if (cdn.protocol !== 'https:' || cdn.username || cdn.password || cdn.pathname !== '/' || cdn.port || cdn.search || cdn.hash) throw new Error();
  } catch { throw new InputFailure('INVALID_CDN_ORIGIN'); }
  return { ...options, apiKey, tokens, cdnOrigin: cdn.origin, origin: `https://${options.projectRef}.supabase.co` };
}
async function protectedFile(filename) {
  let handle; const bytes = Buffer.alloc(65537);
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o077) || (typeof process.getuid === 'function' && stat.uid !== process.getuid()) || stat.size > 65536) throw new Error();
    let length = 0;
    while (length < bytes.length) { const next = await handle.read(bytes, length, bytes.length - length, length); if (!next.bytesRead) break; length += next.bytesRead; }
    if (length > 65536) throw new Error();
    return parseEnv(bytes.subarray(0, length).toString('utf8'));
  } catch { throw new InputFailure('PROTECTED_ACCOUNT_FILE_REQUIRED'); }
  finally { bytes.fill(0); await handle?.close().catch(() => {}); }
}
async function readBytes(response, maximum, signal) {
  if (Number(response.headers.get('content-length') || 0) > maximum) { void response.body?.cancel().catch(() => {}); throw new ProbeFailure('RESPONSE_TOO_LARGE'); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      ensure(!signal.aborted, 'TIMEOUT');
      const { done, value } = await reader.read(); ensure(!signal.aborted, 'TIMEOUT'); if (done) break;
      length += value.length; if (length > maximum) { cancel(); throw new ProbeFailure('RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, length);
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
function playbackGrant(data, config, now) {
  ensure(record(data) && data.format === 'hls' && typeof data.url === 'string', 'PLAYBACK_GRANT_INVALID');
  const expiry = Date.parse(data.expires_at), url = new URL(data.url), parts = url.pathname.split('/'), token = parts[2]?.split('.');
  ensure(expiry > now + 1000 && expiry <= now + 150000 && url.origin === config.cdnOrigin && !url.username && !url.password && !url.search && !url.hash
    && parts.length === 7 && parts[1] === '_live' && parts[3] === 'live' && parts[4] === config.sessionId && UUID.test(parts[5]) && parts[6] === 'master.m3u8'
    && token?.length === 5 && /^[a-z0-9_-]{1,16}$/.test(token[0]) && Number(token[1]) * 1000 === expiry
    && token[2] === config.sessionId && token[3] === parts[5] && /^[a-f0-9]{64}$/.test(token[4]), 'PLAYBACK_GRANT_INVALID');
  ensure(typeof data.live === 'boolean' && (config.phase === 'revoked' || data.live === (config.phase === 'live')), 'SESSION_PHASE_MISMATCH');
  return { url, prefix: url.pathname.slice(0, -'master.m3u8'.length), live: data.live };
}
function mediaReferences(bytes, parent, config, prefix) {
  const text = bytes.toString('utf8'); ensure(/^#EXTM3U\r?\n/.test(text), 'PLAYLIST_INVALID');
  const values = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  ensure(values.length > 0 && values.length <= 5000, 'PLAYLIST_INVALID');
  const resolve = value => {
    const url = new URL(value, parent);
    ensure(url.origin === config.cdnOrigin && url.pathname.startsWith(prefix) && !url.username && !url.password && !url.search && !url.hash, 'PLAYLIST_INVALID');
    return url;
  };
  const map = text.match(/^#EXT-X-MAP:.*\bURI="([^"]+)"/m)?.[1];
  ensure(!/^#EXT-X-KEY:(?!METHOD=NONE)/m.test(text), 'PLAYLIST_INVALID');
  return { next: resolve(values[0]), map: map ? resolve(map) : null,
    isMaster: /^#EXT-X-STREAM-INF:/m.test(text), ended: /^#EXT-X-ENDLIST\s*$/m.test(text) };
}
function clipGrant(data, config, format, now) {
  const url = new URL(data?.url), expiry = Date.parse(data?.expires_at);
  const filename = { horizontal: 'horizontal.mp4', vertical: 'vertical.mp4', thumbnail: 'thumbnail.jpg', captions: 'captions.vtt' }[format];
  const scope = '/storage/v1/object/sign/live-clips/', path = url.pathname.slice(scope.length).split('/');
  ensure(url.origin === config.origin && url.pathname.startsWith(scope) && !url.username && !url.password && !url.hash && url.searchParams.has('token')
    && expiry > now + 1000 && expiry <= now + 150000 && path.length === 5 && path.slice(0, 4).every(value => UUID.test(value))
    && path[1] === config.sessionId && path[2] === config.clipId && path[4] === filename, 'CLIP_GRANT_INVALID');
  return url;
}

export async function runUserAcceptance(config, { fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000) throw new InputFailure('INVALID_TIMEOUT');
  const probes = []; let requests = 0, lastStatus = null;
  const readOnlyPaths = new Set(['/rest/v1/rpc/live_session', '/rest/v1/rpc/live_clip_get', '/functions/v1/live-playback', '/functions/v1/live-clip-media']);
  const request = async (url, { token, method = 'GET', body, media = false, maximum = 65536, range = false } = {}) => {
    ensure(requests < 40, 'REQUEST_BUDGET_EXCEEDED');
    const target = new URL(url);
    ensure(media ? method === 'GET' && body === undefined && [config.origin, config.cdnOrigin].includes(target.origin)
      : target.origin === config.origin && (target.pathname === '/auth/v1/user' && method === 'GET' && body === undefined
        || readOnlyPaths.has(target.pathname) && method === 'POST'), 'READ_ONLY_CONTRACT_VIOLATION');
    const controller = new AbortController(); let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ProbeFailure('TIMEOUT')); }, timeoutMs); });
    try {
      requests++;
      return await Promise.race([deadline, (async () => {
        const headers = media ? { ...(range ? { Range: 'bytes=0-65535' } : {}) } : { apikey: config.apiKey, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
        const response = await fetchImpl(String(url), { method, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        lastStatus = response.status;
        ensure(!response.redirected && !(response.status >= 300 && response.status < 400), 'UNEXPECTED_REDIRECT');
        return { status: response.status, headers: response.headers, bytes: await readBytes(response, maximum, controller.signal) };
      })()]);
    } finally { clearTimeout(timer); controller.abort(); }
  };
  const json = async (path, role, body) => {
    const response = await request(config.origin + path, { token: role ? config.tokens[role] : undefined, method: body === undefined ? 'GET' : 'POST', body });
    let data; try { data = JSON.parse(response.bytes.toString('utf8')); } catch { throw new ProbeFailure('INVALID_JSON'); }
    return { ...response, data };
  };
  const rpc = (name, role, body) => json('/rest/v1/rpc/' + name, role, body);
  const edge = (name, role, body) => json('/functions/v1/' + name, role, body);
  const run = async (name, action) => {
    const started = performance.now(); lastStatus = null;
    try { const value = await action(); probes.push({ name, ok: true, status: lastStatus, elapsed_ms: Math.round(performance.now() - started) }); return value; }
    catch (error) { probes.push({ name, ok: false, status: lastStatus, elapsed_ms: Math.round(performance.now() - started),
      error: error instanceof ProbeFailure && FAILURE_CODES.has(error.message) ? error.message : 'REQUEST_FAILED' }); return null; }
  };
  const receipt = () => ({ schema_version: 1, checked_at: new Date(now()).toISOString(), project_ref: config.projectRef, session_id: config.sessionId, clip_id: config.clipId,
    phase: config.phase, scope: 'authenticated_private_session_and_clip_reads', no_provider_or_database_lifecycle_writes: true,
    physical_device_verified: false, audiovisual_quality_verified: false, measured_capacity_verified: false,
    ok: probes.every(probe => probe.ok), passed: probes.filter(probe => probe.ok).length, total: probes.length, requests, probes });
  const identities = {};
  for (const role of ROLES) identities[role] = await run(`${role}_active_identity`, async () => {
    const result = await json('/auth/v1/user', role);
    ensure(result.status === 200 && UUID.test(result.data.id || '') && result.data.is_anonymous !== true
      && result.data.id === jwt(config.tokens[role]).sub, 'AUTHENTICATION_FAILED'); return result.data.id;
  });
  if (ROLES.some(role => !identities[role])) return receipt();
  ensure(new Set(Object.values(identities)).size === 3, 'ACCOUNT_SCOPE_MISMATCH');
  const host = await run('host_private_session', async () => {
    const result = await rpc('live_session', 'host', { p_session_id: config.sessionId }), session = result.data.session;
    ensure(result.status === 200 && record(session) && session.id === config.sessionId && session.host_id === identities.host
      && result.data.role === 'host' && session.audience === 'invite', 'PRIVATE_FIXTURE_REQUIRED');
    ensure(session.recording_enabled === true && result.data.capabilities?.view === true && (config.phase === 'live' ? session.state === 'live'
      : config.phase === 'replay' ? session.state === 'ended' && session.replay_available === true
      : ['live', 'reconnecting', 'ended'].includes(session.state)), 'SESSION_PHASE_MISMATCH'); return session;
  });
  if (!host) return receipt();
  for (const role of ['viewer', 'outsider']) await run(`${role}_session_access`, async () => {
    const result = await rpc('live_session', role, { p_session_id: config.sessionId });
    if (role === 'outsider' || config.phase === 'revoked') ensure(result.status === 403 && result.data.code === '42501', 'ACCESS_NOT_DENIED');
    else ensure(result.status === 200 && result.data.session?.id === config.sessionId && result.data.role === 'viewer'
      && result.data.capabilities?.view === true, 'PRIVATE_FIXTURE_REQUIRED');
  });
  const grantRole = config.phase === 'revoked' ? 'host' : 'viewer';
  const grant = await run('authorized_playback_grant', async () => {
    const result = await edge('live-playback', grantRole, { sessionId: config.sessionId });
    ensure(result.status === 200, 'PLAYBACK_NOT_READY'); ensure(/\bno-store\b/.test(result.headers.get('cache-control') || ''), 'CACHE_POLICY_INVALID');
    return playbackGrant(result.data, config, now());
  });
  for (const role of config.phase === 'revoked' ? ['viewer', 'outsider', null] : ['outsider', null]) await run(`${role || 'anonymous'}_playback_denied`, async () => {
    const result = await edge('live-playback', role, { sessionId: config.sessionId });
    ensure(result.status === (role ? 403 : 401) && ['LIVE_NOT_AVAILABLE', 'AUTH_REQUIRED'].includes(result.data.error), 'ACCESS_NOT_DENIED');
  });
  if (grant) {
    await run('real_manifest_and_media_bytes', async () => {
      let current = grant.url, playlist;
      for (let depth = 0; depth < 3; depth++) {
        const result = await request(current, { media: true, maximum: 262144 }); ensure(result.status === 200, 'PLAYBACK_NOT_READY');
        playlist = mediaReferences(result.bytes, current, config, grant.prefix);
        if (!playlist.isMaster) break; current = playlist.next;
      }
      ensure(playlist && !playlist.isMaster && (config.phase !== 'replay' || playlist.ended), 'PLAYLIST_INVALID');
      if (playlist.map) { const init = await request(playlist.map, { media: true, range: true }); ensure([200, 206].includes(init.status) && init.bytes.length > 16, 'MEDIA_RANGE_INVALID'); }
      const segment = await request(playlist.next, { media: true, range: true });
      ensure([200, 206].includes(segment.status) && segment.bytes.length > 16
        && (segment.bytes[0] === 0x47 || ['ftyp', 'styp', 'moof', 'sidx', 'mdat'].includes(segment.bytes.toString('ascii', 4, 8))), 'MEDIA_RANGE_INVALID');
    });
    await run('unsigned_manifest_denied', async () => {
      const raw = config.cdnOrigin + '/' + grant.url.pathname.split('/').slice(3).join('/');
      ensure((await request(raw, { media: true })).status === 403, 'ACCESS_NOT_DENIED');
    });
    await run('altered_playback_capability_denied', async () => {
      const altered = new URL(grant.url), parts = altered.pathname.split('/');
      parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('a') ? 'b' : 'a'); altered.pathname = parts.join('/');
      ensure((await request(altered, { media: true })).status === 403, 'ACCESS_NOT_DENIED');
    });
  }
  const clip = await run('host_ready_clip_and_creation_phase', async () => {
    const result = await rpc('live_clip_get', 'host', { p_clip_id: config.clipId }), value = result.data.clip;
    ensure(result.status === 200 && record(value) && value.id === config.clipId && value.session_id === config.sessionId && value.state === 'ready'
      && value.moderation_state === 'approved' && value.copyright_state === 'cleared'
      && value.formats?.includes('horizontal') && value.formats?.includes('vertical'), 'CLIP_NOT_READY');
    const created = Date.parse(value.created_at), start = Date.parse(host.started_at), end = Date.parse(host.ended_at);
    ensure(Number.isFinite(created) && created >= start && (config.phase !== 'replay' || Number.isFinite(end) && created >= end), 'CLIP_PHASE_MISMATCH');
    return value;
  });
  for (const role of ['viewer', 'outsider']) await run(`${role}_clip_access`, async () => {
    const result = await rpc('live_clip_get', role, { p_clip_id: config.clipId });
    if (role === 'outsider' || config.phase === 'revoked') ensure(result.status === 403 && result.data.code === '42501', 'ACCESS_NOT_DENIED');
    else ensure(result.status === 200 && result.data.clip?.id === config.clipId, 'CLIP_NOT_READY');
  });
  if (clip) for (const format of ['horizontal', 'vertical', 'thumbnail', 'captions']) await run(`authorized_${format}_clip_bytes`, async () => {
    const result = await edge('live-clip-media', grantRole, { clipId: config.clipId, format });
    ensure(result.status === 200, 'CLIP_NOT_READY'); ensure(/\bno-store\b/.test(result.headers.get('cache-control') || ''), 'CACHE_POLICY_INVALID');
    const url = clipGrant(result.data, config, format, now()), bytes = await request(url, { media: true, range: format !== 'captions' });
    ensure([200, 206].includes(bytes.status) && bytes.bytes.length > 3, 'MEDIA_RANGE_INVALID');
    if (format === 'thumbnail') ensure(bytes.bytes[0] === 0xff && bytes.bytes[1] === 0xd8 && bytes.bytes[2] === 0xff, 'THUMBNAIL_INVALID');
    else if (format === 'captions') ensure(bytes.bytes.toString('utf8').startsWith('WEBVTT') && bytes.bytes.includes(Buffer.from('-->')), 'CAPTIONS_INVALID');
    else ensure(bytes.bytes.toString('ascii', 4, 8) === 'ftyp', 'MEDIA_RANGE_INVALID');
  });
  for (const role of config.phase === 'revoked' ? ['viewer', 'outsider', null] : ['outsider', null]) await run(`${role || 'anonymous'}_clip_media_denied`, async () => {
    const result = await edge('live-clip-media', role, { clipId: config.clipId, format: 'horizontal' });
    ensure(result.status === (role ? 403 : 401) && result.data.error === (role ? 'CLIP_NOT_AVAILABLE' : 'AUTH_REQUIRED'), 'ACCESS_NOT_DENIED');
  });
  return receipt();
}
export async function main(argv = process.argv.slice(2), { write = value => process.stdout.write(value), fetchImpl = globalThis.fetch } = {}) {
  if (argv.length === 1 && argv[0] === '--help') { write(HELP); return 0; }
  try {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
      const key = argv[i], value = argv[i + 1];
      if (!['--project-ref', '--session-id', '--clip-id', '--phase', '--env-file'].includes(key) || key in args || !value || value.startsWith('--')) throw new InputFailure('INVALID_ARGUMENTS');
      args[key] = value;
    }
    const options = { projectRef: args['--project-ref'], sessionId: args['--session-id'], clipId: args['--clip-id'], phase: args['--phase'] };
    if (!PROJECTS.includes(options.projectRef) || !UUID.test(options.sessionId || '') || !UUID.test(options.clipId || '')
      || !['live', 'replay', 'revoked'].includes(options.phase) || !args['--env-file']) throw new InputFailure('INVALID_ARGUMENTS');
    const config = validateConfiguration(options, await protectedFile(args['--env-file']));
    const receipt = await runUserAcceptance(config, { fetchImpl }); write(JSON.stringify(receipt, null, 2) + '\n'); return receipt.ok ? 0 : 1;
  } catch (error) { write(JSON.stringify({ ok: false, error: error instanceof InputFailure ? error.message : 'ACCEPTANCE_FAILED' }) + '\n'); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
