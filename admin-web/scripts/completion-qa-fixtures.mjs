// Explicit protected QA build utilities. Never imported by a product entry point.
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, sep} from 'node:path';
import {
  QA_ORIGIN, assertPreviewEnvironment, fixtureBelongsToRun,
  sanitizedFailure, authLookupProvesAbsent,
} from './completion-qa-auth-acceptance.mjs';

export {QA_ORIGIN, sanitizedFailure, authLookupProvesAbsent};
export const PROJECT_REF = 'uaulhuelcfkjwojtymmw';
export const VERCEL_PROJECT = 'prj_TyzK69ngezfB1zyrfIrXt9keIPNs';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function fail(code) { throw Object.assign(new Error(code), {code}); }
export function check(condition, code) { if (!condition) fail(code); }
export function data(result, code) {
  if (!result || result.error) throw Object.assign(new Error(code), {code, status: result?.error?.status ?? result?.status});
  check(Number.isInteger(result.status) && result.status >= 200 && result.status < 300, code);
  return result.data;
}
// Exact server errors, never transport failures, count as expected denials.
export function isRpcDenial(result, code, message) {
  return !!result?.error && result.data === null && Number.isInteger(result.status)
    && result.status >= 400 && result.status < 500
    && result.error.code === code && result.error.message === message;
}
export function voidRpc(result, code) {
  check(data(result, code) === null && [200, 204].includes(result.status), code);
}
export function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
export function safeEvidencePath(path) {
  return typeof path === 'string' && /^docs\/quality\/completion-20261101\/[A-Za-z0-9_./-]+\.(json|sql|md)$/.test(path)
    && !path.split('/').some(part => !part || part === '.' || part === '..');
}

const COMMON_GATES = ['protectedPreviewVerified', 'ordinaryAuthHooksReviewed', 'isolatedQaFixtureWindow', 'noOutboundProviderDispatch'];
const SUITE_GATES = {
  offers: ['offerSerializationInstalled', 'listingAndMessageTriggersReviewed', 'marketAlertsEmpty'],
  support: ['atomicMemberSupportInstalled', 'supportTriggersReviewed'],
  erasure: ['accountErasureInstalled', 'scopedOneUseErasureDispatchInstalled', 'erasureCronActive',
    'erasureWorkerHeartbeatFresh', 'legacyReusableErasureDispatchDisabled', 'privateMediaDeliveryInstalled'],
};

