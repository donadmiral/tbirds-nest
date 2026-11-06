import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const origin = 'https://abcdefghijklmnopqrst.supabase.co';
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0];
async function as(role, sql, args = [], claimRole = role) {
  await db.exec('savepoint request');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: claimRole })]);
    const result = await scalar(sql, args);
    await db.exec('reset role; release savepoint request'); return result;
  } catch (error) { await db.exec('rollback to savepoint request; release savepoint request'); throw error; }
}
async function enqueue(action = 'register_webhook', reason = 'Approved provider acceptance operation') {
  let result;
  await db.exec('savepoint enqueue');
  try {
    result = await scalar('select live_streams.enqueue_provider_operation($1,$2)', [action, reason]);
    await db.exec('release savepoint enqueue');
  } catch (error) { await db.exec('rollback to savepoint enqueue; release savepoint enqueue'); throw error; }
  if (!result) return null;
  const queued = await scalar('select to_jsonb(q) from net.http_request_queue q where id=$1', [result.request_id]);
  return { result, queued, token: queued.headers.Authorization.slice(7) };
}
const claim = token => as('service_role', 'select public.claim_live_provider_operation_v1($1,$2)', [token, origin]);
const finish = (token, ok, receipt) => as('service_role', 'select public.finish_live_provider_operation_v1($1,$2,$3)', [token, ok, JSON.stringify(receipt)]);
const success = () => ({ code: 'WEBHOOK_REGISTERED', mutation_attempted: true, resource_id: randomUUID(), configuration_matches: true });

