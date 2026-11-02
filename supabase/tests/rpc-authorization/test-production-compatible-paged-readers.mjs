import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';

// The actual captured production visual baseline deliberately has no creative,
// media-ticket, account-erasure or music schemas/columns. No canonical actor,
// rights or creative acknowledgement stub is supplied during installation.
const db=new PGlite({extensions});
const id=n=>'71000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ids={owner:id(1),viewer:id(2),foreign:id(3),business:id(4)};
const sessions={owner:id(101),viewer:id(102),foreign:id(103),business:id(104)};
const book=id(1000),hiddenBook=id(1001),story=n=>id(2000+n),page=n=>id(3000+n);
const migrationPath='supabase/migrations/20261102162736_production_compatible_paged_readers.sql';
const migration=await source(migrationPath);
const manifest=JSON.parse(await source('supabase/ops/production-compatible-readers-20261102/source-manifest.json'));
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await q(sql,args))[0]||{})[0];
let baseline,installed,legacyBook,legacyShelf,legacyExpired;
const preflightRejections=[];

async function as(name,sql,args=[],{role='authenticated',session=sessions[name],claims={}}={}){
 await db.exec('savepoint request');
 try{
  await db.exec(`set local role ${role}`);
  const jwt={sub:ids[name]||null,session_id:session||null,role,is_anonymous:false,iss:'https://fixture.supabase.co/auth/v1',...claims};
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[ids[name]||'',jwt.role,JSON.stringify(jwt)]);
  const result=await value(sql,args);
  await db.exec("reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true),set_config('request.jwt.claims','{}',true);release savepoint request");
  return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const capabilities=(name='owner',options)=>as(name,'select public.get_paged_reader_capabilities()',[],options);
const read=(name='viewer',cursor=null,limit=17,album=book)=>as(name,'select public.get_memory_book_page_v2($1,$2,$3)',[album,cursor,limit]);
const shelf=(name='viewer',cursor=null,limit=5,owner=ids.owner)=>as(name,'select public.get_memory_books_page_v2($1,$2,$3)',[owner,cursor,limit]);
const window=(anchor,revision,before=7,after=11,name='viewer')=>as(name,'select public.get_memory_book_window_v3($1,$2,$3,$4,$5)',[book,anchor,revision,before,after]);
const enable=()=>db.exec('update read_paging.settings set books_ready=true,inbox_ready=true where singleton;');
async function existingState(){
 return{
  functions:await q("select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) hash,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','auth') order by signature"),
  policies:await q("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in('public','storage') order by schemaname,tablename,policyname"),
  columns:await q("select table_schema,table_name,column_name,data_type,column_default,is_nullable from information_schema.columns where table_schema in('public','auth','storage') order by table_schema,table_name,ordinal_position"),
  tables:await q("select n.nspname,c.relname,c.relrowsecurity,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage') and c.relkind='r' order by n.nspname,c.relname"),
  hooks:await q('select setdatabase,setrole,setconfig from pg_db_role_setting order by setdatabase,setrole'),
  buckets:await q('select * from storage.buckets order by id'),
 };
}

before(async()=>{
 await loadDeployedMediaBaseline(db);
 for(const[name,uid]of Object.entries(ids)){
  await q('insert into auth.users(id,email) values($1,$2)',[uid,`paged-production-${name}@example.invalid`]);
  await q("update public.profiles set username=$1,profile_visibility='public',account_type=$2 where id=$3",[`paged_prod_${name}`,name==='business'?'business':'personal',uid]);
  await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],uid]);
 }
 await q("insert into public.memory_albums(id,user_id,title,subtitle,cover_color,cover_design,audience,is_default,created_at) values($1,$2,'Production book','Existing subtitle','sage','keepsake','profile',true,'2026-01-01'),($3,$4,'Private book','Private subtitle','ink','classic','only_me',false,'2026-01-02')",[book,ids.owner,hiddenBook,ids.foreign]);
 for(let n=1;n<=83;n++){
  await q("insert into public.stories(id,user_id,media_type,media_url,thumbnail_url,caption,expires_at,created_at) values($1,$2,$3,$4,$5,$6,now()-interval '1 day','2026-01-01')",[story(n),ids.owner,n%2?'image':'video',`https://fixture.invalid/story-${n}`,`https://fixture.invalid/thumb-${n}`,`Story ${n}`]);
  await q("insert into public.memory_pages(id,album_id,user_id,story_id,sort_order,created_at,style,caption) values($1,$2,$3,$4,$5,'2026-01-01'::timestamptz+$6::integer*interval '1 microsecond','polaroid',$7)",[page(n),book,ids.owner,story(n),Math.floor(n/5),n%2,`Page ${n}`]);
 }
 await q('update public.memory_albums set cover_story_id=$1 where id=$2',[story(79),book]);
 for(let n=1;n<=16;n++)await q("insert into public.memory_albums(id,user_id,title,subtitle,cover_color,cover_design,audience,is_default,created_at) values($1,$2,$3,'','sage','keepsake','profile',false,'2026-02-01'::timestamptz+$4::integer*interval '1 second')",[id(1100+n),ids.owner,`Shelf ${n}`,n]);
 await db.exec('begin');
 legacyBook=await as('viewer','select public.get_memory_book($1)',[book]);
 legacyShelf=await as('viewer','select public.get_memory_albums($1)',[ids.owner]);
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessions.viewer]);
 legacyExpired=await as('viewer','select public.get_memory_book($1)',[book]);
 await db.exec('rollback');
 for(const[label,mutation,pattern]of[
  ['reader body drift',"create or replace function public.get_memory_book(p_album uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin return '{}'::jsonb;end$$",/PRODUCTION_READER_BASELINE_CHANGED/],
  ['disabled cover guard','alter table public.memory_albums disable trigger memory_book_cover',/PRODUCTION_READER_COVER_GUARD_REQUIRED/],
  ['missing managed Auth column','alter table auth.users drop column banned_until',/PRODUCTION_READER_AUTH_COLUMNS_REQUIRED/],
 ]){
  await db.exec('begin');await db.exec(mutation);
  await assert.rejects(db.exec(migration),pattern);
  await db.exec('rollback');
  assert.equal(await value("select to_regnamespace('read_paging_support')"),null);
  preflightRejections.push(label);
 }
 baseline=await existingState();
 await db.exec(migration);
 installed=await existingState();
});
beforeEach(()=>db.exec('begin'));
afterEach(()=>db.exec('rollback'));
after(()=>db.close());

