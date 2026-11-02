const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/pagedReaders.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports, AbortController });
const readers = moduleUnderTest.exports;
function windowClient(total=30000) {
  return client(call=>{
    if(call.name==='get_memory_book_window_v3'){
      const at=Number(String(call.args.p_anchor).replace('page-',''));
      const start=Math.max(0,at-call.args.p_before),end=Math.min(total,at+call.args.p_after+1);
      return {data:{version:3,id:'book',can_view:true,revision:'7',anchor_index:at-start,
        pages:Array.from({length:end-start},(_,i)=>({id:'page-'+(start+i),media_url:'raw-'+(start+i)})),
        has_previous:start>0,has_more:end<total,next_cursor:end<total?{version:2,viewer:'viewer',album:'book',revision:'7',after:end}:null},error:null};
    }
    return {data:bookPage(call.args.p_cursor?.after||0,total),error:null};
  },{version:1,books:true,inbox:true,books_window:true});
}
const plain = value => JSON.parse(JSON.stringify(value));
const scope = () => ({ viewer: 'viewer', token: 'fixture-token', signal: new AbortController().signal });
const enabled = { version: 1, books: true, inbox: true };
function client(handler, capability = enabled) {
  const calls = [];
  return { calls, rpc(name, args) {
    const call = { name, args, headers: {}, signal: null }; calls.push(call);
    const query = {
      setHeader(key, value) { call.headers[key] = value; return query; },
      abortSignal(signal) { call.signal = signal; return query; },
      then(resolve, reject) { return Promise.resolve().then(() => name === 'get_paged_reader_capabilities'
        ? typeof capability === 'function' ? capability(call) : { data: capability, error: null }
        : handler(call)).then(resolve, reject); },
    };
    return query;
  } };
}
function bookPage(start = 0, total = 61, revision = '7') {
  const end = Math.min(start + 24, total), more = end < total;
  return { version: 2, id: 'book', can_view: true, metadata_included: start === 0, revision,
    pages: Array.from({ length: end - start }, (_, index) => ({ id: 'page-' + (start + index), media_url: 'raw-' + (start + index) })),
    ...(start === 0 ? { title: 'All memories', count: total, cover_page: { id: 'page-60' } } : {}),
    has_more: more, next_cursor: more ? { version: 2, viewer: 'viewer', album: 'book', revision, after: end } : null };
}
function bookClient(total = 61, capability = enabled) {
  return client(call => ({ data: call.name === 'get_memory_book'
    ? { id: 'book', can_view: true, count: total, pages: Array.from({ length: total }, (_, i) => ({ id: 'page-' + i })) }
    : bookPage(call.args.p_cursor?.after || 0, total), error: null }), capability);
}

test('missing and disabled reader capabilities retain the full legacy book without truncation', async () => {
  for (const capability of [{ version: 1, books: false, inbox: false }, () => ({ data: null, error: { code: 'PGRST202' } })]) {
    const c = bookClient(137, capability), identity = scope();
    const book = await readers.readMemoryBookFirst(c, 'book', identity);
    assert.equal(book.pages.length, 137); assert.equal(readers.memoryBookHasMore(book), false);
    assert.deepEqual(c.calls.map(call => call.name), ['get_paged_reader_capabilities', 'get_memory_book']);
    assert.equal(await readers.readInboxPage(c, identity), null);
    assert.equal(c.calls.length, 2, 'negative capability is cached only for this client/viewer');
  }
});

test('transport and permission failures never downgrade to an older authorized reader', async () => {
  for (const code of ['42501', '57014', 'PGRST301', 'NETWORK']) {
    const c = bookClient(61, () => ({ data: null, error: { code, message: 'read denied' } }));
    await assert.rejects(readers.readMemoryBookFirst(c, 'book', scope()), error => error.code === code);
    assert.deepEqual(c.calls.map(call => call.name), ['get_paged_reader_capabilities']);
  }
  const c = client(() => ({ data: null, error: { code: '42501', message: 'revoked' } }));
  await assert.rejects(readers.readMemoryBookFirst(c, 'book', scope()), error => error.code === '42501');
  assert.equal(c.calls.some(call => call.name === 'get_memory_book'), false);
});