// This binding is prepared from actual installed observations by the coordinator.
// It is deliberately absent from the source package until those gates pass.
// A template, stale observation, or unrelated file cannot authorize fixtures.
export async function verifyContract({contractBytes, contractSha256, suite, now = Date.now(), read = readFile}) {
  check(HASH.test(contractSha256 || '') && sha256(contractBytes) === contractSha256, 'QA_CONTRACT_DIGEST_MISMATCH');
  let contract;
  try { contract = JSON.parse(Buffer.from(contractBytes).toString('utf8')); } catch { fail('QA_CONTRACT_INVALID'); }
  check(contract.schemaVersion === 1 && contract.projectRef === PROJECT_REF && contract.suite === suite
    && contract.vercelProjectId === VERCEL_PROJECT && contract.accepted === true && SUITE_GATES[suite], 'QA_CONTRACT_TARGET_MISMATCH');
  const observedAt = Date.parse(contract.observedAt);
  check(Number.isFinite(observedAt) && Number.isFinite(now) && observedAt <= now + 60000 && now - observedAt <= 30 * 60000,
    'QA_CONTRACT_STALE');
  const required = [...COMMON_GATES, ...SUITE_GATES[suite]];
  check(exactKeys(contract.gates, required) && required.every(key => contract.gates[key] === true), 'QA_CONTRACT_GATE_NOT_PASSED');
  check(Array.isArray(contract.evidence) && contract.evidence.length >= 2 && contract.evidence.length <= 20,
    'QA_CONTRACT_EVIDENCE_REQUIRED');
  const paths = new Set();
  for (const entry of contract.evidence) {
    check(exactKeys(entry, ['path', 'sha256']) && safeEvidencePath(entry.path) && HASH.test(entry.sha256)
      && !paths.has(entry.path), 'QA_CONTRACT_EVIDENCE_INVALID');
    paths.add(entry.path);
    const path = resolve(ROOT, entry.path);
    check(path.startsWith(ROOT + sep) && sha256(await read(path)) === entry.sha256, 'QA_CONTRACT_EVIDENCE_DRIFT');
  }
  check(Array.isArray(contract.functionIdentities) && contract.functionIdentities.length > 0
    && contract.functionIdentities.every(row => exactKeys(row, ['identity', 'definitionSha256', 'aclSha256'])
      && typeof row.identity === 'string' && /^(public|support_private|account_erasure)\.[a-z_]+\([a-z, ]*\)$/.test(row.identity)
      && HASH.test(row.definitionSha256) && HASH.test(row.aclSha256)), 'QA_CONTRACT_FUNCTION_PROOF_REQUIRED');
  const identities = contract.functionIdentities.map(row => row.identity);
  check(new Set(identities).size === identities.length, 'QA_CONTRACT_DUPLICATE_FUNCTION');
  const requiredFunctions = {
    offers: ['public.offer_response_capabilities()', 'public.make_offer(uuid,numeric)', 'public.respond_offer(uuid,text,numeric)'],
    support: ['public.send_member_support_reply(uuid,uuid,uuid,text)', 'support_private.reopen_member_ticket()'],
    erasure: ['public.request_account_erasure(uuid,text)', 'public.account_erasure_status(uuid,text)', 'public.claim_account_erasure_run(text,uuid)'],
  }[suite];
  check(requiredFunctions.every(identity => identities.includes(identity)), 'QA_CONTRACT_REQUIRED_FUNCTION_MISSING');
  return {sha256: contractSha256, observedAt: contract.observedAt, gates: required, evidence: contract.evidence,
    functionIdentities: contract.functionIdentities};
}

export function createQaContext({env, expectedSource, suite, contract, clientFactory, fetcher = fetch,
  uuid = randomUUID, random = randomBytes, now = Date.now}) {
  const target = assertPreviewEnvironment(env, expectedSource);
  check(env.VERCEL_PROJECT_ID === VERCEL_PROJECT, 'QA_EXACT_VERCEL_PROJECT_REQUIRED');
  check(SUITE_GATES[suite] && contract?.sha256 && contract.gates.every(value => typeof value === 'string'), 'QA_VERIFIED_CONTRACT_REQUIRED');
  check(typeof clientFactory === 'function', 'QA_CLIENT_FACTORY_REQUIRED');
  const run = uuid(); check(UUID.test(run), 'QA_RUN_ID_INVALID');
  const receipt = {schemaVersion: 1, suite, run, projectRef: PROJECT_REF, sourceCommit: target.source,
    branch: target.branch, contract, startedAt: new Date(now()).toISOString(), mutationStarted: false,
    identities: [], checks: [], rpcReceipts: [], cleanup: [], allChecksPassed: false,
    scope: 'Marked disposable QA identities and synthetic content only. No real money, email, external provider notification, or production acceptance.'};
  const ctx = {env, run, receipt, uuid, random, now, created: [], identities: {}, resources: [],
    stage: 'client_setup', workerOwned: new Set(), cleanupActions: [], cleanupBlocked: false};
  ctx.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    check(url.origin === QA_ORIGIN && /^\/(auth|rest|storage|functions)\/v1\//.test(url.pathname), 'QA_REQUEST_SCOPE_VIOLATION');
    return fetcher(input, {...init, redirect: 'error', signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)});
  };
  ctx.make = (key, token) => clientFactory(QA_ORIGIN, key, {auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  }, global: {fetch: ctx.fetch, ...(token ? {headers: {Authorization: `Bearer ${token}`}} : {})}});
  ctx.admin = ctx.make(env.SUPABASE_SERVICE_ROLE_KEY);
  ctx.anon = ctx.make(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  ctx.check = (name, detail = {}) => receipt.checks.push({name, passed: true, ...detail});
  ctx.recordRpc = (name, value) => receipt.rpcReceipts.push({name, value: structuredClone(value)});
  return ctx;
}

