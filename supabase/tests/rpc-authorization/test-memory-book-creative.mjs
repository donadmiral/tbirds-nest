import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {source} from './deployed-media-baseline.mjs';
import {loadBusinessAuthBaseline} from './business-auth-fixture.mjs';
import {captureMusicState} from './non-music-release-assertions.mjs';

const client=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(await source('shared/memoryBookCreative.ts'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const clone=value=>JSON.parse(JSON.stringify(value));
const art=()=>clone(client.DEFAULT_MEMORY_COVER_ARTWORK),film=()=>clone(client.DEFAULT_MEMORY_FILM_SETTINGS);
const db=new PGlite({extensions}),order=process.env.MEMORY_CREATIVE_MUSIC_ORDER||'none';
assert.ok(['none','before','after'].includes(order));
const ids={owner:randomUUID(),viewer:randomUUID(),other:randomUUID(),business:randomUUID()};
const sessions={owner:randomUUID(),viewer:randomUUID(),other:randomUUID()};
const stories={one:randomUUID(),two:randomUUID(),foreign:randomUUID()};
const oldBook=randomUUID();let musicBefore,musicAfter,intermediate;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await q(sql,args))[0]||{})[0];
async function as(name,sql,args=[],role='authenticated',session=sessions[name]){
 await db.exec('savepoint request');
 try{
  await db.exec(`set local row_security=on;set local role ${role}`);
  const uid=ids[name]||null,claims={sub:uid,session_id:session||null,role,is_anonymous:false,iss:'https://uaulhuelcfkjwojtymmw.supabase.co/auth/v1'};
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[uid||'',role,JSON.stringify(claims)]);
  const result=await value(sql,args);
  await db.exec("reset role;set local row_security=on;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{}',true);release savepoint request");
  return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const service=(sql,args=[])=>as(null,sql,args,'service_role',null);
const read=(id,name='owner')=>as(name,'select public.get_memory_book($1)',[id]);
const shelf=(owner=ids.owner,name='owner')=>as(name,'select public.get_memory_albums($1)',[owner]);
function createArgs(overrides={}){
 const draft={request:randomUUID(),title:'Creative book',subtitle:'A day kept',color:'cream',design:'postcard',stories:[stories.one,stories.two],cover:stories.one,art:art(),film:film(),...overrides};
 return [draft.request,draft.title,draft.subtitle,draft.color,draft.design,draft.stories,draft.cover,JSON.stringify(draft.art),JSON.stringify(draft.film)];
}
const create=(overrides={},name='owner')=>as(name,'select public.create_memory_book_creative_presentation($1,$2,$3,$4,$5,$6,$7,$8,$9)',createArgs(overrides));
const save=(id,revision,overrides={},name='owner')=>{
 const draft={title:'Creative book',subtitle:'A day kept',color:'cream',design:'postcard',audience:'profile',cover:stories.one,art:art(),film:film(),...overrides};
 return as(name,'select public.save_memory_book_creative_presentation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,revision,draft.title,draft.subtitle,draft.color,draft.design,draft.audience,draft.cover,JSON.stringify(draft.art),JSON.stringify(draft.film)]);
};
const units=['20261031001826_memory_book_creative_presentation','20261031012445_memory_book_creative_mutations','20261031012805_memory_book_creative_public_contracts'];
async function installMusic(){
 for(const name of ['20261030034752_business_bound_auth_sessions','20261030153811_original_music_library_and_delivery','20261030203619_music_catalogue_operations_and_cleanup','20261030204339_licensed_catalogue_pipeline'])await db.exec(await source(`supabase/migrations/${name}.sql`));
}
async function bindBusiness(){
 const device=randomUUID(),proof=createHash('sha256').update('synthetic-memory-business-device').digest('hex');
 await q("insert into public.business_members(business_id,member_id,role) values($1,$2,'owner')",[ids.business,ids.owner]);
 const grant=await service('select public.triniti_business_owner_access($1,$2,null,$3,$4,$5,true,$6)',[ids.owner,sessions.owner,device,proof,'Synthetic creative device',ids.business]);
 assert.equal(grant.allowed,true,JSON.stringify(grant));const session=randomUUID();
 await q("insert into auth.sessions(id,user_id,aal,created_at) values($1,$2,'aal1',clock_timestamp())",[session,ids.business]);
 const result=await service('select public.triniti_business_finish_signin($1,$2,$3,$4)',[grant.grant_id,ids.business,session,proof]);assert.equal(result.success,true);
 return {session,device};
}

before(async()=>{
 await loadBusinessAuthBaseline(db,true,true);
 await db.exec(await source('supabase/migrations/20261029054043_memory_book_visual_presentation.sql'));
 const baseline=JSON.parse(await source('supabase/tests/rpc-authorization/memory-creative-reader-baseline-20261031.json'));
 for(const f of baseline.functions){
  assert.equal(createHash('md5').update(f.definition).digest('hex'),f.definition_md5);
  await db.exec(f.definition);
 }
 if(order==='before')await installMusic();
 for(const[name,id]of Object.entries(ids)){
  await q('insert into auth.users(id,email) values($1,$2)',[id,`creative-${name}@example.invalid`]);
  await q("update public.profiles set username=$1,profile_visibility='public',account_type=$2 where id=$3",[`creative_${name}`,name==='business'?'business':'personal',id]);
 }
 for(const[name,session]of Object.entries(sessions))await q("insert into auth.sessions(id,user_id,aal,created_at) values($1,$2,'aal1',clock_timestamp())",[session,ids[name]]);
 for(const[id,owner,type]of [[stories.one,ids.owner,'image'],[stories.two,ids.owner,'video'],[stories.foreign,ids.other,'image']])await q("insert into public.stories(id,user_id,media_type,media_url,expires_at) values($1,$2,$3,$4,now()-interval '1 day')",[id,owner,type,`https://fixture.invalid/${id}`]);
 await q("insert into public.memory_albums(id,user_id,title,subtitle,cover_color,cover_design,audience,is_default) values($1,$2,'Existing book','Preserve me','rose','keepsake','profile',false)",[oldBook,ids.owner]);
 musicBefore=await captureMusicState(db);
 for(const mutation of [
  'alter table public.memory_albums disable trigger memory_book_cover',
  "create or replace function public.validate_memory_book_cover() returns trigger language plpgsql security definer set search_path='' as $$begin return new;end$$",
 ]){
  await db.exec(`begin;${mutation};`);
  await assert.rejects(db.exec(await source(`supabase/migrations/${units[0]}.sql`)),/MEMORY_COVER_GUARD_REQUIRED/);
  await db.exec('rollback');assert.equal(await value("select to_regnamespace('memory_creative')"),null);
 }
 await db.exec(await source(`supabase/migrations/${units[0]}.sql`));
 const atOne={stage:await value('select stage from memory_creative.installation'),capability:await value("select to_regprocedure('public.get_memory_book_creative_capabilities()')"),privateCallable:await value("select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='memory_creative' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))")};
 await db.exec(await source(`supabase/migrations/${units[1]}.sql`));
 const atTwo={stage:await value('select stage from memory_creative.installation'),capability:await value("select to_regprocedure('public.get_memory_book_creative_capabilities()')"),privateCallable:await value("select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='memory_creative' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))")};
 intermediate={atOne,atTwo};
 await db.exec('begin;alter table public.memory_albums disable trigger memory_book_cover;');
 await assert.rejects(db.exec(await source(`supabase/migrations/${units[2]}.sql`)),/MEMORY_COVER_GUARD_REQUIRED/);
 await db.exec('rollback');assert.equal(await value('select stage from memory_creative.installation'),2);
 await db.exec(await source(`supabase/migrations/${units[2]}.sql`));
 musicAfter=await captureMusicState(db);
 if(order==='after')await installMusic();
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db.close());

test(`private installation stages cannot expose an incomplete creative RPC (music ${order})`,async()=>{
 assert.deepEqual(intermediate,{atOne:{stage:1,capability:null,privateCallable:0},atTwo:{stage:2,capability:null,privateCallable:0}});
 assert.deepEqual(await as('owner','select public.get_memory_book_creative_capabilities()'),{version:1,supported:true});
 assert.equal(await value('select stage from memory_creative.installation'),3);
});
test('existing books and installed legacy creation retain original playback and exact presentation',async()=>{
 const existing=await read(oldBook);assert.equal(existing.title,'Existing book');assert.equal(existing.subtitle,'Preserve me');assert.equal(existing.presentation_revision,0);
 assert.deepEqual(existing.film_settings,client.LEGACY_MEMORY_FILM_SETTINGS);assert.deepEqual(existing.cover_artwork,art());
 const legacy=await as('owner',"select public.create_memory_book('Legacy new','sky')");assert.deepEqual((await read(legacy)).film_settings,client.LEGACY_MEMORY_FILM_SETTINGS);
 const created=await create();assert.deepEqual(created.film_settings,film());assert.ok(client.parseMemoryCreativeSaveResult(created,created.id));
});
test('the creative migration leaves existing catalogue data, schema and rights functions unchanged',async()=>{
 assert.deepEqual(musicAfter,musicBefore);
 if(order==='none')assert.equal(await value("select to_regnamespace('music_library')"),null);
 else{
  assert.equal(await value('select uploads_enabled from music_library.service_state'),false);
  assert.equal(await value('select ingestion_enabled or playback_enabled from music_library.catalogue_service'),false);
  assert.equal(await value('select count(*)::int from music_library.catalogue_credentials'),0);
 }
});
test('cover inscription, stamp, crop, film preferences and page order persist in real RPC acknowledgements/readers',async()=>{
 const artwork={...art(),inscription:'For our next chapter\nAlways.',postmark:'PARIS 2026',inscriptionStyle:'serif',inscriptionPosition:'top',showDate:false,photo:{x:.2,y:.8,scale:2.5}};
 const settings={...film(),style:'cinematic',length:'short',order:'chronological',originalAudio:false};
 const result=await create({art:artwork,film:settings,stories:[stories.two,stories.one],cover:stories.two});
 assert.deepEqual(result.cover_artwork,artwork);assert.deepEqual(result.film_settings,settings);assert.ok(client.parseMemoryCreativeSaveResult(result,result.id));
 const book=await read(result.id);assert.deepEqual(book.pages.map(p=>p.story_id),[stories.two,stories.one]);assert.equal(book.cover_story_id,stories.two);
 assert.deepEqual(book.cover_artwork,artwork);assert.deepEqual(book.film_settings,settings);
 const entry=(await shelf()).books.find(b=>b.id===result.id);assert.deepEqual(entry.cover_artwork,artwork);assert.equal(entry.presentation_revision,result.presentation_revision);
});
test('every existing design and color remains compatible with creative saves',async()=>{
 let book=await create();
 for(const design of ['keepsake','postcard','editorial','field_notes','night_film','daybook','botanical','classic'])book=await save(book.id,book.presentation_revision,{design});
 for(const color of ['blush','rose','pearl','cream','sage','sky','lilac','ink'])book=await save(book.id,book.presentation_revision,{color});
 assert.equal((await read(book.id)).cover_color,'ink');
});
test('strict cover validation rejects unknown/missing keys, nulls, wrong types and URL fields atomically',async()=>{
 const book=await create();const invalid=[null,[],{...art(),version:2},{...art(),extra:'x'},{...art(),photo:{...art().photo,url:'https://fixture.invalid'}},{...art(),inscription:null},{...art(),inscriptionStyle:null},{...art(),inscriptionPosition:null},{...art(),postmark:5},{...art(),showDate:'true'},{...art(),photo:null},{...art(),photo:{x:0,y:1}},{...art(),photo:{x:'0',y:1,scale:1}}];
 const missing=art();delete missing.inscription;invalid.push(missing);
 for(const artwork of invalid)await assert.rejects(save(book.id,book.presentation_revision,{art:artwork}),/INVALID_MEMORY_COVER_ARTWORK/);
 assert.equal((await read(book.id)).presentation_revision,book.presentation_revision);
});
test('strict film validation rejects unknown/missing keys, null enums and malformed booleans',async()=>{
 const book=await create();const invalid=[null,[],{...film(),version:2},{...film(),url:'https://fixture.invalid'},{...film(),mode:null},{...film(),style:null},{...film(),length:null},{...film(),order:null},{...film(),titleCard:1},{...film(),originalAudio:'false'},{...film(),mode:'random'}];
 const missing=film();delete missing.order;invalid.push(missing);
 for(const settings of invalid)await assert.rejects(save(book.id,book.presentation_revision,{film:settings}),/INVALID_MEMORY_FILM_SETTINGS/);
 assert.equal((await read(book.id)).presentation_revision,book.presentation_revision);
});
test('Unicode limits count codepoints and preserve multiline text while rejecting C0 controls and DEL',async()=>{
 let book=await create({art:{...art(),inscription:'🌻'.repeat(160),postmark:'é'.repeat(32)}});assert.equal(Array.from(book.cover_artwork.inscription).length,160);
 book=await save(book.id,book.presentation_revision,{art:{...art(),inscription:'Line one\nLine two\t♥\rEnd'}});assert.equal(book.cover_artwork.inscription,'Line one\nLine two\t♥\rEnd');
 for(const inscription of ['🌻'.repeat(161),'bad\u0001','bad\u000b','bad\u007f'])await assert.rejects(save(book.id,book.presentation_revision,{art:{...art(),inscription}}),/INVALID_MEMORY_COVER_ARTWORK/);
 await assert.rejects(save(book.id,book.presentation_revision,{art:{...art(),postmark:'é'.repeat(33)}}),/INVALID_MEMORY_COVER_ARTWORK/);
});
test('crop numbers enforce finite typed bounds and canonical numeric retries',async()=>{
 let book=await create({art:{...art(),photo:{x:0,y:1,scale:2.5}}});assert.deepEqual(book.cover_artwork.photo,{x:0,y:1,scale:2.5});
 for(const photo of [{x:-.1,y:.5,scale:1},{x:.5,y:1.01,scale:1},{x:.5,y:.5,scale:.99},{x:.5,y:.5,scale:2.51},{x:null,y:.5,scale:1},{x:Infinity,y:.5,scale:1}])await assert.rejects(save(book.id,book.presentation_revision,{art:{...art(),photo}}),/INVALID_MEMORY_COVER_ARTWORK/);
 const request=randomUUID(),args=createArgs({request});const first=await as('owner','select public.create_memory_book_creative_presentation($1,$2,$3,$4,$5,$6,$7,$8,$9)',args);
 args[7]=args[7].replace('0.5','0.50');assert.deepEqual(await as('owner','select public.create_memory_book_creative_presentation($1,$2,$3,$4,$5,$6,$7,$8,$9)',args),first);
});
test('foreign stories, invalid selected covers and duplicate/null/excessive page lists leave no partial book',async()=>{
 const count=await value('select count(*)::int from public.memory_albums');
 await assert.rejects(create({stories:[stories.one,stories.foreign]}),/STORY_NOT_OWNED/);
 await assert.rejects(create({stories:[stories.one],cover:stories.two}),/COVER_NOT_SELECTED/);
 for(const pages of [[stories.one,stories.one],[null],Array(81).fill(stories.one),[[stories.one],[stories.two]],null])await assert.rejects(create({stories:pages,cover:null}),/INVALID_BOOK_PRESENTATION|malformed array/);
 assert.equal(await value('select count(*)::int from public.memory_albums'),count);assert.equal(await value('select count(*)::int from memory_creative.create_requests'),0);
});
test('the maximum 80 distinct owned pages retain their exact requested order',async()=>{
 const pages=Array.from({length:80},()=>randomUUID());
 for(const id of pages)await q("insert into public.stories(id,user_id,media_type,media_url,expires_at) values($1,$2,'image','https://fixture.invalid/page',now()-interval '1 day')",[id,ids.owner]);
 const result=await create({stories:pages,cover:pages[79]});const book=await read(result.id);assert.equal(book.count,80);assert.deepEqual(book.pages.map(p=>p.story_id),pages);assert.equal(book.cover_story_id,pages[79]);
});
test('a lost create response can be retried exactly without duplicate books, pages or requests',async()=>{
 const request=randomUUID(),first=await create({request});assert.deepEqual(await create({request}),first);
 assert.equal(await value('select count(*)::int from public.memory_albums where id=$1',[request]),1);assert.equal(await value('select count(*)::int from public.memory_pages where album_id=$1',[request]),2);assert.equal(await value('select count(*)::int from memory_creative.create_requests where request_id=$1',[request]),1);
});
test('a request reused for another payload or owner returns an explicit conflict',async()=>{
 const request=randomUUID();await create({request});await assert.rejects(create({request,title:'Different'}),/MEMORY_BOOK_REQUEST_CONFLICT/);
 await assert.rejects(create({request,stories:[],cover:null},'other'),/MEMORY_BOOK_REQUEST_CONFLICT/);
 assert.equal((await read(request)).title,'Creative book');
});
test('retrying the original creation after an edit confirms the original result without overwriting the book',async()=>{
 const request=randomUUID(),first=await create({request});const edited=await save(first.id,first.presentation_revision,{title:'Later edit',art:{...art(),inscription:'Keep this edit'}});
 assert.deepEqual(await create({request}),first);const current=await read(first.id);assert.equal(current.title,'Later edit');assert.equal(current.cover_artwork.inscription,'Keep this edit');assert.equal(current.presentation_revision,edited.presentation_revision);
});
test('a deleted book retains a private request tombstone and cannot be recreated by retry',async()=>{
 const request=randomUUID();await create({request});await as('owner','select public.delete_memory_book($1)',[request]);
 await assert.rejects(create({request}),/MEMORY_BOOK_REQUEST_CONFLICT/);assert.equal(await value('select count(*)::int from public.memory_albums where id=$1',[request]),0);assert.equal(await value('select count(*)::int from memory_creative.create_requests where request_id=$1',[request]),1);
});
test('revision-checked saves advance once, including confirmed no-op saves',async()=>{
 const created=await create(),saved=await save(created.id,created.presentation_revision);assert.equal(saved.presentation_revision,created.presentation_revision+1);
 const again=await save(saved.id,saved.presentation_revision);assert.equal(again.presentation_revision,saved.presentation_revision+1);
});
test('stale, missing, negative and future revisions cannot overwrite a newer save',async()=>{
 const created=await create(),saved=await save(created.id,created.presentation_revision,{title:'Latest'});
 for(const revision of [created.presentation_revision,null,-1,saved.presentation_revision+1])await assert.rejects(save(created.id,revision,{title:'Stale'}),/MEMORY_BOOK_CHANGED/);
 assert.equal((await read(created.id)).title,'Latest');
});
test('legacy title/design/audience writers advance the shared presentation revision',async()=>{
 const created=await create();await as('owner',"select public.update_memory_book($1,'Legacy changed','sage','only_me')",[created.id]);
 let current=await read(created.id);assert.equal(current.presentation_revision,created.presentation_revision+1);assert.equal(current.cover_artwork.inscription,'');
 await as('owner',"select public.save_memory_book_presentation($1,'Legacy changed','sage','only_me','editorial','Legacy subtitle',$2)",[created.id,stories.two]);
 const next=await read(created.id);assert.equal(next.presentation_revision,current.presentation_revision+1);assert.equal(next.cover_story_id,stories.two);assert.equal(next.subtitle,'Legacy subtitle');
});
test('direct writes cannot spoof revisions, bypass document validation or lose confirmed revision changes',async()=>{
 const created=await create();await as('owner','update public.memory_albums set presentation_revision=999999 where id=$1 returning id',[created.id]);
 const current=await read(created.id);assert.equal(current.presentation_revision,created.presentation_revision+1);
 await assert.rejects(as('owner',"update public.memory_albums set cover_artwork='{}' where id=$1 returning id",[created.id]),/INVALID_MEMORY_COVER_ARTWORK/);
 await as('owner','update public.memory_albums set title=title where id=$1 returning id',[created.id]);assert.equal((await read(created.id)).presentation_revision,current.presentation_revision);
});
test('removing the selected cover page clears the reference and invalidates an open editor revision',async()=>{
 const created=await create();const page=(await read(created.id)).pages.find(p=>p.story_id===stories.one);await as('owner','delete from public.memory_pages where id=$1 returning id',[page.id]);
 const current=await read(created.id);assert.equal(current.cover_story_id,null);assert.equal(current.cover_page.story_id,stories.two);assert.equal(current.presentation_revision,created.presentation_revision+1);
 await assert.rejects(save(created.id,created.presentation_revision,{cover:stories.two}),/MEMORY_BOOK_CHANGED/);
});
test('another owner cannot save a book or select a cover outside its owned pages',async()=>{
 const created=await create();await assert.rejects(save(created.id,created.presentation_revision,{},'other'),/BOOK_NOT_OWNED/);
 await assert.rejects(save(created.id,created.presentation_revision,{cover:stories.foreign}),/COVER_NOT_IN_OWNED_BOOK/);assert.equal((await read(created.id)).cover_story_id,stories.one);
});
test('anonymous and service callers cannot invoke the application creative contract or private implementation',async()=>{
 for(const role of ['anon','service_role'])await assert.rejects(as(null,'select public.get_memory_book_creative_capabilities()',[],role,null),/permission denied/);
 for(const role of ['anon','authenticated','service_role']){
  for(const table of ['installation','create_requests'])assert.equal(await value(`select has_table_privilege($1,'memory_creative.${table}','SELECT,INSERT,UPDATE,DELETE')`,[role]),false);
  await assert.rejects(as('owner','select memory_creative.actor(false)',[],role),/permission denied/);
 }
 assert.equal(await value("select count(*)::int from pg_policies where schemaname='memory_creative'"),0);
 assert.equal(await value("select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='memory_creative' and c.relkind='r' and not c.relrowsecurity"),0);
});
test('profile erasure removes the private creation record through its owner cascade',async()=>{
 const created=await create();assert.equal(await value('select count(*)::int from memory_creative.create_requests where request_id=$1',[created.id]),1);
 await q('delete from public.profiles where id=$1',[ids.owner]);
 assert.equal(await value('select count(*)::int from memory_creative.create_requests where request_id=$1',[created.id]),0);
});
test('revoked sessions cannot read, create, save, directly update or delete creative books',async()=>{
 const created=await create();await q('delete from auth.sessions where id=$1',[sessions.owner]);
 for(const action of [()=>read(created.id),()=>create(),()=>save(created.id,created.presentation_revision),()=>as('owner',"update public.memory_albums set title='Revoked' where id=$1 returning id",[created.id]),()=>as('owner','select public.delete_memory_book($1)',[created.id])])await assert.rejects(action,/SESSION|SIGN_IN/);
 assert.equal(await value('select title from public.memory_albums where id=$1',[created.id]),'Creative book');
});
test('expired or foreign sessions cannot authorize the creative contract',async()=>{
 await q("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[sessions.owner]);await assert.rejects(create(),/SESSION/);
 await assert.rejects(as('owner','select public.get_memory_book_creative_capabilities()',[],'authenticated',sessions.viewer),/SESSION/);
});
test('deactivated profiles and banned Auth identities cannot mutate creative books',async()=>{
 await q('update public.profiles set deactivated_at=clock_timestamp() where id=$1',[ids.owner]);await assert.rejects(create(),/PROFILE|SESSION|DEACTIVATED/);
 await q('update public.profiles set deactivated_at=null where id=$1',[ids.owner]);await q("update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1",[ids.owner]);await assert.rejects(create(),/SESSION|BANNED/);
});
test('private book docs and revisions never leak into another viewer’s book, shelf or default album',async()=>{
 const created=await create({art:{...art(),inscription:'Owner-only inscription'}});const saved=await save(created.id,created.presentation_revision,{audience:'only_me',art:created.cover_artwork});
 const denied=await read(saved.id,'viewer');assert.equal(denied.can_view,false);for(const key of ['cover_artwork','film_settings','presentation_revision'])assert.equal(Object.hasOwn(denied,key),false);
 assert.equal(JSON.stringify(await shelf(ids.owner,'viewer')).includes('Owner-only inscription'),false);
 await q('update public.memory_albums set is_default=true where id=$1',[saved.id]);const defaultDenied=await as('viewer','select public.get_memory_album($1)',[ids.owner]);assert.equal(defaultDenied.can_view,false);assert.equal(Object.hasOwn(defaultDenied,'cover_artwork'),false);
});
test('current follows, blocks and per-book audience still control creative metadata projection',async()=>{
 const created=await create();let current=await save(created.id,created.presentation_revision,{audience:'followers'});assert.equal((await read(current.id,'viewer')).can_view,false);
 await q('insert into public.follows(follower_id,following_id) values($1,$2)',[ids.viewer,ids.owner]);assert.deepEqual((await read(current.id,'viewer')).cover_artwork,art());
 await q('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)',[ids.owner,ids.viewer]);assert.equal((await read(current.id,'viewer')).can_view,false);assert.equal((await shelf(ids.owner,'viewer')).books.some(b=>b.id===current.id),false);
});
test('default-album and optional music wrappers preserve creative documents without enabling licensing',async()=>{
 const created=await create();await q('update public.memory_albums set is_default=true where id=$1',[created.id]);const book=await as('owner','select public.get_memory_album($1)',[ids.owner]);assert.deepEqual(book.cover_artwork,created.cover_artwork);assert.deepEqual(book.film_settings,created.film_settings);
 if(order!=='none'){assert.equal(Object.hasOwn(book,'soundtrack'),true);assert.equal(book.soundtrack,null);assert.equal(Object.hasOwn(book.pages[0],'audio_sound_id'),true);assert.equal(await value('select playback_enabled from music_library.catalogue_service'),false);}
});
test('unbound business sessions fail closed with or without the business installation',async()=>{
 const session=randomUUID();await q('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',[session,ids.business]);
 await assert.rejects(as('business','select public.get_memory_book_creative_capabilities()',[],'authenticated',session),/BUSINESS_SESSION_REQUIRED/);
});
test('a current exact business binding supports creative persistence and revoked devices stop it',{skip:order==='none'?'Paired combined-music fixture exercises actual business issuance.':false},async()=>{
 const bound=await bindBusiness(),request=randomUUID();const args=createArgs({request,stories:[],cover:null});
 const created=await as('business','select public.create_memory_book_creative_presentation($1,$2,$3,$4,$5,$6,$7,$8,$9)',args,'authenticated',bound.session);assert.equal(created.id,request);
 await q("update public.business_devices set status='pending' where business_id=$1 and device_id=$2",[ids.business,bound.device]);
 await assert.rejects(as('business','select public.get_memory_book($1)',[request],'authenticated',bound.session),/SESSION/);
});
