// Ordinary disposable-account request and receipt polling. The verified scoped
// cron/Edge worker owns every erasure mutation after request submission.
// This harness never reads a worker secret, calls a generic claim, invokes the
// worker HTTP endpoint, or deletes Auth to disguise an incomplete worker run.
import {pathToFileURL} from 'node:url';
import {storageFailureIsDenied} from './completion-qa-auth-acceptance.mjs';
import {
  QA_ORIGIN, UUID, check, data, exactKeys, sha256, createIdentity, verifyIdentity,
  verifyProfileAbsent, authLookupProvesAbsent, runGuarded, readCliInputs, sanitizedFailure,
} from './completion-qa-fixtures.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=', 'base64');
const POLL_MS = 5000, DEADLINE_MS = 600000, SIGNED_URL_SECONDS = 1800;
export function assertErasureStatus(value, requestId, {previous} = {}) {
  check(exactKeys(value, ['requestId', 'state', 'reason', 'requestedAt', 'updatedAt', 'completedAt', 'filesTotal', 'filesErased'])
    && value.requestId === requestId && ['queued', 'erasing', 'identity_pending', 'completed', 'retention_review'].includes(value.state)
    && (value.reason === null || typeof value.reason === 'string' && /^[a-z_]{1,80}$/.test(value.reason))
    && typeof value.requestedAt === 'string' && Number.isFinite(Date.parse(value.requestedAt))
    && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
    && (value.completedAt === null || typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt)))
    && Number.isInteger(value.filesTotal) && value.filesTotal === 1
    && Number.isInteger(value.filesErased) && value.filesErased >= 0 && value.filesErased <= 1,
    'QA_ERASURE_RECEIPT_INVALID');
  check(Date.parse(value.updatedAt) >= Date.parse(value.requestedAt), 'QA_ERASURE_RECEIPT_TIME_INVALID');
  if (previous) check(value.requestedAt === previous.requestedAt && value.filesErased >= previous.filesErased
    && Date.parse(value.updatedAt) >= Date.parse(previous.updatedAt), 'QA_ERASURE_RECEIPT_REGRESSED');
  if (value.state === 'completed') check(value.reason === null && value.filesErased === 1 && value.completedAt !== null
    && Date.parse(value.completedAt) - Date.parse(value.requestedAt) >= 65000, 'QA_ERASURE_COMPLETION_BEFORE_CACHE_BOUND');
  else check(value.completedAt === null, 'QA_ERASURE_PREMATURE_COMPLETION_TIMESTAMP');
}

export function refreshDenialIsConfirmed(result) {
  return !!result?.error && [400, 401, 403].includes(result.error.status)
    && ['refresh_token_not_found', 'session_not_found', 'user_banned', 'user_not_found'].includes(result.error.code)
    && !result.data?.session && !result.data?.user;
}

export function validatePrivateSignedUrl(value, path) {
  let url; try { url = new URL(value); } catch { check(false, 'QA_CDN_URL_INVALID'); }
  check(url.origin === QA_ORIGIN && url.pathname === `/storage/v1/object/sign/post-media/${path}`
    && [...url.searchParams.keys()].length === 1 && typeof url.searchParams.get('token') === 'string'
    && url.searchParams.get('token').length > 20, 'QA_CDN_URL_SCOPE_MISMATCH');
  return url;
}

async function storageAbsence(ctx, owner, path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const result = await ctx.admin.storage.from('post-media').list(owner.id, {search: name, limit: 2});
  check(!result.error && Array.isArray(result.data), 'QA_ERASURE_STORAGE_LIST_FAILED');
  check(result.data.every(row => row.name !== name), 'QA_ERASURE_STORAGE_OBJECT_REMAINS');
  const download = await ctx.admin.storage.from('post-media').download(path);
  check(download.error && [400, 404].includes(download.error.status)
    && ['404', 'NoSuchKey', 'not_found'].includes(String(download.error.statusCode ?? download.error.code ?? ''))
    && !download.data, 'QA_ERASURE_STORAGE_ABSENCE_UNCONFIRMED');
}