test('the manifest seals the new migration and every reviewed source/adaptation',async()=>{
 assert.equal(manifest.migration,migrationPath);
 assert.equal(createHash('sha256').update(migration).digest('hex'),manifest.migration_sha256);
 for(const unit of manifest.source_units){
  const original=await source(unit.path);
  assert.equal(createHash('sha256').update(original).digest('hex'),unit.sha256,unit.path);
  let expected=original.replace(/^begin;\s*\n/im,'').replace(/^set local (?:lock_timeout|statement_timeout)\s*=.*?;\s*\n/gim,'').replace(/^commit;\s*$/im,'');
  for(const change of unit.adaptations){
   assert.equal(expected.split(change.before).length-1,change.occurrences,change.label);
   expected=expected.split(change.before).join(change.after);
  }
  const name=unit.path.split('/').at(-1),start=`-- BEGIN REVIEWED READER SOURCE: ${name}\n`,end=`\n-- END REVIEWED READER SOURCE: ${name}`;
  assert.equal(migration.split(start)[1]?.split(end)[0],expected.trimEnd(),name);
 }
});

test('every pre-existing public/Auth function, policy, column, table ACL, request hook and bucket is unchanged',async()=>{
 const oldSignatures=new Set(baseline.functions.map(row=>row.signature));
 assert.deepEqual(installed.functions.filter(row=>oldSignatures.has(row.signature)),baseline.functions);
 for(const key of ['policies','columns','tables','hooks','buckets'])assert.deepEqual(installed[key],baseline[key],key);
 for(const schema of ['memory_creative','account_erasure','media_delivery','music_library','business_auth'])assert.equal(await value('select to_regnamespace($1)',[schema]),null,schema);
 assert.equal(await value("select to_regprocedure('public.sound_rights_allow(uuid,text)')"),null);
 assert.equal(await value("select to_regprocedure('public.get_memory_book_creative_capabilities()')"),null);
 assert.deepEqual(await as('viewer','select public.get_memory_book($1)',[book]),legacyBook);
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessions.viewer]);
 assert.deepEqual(await as('viewer','select public.get_memory_book($1)',[book]),legacyExpired,'legacy reader/session behavior remains unchanged');
});

