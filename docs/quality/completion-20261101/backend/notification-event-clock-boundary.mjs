import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const {PGlite}=createRequire(resolve('supabase/tests/rpc-authorization/package.json'))('@electric-sql/pglite');

// Local-only reproducer: keep the exact production table constraint and insert
// a small scheduling delay between the two fixture timestamp evaluations.
const sourcePath='supabase/ops/qa/notification-event-dispatch/20261031022749_notification_event_dispatch_capabilities.sql';
const source=readFileSync(sourcePath,'utf8');
const table=source.match(/create table notification_delivery\.event_jobs\([\s\S]*?\n\);/)[0];
const db=new PGlite();
const id=randomUUID();
try {
 await db.exec('create schema notification_delivery;create table public.notifications(id uuid primary key);create table public.call_sessions(id uuid primary key);'+table);
 await db.query('insert into public.notifications values($1)',[id]);
 await db.query("insert into notification_delivery.event_jobs(notification_id,token_digest,created_at,expires_at) values($1,decode(repeat('ab',32),'hex'),statement_timestamp(),statement_timestamp()+interval '2 minutes')",[id]);
 await db.exec("create function public.fixture_delayed_clock(stable_clock boolean) returns timestamptz language plpgsql as $$begin perform pg_sleep(0.01);return case when stable_clock then statement_timestamp() else clock_timestamp() end;end$$");
 let oldError;
 try {
  await db.exec("update notification_delivery.event_jobs set created_at=clock_timestamp()-interval '8 days',expires_at=public.fixture_delayed_clock(false)-interval '8 days'+interval '2 minutes'");
 } catch(error) {oldError={code:error.code,constraint:error.constraint};}
 assert.deepEqual(oldError,{code:'23514',constraint:'event_jobs_check1'});
 await db.exec("update notification_delivery.event_jobs set created_at=statement_timestamp()-interval '8 days',expires_at=public.fixture_delayed_clock(true)-interval '8 days'+interval '2 minutes'");
 const row=(await db.query("select extract(epoch from(expires_at-created_at))*1000 as duration_ms from notification_delivery.event_jobs")).rows[0];
 assert.equal(Number(row.duration_ms),120000);
 const result={productionSqlSha256:createHash('sha256').update(source).digest('hex'),exactProductionTableDdlUsed:true,productionSqlChanged:false,controlledSchedulingDelayMs:10,oldVolatileClockError:oldError,newStatementClockDurationMs:Number(row.duration_ms),newStatementClockAccepted:true,scope:'Local PGlite reproduction only; no hosted write'};
 writeFileSync('docs/quality/completion-20261101/backend/notification-event-clock-boundary.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
} finally {await db.close();}
