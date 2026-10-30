import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test as nodeTest} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';
import {readCandidate} from './migration-source.mjs';
const db=new PGlite({extensions}),qaMode=process.env.PLATINUM_QA_LINK_PREVIEW==='1';
const currentProduction=process.env.PLATINUM_CURRENT_PRODUCTION_LINK_PREVIEW==='1';
const path='supabase/migrations/20261030000331_link_preview_verified_cache.sql';
const ids={owner:randomUUID(),other:randomUUID()};
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await rows(sql,args))[0]||{})[0];
let sql,postflight;const completed=[];
const test=(name,fn)=>nodeTest(name,async()=>{await fn();completed.push(name);});
async function as(role,id,statement,args=[],claims={}) {
 await db.exec('savepoint request');
 try {
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[id||'',role,JSON.stringify({sub:id,role,...claims})]);
  const result=await rows(statement,args);await db.exec('reset role');
  await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true)");
  await db.exec('release savepoint request');return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const claim=async id=>Object.values((await as('service_role',null,'select public.claim_link_preview_fetch($1)',[id]))[0])[0];
const claimImage=async token=>Object.values((await as('service_role',null,'select public.claim_link_preview_image($1)',[token]))[0])[0];
const store=async(url,title='Verified')=>Object.values((await as('service_role',null,'select public.store_verified_link_preview($1,$2,$3,$4,$5,$6)',[url,title,'Description','https://example.com/image.png','example.com','https://backend.supabase.co']))[0])[0];
before(async()=>{
 await loadDeployedMediaBaseline(db);await db.exec(await readCandidate());
 assert.ok(!(qaMode && currentProduction));
 // The hosted service_role has BYPASSRLS. The generic fixture deliberately
 // creates a minimal role; model the observed real role for direct cache writes.
 await db.exec('alter role service_role bypassrls');
 // Read-only production metadata confirms this core Auth column exists. The
 // generic reference fixture leaves it out until the erasure tests add it.
 await db.exec('alter table auth.users add column if not exists banned_until timestamptz');
 let preservation,beforeRows;
 if(!currentProduction) {
 await db.exec(await source('supabase/migrations/20261029224550_admin_operations_completion.sql'));
 if(qaMode) {
  const admin=await import('./qa-admin-baseline.mjs');preservation=await import('./qa-media-baseline.mjs');
  await admin.installQaAdminBaseline(db);await preservation.installQaMediaBaseline(db);
  await db.exec(await source('supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql'));
  await db.exec(await source('supabase/ops/qa/20261029233915_qa_media_completion_forward.sql'));
  for(const name of ['20261029224812_account_storage_erasure','20261029231321_account_erasure_admin_review_queue'])await db.exec(await source(`supabase/migrations/${name}.sql`));
  await (await import('./qa-database-hardening-baseline.mjs')).installQaHardeningAclBaseline(db);
  await db.exec(await source('supabase/ops/qa/20261029235400_qa_database_access_hardening_forward.sql'));
  await db.exec('revoke all on function public.upsert_link_preview(text,text,text,text,text) from public,postgres,anon,authenticated,service_role;grant execute on function public.upsert_link_preview(text,text,text,text,text) to postgres,public,anon,authenticated,service_role');
 }else{
  for(const name of ['20261029224812_account_storage_erasure','20261029224813_private_media_cutover_compatibility','20261029231321_account_erasure_admin_review_queue','20261029231440_bounded_media_delivery'])await db.exec(await source(`supabase/migrations/${name}.sql`));
  for(const name of ['notify_push_notification','notify_voip_ring','notify_voip_ring_1to1','notify_voip_ring_session'])await db.exec(`create function public.${name}() returns trigger language plpgsql security definer set search_path=public as $$begin return new;end$$;revoke all on function public.${name}() from public,anon,authenticated,service_role,postgres;grant execute on function public.${name}() to public,postgres,anon,authenticated,service_role`);
  await db.exec(await source('supabase/migrations/20261029234214_database_access_hardening.sql'));
 }
 }
 await db.exec("set session_replication_role=replica;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims','{}',false)");
 for(const [name,id]of Object.entries(ids)){
  await db.query('insert into auth.users(id,email) values($1,$2)',[id,`preview-${name}@example.test`]);
  await db.query("insert into public.profiles(id,email,username,full_name,profile_visibility) values($1,$2,$3,$3,'public')",[id,`preview-${name}@example.test`,`preview_${name}`]);
 }
 await db.query("insert into public.posts(user_id,content,link_url) values($1,'Keep this post','https://example.com/original')",[ids.owner]);
 await db.exec("insert into public.link_previews(url,title,description,image_url,domain) select 'https://example.com/'||n,'Unverified title','Unverified text','http://127.0.0.1/secret','forged' from generate_series(1,6)n;set session_replication_role=origin");
 await db.exec('begin');
 // Demonstrate the actual legacy weakness locally, then roll the proof back.
 assert.equal(await value("select md5(pg_get_functiondef('public.upsert_link_preview(text,text,text,text,text)'::regprocedure))"),'686178f5e0db6e4bf417d153a2bc585f');
 await as('anon',null,'select public.upsert_link_preview($1,$2)', ['https://example.com/1','Anonymous forged title']);
 assert.equal(await value("select title from public.link_previews where url='https://example.com/1'"),'Anonymous forged title');
 await db.exec('rollback');
 assert.equal(await value('select count(*)::int from public.link_previews'),6,'Only the synthetic exploit proof, not the pre-existing cache fixture, is rolled back');
 const posts=await rows('select to_jsonb(p) row from public.posts p order by id');
 if(qaMode)beforeRows=await preservation.qaDataSnapshot(db);
 sql=await source(path);await db.exec(sql);
 assert.deepEqual(await rows('select to_jsonb(p) row from public.posts p order by id'),posts);
 if(qaMode)assert.deepEqual(await preservation.qaDataSnapshot(db),beforeRows);
 postflight=await value(await source('supabase/ops/check-link-preview-postflight.sql'));
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
after(async()=>{
 if(process.env.LINK_PREVIEW_GATE_OUTPUT && completed.length===12)await writeFile(process.env.LINK_PREVIEW_GATE_OUTPUT,JSON.stringify({candidate:path,sha256:createHash('sha256').update(sql).digest('hex'),qaMode,currentProduction,fullAdminPrivacyHardeningChain:!currentProduction,existingPostsAndQaDataPreserved:true,testsPassed:completed.length,tests:completed,postflight,verifiedAt:new Date().toISOString()},null,2)+'\n');
 await db.close();
});
test('untrusted derived cache is invalidated while URL rows and posts remain',async()=>{
 assert.equal(await value('select count(*)::int from public.link_previews'),6);
 assert.equal(await value('select count(*)::int from public.link_previews where title is not null or description is not null or image_url is not null or domain is not null or verified_at is not null or image_origin_url is not null'),0);
 assert.equal(await value("select count(*)::int from public.posts where content='Keep this post' and link_url='https://example.com/original'"),1);
 assert.equal(await value('select count(distinct image_token)::int from public.link_previews'),6);
});
test('legacy authenticated RPC still succeeds but cannot forge or replace shared metadata',async()=>{
 await store('https://example.com/1');
 for(const role of ['authenticated','service_role'])await as(role,ids.other,'select public.upsert_link_preview($1,$2,$3,$4,$5)',['https://example.com/1','Forged','Forged','http://localhost/secret','fake']);
 await as('authenticated',ids.other,'select public.upsert_link_preview($1,$2)',['https://example.com/new','Fake'],{role:'service_role'});
 assert.equal(await value("select title from public.link_previews where url='https://example.com/1'"),'Verified');
 assert.equal(await value("select count(*)::int from public.link_previews where url='https://example.com/new'"),0);
 assert.equal(await value("select prosecdef from pg_proc where oid='public.upsert_link_preview(text,text,text,text,text)'::regprocedure"),false);
});
test('app roles cannot mutate or truncate the cache and anonymous RPC access is removed',async()=>{
 await assert.rejects(as('anon',null,"select public.upsert_link_preview('https://example.com')"),/permission denied/);
 for(const role of ['anon','authenticated','service_role'])for(const statement of ["insert into public.link_previews(url,title) values('https://example.com/fake','Fake')","update public.link_previews set title='Fake'","delete from public.link_previews","truncate public.link_previews"])
  await assert.rejects(as(role,ids.owner,statement),/permission denied/);
 assert.equal((await as('authenticated',ids.owner,'select * from public.link_previews')).length,6);
});
test('the service can persist verified metadata and stable image tokens',async()=>{
 const old=await value("select image_token from public.link_previews where url='https://example.com/1'");
 await store('https://example.com/1');
 const current=(await as('authenticated',ids.owner,"select * from public.link_previews where url='https://example.com/1'"))[0];
 assert.equal(current.title,'Verified');assert.equal(current.image_token,old);assert.ok(current.verified_at);assert.match(current.image_url,/functions\/v1\/link-preview\?image=/);
});
test('the atomic service store preserves the first token across all subsequent writes',async()=>{
 const first=await store('https://example.com/atomic'),second=await store('https://example.com/atomic','Updated');
 assert.equal(first.image_token,second.image_token);assert.equal(first.image_url,second.image_url);assert.equal(second.title,'Updated');
 assert.equal(await value('select image_token from public.link_previews where url=$1',['https://example.com/atomic']),first.image_token);
 const existing=await value("select image_token from public.link_previews where url='https://example.com/1'");assert.equal((await store('https://example.com/1')).image_token,existing);
});
test('app roles cannot call atomic writers or image budgets even with forged service claims',async()=>{
 for(const role of ['anon','authenticated']) {
  await assert.rejects(as(role,ids.owner,'select public.store_verified_link_preview($1,null,null,null,null,$2)',['https://example.com/fake','https://backend.supabase.co'],{role:'service_role'}),/permission denied/);
  await assert.rejects(as(role,ids.owner,'select public.claim_link_preview_image($1)',[randomUUID()],{role:'service_role'}),/permission denied/);
 }
 for(const name of ['image_budget','image_global_budget'])for(const role of ['anon','authenticated','service_role'])await assert.rejects(as(role,ids.owner,`select * from link_preview_service.${name}`),/permission denied/);
});
test('public image origins have a persistent per-token limit and unknown/unverified tokens cannot fetch',async()=>{
 const row=await store('https://example.com/image-budget');
 for(let i=0;i<20;i++)assert.equal(await claimImage(row.image_token),true);
 assert.equal(await claimImage(row.image_token),false);assert.equal(await claimImage(randomUUID()),false);
 const unverified=await value("select image_token from public.link_previews where url='https://example.com/1'");assert.equal(await claimImage(unverified),false);
 await db.query("update link_preview_service.image_budget set window_start=clock_timestamp()-interval '61 seconds' where image_token=$1",[row.image_token]);assert.equal(await claimImage(row.image_token),true);
});
test('distinct image tokens cannot bypass the shared origin-fetch limit',async()=>{
 const row=await store('https://example.com/global-budget');
 await db.exec("insert into link_preview_service.image_global_budget(singleton,window_start,requests) values(true,clock_timestamp(),120)");
 assert.equal(await claimImage(row.image_token),false);
 await db.exec("update link_preview_service.image_global_budget set window_start=clock_timestamp()-interval '61 seconds'");assert.equal(await claimImage(row.image_token),true);
 assert.equal(await value('select requests from link_preview_service.image_global_budget'),1);
});
test('service-only fetch budgets resist forged role claims and private budget rows remain inaccessible',async()=>{
 for(const role of ['anon','authenticated'])await assert.rejects(as(role,ids.owner,'select public.claim_link_preview_fetch($1)',[ids.owner],{role:'service_role'}),/permission denied/);
 for(const role of ['anon','authenticated','service_role'])await assert.rejects(as(role,ids.owner,'select * from link_preview_service.fetch_budget'),/permission denied/);
 assert.equal(await claim(ids.owner),true);
});
test('fetch budgets enforce eight misses per minute per real active user and reset safely',async()=>{
 for(let i=0;i<8;i++)assert.equal(await claim(ids.owner),true);
 assert.equal(await claim(ids.owner),false);assert.equal(await claim(ids.other),true);
 await db.query("update link_preview_service.fetch_budget set window_start=clock_timestamp()-interval '61 seconds' where actor_id=$1",[ids.owner]);
 assert.equal(await claim(ids.owner),true);assert.equal(await value('select requests from link_preview_service.fetch_budget where actor_id=$1',[ids.owner]),1);
 await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1",[ids.other]);
 assert.equal(await claim(ids.other),false);assert.equal(await claim(randomUUID()),false);assert.equal(await claim(null),false);
});
test('an installed client can finish a real text post and its legacy preview acknowledgment',async()=>{
 const post=(await as('authenticated',ids.owner,"insert into public.posts(user_id,content,body) values($1,'Installed client https://example.com/new','Installed client https://example.com/new') returning id",[ids.owner]))[0].id;
 await as('authenticated',ids.owner,'select public.upsert_link_preview($1,$2)',['https://example.com/new','Untrusted local result']);
 assert.equal(await value('select user_id from public.posts where id=$1',[post]),ids.owner);
 assert.equal(await value('select link_url from public.posts where id=$1',[post]),'https://example.com/new');
});
test('repeat application refuses to overwrite the new verified contract',async()=>{
 const guard=sql.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/)[0];
 await assert.rejects(db.exec(guard),/LINK_PREVIEW_FUNCTION_DRIFT/);
});