test('readiness is default-off and every unsupported identity sees both capabilities false',async()=>{
 assert.deepEqual(await value("select to_jsonb(s) from read_paging.settings s"),{singleton:true,books_ready:false,inbox_ready:false});
 let caps=await capabilities();assert.equal(caps.books,false);assert.equal(caps.books_window,false);assert.equal(caps.inbox,false);
 await assert.rejects(read(),/PAGED_BOOK_READER_NOT_READY/);
 await enable();caps=await capabilities('business');
 assert.equal(caps.books,false);assert.equal(caps.books_window,false);assert.equal(caps.inbox,false);
 await assert.rejects(read('business'),/BUSINESS_SESSION_REQUIRED/);
 await assert.rejects(as('business',"select public.get_inbox_page_v2('personal',null,10)"),/PAGED_INBOX_READER_NOT_READY/);
 caps=await capabilities('owner');assert.equal(caps.books,true);assert.equal(caps.books_window,true);assert.equal(caps.inbox,true);
});

test('isolated authority helpers/state stay private, reviewed bounded helper grants stay exact, and service labels alone cannot enable',async()=>{
 const access=await q("select n.nspname,p.oid::regprocedure::text signature,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') app,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('read_paging_support','read_paging')");
 assert.ok(access.length>8);
 for(const row of access){
  assert.equal(row.anon||row.service,false,row.signature);
  assert.equal(row.app,['read_paging.inbox_unread(uuid[])','read_paging.inbox_has_unread(uuid)'].includes(row.signature),row.signature);
 }
 await assert.rejects(as('owner','select * from read_paging.settings'),/permission denied/);
 await assert.rejects(as('owner','select read_paging_support.actor(false)'),/permission denied/);
 await assert.rejects(as('owner','select public.configure_paged_readers(true,true)',[],{claims:{role:'service_role'}}),/permission denied/);
 await assert.rejects(as(null,'select public.configure_paged_readers(true,true)',[],{role:'postgres',claims:{role:'service_role'}}),/SERVICE_ROLE_REQUIRED/);
 await as(null,'select public.configure_paged_readers(true,true)',[],{role:'service_role',claims:{role:'service_role'}});
 assert.equal((await capabilities()).books,true);
});

test('valid personal sessions retain exact original book count, order, cover and visual metadata without fabricated audio/creative keys',async()=>{
 await enable();let cursor=null,all=[],first;
 do{const result=await read('viewer',cursor);first??=result;assert.ok(result.pages.length<=17);all.push(...result.pages);cursor=result.next_cursor;assert.equal(result.has_more,Boolean(cursor));}while(cursor);
 assert.equal(first.count,83);assert.equal(first.count,legacyBook.count);
 assert.deepEqual(all.map(p=>p.id),legacyBook.pages.map(p=>p.id));
 for(const key of ['title','subtitle','cover_color','cover_design','cover_story_id','cover_page','audience','user_id','is_default'])assert.deepEqual(first[key],legacyBook[key],key);
 assert.equal(first.is_owner,false);assert.equal(first.can_view,true);
 for(const key of ['soundtrack','cover_artwork','film_settings','presentation_revision'])assert.equal(Object.hasOwn(first,key),false,key);
 for(const item of all)for(const key of ['audio_sound_id','audio_duration_sec','audio_title','audio_url'])assert.equal(Object.hasOwn(item,key),false,key);
 assert.equal(new Set(all.map(p=>p.id)).size,83);
});

