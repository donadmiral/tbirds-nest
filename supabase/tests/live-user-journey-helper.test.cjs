const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, chmod, symlink, rm } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { pathToFileURL } = require('node:url');
const directory = path.join(__dirname, '../ops/live-release-20261103');
const helper = import(pathToFileURL(path.join(directory, 'verify-live-user-journey.mjs')).href);
const fixture = import(pathToFileURL(path.join(directory, 'prepare-live-e2e-fixture.mjs')).href);
const ids = { host: '11111111-1111-4111-8111-111111111111', viewer: '22222222-2222-4222-8222-222222222222',
  outsider: '33333333-3333-4333-8333-333333333333', session: '44444444-4444-4444-8444-444444444444',
  instance: '55555555-5555-4555-8555-555555555555', clip: '66666666-6666-4666-8666-666666666666',
  lease: '77777777-7777-4777-8777-777777777777', auth: '88888888-8888-4888-8888-888888888888' };
const clock = Math.floor(Date.now() / 1000) * 1000;
const claimsToken = claims => 'e30.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.synthetic-signature';
const environment = { SUPABASE_ANON_KEY: 'sb_publishable_synthetic_acceptance_only', LIVE_E2E_CDN_ORIGIN: 'https://live-acceptance.invalid' };
for (const role of ['host', 'viewer', 'outsider']) environment[`LIVE_E2E_${role.toUpperCase()}_ACCESS_TOKEN`] = claimsToken({
  role: 'authenticated', sub: ids[role], session_id: ids.auth, exp: clock / 1000 + 3600,
});
const options = phase => ({ projectRef: 'uaulhuelcfkjwojtymmw', sessionId: ids.session, clipId: ids.clip, phase });
const noStore = { 'Cache-Control': 'private, no-store' };
const json = (data, status = 200) => Response.json(data, { status, headers: noStore });
const denied = () => json({ code: '42501', message: 'NOT_AVAILABLE' }, 403);
const mp4 = Buffer.alloc(32); mp4.write('ftyp', 4);
const segment = Buffer.alloc(376); segment[0] = segment[188] = 0x47;

