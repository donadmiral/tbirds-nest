import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { source } from './deployed-media-baseline.mjs';

test('hot rooms batch by access epoch; small rooms, moderation and chat retain direct delivery', async () => {
  const db = new PGlite();
  try {
    const old = await source('supabase/migrations/20261103000609_live_portable_control_plane.sql');
    const start = old.indexOf('create function live_streams.broadcast(');
    assert.ok(start >= 0);
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema realtime; create schema live_streams;
      create table live_streams.sessions(id uuid primary key, chat_epoch uuid, viewer_count bigint, state text);
      create table live_streams.settings(singleton bool primary key);
      insert into live_streams.settings values(true);
      create table public.sent(payload jsonb,event text,topic text,private boolean);
      create function realtime.send(jsonb,text,text,boolean) returns void language sql as 'insert into public.sent values($1,$2,$3,$4)';`);
    await db.exec(old.slice(start,old.indexOf('create function live_streams.provider_access(',start)));
    await db.exec(await source('supabase/migrations/20261106220500_live_reaction_batches.sql'));
    const [sid,epoch,otherEpoch,small] = Array.from({length:4},()=>randomUUID());
    await db.query("insert into live_streams.sessions values($1,$2,100000,'live'),($3,$4,100,'live')",[sid,epoch,small,otherEpoch]);
    const send = (room,kind,payload)=>db.query('select live_streams.broadcast($1,$2,$3)',[room,kind,JSON.stringify(payload)]);
    const tap = (room,reaction)=>send(room,'reaction',{id:randomUUID(),reaction});
    const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
    await tap(sid,'heart');
    assert.equal(await scalar('select count(*)::int from sent'),1);
    await db.exec('truncate sent; update live_streams.settings set reaction_batch_viewers=1000');
    await tap(small,'fire'); await send(sid,'message',{body:'hello'}); await send(sid,'warning',{user_id:randomUUID()});
    assert.equal(await scalar('select count(*)::int from sent'),4);
    await db.exec('truncate sent');
    for(let i=0;i<25;i++) await tap(sid,i<15?'heart':i<22?'fire':'applause');
    assert.equal(await scalar('select count(*)::int from sent'),0);
    assert.equal(await scalar('select sum(taps)::int from live_streams.reaction_batches'),25);
    await db.exec("update live_streams.reaction_batches set window_at=window_at-interval '10 seconds'");
    assert.equal(await scalar('select live_streams.flush_reaction_batches()'),1);
    const [event]=(await db.query('select * from sent')).rows;
    assert.equal(event.topic,'live:'+sid+':'+epoch);assert.equal(event.private,true);assert.equal(event.payload.reaction,'heart');
    assert.deepEqual(event.payload.counts,{heart:15,fire:7,applause:3});
    assert.equal(await scalar('select live_streams.flush_reaction_batches()'),0);
    await tap(sid,'fire'); await db.query('update live_streams.sessions set chat_epoch=$2 where id=$1',[sid,randomUUID()]);
    await db.exec("update live_streams.reaction_batches set window_at=now()-interval '10 seconds'");
    assert.equal(await scalar('select live_streams.flush_reaction_batches()'),0);
    assert.equal(await scalar('select count(*)::int from live_streams.reaction_batches'),0);
    assert.equal(await scalar("select has_function_privilege('authenticated','live_streams.flush_reaction_batches()','execute')"),false);
    assert.equal(await scalar("select has_table_privilege('authenticated','live_streams.reaction_batches','insert')"),false);
  } finally { await db.close(); }
});
