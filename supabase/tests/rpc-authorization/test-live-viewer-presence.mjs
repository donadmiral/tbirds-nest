import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline, source } from './deployed-media-baseline.mjs';
const db = new PGlite({ extensions });
const actors = Object.fromEntries(['host', 'viewer', 'other'].map(name => [name, randomUUID()]));
const sessions = Object.fromEntries(Object.keys(actors).map(name => [name, randomUUID()]));
const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0];
async function as(role, name, sql, args = [], authSession = sessions[name]) {
  await db.exec('savepoint request');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)", [actors[name] || '', role, JSON.stringify({ sub: actors[name] || null, role, session_id: authSession || null, is_anonymous: false })]);
    const result = await value(sql, args);
    await db.exec('reset role;release savepoint request');
    return result;
  } catch (error) {
    await db.exec('rollback to savepoint request;release savepoint request');
    throw error;
  }
}
const heartbeat = (actor, stream, playback = randomUUID(), active = true, authSession) => as('authenticated', actor, 'select public.live_viewer_heartbeat($1,$2,$3)', [stream, playback, active], authSession);
async function stream(audience = 'public') {
  const result = await as('authenticated', 'host', 'select public.live_command($1,$2,$3,$4)', ['create', null, JSON.stringify({ title: 'Measured presence test', topic: 'gaming', audience }), randomUUID()]);
  await db.query("update live_streams.sessions set state='live',started_at=now() where id=$1", [result.session_id]);
  await db.query('update live_streams.provider_sessions set authority_actor_id=$2,authority_session_id=$3,authority_checked_at=now() where session_id=$1', [result.session_id, actors.host, sessions.host]);
  return result.session_id;
}
async function measure(id, limit = 1000) {
  await db.query('update live_streams.sessions set viewer_count_at=null where id=$1', [id]);
  await value('select live_streams.refresh_viewer_counts($1)', [limit]);
  return value('select viewer_count from live_streams.sessions where id=$1', [id]);
}
before(async () => {
  await loadDeployedMediaBaseline(db);
  await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false');
  await db.exec(await source('supabase/migrations/20261103000609_live_portable_control_plane.sql'));
  await db.exec(await source('supabase/migrations/20261103002858_live_interactivity.sql'));
  await db.exec(await source('supabase/migrations/20261104022616_live_viewer_presence.sql'));
  await db.exec("create table live_streams.test_viewer_events(session_id uuid,event text,payload jsonb);create or replace function live_streams.broadcast(p_session uuid,p_event text,p_payload jsonb) returns void language sql security definer set search_path='' as $$insert into live_streams.test_viewer_events values($1,$2,$3)$$;");
  for (const [name, id] of Object.entries(actors)) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `presence-${name}@example.test`]);
    await db.query("insert into public.profiles(id,username,email,full_name,profile_visibility,account_type) values($1,$2,$3,$2,'public','personal') on conflict(id) do update set username=excluded.username,profile_visibility='public'", [id, `presence_${name}`, `presence-${name}@example.test`]);
    await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')", [sessions[name], id]);
  }
});
after(() => db.close());
beforeEach(() => db.exec('begin'));
afterEach(() => db.exec('rollback'));

test('only current authenticated audience members can heartbeat and raw identities stay private', async () => {
  const id = await stream('followers'), playback = randomUUID();
  await assert.rejects(as('anon', null, 'select public.live_viewer_heartbeat($1,$2,true)', [id, playback]), /permission denied/);
  await assert.rejects(heartbeat('other', id, playback), /LIVE_NOT_AVAILABLE/);
  await db.query('insert into public.follows(follower_id,following_id) values($1,$2)', [actors.viewer, actors.host]);
  assert.deepEqual(await heartbeat('viewer', id, playback), { ok: true });
  await assert.rejects(as('authenticated', 'viewer', 'select * from live_streams.viewer_presence'), /permission denied/);
  await assert.rejects(as('authenticated', 'viewer', 'select live_streams.refresh_viewer_counts(20)'), /permission denied/);
  await assert.rejects(heartbeat('viewer', id, null), /INVALID_REQUEST/);
  await assert.rejects(heartbeat('viewer', id, playback, null), /INVALID_REQUEST/);
  await db.query('delete from auth.sessions where id=$1', [sessions.viewer]);
  assert.equal(await value('select count(*) from live_streams.viewer_presence'), 0);
  await assert.rejects(heartbeat('viewer', id, playback), /AUTH_REQUIRED/);
});