test('initial book is bounded; continuation hydrates only new pages and preserves the selected later cover', async () => {
  const c = bookClient(), identity = scope(), chunks = [];
  const hydrate = async book => { chunks.push(book.pages.map(page => page.id)); return { ...book,
    pages: book.pages.map(page => ({ ...page, media_url: 'signed-' + page.id })), _mediaExpiresAt: chunks.length === 1 ? 100 : 200 }; };
  let book = await readers.readMemoryBookFirst(c, 'book', identity, hydrate);
  assert.equal(book.pages.length, 24); assert.equal(book.count, 61); assert.equal(book.cover_page.id, 'page-60');
  assert.equal(readers.memoryBookHasMore(book), true); assert.equal(c.calls.length, 2);
  book = await readers.readMemoryBookNext(c, book, identity, hydrate);
  assert.equal(book.pages.length, 48); assert.equal(book.pages[0].media_url, 'signed-page-0');
  assert.equal(book._mediaExpiresAt, 100); assert.deepEqual(chunks.map(chunk => chunk.length), [24, 24]);
  book = await readers.readMemoryBookNext(c, book, identity, hydrate);
  assert.equal(book.pages.length, 61); assert.equal(readers.memoryBookHasMore(book), false);
  assert.deepEqual(chunks.map(chunk => chunk.length), [24, 24, 13]);
  for (const call of c.calls) { assert.equal(call.headers.Authorization, 'Bearer fixture-token'); assert.equal(call.signal, identity.signal); }
});

test('complete-book consumers traverse every page without a hidden page or movie limit', async () => {
  const c = bookClient(1003), book = await readers.readMemoryBookComplete(c, 'book', scope());
  assert.equal(book.pages.length, 1003); assert.equal(book.pages.at(-1).id, 'page-1002');
  assert.equal(new Set(book.pages.map(page => page.id)).size, 1003);
  assert.equal(c.calls.filter(call => call.name === 'get_memory_book_page_v2').length, Math.ceil(1003 / 24));
});
test('a continuation without new private media cannot erase the prior page capability expiry', async () => {
  const c = bookClient(), identity = scope();
  const first = await readers.readMemoryBookFirst(c, 'book', identity, async book => ({ ...book, _mediaExpiresAt: 100 }));
  const next = await readers.readMemoryBookNext(c, first, identity, async book => ({ ...book, _mediaExpiresAt: null }));
  assert.equal(next._mediaExpiresAt, 100);
});

