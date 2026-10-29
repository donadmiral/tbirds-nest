const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',C='10000000-0000-4000-8000-000000000003';
const ONE='20000000-0000-4000-8000-000000000001',TWO='20000000-0000-4000-8000-000000000002',FOREIGN='20000000-0000-4000-8000-000000000003';
let db, publicBook, privateBook;
async function as(actor, sql, params=[]) {
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor??'']);
 await db.exec('set role authenticated');
 try {return (await db.query(sql,params)).rows;} finally {await db.exec('reset role');}
}
const value=async(actor,sql,args)=>(await as(actor,sql,args))[0].value;
test.before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table profiles(id uuid primary key,deactivated_at timestamptz,profile_visibility text default 'public');
 create table follows(follower_id uuid,following_id uuid);
 create table blocked_users(blocker_id uuid,blocked_id uuid);
 create table memory_albums(id uuid primary key default gen_random_uuid(),user_id uuid not null,title text not null default 'Memories' constraint memory_albums_title_check check(char_length(title)>=1 and char_length(title)<=30),cover_color text not null default 'blush',audience text not null default 'profile',is_default boolean not null default false,created_at timestamptz default now());
 create unique index memory_default on memory_albums(user_id) where is_default;
 create table memory_album_access(owner_id uuid,member_id uuid,kind text,primary key(owner_id,member_id,kind));
 create table stories(id uuid primary key,user_id uuid,media_url text,media_type text,thumbnail_url text,caption text,text_background jsonb,stickers_json jsonb,duration_sec int,dual_front_url text,audio_url text,audio_title text,created_at timestamptz default now());
 create table memory_pages(id uuid primary key default gen_random_uuid(),user_id uuid not null,album_id uuid not null references memory_albums(id),story_id uuid references stories(id),media_url text,media_type text,thumbnail_url text,caption text,style text default 'polaroid',taken_at timestamptz,sort_order int default 0,created_at timestamptz default now(),unique(album_id,story_id));
 -- The sound service owns catalogue rights tests. This boundary verifies that
 -- every new/changed book selection invokes that service before committing.
 create function validate_soundtrack(s jsonb,use_for text) returns jsonb language plpgsql as $$begin
 if s is not null and (use_for<>'memory_album' or s->>'soundId'<>'approved') then raise exception 'SOUND_UNAVAILABLE';end if;return s;end$$;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261028151016_memory_book_design_and_soundtrack.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261028185149_memory_book_presentation.sql'),'utf8'));
});
test.after(()=>db.close());
test.beforeEach(async()=>{
 await db.exec(`truncate memory_pages,memory_albums,memory_album_access,stories,profiles,blocked_users,follows cascade;
 insert into profiles(id) values('${A}'),('${B}'),('${C}');
 insert into stories(id,user_id,media_url,media_type,caption) values('${ONE}','${A}','first.jpg','image','First'),('${TWO}','${A}','second.jpg','image','Second'),('${FOREIGN}','${B}','foreign.jpg','image','Foreign');`);
 publicBook=await value(A,"select create_memory_book_design('Together','rose','keepsake') value");
 privateBook=await value(A,"select create_memory_book_design('Private title','ink','night_film') value");
 await as(A,"select save_memory_book_design($1,'Private title','ink','only_me','night_film',null)",[privateBook]);
});
test('each book is authorized independently; the shelf does not disclose private title/count/id',async()=>{
 const shelf=await value(B,'select get_memory_albums($1) value',[A]);
 assert.deepEqual(shelf.books.map(x=>x.id),[publicBook]);
 assert.equal(JSON.stringify(shelf).includes('Private title'),false);
 const denied=await value(B,'select get_memory_book($1) value',[privateBook]);
 assert.deepEqual(denied,{can_view:false,is_owner:false,count:0,pages:[]});
 assert.equal((await value(A,'select get_memory_albums($1) value',[A])).books.length,2);
});
test('custom, follower and private profile visibility enforce allow and block overrides',async()=>{
 await as(A,"select save_memory_book_design($1,'Together','rose','custom','keepsake',null)",[publicBook]);
 assert.equal(await value(B,'select can_view_memory_book($1) value',[publicBook]),false);
 await db.query("insert into memory_album_access values($1,$2,'allow')",[A,B]);
 assert.equal(await value(B,'select can_view_memory_book($1) value',[publicBook]),true);
 await db.query("insert into memory_album_access values($1,$2,'block')",[A,B]);
 assert.equal(await value(B,'select can_view_memory_book($1) value',[publicBook]),false);
 await db.exec('truncate memory_album_access');
 await as(A,"select save_memory_book_design($1,'Together','rose','followers','keepsake',null)",[publicBook]);
 assert.equal(await value(B,'select can_view_memory_book($1) value',[publicBook]),false);
 await db.query('insert into follows values($1,$2)',[B,A]);
 assert.equal(await value(B,'select can_view_memory_book($1) value',[publicBook]),true);
 await as(A,"select save_memory_book_design($1,'Together','rose','profile','keepsake',null)",[publicBook]);
 await db.query("update profiles set profile_visibility='private' where id=$1",[A]);
 assert.equal(await value(C,'select can_view_memory_book($1) value',[publicBook]),false);
 assert.equal(await value(B,'select can_view_memory_book($1) value',[publicBook]),true);
 await db.query('insert into blocked_users values($1,$2)',[B,A]);
 assert.equal(await value(B,'select can_view_memory_book($1) value',[publicBook]),false);
 await db.query('update profiles set deactivated_at=now() where id=$1',[A]);
 assert.equal(await value(A,'select can_view_memory_book($1) value',[publicBook]),false);
});
test('page IDs are stable separate IDs, append order persists, and repeated publish-save is idempotent',async()=>{
 const first=await value(A,'select add_memory_page($1,null,\'polaroid\',$2) value',[ONE,publicBook]);
 const again=await value(A,'select add_memory_page($1,null,\'polaroid\',$2) value',[ONE,publicBook]);
 assert.equal(again,first);assert.notEqual(first,ONE);
 const second=await value(A,'select add_memory_page($1,null,\'full\',$2) value',[TWO,publicBook]);
 const book=await value(B,'select get_memory_book($1) value',[publicBook]);
 assert.deepEqual(book.pages.map(p=>[p.id,p.story_id,p.sort_order,p.style]),[[first,ONE,0,'polaroid'],[second,TWO,1,'full']]);
});
test('foreign stories and foreign book targets reject without a partial save',async()=>{
 await assert.rejects(()=>value(A,"select add_memory_page($1,null,'polaroid',$2) value",[FOREIGN,publicBook]),/STORY_NOT_OWNED/);
 await assert.rejects(()=>value(B,"select add_memory_page($1,null,'polaroid',$2) value",[FOREIGN,publicBook]),/BOOK_NOT_OWNED/);
 assert.equal((await value(A,'select get_memory_book($1) value',[publicBook])).count,0);
});
test('direct page writes cannot attach a foreign story or foreign book',async()=>{
 await assert.rejects(()=>db.query('insert into memory_pages(user_id,album_id,story_id) values($1,$2,$3)',[A,publicBook,FOREIGN]),/MEMORY_PAGE_OWNER_MISMATCH/);
 await assert.rejects(()=>db.query('insert into memory_pages(user_id,album_id,story_id) values($1,$2,$3)',[B,publicBook,FOREIGN]),/MEMORY_PAGE_OWNER_MISMATCH/);
});
test('one server transaction swaps order and forbids other owners or another book',async()=>{
 const first=await value(A,"select add_memory_page($1,null,'polaroid',$2) value",[ONE,publicBook]);
 const second=await value(A,"select add_memory_page($1,null,'polaroid',$2) value",[TWO,publicBook]);
 const other=await value(A,"select add_memory_page($1,null,'polaroid',$2) value",[ONE,privateBook]);
 await assert.rejects(()=>as(B,'select swap_memory_pages($1,$2)',[first,second]),/PAGES_NOT_OWNED/);
 await assert.rejects(()=>as(A,'select swap_memory_pages($1,$2)',[first,other]),/DIFFERENT_BOOK/);
 await as(A,'select swap_memory_pages($1,$2)',[first,second]);
 assert.deepEqual((await value(A,'select get_memory_book($1) value',[publicBook])).pages.map(p=>p.id),[second,first]);
});
test('settings target the chosen book, reject unapproved sounds, and retain saved data on failure',async()=>{
 const selection={soundId:'approved',startSec:0,durationSec:12,volume:.5,originalVolume:0};
 await as(A,"select save_memory_book_design($1,'Holiday','sky','only_me','postcard',$2)",[privateBook,selection]);
 const album=await value(A,'select get_memory_book($1) value',[privateBook]);
 assert.equal(album.cover_design,'postcard');assert.equal(album.title,'Holiday');assert.deepEqual(album.soundtrack,selection);
 assert.equal((await value(A,'select get_memory_book($1) value',[publicBook])).title,'Together');
 await assert.rejects(()=>as(A,"select save_memory_book_design($1,'Tampered','sky','only_me','postcard',$2)",[privateBook,{soundId:'unlicensed'}]),/SOUND_UNAVAILABLE/);
 assert.equal((await value(A,'select get_memory_book($1) value',[privateBook])).title,'Holiday');
 await assert.rejects(()=>as(B,"select save_memory_book_design($1,'Hijack','sky','profile','postcard',null)",[privateBook]),/BOOK_NOT_OWNED/);
 await assert.rejects(()=>as(A,"select save_memory_book_design($1,'Holiday','sky','only_me','unknown',null)",[privateBook]),/memory_cover_design/);
});
test('anonymous callers cannot list metadata or invoke book mutations',async()=>{
 for(const signature of ['get_memory_book(uuid)','get_memory_albums(uuid)','create_memory_book_design(text,text,text)','save_memory_book_design(uuid,text,text,text,text,jsonb)','add_memory_page(uuid,text,text,uuid)','swap_memory_pages(uuid,uuid)']){
  const result=(await db.query("select has_function_privilege('anon',$1,'execute') allowed",[signature])).rows[0];assert.equal(result.allowed,false,signature);
 }
});