test('shelf, next-book and default-book APIs preserve existing ordering and bounded projection',async()=>{
 await enable();let cursor=null,books=[];
 do{const result=await shelf('viewer',cursor,5);assert.ok(result.books.length<=5);books.push(...result.books);cursor=result.next_cursor;}while(cursor);
 assert.deepEqual(books.map(b=>b.id),legacyShelf.books.map(b=>b.id));
 const next=await as('viewer','select public.get_next_memory_book_v2($1,true)',[book]);
 assert.equal(next.id,books[1].id);
 const defaultBook=await as('viewer','select public.get_default_memory_book_page_v3($1)',[ids.owner]);
 assert.equal(defaultBook.id,book);assert.equal(defaultBook.pages.length,24);assert.equal(defaultBook.count,83);
});

test('bidirectional windows keep exact anchor, tie ordering, envelope bounds and forward continuation',async()=>{
 await enable();const first=await read();const expected=legacyBook.pages.map(p=>p.id),anchor=expected[40];
 const result=await window(anchor,first.revision);
 assert.deepEqual(result.pages.map(p=>p.id),expected.slice(33,52));assert.equal(result.anchor_index,7);
 assert.equal(result.has_previous,true);assert.equal(result.has_more,true);assert.ok(result.pages.length<=48);
 const continued=await read('viewer',result.next_cursor,17);
 assert.deepEqual(continued.pages.map(p=>p.id),expected.slice(52,69));
 await assert.rejects(window(anchor,first.revision,24,24),/INVALID_BOOK_WINDOW/);
 const start=await window(expected[0],first.revision);assert.equal(start.has_previous,false);assert.equal(start.anchor_index,0);
});

test('cursor binding and hidden-library envelopes retain current authorization before revision disclosure',async()=>{
 await enable();const first=await read();
 await assert.rejects(read('owner',first.next_cursor),/INVALID_BOOK_CURSOR/);
 await assert.rejects(read('viewer',{...first.next_cursor,album:hiddenBook}),/INVALID_BOOK_CURSOR/);
 await q("update public.memory_albums set audience='only_me' where user_id=$1",[ids.owner]);
 const result=await shelf('viewer',{version:2,owner:ids.owner,viewer:ids.viewer,revision:'999999',rank:0,created_at:'2026-01-01',id:book});
 assert.deepEqual(result,{version:2,is_owner:false,can_view:false,books:[],revision:'0',next_cursor:null,has_more:false});
 const denied=await read();assert.equal(denied.can_view,false);assert.deepEqual(denied.pages,[]);
});

test('expired, deleted, wrong-owner, anonymous and banned Auth sessions fail closed without changing legacy session behavior',async()=>{
 await enable();
 for(const options of [{session:sessions.owner},{session:null},{claims:{is_anonymous:true}}]){
  const caps=await capabilities('viewer',options);assert.equal(caps.books,false);assert.equal(caps.inbox,false);
  await assert.rejects(as('viewer','select public.get_memory_book_page_v2($1,null,10)',[book],options),/MEDIA_SESSION_REQUIRED/);
 }
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessions.viewer]);
 assert.equal((await capabilities('viewer')).books,false);await assert.rejects(read(),/MEDIA_SESSION_REQUIRED/);
 await q('update auth.sessions set not_after=null where id=$1',[sessions.viewer]);
 await q("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[ids.viewer]);
 assert.equal((await capabilities('viewer')).inbox,false);await assert.rejects(read(),/MEDIA_SESSION_REQUIRED/);
 await q('update auth.users set banned_until=null,deleted_at=now() where id=$1',[ids.viewer]);
 assert.equal((await capabilities('viewer')).books,false);await assert.rejects(read(),/MEDIA_SESSION_REQUIRED/);
 await q('update auth.users set deleted_at=null where id=$1',[ids.viewer]);
 await q('delete from auth.sessions where id=$1',[sessions.viewer]);
 assert.equal((await capabilities('viewer')).books,false);await assert.rejects(read(),/MEDIA_SESSION_REQUIRED/);
});

