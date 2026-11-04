const test = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness } = require('./helpers/account-component-harness.cjs');

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const ok = data => ({ data, error: null });

// Execute each real page, its effects and its refresh callback. The small visual
// children are inert so the checks observe the page's actual content branches.
function page(file, configure) {
  const h = accountHarness();
  h.provide('next/link', { default: 'a' });
  h.provide('lucide-react', new Proxy({}, { get: (_, name) => name }));
  h.provide('@/components/ui', { Card: 'Card', EmptyState: 'EmptyState', Panel: 'Panel', PillTabs: 'PillTabs' });
  for (const name of ['VerifiedBadge', 'StoryAvatar', 'RelativeTime', 'ErrorState', 'ResourceRefreshNotice', 'ListingCard', 'MarketAlerts', 'MarketUnreadDot', 'ProductDialog']) {
    h.provide('@/components/' + name, { [name]: name });
  }
  let callbacks = [];
  const useCallback = h.hooks.useCallback;
  h.hooks.useCallback = (fn, deps) => { const callback = useCallback(fn, deps); callbacks.push(callback); return callback; };
  configure(h);
  const Component = h.load(file).default;
  h.mount(() => { callbacks = []; return Component(); });
  h.refresh = (...args) => callbacks[0](...args);
  h.notice = () => h.nodes.find(node => node.type === 'ResourceRefreshNotice')?.props;
  return h;
}

function tables(h, respond) {
  h.client.from = table => {
    const request = { table, filters: [], operation: 'read', head: false };
    const query = {
      select(_columns, options) { request.head = options?.head === true; return query; },
      eq(column, value) { request.filters.push([column, value]); return query; },
      in(column, value) { request.filters.push([column, value]); return query; },
      order() { return query; }, limit() { return query; }, or() { return query; }, maybeSingle() { return query; },
      insert() { request.operation = 'insert'; return query; }, delete() { request.operation = 'delete'; return query; }, update() { request.operation = 'update'; return query; },
      then(resolve, reject) { return Promise.resolve().then(() => respond(request)).then(resolve, reject); },
    };
    return query;
  };
}

function market() {
  let read = async () => [{ id: 'listing-a', title: 'Visible listing', images: ['https://fixture.invalid/a.jpg'] }];
  const h = page('app/market/page.tsx', h => {
    h.provide('./MarketWorkspace.module.css', { default: new Proxy({}, { get: (_, name) => name }) });
    h.provide('@/lib/market', {
      MARKET_CATEGORIES: ['Electronics'], MARKET_CONDITIONS: ['New'],
      getMarketFeed: options => read(options), getListings: options => read(options), myListings: owner => read({ owner }), getSavedListingIds: async () => new Set(),
    });
  });
  h.setRead = next => { read = next; };
  h.cards = () => h.nodes.filter(node => node.type === 'ListingCard');
  return h;
}

test('market same-query refresh retains listing and image identity through pending/error, then accepts a real empty result', async () => {
  const h = market(), held = deferred(); await h.flush();
  const listing = h.cards()[0].props.l; assert.equal(listing.id, 'listing-a');
  h.setRead(() => held.promise); const work = h.refresh(); h.render(); await h.flush();
  assert.equal(h.cards()[0].props.l, listing); assert.doesNotMatch(h.text, /Loading listings/);
  held.reject(Error('Offline')); await work; await h.flush();
  assert.equal(h.cards()[0].props.l, listing); assert.match(h.notice().error, /Could not load/);
  h.setRead(async () => []); await h.refresh(); await h.flush();
  assert.equal(h.cards().length, 0); assert.equal(h.notice().error, ''); h.dispose();
});

test('market query changes hide old results immediately and reject an older delayed refresh', async () => {
  const h = market(), held = deferred(); await h.flush();
  h.setRead(() => held.promise); const old = h.refresh(); await h.flush();
  h.setRead(async () => [{ id: 'electronics', title: 'New category' }]);
  h.button('Electronics').props.onClick(); h.render(); assert.equal(h.cards().length, 0);
  await h.flush(); assert.equal(h.cards()[0].props.l.id, 'electronics');
  held.resolve([{ id: 'obsolete', title: 'Old category' }]); await old; await h.flush();
  assert.equal(h.cards()[0].props.l.id, 'electronics'); h.dispose();
});

test('market denied refresh clears visible listings and account changes fence pending reads', async () => {
  const h = market(); await h.flush();
  h.setRead(async () => { throw { status: 403 }; }); await h.refresh(); await h.flush();
  assert.equal(h.cards().length, 0); assert.match(h.text, /couldn’t load listings/);
  h.setRead(async () => [{ id: 'restored' }]); await h.refresh(); await h.flush();
  const held = deferred(); h.setRead(() => held.promise); const old = h.refresh(); await h.flush();
  h.setRead(async () => [{ id: 'account-b-listing' }]); h.auth('account-b'); assert.equal(h.cards().length, 0); await h.flush();
  held.resolve([{ id: 'account-a-late' }]); await old; await h.flush();
  assert.equal(h.cards()[0].props.l.id, 'account-b-listing'); h.dispose();
});

