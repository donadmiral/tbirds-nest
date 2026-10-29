import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { extensions, loadLiveSchema } from './live-schema-fixture.mjs';
import { captureMusicState, assertMusicUnchanged } from './non-music-release-assertions.mjs';

const root = new URL('../../../', import.meta.url);
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const C = '10000000-0000-4000-8000-000000000003';
const ONE = '20000000-0000-4000-8000-000000000001';
const TWO = '20000000-0000-4000-8000-000000000002';
const FOREIGN = '20000000-0000-4000-8000-000000000003';
let db, publicBook, privateBook, originalMusic, projectionAclBefore, projectionAclAfter;

async function as(actor, sql, params = [], role = 'authenticated') {
  await db.exec('savepoint caller_request');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor || '']);
    const rows = (await db.query(sql, params)).rows;
    await db.exec('reset role; release savepoint caller_request');
    return rows;
  } catch (error) {
    await db.exec('rollback to savepoint caller_request; release savepoint caller_request');
    throw error;
  }
}
const value = async (actor, sql, params = []) => (await as(actor, sql, params))[0].value;
const readBook = (id, actor = A) => value(actor, 'select public.get_memory_book($1) value', [id]);
const save = (id, title = 'Together', color = 'rose', audience = 'profile', design = 'keepsake', subtitle = '', cover = null, actor = A) =>
  as(actor, 'select public.save_memory_book_presentation($1,$2,$3,$4,$5,$6,$7)', [id,title,color,audience,design,subtitle,cover]);

test.before(async () => {
  db = new PGlite({ extensions });
  await loadLiveSchema(db);
  await db.exec("alter table auth.users add column if not exists created_at timestamptz default now(); grant usage on schema auth to authenticated,anon; insert into storage.buckets(id,name,public) values('chat-media','chat-media',true),('chat-files','chat-files',true);");
  const plan = JSON.parse(await readFile(new URL('supabase/ops/production-rollout-20261029.json', root), 'utf8'));
  // These are the exact seven units already applied to production. The visual
  // migration must work here without any rejected music prerequisite or stub.
  for (const unit of plan.units.slice(0, 7)) {
    const sources = await Promise.all(unit.files.map(file => readFile(new URL(file.path, root), 'utf8')));
    await db.exec(sources.length > 1 ? `begin;\n${sources.join('\n')}\ncommit;` : sources[0]);
  }
  for (const [id, name] of [[A,'bookowner'], [B,'bookviewer'], [C,'bookother']]) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id,`${name}@example.test`]);
    await db.query("insert into public.profiles(id,email,username,profile_visibility) values($1,$2,$3,'public') on conflict(id) do update set username=excluded.username,profile_visibility='public'", [id,`${name}@example.test`,name]);
  }
  // A pre-existing catalogue row proves the migration leaves data untouched.
  await db.query("insert into public.story_sounds(owner_id,title,url,source) values($1,'Existing synthetic record','https://example.test/existing-audio','original')", [A]);
  originalMusic = await captureMusicState(db);
  const sql = await readFile(new URL('supabase/migrations/20261029054043_memory_book_visual_presentation.sql', root), 'utf8');
  assert.doesNotMatch(sql, /soundtrack|story_sounds|audio_|music|resolve_story_sound/i);
  await db.exec(sql);
  const aclSql = "select proname,proacl::text as permissions from pg_proc where oid in ('public.get_memory_book(uuid)'::regprocedure,'public.get_memory_albums(uuid)'::regprocedure) order by proname";
  projectionAclBefore = (await db.query(aclSql)).rows;
  const qaProjection = await readFile(new URL('supabase/migrations/20261029055318_memory_book_reader_visual_projection.sql', root), 'utf8');
  assert.doesNotMatch(qaProjection, /soundtrack|story_sounds|audio_|music|alter table|create trigger/i);
  assert.equal((qaProjection.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 2);
  for (const name of ['get_memory_book','get_memory_albums']) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    const end = sql.indexOf('\n$$;', start) + 4;
    assert.ok(qaProjection.includes(sql.slice(start, end)), `QA and production reader differ: ${name}`);
  }
  await db.exec(qaProjection);
  projectionAclAfter = (await db.query(aclSql)).rows;
  for (const [id, author, type, name] of [[ONE,A,'image','first.jpg'], [TWO,A,'video','second.mp4'], [FOREIGN,B,'image','foreign.jpg']]) {
    await db.query("insert into public.stories(id,user_id,media_type,media_url,caption,expires_at) values($1,$2,$3,$4,$5,now()-interval '1 day')", [id,author,type,`https://example.test/${name}`,name]);
  }
});
test.after(() => db.close());
test.beforeEach(async () => {
  await db.exec('begin');
  publicBook = await value(A, "select public.create_memory_book_design('Together','rose','keepsake') value");
  privateBook = await value(A, "select public.create_memory_book_design('Private title','ink','night_film') value");
  await save(privateBook, 'Private title', 'ink', 'only_me', 'night_film');
});
test.afterEach(() => db.exec('rollback'));

