import assert from 'node:assert/strict';
import {before, after, beforeEach, afterEach, test} from 'node:test';
import {createHash, randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {source} from './deployed-media-baseline.mjs';
import {loadBusinessAuthBaseline} from './business-auth-fixture.mjs';

// Exercise the actual combined rollout order. Individually passing migration
// suites cannot establish that the business/session and audio wrappers compose.
const db = new PGlite({extensions});
const qaMode = process.env.PLATINUM_QA_BUSINESS_AUTH === '1';
const ids = {owner: randomUUID(), business: randomUUID(), stranger: randomUUID()};
const sessions = {owner: randomUUID(), stranger: randomUUID()};
const origin = 'https://integration-fixture.supabase.co';
const digest = 'a'.repeat(64);
const deviceProof = createHash('sha256').update('synthetic-combined-device').digest('hex');
const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0];

async function as(user, session, sql, args = [], role = 'authenticated') {
  await db.exec('savepoint request');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",
      [user || '', role, JSON.stringify({sub: user || null, session_id: session || null, role, is_anonymous: false, iss: `${origin}/auth/v1`})]);
    const result = await value(sql, args);
    await db.exec('reset role');
    await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
    await db.exec('release savepoint request');
    return result;
  } catch (error) {
    await db.exec('rollback to savepoint request;release savepoint request');
    throw error;
  }
}
const service = (sql, args = []) => as(null, null, sql, args, 'service_role');
const personal = (sql, args = []) => as(ids.owner, sessions.owner, sql, args);
const capability = (user, session) => as(user, session, 'select get_original_audio_capabilities()');

async function bindBusiness() {
  const device = randomUUID();
  const grant = await service('select triniti_business_owner_access($1,$2,null,$3,$4,$5,true,$6)',
    [ids.owner, sessions.owner, device, deviceProof, 'Synthetic integration device', ids.business]);
  assert.equal(grant.allowed, true, JSON.stringify(grant));
  const session = randomUUID();
  await db.query("insert into auth.sessions(id,user_id,aal,created_at) values($1,$2,'aal1',clock_timestamp())", [session, ids.business]);
  const result = await service('select triniti_business_finish_signin($1,$2,$3,$4)', [grant.grant_id, ids.business, session, deviceProof]);
  assert.equal(result.success, true);
  return {session, device, member: result.member_id};
}

async function verifiedOriginal(user, session) {
  const reservation = await as(user, session, 'select reserve_original_audio($1,$2,$3,$4,$5,$6,false,true)',
    [randomUUID(), user, 'Synthetic integration recording', 'audio/wav', 88244, digest]);
  const version = randomUUID();
  await db.query("insert into storage.objects(bucket_id,name,owner_id,owner,version,metadata) values('music-audio',$1,$2::text,$2::uuid,$3,$4)",
    [reservation.path, user, version, JSON.stringify({size: 88244, mimetype: 'audio/wav'})]);
  const sound = await service('select finish_original_audio_upload($1,$2,2,$3,$4)', [reservation.id, user, digest, version]);
  return {...reservation, sound};
}

before(async () => {
  await loadBusinessAuthBaseline(db, qaMode, true);
  for (const migration of [
    '20261030034752_business_bound_auth_sessions',
    '20261030153811_original_music_library_and_delivery',
    '20261030181000_market_offer_response_serialization',
    '20261030203619_music_catalogue_operations_and_cleanup',
    '20261030204339_licensed_catalogue_pipeline',
  ]) {
    await db.exec(await source(`supabase/migrations/${migration}.sql`));
  }
  for (const [name, id] of Object.entries(ids)) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `integration-${name}@example.invalid`]);
    await db.query('update public.profiles set username=$1,full_name=$1,account_type=$2 where id=$3',
      [`integration_${name}`, name === 'business' ? 'business' : 'personal', id]);
  }
  for (const [name, session] of Object.entries(sessions)) {
    await db.query("insert into auth.sessions(id,user_id,aal,created_at) values($1,$2,'aal1',clock_timestamp())", [session, ids[name]]);
  }
  await db.query("insert into public.business_members(business_id,member_id,role) values($1,$2,'owner')", [ids.business, ids.owner]);
});
after(() => db.close());
beforeEach(() => db.exec('begin'));
afterEach(() => db.exec('rollback'));

test('combined installation preserves disabled audio readiness and the business request hook', async () => {
  const result = await capability(ids.owner, sessions.owner);
  assert.equal(result.version, 2);
  assert.equal(result.uploadsEnabled, false);
  assert.equal(result.catalogEnabled, false);
  assert.equal(await value('select ingestion_enabled or playback_enabled from music_library.catalogue_service'), false);
  assert.equal(await value('select count(*)::int from music_library.catalogue_credentials'), 0);
  assert.equal(await value('select count(*)::int from music_library.catalogue_grants'), 0);
  assert.equal(await value("select exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig)c where c='pgrst.db_pre_request=public.business_auth_request_guard')"), true);
  assert.equal(await value("select public from storage.buckets where id='music-audio'"), false);
});

