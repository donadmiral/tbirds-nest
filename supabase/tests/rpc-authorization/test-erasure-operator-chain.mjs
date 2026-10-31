import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test as nodeTest} from 'node:test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';
import {readCandidate} from './migration-source.mjs';
const db=new PGlite({extensions}),qaMode=process.env.PLATINUM_QA_ERASURE_OPERATOR==='1';
const candidate='supabase/migrations/20261030005241_account_erasure_operator_review.sql';
const restoreGuard='supabase/migrations/20261030010250_account_erasure_admin_restore_guard.sql';
const ids=Object.fromEntries(['admin','support','user','other'].map(k=>[k,randomUUID()]));
const sessions=Object.fromEntries(Object.keys(ids).map(k=>[k,randomUUID()]));
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await q(sql,args))[0]||{})[0];
const passed=[];let migration,postflight,preflight,restoreGuardPostflight;
const test=(name,fn)=>nodeTest(name,async()=>{await fn();passed.push(name);});
async function as(role,name,sql,args=[]){
 await db.exec('savepoint request');
 try{
  await db.exec(`set local role ${role}`);
  const claims={role,sub:ids[name]||null,session_id:sessions[name]||null,aal:'aal1'};
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[claims.sub||'',role,JSON.stringify(claims)]);
  const result=await value(sql,args);await db.exec('reset role');
  await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
  await db.exec('release savepoint request');return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const svc=(sql,args=[])=>as('service_role',null,sql,args);
const queue=(name='admin')=>svc('select public.triniti_admin_deletion_requests($1,$2,1)',[ids[name],sessions[name]]);
const row=async(id)=>{const r=(await queue()).rows.find(x=>x.id===id);assert.ok(r);return r;};
const object=()=>value("insert into storage.objects(bucket_id,name,owner_id,owner,version) values('post-media',$1,$2,$3,$4) returning id",[`${ids.user}/${randomUUID()}.jpg`,ids.user,ids.user,randomUUID()]);
const request=()=>as('authenticated','user','select public.request_account_erasure($1,$2)',[randomUUID(),randomBytes(32).toString('hex')]);
async function adminRequest(){
 await svc('select public.triniti_platinum_admin_command($1,$2,$3,$4,$5)',[ids.admin,sessions.admin,randomUUID(),'adminDeleteAccount',JSON.stringify({id:ids.user,reason:'Recorded synthetic account erasure request',confirm:'DELETE'})]);
 return (await queue()).rows.find(x=>x.user_id===ids.user);
}
async function review(r,change={}){
 const input={actor:ids.admin,session:sessions.admin,key:randomUUID(),source:r.source,id:r.id,version:r.version,action:'resume',note:'Investigated the recorded erasure request and current eligibility.',confirm:'RESUME',...change};
 return svc('select public.triniti_admin_erasure_review($1,$2,$3,$4,$5,$6,$7,$8,$9)',[input.actor,input.session,input.key,input.source,input.id,input.version,input.action,input.note,input.confirm]);
}
const claim=w=>svc('select public.claim_account_erasure($1)',[w]);
const prepare=(id,w)=>svc('select public.prepare_account_erasure_identity($1,$2)',[id,w]);
const finish=(id,w,error=null)=>svc('select public.finish_account_erasure($1,$2,$3)',[id,w,error]);
const holdJob=id=>q("update account_erasure.jobs set state='retention_review',reason='worker_review',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=$1",[id]);
before(async()=>{
 await loadDeployedMediaBaseline(db);await db.exec(await readCandidate());
 await db.exec(await source('supabase/migrations/20261029224550_admin_operations_completion.sql'));
 let preservation,beforeRows;
 if(qaMode){
  const admin=await import('./qa-admin-baseline.mjs');preservation=await import('./qa-media-baseline.mjs');
  await admin.installQaAdminBaseline(db);await preservation.installQaMediaBaseline(db);
  await db.exec(await source('supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql'));
  await db.exec(await source('supabase/ops/qa/20261029233915_qa_media_completion_forward.sql'));
  for(const n of ['20261029224812_account_storage_erasure','20261029231321_account_erasure_admin_review_queue'])await db.exec(await source(`supabase/migrations/${n}.sql`));
  await(await import('./qa-database-hardening-baseline.mjs')).installQaHardeningAclBaseline(db);
  await db.exec(await source('supabase/ops/qa/20261029235400_qa_database_access_hardening_forward.sql'));
 }else{
  for(const n of ['20261029224812_account_storage_erasure','20261029224813_private_media_cutover_compatibility','20261029231321_account_erasure_admin_review_queue','20261029231440_bounded_media_delivery'])await db.exec(await source(`supabase/migrations/${n}.sql`));
  for(const n of ['notify_push_notification','notify_voip_ring','notify_voip_ring_1to1','notify_voip_ring_session'])await db.exec(`create function public.${n}() returns trigger language plpgsql security definer set search_path=public as $$begin return new;end$$;revoke all on function public.${n}() from public,postgres,anon,authenticated,service_role;grant execute on function public.${n}() to public,postgres,anon,authenticated,service_role`);
  await db.exec(await source('supabase/migrations/20261029234214_database_access_hardening.sql'));
 }
 preflight=await value(await source('supabase/ops/check-erasure-operator-preflight.sql'));
 assert.equal(preflight.queue_matches,true);assert.equal(preflight.review_absent,true);
 if(qaMode)beforeRows=await preservation.qaDataSnapshot(db);
 migration=await source(candidate);await db.exec(migration);
 await db.exec(await source(restoreGuard));
 restoreGuardPostflight=await value(await source('supabase/ops/check-erasure-restore-postflight.sql'));
 if(qaMode)assert.deepEqual(await preservation.qaDataSnapshot(db),beforeRows);
 postflight=await value(await source('supabase/ops/check-erasure-operator-postflight.sql'));
 await db.exec("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims','{}',false)");
 for(const [name,id]of Object.entries(ids)){
  await q('insert into auth.users(id,email) values($1,$2)',[id,`erasure-${name}@example.test`]);
  await q('insert into public.profiles(id,email,username,full_name) values($1,$2,$3,$3) on conflict(id) do update set username=excluded.username',[id,`erasure-${name}@example.test`,`erasure_${name}`]);
  await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);
 }
 await q("insert into public.admin_users(user_id,role) values($1,'super_admin'),($2,'support_agent')",[ids.admin,ids.support]);
 await db.exec("update account_erasure.worker set secret_digest=extensions.digest('test-worker','sha256'),last_seen_at=clock_timestamp()");
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
after(async()=>{
 if(process.env.ERASURE_OPERATOR_GATE_OUTPUT && passed.length===20)await writeFile(process.env.ERASURE_OPERATOR_GATE_OUTPUT,JSON.stringify({candidate,sha256:createHash('sha256').update(migration).digest('hex'),restoreGuard,restoreGuardSha256:createHash('sha256').update(await source(restoreGuard)).digest('hex'),restoreGuardPostflight,qaMode,testsPassed:passed.length,tests:passed,preflight,postflight,qaExistingDataPreserved:qaMode,verifiedAt:new Date().toISOString()},null,2)+'\n');
 await db.close();
});
test('private review records and service contracts deny app callers',async()=>{
 for(const role of ['anon','authenticated','service_role'])await assert.rejects(as(role,'user','select * from account_erasure.reviews'),/permission denied/);
 for(const role of ['anon','authenticated'])assert.equal(await value("select has_function_privilege($1,'public.triniti_admin_erasure_review(uuid,uuid,uuid,text,uuid,text,text,text,text)','EXECUTE')",[role]),false);
 assert.equal(await value("select has_function_privilege('service_role','public.triniti_admin_erasure_review(uuid,uuid,uuid,text,uuid,text,text,text,text)','EXECUTE')"),true);
 assert.doesNotMatch(migration,/delete\s+from\s+(storage\.objects|auth\.users)/i);
});
test('staff request becomes a linked eligible worker job without deleting source records',async()=>{
 const file=await object(),r=await adminRequest();assert.equal(r.job_id,null);
 const result=await review(r);assert.equal(result.outcome,'queued');
 const next=await row(r.id);assert.equal(next.status,'queued');assert.equal(next.files_total,1);
 assert.ok(next.job_id);assert.equal(await value('select count(*)::int from storage.objects where id=$1',[file]),1);
 assert.equal(await value('select count(*)::int from auth.users where id=$1',[ids.user]),1);
 assert.equal(await value('select count(*)::int from public.profiles where id=$1',[ids.user]),1,'dry-run cleanup must roll back');
 assert.equal((await claim(randomUUID())).id,next.job_id);
});
test('notes are idempotent, private and leave erasure state unchanged',async()=>{
 const r=await adminRequest(),key=randomUUID();const result=await review(r,{key,action:'note',confirm:null});
 assert.equal(result.outcome,'noted');assert.deepEqual(await review(r,{key,action:'note',confirm:null}),result);
 assert.equal((await row(r.id)).status,'retention_review');assert.equal(await value('select count(*)::int from account_erasure.jobs'),0);
 assert.equal(await value('select count(*)::int from account_erasure.reviews'),1);
 assert.equal(await value("select count(*)::int from public.admin_audit_log where action='accountErasureReview'"),1);
});
test('changed review versions and reused keys cannot execute new work',async()=>{
 const r=await adminRequest(),key=randomUUID();await review(r,{key,action:'note',confirm:null});
 await assert.rejects(review(r),/ERASURE_REVIEW_STALE/);
 await assert.rejects(review(r,{key}),/COMMAND_KEY_REUSED/);
 assert.equal(await value('select count(*)::int from account_erasure.jobs'),0);
});
test('live role and native-session checks run before replay',async()=>{
 const r=await adminRequest(),key=randomUUID();await review(r,{key,action:'note',confirm:null});
 await assert.rejects(review(r,{actor:ids.support,session:sessions.support}),/ADMIN_PERMISSION_DENIED/);
 await q('delete from auth.sessions where id=$1',[sessions.admin]);
 await assert.rejects(review(r,{key,action:'note',confirm:null}),/ACTIVE_ADMIN_SESSION_REQUIRED/);
});
test('resume requires explicit confirmation and valid source without auditing a false action',async()=>{
 const r=await adminRequest();
 await assert.rejects(review(r,{confirm:null}),/CONFIRMATION_REQUIRED/);
 await assert.rejects(review(r,{source:'anything'}),/INVALID_ERASURE_REVIEW/);
 await assert.rejects(review(r,{note:'too short'}),/INVALID_ERASURE_REVIEW/);
 assert.equal(await value('select count(*)::int from account_erasure.reviews'),0);
});
test('financial obligations remain held, including zero balances',async()=>{
 await q("insert into creator_finance.balances(user_id,currency,bucket,amount_minor) values($1,'USD','available',0)",[ids.user]);
 const r=await adminRequest(),result=await review(r);assert.equal(result.outcome,'held');assert.equal(result.hold_reason,'financial_records');
 assert.equal((await row(r.id)).status,'retention_review');assert.equal(await value('select count(*)::int from account_erasure.jobs'),0);
 assert.equal(await value('select count(*)::int from creator_finance.balances where user_id=$1',[ids.user]),1);
});
test('managed staff identity remains held after staff deactivation',async()=>{
 await q("insert into public.admin_users(user_id,role,active) values($1,'super_admin',false)",[ids.user]);
 const r=await adminRequest(),result=await review(r);assert.equal(result.outcome,'held');assert.equal(result.hold_reason,'managed_account');
 assert.equal(await value('select count(*)::int from public.admin_users where user_id=$1',[ids.user]),1);
 assert.equal(await value('select count(*)::int from account_erasure.jobs'),0);
});
test('ambiguous ownership cannot be overridden or treated as an erasure manifest',async()=>{
 await q("insert into storage.objects(bucket_id,name,version) values('post-media',$1,'v1')",[`${ids.user}/unknown.jpg`]);
 const r=await request(),result=await review(await row(r.requestId));assert.equal(result.outcome,'held');assert.equal(result.hold_reason,'ownership_review');
 assert.equal(await value('select count(*)::int from account_erasure.objects'),0);assert.equal(await claim(randomUUID()),null);
});
test('unhealthy worker prevents eligible scheduling atomically',async()=>{
 const r=await adminRequest();await db.exec("update account_erasure.worker set last_seen_at=clock_timestamp()-interval '1 day'");
 await assert.rejects(review(r),/ERASURE_WORKER_UNAVAILABLE/);assert.equal(await value('select count(*)::int from account_erasure.jobs'),0);
 assert.equal(await value('select count(*)::int from account_erasure.reviews'),0);
});
test('application cleanup failure remains an explicit hold with source data preserved',async()=>{
 const r=await adminRequest();
 await db.exec("create or replace function account_erasure.erase_app_records(p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$begin raise exception 'synthetic cleanup failure';end$$");
 assert.equal((await review(r)).hold_reason,'application_review');assert.equal(await value('select count(*)::int from public.profiles where id=$1',[ids.user]),1);
 assert.equal(await value('select count(*)::int from account_erasure.jobs'),0);
});
test('partial file progress, cache deadline, receipt and retry history survive review',async()=>{
 const f1=await object();await object();const r=await request(),w=randomUUID();await claim(w);
 await q('delete from storage.objects where id=$1',[f1]);
 assert.equal(await svc('select public.ack_account_erasure_object($1,$2,$3)',[r.requestId,w,f1]),true);
 await q('update account_erasure.jobs set attempts=12 where id=$1',[r.requestId]);await holdJob(r.requestId);
 const before=(await q('select receipt_digest,cache_until,deleted_count,attempts from account_erasure.jobs where id=$1',[r.requestId]))[0];
 assert.equal((await review(await row(r.requestId))).outcome,'queued');
 const after=(await q('select receipt_digest,cache_until,deleted_count,attempts from account_erasure.jobs where id=$1',[r.requestId]))[0];assert.deepEqual(after,before);
 assert.equal((await row(r.requestId)).files_erased,1);assert.equal((await row(r.requestId)).files_total,2);
 assert.equal(await claim(randomUUID()),null,'cache wait is preserved before the next worker can run');
});
test('changed stored-object versions remain held without refreshing the proof',async()=>{
 const file=await object(),r=await request();await holdJob(r.requestId);
 await db.exec('set local session_replication_role=replica');await q("update storage.objects set version='changed' where id=$1",[file]);await db.exec('set local session_replication_role=origin');
 const before=await value('select version from account_erasure.objects where object_id=$1',[file]);
 const result=await review(await row(r.requestId));assert.equal(result.hold_reason,'storage_changed');
 assert.equal(await value('select version from account_erasure.objects where object_id=$1',[file]),before);
});
test('an active lease is never stolen by an operator',async()=>{
 const r=await request();await holdJob(r.requestId);await q("update account_erasure.jobs set lease_token=$1,lease_until=clock_timestamp()+interval '5 minutes' where id=$2",[randomUUID(),r.requestId]);
 await assert.rejects(review(await row(r.requestId)),/ERASURE_WORKER_ACTIVE/);
});
test('identity provider failure preserves the prepared phase through exhaustion and resume',async()=>{
 const r=await request(),w=randomUUID();await claim(w);assert.equal(await prepare(r.requestId,w),'ready');
 assert.equal(await value('select identity_prepared from account_erasure.jobs where id=$1',[r.requestId]),true);
 await q('update account_erasure.jobs set attempts=11 where id=$1',[r.requestId]);await finish(r.requestId,w,'identity_unavailable');
 assert.equal((await row(r.requestId)).status,'retention_review');
 await db.exec("create or replace function account_erasure.erase_app_records(p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$begin raise exception 'must not repeat prepared cleanup';end$$");
 assert.equal((await review(await row(r.requestId))).outcome,'identity_pending');
 const w2=randomUUID();assert.equal((await claim(w2)).state,'identity_pending');assert.equal(await prepare(r.requestId,w2),'ready');
 assert.equal(await finish(r.requestId,w2),false,'provider identity still exists');
 await q('delete from auth.users where id=$1',[ids.user]);assert.equal(await finish(r.requestId,w2),true);
 assert.equal((await row(r.requestId)).status,'completed');
});
test('admin progress mirrors only verified completion and survives technical receipt expiry',async()=>{
 const r=await adminRequest();await review(r);const job=(await row(r.id)).job_id,w=randomUUID();await claim(w);
 assert.equal(await prepare(job,w),'ready');assert.equal(await finish(job,w),false);assert.notEqual((await row(r.id)).status,'completed');
 await q('delete from auth.users where id=$1',[ids.user]);assert.equal(await finish(job,w),true);
 assert.equal((await row(r.id)).status,'completed');assert.ok((await row(r.id)).completed_at);
 await q("update account_erasure.jobs set completed_at=clock_timestamp()-interval '31 days' where id=$1",[job]);await claim(randomUUID());
 const final=await row(r.id);assert.equal(final.status,'completed');assert.equal(final.files_total,0);assert.equal(final.files_erased,0);assert.ok(final.completed_at);
});
test('completed and queued requests cannot be reactivated by another review command',async()=>{
 const r=await adminRequest();await review(r);await assert.rejects(review(await row(r.id)),/ERASURE_NOT_REVIEWABLE/);
 const job=(await row(r.id)).job_id,w=randomUUID();await claim(w);await prepare(job,w);await q('delete from auth.users where id=$1',[ids.user]);await finish(job,w);
 await assert.rejects(review(await row(r.id)),/ERASURE_NOT_REVIEWABLE/);
 assert.equal((await review(await row(r.id),{action:'note',confirm:null})).outcome,'noted');assert.equal((await row(r.id)).status,'completed');
});
test('a staff request added after member scheduling follows that job through completion and receipt expiry',async()=>{
 const self=await request(),r=await adminRequest();
 assert.equal((await queue()).rows.filter(x=>x.user_id===ids.user).length,1);assert.equal(r.status,'queued');
 assert.equal(await value('select erasure_job_id from admin_ops.deletion_requests where id=$1',[r.id]),null);
 const w=randomUUID();assert.equal((await claim(w)).id,self.requestId);await prepare(self.requestId,w);
 await q('delete from auth.users where id=$1',[ids.user]);assert.equal(await finish(self.requestId,w),true);
 assert.equal((await row(r.id)).status,'completed');assert.equal((await row(r.id)).job_id,self.requestId);
 assert.equal((await queue()).rows.filter(x=>x.id===self.requestId).length,0,'linked member job must not appear twice');
 await q("update account_erasure.jobs set completed_at=clock_timestamp()-interval '31 days' where id=$1",[self.requestId]);await claim(randomUUID());
 assert.equal((await row(r.id)).status,'completed');assert.ok((await row(r.id)).completed_at);
});
test('any audit failure rolls back scheduling, link and private review together',async()=>{
 const r=await adminRequest();await db.exec("create function public.fail_erasure_audit() returns trigger language plpgsql as $$begin if new.action='accountErasureReview' then raise exception 'synthetic audit failure';end if;return new;end$$;create trigger synthetic_erasure_audit before insert on public.admin_audit_log for each row execute function public.fail_erasure_audit()");
 await assert.rejects(review(r),/synthetic audit failure/);assert.equal(await value('select count(*)::int from account_erasure.jobs'),0);
 assert.equal(await value('select count(*)::int from account_erasure.reviews'),0);assert.equal((await row(r.id)).job_id,null);
});
test('ordinary restore cannot bypass a self-service hold before or after operator resume',async()=>{
 const requestRow=await request();await holdJob(requestRow.requestId);
 const restore=()=>svc('select public.triniti_platinum_admin_command($1,$2,$3,$4,$5)',
  [ids.admin,sessions.admin,randomUUID(),'restoreUser',JSON.stringify({id:ids.user})]);
 await assert.rejects(restore(),/DELETION_REVIEW_REQUIRED/);
 assert.equal((await review(await row(requestRow.requestId))).outcome,'queued');
 await assert.rejects(restore(),/DELETION_REVIEW_REQUIRED/);
 assert.equal(await value('select banned_until is not null from auth.users where id=$1',[ids.user]),true);
});
