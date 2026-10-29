import {readCandidate} from './migration-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const results = [];
const attacker = '10000000-0000-4000-8000-000000000001';
const victim = '10000000-0000-4000-8000-000000000002';
const setup = await readFile(new URL('./save-push-token-fixture.sql', import.meta.url), 'utf8');
const candidate = await readCandidate('save-push-token-candidate.sql');
const run = async (name, fn) => { await fn(); results.push(name); };
const call = (owner, token = 'synthetic-device', device = 'Synthetic test phone') =>
  db.query('SELECT public.save_push_token($1::uuid,$2::text,$3::text,$4::text)', [owner, token, device, 'ios']);
async function role(name, owner = '') {
  assert.ok(['postgres','anon','authenticated','service_role'].includes(name));
  await db.exec(`RESET ROLE; SET LOCAL ROLE ${name};`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [owner, name]);
}
async function count(owner) {
  await role('postgres');
  return (await db.query('SELECT count(*)::int AS count FROM public.user_push_tokens WHERE user_id=$1::uuid', [owner])).rows[0].count;
}
async function isolated(name, fn) {
  await db.exec('SAVEPOINT one_case;');
  try { await run(name, fn); } finally { await db.exec('ROLLBACK TO SAVEPOINT one_case; RELEASE SAVEPOINT one_case;'); }
}
async function denied(fn, code = '42501') {
  // PostgreSQL aborts a transaction after an error; isolate just the denied call.
  await db.exec('SAVEPOINT denied_call;');
  try { await assert.rejects(fn, error => error.code === code); }
  finally { await db.exec('ROLLBACK TO SAVEPOINT denied_call; RELEASE SAVEPOINT denied_call;'); }
}
let version;
try {
  version = (await db.query('SELECT version() AS version')).rows[0].version;
  await db.exec('BEGIN;');
  await db.exec(setup);
  await run('exact original definition hash loaded', async () => {
    const actual = (await db.query("SELECT md5(pg_get_functiondef('public.save_push_token(uuid,text,text,text)'::regprocedure)) AS hash")).rows[0].hash;
    assert.equal(actual, '9f833a61f74da9f64f6996af04fb1196');
  });
  await isolated('baseline anon can attach a device to a victim account', async () => {
    await role('anon'); await call(victim); assert.equal(await count(victim), 1);
  });
  await isolated('baseline authenticated attacker can attach a device to another account', async () => {
    await role('authenticated', attacker); await call(victim); assert.equal(await count(victim), 1);
  });
  await role('postgres');
  await db.exec(candidate);
  await isolated('patched anon cannot execute even with a claimed target id', async () => {
    await role('anon'); await denied(() => call(victim)); assert.equal(await count(victim), 0);
  });
  await isolated('patched authenticated attacker cannot register victim device', async () => {
    await role('authenticated', attacker); await denied(() => call(victim)); assert.equal(await count(victim), 0);
  });
  await isolated('patched missing identity fails closed', async () => {
    await role('authenticated'); await denied(() => call(attacker)); assert.equal(await count(attacker), 0);
  });
  await isolated('patched null target fails without writing an orphan', async () => {
    await role('authenticated', attacker); await denied(() => call(null), '22023'); assert.equal(await count(attacker), 0);
  });
  await isolated('valid self registration and rotation metadata upsert preserve one device row', async () => {
    await role('authenticated', attacker); await call(attacker); await call(attacker, 'synthetic-device', 'Renamed synthetic phone');
    assert.equal(await count(attacker), 1);
    assert.equal((await db.query('SELECT device_name FROM public.user_push_tokens WHERE user_id=$1', [attacker])).rows[0].device_name, 'Renamed synthetic phone');
  });
  await isolated('existing active-account token reassignment behavior is preserved', async () => {
    await role('authenticated', attacker); await call(attacker);
    await role('authenticated', victim); await call(victim);
    assert.equal(await count(attacker), 0); assert.equal(await count(victim), 1);
  });
  await isolated('empty token remains a no-op for its authorized owner', async () => {
    await role('authenticated', attacker); await call(attacker, ''); assert.equal(await count(attacker), 0);
  });
  await isolated('explicit service-role registration contract remains available without a user JWT', async () => {
    await role('service_role'); await call(victim); assert.equal(await count(victim), 1);
  });
  await isolated('table RLS also denies direct victim insertion to authenticated caller', async () => {
    await role('authenticated', attacker);
    await denied(() => db.query("INSERT INTO public.user_push_tokens(user_id,expo_push_token) VALUES ($1,'synthetic-direct-device')", [victim]));
    assert.equal(await count(victim), 0);
  });
  await db.exec('ROLLBACK;');
  assert.equal((await db.query("SELECT to_regclass('public.user_push_tokens') AS table_name")).rows[0].table_name, null);
  results.push('outer rollback removes all synthetic schema and rows');
  const receipt = { runtime: version, runtimePackage: '@electric-sql/pglite@0.5.10', hostedWrites: false, testCount: results.length, tests: results, candidateSha256: createHash('sha256').update(candidate).digest('hex'), limitations: ['Local PostgreSQL 18.6 WASM, not hosted PostgreSQL17/PostgREST.', 'Synthetic auth.uid/auth.role use standard request JWT settings; no real users, tokens, devices or pushes.', 'UUID default helper delegates to gen_random_uuid; table, RLS, dedupe trigger and vulnerable function are sealed source.'] };
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  try { await db.exec('ROLLBACK;'); } catch {}
  await db.close();
}