export async function createIdentity(ctx, label) {
  check(/^[a-z]{1,12}$/.test(label) && !ctx.identities[label], 'QA_FIXTURE_LABEL_INVALID');
  const id = ctx.uuid(); check(UUID.test(id) && !ctx.created.some(row => row.id === id), 'QA_FIXTURE_ID_INVALID');
  const email = `completion-${ctx.run}-${label}@example.invalid`;
  const password = ctx.random(36).toString('base64url') + 'aA1!';
  ctx.created.push({id, label}); // retained before the call, including a lost response
  ctx.receipt.identities.push({id, label});
  ctx.receipt.mutationStarted = true;
  ctx.stage = `create_${label}`;
  const created = await ctx.admin.auth.admin.createUser({id, email, password, email_confirm: true,
    app_metadata: {completion_qa_fixture: true, completion_qa_run: ctx.run},
    user_metadata: {full_name: 'Completion QA fixture'}});
  check(!created.error && fixtureBelongsToRun(created.data?.user, ctx.run, id), 'QA_CREATED_IDENTITY_MISMATCH');
  const member = ctx.make(ctx.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  ctx.stage = `signin_${label}`;
  const signed = await member.auth.signInWithPassword({email, password});
  check(!signed.error && signed.data?.user?.id === id && signed.data.user.is_anonymous === false
    && typeof signed.data.session?.access_token === 'string' && signed.data.session.access_token.length > 20
    && typeof signed.data.session?.refresh_token === 'string', 'QA_ORDINARY_SESSION_MISMATCH');
  const profile = data(await member.from('profiles').select('id,account_type,deactivated_at,push_token').eq('id', id).single(),
    'QA_PROFILE_READ_FAILED');
  check(profile?.id === id && profile.account_type === 'personal' && profile.deactivated_at === null && profile.push_token === null,
    'QA_PROFILE_IS_NOT_ORDINARY');
  const identity = {id, label, member, token: signed.data.session.access_token, refreshToken: signed.data.session.refresh_token};
  ctx.identities[label] = identity;
  ctx.check(`${label}_ordinary_identity_and_session`);
  return identity;
}

export async function verifyIdentity(ctx, id) {
  check(ctx.created.some(row => row.id === id), 'QA_UNKNOWN_FIXTURE_ID');
  const lookup = await ctx.admin.auth.admin.getUserById(id);
  check(!lookup.error && fixtureBelongsToRun(lookup.data?.user, ctx.run, id), 'QA_FIXTURE_CLEANUP_SCOPE_MISMATCH');
  return lookup.data.user;
}

export async function verifyProfileAbsent(ctx, id) {
  check(data(await ctx.admin.from('profiles').select('id').eq('id', id).maybeSingle(), 'QA_PROFILE_ABSENCE_READ_FAILED') === null,
    'QA_FIXTURE_PROFILE_STILL_PRESENT');
}

export async function cleanupFixtures(ctx) {
  // Every app-data cleanup action revalidates its exact owner and content marker.
  // Any uncertainty preserves the fixture accounts for controlled recovery.
  for (const action of [...ctx.cleanupActions].reverse()) {
    try {
      await action.run();
      ctx.receipt.cleanup.push({kind: action.kind, id: action.id, passed: true});
    } catch (error) {
      ctx.cleanupBlocked = true;
      ctx.receipt.cleanup.push({kind: action.kind, id: action.id, passed: false, ...sanitizedFailure(error, 'cleanup_data')});
    }
  }
  for (const fixture of [...ctx.created].reverse()) {
    if (ctx.workerOwned.has(fixture.id)) {
      ctx.receipt.cleanup.push({kind: 'auth', id: fixture.id, label: fixture.label, passed: false,
        workerOwnsErasure: true, code: 'QA_ERASURE_WORKER_RECOVERY_REQUIRED'});
      continue; // Never turn an unaccepted worker journey into admin deletion.
    }
    try {
      check(!ctx.cleanupBlocked, 'QA_FIXTURE_DATA_ABSENCE_UNCONFIRMED');
      const lookup = await ctx.admin.auth.admin.getUserById(fixture.id);
      if (authLookupProvesAbsent(lookup)) {
        await verifyProfileAbsent(ctx, fixture.id);
        ctx.receipt.cleanup.push({kind: 'auth', id: fixture.id, label: fixture.label, passed: true, alreadyAbsent: true});
        continue;
      }
      check(!lookup.error && fixtureBelongsToRun(lookup.data?.user, ctx.run, fixture.id), 'QA_FIXTURE_CLEANUP_SCOPE_MISMATCH');
      const removed = await ctx.admin.auth.admin.deleteUser(fixture.id);
      check(!removed.error, 'QA_FIXTURE_AUTH_DELETE_FAILED');
      check(authLookupProvesAbsent(await ctx.admin.auth.admin.getUserById(fixture.id)), 'QA_FIXTURE_AUTH_ABSENCE_UNCONFIRMED');
      await verifyProfileAbsent(ctx, fixture.id);
      ctx.receipt.cleanup.push({kind: 'auth', id: fixture.id, label: fixture.label, passed: true});
    } catch (error) {
      ctx.receipt.cleanup.push({kind: 'auth', id: fixture.id, label: fixture.label, passed: false, ...sanitizedFailure(error, 'cleanup_auth')});
    }
  }
}

export async function runGuarded({suite, env = process.env, expectedSource, contractBytes, contractSha256,
  clientFactory, fetcher, now = Date.now, readEvidence, execute, uuid, random}) {
  let ctx;
  try {
    assertPreviewEnvironment(env, expectedSource);
    const contract = await verifyContract({contractBytes, contractSha256, suite, now: now(), ...(readEvidence ? {read: readEvidence} : {})});
    ctx = createQaContext({suite, env, expectedSource, contract, clientFactory, fetcher, now, uuid, random});
    ctx.receipt.sourceFiles = [];
    for (const name of ['completion-qa-auth-acceptance.mjs', 'completion-qa-fixtures.mjs',
      suite === 'erasure' ? 'completion-qa-erasure-acceptance.mjs' : 'completion-qa-interactions-acceptance.mjs']) {
      const digest = sha256(await readFile(new URL(name, import.meta.url)));
      if (name === 'completion-qa-auth-acceptance.mjs') check(digest === '645c869d6a78f9c30008b9138e0e7705b446168008fd68630dad425a4b59f3ac', 'QA_PHASE_ONE_SOURCE_DRIFT');
      ctx.receipt.sourceFiles.push({path: `admin-web/scripts/${name}`, sha256: digest});
    }
    await execute(ctx);
  } catch (error) {
    if (!ctx) return {schemaVersion: 1, suite, allChecksPassed: false, mutationStarted: false,
      failure: sanitizedFailure(error, 'preflight')};
    ctx.receipt.failure = sanitizedFailure(error, ctx.stage);
  } finally {
    if (ctx) await cleanupFixtures(ctx);
  }
  ctx.receipt.completedAt = new Date(now()).toISOString();
  ctx.receipt.allChecksPassed = !ctx.receipt.failure && ctx.receipt.cleanup.length >= ctx.created.length
    && ctx.receipt.cleanup.every(row => row.passed === true) && ctx.receipt.checks.length > 0;
  return ctx.receipt;
}

export async function readCliInputs(argv, env = process.env) {
  const value = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const expectedSource = value('--expected-source'), contractPath = value('--contract'), contractSha256 = value('--contract-sha256');
  assertPreviewEnvironment(env, expectedSource);
  check(safeEvidencePath(contractPath), 'QA_CONTRACT_PATH_INVALID');
  return {expectedSource, contractSha256, contractBytes: await readFile(resolve(ROOT, contractPath))};
}
