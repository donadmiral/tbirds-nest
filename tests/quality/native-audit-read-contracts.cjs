const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const { createFixture } = require('../native/audit/backend-fixture.cjs');
const ORIGIN = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const OWNER = '10000000-0000-4000-8000-000000000001';
const PEER = '10000000-0000-4000-8000-000000000002';
const CONVERSATION = '30000000-0000-4000-8000-000000000001';
const LISTING = '70000000-0000-4000-8000-000000000001';
const modules = new Map();

function loadTs(file) {
  const absolute = path.resolve(file);
  if (modules.has(absolute)) return modules.get(absolute);
  const mod = { exports: {} };
  modules.set(absolute, mod.exports);
  const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    fileName: absolute, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('require', 'module', 'exports', source)(name => name.startsWith('.')
    ? loadTs(path.resolve(path.dirname(absolute), name + '.ts')) : require(name), mod, mod.exports);
  return mod.exports;
}

// Execute the actual query expression from the screen/shared client through the
// installed Supabase SDK. The test does not retype its body, select or filters.
function queryExpression(file, kind, name, occurrence = 0) {
  const source = fs.readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === kind && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === name) {
      let expression = node;
      if (kind === 'from') {
        while (ts.isPropertyAccessExpression(expression.parent) && expression.parent.expression === expression
          && !['then', 'catch', 'finally'].includes(expression.parent.name.text)
          && ts.isCallExpression(expression.parent.parent) && expression.parent.parent.expression === expression.parent) expression = expression.parent.parent;
        if (!expression.getText(tree).includes('.select(')) return;
      }
      matches.push(expression.getText(tree));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert(matches[occurrence], `Actual ${kind} ${name} query not found in ${file}`);
  return matches[occurrence];
}
function actual(spec, sdk) {
  if (spec.name === 'seller_review_page') return loadTs('shared/marketReviews.ts').getSellerReviewPage(sdk, PEER, LISTING)
    .then(data => ({ data, error: null }));
  const variables = { supabase: sdk, client: sdk, myId: OWNER, userId: OWNER, currentUserId: OWNER,
    targetId: PEER, sellerId: PEER, conversationId: CONVERSATION,
    snapshot: '2026-10-31T12:00:00.000Z', asOf: '2026-10-31T12:00:00.000Z', offset: 0,
    PAGE_SIZE: 20, q: 'qa_jordan', postMode: 'top', tag: '#memories', ctx: spec.context,
    postId: '20000000-0000-4000-8000-000000000001',
    payload: loadTs('shared/clientDiagnostics.ts').sanitizeDiagnostic(new TypeError('Private details must be discarded'),
      { source: 'render', platform: 'android', fatal: true, appVersion: '1.0.0' }),
  };
  return new Function(...Object.keys(variables), `return (${queryExpression(spec.file, spec.kind || 'rpc', spec.name)});`)(...Object.values(variables));
}
const specs = [
  ['get_my_businesses', 'business-businesses', 'src/screens/profile/BusinessesScreen.tsx'],
  ['get_communities_page', 'profile-mynetwork', 'shared/networkDirectory.ts'],
  ['clubs', 'profile-mynetwork', 'shared/networkDirectory.ts', 'from'],
  ['club_members', 'profile-mynetwork', 'shared/networkDirectory.ts', 'from'],
  ['user_restrictions', 'profile-userprofile', 'src/screens/profile/UserProfileScreen.tsx', 'from'],
  ['creator_monetization_snapshot', 'settings-monetization', 'shared/monetization/client.ts'],
  ['get_restricted_accounts', 'settings-restrictedaccounts', 'src/screens/profile/RestrictedAccountsScreen.tsx'],
  ['report_client_error', 'stories-storyviewer', 'src/services/analytics.ts'],
  ['get_notifications_page', 'feed-notifications', 'src/screens/notifications/NotificationsScreen.tsx'],
  ['can_view_post', 'feed-post', 'src/screens/feed/PostScreen.tsx'],
  ['search_people', 'feed-search-controls', 'src/screens/feed/SearchScreen.tsx'],
  ['search_posts', 'feed-search-controls', 'src/screens/feed/SearchScreen.tsx'],
  ['search_jobs_fts', 'feed-search-controls', 'src/screens/feed/SearchScreen.tsx'],
  ['search_listings_fts', 'feed-search-controls', 'src/screens/feed/SearchScreen.tsx'],
  ['log_search_event', 'feed-search-controls', 'src/screens/feed/SearchScreen.tsx'],
  ['get_posts_by_hashtag', 'feed-trendfeed', 'src/screens/feed/TrendFeedScreen.tsx'],
  ['get_conversations_by_context', 'jobs-jobsinbox', 'src/screens/messages/ContextInboxScreen.tsx', 'rpc', 'jobs'],
  ['get_seller_rating', 'market-listingdetail', 'src/components/market/SellerTrust.tsx'],
  ['seller_review_page', 'market-listingdetail', 'shared/marketReviews.ts'],
  ['starred_messages', 'messages-chat', 'src/screens/messages/ChatScreen.tsx', 'from'],
  ['saved_messages', 'messages-chat', 'src/screens/messages/ChatScreen.tsx', 'from'],
  ['get_message_requests', 'messages-messagerequests', 'src/screens/messages/MessageRequestsScreen.tsx'],
].map(([name, id, file, kind = 'rpc', context]) => ({ name, id, file, kind, context }));