test('deactivated profiles and subsequently revoked book audience/block permissions are checked on every call',async()=>{
 await enable();const first=await read();
 await q('update public.profiles set deactivated_at=now() where id=$1',[ids.viewer]);
 assert.equal((await capabilities('viewer')).books,false);await assert.rejects(read(),/ACTIVE_PROFILE_REQUIRED/);
 await q('update public.profiles set deactivated_at=null where id=$1',[ids.viewer]);
 await q('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[ids.owner,ids.viewer]);
 const denied=await read('viewer',first.next_cursor);assert.equal(denied.can_view,false);assert.deepEqual(denied.pages,[]);
 const deniedWindow=await window(legacyBook.pages[30].id,first.revision);assert.equal(deniedWindow.can_view,false);
});

test('counter-only story updates do not invalidate history; relevant current and later-added audio fields do',async()=>{
 await enable();const first=await read();
 await q('update public.stories set views_count=views_count+1 where id=$1',[story(5)]);
 assert.equal((await read()).revision,first.revision);
 await q("update public.stories set caption=caption||' edited' where id=$1",[story(5)]);
 await assert.rejects(read('viewer',first.next_cursor),/MEMORY_BOOK_CHANGED/);
 let current=await read();
 await db.exec('alter table public.stories add column audio_sound_id uuid;');
 await q('update public.stories set audio_sound_id=$1 where id=$2',[id(9000),story(5)]);
 await assert.rejects(read('viewer',current.next_cursor),/MEMORY_BOOK_CHANGED/);
 current=await read();await q('update public.stories set views_count=views_count+1 where id=$1',[story(5)]);
 assert.equal((await read()).revision,current.revision);
});

test('later installed erasure/creative authority contracts propagate denials and do not silently fall back',async()=>{
 await enable();
 await db.exec("create schema account_erasure;revoke all on schema account_erasure from public,anon,authenticated,service_role;");
 assert.equal((await capabilities()).books,false);await assert.rejects(read('owner'),/ACCOUNT_ERASURE_GUARD_UNAVAILABLE/);
 await db.exec("create function account_erasure.assert_writable(uuid) returns void language plpgsql security definer set search_path='' as $$begin raise exception 'SYNTHETIC_ERASURE_PENDING' using errcode='42501';end$$;revoke all on function account_erasure.assert_writable(uuid) from public,anon,authenticated,service_role;");
 assert.equal((await capabilities()).inbox,false);await assert.rejects(read('owner'),/SYNTHETIC_ERASURE_PENDING/);
 await db.exec("create or replace function account_erasure.assert_writable(uuid) returns void language plpgsql security definer set search_path='' as $$begin return;end$$;");
 assert.equal((await capabilities()).books,true);
 await db.exec("create schema memory_creative;revoke all on schema memory_creative from public,anon,authenticated,service_role;");
 assert.equal((await capabilities()).books,false);await assert.rejects(read('owner'),/MEMORY_CREATIVE_ACTOR_UNAVAILABLE/);
 await db.exec("create function memory_creative.actor(boolean) returns uuid language plpgsql security definer set search_path='' as $$begin raise exception 'SYNTHETIC_FULL_CREATIVE_DENIAL' using errcode='42501';end$$;revoke all on function memory_creative.actor(boolean) from public,anon,authenticated,service_role;");
 assert.equal((await capabilities()).books,false);await assert.rejects(read('owner'),/SYNTHETIC_FULL_CREATIVE_DENIAL/);
});

test('later canonical creative acknowledgement and rights helpers are delegated without preinstalling or guessing them',async()=>{
 await enable();
 await db.exec("create schema memory_creative;revoke all on schema memory_creative from public,anon,authenticated,service_role;create function memory_creative.actor(boolean) returns uuid language plpgsql security definer set search_path='' as $$begin perform read_paging_support.require_session();return auth.uid();end$$;create function memory_creative.ack(public.memory_albums) returns jsonb language sql set search_path='' as $$select jsonb_build_object('id',$1.id,'presentation_revision',7,'cover_artwork',jsonb_build_object('source','canonical'),'film_settings',jsonb_build_object('mode','original'))$$;revoke all on all functions in schema memory_creative from public,anon,authenticated,service_role;");
 await db.exec("alter table public.stories add column audio_sound_id uuid;alter table public.memory_albums add column soundtrack jsonb;create function public.sound_rights_allow(uuid,text) returns boolean language sql stable security definer set search_path='' as $$select $1='71000000-0000-4000-8000-000000009000'::uuid and $2='memory_album' and current_setting('test.sound_allowed',true)='true'$$;revoke all on function public.sound_rights_allow(uuid,text) from public,anon,authenticated,service_role;");
 await q("update public.stories set audio_sound_id=$1,audio_url='https://fixture.invalid/verified.wav',audio_title='Verified',audio_duration_sec=3 where id=$2",[id(9000),story(1)]);
 await db.exec("select set_config('test.sound_allowed','true',true);");
 let result=await read('owner',null,40);assert.equal(result.presentation_revision,7);assert.equal(result.cover_artwork.source,'canonical');
 let audio=result.pages.find(p=>p.story_id===story(1));assert.equal(audio.audio_url,'https://fixture.invalid/verified.wav');
 await db.exec("select set_config('test.sound_allowed','false',true);");
 result=await read('owner',null,40);audio=result.pages.find(p=>p.story_id===story(1));assert.equal(audio.audio_url,null);
 await db.exec("create or replace function public.sound_rights_allow(uuid,text) returns boolean language plpgsql stable security definer set search_path='' as $$begin raise exception 'SYNTHETIC_RIGHTS_FAILURE' using errcode='42501';end$$;");
 await assert.rejects(read('owner',null,40),/SYNTHETIC_RIGHTS_FAILURE/);
});

test('a later business authority controls both capability and direct reader eligibility on every request',async()=>{
 await enable();assert.equal((await capabilities('business')).books,false);
 await db.exec("create function public.business_session_allowed() returns boolean language sql stable security definer set search_path='' as $$select current_setting('test.business_allowed',true)='true'$$;revoke all on function public.business_session_allowed() from public,anon,authenticated,service_role;select set_config('test.business_allowed','true',true);");
 let caps=await capabilities('business');assert.equal(caps.books,true);assert.equal(caps.inbox,true);assert.equal((await read('business')).can_view,true);
 await db.exec("select set_config('test.business_allowed','false',true);");
 caps=await capabilities('business');assert.equal(caps.books,false);assert.equal(caps.inbox,false);await assert.rejects(read('business'),/BUSINESS_SESSION_REQUIRED/);
});

test('canonical drift, disabled cover validation and missing managed Auth columns abort without partial schema creation',()=>{
 assert.deepEqual(preflightRejections,['reader body drift','disabled cover guard','missing managed Auth column']);
});

test('replay aborts before creating or replacing an old public contract',async()=>{
 await assert.rejects(db.exec(migration),/PRODUCTION_READERS_FRESH_VISUAL_BASELINE_REQUIRED/);
 // The rejected package opened its own transaction, so reset the fixture's
 // surrounding test transaction before the normal afterEach rollback.
 await db.exec('rollback;begin;');
 assert.deepEqual((await existingState()).functions.filter(row=>baseline.functions.some(old=>old.signature===row.signature)),baseline.functions);
});
