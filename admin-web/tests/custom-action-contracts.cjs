const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { customActionHarness, form, response, ACTOR, SESSION, KEY, TARGET, FACTOR, PROVISION, ADMIN } = require('./helpers/customActionFixture.cjs');
const results = [], sources = new Set();
function harness(options) {
  const h = customActionHarness(options), load = h.load;
  h.load = file => { const value = load(file); h.loaded.forEach(name => sources.add(name)); return value; };
  return h;
}
function audit(actions, title, run) {
  test(actions.join(', ') + ': ' + title, async () => {
    const row = { actions, title, status: 'running' }; results.push(row);
    try { await run(row); row.status = 'passed'; } catch (error) { row.status = 'failed'; row.error = error.message; throw error; }
  });
}
async function redirect(work, expected) { await assert.rejects(work, error => error.redirect === expected); }
const command = (call, name) => call.path === '/rest/v1/rpc/' + name;
const mutationCalls = h => h.calls.filter(call => call.method !== 'GET' && !command(call, 'triniti_admin_session_check'));
const standardForm = () => form({ command_key: KEY, email: 'synthetic-new@example.invalid', password: 'synthetic initial passphrase', role: 'support_agent', id: TARGET });
const reviewForm = () => form({ command_key: KEY, report_id: TARGET, decision: 'hide', content_version: '4', reason: 'Synthetic moderation reason' });
const triageForm = () => form({ command_key: KEY, ticket_id: TARGET, version: '3', assigned_to: ACTOR, escalated: 'false', priority: 'normal', queue: 'general', reason: 'Synthetic assignment reason' });
const erasureForm = () => form({ command_key: KEY, source: 'self_service', request_id: TARGET, version: 'a'.repeat(32), action: 'note', note: 'Synthetic review note of enough length' });
const music = [
  ['saveMusicProvider', 'provider.save', () => form({ id: ' TEST-PROVIDER ', name: ' Test provider ', contact: ' contact ', notes: ' notes ', actor: 'forged' })],
  ['saveMusicLicenseDraft', 'license.draft', () => form({ providerId: 'test-provider', reference: ' Agreement ', licensor: ' Rights owner ', territories: ' us,gb, ', uses: ['post', 'story'], exportAllowed: 'on', startsAt: '2026-10-31', endsAt: '2026-11-30', evidence: ' synthetic evidence ' })],
  ['revokeMusicSound', 'sound.revoke', () => form({ soundId: TARGET, reason: ' Synthetic valid revocation ' })],
];
const manifest = { version: 1, tracks: [{ id: 'track-1', revision: 'v1', title: 'Synthetic track', artist: 'Synthetic artist', durationSec: 20, assetRef: 'asset-1' }] };
const stageForm = () => form({ requestId: KEY, providerId: 'test-provider', manifest: new File([JSON.stringify(manifest)], 'manifest.json', { type: 'application/json' }) });

