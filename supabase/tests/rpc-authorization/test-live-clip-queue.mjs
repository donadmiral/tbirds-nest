import { before, after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const value = async sql => Object.values((await db.query(sql)).rows[0])[0];
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema live_streams;
    create table live_streams.clip_runtime(singleton boolean primary key,enabled boolean,max_active integer);
    insert into live_streams.clip_runtime values(true,false,2);
    create table live_streams.clip_jobs(id int,state text,available_at timestamptz,lease_until timestamptz);
    create table live_streams.clip_publications(state text,next_attempt_at timestamptz);
    create table live_streams.clip_cleanup(id int,state text,available_at timestamptz,lease_until timestamptz);`);
  await db.exec(await readFile(new URL('../../migrations/20261103064534_live_clip_queue_peek.sql', import.meta.url), 'utf8'));
});
after(() => db.close()); beforeEach(() => db.exec('begin')); afterEach(() => db.exec('rollback'));
const peek = () => value('select public.live_clip_queue_peek()');
test('only service can execute the fixed metadata function', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('savepoint denied'); await db.exec('set local role ' + role);
    await assert.rejects(peek(), /permission denied/); await db.exec('rollback to savepoint denied');
  }
  await db.exec('set local role service_role');
  assert.deepEqual(await peek(), { enabled: false, due: false, active: 0 });
});
test('disabled encoding is inert but due cleanup remains eligible', async () => {
  await db.exec("insert into live_streams.clip_jobs values(1,'pending',now()-interval '1 minute',null)");
  assert.deepEqual(await peek(), { enabled: false, due: false, active: 0 });
  await db.exec("insert into live_streams.clip_cleanup values(1,'pending',now()-interval '1 minute',null)");
  assert.deepEqual(await peek(), { enabled: true, due: true, active: 0 });
});
test('rendering follows current cap, due time, and expired leases with saturated count', async () => {
  await db.exec("update live_streams.clip_runtime set enabled=true; insert into live_streams.clip_jobs values(1,'pending',now()+interval '1 hour',null)");
  assert.equal((await peek()).due, false);
  await db.exec("update live_streams.clip_jobs set available_at=now()-interval '1 second'; insert into live_streams.clip_jobs select i,'leased',now(),now()+interval '5 minutes' from generate_series(2,40) i");
  assert.deepEqual(await peek(), { enabled: true, due: false, active: 2 });
  await db.exec("update live_streams.clip_jobs set lease_until=now()-interval '1 second' where state='leased'");
  assert.deepEqual(await peek(), { enabled: true, due: true, active: 0 });
});
test('scheduled publication and cleanup leases respect eligibility independently', async () => {
  await db.exec("insert into live_streams.clip_publications values('scheduled',now()+interval '1 hour'); insert into live_streams.clip_cleanup values(1,'leased',now()-interval '1 hour',now()+interval '1 minute')");
  assert.equal((await peek()).due, false);
  await db.exec("update live_streams.clip_cleanup set lease_until=now()-interval '1 second'"); assert.equal((await peek()).due, true);
  await db.exec("update live_streams.clip_cleanup set state='done'; update live_streams.clip_publications set next_attempt_at=now()-interval '1 second'");
  assert.deepEqual(await peek(), { enabled: true, due: true, active: 0 });
});
