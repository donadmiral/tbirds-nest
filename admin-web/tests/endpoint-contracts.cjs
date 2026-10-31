const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { endpointHarness, response, ACTOR, SESSION, OBJECT, SITE } = require('./helpers/endpointFixture.cjs');
const results = [], sourceFiles = new Set();
const audit = (route, title, work) => test(route + ': ' + title, async () => {
  const row = { route, title, status: 'running' }; results.push(row);
  try { await work(); row.status = 'passed'; } catch (error) { row.status = 'failed'; row.failure = error.message; throw error; }
});
function harness(options) {
  const h = endpointHarness(options), load = h.load;
  h.load = file => { const value = load(file); h.loaded.forEach(item => sourceFiles.add(item)); return value; };
  return h;
}
const reportPath = '/rest/v1/rpc/report_client_error';
const diagRequest = (h, body = { category: 'TypeError', source: 'render' }, headers = {}) => h.request('/api/diagnostics', {
  method: 'POST', headers: { origin: SITE, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
audit('/api/diagnostics', 'real verified staff session forwards enum-only data with the user bearer', async () => {
  const h = harness({ respond: call => call.path === reportPath ? response(null, 204) : undefined });
  const route = h.load('app/api/diagnostics/route.ts');
  const result = await route.POST(diagRequest(h, { category: 'TypeError', source: 'render', fatal: true, appVersion: '1.1.0', platform: 'ios', message: 'private message', stack: 'private stack', token: 'private token' }));
  assert.equal(result.status, 204);
  const sent = h.calls.find(call => call.path === reportPath);
  assert.equal(sent.headers.authorization, 'Bearer ' + h.token);
  assert.equal(sent.headers.apikey, 'synthetic-endpoint-anon-key');
  assert.deepEqual(sent.body.p_report, { version: 1, category: 'TypeError', source: 'render', platform: 'admin', fatal: true, appVersion: '1.1.0' });
  assert.equal(h.calls.some(call => call.path === '/rest/v1/rpc/triniti_admin_session_check'), true);
  assert.deepEqual(h.unhandled, []);
});
for (const [title, options] of [['guest', { signedIn: false }], ['revoked session', { sessionActive: false }], ['inactive role', { active: false }], ['unknown role', { role: 'made_up_role' }], ['unverified token', { authError: true }]]) {
  audit('/api/diagnostics', title + ' cannot submit diagnostics', async () => {
    const h = harness(options), route = h.load('app/api/diagnostics/route.ts');
    assert.equal((await route.POST(diagRequest(h))).status, 401);
    assert.equal(h.calls.some(call => call.path === reportPath), false);
  });
}
audit('/api/diagnostics', 'cross-origin, wrong content type and oversized UTF-8 bodies stop before Auth', async () => {
  for (const [body, headers, expected] of [[{}, { origin: 'https://foreign.invalid' }, 403], [{}, { 'content-type': 'text/plain' }, 403], ['{}', { 'content-length': '2049' }, 413], [{ category: 'é'.repeat(1100) }, {}, 413], [[], {}, 400]]) {
    const h = harness(), route = h.load('app/api/diagnostics/route.ts');
    assert.equal((await route.POST(diagRequest(h, body, headers))).status, expected);
    assert.deepEqual(h.calls, []);
  }
});
audit('/api/diagnostics', 'malformed JSON is a bounded client error', async () => {
  const h = harness(), route = h.load('app/api/diagnostics/route.ts');
  assert.equal((await route.POST(diagRequest(h, '{'))).status, 400);
  assert.deepEqual(h.calls, []);
});
audit('/api/diagnostics', 'provider failure returns unavailable without recursive reporting', async () => {
  for (const thrown of [false, true]) {
    const h = harness({ respond: call => { if (call.path !== reportPath) return; if (thrown) throw new TypeError('synthetic offline'); return response({ message: 'private provider error' }, 503); } });
    const result = await h.load('app/api/diagnostics/route.ts').POST(diagRequest(h));
    assert.equal(result.status, 503); assert.equal(h.calls.filter(call => call.path === reportPath).length, 1);
    assert.equal(await result.text(), '');
  }
});

const mediaRoute = '/api/moderation-media';
function mediaFixture(options = {}) {
  let proofs = 0;
  const h = harness({ ...options, respond: call => {
    if (call.path === '/rest/v1/rpc/admin_bound_content_media_object') {
      proofs++;
      return response(options.unbound ? null : { object_id: OBJECT, object_version: options.changed && proofs > 1 ? 'version2' : 'version1' });
    }
    if (call.path === '/storage/v1/object/authenticated/post-media/owner/photo.jpg') {
      if (options.storageError) throw new TypeError('synthetic upstream outage');
      return new Response(call.method === 'HEAD' ? null : 'synthetic media bytes', { status: options.partial ? 206 : 200, headers: { 'content-type': 'image/jpeg', 'accept-ranges': 'bytes', ...(options.partial ? { 'content-range': 'bytes 0-3/20' } : {}) } });
    }
  } });
  const route = h.load('app/api/moderation-media/route.ts');
  const request = (init = {}, query = {}) => h.request(mediaRoute + '?' + new URLSearchParams({ kind: 'post', id: OBJECT, bucket: 'post-media', path: 'owner/photo.jpg', ...query }), init);
  return { h, route, request };
}
audit(mediaRoute, 'GET, HEAD and range execute real Auth, exact object proof and reauthorization', async () => {
  for (const method of ['GET', 'HEAD', 'RANGE']) {
    const { h, route, request } = mediaFixture({ partial: method === 'RANGE' });
    const result = await route[method === 'HEAD' ? 'HEAD' : 'GET'](request({ method: method === 'HEAD' ? 'HEAD' : 'GET', ...(method === 'RANGE' ? { headers: { Range: 'bytes=0-3' } } : {}) }));
    assert.equal(result.status, method === 'RANGE' ? 206 : 200);
    assert.equal(await result.text(), method === 'HEAD' ? '' : 'synthetic media bytes');
    assert.match(result.headers.get('cache-control'), /no-store/);
    assert.equal(h.calls.filter(call => call.path === '/auth/v1/user').length, 2);
    assert.equal(h.calls.filter(call => call.path === '/rest/v1/rpc/admin_bound_content_media_object').length, 2);
    const storage = h.calls.find(call => call.path.startsWith('/storage/'));
    assert.equal(storage.redirect, 'error'); assert.equal(storage.cache, 'no-store');
    assert.deepEqual(h.unhandled, []);
  }
});
for (const [title, options, expected] of [['guest', { signedIn: false }, 401], ['wrong role', { role: 'analyst' }, 403], ['revoked while reading', { revokeAfterFirstSessionRead: true }, 403], ['object replaced', { changed: true }, 403], ['unbound object', { unbound: true }, 404], ['storage outage', { storageError: true }, 503]]) {
  audit(mediaRoute, title + ' produces no private media', async () => {
    const { route, request } = mediaFixture(options);
    const result = await route.GET(request());
    assert.equal(result.status, expected); assert.doesNotMatch(await result.text(), /synthetic media bytes|service-key/);
    assert.match(result.headers.get('cache-control'), /no-store/);
  });
}

const soundPath = ACTOR + '/' + OBJECT + '.wav';
function audioFixture(options = {}) {
  let proofs = 0;
  const h = harness({ ...options, respond: call => {
    if (call.path === '/rest/v1/rpc/admin_original_audio_object') {
      proofs++;
      return response(options.unbound ? null : { bucket: 'music-audio', path: soundPath, mime: 'audio/wav', version: options.changed && proofs > 1 ? 'version2' : 'version1' });
    }
    if (call.path === '/storage/v1/object/authenticated/music-audio/' + soundPath) {
      if (options.storageError) throw new TypeError('synthetic storage outage');
      if (options.heldHeaders) return new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('Synthetic header request aborted'), { name: 'AbortError' }));
        if (call.signal.aborted) abort(); else call.signal.addEventListener('abort', abort, { once: true });
      });
      return new Response('synthetic audio bytes', { status: options.partial ? 206 : 200, headers: { 'content-type': 'audio/wav', ...(options.partial ? { 'content-range': 'bytes 0-3/20' } : {}) } });
    }
  } });
  return { h, route: h.load('app/api/music/[id]/route.ts'), params: { params: Promise.resolve({ id: OBJECT }) } };
}
audit('/api/music/[id]', 'authorized original audio binds both reads to the real verified actor/session', async () => {
  const { h, route, params } = audioFixture({ partial: true });
  const result = await route.GET(h.request('/api/music/' + OBJECT, { headers: { Range: 'bytes=0-3' } }), params);
  assert.equal(result.status, 206); assert.equal(await result.text(), 'synthetic audio bytes');
  assert.equal(result.headers.get('content-range'), 'bytes 0-3/20');
  assert.match(result.headers.get('cache-control'), /no-store/);
  for (const call of h.calls.filter(call => call.path === '/rest/v1/rpc/admin_original_audio_object')) assert.deepEqual(call.body, { p_actor: ACTOR, p_session: SESSION, p_sound_id: OBJECT });
  assert.equal(h.calls.filter(call => call.path === '/rest/v1/rpc/admin_original_audio_object').length, 2);
  assert.deepEqual(h.unhandled, []);
});
audit('/api/music/[id]', 'guest and wrong role never reach object or Storage reads', async () => {
  for (const options of [{ signedIn: false }, { role: 'support_agent' }]) {
    const { h, route, params } = audioFixture(options);
    await assert.rejects(() => route.GET(h.request('/api/music/' + OBJECT), params), /REDIRECT|not available/);
    assert.equal(h.calls.some(call => call.path.includes('admin_original_audio_object') || call.path.startsWith('/storage/')), false);
  }
});
audit('/api/music/[id]', 'replacement and missing objects do not release stale bytes', async () => {
  for (const options of [{ changed: true }, { unbound: true }]) {
    const { h, route, params } = audioFixture(options), result = await route.GET(h.request('/api/music/' + OBJECT), params);
    assert.equal(result.status, 404); assert.doesNotMatch(await result.text(), /synthetic audio bytes/);
  }
});
audit('/api/music/[id]', 'invalid byte ranges stop before Storage', async () => {
  for (const range of ['bytes=20-10', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=-']) {
    const { h, route, params } = audioFixture();
    assert.equal((await route.GET(h.request('/api/music/' + OBJECT, { headers: { Range: range } }), params)).status, 416, range);
    assert.equal(h.calls.some(call => call.path.startsWith('/storage/')), false);
  }
});
audit('/api/music/[id]', 'Storage network failure settles as a private unavailable response', async () => {
  const { h, route, params } = audioFixture({ storageError: true });
  const result = await route.GET(h.request('/api/music/' + OBJECT), params);
  assert.equal(result.status, 503); assert.match(result.headers.get('cache-control'), /no-store/);
  assert.doesNotMatch(await result.text(), /synthetic storage outage|service-key/);
});
audit('/api/music/[id]', 'the actual 20-second header deadline aborts held transport and retains recovery headers', async () => {
  const { h, route, params } = audioFixture({ heldHeaders: true, fastDeadline: true });
  const result = await route.GET(h.request('/api/music/' + OBJECT), params);
  assert.deepEqual(h.timers, [20_000]);
  assert.equal(h.calls.find(call => call.path.startsWith('/storage/')).signal.aborted, true);
  assert.equal(result.status, 503); assert.match(result.headers.get('cache-control'), /no-store/);
});

const usagePath = '/rest/v1/rpc/admin_music_usage_report';
audit('/api/music/report', 'real permission boundary and bounded CSV report preserve safe fields', async () => {
  const h = harness({ respond: call => call.path === usagePath ? response({ metric: 'server_operations_not_plays_or_royalties', rows: [{ day: '2026-10-30', event_type: 'attachment', provider_id: 'platinum', provider_track_id: null, title: '=SUM(1,2)', use_kind: 'post', territory: 'US', operations: '3' }] }) : undefined });
  const result = await h.load('app/api/music/report/route.ts').GET(h.request('/api/music/report?start=2026-10-01&end=2026-11-01'));
  assert.equal(result.status, 200); assert.match(result.headers.get('content-disposition'), /attachment/);
  assert.match(await result.text(), /"'=SUM\(1,2\)"/);
  assert.deepEqual(h.calls.find(call => call.path === usagePath).body, { p_actor: ACTOR, p_session: SESSION, p_start: '2026-10-01T00:00:00.000Z', p_end: '2026-11-01T00:00:00.000Z' });
  assert.deepEqual(h.unhandled, []);
});
audit('/api/music/report', 'invalid date windows and denied roles cannot request reports', async () => {
  const h = harness(), route = h.load('app/api/music/report/route.ts');
  for (const suffix of ['', '?start=2026-02-30&end=2026-03-01', '?start=2026-10-01&end=2026-11-02']) assert.equal((await route.GET(h.request('/api/music/report' + suffix))).status, 400);
  assert.equal(h.calls.some(call => call.path === usagePath), false);
  const denied = harness({ role: 'analyst' });
  await assert.rejects(() => denied.load('app/api/music/report/route.ts').GET(denied.request('/api/music/report?start=2026-10-01&end=2026-10-02')), /not available/);
  assert.equal(denied.calls.some(call => call.path === usagePath), false);
});
audit('/api/music/report', 'missing or failed provider receipts never become successful downloads', async () => {
  for (const data of [null, {}, { metric: 'unrecognized', rows: [] }]) {
    const h = harness({ respond: call => call.path === usagePath ? response(data) : undefined });
    const result = await h.load('app/api/music/report/route.ts').GET(h.request('/api/music/report?start=2026-10-01&end=2026-10-02'));
    assert.equal(result.status, 503); assert.equal(result.headers.has('content-disposition'), false);
  }
});

audit('/reset-password/callback', 'actual PKCE exchange verifies recovery AMR, stores only the separate sealed grant and blocks replay', async () => {
  const h = harness({ signedIn: false, method: 'recovery' }); await h.startRecovery();
  const route = h.load('app/reset-password/callback/route.ts');
  const first = await route.GET(h.request('/reset-password/callback?code=synthetic-recovery-code'));
  assert.equal(first.status, 307); assert.equal(first.headers.get('location'), SITE + '/reset-password');
  assert.match(first.headers.get('cache-control'), /no-store/); assert.equal(first.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(h.stored.has('pc_admin_recovery'), true); assert.equal(h.stored.has('pc_admin_token'), false);
  assert.equal((await h.load('lib/adminRecovery.ts').recoveryView()).needsMfa, false);
  const second = await route.GET(h.request('/reset-password/callback?code=synthetic-recovery-code'));
  assert.equal(second.headers.get('location'), SITE + '/reset-password?error=link'); assert.equal(h.stored.has('pc_admin_recovery'), false);
  assert.deepEqual(h.unhandled, []);
});
audit('/reset-password/callback', 'ordinary login tokens cannot establish a recovery grant', async () => {
  const h = harness({ signedIn: false, method: 'password' }); await h.startRecovery();
  const result = await h.load('app/reset-password/callback/route.ts').GET(h.request('/reset-password/callback?code=synthetic-recovery-code&type=recovery'));
  assert.equal(result.headers.get('location'), SITE + '/reset-password?error=link');
  assert.equal(h.stored.has('pc_admin_recovery'), false); assert.equal(h.stored.has('pc_admin_token'), false);
});
audit('/reset-password/callback', 'untrusted callback origin and malformed links cannot exchange credentials', async () => {
  const untrusted = harness({ env: { ADMIN_AUTH_ORIGINS: 'https://different.invalid' } });
  assert.equal((await untrusted.load('app/reset-password/callback/route.ts').GET(untrusted.request('/reset-password/callback?code=synthetic-recovery-code'))).status, 400);
  assert.deepEqual(untrusted.calls, []);
  for (const suffix of ['', '?code=' + 'x'.repeat(2049), '?code=synthetic-recovery-code&error=private-provider-detail']) {
    const h = harness({ signedIn: false }), result = await h.load('app/reset-password/callback/route.ts').GET(h.request('/reset-password/callback' + suffix));
    assert.equal(result.headers.get('location'), SITE + '/reset-password?error=link'); assert.deepEqual(h.calls, []);
  }
});
audit('/reset-password/callback', 'exchange failure and revoked staff session have no success grant or leaked error', async () => {
  for (const options of [{ exchangeError: true }, { sessionActive: false }]) {
    const h = harness({ signedIn: false, method: 'recovery', ...options }); await h.startRecovery();
    const result = await h.load('app/reset-password/callback/route.ts').GET(h.request('/reset-password/callback?code=synthetic-recovery-code'));
    assert.equal(result.headers.get('location'), SITE + '/reset-password?error=link'); assert.equal(h.stored.has('pc_admin_recovery'), false);
  }
});

test.after(() => {
  if (!process.env.PLATINUM_ENDPOINT_AUDIT_OUTPUT) return;
  const sources = [...sourceFiles].sort().map(file => ({ path: 'admin-web/' + file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex') }));
  const output = process.env.PLATINUM_ENDPOINT_AUDIT_OUTPUT;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), source: process.env.GITHUB_SHA || 'local-working-tree', scope: 'Actual five route exports, real Auth/session/role/recovery code and installed SDK with synthetic provider transport and request-local cookie adapter. No live service, email, password reset or hosted Next claim.', results, sources }, null, 2) + '\n');
});