test('separate tabs and devices count one member and leave only their own playback instance', async () => {
  const id = await stream(), a = randomUUID(), b = randomUUID(), device = randomUUID();
  await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')", [device, actors.viewer]);
  await heartbeat('viewer', id, a);
  await heartbeat('viewer', id, b, true, device);
  await heartbeat('other', id, a);
  await heartbeat('host', id);
  assert.equal(await measure(id), 2);
  assert.equal(await value('select count(*) from live_streams.viewer_presence'), 3);
  await heartbeat('viewer', id, b, false); // Wrong Auth session cannot remove another device.
  assert.equal(await value('select count(*) from live_streams.viewer_presence'), 3);
  await heartbeat('viewer', id, a, false);
  assert.equal(await measure(id), 2);
  await heartbeat('viewer', id, b, false, device);
  assert.equal(await measure(id), 1);
  await heartbeat('other', id, a, false);
  assert.equal(await measure(id), 0);
});

test('duplicate heartbeats avoid writes and real refresh renews the server-bounded lease', async () => {
  const id = await stream(), playback = randomUUID();
  await heartbeat('viewer', id, playback);
  const first = await value('select expires_at::text from live_streams.viewer_presence');
  await heartbeat('viewer', id, playback);
  assert.equal(await value('select expires_at::text from live_streams.viewer_presence'), first);
  await db.exec("update live_streams.viewer_presence set last_seen_at=now()-interval '40 seconds',expires_at=now()+interval '50 seconds'");
  await heartbeat('viewer', id, playback);
  assert.equal(await value("select expires_at>clock_timestamp()+interval '85 seconds' and expires_at<=clock_timestamp()+interval '90 seconds' from live_streams.viewer_presence"), true);
  await db.exec("update live_streams.viewer_presence set expires_at=now()-interval '1 second'");
  assert.equal(await measure(id), 0);
  assert.equal(await value('select count(*) from live_streams.viewer_presence'), 0);
});

test('the existing maintenance path measures counts without changing provider recovery timestamps', async () => {
  const id = await stream();
  const updated = await value('select updated_at::text from live_streams.sessions where id=$1', [id]);
  await heartbeat('viewer', id);
  await as('service_role', null, 'select public.live_maintenance(20)');
  assert.equal(await value('select viewer_count from live_streams.sessions where id=$1', [id]), 1);
  assert.equal(await value('select updated_at::text from live_streams.sessions where id=$1', [id]), updated);
  const count = await value("select count(*) from live_streams.test_viewer_events where event='session'");
  await measure(id);
  assert.equal(await value("select count(*) from live_streams.test_viewer_events where event='session'"), count);
  const event = await value("select payload from live_streams.test_viewer_events where event='session' order by ctid desc limit 1");
  assert.equal(event.session.viewer_count, 1);
  assert.equal(JSON.stringify(event).includes(actors.viewer), false);
});

test('ended playback and host previews cannot inflate live totals', async () => {
  const id = await stream(), playback = randomUUID();
  await heartbeat('host', id);
  assert.equal(await value('select count(*) from live_streams.viewer_presence'), 0);
  await heartbeat('viewer', id, playback);
  assert.equal(await measure(id), 1);
  await db.query("update live_streams.sessions set state='ended',ended_at=now() where id=$1", [id]);
  await heartbeat('viewer', id, playback);
  assert.equal(await value('select count(*) from live_streams.viewer_presence'), 0);
  assert.equal(await measure(id), 0);
});