test('the visual migration leaves all existing music data, schema, APIs and permissions unchanged', async () => {
  await assertMusicUnchanged(db, originalMusic);
  assert.deepEqual(projectionAclAfter, projectionAclBefore, 'QA reader-only replacement must preserve existing grants');
  assert.equal((await db.query("select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='memory_albums' and column_name='soundtrack'")).rows[0].n, 0);
  const book = await readBook(publicBook);
  assert.equal(Object.hasOwn(book, 'soundtrack'), false);
});

test('each book is authorized independently without exposing private metadata on the shelf', async () => {
  const shelf = await value(B, 'select public.get_memory_albums($1) value', [A]);
  assert.deepEqual(shelf.books.map(x => x.id), [publicBook]);
  assert.equal(JSON.stringify(shelf).includes('Private title'), false);
  assert.deepEqual(await readBook(privateBook, B), {can_view:false,is_owner:false,count:0,pages:[]});
  assert.equal((await value(A, 'select public.get_memory_albums($1) value', [A])).books.length, 2);
});

test('custom and follower visibility, profile privacy, blocks and deactivation still apply', async () => {
  await save(publicBook, 'Together', 'rose', 'custom');
  assert.equal((await readBook(publicBook, B)).can_view, false);
  await db.query("insert into public.memory_album_access(owner_id,member_id,kind) values($1,$2,'allow')", [A,B]);
  assert.equal((await readBook(publicBook, B)).can_view, true);
  await db.query("insert into public.memory_album_access(owner_id,member_id,kind) values($1,$2,'block')", [A,B]);
  assert.equal((await readBook(publicBook, B)).can_view, false);
  await db.query('delete from public.memory_album_access where owner_id=$1', [A]);
  await save(publicBook, 'Together', 'rose', 'followers');
  assert.equal((await readBook(publicBook, B)).can_view, false);
  await db.query('insert into public.follows(follower_id,following_id) values($1,$2)', [B,A]);
  assert.equal((await readBook(publicBook, B)).can_view, true);
  await save(publicBook);
  await db.query("update public.profiles set profile_visibility='private' where id=$1", [A]);
  assert.equal((await readBook(publicBook, C)).can_view, false);
  assert.equal((await readBook(publicBook, B)).can_view, true);
  await db.query('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)', [B,A]);
  assert.equal((await readBook(publicBook, B)).can_view, false);
  await db.query('update public.profiles set deactivated_at=now() where id=$1', [A]);
  assert.equal((await readBook(publicBook)).can_view, false);
});

test('archived pages keep stable IDs and append order, and duplicate saves are idempotent', async () => {
  const first = await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [ONE,publicBook]);
  assert.equal(await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [ONE,publicBook]), first);
  assert.notEqual(first, ONE);
  const second = await value(A, "select public.add_memory_page($1,null,'full',$2) value", [TWO,publicBook]);
  const book = await readBook(publicBook, B);
  assert.deepEqual(book.pages.map(p => [p.id,p.story_id,p.sort_order,p.style]), [[first,ONE,0,'polaroid'],[second,TWO,1,'full']]);
  assert.equal(book.pages.some(p => Object.hasOwn(p,'audio_url') || Object.hasOwn(p,'audio_title')), false);
});

test('book pages preserve the actual story trim, speed, filter and sticker recipe', async () => {
  const transform = {fit:'contain',scale:1.2,translateNX:0.1,translateNY:-0.05,trimStart:0.5,trimEnd:3.5,speed:1.5};
  const stickers = [{id:'text-1',kind:'text',text:'A day to keep',style:'classic',color:'#ffffff',nx:0.5,ny:0.25,scale:1,rotation:0},{id:'draw-1',kind:'drawing',nx:0.5,ny:0.5,scale:1,rotation:0,strokes:[{tool:'pen',width:5,points:[{x:0.1,y:0.1},{x:0.5,y:0.5}],color:'#ff0000'}]}];
  await db.query('update public.stories set media_transform=$1::jsonb,filter_id=$2,stickers_json=$3::jsonb where id=$4', [JSON.stringify(transform),'warm',JSON.stringify(stickers),TWO]);
  await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [TWO,publicBook]);
  const page = (await readBook(publicBook)).pages[0];
  assert.deepEqual(page.media_transform, transform);
  assert.equal(page.filter_id, 'warm');
  assert.deepEqual(page.stickers, stickers);
  const cover = (await value(B, 'select public.get_memory_albums($1) value', [A])).books.find(x => x.id === publicBook).cover_page;
  assert.deepEqual(cover.media_transform, transform);
  assert.deepEqual(cover.stickers, stickers);
});