// A cover is a story already authorized as a page of this book. The API never
// stores temporary signed URLs or grants access to a separate cover upload.
test('create saves selected memories, subtitle and chosen cover in one transaction',async()=>{
 const id=await value(A,"select create_memory_book_presentation('Weekend away','cream','postcard','Small moments, kept',array[$1,$2]::uuid[],$2) value",[ONE,TWO]);
 const book=await value(A,'select get_memory_book($1) value',[id]);
 assert.equal(book.title,'Weekend away');assert.equal(book.subtitle,'Small moments, kept');
 assert.deepEqual(book.pages.map(x=>x.story_id),[ONE,TWO]);assert.equal(book.cover_story_id,TWO);assert.equal(book.cover_page.story_id,TWO);assert.equal(book.cover_page.media_url,'second.jpg');
 const shelf=(await value(B,'select get_memory_albums($1) value',[A])).books.find(x=>x.id===id);
 assert.equal(shelf.subtitle,book.subtitle);assert.equal(shelf.cover_page.story_id,TWO);assert.equal(shelf.count,2);
});
test('a foreign story rolls the entire new-book transaction back, without an empty duplicate',async()=>{
 const count=(await db.query('select count(*)::int value from memory_albums')).rows[0].value;
 await assert.rejects(()=>value(A,"select create_memory_book_presentation('Rejected','cream','postcard','',array[$1,$2]::uuid[],$1) value",[ONE,FOREIGN]),/STORY_NOT_OWNED/);
 assert.equal((await db.query('select count(*)::int value from memory_albums')).rows[0].value,count);
 assert.equal((await db.query('select count(*)::int value from memory_pages')).rows[0].value,0);
});
test('saving presentation preserves the soundtrack and permits only a cover already in the owned book',async()=>{
 await value(A,"select add_memory_page($1,null,'polaroid',$2) value",[ONE,publicBook]);
 const selection={soundId:'approved',startSec:0,durationSec:12,volume:.5,originalVolume:0};
 await as(A,"select save_memory_book_design($1,'Together','rose','profile','keepsake',$2)",[publicBook,selection]);
 await as(A,"select save_memory_book_presentation($1,'Edited','cream','profile','editorial','A quiet day',$2)",[publicBook,ONE]);
 const saved=await value(A,'select get_memory_book($1) value',[publicBook]);
 assert.equal(saved.subtitle,'A quiet day');assert.equal(saved.cover_story_id,ONE);assert.deepEqual(saved.soundtrack,selection);
 await assert.rejects(()=>as(A,"select save_memory_book_presentation($1,'Bad','cream','profile','postcard','',$2)",[publicBook,TWO]),/COVER_NOT_IN_OWNED_BOOK/);
 await assert.rejects(()=>as(B,"select save_memory_book_presentation($1,'Bad','cream','profile','postcard','',$2)",[publicBook,FOREIGN]),/BOOK_NOT_OWNED/);
 assert.equal((await value(A,'select get_memory_book($1) value',[publicBook])).title,'Edited');
});
test('removing a selected cover clears it and falls back to another authorized page',async()=>{
 const first=await value(A,"select add_memory_page($1,null,'polaroid',$2) value",[ONE,publicBook]);
 await value(A,"select add_memory_page($1,null,'polaroid',$2) value",[TWO,publicBook]);
 await as(A,"select save_memory_book_presentation($1,'Together','cream','profile','postcard','',$2)",[publicBook,ONE]);
 await db.query('delete from memory_pages where id=$1',[first]);
 const book=await value(A,'select get_memory_book($1) value',[publicBook]);
 assert.equal(book.cover_story_id,null);assert.equal(book.cover_page.story_id,TWO);
 assert.equal((await value(A,'select get_memory_albums($1) value',[A])).books.find(x=>x.id===publicBook).cover_page.story_id,TWO);
});
test('moving a selected page to another owned book clears the old cover binding',async()=>{
 const page=await value(A,"select add_memory_page($1,null,'polaroid',$2) value",[ONE,publicBook]);
 await as(A,"select save_memory_book_presentation($1,'Together','cream','profile','postcard','',$2)",[publicBook,ONE]);
 await db.query('update memory_pages set album_id=$1 where id=$2',[privateBook,page]);
 const book=await value(A,'select get_memory_book($1) value',[publicBook]);assert.equal(book.cover_story_id,null);assert.equal(book.cover_page,null);
});
test('private cover media and subtitle do not appear in another person’s shelf or book',async()=>{
 await value(A,"select add_memory_page($1,null,'polaroid',$2) value",[ONE,privateBook]);
 await as(A,"select save_memory_book_presentation($1,'Private title','cream','only_me','postcard','Private subtitle',$2)",[privateBook,ONE]);
 const shelf=JSON.stringify(await value(B,'select get_memory_albums($1) value',[A]));
 assert.equal(shelf.includes('Private subtitle'),false);assert.equal(shelf.includes('first.jpg'),false);
 assert.deepEqual(await value(B,'select get_memory_book($1) value',[privateBook]),{can_view:false,is_owner:false,count:0,pages:[]});
});
test('presentation rejects unattached covers, overlong subtitles and anonymous execution',async()=>{
 await assert.rejects(()=>value(A,"select create_memory_book_presentation('Bad','cream','postcard','',array[$1]::uuid[],$2) value",[ONE,TWO]),/COVER_NOT_SELECTED/);
 await assert.rejects(()=>value(A,"select create_memory_book_presentation('Bad','cream','postcard',$1) value",['x'.repeat(121)]),/INVALID_BOOK_PRESENTATION/);
 await assert.rejects(()=>db.query('update memory_albums set cover_story_id=$1 where id=$2',[FOREIGN,publicBook]),/COVER_NOT_IN_OWNED_BOOK/);
 await db.exec('set role anon');
 try{await assert.rejects(()=>db.query("select create_memory_book_presentation('Bad')"),/permission denied/);}finally{await db.exec('reset role');}
});

