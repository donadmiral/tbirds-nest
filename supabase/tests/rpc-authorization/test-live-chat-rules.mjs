import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline, source } from './deployed-media-baseline.mjs';
const db = new PGlite({ extensions });
const actors = Object.fromEntries(['host', 'viewer', 'follower'].map(name => [name, randomUUID()]));
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
const command = (name, action, session, payload) => as('authenticated', name, 'select public.live_command($1,$2,$3,$4)', [action, session, JSON.stringify(payload), randomUUID()]);
async function stream(chatMode = 'open') {
  const result = await command('host', 'create', null, { title: 'Chat rules', topic: 'gaming', audience: 'public' });
  await db.query("update live_streams.sessions set state='live',started_at=now(),chat_mode=$2 where id=$1", [result.session_id, chatMode]);
  return result.session_id;
}
before(async () => {
  await loadDeployedMediaBaseline(db);
  await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false');
  await db.exec(await source('supabase/migrations/20261103000609_live_portable_control_plane.sql'));
  await db.exec(await source('supabase/migrations/20261103002858_live_interactivity.sql'));
  await db.exec(await source('supabase/migrations/20261104022616_live_viewer_presence.sql'));
  await db.exec(await source('supabase/migrations/20261106030000_live_chat_followers_only.sql'));
  await db.exec(await source('supabase/migrations/20261106030500_live_viewer_counts_job.sql'));
  await db.exec("create table live_streams.test_chat_events(session_id uuid,event text,payload jsonb);create or replace function live_streams.broadcast(p_session uuid,p_event text,p_payload jsonb) returns void language sql security definer set search_path='' as $$insert into live_streams.test_chat_events values($1,$2,$3)$$;");
  for (const [name, id] of Object.entries(actors)) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `chat-${name}@example.test`]);
    await db.query("insert into public.profiles(id,username,email,full_name,profile_visibility,account_type) values($1,$2,$3,$2,'public','personal') on conflict(id) do update set username=excluded.username,profile_visibility='public'", [id, `chat_${name}`, `chat-${name}@example.test`]);
    await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')", [sessions[name], id]);
  }
});
after(() => db.close());
beforeEach(() => db.exec('begin'));
afterEach(() => db.exec('rollback'));

test('a followers-only chat tells a non-follower to follow, and accepts a follower and the host', async () => {
  const id = await stream('followers');
  await assert.rejects(command('viewer', 'chat', id, { body: 'hello' }), /FOLLOWERS_ONLY/);
  await db.query('insert into public.follows(follower_id,following_id) values($1,$2)', [actors.follower, actors.host]);
  const sent = await command('follower', 'chat', id, { body: 'hello' });
  assert.equal(sent.ok, true); assert.equal(sent.message.body, 'hello');
  assert.equal((await command('host', 'chat', id, { body: 'welcome' })).ok, true);
  const events = (await db.query('select event from live_streams.test_chat_events where session_id=$1', [id])).rows.map(row => row.event);
  assert.deepEqual(events.filter(event => event === 'message').length, 2, 'Every accepted reply is broadcast to the room');
});

test('a closed chat still says closed, an empty message is refused, and reactions need a live stream while messages do not', async () => {
  const id = await stream('closed');
  await assert.rejects(command('viewer', 'chat', id, { body: 'hello' }), /CHAT_CLOSED/);
  assert.equal((await command('host', 'chat', id, { body: 'host speaks' })).ok, true);
  const open = await stream('open');
  await assert.rejects(command('viewer', 'chat', open, { body: '   ' }), /INVALID_MESSAGE/);
  await db.query("update live_streams.sessions set state='reconnecting' where id=$1", [open]);
  await assert.rejects(command('viewer', 'reaction', open, { reaction: 'heart' }), /INVALID_REACTION/);
  assert.equal((await command('viewer', 'chat', open, { body: 'still here' })).ok, true, 'Messages are accepted while the stream reconnects');
});

test('a sender gets their own message back at once, and a retried request is not a second message', async () => {
  const id = await stream('open'), request = randomUUID();
  const first = await as('authenticated', 'viewer', 'select public.live_command($1,$2,$3,$4)', ['chat', id, JSON.stringify({ body: 'once' }), request]);
  assert.equal(first.ok, true); assert.equal(first.message.id, request); assert.equal(first.message.body, 'once');
  const again = await as('authenticated', 'viewer', 'select public.live_command($1,$2,$3,$4)', ['chat', id, JSON.stringify({ body: 'once' }), request]);
  assert.equal(again.ok, true);
  assert.equal(await value('select count(*) from live_streams.messages where session_id=$1', [id]), 1);
});

test('the viewer-count job migration is harmless where pg_cron is absent', async () => {
  assert.equal(await value("select to_regprocedure('cron.schedule(text,text,text)') is null"), true);
  assert.equal(await value("select to_regprocedure('live_streams.refresh_viewer_counts(integer)') is not null"), true);
});