async function configuration(phase = 'live') { return (await helper).validateConfiguration(options(phase), environment, clock); }
function transport(config, intercept = () => undefined) {
  const calls = [];
  const expiry = clock / 1000 + 120;
  const capability = `canary1.${expiry}.${ids.session}.${ids.instance}.${'a'.repeat(64)}`;
  const prefix = `/_live/${capability}/live/${ids.session}/${ids.instance}/`;
  const session = { id: ids.session, host_id: ids.host, audience: 'invite', recording_enabled: true,
    state: config.phase === 'live' ? 'live' : 'ended', started_at: new Date(clock - 140000).toISOString(),
    ended_at: config.phase === 'live' ? null : new Date(clock - 1000).toISOString(), replay_available: config.phase !== 'live' };
  const clip = { id: ids.clip, session_id: ids.session, state: 'ready', moderation_state: 'approved', copyright_state: 'cleared',
    formats: ['horizontal', 'vertical'], created_at: new Date(clock - (config.phase === 'replay' ? 500 : 10000)).toISOString() };
  const fetchImpl = async (raw, init) => {
    const url = new URL(raw), headers = new Headers(init.headers);
    const media = url.origin === config.cdnOrigin || url.pathname.startsWith('/storage/');
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    let role = null;
    if (media) {
      assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
      assert.equal(headers.has('Authorization'), false); assert.equal(headers.has('apikey'), false);
      assert.ok([config.origin, config.cdnOrigin].includes(url.origin), 'Never follow an untrusted media origin');
    } else {
      assert.equal(url.origin, config.origin); assert.equal(headers.get('apikey'), config.apiKey);
      for (const candidate of ['host', 'viewer', 'outsider']) if (headers.get('Authorization') === 'Bearer ' + config.tokens[candidate]) role = candidate;
      assert.ok(url.pathname === '/auth/v1/user' && init.method === 'GET'
        || ['/rest/v1/rpc/live_session', '/rest/v1/rpc/live_clip_get', '/functions/v1/live-playback', '/functions/v1/live-clip-media'].includes(url.pathname) && init.method === 'POST',
      'Only explicit read and media grant endpoints are permitted');
    }
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, role, media, method: init.method });
    const replacement = await intercept({ url, init, role, body, session, clip });
    if (replacement) return replacement;
    if (url.origin === config.cdnOrigin) {
      if (!url.pathname.startsWith(prefix)) return new Response('Access denied', { status: 403 });
      if (url.pathname.endsWith('master.m3u8')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=750000\nvideo/index.m3u8\n');
      if (url.pathname.endsWith('index.m3u8')) return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\n00001.ts\n'
        + (config.phase === 'live' ? '' : '#EXT-X-ENDLIST\n'));
      return new Response(url.pathname.endsWith('init.mp4') ? mp4 : segment, { status: 206 });
    }
    if (url.pathname.startsWith('/storage/')) {
      if (url.pathname.endsWith('thumbnail.jpg')) return new Response(Buffer.from([255, 216, 255, 224, 0, 1]), { status: 206 });
      if (url.pathname.endsWith('captions.vtt')) return new Response('WEBVTT\n\n00:00.000 --> 00:02.000\nSynthetic acceptance caption\n');
      return new Response(mp4, { status: 206 });
    }
    if (url.pathname === '/auth/v1/user') return json({ id: ids[role], is_anonymous: false, email: 'must-not-appear@example.invalid' });
    const allowed = role === 'host' || role === 'viewer' && config.phase !== 'revoked';
    if (url.pathname.endsWith('/live_session')) return allowed ? json({ session, role, capabilities: { view: true } }) : denied();
    if (url.pathname.endsWith('/live_clip_get')) return allowed ? json({ clip }) : denied();
    if (url.pathname.endsWith('/live-playback')) {
      if (!allowed) return json({ error: role ? 'LIVE_NOT_AVAILABLE' : 'AUTH_REQUIRED' }, role ? 403 : 401);
      return json({ url: config.cdnOrigin + prefix + 'master.m3u8', expires_at: new Date(expiry * 1000).toISOString(), format: 'hls', live: config.phase === 'live' });
    }
    assert.ok(url.pathname.endsWith('/live-clip-media'));
    if (!allowed) return json({ error: role ? 'CLIP_NOT_AVAILABLE' : 'AUTH_REQUIRED' }, role ? 403 : 401);
    const filename = { horizontal: 'horizontal.mp4', vertical: 'vertical.mp4', thumbnail: 'thumbnail.jpg', captions: 'captions.vtt' }[body.format];
    return json({ url: `${config.origin}/storage/v1/object/sign/live-clips/${ids.host}/${ids.session}/${ids.clip}/${ids.lease}/${filename}?token=synthetic-storage-secret`,
      filename, expires_at: new Date(clock + 120000).toISOString() });
  };
  return { fetchImpl, calls };
}
function safeReceipt(receipt) {
  const serialized = JSON.stringify(receipt);
  for (const value of Object.values(environment)) assert.equal(serialized.includes(value), false, 'No key, user token or CDN origin in receipt');
  for (const value of ['https://', '/_live/', 'token=', 'synthetic-storage-secret', 'must-not-appear@example.invalid', 'hostile-provider-body'])
    assert.equal(serialized.includes(value), false, 'No remote body or capability in receipt');
  assert.equal(receipt.no_provider_or_database_lifecycle_writes, true);
  assert.equal(receipt.physical_device_verified, false); assert.equal(receipt.audiovisual_quality_verified, false);
  assert.ok(receipt.requests <= 40);
}

for (const phase of ['live', 'replay', 'revoked']) test(`${phase} acceptance verifies all ordinary-user and byte probes without lifecycle writes`, async () => {
  const config = await configuration(phase), mock = transport(config);
  const receipt = await (await helper).runUserAcceptance(config, { ...mock, now: () => clock });
  assert.equal(receipt.ok, true, JSON.stringify(receipt.probes));
  assert.equal(receipt.total, phase === 'revoked' ? 23 : 21); assert.equal(receipt.passed, receipt.total);
  assert.ok(receipt.probes.every(probe => Number.isInteger(probe.status)));
  assert.equal(mock.calls.filter(call => call.media).length, 10);
  assert.ok(mock.calls.every(call => !/live-stage|live-control|live_command|live_clip_command|daily\.co/.test(call.path)));
  safeReceipt(receipt);
});

