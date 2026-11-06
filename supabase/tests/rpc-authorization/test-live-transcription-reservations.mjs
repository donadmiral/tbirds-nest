import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline, source } from './deployed-media-baseline.mjs';
const db = new PGlite({ extensions });
const actors = { one: randomUUID(), two: randomUUID(), three: randomUUID() }, sessions = Object.fromEntries(Object.keys(actors).map(k => [k, randomUUID()]));
const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0];
async function as(role, name, sql, args = []) {
  await db.exec('savepoint request');
  try {
    await db.exec(`set local role ${role}`);
    const claims = { sub: actors[name] || null, role, session_id: sessions[name] || null, is_anonymous: false };
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)", [claims.sub || '', role, JSON.stringify(claims)]);
    const result = await value(sql, args); await db.exec('reset role;release savepoint request'); return result;
  } catch (error) { await db.exec('rollback to savepoint request;release savepoint request'); throw error; }
}
const service = (sql, args = []) => as('service_role', null, sql, args);
const worker = (action, job, payload = {}) => service('select public.live_transcription_worker($1,$2,$3,$4)', [action, job?.id || null, job?.lease_id || null, JSON.stringify(payload)]);
const fingerprint = 'a'.repeat(64);
const submit = job => worker('submit', job, { configuration_hash: fingerprint });
const draft = () => ({ provider: 'aws_transcribe', timing: 'provider_words', requires_review: true, text: 'Synthetic words.', cues: [{ start_ms: 0, end_ms: 1000, text: 'Synthetic words.' }] });
async function makeJob(name = 'one') {
  const created = await as('authenticated', name, 'select public.live_command($1,$2,$3,$4)', ['create', null,
    JSON.stringify({ title: 'Reservation fixture', topic: 'gaming', audience: 'public', recording_enabled: true }), randomUUID()]);
  const session = created.session_id;
  await db.query("update live_streams.sessions set state='live',started_at=now()-interval '5 minutes' where id=$1", [session]);
  const instance = await value('select instance_id from live_streams.provider_sessions where session_id=$1', [session]);
  await db.query('update live_streams.provider_sessions set playback_path=$2 where session_id=$1', [session, `live/${session}/${instance}/master.m3u8`]);
  const spec = { title: 'Reservation clip', caption: '', tags: [], start_ms: 0, end_ms: 30000, cover_ms: 0, formats: ['horizontal'], watermark: true, brand_text: 'Platinum Circles', burn_captions: false, subtitles: [] };
  const { clip_id } = await as('authenticated', name, 'select public.live_clip_command($1,$2,$3,$4,$5)', [session, null, 'create', JSON.stringify(spec), randomUUID()]);
  const render = (await service('select public.live_claim_clip_jobs(1)')).items[0];
  const assets = [{ name: 'horizontal.mp4', bytes: 1024, sha256: 'b'.repeat(64), content_type: 'video/mp4', width: 1280, height: 720, duration_ms: 30000, format: 'horizontal' },
    { name: 'thumbnail.jpg', bytes: 100, sha256: 'c'.repeat(64), content_type: 'image/jpeg' }];
  for (const asset of assets) await db.query("insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('live-clips',$1,$2,$3,$4)",
    [render.output_prefix + asset.name, randomUUID(), JSON.stringify({ size: asset.bytes, mimetype: asset.content_type }), JSON.stringify({ live_clip_id: clip_id, live_clip_job_id: render.id, live_clip_lease_id: render.lease_id, sha256: asset.sha256 })]);
  await service('select public.live_finish_clip_job($1,$2,true,$3,null)', [render.id, render.lease_id, JSON.stringify({ assets, duration_ms: 30000, width: 1280, height: 720 })]);
  const request = await as('authenticated', name, 'select public.live_transcription_command($1,$2,$3,$4)', [clip_id, 'request', JSON.stringify({ consent: true, language: 'en-US' }), randomUUID()]);
  return { id: request.id, clip: clip_id, session };
}
before(async () => {
  await loadDeployedMediaBaseline(db); await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false');
  for (const file of ['20261103000609_live_portable_control_plane.sql', '20261103002857_live_clips_and_distribution.sql', '20261103055547_live_optional_integrations.sql']) await db.exec(await source('supabase/migrations/' + file));
  for (const [name, id] of Object.entries(actors)) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `reservation-${name}@example.test`]);
    await db.query("insert into public.profiles(id,username,full_name,email,profile_visibility,account_type) values($1,$2,$2,$3,'public','personal') on conflict(id) do update set username=excluded.username,profile_visibility='public',account_type='personal'", [id, 'reservation_' + name, `reservation-${name}@example.test`]);
    await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')", [sessions[name], id]);
  }
  await db.exec("update live_streams.clip_runtime set enabled=true,project_origin='https://abcdefghijklmnopqrst.supabase.co';update live_streams.integration_runtime set enabled=true where platform='transcription'");
});
after(() => db.close()); beforeEach(() => db.exec('begin')); afterEach(() => db.exec('rollback'));