test('market confirmed bookmark change wins over an older pending snapshot', async () => {
  const h = market(), held = deferred(); await h.flush(); h.setRead(() => held.promise);
  const pending = h.refresh(); await h.flush(); h.cards()[0].props.onSavedChange(true); h.render();
  assert.equal(h.cards()[0].props.saved, true);
  held.resolve([{ id: 'listing-a' }]); await pending; await h.flush(); assert.equal(h.cards()[0].props.saved, true); h.dispose();
});

function saved() {
  let bookmarks = async () => ok([{ post_id: 'post-a', created_at: '2026-11-04', collection_id: null }]);
  const h = page('app/saved/page.tsx', h => {
    tables(h, request => {
      if (request.table === 'post_bookmarks') return request.operation !== 'read' ? ok({ post_id: 'post-a' }) : request.head ? { data: null, count: 1, error: null } : bookmarks(request);
      if (request.table === 'bookmark_collections') return ok([{ id: 'collection-b', name: 'Other collection' }]);
      if (request.table === 'posts') return ok([{ id: 'post-a', user_id: 'author', content: 'Visible saved post', created_at: '2026-11-04', media_url: 'https://fixture.invalid/saved.jpg' }]);
      if (request.table === 'profiles') return ok([{ id: 'author', full_name: 'Author' }]);
      throw Error(request.table);
    });
  });
  h.setRead = next => { bookmarks = next; };
  h.expire();
  return h;
}

test('saved posts refresh preserves the picture and rows on pending/network failure and reconciles confirmed empty', async () => {
  const h = saved(), held = deferred(); await h.flush(); assert.match(h.text, /Visible saved post/);
  h.setRead(() => held.promise); const pending = h.refresh(); h.render(); await h.flush();
  assert.match(h.text, /Visible saved post/); assert.equal(h.nodes.find(node => node.type === 'img').props.src, 'https://fixture.invalid/saved.jpg');
  held.reject(Error('Network unavailable')); await pending; await h.flush();
  assert.match(h.text, /Visible saved post/); assert.match(h.notice().error, /refresh your saved items/);
  h.setRead(async () => ok([])); await h.refresh(); await h.flush();
  assert.doesNotMatch(h.text, /Visible saved post/); assert.equal(h.nodes.find(node => node.type === 'EmptyState').props.title, 'Nothing saved yet'); h.dispose();
});

test('saved collection/account changes discard obsolete rows while same-account authentication preserves them', async () => {
  const h = saved(), held = deferred(); await h.flush();
  h.auth('account-a'); assert.match(h.text, /Visible saved post/);
  h.setRead(() => held.promise); const pending = h.refresh(); await h.flush();
  h.button('Other collection').props.onClick(); h.render(); assert.doesNotMatch(h.text, /Visible saved post/);
  h.setRead(async () => ok([])); h.expire(); await h.flush();
  held.resolve(ok([{ post_id: 'post-a' }])); await pending; await h.flush(); assert.doesNotMatch(h.text, /Visible saved post/);
  h.auth('account-b'); assert.doesNotMatch(h.text, /Visible saved post/); h.expire(); await h.flush(); h.dispose();
});

test('saved posts discard private rows after an explicit refresh denial', async () => {
  const h = saved(); await h.flush(); h.setRead(async () => ({ data: null, error: { code: '42501' } }));
  await h.refresh(); await h.flush(); assert.doesNotMatch(h.text, /Visible saved post/);
  assert.equal(h.nodes.find(node => node.type === 'ErrorState').props.title, 'Could not load your saved items'); h.dispose();
});

test('a confirmed unsave during refresh cannot be restored by the older bookmark read', async () => {
  const h = saved(), held = deferred(); await h.flush(); h.setRead(() => held.promise);
  const pending = h.refresh(); await h.flush(); h.button('Unsave').props.onClick(); await h.flush();
  assert.doesNotMatch(h.text, /Visible saved post/);
  held.resolve(ok([{ post_id: 'post-a' }])); await pending; await h.flush(); assert.doesNotMatch(h.text, /Visible saved post/); h.dispose();
});

