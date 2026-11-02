const { test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { fixture, legacy, migration, login, id, OWNER, VIEWER, FOREIGN, BOOK, PRIVATE_BOOK } = require('./paged-readers-fixture.cjs');
let db, originalReaders;
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
const book = (cursor = null, limit = 19, album = BOOK) => scalar('select public.get_memory_book_page_v2($1,$2,$3)', [album, cursor, limit]);
const inbox = (cursor = null, limit = 17, options = {}) => scalar(`select public.get_inbox_page_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [options.context ?? null, cursor, limit, options.order ?? 'pinned', options.folder ?? 'all', options.groups ?? true, options.deleted ?? false, options.badges ?? false,
    options.ids ?? null, options.search ?? null, options.searchMode ?? 'web', options.filter ?? 'all', options.excludeCommunity ?? false, options.excludeRequests ?? false]);
const readerDefinitions = () => rows(`select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc
  where oid in('public.get_memory_book(uuid)'::regprocedure,'public.get_memory_albums(uuid)'::regprocedure,'public.get_unread_counts()'::regprocedure,'public.get_context_unread()'::regprocedure) order by 1`);
async function rejects(work, pattern) {
  await db.exec('savepoint expected_failure;');
  try { await assert.rejects(work, pattern); } finally { await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure;'); }
}
async function privileged(sql) { await db.exec('reset role;' + sql); await db.exec(login()); }
before(async () => {
  db = new PGlite(); await db.exec(fixture + legacy); originalReaders = await readerDefinitions(); await db.exec(migration);
});
beforeEach(async () => { await db.exec('reset role;begin;update read_paging.settings set books_ready=true,inbox_ready=true;' + login()); });
afterEach(async () => { await db.exec('rollback;reset role;'); });
after(async () => db?.close());

test('existing readers are unchanged; capabilities require explicit service readiness', async () => {
  assert.deepEqual(await readerDefinitions(), originalReaders);
  await privileged('update read_paging.settings set books_ready=false,inbox_ready=false;');
  assert.deepEqual(await scalar('select public.get_paged_reader_capabilities()'), { version: 1, books: false, inbox: false, book_page_limit: 40, inbox_page_limit: 50 });
  await rejects(() => book(), /NOT_READY/); await rejects(() => inbox(), /NOT_READY/);
  // The old, complete reader still works while the additive capability is off.
  assert.equal((await scalar('select public.get_memory_book($1)', [BOOK])).count, 83);
  await rejects(() => db.exec('select public.configure_paged_readers(true,true);'), /permission denied/);
  await db.exec("reset role;set role service_role;select set_config('request.jwt.claim.role','service_role',false);select public.configure_paged_readers(true,false);");
  await db.exec(login());
  assert.equal((await scalar('select public.get_paged_reader_capabilities()')).books, true);
  assert.equal((await scalar('select public.get_paged_reader_capabilities()')).inbox, false);
});

test('paged book concatenation equals the full creative/music reader, with a later-page cover', async () => {
  const complete = await scalar('select public.get_memory_book($1)', [BOOK]);
  const first = await book();
  for (const [key, value] of Object.entries(complete)) if (key !== 'pages') assert.deepEqual(first[key], value, key);
  assert.equal(first.pages.length, 19); assert.equal(first.count, 83);
  assert.equal(first.cover_page.id, id(2078));
  assert.equal(first.pages.some(page => page.id === first.cover_page.id), false);
  assert.deepEqual(first.cover_pages.map(page => page.story_id), [id(1078), id(1003)]);
  const all = [...first.pages]; let cursor = first.next_cursor, requests = 1;
  while (cursor) {
    const page = await book(cursor, 19); requests++;
    assert.equal(page.metadata_included, false); assert.equal('count' in page, false); assert.equal('cover_page' in page, false);
    assert.ok(page.pages.length <= 19); all.push(...page.pages); cursor = page.next_cursor;
  }
  assert.equal(requests, 5); assert.deepEqual(all, complete.pages);
  assert.equal(new Set(all.map(page => page.id)).size, 83);
  assert.equal(all.some(page => page.media_url === 'foreign-secret'), false);
  assert.ok(all.some(page => page.audio_url)); assert.ok(all.some(page => page.audio_sound_id && page.audio_url === null));
});

test('book cursor preserves timestamp precision and rejects foreign/malformed cursor bindings', async () => {
  const first = await book(null, 3); assert.match(first.next_cursor.created_at, /\.000001/);
  const second = await book(first.next_cursor, 3); assert.equal(second.pages.length, 3);
  for (const altered of [
    { ...first.next_cursor, viewer: OWNER }, { ...first.next_cursor, album: PRIVATE_BOOK },
    { ...first.next_cursor, created_at: 'infinity' }, { ...first.next_cursor, created_at: 'not a timestamp' },
    { ...first.next_cursor, sort_order: 1e100 }, { ...first.next_cursor, id: 'bad' }, [],
  ]) await rejects(() => book(altered), /INVALID_BOOK_CURSOR/);
  await rejects(() => book(null, 41), /INVALID_BOOK_PAGE_REQUEST/);
});

test('book edits and reorders invalidate continuation; view-counter changes and rollback do not', async () => {
  const first = await book(null, 2);
  await privileged(`update stories set views_count=views_count+1 where id='${id(1002)}';`);
  assert.equal((await book(first.next_cursor)).revision, first.revision);
  await db.exec('savepoint discarded_edit;reset role;');
  await db.exec(`update memory_pages set sort_order=-3 where id='${id(2078)}';rollback to savepoint discarded_edit;release savepoint discarded_edit;`);
  assert.equal((await book(first.next_cursor)).revision, first.revision);
  await privileged(`update memory_pages set sort_order=-3 where id='${id(2078)}';`);
  await rejects(() => book(first.next_cursor), /MEMORY_BOOK_CHANGED/);
  const changed = await book(); assert.equal(changed.pages[0].id, id(2078));
  await privileged(`update stories set media_url='new-media' where id='${id(1002)}';`);
  await rejects(() => book(changed.next_cursor), /MEMORY_BOOK_CHANGED/);
  const edited = await book();
  await privileged(`update memory_albums set title='New title' where id='${BOOK}';`);
  await rejects(() => book(edited.next_cursor), /MEMORY_BOOK_CHANGED/);
});

test('deleting a story/page or moving a page invalidates the cursor without count drift', async () => {
  let first = await book();
  await privileged(`delete from stories where id='${id(1002)}';`);
  await rejects(() => book(first.next_cursor), /MEMORY_BOOK_CHANGED/);
  first = await book(); assert.equal(first.count, 82);
  await privileged(`delete from memory_pages where id='${id(2003)}';`);
  await rejects(() => book(first.next_cursor), /MEMORY_BOOK_CHANGED/);
  first = await book(); assert.equal(first.count, 81);
  await privileged(`update memory_pages set album_id='${PRIVATE_BOOK}' where id='${id(2004)}';`);
  await rejects(() => book(first.next_cursor), /MEMORY_BOOK_CHANGED/);
  assert.equal((await book()).count, 80);
});

test('authorization is rechecked on every book page and retains active session/business/erasure gates', async () => {
  const first = await book();
  assert.equal((await book(null, 20, PRIVATE_BOOK)).can_view, false);
  await privileged(`insert into blocked_users values('${OWNER}','${VIEWER}');`);
  const blocked = await book(first.next_cursor); assert.equal(blocked.can_view, false); assert.deepEqual(blocked.pages, []);
  await privileged('delete from blocked_users;');
  for (const [key, value, error] of [['test.session', 'expired', /ACTIVE_SESSION/], ['test.business', 'denied', /BUSINESS_SESSION/], ['test.erasure', 'pending', /ACCOUNT_ERASURE/]]) {
    await db.query('select set_config($1,$2,false)', [key, value]);
    await rejects(() => book(), error); await db.exec(login());
  }
  await privileged(`update memory_albums set audience='custom' where id='${BOOK}';`);
  assert.equal((await book()).can_view, false);
  await privileged(`insert into memory_album_access values('${BOOK}','${VIEWER}','allow');`);
  assert.equal((await book()).can_view, true);
  await privileged(`update profiles set deactivated_at=now() where id='${OWNER}';`);
  assert.equal((await book()).can_view, false);
});

test('book media rights are re-evaluated on continuation', async () => {
  const first = await book(null, 4);
  await privileged('delete from allowed_sounds;');
  const second = await book(first.next_cursor, 4);
  assert.ok(second.pages.length > 0); assert.equal(second.pages.every(page => page.audio_url === null), true);
});

test('shelf pages reproduce the complete creative shelf and retain default/tie ordering', async () => {
  await privileged(`update memory_albums set is_default=true where id='${BOOK}';
    insert into memory_albums(id,user_id,title,created_at) select
      ('00000000-0000-0000-0000-'||lpad((400+n)::text,12,'0'))::uuid,'${OWNER}','Book-'||n,'2026-01-01' from generate_series(1,29)n;
    insert into memory_pages(id,album_id,user_id,story_id) select
      ('00000000-0000-0000-0000-'||lpad((600+n)::text,12,'0'))::uuid,
      ('00000000-0000-0000-0000-'||lpad((400+n)::text,12,'0'))::uuid,'${OWNER}','${id(1001)}' from generate_series(1,29)n where n%4<>0;`);
  const complete = await scalar('select get_memory_albums($1)', [OWNER]);
  const all = []; let cursor = null, first;
  do {
    const page = await scalar('select get_memory_books_page_v2($1,$2,7)', [OWNER, cursor]);
    first ??= page; assert.ok(page.books.length <= 7); all.push(...page.books); cursor = page.next_cursor;
  } while (cursor);
  assert.equal(all[0].id, BOOK); assert.equal(all.length, 30); assert.deepEqual(all, complete.books);
  const next = await scalar('select get_next_memory_book_v2($1,true)', [BOOK]);
  assert.deepEqual(next, complete.books[1]);
  const nonempty = await scalar('select get_next_memory_book_v2($1,false)', [id(403)]);
  assert.equal(nonempty.id, id(405));
  await rejects(() => scalar('select get_memory_books_page_v2($1,$2,7)', [OWNER, { ...first.next_cursor, viewer: OWNER }]), /INVALID_SHELF_CURSOR/);
  await privileged(`update memory_albums set title='Edited title' where id='${id(429)}';`);
  await rejects(() => scalar('select get_memory_books_page_v2($1,$2,7)', [OWNER, first.next_cursor]), /MEMORY_BOOK_CHANGED/);
  assert.equal(await scalar('select get_next_memory_book_v2($1,true)', [PRIVATE_BOOK]), null);
});

test('hidden or empty shelves expose no owner revision or changed-cursor activity signal', async () => {
  const old = await scalar('select get_memory_books_page_v2($1,null,1)', [OWNER]);
  await privileged(`update memory_albums set audience='only_me' where user_id='${OWNER}';`);
  const hidden = await scalar('select get_memory_books_page_v2($1,$2,1)', [OWNER, old.next_cursor]);
  assert.equal(hidden.revision, '0'); assert.deepEqual(hidden.books, []);
  await privileged(`update memory_albums set title='Private edit' where user_id='${OWNER}';update memory_pages set caption='Private edit' where album_id='${BOOK}';`);
  const changed = await scalar('select get_memory_books_page_v2($1,$2,1)', [OWNER, { version: 2, owner: OWNER, viewer: VIEWER, revision: '9999999' }]);
  assert.deepEqual(changed, hidden);
  const absent = await scalar('select get_memory_books_page_v2($1,null,1)', [id(99999)]);
  assert.deepEqual(absent, hidden);
  await db.exec(login(OWNER));
  const authorized = await scalar('select get_memory_books_page_v2($1,null,1)', [OWNER]);
  assert.equal(authorized.books[0].id, BOOK); assert.notEqual(authorized.revision, '0');
});

async function canonicalInbox(options = {}) {
  const context = options.context ?? null, order = options.order ?? 'pinned', folder = options.folder ?? 'all';
  const canonical = await rows(`select c.*,p.full_name,p.username,p.avatar_url,p.is_verified,p.verified_tier,
    coalesce(s.is_pinned,false) pinned,coalesce(s.is_muted,false) muted,coalesce(s.is_archived,false) archived,
    coalesce(s.is_deleted,false) deleted,coalesce(s.manually_unread,false) marked_unread,
    coalesce(c.last_message_time,'epoch') activity
    from conversations c left join profiles p on not c.is_group and p.id=case when c.user_1=$1 then c.user_2 else c.user_1 end
    left join conversation_settings s on s.conversation_id=c.id and s.user_id=$1
    where ((not c.is_group and (c.user_1=$1 or c.user_2=$1)) or (c.is_group and $2 and exists(select 1 from conversation_members m where m.conversation_id=c.id and m.user_id=$1)))
      and ($3::text is null or coalesce(c.context,'personal')=$3) and ($4 or not coalesce(s.is_deleted,false))
      and ($5='all' or ($5='archived')=coalesce(s.is_archived,false))`, [VIEWER, options.groups ?? true, context, options.deleted ?? false, folder]);
  // Match existing JS millisecond activity semantics, with an explicit UUID tie
  // key added by the new API to make continuation deterministic.
  canonical.sort((a, b) => ((order === 'pinned' ? Number(b.pinned) - Number(a.pinned) : 0)
    || new Date(b.activity).getTime() - new Date(a.activity).getTime() || b.id.localeCompare(a.id)));
  const unread = new Map();
  for (const value of await rows('select * from public.get_unread_counts()')) unread.set(value.conversation_id, (unread.get(value.conversation_id) || 0) + value.unread);
  return { canonical, unread };
}

test('every inbox page preserves ordering, flags, actor details and complete unread counts', async () => {
  const { canonical, unread } = await canonicalInbox();
  const all = []; let cursor = null, count = 0;
  do {
    const page = await inbox(cursor, 17, { badges: true }); count++;
    assert.ok(page.items.length <= 17); assert.deepEqual(page.badges, await scalar('select public.get_context_unread()'));
    all.push(...page.items); cursor = page.next_cursor;
  } while (cursor);
  assert.ok(count > 5); assert.deepEqual(all.map(row => row.id), canonical.map(row => row.id));
  assert.equal(new Set(all.map(row => row.id)).size, canonical.length);
  for (const [index, item] of all.entries()) {
    const expected = canonical[index]; assert.equal(item.unread, unread.get(item.id) || 0, item.id);
    assert.equal(item.is_pinned, expected.pinned); assert.equal(item.is_muted, expected.muted);
    assert.equal(item.is_archived, expected.archived); assert.equal(item.manually_unread, expected.marked_unread);
    assert.equal(item.title, expected.is_group ? expected.group_name || 'Group' : expected.full_name || 'Member');
    assert.equal(item.avatar, expected.is_group ? expected.group_avatar_url : expected.avatar_url);
    assert.equal(item.request_pending, !expected.is_group && expected.request_status === 'pending' && expected.request_sender_id === OWNER);
  }
  assert.equal(all.some(row => row.id === id(3201) || row.id === id(3202)), false);
  assert.equal(all.find(row => row.id === id(3200)).unread, 3); // group + receiver branch, exactly as existing clients
});

test('context, archived, group exclusion and web activity/deleted-row options preserve selected sets', async () => {
  for (const options of [
    { context: 'jobs', folder: 'active' }, { context: 'market', folder: 'archived', groups: false },
    { context: 'personal', order: 'activity', deleted: true }, { order: 'activity', groups: false },
  ]) {
    const { canonical } = await canonicalInbox(options); const all = []; let cursor = null;
    do { const page = await inbox(cursor, 11, options); all.push(...page.items); cursor = page.next_cursor; } while (cursor);
    assert.deepEqual(all.map(row => row.id), canonical.map(row => row.id));
  }
});

async function allInbox(options, limit = 9) {
  const all = []; let cursor = null;
  do { const page = await inbox(cursor, limit, options); all.push(...page.items); cursor = page.next_cursor; } while (cursor);
  return all;
}
function applyClientFilters(canonical, unread, options) {
  if (options.searchMode === 'native' && options.folder === 'archived') return canonical;
  const query = options.searchMode === 'native' ? (options.search || '').toLowerCase() : (options.search || '').trim().toLowerCase();
  return canonical.filter(row => {
    const title = row.is_group ? row.group_name || 'Group' : row.full_name || 'Member';
    const request = !row.is_group && row.request_status === 'pending' && row.request_sender_id === (row.user_1 === VIEWER ? row.user_2 : row.user_1);
    return !(options.excludeCommunity && row.is_group && row.group_type === 'community')
      && !(options.excludeRequests && request)
      && (options.filter !== 'groups' || row.is_group)
      && (options.filter !== 'unread' || (unread.get(row.id) || 0) > 0)
      && (!query || (options.searchMode === 'native' ? title : title + ' ' + (row.is_group ? '' : row.username || '')).toLowerCase().includes(query));
  });
}
test('bounded server search and tabs reproduce native/web literal Unicode filtering across all pages', async () => {
  await privileged(`update profiles set full_name='İSTANBUL ΣΟΣ %_\\ Chair',username='ONLYHANDLE' where id='${OWNER}';
    delete from messages where conversation_id='${id(3007)}';
    insert into conversations(id,user_1,is_group,group_name,last_message_time) values('${id(3300)}','${OWNER}',true,'',now());
    insert into conversation_members values('${id(3300)}','${VIEWER}','epoch');`);
  for (const options of [
    { search: 'i\u0307stanbul', searchMode: 'web' }, { search: '\ufeffONLYHANDLE\u00a0', searchMode: 'web' },
    { search: 'ONLYHANDLE', searchMode: 'native' }, { search: 'σος', searchMode: 'native' },
    { search: '%_\\', searchMode: 'web' }, { search: ' Member ', searchMode: 'native' },
    { search: 'GROUP', searchMode: 'native', filter: 'groups' },
    { filter: 'unread', excludeCommunity: true, excludeRequests: true, folder: 'active', context: 'personal', searchMode: 'native' },
    { filter: 'groups', excludeCommunity: true }, { search: '%NOT%', excludeRequests: true },
    { folder: 'archived', searchMode: 'native', search: 'impossible', filter: 'groups', excludeCommunity: true, excludeRequests: true },
  ]) {
    const { canonical, unread } = await canonicalInbox(options);
    const expected = applyClientFilters(canonical, unread, options);
    const actual = await allInbox(options);
    assert.deepEqual(actual.map(row => row.id), expected.map(row => row.id), JSON.stringify(options));
    for (const item of actual) assert.equal(item.unread, unread.get(item.id) || 0);
  }
  await privileged(`update profiles set hidden=true where id='${OWNER}';`);
  assert.equal((await allInbox({ search: 'onlyhandle' })).length, 0, 'search must not bypass profile RLS');
  assert.ok((await allInbox({ search: 'Member', searchMode: 'native' })).length > 50, 'hidden profiles retain the established displayed fallback');
});

test('bounded ID lookups revalidate retained/deep-linked chats outside UI filters without expanding access', async () => {
  const ids = [id(3002), id(3017), id(3019), id(3200), id(3201), id(3202)];
  const { canonical } = await canonicalInbox();
  const options = { ids, folder: 'archived', search: 'no matching title', filter: 'groups', excludeCommunity: true, excludeRequests: true };
  const actual = await allInbox(options, 1);
  assert.deepEqual(actual.map(row => row.id), canonical.filter(row => ids.includes(row.id)).map(row => row.id));
  assert.ok(actual.some(row => row.request_pending)); assert.ok(actual.some(row => row.group_type === 'community'));
  assert.equal(actual.some(row => row.is_deleted || row.id === id(3201) || row.id === id(3202)), false);
  const jobs = await allInbox({ ...options, context: 'jobs' });
  assert.ok(jobs.every(row => row.context === 'jobs'));
  assert.deepEqual((await inbox(null, 10, { ids: [] })).items, []);
  await rejects(() => inbox(null, 10, { ids: Array(51).fill(id(3002)) }), /INVALID_INBOX_PAGE_REQUEST/);
  await rejects(() => inbox(null, 10, { ids: [null] }), /INVALID_INBOX_PAGE_REQUEST/);
  const first = await inbox(null, 1, { ids: [id(3002),id(3017),id(3002)] });
  assert.equal((await inbox(first.next_cursor, 1, { ids: [id(3017),id(3002)] })).items.length, 1, 'ID list canonicalization does not invalidate an equivalent cursor');
});

test('full badges are independent of a one-row inbox page or filtered context', async () => {
  const full = await scalar('select public.get_context_unread()');
  const page = await inbox(null, 1, { context: 'jobs', badges: true });
  assert.deepEqual(page.badges, full); assert.ok(full.market > 0); assert.ok(full.personal > page.items[0].unread);
  const noBadges = await inbox(); assert.equal(noBadges.badges_included, false); assert.equal(noBadges.badges, null);
  const complete = await canonicalInbox();
  assert.equal(noBadges.summary.total, complete.canonical.length);
  assert.equal(noBadges.summary.archived_personal, complete.canonical.filter(row => row.context === 'personal' && row.archived).length);
  const totals = await scalar('select get_inbox_unread_totals_v2()');
  const web = await canonicalInbox({ deleted: true });
  for (const context of ['personal','market','jobs']) assert.equal(totals[context], web.canonical.filter(row => row.context === context).reduce((sum,row) => sum+(web.unread.get(row.id)||0),0));
});

test('inbox cursor binds the account and every selection/order option', async () => {
  const first = await inbox(null, 1);
  for (const altered of [{ ...first.next_cursor, viewer: OWNER }, { ...first.next_cursor, activity_at: 'infinity' },
    { ...first.next_cursor, activity_at: 'bad' }, { ...first.next_cursor, pin: 5 }, { ...first.next_cursor, id: null }, []]) {
    await rejects(() => inbox(altered), /INVALID_INBOX_CURSOR/);
  }
  for (const options of [{ context: 'jobs' }, { folder: 'active' }, { order: 'activity' }, { groups: false }, { deleted: true },
    { search: 'Owner' }, { searchMode: 'native' }, { filter: 'unread' }, { excludeCommunity: true }, { excludeRequests: true }, { ids: [id(3002)] }]) {
    await rejects(() => inbox(first.next_cursor, 1, options), /INVALID_INBOX_CURSOR/);
  }
  await rejects(() => inbox(null, 51), /INVALID_INBOX_PAGE_REQUEST/);
  await rejects(() => inbox(null, 5, { context: 'arbitrary' }), /INVALID_INBOX_PAGE_REQUEST/);
});

test('live inbox order refresh and membership removal require no global per-viewer revision writes', async () => {
  const first = await inbox(null, 1, { order: 'activity' }); assert.equal(first.items[0].id, id(3200));
  await privileged(`delete from conversation_members where conversation_id='${id(3200)}' and user_id='${VIEWER}';
    update conversations set last_message_time='2027-01-01',last_message='New head' where id='${id(3002)}';`);
  const continuation = await inbox(first.next_cursor, 50, { order: 'activity' });
  assert.equal(continuation.items.some(row => row.id === id(3200) || row.id === id(3002)), false);
  // Live keyset pages must be merged with a refreshed head after new activity;
  // they intentionally do not pretend to be a long-lived database snapshot.
  const refreshed = await inbox(null, 1, { order: 'activity' }); assert.equal(refreshed.items[0].id, id(3002));
  assert.equal(refreshed.ordering, 'live');
});

test('inbox retains profile RLS and the bounded unread helper rejects unauthorized conversations', async () => {
  await privileged(`update profiles set hidden=true where id='${OWNER}';`);
  const page = await inbox(null, 20, { groups: false });
  assert.equal(page.items.every(row => row.title === 'Member' && row.avatar === null), true);
  assert.deepEqual(await rows('select * from read_paging.inbox_unread($1)', [[id(3201), id(3202)]]), []);
  assert.equal(await scalar('select read_paging.inbox_has_unread($1)', [id(3201)]), false);
  await rejects(() => rows('select * from read_paging.inbox_unread($1)', [Array.from({ length: 51 }, () => id(3002))]), /INVALID_INBOX_WINDOW/);
  await rejects(() => rows('select * from read_paging.inbox_unread($1)', [[null]]), /INVALID_INBOX_WINDOW/);
  await rejects(() => rows('select * from read_paging.library_revision'), /permission denied/);
  await rejects(() => rows('select * from read_paging.settings'), /permission denied/);
});

test('anonymous and service clients cannot call member readers or the private revision trigger', async () => {
  await db.exec('reset role;set role anon;');
  await rejects(() => book(), /permission denied/); await rejects(() => inbox(), /permission denied/);
  await db.exec('reset role;set role service_role;');
  await rejects(() => book(), /permission denied/); await rejects(() => inbox(), /permission denied/);
  await db.exec(login());
  assert.equal(await scalar("select has_function_privilege('authenticated','read_paging.library_changed()','execute')"), false);
  assert.equal(await scalar("select has_function_privilege('authenticated','read_paging.page_json(memory_pages,stories,boolean)','execute')"), false);
});