test('presentation retains the deployed 30-character title limit and existing settings validation',async()=>{
 const count=(await db.query('select count(*)::int value from memory_albums')).rows[0].value;
 await assert.rejects(()=>value(A,"select create_memory_book_presentation($1,'cream','postcard','',array[$2]::uuid[],$2) value",['x'.repeat(31),ONE]),/memory_albums_title_check/);
 assert.equal((await db.query('select count(*)::int value from memory_albums')).rows[0].value,count);
 for (const [title,color,audience,design] of [['','cream','profile','postcard'],['Good','invalid','profile','postcard'],['Good','cream','invalid','postcard'],['Good','cream','profile','invalid'],['x'.repeat(31),'cream','profile','postcard']]) {
   await assert.rejects(()=>as(A,"select save_memory_book_presentation($1,$2,$3,$4,$5,'',null)",[publicBook,title,color,audience,design]));
 }
 assert.equal((await value(A,'select get_memory_book($1) value',[publicBook])).title,'Together');
});
test('installed clients can still save the legacy book design without losing presentation metadata',async()=>{
 const id=await value(A,"select create_memory_book_presentation('Weekend','cream','postcard','A line to keep',array[$1]::uuid[],$1) value",[ONE]);
 await as(A,"select save_memory_book_design($1,'Renamed','rose','only_me','keepsake',null)",[id]);
 const book=await value(A,'select get_memory_book($1) value',[id]);assert.equal(book.title,'Renamed');assert.equal(book.subtitle,'A line to keep');assert.equal(book.cover_story_id,ONE);assert.equal(book.cover_page.story_id,ONE);
});