test('requires three distinct ordinary active sessions and a public API key', async () => {
  const { validateConfiguration } = await helper;
  assert.throws(() => validateConfiguration(options('live'), { ...environment, SUPABASE_ANON_KEY: claimsToken({ role: 'service_role' }) }, clock), /PUBLIC_API_KEY_REQUIRED/);
  assert.throws(() => validateConfiguration(options('live'), { ...environment, LIVE_E2E_VIEWER_ACCESS_TOKEN: environment.LIVE_E2E_HOST_ACCESS_TOKEN }, clock), /THREE_DISTINCT_TEST_USERS_REQUIRED/);
  for (const claims of [
    { role: 'service_role', sub: ids.host, session_id: ids.auth, exp: clock / 1000 + 3600 },
    { role: 'authenticated', sub: ids.host, exp: clock / 1000 + 3600 },
    { role: 'authenticated', sub: ids.host, session_id: ids.auth, exp: clock / 1000 + 60 },
  ]) assert.throws(() => validateConfiguration(options('live'), { ...environment, LIVE_E2E_HOST_ACCESS_TOKEN: claimsToken(claims) }, clock), /ACTIVE_TEST_USER_SESSIONS_REQUIRED/);
  assert.throws(() => validateConfiguration({ ...options('live'), projectRef: 'attacker.invalid' }, environment), /INVALID_FIXTURE_ARGUMENTS/);
  assert.throws(() => validateConfiguration(options('live'), { ...environment, LIVE_E2E_CDN_ORIGIN: 'https://live-acceptance.invalid/path' }), /INVALID_CDN_ORIGIN/);
});

test('public sessions, mismatched host identity, and a live-created clip in replay phase fail acceptance', async () => {
  const { runUserAcceptance } = await helper;
  for (const invalid of ['public', 'wrong-host', 'old-clip']) {
    const config = await configuration('replay');
    const mock = transport(config, ({ url, role, session, clip }) => {
      if (invalid !== 'old-clip' && url.pathname.endsWith('/live_session') && role === 'host') return json({
        session: { ...session, ...(invalid === 'public' ? { audience: 'public' } : { host_id: ids.outsider }) }, role, capabilities: { view: true },
      });
      if (invalid === 'old-clip' && url.pathname.endsWith('/live_clip_get') && role === 'host') return json({ clip: { ...clip, created_at: session.started_at } });
    });
    const receipt = await runUserAcceptance(config, { ...mock, now: () => clock });
    assert.equal(receipt.ok, false);
    assert.ok(receipt.probes.some(probe => probe.error === (invalid === 'old-clip' ? 'CLIP_PHASE_MISMATCH' : 'PRIVATE_FIXTURE_REQUIRED')));
    safeReceipt(receipt);
  }
});

test('an outsider or revoked viewer that still receives session access is a failing result', async () => {
  const { runUserAcceptance } = await helper;
  for (const phase of ['live', 'revoked']) {
    const config = await configuration(phase);
    const mock = transport(config, ({ url, role, session }) => {
      if (url.pathname.endsWith('/live_session') && role === (phase === 'live' ? 'outsider' : 'viewer')) return json({ session, role: 'viewer', capabilities: { view: true } });
    });
    const receipt = await runUserAcceptance(config, { ...mock, now: () => clock });
    assert.equal(receipt.ok, false); assert.ok(receipt.probes.some(probe => probe.error === 'ACCESS_NOT_DENIED')); safeReceipt(receipt);
  }
});

test('media grants cannot redirect user credentials or cross the session or project scope', async () => {
  const { runUserAcceptance } = await helper;
  for (const invalid of ['cdn-origin', 'clip-origin', 'clip-session']) {
    const config = await configuration();
    const mock = transport(config, ({ url, role, body }) => {
      if (role !== 'viewer') return;
      if (invalid === 'cdn-origin' && url.pathname.endsWith('/live-playback')) return json({ url: 'https://attacker.invalid/_live/secret',
        format: 'hls', live: true, expires_at: new Date(clock + 120000).toISOString() });
      if (invalid !== 'cdn-origin' && url.pathname.endsWith('/live-clip-media')) {
        const origin = invalid === 'clip-origin' ? 'https://attacker.invalid' : config.origin;
        const session = invalid === 'clip-session' ? ids.outsider : ids.session;
        return json({ url: `${origin}/storage/v1/object/sign/live-clips/${ids.host}/${session}/${ids.clip}/${ids.lease}/${body.format}.mp4?token=synthetic-storage-secret`,
          expires_at: new Date(clock + 120000).toISOString() });
      }
    });
    const receipt = await runUserAcceptance(config, { ...mock, now: () => clock });
    assert.equal(receipt.ok, false); assert.ok(receipt.probes.some(probe => probe.error === (invalid === 'cdn-origin' ? 'PLAYBACK_GRANT_INVALID' : 'CLIP_GRANT_INVALID')));
    safeReceipt(receipt);
  }
});