test('foreign stories and foreign book targets reject without a partial save', async () => {
  await assert.rejects(() => value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [FOREIGN,publicBook]), /STORY_NOT_OWNED/);
  await assert.rejects(() => value(B, "select public.add_memory_page($1,null,'polaroid',$2) value", [FOREIGN,publicBook]), /BOOK_NOT_OWNED/);
  assert.equal((await readBook(publicBook)).count, 0);
});

test('direct page writes cannot bypass ownership or attach a foreign story', async () => {
  await assert.rejects(() => as(A, "insert into public.memory_pages(user_id,album_id,story_id,media_type) values($1,$2,$3,'image')", [A,publicBook,FOREIGN]), /MEMORY_PAGE_OWNER_MISMATCH/);
  await assert.rejects(() => as(B, "insert into public.memory_pages(user_id,album_id,story_id,media_type) values($1,$2,$3,'image')", [B,publicBook,FOREIGN]), /MEMORY_PAGE_OWNER_MISMATCH/);
});

test('page order swaps atomically and cannot cross owners or books', async () => {
  const first = await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [ONE,publicBook]);
  const second = await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [TWO,publicBook]);
  const other = await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [ONE,privateBook]);
  await assert.rejects(() => as(B, 'select public.swap_memory_pages($1,$2)', [first,second]), /PAGES_NOT_OWNED/);
  await assert.rejects(() => as(A, 'select public.swap_memory_pages($1,$2)', [first,other]), /DIFFERENT_BOOK/);
  await as(A, 'select public.swap_memory_pages($1,$2)', [first,second]);
  assert.deepEqual((await readBook(publicBook)).pages.map(p => p.id), [second,first]);
});

test('new book creation saves selected stories, subtitle and exact cover atomically', async () => {
  const id = await value(A, "select public.create_memory_book_presentation('Weekend away','cream','postcard','Small moments, kept',array[$1,$2]::uuid[],$2) value", [ONE,TWO]);
  const book = await readBook(id);
  assert.equal(book.subtitle, 'Small moments, kept');
  assert.deepEqual(book.pages.map(p => p.story_id), [ONE,TWO]);
  assert.equal(book.cover_story_id, TWO);
  assert.equal(book.cover_page.story_id, TWO);
  const shelfBook = (await value(B, 'select public.get_memory_albums($1) value', [A])).books.find(x => x.id === id);
  assert.equal(shelfBook.subtitle, book.subtitle);
  assert.equal(shelfBook.cover_page.story_id, TWO);
  assert.equal(shelfBook.count, 2);
});

test('a rejected foreign story rolls back the complete new book without duplicates', async () => {
  const count = (await db.query('select count(*)::int value from public.memory_albums')).rows[0].value;
  await assert.rejects(() => value(A, "select public.create_memory_book_presentation('Rejected','cream','postcard','',array[$1,$2]::uuid[],$1) value", [ONE,FOREIGN]), /STORY_NOT_OWNED/);
  assert.equal((await db.query('select count(*)::int value from public.memory_albums')).rows[0].value, count);
  assert.equal((await db.query('select count(*)::int value from public.memory_pages')).rows[0].value, 0);
});

test('presentation edits select only an existing owned page and preserve data after a rejection', async () => {
  await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [ONE,publicBook]);
  await save(publicBook, 'Edited', 'cream', 'profile', 'editorial', 'A quiet day', ONE);
  assert.equal((await readBook(publicBook)).cover_story_id, ONE);
  await assert.rejects(() => save(publicBook, 'Bad', 'cream', 'profile', 'postcard', '', TWO), /COVER_NOT_IN_OWNED_BOOK/);
  await assert.rejects(() => save(publicBook, 'Bad', 'cream', 'profile', 'postcard', '', FOREIGN, B), /BOOK_NOT_OWNED/);
  assert.equal((await readBook(publicBook)).title, 'Edited');
});