test('provider budgets and reservations have no ordinary or direct service table access', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) for (const table of ['transcription_limits', 'transcription_reservations'])
    await assert.rejects(as(role, 'one', `select * from live_streams.${table}`), /permission denied/);
  const limits = (await db.query('select * from live_streams.transcription_limits')).rows[0];
  assert.equal(limits.max_provider_active, 2); assert.equal(limits.max_daily_starts, 12); assert.equal(limits.max_daily_audio_ms, 900000);
  await assert.rejects(as('authenticated', 'one', "select public.live_transcription_worker('submit')"), /permission denied/);
});
test('submit is idempotent and deferral preserves its provider slot, fingerprint and daily count', async () => {
  await makeJob(); const job = (await worker('claim')).items[0];
  assert.equal((await submit(job)).duplicate, false); assert.equal((await submit(job)).duplicate, true);
  assert.equal((await worker('submit', job, { configuration_hash: 'd'.repeat(64) })).error, 'CONFIGURATION_CONFLICT');
  await worker('defer', job);
  assert.equal(await value("select count(*) from live_streams.transcription_reservations where provider_state='active'"), 1);
  await db.query("update live_streams.transcription_jobs set next_attempt_at=now()-interval '1 second' where id=$1", [job.id]);
  const again = (await worker('claim')).items[0]; assert.equal(again.id, job.id); assert.notEqual(again.lease_id, job.lease_id);
  assert.equal(again.configuration_hash, fingerprint); assert.equal((await submit(again)).duplicate, true);
  assert.equal(await value('select count(*) from live_streams.transcription_reservations'), 1);
});
test('two deferred actual-provider reservations prevent a third creator from submitting', async () => {
  for (const name of ['one', 'two']) { await makeJob(name); const job = (await worker('claim')).items[0]; assert.equal((await submit(job)).ok, true); await worker('defer', job); }
  await makeJob('three'); const third = (await worker('claim')).items[0]; assert.equal((await submit(third)).error, 'PROVIDER_CAPACITY');
  assert.equal(await value("select count(*) from live_streams.transcription_reservations where provider_state='active'"), 2);
});
test('terminal completion frees concurrency but never erases the UTC-day start budget', async () => {
  await db.exec('update live_streams.transcription_limits set max_daily_starts=1');
  await makeJob(); const first = (await worker('claim')).items[0]; await submit(first); await worker('finish', first, draft());
  assert.equal(await value("select count(*) from live_streams.transcription_reservations where provider_state='active'"), 0);
  await makeJob('two'); const second = (await worker('claim')).items[0]; assert.equal((await submit(second)).error, 'DAILY_BUDGET');
});
test('revoked sessions receive only cleanup leases; uncertain provider work holds its slot', async () => {
  await makeJob(); const job = (await worker('claim')).items[0]; await submit(job); await worker('defer', job);
  await db.query('delete from auth.sessions where id=$1', [sessions.one]);
  const cleanup = (await worker('claim')).items[0]; assert.equal(cleanup.cleanup, true); assert.equal(cleanup.id, job.id);
  assert.equal((await worker('check', cleanup)).ok, false);
  assert.equal((await worker('settle', { ...cleanup, lease_id: randomUUID() }, { provider_status: 'COMPLETED' })).ok, false);
  assert.equal((await worker('settle', cleanup, { provider_status: 'NOT_FOUND' })).error, 'SETTLEMENT_PENDING');
  assert.equal((await worker('settle', cleanup, { provider_status: 'NOT_SUBMITTED' })).error, 'SETTLEMENT_PENDING');
  await assert.rejects(worker('settle', cleanup, { provider_status: 'IN_PROGRESS' }), /INVALID_REQUEST/);
  await worker('cleanup_defer', cleanup); assert.equal(await value("select provider_state from live_streams.transcription_reservations where id=$1", [job.id]), 'active');
  await db.query("update live_streams.transcription_reservations set reserved_at=now()-interval '3 minutes',next_cleanup_at=now()-interval '1 second' where id=$1", [job.id]);
  const again = (await worker('claim')).items[0]; assert.notEqual(again.lease_id, cleanup.lease_id);
  assert.equal((await worker('settle', again, { provider_status: 'NOT_FOUND' })).provider_state, 'terminal');
});
test('clip or account deletion cannot erase a provider reservation; disabled admission still permits cleanup', async () => {
  const created = await makeJob(); const job = (await worker('claim')).items[0]; await submit(job); await worker('defer', job);
  await db.query('delete from live_streams.clips where id=$1', [created.clip]);
  assert.equal(await value('select count(*) from live_streams.transcription_jobs where id=$1', [job.id]), 0);
  await db.exec("update live_streams.integration_runtime set enabled=false where platform='transcription'");
  const cleanup = (await worker('claim')).items[0]; assert.equal(cleanup.cleanup, true); assert.equal(cleanup.clip_id, created.clip);
  assert.equal((await worker('settle', cleanup, { provider_status: 'FAILED' })).ok, true);
  assert.equal(await value('select count(*) from live_streams.transcription_reservations'), 1);
  assert.equal((await worker('claim')).error, 'INTEGRATION_DISABLED');
});
test('ordinary failure retains the reservation until independently reconciled terminal state', async () => {
  await makeJob(); const job = (await worker('claim')).items[0]; await submit(job); await worker('fail', job, { error: 'PROVIDER_UNAVAILABLE' });
  assert.equal(await value('select provider_state from live_streams.transcription_reservations where id=$1', [job.id]), 'active');
  const cleanup = (await worker('claim')).items[0]; assert.equal(cleanup.cleanup, true);
  assert.equal((await worker('settle', cleanup, { provider_status: 'FAILED' })).ok, true);
});
test('missing budget configuration and expired source lease never grant a submission reservation', async () => {
  await makeJob(); const job = (await worker('claim')).items[0]; await db.exec('delete from live_streams.transcription_limits');
  assert.equal((await submit(job)).error, 'INTEGRATION_DISABLED');
  await db.query("update live_streams.transcription_jobs set lease_until=now()-interval '1 second' where id=$1", [job.id]);
  assert.equal((await submit(job)).error, 'STATE_EXPIRED'); assert.equal(await value('select count(*) from live_streams.transcription_reservations'), 0);
});
test('UTC-day audio budget includes rounded duration, encoder margin, and terminal reservations', async () => {
  await makeJob(); const first = (await worker('claim')).items[0];
  await db.query('update live_streams.transcription_jobs set duration_ms=600000 where id=$1',[first.id]);
  assert.equal((await submit(first)).ok,true); await worker('finish',first,draft());
  assert.equal(await value('select budget_audio_ms from live_streams.transcription_reservations where id=$1',[first.id]),601000);
  await makeJob('two'); const second=(await worker('claim')).items[0];
  await db.query('update live_streams.transcription_jobs set duration_ms=300000 where id=$1',[second.id]);
  assert.equal((await submit(second)).error,'DAILY_BUDGET');
  await db.query('update live_streams.transcription_jobs set duration_ms=298000 where id=$1',[second.id]);
  assert.equal((await submit(second)).ok,true);
  assert.equal(await value('select sum(budget_audio_ms) from live_streams.transcription_reservations'),900000);
  await worker('finish',second,draft()); await makeJob('three');const third=(await worker('claim')).items[0];
  assert.equal((await submit(third)).error,'DAILY_BUDGET');
  await db.exec("update live_streams.transcription_reservations set reserved_at=date_trunc('day',now(),'UTC')-interval '1 second'");
  assert.equal((await submit(third)).ok,true);
});
test('queue peek is read-only, returns only aggregate readiness, and respects audio budget and lease capacity', async () => {
  assert.deepEqual(await worker('peek'),{enabled:true,due:false,active:0});
  await makeJob(); assert.deepEqual(await worker('peek'),{enabled:true,due:true,active:0});
  assert.equal(await value("select count(*) from live_streams.transcription_jobs where state='leased'"),0);
  const first=(await worker('claim')).items[0];assert.deepEqual(await worker('peek'),{enabled:true,due:false,active:1});
  await submit(first);await worker('finish',first,draft());
  await db.exec('update live_streams.transcription_limits set max_daily_audio_ms=31000');
  await makeJob('two');assert.deepEqual(await worker('peek'),{enabled:true,due:false,active:0});
  await db.exec('delete from live_streams.transcription_limits');
  assert.deepEqual(await worker('peek'),{enabled:true,due:false,active:0});
  await assert.rejects(as('authenticated','one',"select public.live_transcription_worker('peek')"),/permission denied/);
});
test('queue peek still schedules fixed cleanup after admission is disabled without granting source access', async () => {
  await makeJob();const job=(await worker('claim')).items[0];await submit(job);await worker('defer',job);
  await db.exec("update live_streams.integration_runtime set enabled=false where platform='transcription'");
  assert.deepEqual(await worker('peek'),{enabled:true,due:true,active:0});
  const cleanup=(await worker('claim')).items[0];assert.equal(cleanup.cleanup,true);
  assert.deepEqual(await worker('peek'),{enabled:false,due:false,active:1});
  assert.equal((await worker('check',cleanup)).error,'INTEGRATION_DISABLED');
  await worker('settle',cleanup,{provider_status:'FAILED'});
  assert.deepEqual(await worker('peek'),{enabled:false,due:false,active:0});
});
test('expired or revoked unreserved work wakes claim cleanup instead of remaining pending forever',async()=>{
 const expired=await makeJob();await db.query("update live_streams.transcription_jobs set created_at=now()-interval '3 hours' where id=$1",[expired.id]);
 assert.deepEqual(await worker('peek'),{enabled:true,due:true,active:0});assert.deepEqual((await worker('claim')).items,[]);
 assert.equal(await value('select state from live_streams.transcription_jobs where id=$1',[expired.id]),'failed');
 assert.deepEqual(await worker('peek'),{enabled:true,due:false,active:0});
 const revoked=await makeJob('two');await db.query('delete from auth.sessions where id=$1',[sessions.two]);
 assert.deepEqual(await worker('peek'),{enabled:true,due:true,active:0});assert.deepEqual((await worker('claim')).items,[]);
 assert.equal(await value('select state from live_streams.transcription_jobs where id=$1',[revoked.id]),'cancelled');
 assert.deepEqual(await worker('peek'),{enabled:true,due:false,active:0});assert.equal(await value('select count(*) from live_streams.transcription_reservations'),0);
});