audit(['signIn'], 'verified native session persists only secure session cookies and redirects to the dashboard', async () => {
  const h = harness({ signedIn: false });
  await redirect(() => h.load('lib/actions.ts').signIn(form({ email: 'synthetic-staff@example.invalid', password: 'synthetic-only-passphrase' })), '/dashboard');
  assert.equal(h.stored.get('pc_admin_token'), h.token); assert.equal(h.stored.get('pc_admin_refresh'), h.session.refresh_token);
  assert.ok(h.calls.some(call => command(call, 'triniti_admin_session_check')));
  for (const item of h.cookieWrites) { assert.equal(item.settings.httpOnly, true); assert.equal(item.settings.secure, true); assert.equal(item.settings.sameSite, 'lax'); }
  assert.deepEqual(h.unhandled, []);
});
audit(['signIn'], 'credential rejection and provider outage have distinct safe errors without persisting a login', async () => {
  for (const [status, expected] of [[400, 'credentials'], [503, 'unavailable']]) {
    const h = harness({ signedIn: false, respond: call => call.path === '/auth/v1/token' ? response({ code: 'synthetic_failure', msg: 'private provider detail' }, status) : undefined });
    await redirect(() => h.load('lib/actions.ts').signIn(form({ email: 'staff@example.invalid', password: 'synthetic' })), '/?error=' + expected);
    assert.equal(h.stored.size, 0); assert.equal(h.cookieWrites.length, 0);
  }
});
audit(['signIn'], 'inactive, revoked and unknown-role accounts are denied and the newly issued session is revoked', async () => {
  for (const options of [{ active: false }, { sessionActive: false }, { role: 'unknown' }]) {
    const h = harness({ signedIn: false, ...options });
    await redirect(() => h.load('lib/actions.ts').signIn(form({ email: 'staff@example.invalid', password: 'synthetic' })), '/?error=access');
    assert.equal(h.stored.size, 0); assert.equal(h.calls.filter(call => call.path === '/auth/v1/logout' && call.query.scope === 'local').length, 1);
  }
});
audit(['signOut'], 'confirmed or already-absent sessions clear cookies and return to sign-in', async () => {
  for (const status of [200, 401, 403, 404]) {
    const h = harness({ respond: call => call.path === '/auth/v1/logout' ? response(status === 200 ? {} : { msg: 'Already absent' }, status) : undefined });
    await redirect(() => h.load('lib/actions.ts').signOut(), '/');
    assert.equal(h.stored.size, 0); assert.equal(h.calls[0].query.scope, 'local');
  }
  const guest = harness({ signedIn: false }); await redirect(() => guest.load('lib/actions.ts').signOut(), '/'); assert.equal(guest.calls.length, 0);
});
audit(['signOut'], 'uncertain revocation does not claim a completed sign-out or silently discard its retry context', async () => {
  const h = harness({ respond: call => call.path === '/auth/v1/logout' ? response({ msg: 'Unavailable' }, 503) : undefined });
  await assert.rejects(() => h.load('lib/actions.ts').signOut(), /could not be confirmed/);
  assert.equal(h.stored.get('pc_admin_token'), h.token); assert.equal(h.stored.has('pc_admin_refresh'), true);
});

audit(['enrollAuthenticator'], 'existing verified authenticators cannot be replaced by enrollment', async () => {
  const h = harness({ factors: [{ id: FACTOR, factor_type: 'totp', status: 'verified', friendly_name: 'Existing device' }] });
  const result = await h.load('app/security/actions.ts').enrollAuthenticator();
  assert.equal(result.success, false); assert.match(result.error, /existing authenticator/);
  assert.equal(mutationCalls(h).length, 0);
});
audit(['enrollAuthenticator'], 'only this setup’s unverified factor is removed before creating one new factor', async () => {
  const old = TARGET;
  const h = harness({ factors: [{ id: old, factor_type: 'totp', status: 'unverified', friendly_name: 'TRINITI admin' }, { id: PROVISION, factor_type: 'totp', status: 'unverified', friendly_name: 'Other setup' }] });
  const result = await h.load('app/security/actions.ts').enrollAuthenticator();
  assert.equal(result.success, true); assert.equal(result.factorId, FACTOR);
  assert.deepEqual(mutationCalls(h).map(call => [call.method, call.path]), [['DELETE', '/auth/v1/factors/' + old], ['POST', '/auth/v1/factors']]);
  assert.equal(h.stored.get('pc_admin_token'), h.token);
});
audit(['enrollAuthenticator', 'verifyAuthenticator'], 'missing or revoked sessions cannot enroll or verify factors', async () => {
  for (const options of [{ signedIn: false }, { sessionActive: false }, { active: false }]) {
    const h = harness(options), actions = h.load('app/security/actions.ts');
    assert.equal((await actions.enrollAuthenticator()).success, false);
    assert.equal((await actions.verifyAuthenticator(FACTOR, '123456')).success, false);
    assert.equal(mutationCalls(h).length, 0);
  }
});
audit(['verifyAuthenticator'], 'six-digit validation and provider rejection never elevate session cookies', async () => {
  const invalid = harness(); assert.equal((await invalid.load('app/security/actions.ts').verifyAuthenticator(FACTOR, '123')).success, false); assert.equal(invalid.calls.length, 0);
  const denied = harness({ respond: call => call.path.endsWith('/verify') ? response({ code: 'mfa_verification_failed', msg: 'Synthetic rejection' }, 400) : undefined });
  assert.equal((await denied.load('app/security/actions.ts').verifyAuthenticator(FACTOR, '123456')).success, false);
  assert.equal(denied.stored.get('pc_admin_token'), denied.token); assert.equal(denied.cookieWrites.length, 0);
});
audit(['verifyAuthenticator'], 'actual SDK challenge and verify persist the returned elevated session', async () => {
  const h = harness(); assert.equal((await h.load('app/security/actions.ts').verifyAuthenticator(FACTOR, '123456')).success, true);
  const claims = JSON.parse(Buffer.from(h.stored.get('pc_admin_token').split('.')[1], 'base64url'));
  assert.equal(claims.aal, 'aal2'); assert.equal(claims.sub, ACTOR); assert.equal(claims.session_id, SESSION);
  assert.deepEqual(mutationCalls(h).map(call => call.path), ['/auth/v1/factors/' + FACTOR + '/challenge', '/auth/v1/factors/' + FACTOR + '/verify']);
});