async function signed(id) {
  const fixture = createFixture();
  const requests = [];
  const sdk = createClient(ORIGIN, 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      requests.push({ input, init });
      return fixture.fetch(input, init);
    } },
  });
  const auth = await sdk.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal(auth.error, null);
  fixture.selectAuditCase(id, 'baseline');
  return { fixture, sdk, requests, token: auth.data.session.access_token };
}

for (const spec of specs) test(`actual ${spec.name} query uses its exact signed audit contract`, async () => {
  const { sdk, fixture } = await signed(spec.id);
  const result = await actual(spec, sdk);
  assert.equal(result.error, null, JSON.stringify(result.error));
  if (spec.name === 'search_people') assert.equal(result.data[0].full_name, 'Jordan Ellis');
  else if (spec.name === 'can_view_post' || spec.name === 'report_client_error') assert.equal(result.data, true);
  else if (spec.name === 'log_search_event' || spec.name === 'user_restrictions') assert.equal(result.data, null);
  else if (spec.name === 'get_seller_rating') assert.deepEqual(result.data, [{ avg_rating: null, review_count: 0, five: 0, four: 0, three: 0, two: 0, one: 0 }]);
  else if (spec.name === 'creator_monetization_snapshot') {
    const parsed = loadTs('shared/monetization/domain.ts').parseCreatorSnapshot(result.data, OWNER);
    assert.equal(parsed.provider.payouts_enabled, false); assert.equal(parsed.program.enrollment_open, false);
    assert.equal(parsed.environment, 'test'); assert.deepEqual(parsed.balances, []);
  } else if (spec.name === 'seller_review_page') {
    assert.deepEqual(result.data.rows, []); assert.equal(result.data.has_more, false);
    assert.deepEqual(result.data.eligible_orders, []); assert.equal(result.data.summary.avg_rating, 0);
  } else assert.deepEqual(result.data, []);
  assert.deepEqual(fixture.receipt.unhandled, []);
  assert.equal(fixture.receipt.networkForwarded, false);
});

for (const spec of specs) test(`${spec.name} rejects extra RPC arguments or query fields instead of pretending success`, async () => {
  const { sdk, fixture, requests } = await signed(spec.id);
  try { await actual(spec, sdk); } catch { /* Baseline missing review RPC also throws through the real wrapper. */ }
  const request = requests.findLast(item => String(item.input).includes('/rest/v1/'));
  assert(request, spec.name);
  const url = new URL(String(request.input));
  const init = { ...request.init };
  if (spec.kind === 'from') url.searchParams.set('audit_unexpected', 'true');
  else init.body = JSON.stringify({ ...JSON.parse(init.body || '{}'), p_unexpected: true });
  const result = await fixture.fetch(url.toString(), init);
  assert.equal(result.status, 501);
  assert.match((await result.json()).code, /^NATIVE_(?:UI|AUDIT)_UNHANDLED$/);
  assert(fixture.receipt.unhandled.some(item => item.path === url.pathname));
});

test('actual network directory publishes all six independent sections without invented communities or clubs', async () => {
  const { sdk, fixture } = await signed('profile-mynetwork');
  const result = await loadTs('shared/networkDirectory.ts').readNetworkDirectory(sdk, OWNER);
  assert.deepEqual(result.errors, {});
  for (const key of ['follows', 'requests', 'communities', 'clubs', 'clubMembers']) assert.deepEqual(result[key], []);
  assert.equal(result.people.length, 2); assert.deepEqual(fixture.receipt.unhandled, []);
});

for (const [name, id, file] of [
  ['saved_messages', 'messages-savedmessages', 'src/screens/messages/SavedMessagesScreen.tsx'],
  ['starred_messages', 'messages-starredmessages', 'src/screens/messages/StarredMessagesScreen.tsx'],
]) test(`actual ${id} joined list and chat read contracts remain distinct`, async () => {
  const { sdk, fixture } = await signed(id);
  const result = await actual({ name, id, file, kind: 'from' }, sdk);
  assert.equal(result.error, null); assert.deepEqual(result.data, []);
  assert.deepEqual(fixture.receipt.unhandled, []);
  const wrongOwner = await sdk.from(name).select('message_id').eq(name === 'saved_messages' ? 'user_id' : 'starred_by', PEER);
  assert.equal(wrongOwner.status, 501);
});