test('deleting the selected cover page clears its binding and both readers use the same fallback', async () => {
  const first = await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [ONE,publicBook]);
  await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [TWO,publicBook]);
  await save(publicBook, 'Together', 'cream', 'profile', 'postcard', '', ONE);
  await as(A, 'delete from public.memory_pages where id=$1', [first]);
  const book = await readBook(publicBook);
  assert.equal(book.cover_story_id, null);
  assert.equal(book.cover_page.story_id, TWO);
  assert.equal((await value(A, 'select public.get_memory_albums($1) value', [A])).books.find(x => x.id === publicBook).cover_page.story_id, TWO);
});

test('moving the selected page to another owned book clears the old cover', async () => {
  const page = await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [ONE,publicBook]);
  await save(publicBook, 'Together', 'cream', 'profile', 'postcard', '', ONE);
  await as(A, 'update public.memory_pages set album_id=$1 where id=$2', [privateBook,page]);
  assert.equal((await readBook(publicBook)).cover_story_id, null);
  assert.equal((await readBook(publicBook)).cover_page, null);
});

test('all eight existing cover styles persist with the unchanged 30-character title limit', async () => {
  for (const design of ['keepsake','postcard','editorial','field_notes','night_film','daybook','botanical','classic']) {
    await save(publicBook, 'x'.repeat(30), 'cream', 'profile', design);
    assert.equal((await readBook(publicBook)).cover_design, design);
  }
  for (const args of [['','cream','profile','postcard'],['Good','invalid','profile','postcard'],['Good','cream','invalid','postcard'],['Good','cream','profile','invalid'],['x'.repeat(31),'cream','profile','postcard']]) {
    await assert.rejects(() => save(publicBook, ...args));
  }
  assert.equal((await readBook(publicBook)).title, 'x'.repeat(30));
  const count = (await db.query('select count(*)::int value from public.memory_albums')).rows[0].value;
  await assert.rejects(() => value(A, "select public.create_memory_book_presentation($1,'cream','postcard','',array[$2]::uuid[],$2) value", ['x'.repeat(31),ONE]), /INVALID_BOOK_SETTINGS|memory_albums_title_check/);
  assert.equal((await db.query('select count(*)::int value from public.memory_albums')).rows[0].value, count);
});

test('invalid covers, excessive subtitle/pages and anonymous mutations are rejected', async () => {
  await assert.rejects(() => value(A, "select public.create_memory_book_presentation('Bad','cream','postcard','',array[$1]::uuid[],$2) value", [ONE,TWO]), /COVER_NOT_SELECTED/);
  await assert.rejects(() => value(A, "select public.create_memory_book_presentation('Bad','cream','postcard',$1) value", ['x'.repeat(121)]), /INVALID_BOOK_PRESENTATION/);
  await assert.rejects(() => value(A, "select public.create_memory_book_presentation('Bad','cream','postcard','',$1::uuid[]) value", [Array(81).fill(ONE)]), /INVALID_BOOK_PRESENTATION/);
  await assert.rejects(() => as(null, "select public.create_memory_book_presentation('Bad')", [], 'anon'), /permission denied/);
  for (const signature of ['get_memory_book(uuid)','get_memory_albums(uuid)','create_memory_book_design(text,text,text)','create_memory_book_presentation(text,text,text,text,uuid[],uuid)','save_memory_book_presentation(uuid,text,text,text,text,text,uuid)','add_memory_page(uuid,text,text,uuid)','swap_memory_pages(uuid,uuid)']) {
    assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') allowed", [signature])).rows[0].allowed, false, signature);
  }
});

test('installed baseline clients retain create, update, default album, and delete contracts', async () => {
  const id = await value(A, "select public.create_memory_book('Legacy book','blush') value");
  await value(A, "select public.add_memory_page($1,null,'polaroid',$2) value", [ONE,id]);
  await save(id, 'New cover', 'cream', 'profile', 'editorial', 'Keep this subtitle', ONE);
  await as(A, "select public.update_memory_book($1,'Legacy edit','sage','only_me')", [id]);
  const updated = await readBook(id);
  assert.equal(updated.title, 'Legacy edit');
  assert.equal(updated.subtitle, 'Keep this subtitle');
  assert.equal(updated.cover_story_id, ONE);
  await as(A, "select public.upsert_memory_album('Default album','rose','profile')");
  const defaultPage = await value(A, "select public.add_memory_page($1) value", [TWO]);
  const defaultBook = await value(A, 'select public.get_memory_album($1) value', [A]);
  assert.equal(defaultBook.title, 'Default album');
  assert.equal(defaultBook.pages[0].id, defaultPage);
  await as(A, 'select public.delete_memory_book($1)', [id]);
  assert.equal((await readBook(id)).can_view, false);
});