for (const [action, kind, destination] of [['inviteStaff', 'staff', '/staff'], ['approveBusinessApplication', 'business', '/businesses']]) {
  audit([action], 'the actual wrapper preserves reservation identity and invalidates only its confirmed desk', async () => {
    const email = kind === 'staff' ? 'synthetic-new@example.invalid' : `business+${TARGET}@accounts.platinumcircles.invalid`;
    const h = harness({ respond: call => command(call, 'triniti_admin_provision') ? response({ success: true, command_key: KEY, complete: true, auth_user_id: TARGET, email, provision_id: PROVISION }) : undefined });
    assert.equal((await h.load('lib/actions.ts')[action](standardForm())).success, true);
    const request = h.calls.find(call => command(call, 'triniti_admin_provision'));
    assert.equal(request.body.p_actor_id, ACTOR); assert.equal(request.body.p_session_id, SESSION); assert.equal(request.body.p_kind, kind);
    assert.equal(request.body.p_payload.password, undefined); assert.deepEqual(h.revalidated, [[destination]]);
    assert.equal(h.calls.some(call => call.path.startsWith('/auth/v1/admin/users')), false);
  });
  audit([action], 'wrong role and failed reservation do not create an identity or refresh a success page', async () => {
    const denied = harness({ role: 'platform_admin' });
    await assert.rejects(() => denied.load('lib/actions.ts')[action](standardForm()), /not available/); assert.equal(mutationCalls(denied).length, 0);
    const failed = harness({ respond: call => command(call, 'triniti_admin_provision') ? response({ message: 'APPLICATION_NOT_PENDING' }, 400) : undefined });
    assert.equal((await failed.load('lib/actions.ts')[action](standardForm())).success, false); assert.deepEqual(failed.revalidated, []);
    assert.equal(failed.calls.some(call => call.path.startsWith('/auth/v1/admin/users')), false);
  });
}