test('market context, empty notifications and second review case retain exact case ownership', async () => {
  for (const [id, name, file, context] of [
    ['market-marketinbox', 'get_conversations_by_context', 'src/screens/messages/ContextInboxScreen.tsx', 'market'],
    ['notifications-empty-controls', 'get_notifications_page', 'src/screens/notifications/NotificationsScreen.tsx'],
    ['market-offer-cancel', 'seller_review_page', 'shared/marketReviews.ts'],
  ]) {
    const { sdk, fixture } = await signed(id);
    const result = await actual({ id, name, file, context }, sdk);
    assert.equal(result.error, null); assert.deepEqual(fixture.receipt.unhandled, []);
  }
});

test('unselected, wrong case, unauthenticated and A to B to A stale bearer calls cannot read audit data', async () => {
  const bare = createFixture();
  const anonymous = await bare.fetch(ORIGIN + '/rest/v1/rpc/get_my_businesses', { method: 'POST', body: '{}' });
  assert.equal(anonymous.status, 401);
  const unselected = createClient(ORIGIN, 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: bare.fetch },
  });
  assert.equal((await unselected.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' })).error, null);
  assert.equal((await unselected.rpc('get_my_businesses')).status, 501);
  const { fixture, sdk, token } = await signed('business-businesses');
  assert.equal((await sdk.rpc('get_message_requests')).status, 501);
  const peer = await sdk.auth.signInWithPassword({ email: 'qa.jordan@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal(peer.error, null);
  assert.equal((await sdk.rpc('get_my_businesses')).status, 403);
  const owner = await sdk.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal(owner.error, null);
  const old = await fixture.fetch(ORIGIN + '/rest/v1/rpc/get_my_businesses', { method: 'POST', body: '{}', headers: { authorization: 'Bearer ' + token } });
  assert.equal(old.status, 401);
  assert.equal((await sdk.rpc('get_my_businesses')).error, null);
  await sdk.auth.signOut();
  assert.equal((await fixture.fetch(ORIGIN + '/rest/v1/rpc/get_my_businesses', { method: 'POST', body: '{}', headers: { authorization: 'Bearer ' + owner.data.session.access_token } })).status, 401);
});

test('malformed JSON, duplicate filters, unexpected writes, unrelated paths and aborted work fail closed', async () => {
  const { sdk, fixture, token } = await signed('profile-mynetwork');
  const headers = { authorization: 'Bearer ' + token };
  assert.equal((await fixture.fetch(ORIGIN + '/rest/v1/rpc/get_communities_page', { method: 'POST', headers, body: '{' })).status, 501);
  assert.equal((await fixture.fetch(ORIGIN + '/rest/v1/clubs?select=id%2Cname%2Cemoji%2Cdescription%2Cmember_count&order=name.asc&order=name.desc', { headers })).status, 501);
  assert.equal((await sdk.from('clubs').insert({ id: 'unapproved', name: 'unapproved' })).status, 501);
  assert.equal((await sdk.rpc('audit_unknown_function')).status, 501);
  assert.equal((await sdk.rpc('toString')).status, 501);
  assert.equal((await sdk.from('constructor').select('*')).status, 501);
  const controller = new AbortController(); controller.abort();
  const aborted = await sdk.rpc('get_communities_page', { p_query: null, p_limit: 100, p_offset: 0, p_as_of: '2026-10-31T12:00:00Z' }).abortSignal(controller.signal);
  assert(aborted.error); assert.equal(aborted.status, 0);
  assert.equal(fixture.receipt.networkForwarded, false);
});

test('diagnostic transport retains redacted error category instead of hiding the original runtime issue', async () => {
  const { sdk, fixture } = await signed('market-listingdetail');
  const payload = loadTs('shared/clientDiagnostics.ts').sanitizeDiagnostic(new TypeError('secret user content'),
    { source: 'render', platform: 'android', fatal: true, appVersion: '1.0.0' });
  const first = await sdk.rpc('report_client_error', { p_report: payload });
  const duplicate = await sdk.rpc('report_client_error', { p_report: payload });
  assert.equal(first.error, null); assert.equal(first.data, true); assert.equal(duplicate.data, false);
  assert.deepEqual(fixture.receipt.audit.diagnostics, [payload]);
  assert.equal((await sdk.rpc('report_client_error', { p_report: { ...payload, message: 'private' } })).status, 501);
  assert(!JSON.stringify(fixture.receipt).includes('secret user content'));
  assert(!JSON.stringify(fixture.receipt).includes('Bearer '));
});

test('case-specific input domains reject different owners, context, page sizes and non-script search', async () => {
  for (const [id, name, body] of [
    ['feed-post', 'can_view_post', { p_post_id: 'bad-id' }],
    ['jobs-jobsinbox', 'get_conversations_by_context', { p_context: 'personal', p_include_groups: false }],
    ['feed-notifications', 'get_notifications_page', { p_limit: 10000, p_offset: 0, p_as_of: '2026-10-31T12:00:00Z' }],
    ['feed-search-controls', 'search_people', { p_q: 'unseeded query', p_limit: 25 }],
    ['market-listingdetail', 'get_seller_rating', { p_seller_id: OWNER }],
  ]) {
    const { sdk } = await signed(id);
    assert.equal((await sdk.rpc(name, body)).status, 501, name);
  }
});
