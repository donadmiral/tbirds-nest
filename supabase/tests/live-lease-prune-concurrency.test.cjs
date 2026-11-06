'use strict';
// Run only in the disposable local Unix-socket database created by typecheck.yml.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {LocalPsqlSession}=require('./local-psql-session.cjs');
const source=name=>fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8');
const release=source('20261106181400_live_viewer_lease_pruning.sql');
const start=release.indexOf('create function live_streams.prune_expired_viewer_leases(');
const end=release.indexOf('comment on function live_streams.prune_expired_viewer_leases(',start);
assert.ok(start>=0&&end>start,'Load the unchanged release function including its ACL.');
const presence=source('20261104022616_live_viewer_presence.sql');
const cut=presence.indexOf('create function live_streams.viewer_heartbeat(');assert.ok(cut>0);
const fixtureDDL=`
create schema auth;
create schema live_streams;
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role'] loop
 if not exists(select from pg_roles where rolname=r) then execute format('create role %I',r);end if;
end loop;end$$;
create table public.profiles(id uuid primary key);
create table auth.sessions(id uuid primary key);
create table live_streams.sessions(id uuid primary key,state text,viewer_count int,viewer_count_at timestamptz);
`;
const room='10000000-0000-4000-8000-000000000001',sid='20000000-0000-4000-8000-000000000001';
test('two capped cleanup workers skip an uncommitted renewal and each other, and recover rolled-back claims', {timeout:25000}, async t=>{
 assert.equal(process.env.PGDATABASE,'pc_scale_live_lease_lock');
 for(const name of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[name],'No external PostgreSQL routing');
 const conn=[new LocalPsqlSession(),new LocalPsqlSession(),new LocalPsqlSession()];
 const [renew,first,second]=conn;
 try{
  const facts=await Promise.all(conn.map(c=>c.query("select (inet_server_addr() is null)::int||':'||pg_backend_pid()")));
  assert.ok(facts.every(f=>f.startsWith('1:')));assert.equal(new Set(facts).size,3);
  await renew.query(fixtureDDL+presence.slice(0,cut)+release.slice(start,end));
  await renew.query(`insert into live_streams.sessions(id,state) values('${room}','live');
  insert into auth.sessions values('${sid}');
  insert into public.profiles select md5('person'||n)::uuid from generate_series(1,12006) n;
  insert into live_streams.viewer_presence select '${room}',md5('person'||n)::uuid,'${sid}',md5('tab'||n)::uuid,
   statement_timestamp()-interval '3 minutes',case when n=2 then statement_timestamp()+interval '90 seconds' else statement_timestamp()-interval '1 minute' end
   from generate_series(1,12006) n;
  analyze live_streams.viewer_presence;`);
  // Three sessions, no sleep or optimistic timing assertion. Owner transactions
  // stay open while subsequent independent calls complete. A blocking regression
  // hits the same 2s timeout as the scheduled worker, rather than hanging CI.
  await Promise.all(conn.map(c=>c.query("set statement_timeout='2s'; set lock_timeout='250ms'")));
  await renew.query("begin;update live_streams.viewer_presence set last_seen_at=now(),expires_at=now()+interval '90 seconds' where user_id=md5('person1')::uuid");
  await first.query('begin');assert.equal(await first.query('select live_streams.prune_expired_viewer_leases(5000)'),'5000');
  const before=await second.query('select pg_current_wal_insert_lsn()');
  const started=performance.now();assert.equal(await second.query('select live_streams.prune_expired_viewer_leases(5000)'),'5000');
  const concurrentMs=performance.now()-started;assert.match(before,/^[0-9A-F]+\/[0-9A-F]+$/);
  const wal=Number(await second.query(`select pg_wal_lsn_diff(pg_current_wal_insert_lsn(),'${before}'::pg_lsn)::bigint`));assert.ok(wal>0);
  assert.equal(await second.query('select count(*) from live_streams.viewer_presence'),'7006','Only independently committed deletions are visible');
  await first.query('rollback');await renew.query('commit');
  assert.equal(await second.query('select live_streams.prune_expired_viewer_leases(5000)'),'5000','Rolled-back claims are eligible again');
  assert.equal(await second.query('select live_streams.prune_expired_viewer_leases(5000)'),'2004');
  assert.equal(await second.query('select live_streams.prune_expired_viewer_leases(5000)'),'0');
  assert.equal(await second.query("select count(*) from live_streams.viewer_presence where user_id in (md5('person1')::uuid,md5('person2')::uuid) and expires_at>clock_timestamp()"),'2');
  assert.equal(await second.query('select count(*) from live_streams.viewer_presence'),'2');
  t.diagnostic(JSON.stringify({engine:'native PostgreSQL',independent_connections:3,leases:12006,concurrent_delete_ms:+concurrentMs.toFixed(2),concurrent_delete_rows:5000,cluster_wal_delta_bytes:wal,renewed_and_fresh_leases_preserved:2}));
 }finally{await Promise.allSettled(conn.map(c=>c.close()));}
});