test('new playback instances have a bounded member capacity and expiry cleanup remains bounded', async () => {
  const id = await stream(), instances = Array.from({ length: 8 }, () => randomUUID());
  for (const playback of instances) await heartbeat('viewer', id, playback);
  await assert.rejects(heartbeat('viewer', id), /VIEWER_INSTANCE_LIMIT/);
  await heartbeat('viewer', id, instances[0], false);
  await heartbeat('viewer', id);
  assert.equal(await measure(id), 1);
  await db.exec("update live_streams.viewer_presence set expires_at=now()-interval '1 second'");
  const result = await value('select live_streams.refresh_viewer_counts(2)');
  assert.equal(result.expired_pruned, 2);
  assert.equal(await value('select count(*) from live_streams.viewer_presence'), 6);
});

test('expired Auth sessions and blocked viewers cannot renew or create leases', async () => {
  const id = await stream(), playback = randomUUID();
  await db.query("update auth.sessions set not_after=now()+interval '10 seconds' where id=$1", [sessions.viewer]);
  await heartbeat('viewer', id, playback);
  assert.equal(await value('select p.expires_at<=s.not_after from live_streams.viewer_presence p join auth.sessions s on s.id=p.auth_session_id'), true);
  await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [sessions.viewer]);
  await assert.rejects(heartbeat('viewer', id, playback), /AUTH_REQUIRED/);
  await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)', [actors.host, actors.other]);
  await assert.rejects(heartbeat('other', id), /LIVE_NOT_AVAILABLE/);
  assert.equal(await value('select count(*) from live_streams.viewer_presence where user_id=$1', [actors.other]), 0);
});

test('an expired instance must reacquire capacity before renewal', async () => {
  const id = await stream(), expired = randomUUID();
  await heartbeat('viewer', id, expired);
  await db.query("update live_streams.viewer_presence set last_seen_at=now()-interval '2 minutes',expires_at=now()-interval '1 second' where playback_id=$1", [expired]);
  for (let i = 0; i < 8; i++) await heartbeat('viewer', id);
  await assert.rejects(heartbeat('viewer', id, expired), /VIEWER_INSTANCE_LIMIT/);
  assert.equal(await value('select count(*) from live_streams.viewer_presence where expires_at>now()'), 8);
});

test('session JSON drops stale measurements and preserves the original session fields', async () => {
  const id = await stream();
  await heartbeat('viewer', id);
  await measure(id);
  const current = await value('select live_streams.session_json($1)', [id]);
  assert.equal(current.viewer_count, 1);
  await db.query("update live_streams.sessions set viewer_count_at=now()-interval '91 seconds' where id=$1", [id]);
  const stale = await value('select live_streams.session_json($1)', [id]);
  assert.equal(stale.viewer_count, null);
  assert.equal(stale.title, current.title); assert.deepEqual(stale.host, current.host); assert.equal(stale.state, current.state);
  assert.equal('chat_epoch' in stale, false); assert.equal('pinned_message_id' in stale, false); assert.equal('cover_object_path' in stale, false);
  await db.query('update live_streams.sessions set viewer_count_at=null where id=$1', [id]);
  assert.equal((await value('select live_streams.session_json($1)', [id])).viewer_count, null);
});

test('maintenance measures after provider-session acquisition to preserve event lock ordering', async () => {
  const id = await stream();
  await heartbeat('viewer', id);
  assert.equal(await measure(id), 1);
  await db.query('update live_streams.sessions set viewer_count_at=null where id=$1', [id]);
  await db.query('update live_streams.provider_sessions set authority_checked_at=null,authority_actor_id=null,authority_session_id=null where session_id=$1', [id]);
  await as('service_role', null, 'select public.live_maintenance(20)');
  const state = await value('select jsonb_build_object(\'state\',state,\'count\',viewer_count) from live_streams.sessions where id=$1', [id]);
  assert.deepEqual(state, { state: 'ending', count: 0 });
});