for (const [name, operation, input] of music) {
  audit([name], 'verified actor/session and normalized payload reach the exact music command', async () => {
    const h = harness({ respond: call => command(call, 'admin_music_command') ? response({ ok: true, id: operation === 'provider.save' ? null : TARGET, catalogEnabled: false }) : undefined });
    await redirect(() => h.load('app/music/actions.ts')[name](input()), '/music?result=saved');
    const call = h.calls.find(call => command(call, 'admin_music_command'));
    assert.equal(call.body.p_actor, ACTOR); assert.equal(call.body.p_session, SESSION); assert.equal(call.body.p_action, operation);
    assert.equal(call.body.p_payload.actor, undefined); assert.deepEqual(h.revalidated, [['/music']]);
    if (operation === 'provider.save') assert.deepEqual(call.body.p_payload, { id: 'test-provider', name: 'Test provider', contact: 'contact', notes: 'notes' });
    if (operation === 'license.draft') { assert.deepEqual(call.body.p_payload.territories, ['US', 'GB']); assert.deepEqual(call.body.p_payload.uses, ['post', 'story']); assert.equal(call.body.p_payload.exportAllowed, true); }
    if (operation === 'sound.revoke') assert.deepEqual(call.body.p_payload, { soundId: TARGET, reason: 'Synthetic valid revocation' });
  });
  audit([name], 'missing or negative receipt cannot report a saved music change', async () => {
    for (const data of [null, {}, { ok: false }, { ok: true, catalogEnabled: true },
      { ok: true, id: operation === 'provider.save' ? TARGET : null, catalogEnabled: false },
      ...(operation === 'sound.revoke' ? [{ ok: true, id: KEY, catalogEnabled: false }] : [])]) {
      const h = harness({ respond: call => command(call, 'admin_music_command') ? response(data) : undefined });
      await redirect(() => h.load('app/music/actions.ts')[name](input()), '/music?result=failed');
      assert.deepEqual(h.revalidated, []);
    }
  });
}
audit(['stageMusicCatalogue'], 'actual staging action keeps request identity, counts and commercial licensing off', async () => {
  const h = harness({ respond: call => command(call, 'admin_stage_music_catalogue') ? response({ id: KEY, tracks: 1, added: 1, replayed: false, catalogEnabled: false }) : undefined });
  await redirect(() => h.load('app/music/actions.ts').stageMusicCatalogue(stageForm()), '/music?result=staged');
  const call = h.calls.find(call => command(call, 'admin_stage_music_catalogue'));
  assert.equal(call.body.p_actor, ACTOR); assert.equal(call.body.p_session, SESSION); assert.equal(call.body.p_request, KEY); assert.deepEqual(call.body.p_manifest, manifest);
});
audit(['stageMusicCatalogue'], 'a matching idempotent SQL replay without an added count remains a confirmed staging result', async () => {
  const h = harness({ respond: call => command(call, 'admin_stage_music_catalogue') ? response({ id: KEY, tracks: 1, replayed: true, catalogEnabled: false }) : undefined });
  await redirect(() => h.load('app/music/actions.ts').stageMusicCatalogue(stageForm()), '/music?result=staged');
  assert.deepEqual(h.revalidated, [['/music']]);
});
audit(['stageMusicCatalogue'], 'missing, wrong-request and impossible count receipts cannot claim catalogue staging', async () => {
  for (const data of [null, {}, { id: TARGET, tracks: 1, replayed: true, catalogEnabled: false }, { id: KEY, tracks: 8, replayed: false, added: 8, catalogEnabled: false },
    ...[-1, 0.5, 2, undefined].map(added => ({ id: KEY, tracks: 1, replayed: false, added, catalogEnabled: false })),
    { id: KEY, tracks: 1, replayed: true, added: 2, catalogEnabled: false }]) {
    const h = harness({ respond: call => command(call, 'admin_stage_music_catalogue') ? response(data) : undefined });
    await redirect(() => h.load('app/music/actions.ts').stageMusicCatalogue(stageForm()), '/music?result=catalogue-failed'); assert.deepEqual(h.revalidated, []);
  }
});