test('personal originals still reserve, finalize, export and retain private Storage after business guards', async () => {
  await service("select set_original_audio_service_ready(true,'Synthetic worker verified for integration')");
  const recording = await verifiedOriginal(ids.owner, sessions.owner);
  assert.equal(await personal("select sound_rights_allow($1,'post')", [recording.sound]), true);
  assert.equal((await personal("select authorize_music_audio_export($1,'post')", [recording.sound])).id, recording.sound);
  assert.equal(await personal("select count(*)::int from storage.objects where bucket_id='music-audio' and name=$1", [recording.path]), 0);
  assert.equal((await personal('select offer_response_capabilities()')).serialized, true);
});

test('unbound business JWTs cannot use audio capabilities, reserve uploads or respond to offers', async () => {
  const session = randomUUID();
  await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())', [session, ids.business]);
  await service("select set_original_audio_service_ready(true,'Synthetic worker verified for integration')");
  await assert.rejects(() => capability(ids.business, session), /BUSINESS_SESSION_REQUIRED/);
  await assert.rejects(() => as(ids.business, session, 'select reserve_original_audio($1,$2,$3,$4,$5,$6,false,true)',
    [randomUUID(), ids.business, 'Denied recording', 'audio/wav', 88244, digest]), /BUSINESS_SESSION_REQUIRED/);
  await assert.rejects(() => as(ids.business, session, 'select offer_response_capabilities()'), /BUSINESS_SESSION_REQUIRED/);
  assert.equal(await value('select count(*)::int from music_library.uploads'), 0);
});

test('a bound business owns its audio and owner sign-out revokes warmed delivery across all wrappers', async () => {
  const business = await bindBusiness();
  await service("select set_original_audio_service_ready(true,'Synthetic worker verified for integration')");
  assert.equal((await capability(ids.business, business.session)).uploadsEnabled, true);
  assert.equal((await as(ids.business, business.session, 'select offer_response_capabilities()')).serialized, true);
  const recording = await verifiedOriginal(ids.business, business.session);
  const tickets = await as(ids.business, business.session, "select coalesce(jsonb_agg(t),'[]') from issue_content_media_delivery($1,null)t",
    [JSON.stringify([{kind: 'sound', id: recording.sound}])]);
  const ticket = tickets.find(item => item.bucket_id === 'music-audio');
  assert.ok(ticket);
  const redeem = () => service('select resolve_media_delivery($1,$2,$3)', [ticket.token, ticket.bucket_id, ticket.object_path]);
  assert.ok(await redeem());
  assert.equal(await value("select count(*)::int from music_library.usage_events where event_type='delivery_authorization'"), 1);
  await db.query('delete from auth.sessions where id=$1', [sessions.owner]);
  assert.equal(await value('select count(*)::int from auth.sessions where id=$1', [business.session]), 0);
  assert.equal(await redeem(), null);
  await assert.rejects(() => capability(ids.business, business.session), /SESSION_REQUIRED|ACTIVE_SESSION/);
  assert.equal(await value("select count(*)::int from music_library.usage_events where event_type='delivery_authorization'"), 1);
});

test('revoked business devices stop audio access while personal-owner playback remains separate', async () => {
  const business = await bindBusiness();
  await service("select set_original_audio_service_ready(true,'Synthetic worker verified for integration')");
  const recording = await verifiedOriginal(ids.business, business.session);
  assert.equal(await as(ids.business, business.session, "select sound_rights_allow($1,'story')", [recording.sound]), true);
  await db.query("update public.business_devices set status='pending' where business_id=$1 and device_id=$2", [ids.business, business.device]);
  await assert.rejects(() => capability(ids.business, business.session), /SESSION_REQUIRED|ACTIVE_SESSION/);
  assert.equal(await personal("select sound_rights_allow($1,'story')", [recording.sound]), false);
  assert.equal((await capability(ids.owner, sessions.owner)).version, 2);
});

test('combined private helper and provider contracts stay unavailable to application roles', async () => {
  for (const schema of ['business_auth', 'music_library']) {
    assert.equal(await value(`select count(*)::int from pg_proc where pronamespace=$1::regnamespace and
      (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))`, [schema]), 0);
  }
  for (const signature of ['public.finish_original_audio_upload(uuid,uuid,numeric,text,text)',
    'public.finish_catalogue_audio(text,uuid,numeric,text,text)', 'public.resolve_media_delivery(text,text,text)',
    'public.claim_music_upload_cleanup(uuid)', 'public.admin_stage_music_catalogue(uuid,uuid,uuid,text,jsonb)']) {
    assert.equal(await value("select has_function_privilege('authenticated',$1,'execute')", [signature]), false);
    assert.equal(await value("select has_function_privilege('anon',$1,'execute')", [signature]), false);
    assert.equal(await value("select has_function_privilege('service_role',$1,'execute')", [signature]), true);
  }
});