function support() {
  const ticket = { id: 'ticket-a', user_id: 'account-a', subject: 'Visible ticket', body: 'Question body', status: 'open', created_at: '2026-11-04' };
  let readTicket = async () => ok(ticket), history = async () => ok([{ id: 'reply-a', sender: 'staff', body: 'Visible reply', created_at: '2026-11-04' }]);
  let id = 'ticket-a';
  const h = page('app/settings/support/[id]/page.tsx', h => {
    h.provide('next/navigation', { useParams: () => ({ id }) });
    h.provide('@/lib/memberSupport', { replyToMemberSupport() { throw Error('Unexpected write'); } });
    h.provide('../../../../../shared/memberSupport', h.load('../shared/memberSupport.ts'));
    h.provide('../../../../../shared/readDeadline', h.load('../shared/readDeadline.ts'));
    tables(h, request => request.table === 'support_tickets' ? readTicket() : history());
  });
  h.setTicketRead = next => { readTicket = next; }; h.setHistoryRead = next => { history = next; };
  h.setRoute = next => { id = next; h.render(); };
  return h;
}

test('support refresh keeps the ticket and replies on transient failure and clears confirmed missing or denied tickets', async () => {
  const h = support(), held = deferred(); await h.flush(); assert.match(h.text, /Visible ticket.*Visible reply/);
  h.setTicketRead(() => held.promise); const pending = h.refresh('account-a'); h.render(); await h.flush();
  assert.match(h.text, /Visible ticket.*Visible reply/); held.reject(Error('Offline')); await pending; await h.flush();
  assert.match(h.text, /Visible ticket.*Visible reply/); assert.ok(h.notice().error);
  h.setTicketRead(async () => ({ data: null, error: { status: 403 } })); await h.refresh('account-a'); await h.flush();
  assert.doesNotMatch(h.text, /Visible ticket|Visible reply/); h.dispose();
  const missing = support(); await missing.flush(); missing.setTicketRead(async () => ok(null)); await missing.refresh('account-a'); await missing.flush();
  assert.doesNotMatch(missing.text, /Visible ticket|Visible reply/); assert.match(missing.text, /not available/); missing.dispose();
});

test('support history retains replies only for retryable errors and clears denied, malformed or successful empty history', async () => {
  for (const replacement of [{ data: [], error: { status: 403 } }, { data: { malformed: true }, error: null }, ok([])]) {
    const h = support(); await h.flush();
    h.setHistoryRead(async () => { throw Error('Offline'); }); await h.refresh('account-a'); await h.flush();
    assert.match(h.text, /Visible reply/); assert.match(h.text, /Replies could not be loaded/);
    h.setHistoryRead(async () => replacement); await h.refresh('account-a'); await h.flush();
    assert.match(h.text, /Visible ticket/); assert.doesNotMatch(h.text, /Visible reply/); h.dispose();
  }
});

test('support route identity hides the old ticket before the next read and fences its old response', async () => {
  const h = support(), held = deferred(); await h.flush(); h.setTicketRead(() => held.promise); const pending = h.refresh('account-a'); await h.flush();
  h.setTicketRead(async () => ok(null)); h.setRoute('ticket-b'); assert.doesNotMatch(h.text, /Visible ticket|Visible reply/); await h.flush();
  held.resolve(ok({ id: 'ticket-a', user_id: 'account-a', subject: 'Late old ticket', status: 'open' })); await pending; await h.flush();
  assert.doesNotMatch(h.text, /Late old ticket|Visible reply/); h.dispose();
});

function organization() {
  let read = async () => ok({ id: 'organization-a', name: 'Visible organization', kind: 'business' });
  const h = page('app/studio/settings/organization/page.tsx', h => {
    h.provide('@/components/StudioShell', { useStudio: () => ({ accountId: 'account-a' }) });
    h.provide('@/lib/useCurrentTime', { useCurrentTime: () => Date.now() });
    h.provide('@/lib/media', { displayImageUrl: value => value });
    h.provide('@/lib/org', { ORG_ROLES: ['owner', 'editor'], SURFACES: ['content'] });
    tables(h, request => request.table === 'organizations' ? read() : request.table === 'org_memberships'
      ? ok([{ id: 'member-a', user_id: 'account-a', role: 'owner', profile: { full_name: 'Visible owner' } }]) : ok([]));
    h.client.rpc = async () => ok([]);
  });
  h.setRead = next => { read = next; };
  return h;
}

test('organization refresh keeps its desk and members on transient failure and clears missing or denied organization', async () => {
  for (const replacement of [ok(null), { data: null, error: { code: '42501' } }]) {
    const h = organization(), held = deferred(); await h.flush(); assert.match(h.text, /Visible organization.*Visible owner/);
    h.setRead(() => held.promise); const pending = h.refresh(); h.render(); await h.flush(); assert.match(h.text, /Visible organization.*Visible owner/);
    held.reject(Error('Offline')); await pending; await h.flush(); assert.match(h.text, /Visible organization.*Visible owner/); assert.equal(h.notice().error, 'Offline');
    h.setRead(async () => replacement); await h.refresh(); await h.flush(); assert.doesNotMatch(h.text, /Visible organization|Visible owner/);
    assert.equal(h.nodes.find(node => node.type === 'ErrorState').props.title, 'Could not load your organization'); h.dispose();
  }
});