test('untrusted playlist references are not followed and a replay must contain its final marker', async () => {
  const { runUserAcceptance } = await helper;
  for (const invalid of ['foreign-uri', 'unfinished-replay']) {
    const config = await configuration('replay');
    const mock = transport(config, ({ url }) => {
      if (!url.pathname.endsWith('index.m3u8')) return;
      return new Response('#EXTM3U\n#EXTINF:6,\n' + (invalid === 'foreign-uri' ? 'https://attacker.invalid/segment.ts\n#EXT-X-ENDLIST\n' : '00001.ts\n'));
    });
    const receipt = await runUserAcceptance(config, { ...mock, now: () => clock });
    assert.equal(receipt.probes.find(probe => probe.name === 'real_manifest_and_media_bytes').error, 'PLAYLIST_INVALID'); safeReceipt(receipt);
  }
});

test('network exceptions, redirects, oversized responses and remote bodies stay sanitized', async () => {
  const config = await configuration(), { runUserAcceptance } = await helper;
  const hostile = 'hostile-provider-body ' + environment.LIVE_E2E_HOST_ACCESS_TOKEN + ' https://attacker.invalid/secret';
  for (const [fetchImpl, expected] of [
    [async () => { throw Error(hostile); }, 'REQUEST_FAILED'],
    [async () => new Response(null, { status: 302, headers: { Location: 'https://attacker.invalid/secret' } }), 'UNEXPECTED_REDIRECT'],
    [async () => new Response(hostile, { headers: { 'Content-Length': '999999' } }), 'RESPONSE_TOO_LARGE'],
    [async () => new Response('x'.repeat(65537)), 'RESPONSE_TOO_LARGE'],
    [async () => json({ error: hostile }, 500), 'AUTHENTICATION_FAILED'],
  ]) {
    const receipt = await runUserAcceptance(config, { fetchImpl, now: () => clock });
    assert.equal(receipt.ok, false); assert.equal(receipt.requests, 3);
    assert.ok(receipt.probes.every(probe => probe.error === expected)); safeReceipt(receipt);
  }
});

test('request and response-body stalls stop at the deadline', async () => {
  const config = await configuration(), { runUserAcceptance } = await helper;
  for (const fetchImpl of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const receipt = await runUserAcceptance(config, { fetchImpl, now: () => clock, timeoutMs: 5 });
    assert.equal(receipt.ok, false); assert.ok(receipt.probes.every(probe => probe.error === 'TIMEOUT')); safeReceipt(receipt);
  }
});

test('CLI accepts only a protected regular account file and never echoes unsafe arguments', async () => {
  const { main } = await helper;
  const folder = await mkdtemp(path.join(tmpdir(), 'live-journey-synthetic-'));
  const filename = path.join(folder, 'accounts.env'), link = path.join(folder, 'linked.env');
  const args = ['--project-ref', options('live').projectRef, '--session-id', ids.session, '--clip-id', ids.clip, '--phase', 'live', '--env-file', filename];
  let calls = 0;
  const invoke = async argv => {
    let output = '';
    const exit = await main(argv, { write: value => { output += value; }, fetchImpl: async () => { calls++; throw Error('Network must not be reached'); } });
    return { exit, output, result: JSON.parse(output) };
  };
  try {
    await writeFile(filename, Object.entries(environment).map(([name, value]) => `${name}=${value}`).join('\n'), { mode: 0o644 });
    assert.equal((await invoke(args)).result.error, 'PROTECTED_ACCOUNT_FILE_REQUIRED');
    await chmod(filename, 0o600); await symlink(filename, link);
    assert.equal((await invoke([...args.slice(0, -1), link])).result.error, 'PROTECTED_ACCOUNT_FILE_REQUIRED');
    await writeFile(filename, 'x'.repeat(65537));
    assert.equal((await invoke(args)).result.error, 'PROTECTED_ACCOUNT_FILE_REQUIRED');
    const invalid = await invoke(['--hostile-provider-body', environment.LIVE_E2E_HOST_ACCESS_TOKEN]);
    assert.equal(invalid.exit, 2); assert.equal(invalid.result.error, 'INVALID_ARGUMENTS'); assert.equal(invalid.output.includes('synthetic-signature'), false);
    assert.equal(calls, 0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('synthetic fixture clip durations, relative subtitles and cover positions satisfy the actual shared editor contract', async () => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '../../shared/liveClips.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module, exports: module.exports, require() { return {}; } });
  const specs = (await fixture).clipSpecifications();
  assert.deepEqual(specs.map(spec => (spec.end_ms - spec.start_ms) / 1000), [15, 30, 60, 90, 120]);
  for (const spec of specs) {
    assert.equal(module.exports.validateClipSpec(spec, { available_start_ms: 0, available_end_ms: 145000, max_duration_ms: 600000,
      settings: { watermark_required: true } }), null);
    assert.equal(spec.subtitles.at(-1).end_ms, spec.end_ms - spec.start_ms);
  }
});