export async function observeErasure(ctx, {owner, requestId, receiptToken, first, path, signedUrl, signedAt,
  storageCleanup, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const started = ctx.now(); let previous = first, sawAuthSurviveFiles = false, completed;
  ctx.receipt.erasureObservations = [];
  for (let poll = 0; poll < 125 && ctx.now() - started <= DEADLINE_MS; poll++) {
    const value = data(await ctx.anon.rpc('account_erasure_status', {p_request_id: requestId, p_receipt_token: receiptToken}), 'QA_ERASURE_STATUS_FAILED');
    assertErasureStatus(value, requestId, {previous}); previous = value;
    ctx.receipt.erasureObservations.push({observedAt: new Date(ctx.now()).toISOString(), value: structuredClone(value)});
    check(value.state !== 'retention_review', 'QA_ERASURE_ENTERED_RETENTION_REVIEW');
    if (value.filesErased === 1 && value.state !== 'completed' && !sawAuthSurviveFiles) {
      await storageAbsence(ctx, owner, path);
      await verifyIdentity(ctx, owner.id);
      sawAuthSurviveFiles = true;
      ctx.check('auth_identity_survived_actual_file_removal_before_completion');
    }
    if (value.state === 'completed') { completed = value; break; }
    await wait(POLL_MS);
  }
  check(completed, 'QA_ERASURE_WORKER_DEADLINE_EXCEEDED');
  // Confirm actual provider state, independently of a database "completed" flag.
  await storageAbsence(ctx, owner, path);
  check(authLookupProvesAbsent(await ctx.admin.auth.admin.getUserById(owner.id)), 'QA_ERASURE_AUTH_STILL_PRESENT');
  await verifyProfileAbsent(ctx, owner.id);
  // These facts allow ordinary final cleanup to verify already-absent records.
  // No Auth/Storage delete fallback is performed by this process.
  ctx.workerOwned.delete(owner.id);
  ctx.cleanupActions = ctx.cleanupActions.filter(action => action !== storageCleanup);
  ctx.receipt.cleanup.push({kind: 'storage_by_erasure_worker', ownerId: owner.id, passed: true, absenceVerified: true});
  ctx.check('worker_completed_actual_storage_auth_and_profile_erasure');
  check(sawAuthSurviveFiles, 'QA_ERASURE_FILE_BEFORE_IDENTITY_ORDER_NOT_OBSERVED');
  check(ctx.now() - signedAt < SIGNED_URL_SECONDS * 1000 - 60000, 'QA_CDN_TOKEN_NEAR_EXPIRY');
  const response = await ctx.fetch(signedUrl, {method: 'GET'});
  const body = await response.json().catch(() => null);
  check([400, 404].includes(response.status) && ['404', 'NoSuchKey', 'not_found'].includes(String(body?.statusCode ?? body?.code ?? '')),
    'QA_WARM_CDN_OBJECT_ABSENCE_UNCONFIRMED');
  ctx.check('previously_warmed_signed_object_denied_before_token_expiry', {status: response.status,
    scope: 'The same signed URL and build location that successfully read the synthetic bytes; no worldwide CDN claim.'});
  ctx.recordRpc('account_erasure_status:completed', completed);
  return completed;
}

export async function exerciseErasure(ctx, {wait} = {}) {
  const owner = await createIdentity(ctx, 'owner');
  const path = `${owner.id}/completion-${ctx.run}.png`, bucket = 'post-media';
  const requestId = ctx.uuid(); check(UUID.test(requestId), 'QA_ERASURE_REQUEST_ID_INVALID');
  const receiptToken = ctx.random(32).toString('hex'); check(/^[a-f0-9]{64}$/.test(receiptToken), 'QA_ERASURE_RECEIPT_TOKEN_INVALID');
  ctx.receipt.fixture = {ownerId: owner.id, requestId, bucket, objectPath: path, contentSha256: sha256(PNG), bytes: PNG.length};
  const storageCleanup = {kind: 'storage', id: owner.id, run: async () => {
    check(!ctx.workerOwned.has(owner.id), 'QA_ERASURE_WORKER_OWNS_FILES');
    await verifyIdentity(ctx, owner.id);
    const removed = await ctx.admin.storage.from(bucket).remove([path]);
    check(!removed.error, 'QA_FIXTURE_STORAGE_CLEANUP_FAILED');
    await storageAbsence(ctx, owner, path);
  }};
  ctx.cleanupActions.push(storageCleanup);
  ctx.stage = 'erasure_private_upload';
  const uploaded = await owner.member.storage.from(bucket).upload(path, PNG, {contentType: 'image/png', cacheControl: '60', upsert: false});
  check(!uploaded.error && uploaded.data?.path === path, 'QA_ERASURE_UPLOAD_ACK_MISMATCH');
  const publicUrl = `${QA_ORIGIN}/storage/v1/object/public/${bucket}/${path}`;
  const publicResponse = await ctx.fetch(publicUrl), publicError = await publicResponse.json().catch(() => null);
  check(storageFailureIsDenied({status: publicResponse.status, statusCode: publicError?.statusCode ?? publicError?.code}), 'QA_ERASURE_OBJECT_PUBLIC');
  const signing = await ctx.fetch(`${QA_ORIGIN}/functions/v1/content-media-sign`, {method: 'POST',
    headers: {apikey: ctx.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({uploads: [publicUrl], delivery: 'no-store'})});
  const deliveryResult = await signing.json();
  check(signing.status === 200 && Array.isArray(deliveryResult.urls) && deliveryResult.urls.length === 1, 'QA_ERASURE_DELIVERY_ISSUANCE_FAILED');
  let delivery; try { delivery = new URL(deliveryResult.urls[0].url); } catch { check(false, 'QA_ERASURE_DELIVERY_URL_INVALID'); }
  check(delivery.origin === QA_ORIGIN && delivery.pathname === `/functions/v1/media-content/${bucket}/${path}`
    && [...delivery.searchParams.keys()].length === 1 && /^[a-f0-9]{64}$/.test(delivery.searchParams.get('token') || ''), 'QA_ERASURE_DELIVERY_SCOPE_MISMATCH');
  const noStore = await ctx.fetch(delivery, {cache: 'no-store'});
  check(noStore.status === 200 && noStore.headers.get('Cache-Control')?.includes('no-store')
    && sha256(Buffer.from(await noStore.arrayBuffer())) === sha256(PNG), 'QA_ERASURE_DELIVERY_BYTES_MISMATCH');
  const signed = await owner.member.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS);
  check(!signed.error && typeof signed.data?.signedUrl === 'string', 'QA_ERASURE_CDN_SIGNING_FAILED');
  const signedUrl = validatePrivateSignedUrl(signed.data.signedUrl, path), signedAt = ctx.now();
  const warm = await ctx.fetch(signedUrl);
  check(warm.status === 200 && /(?:^|[,\s])max-age=60(?:\s|,|$)/.test(warm.headers.get('Cache-Control') || '')
    && sha256(Buffer.from(await warm.arrayBuffer())) === sha256(PNG), 'QA_ERASURE_CDN_WARM_BYTES_OR_CACHE_MISMATCH');
  ctx.check('synthetic_private_storage_and_delivery_bytes_verified', {contentSha256: sha256(PNG), cacheSeconds: 60,
    signedTokenSeconds: SIGNED_URL_SECONDS});

  ctx.stage = 'ordinary_erasure_request';
  const staleClient = ctx.make(ctx.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, owner.token);
  const args = {p_request_id: requestId, p_receipt_token: receiptToken};
  // From the instant submission starts, an ambiguous response can already own a
  // durable erasure job. Only the verified worker may finish the fixture.
  ctx.workerOwned.add(owner.id);
  const first = data(await owner.member.rpc('request_account_erasure', args), 'QA_ERASURE_REQUEST_FAILED');
  assertErasureStatus(first, requestId);
  check(first.state !== 'retention_review' && first.state !== 'completed', 'QA_ERASURE_REQUEST_NOT_QUEUED');
  ctx.recordRpc('request_account_erasure:first', first);
  ctx.check('ordinary_account_erasure_request_acknowledged');

  const observe = observeErasure(ctx, {owner, requestId, receiptToken, first, path, signedUrl, signedAt, storageCleanup, ...(wait ? {wait} : {})});
  const revoked = (async () => {
    const replay = data(await staleClient.rpc('request_account_erasure', args), 'QA_ERASURE_ACK_RECOVERY_FAILED');
    assertErasureStatus(replay, requestId, {previous: first});
    check(replay.requestedAt === first.requestedAt && replay.filesTotal === first.filesTotal, 'QA_ERASURE_REPLAY_CREATED_NEW_REQUEST');
    ctx.recordRpc('request_account_erasure:replay', replay);
    const wrong = await ctx.anon.rpc('account_erasure_status', {...args, p_receipt_token: '0'.repeat(64) === receiptToken ? '1'.repeat(64) : '0'.repeat(64)});
    check(data(wrong, 'QA_ERASURE_WRONG_RECEIPT_READ_FAILED') === null, 'QA_ERASURE_WRONG_RECEIPT_DISCLOSED_STATUS');
    ctx.check('lost_acknowledgment_recovery_and_receipt_only_status_privacy');
    const oldDelivery = await ctx.fetch(delivery, {cache: 'no-store'});
    check([401, 403, 410].includes(oldDelivery.status), 'QA_ERASURE_OLD_DELIVERY_STILL_AUTHORIZED'); await oldDelivery.body?.cancel();
    const issue = await staleClient.rpc('issue_content_media_delivery', {p_references: null, p_uploads: [publicUrl]});
    check(issue.data === null && [401, 403].includes(issue.status) && ['42501', 'PGRST301'].includes(issue.error?.code), 'QA_ERASURE_STALE_DELIVERY_ISSUANCE_ALLOWED');
    const refreshed = await owner.member.auth.refreshSession({refresh_token: owner.refreshToken});
    check(refreshDenialIsConfirmed(refreshed), 'QA_ERASURE_REFRESH_REVOCATION_UNCONFIRMED');
    ctx.check('erasure_revoked_existing_delivery_new_issuance_and_refresh');
  })();
  // Even a revocation assertion failure does not abandon an accepted worker job.
  // Continue its one bounded observation window, then report both outcomes.
  const results = await Promise.allSettled([revoked, observe]);
  ctx.receipt.subflows = results.map((result, index) => ({name: index === 0 ? 'receipt_and_revocation' : 'actual_worker_erasure',
    passed: result.status === 'fulfilled', ...(result.status === 'rejected' ? {failure: sanitizedFailure(result.reason, 'erasure_subflow')} : {})}));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  ctx.receipt.recoveryScope = 'An exact lost-acknowledgment replay and cron progression through real file deletion/cache wait were observed. No crash, network outage, or provider failure was injected.';
}

export function runErasureAcceptance(options) {
  return runGuarded({...options, suite: 'erasure', execute: ctx => exerciseErasure(ctx, {wait: options?.wait})});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let receipt;
  try {
    const input = await readCliInputs(process.argv);
    const {createClient} = await import('@supabase/supabase-js');
    receipt = await runErasureAcceptance({...input, clientFactory: createClient});
  } catch (error) { receipt = {schemaVersion: 1, mutationStarted: false, allChecksPassed: false, failure: sanitizedFailure(error, 'preflight')}; }
  console.log('PLATINUM_QA_ERASURE_RECEIPT=' + JSON.stringify(receipt));
  if (!receipt.allChecksPassed) process.exitCode = 1;
}