before(async () => {
  // Exact worker-origin shape and roles used by the deployed control plane;
  // pg_net is a transaction-local capture stub, never an HTTP connection.
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema live_streams; create schema net; create schema extensions;
    create extension pgcrypto with schema extensions;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth,live_streams to anon,authenticated,service_role;
    create table live_streams.worker_settings(singleton boolean primary key default true check(singleton),
      project_origin text check(project_origin ~ '^https://[a-z0-9]{20}[.]supabase[.]co$'));
    insert into live_streams.worker_settings values(true,'${origin}');
    revoke all on live_streams.worker_settings from public,anon,authenticated,service_role;
    create table net.http_request_queue(id bigint generated always as identity primary key,url text,body jsonb,headers jsonb,timeout_milliseconds integer);
    create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,
      headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 5000)
    returns bigint language plpgsql set search_path='' as $$declare request_id bigint;begin
      insert into net.http_request_queue(url,body,headers,timeout_milliseconds)
      values(http_post.url,http_post.body,http_post.headers,http_post.timeout_milliseconds) returning id into request_id;
      return request_id;end$$;`);
  await db.exec(await readFile(new URL('../../migrations/20261103050013_live_provider_registration_operator.sql', import.meta.url), 'utf8'));
});
after(() => db.close()); beforeEach(() => db.exec('begin')); afterEach(() => db.exec('rollback'));

test('owner-only enqueue cannot be called or minted through anon, authenticated, or service-role access', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(await scalar("select has_function_privilege($1,'live_streams.enqueue_provider_operation(text,text)','EXECUTE')", [role]), false);
    await assert.rejects(as(role, "select live_streams.enqueue_provider_operation('register_webhook','Synthetic acceptance')"), /permission denied/);
    await assert.rejects(as(role, 'select count(*) from live_streams.provider_operations'), /permission denied/);
    await assert.rejects(as(role, "insert into live_streams.provider_operations(id) values(gen_random_uuid()) returning id"), /permission denied/);
  }
  assert.equal(await scalar('select count(*) from live_streams.provider_operations'), 0);
  assert.equal(await scalar('select count(*) from net.http_request_queue'), 0);
});
test('owner enqueue records audit metadata, hashes the token, and fixes destination/body/timeout', async () => {
  const operation = await enqueue(), { result, queued, token } = operation;
  assert.deepEqual(Object.keys(result).sort(), ['operation_id', 'request_id']);
  assert.equal(queued.url, origin + '/functions/v1/live-provider-configure'); assert.deepEqual(queued.body, {});
  assert.equal(queued.timeout_milliseconds, 60000); assert.match(token, /^pc_live_config_[a-f0-9]{64}$/);
  const row = await scalar("select to_jsonb(p) || jsonb_build_object('digest_hex',encode(token_digest,'hex')) from live_streams.provider_operations p where id=$1", [result.operation_id]);
  assert.equal(row.reason, 'Approved provider acceptance operation'); assert.equal(row.requested_by, await scalar('select session_user'));
  assert.equal(row.digest_hex, createHash('sha256').update(token).digest('hex')); assert.equal(JSON.stringify(row).includes(token), false);
  assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 120000);
  assert.equal(await enqueue(), null, 'one outstanding operation prevents concurrent dispatch');
});
test('action, reason, and project origin are validated without arbitrary provider data or URL parameters', async () => {
  await assert.rejects(enqueue('arbitrary_write'), /INVALID_PROVIDER_OPERATION/);
  await assert.rejects(enqueue('register_webhook', 'short'), /INVALID_PROVIDER_OPERATION/);
  await db.exec('update live_streams.worker_settings set project_origin=null');
  await assert.rejects(enqueue(), /PROVIDER_ORIGIN_NOT_CONFIGURED/);
  assert.equal(await scalar('select count(*) from net.http_request_queue'), 0);
});
test('claim requires service role, matching project, a valid unexpired token, and consumes it once', async () => {
  const { token, result } = await enqueue();
  for (const role of ['anon', 'authenticated']) await assert.rejects(as(role, 'select public.claim_live_provider_operation_v1($1,$2)', [token, origin]), /permission denied/);
  assert.equal(await as('service_role', 'select public.claim_live_provider_operation_v1($1,$2)', [token, origin], 'authenticated'), null);
  assert.equal(await claim('pc_live_config_' + 'f'.repeat(64)), null);
  assert.equal(await as('service_role', 'select public.claim_live_provider_operation_v1($1,$2)', [token, 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co']), null);
  const claimed = await claim(token); assert.equal(claimed.operation_id, result.operation_id); assert.equal(claimed.action, 'register_webhook');
  assert.equal(await claim(token), null);
});
test('expired and nearly-expired tokens cannot start a provider operation', async () => {
  const { token, result } = await enqueue();
  await db.query("with moment as materialized (select clock_timestamp() t) update live_streams.provider_operations set created_at=moment.t-interval '3 minutes',expires_at=moment.t-interval '1 minute' from moment where id=$1", [result.operation_id]);
  assert.equal(await claim(token), null);
  await db.query("with moment as materialized (select clock_timestamp() t) update live_streams.provider_operations set created_at=moment.t-interval '1 minute',expires_at=moment.t+interval '30 seconds' from moment where id=$1", [result.operation_id]);
  assert.equal(await claim(token), null);
});
test('competing SQL claims and completions return exactly one success each', async () => {
  const { token } = await enqueue();
  await db.exec('set local role service_role');
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'service_role' })]);
  const claims = await Promise.all([1, 2].map(() => scalar('select public.claim_live_provider_operation_v1($1,$2)', [token, origin])));
  assert.equal(claims.filter(Boolean).length, 1);
  const receipt = JSON.stringify(success());
  const completions = await Promise.all([1, 2].map(() => scalar('select public.finish_live_provider_operation_v1($1,true,$2)', [token, receipt])));
  assert.deepEqual(completions.sort(), [false, true]); await db.exec('reset role');
});
test('completion cannot precede claim, repeat, change action semantics, or persist non-whitelisted provider text', async () => {
  const { token, result } = await enqueue();
  assert.equal(await finish(token, true, success()), false);
  await claim(token);
  for (const receipt of [{ ...success(), hmac: 'must-never-be-stored' }, { ...success(), provider_error: 'raw private-provider-echo' },
    { ...success(), provider_reason: 'raw private-provider-echo' }, { ...success(), provider_status: 600 },
    { ...success(), code: 'STORAGE_VERIFIED', cleanup_confirmed: true }, { ...success(), configuration_matches: false }]) {
    assert.equal(await finish(token, true, receipt), false);
  }
  const receipt = success(); assert.equal(await finish(token, true, receipt), true); assert.equal(await finish(token, false, { code: 'PROVIDER_REQUEST_FAILED', mutation_attempted: false }), false);
  const row = await scalar('select to_jsonb(p) from live_streams.provider_operations p where id=$1', [result.operation_id]);
  assert.equal(row.succeeded, true); assert.deepEqual(row.result, receipt); assert.ok(row.finished_at);
});
test('fixed storage action requires cleanup confirmation and failure diagnostics stay whitelisted', async () => {
  const { token, result } = await enqueue('verify_storage'); await claim(token);
  const receipt = { code: 'STORAGE_VERIFIED', resource_id: result.operation_id, mutation_attempted: true, configuration_matches: true };
  assert.equal(await finish(token, true, receipt), false);
  const failure = { code: 'PROVIDER_REQUEST_REJECTED', mutation_attempted: true, cleanup_confirmed: true,
    provider_status: 400, provider_error: 'invalid-request-error', provider_reason: 'role_assumption_denied' };
  assert.equal(await finish(token, false, failure), true);
  assert.deepEqual(await scalar('select result from live_streams.provider_operations where id=$1', [result.operation_id]), failure);
});