audit(['moderateReview'], 'valid moderation uses verified actor, session, version and retry key', async () => {
  const h = harness({ respond: call => command(call, 'moderate_seller_review') ? response({ success: true, command_key: KEY }) : undefined });
  assert.equal((await h.load('app/market/reviews/actions.ts').moderateReview(reviewForm())).success, true);
  const call = h.calls.find(call => command(call, 'moderate_seller_review'));
  assert.equal(call.body.p_actor_id, ACTOR); assert.equal(call.body.p_session_id, SESSION); assert.equal(call.body.p_expected_version, 4); assert.equal(call.body.p_key, KEY);
  assert.deepEqual(h.revalidated, [['/market/reviews'], ['/reports']]);
});
audit(['moderateReview'], 'unconfirmed or wrong-key moderation receipt cannot report an audited decision', async () => {
  for (const data of [null, {}, { success: false, command_key: KEY }, { success: true, command_key: TARGET }]) {
    const h = harness({ respond: call => command(call, 'moderate_seller_review') ? response(data) : undefined });
    assert.equal((await h.load('app/market/reviews/actions.ts').moderateReview(reviewForm())).success, false); assert.deepEqual(h.revalidated, []);
  }
});
audit(['moderateReview'], 'invalid decision, key, version or reason stops before the write boundary', async () => {
  for (const [field, value] of [['decision', 'erase'], ['command_key', 'bad-key'], ['content_version', '-1'], ['reason', 'x']]) {
    const h = harness(), fields = reviewForm(); fields.set(field, value);
    assert.equal((await h.load('app/market/reviews/actions.ts').moderateReview(fields)).success, false); assert.equal(mutationCalls(h).length, 0);
  }
});
audit(['updateSupportTriage'], 'exact confirmed assignment and failure variants preserve retry and version semantics', async () => {
  for (const [data, error, success] of [[{ success: true, command_key: KEY }, null, true], [{ success: true, command_key: TARGET }, null, false], [null, 'TRIAGE_CHANGED', false], [null, 'INVALID_ASSIGNEE', false]]) {
    const h = harness({ respond: call => command(call, 'admin_support_triage_update') ? response(error ? { message: error } : data, error ? 400 : 200) : undefined });
    const result = await h.load('lib/supportTriageActions.ts').updateSupportTriage(triageForm()); assert.equal(result.success, success);
    const call = h.calls.find(call => command(call, 'admin_support_triage_update'));
    assert.equal(call.body.p_actor_id, ACTOR); assert.equal(call.body.p_session_id, SESSION); assert.equal(call.body.p_version, 3); assert.equal(call.body.p_assigned_to, ACTOR);
    assert.equal(h.revalidated.length, success ? 2 : 0);
    if (error === 'TRIAGE_CHANGED') assert.match(result.error, /Another staff/);
  }
});
audit(['updateSupportTriage'], 'duplicate and malformed fields cannot reach assignment mutation', async () => {
  for (const variant of ['duplicate', 'version', 'owner']) {
    const h = harness(), fields = triageForm();
    if (variant === 'duplicate') fields.append('ticket_id', TARGET); else fields.set(variant === 'version' ? 'version' : 'assigned_to', 'invalid');
    await assert.rejects(() => h.load('lib/supportTriageActions.ts').updateSupportTriage(fields), /Invalid|Reload/); assert.equal(mutationCalls(h).length, 0);
  }
});
audit(['reviewCreator'], 'current disabled finance gate blocks direct calls without pretending reviews are live', async () => {
  for (const role of ['super_admin', 'platform_admin', 'finance_admin']) {
    const h = harness({ role }), result = await h.load('app/payments/creators/actions.ts').reviewCreator(null, form({ command_key: KEY, user_id: TARGET, status: 'approved', reason: 'Synthetic review' }));
    assert.match(result.error, /unavailable in this release/); assert.equal(mutationCalls(h).length, 0); assert.deepEqual(h.revalidated, []);
  }
  const denied = harness({ role: 'market_reviewer' }); await assert.rejects(() => denied.load('app/payments/creators/actions.ts').reviewCreator(null, new FormData()), /Finance permission/);
});

audit(['saveMusicProvider', 'saveMusicLicenseDraft', 'revokeMusicSound', 'stageMusicCatalogue', 'moderateReview', 'updateSupportTriage', 'reviewErasure'], 'actual Auth and permission policy stop every unauthorized role before a custom RPC', async row => {
  const roles = [...harness().load('lib/permissions.ts').STAFF_ROLES];
  const definitions = [
    ...music.map(([name, , input]) => ['app/music/actions.ts', name, 'post_moderate', input]),
    ['app/music/actions.ts', 'stageMusicCatalogue', 'post_moderate', stageForm],
    ['app/market/reviews/actions.ts', 'moderateReview', 'report_listing', reviewForm],
    ['lib/supportTriageActions.ts', 'updateSupportTriage', 'support', triageForm],
    ['app/users/deletions/actions.ts', 'reviewErasure', 'account_delete', erasureForm],
  ];
  let denied = 0;
  for (const [file, name, permission, input] of definitions) for (const role of roles) {
    const h = harness({ role }); if (h.load('lib/permissions.ts').canPerform(role, permission)) continue;
    await assert.rejects(() => h.load(file)[name](input()), /not available/); assert.equal(mutationCalls(h).length, 0); denied++;
  }
  row.roleDenials = denied; row.roles = roles.length;
});

test.after(() => {
  if (!process.env.PLATINUM_CUSTOM_ACTION_OUTPUT) return;
  const output = process.env.PLATINUM_CUSTOM_ACTION_OUTPUT;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'Actual exported actions, Auth/session/permissions and installed admin SDK with synthetic transport and cookie/cache/navigation adapters. No provider writes, email, credentials, passwords, licensing or finance activation.', results,
    sources: [...sources].sort().map(file => ({ path: path.relative(path.dirname(ADMIN), path.resolve(ADMIN, file)), sha256: crypto.createHash('sha256').update(fs.readFileSync(path.resolve(ADMIN, file))).digest('hex') })) }, null, 2) + '\n');
});