test('identity replacement, aborted requests and hydration completion cannot commit an old page', async () => {
  const c = bookClient(), first = await readers.readMemoryBookFirst(c, 'book', scope());
  const before = c.calls.length;
  await assert.rejects(readers.readMemoryBookNext(c, first, { viewer: 'other' }), error => error.name === 'AbortError');
  assert.equal(c.calls.length, before);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readers.readMemoryBookNext(c, first, { viewer: 'viewer', signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(c.calls.length, before);
  let current = true;
  await assert.rejects(readers.readMemoryBookNext(c, first, { ...scope(), current: () => current }, async value => {
    current = false; return value;
  }), error => error.name === 'AbortError');
  assert.equal(first.pages.length, 24, 'a discarded response does not mutate the prior visible book');
});

test('malformed, repeated, missing and changed book pages fail visibly instead of presenting a partial complete book', async () => {
  const first = await readers.readMemoryBookFirst(bookClient(), 'book', scope());
  for (const change of [
    page => ({ ...page, pages: [{ id: first.pages[0].id }] }),
    page => ({ ...page, next_cursor: first._pagination.cursor }),
    page => ({ ...page, has_more: false, next_cursor: null }),
    page => ({ ...page, pages: [{ id: 'same' }, { id: 'same' }] }),
    page => ({ ...page, revision: '8', next_cursor: { ...page.next_cursor, revision: '8' } }),
    () => ({ version: 2, can_view: false, pages: [] }),
  ]) {
    const c = client(() => ({ data: change(bookPage(24)), error: null }));
    await assert.rejects(readers.readMemoryBookNext(c, first, scope()));
    assert.equal(first.pages.length, 24);
  }
  const changed = client(() => ({ data: null, error: { code: '40001', message: 'MEMORY_BOOK_CHANGED' } }));
  await assert.rejects(readers.readMemoryBookNext(changed, first, scope()), error => readers.isMemoryBookChanged(error));
});

function shelfPage(start = 0, total = 31, revision = '8') {
  const end = Math.min(start + 12, total), more = end < total;
  return { version: 2, is_owner: true, revision, books: Array.from({ length: end - start }, (_, i) => ({ id: 'book-' + (start + i), title: 'Book ' + (start + i) })),
    has_more: more, next_cursor: more ? { version: 2, owner: 'owner', viewer: 'viewer', revision, after: end } : null };
}
test('shelf continuation exposes the entire collection and prevents stale-owner or duplicate appends', async () => {
  const c = client(call => ({ data: shelfPage(call.args.p_cursor?.after || 0), error: null }));
  let shelf = await readers.readMemoryShelfFirst(c, 'owner', scope());
  assert.equal(shelf.books.length, 12);
  while (shelf._pagination.cursor) shelf = await readers.readMemoryShelfNext(c, shelf, scope());
  assert.equal(shelf.books.length, 31); assert.equal(shelf.books.at(-1).id, 'book-30');
  const first = await readers.readMemoryShelfFirst(c, 'owner', scope());
  await assert.rejects(readers.readMemoryShelfNext(c, first, { viewer: 'other' }), error => error.name === 'AbortError');
  const duplicate = client(() => ({ data: shelfPage(0), error: null }));
  await assert.rejects(readers.readMemoryShelfNext(duplicate, first, scope()), /collection changed/);
});

test('next-book capability has a clear old-backend fallback and retains no-next-book null', async () => {
  const old = client(() => { throw Error('must not use unsupported RPC'); }, { version: 1, books: false });
  assert.deepEqual(plain(await readers.readNextMemoryBook(old, 'book', true, scope())), { supported: false, book: null });
  const c = client(() => ({ data: null, error: null }));
  assert.deepEqual(plain(await readers.readNextMemoryBook(c, 'book', false, scope())), { supported: true, book: null });
  assert.deepEqual(plain(c.calls.at(-1).args), { p_album: 'book', p_include_empty: false });
});

test('inbox requests pin identity and transmit filters; full badges and archive summary never sum the page', async () => {
  const c = client(call => ({ data: call.name === 'get_inbox_unread_totals_v2'
    ? { version: 2, personal: 501, market: 709, jobs: 31 }
    : { version: 2, items: [{ id: 'chat', unread: 2 }], has_more: false, next_cursor: null,
      badges: { personal: 901 }, badges_included: true, summary: { total: 7001, archived_personal: 57 } }, error: null }));
  const identity = scope(), page = await readers.readInboxPage(c, identity, { ids: ['chat'], search: 'literal_%', searchMode: 'native', filter: 'unread', excludeCommunity: true, excludeRequests: true, badges: true });
  assert.equal(page.summary.total, 7001); assert.equal(page.summary.archivedPersonal, 57); assert.equal(page.badges.personal, 901);
  const request = c.calls.at(-1); assert.equal(request.args.p_search, 'literal_%'); assert.equal(request.args.p_search_mode, 'native');
  assert.equal(request.args.p_filter, 'unread'); assert.equal(request.args.p_exclude_community, true); assert.equal(request.args.p_exclude_requests, true);
  assert.deepEqual(plain(request.args.p_ids), ['chat']); assert.equal(request.headers.Authorization, 'Bearer fixture-token');
  assert.deepEqual(plain(await readers.readInboxUnreadTotals(c, identity)), { personal: 501, market: 709, jobs: 31 });
});

test('long ordinary book walks retain at most 48 pages and restore the exact page in either direction', async()=>{
  const c=windowClient(),identity=scope();let book=await readers.readMemoryBookFirst(c,'book',identity);
  for(let step=0;step<1000;step++){
    const at=Math.max(0,book.pages.length-6),id=book.pages[at].id,absolute=readers.memoryBookOffset(book)+at;
    const result=await readers.readMemoryBookWindow(c,book,at,1,identity);
    book=result.book;assert.equal(book.pages[result.index].id,id);
    assert.equal(readers.memoryBookOffset(book)+result.index,absolute);assert.ok(book.pages.length<=48);
    if(!readers.memoryBookHasMore(book))break;
  }
  assert.ok(readers.memoryBookOffset(book)>1000);
  for(let step=0;step<1000&&readers.memoryBookHasPrevious(book);step++){
    const at=Math.min(5,book.pages.length-1),id=book.pages[at].id,absolute=readers.memoryBookOffset(book)+at;
    const result=await readers.readMemoryBookWindow(c,book,at,-1,identity);
    book=result.book;assert.equal(book.pages[result.index].id,id);
    assert.equal(readers.memoryBookOffset(book)+result.index,absolute);assert.ok(book.pages.length<=48);
  }
  assert.equal(readers.memoryBookOffset(book),0);
});

test('the last retained window is not mistaken for a complete export',async()=>{
  const c=windowClient(83),identity=scope();let book=await readers.readMemoryBookFirst(c,'book',identity);
  while(readers.memoryBookHasMore(book))book=(await readers.readMemoryBookWindow(c,book,book.pages.length-1,1,identity)).book;
  assert.equal(readers.memoryBookHasMore(book),false);assert.equal(readers.memoryBookHasPrevious(book),true);
  assert.equal(readers.memoryBookIsComplete(book),false);
  const complete=await readers.readMemoryBookComplete(c,'book',identity);
  assert.equal(complete.pages.length,83);assert.equal(readers.memoryBookIsComplete(complete),true);
});

test('window hydration cannot commit after account replacement or accept a mismatched anchor',async()=>{
  const c=windowClient(),identity=scope(),book=await readers.readMemoryBookFirst(c,'book',identity);
  let active=true;const fenced={...identity,current:()=>active};
  await assert.rejects(readers.readMemoryBookWindow(c,book,12,1,fenced,async value=>{active=false;return value;}),/account or reader changed/);
  const wrong=client(()=>({data:{version:3,id:'book',can_view:true,revision:'7',anchor_index:0,pages:[{id:'another-page'}],has_previous:false,has_more:false,next_cursor:null},error:null}));
  await assert.rejects(readers.readMemoryBookWindow(wrong,book,12,1,identity),/memory window changed/);
});
