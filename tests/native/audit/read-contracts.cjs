/** Isolated audit transport only. These exact case-scoped reads use synthetic
 * empty account state, never a hosted service. This is not a Postgres/RLS or
 * full-text-search emulator; unsupported inputs remain visible as HTTP 501. */
const OWNER = '10000000-0000-4000-8000-000000000001';
const PEER = '10000000-0000-4000-8000-000000000002';
const CONVERSATION = '30000000-0000-4000-8000-000000000001';
const LISTING = '70000000-0000-4000-8000-000000000001';
const STORY = '40000000-0000-4000-8000-000000000001';
const POST = '20000000-0000-4000-8000-000000000001';
const RPC_CASES = {
  get_my_businesses: ['business-businesses'],
  get_communities_page: ['profile-mynetwork'],
  creator_monetization_snapshot: ['settings-monetization'],
  get_restricted_accounts: ['settings-restrictedaccounts'],
  report_client_error: ['stories-storyviewer', 'market-listingdetail', 'market-offer-cancel'],
  get_notifications_page: ['feed-notifications', 'notifications-empty-controls'],
  can_view_post: ['feed-post'],
  search_people: ['feed-search-controls'], search_posts: ['feed-search-controls'],
  search_jobs_fts: ['feed-search-controls'], search_listings_fts: ['feed-search-controls'],
  log_search_event: ['feed-search-controls'], get_posts_by_hashtag: ['feed-trendfeed'],
  get_conversations_by_context: ['jobs-jobsinbox', 'market-marketinbox'],
  get_seller_rating: ['market-listingdetail', 'market-offer-cancel'],
  seller_review_page: ['market-listingdetail', 'market-offer-cancel'],
  get_message_requests: ['messages-messagerequests'],
  get_market_orders: ['market-listingdetail', 'market-offer-cancel'],
  get_story_poll: ['stories-storyviewer'],
  can_comment: ['feed-post'],
};
const TABLE_CASES = {
  clubs: ['profile-mynetwork'], club_members: ['profile-mynetwork'],
  user_restrictions: ['profile-userprofile'],
  starred_messages: ['messages-chat', 'messages-starredmessages'],
  saved_messages: ['messages-chat', 'messages-savedmessages'],
  post_comment_pins: ['feed-post'],
};
const CATEGORIES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError',
  'AbortError', 'TimeoutError', 'NetworkError', 'AuthError', 'PostgrestError', 'StorageError', 'UnknownError']);
const SOURCES = new Set(['render', 'global', 'promise', 'feed', 'unknown']);
const exact = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === fields.split(',').sort().join(',');
const compact = value => String(value ?? '').replace(/\s/g, '');
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const search = value => typeof value === 'string' && value.length > 0 && 'qa_jordan'.startsWith(value);
const reviewSummary = avg_rating => ({ avg_rating, review_count: 0, five: 0, four: 0, three: 0, two: 0, one: 0 });

function createReadContracts({ base, audit, session, json, reject, notify }) {
  const diagnosticTimes = [];
  const diagnosticKeys = new Map();
  audit.diagnostics = []; audit.diagnosticsDropped = 0;
  audit.searchEvents = []; audit.searchEventsDropped = 0;
  return (input, init, url, method) => {
    const rpc = url.pathname.startsWith('/rest/v1/rpc/') ? url.pathname.slice('/rest/v1/rpc/'.length) : null;
    const table = url.pathname.startsWith('/rest/v1/') && !rpc ? url.pathname.slice('/rest/v1/'.length) : null;
    const cases = rpc ? (Object.prototype.hasOwnProperty.call(RPC_CASES, rpc) ? RPC_CASES[rpc] : null)
      : (Object.prototype.hasOwnProperty.call(TABLE_CASES, table) ? TABLE_CASES[table] : null);
    if (!cases) return undefined;
    if (init.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    const current = session();
    const headers = new Headers(init.headers || input.headers || {});
    if (!current.owner || !current.token || headers.get('authorization') !== 'Bearer ' + current.token) return json({ code: '42501', message: 'Authentication required for this audit session.' }, 401);
    if (current.owner !== OWNER) return json({ code: '42501', message: 'This synthetic audit case belongs to another account.' }, 403);
    if (!cases.includes(audit.caseId) || audit.scenario !== 'baseline') return reject(method, url.pathname);
    const record = () => {
      base.receipt.requests.push({ method, path: url.pathname, owner: current.owner });
      audit.requests.push(rpc ? { method, rpc } : { method, table });
      notify();
    };
    if (table) {
      if (method !== 'GET' || init.body != null || new Set(url.searchParams.keys()).size !== [...url.searchParams].length) return reject(method, url.pathname);
      const query = Object.fromEntries(url.searchParams);
      let expected;
      if (table === 'clubs') expected = { select: 'id,name,emoji,description,member_count', order: 'name.asc' };
      if (table === 'club_members') expected = { select: 'club_id', user_id: 'eq.' + OWNER };
      if (table === 'user_restrictions') expected = { select: 'restricted_id', restrictor_id: 'eq.' + OWNER, restricted_id: 'eq.' + PEER };
      if (table === 'post_comment_pins') expected = { select: 'comment_id', post_id: 'eq.' + POST };
      if (table === 'saved_messages') expected = audit.caseId === 'messages-chat'
        ? { select: 'message_id', user_id: 'eq.' + OWNER }
        : { select: 'id,message_id,saved_at,message:messages!message_id(id,text,media_url,media_type,created_at,sender:profiles!sender_id(id,full_name,avatar_url),conversation:conversations!conversation_id(id,group_name,user_1,user_2))', user_id: 'eq.' + OWNER, order: 'saved_at.desc' };
      if (table === 'starred_messages') expected = audit.caseId === 'messages-chat'
        ? { select: 'message_id', conversation_id: 'eq.' + CONVERSATION, starred_by: 'eq.' + OWNER }
        : { select: 'id,message_id,starred_at,conversation_id,msg:messages!message_id(id,text,media_url,media_type,created_at,sender_id)', starred_by: 'eq.' + OWNER, order: 'starred_at.desc' };
      if (!exact(query, Object.keys(expected).join(','))
        || Object.keys(expected).some(key => (key === 'select' ? compact(query[key]) : query[key]) !== expected[key])) return reject(method, url.pathname);
      record();
      return headers.get('accept')?.includes('vnd.pgrst.object')
        ? json({ code: 'PGRST116', details: 'The result contains 0 rows' }, 406) : json([]);
    }
    if (method !== 'POST' || [...url.searchParams].length || typeof init.body !== 'string' || init.body.length > 4096) return reject(method, url.pathname);
    let body;
    try { body = JSON.parse(init.body); } catch { return reject(method, url.pathname); }
    let valid = false, data = [];
    if (['get_my_businesses', 'get_restricted_accounts', 'get_message_requests', 'creator_monetization_snapshot'].includes(rpc)) valid = exact(body, '');
    if (rpc === 'creator_monetization_snapshot') data = {
      user_id: OWNER, as_of: '2026-10-31T12:00:00.000Z', environment: 'test',
      program: { enrollment_open: false, terms_version: null, terms_url: null },
      provider: { id: 'intobank', name: 'IntoBank', payouts_enabled: false, currencies: ['USD'] },
      enrollment: { status: 'not_enrolled', reason: null }, payout_account: { status: 'not_configured', verified_at: null },
      balances: [], recent_earnings: [], recent_payouts: [],
    };
    if (rpc === 'get_communities_page') valid = exact(body, 'p_query,p_limit,p_offset,p_as_of')
      && body.p_query === null && body.p_limit === 100 && body.p_offset === 0 && timestamp(body.p_as_of);
    if (rpc === 'get_notifications_page') valid = exact(body, 'p_limit,p_offset,p_as_of')
      && body.p_limit === 60 && body.p_offset === 0 && timestamp(body.p_as_of);
    if (rpc === 'can_view_post') {
      valid = exact(body, 'p_post_id') && base.posts.some(post => post.id === body.p_post_id);
      data = valid; // Only the two explicitly public synthetic posts are modeled.
    }
    if (rpc.startsWith('search_')) {
      valid = exact(body, rpc === 'search_posts' ? 'p_q,p_mode,p_limit' : 'p_q,p_limit')
        && search(body.p_q) && body.p_limit === (rpc === 'search_people' ? 25 : 20)
        && (rpc !== 'search_posts' || ['top', 'latest'].includes(body.p_mode));
      if (valid && rpc === 'search_people') data = base.profiles.filter(profile => profile.username.startsWith(body.p_q))
        .map(({ id, full_name, username, avatar_url, is_verified, verified_tier }) => ({ id, full_name, username, avatar_url, is_verified, verified_tier, rank: username === body.p_q ? 1000 : 500 }));
      // The scripted qa_jordan query/prefixes do not match a seeded post, job or listing.
    }
    if (rpc === 'log_search_event') {
      valid = exact(body, 'p_query,p_vertical') && search(body.p_query) && body.p_vertical === 'all'; data = null;
    }
    if (rpc === 'get_posts_by_hashtag') valid = exact(body, 'p_tag,p_limit,p_offset')
      && body.p_tag === '#memories' && body.p_limit === 20 && body.p_offset === 0;
    if (rpc === 'get_conversations_by_context') valid = exact(body, 'p_context,p_include_groups') && body.p_include_groups === false
      && body.p_context === (audit.caseId === 'jobs-jobsinbox' ? 'jobs' : 'market');
    if (rpc === 'get_seller_rating') {
      valid = exact(body, 'p_seller_id') && body.p_seller_id === PEER;
      data = [reviewSummary(null)]; // SQL avg() is null with no completed-purchase reviews.
    }
    if (rpc === 'seller_review_page') {
      valid = exact(body, 'p_seller_id,p_listing_id,p_before_at,p_before_id,p_limit') && body.p_seller_id === PEER
        && body.p_listing_id === LISTING && body.p_before_at === null && body.p_before_id === null && body.p_limit === 20;
      data = { rows: [], has_more: false, next_cursor: null, summary: reviewSummary(0), eligible_orders: [] };
    }
    if (rpc === 'get_market_orders') {
      valid = exact(body, 'p_listing_id,p_before,p_before_id,p_limit') && body.p_listing_id === LISTING
        && body.p_before === null && body.p_before_id === null && body.p_limit === 20;
      data = { rows: [], has_more: false, next_cursor: null };
    }
    if (rpc === 'get_story_poll') {
      valid = exact(body, 'p_story_id') && body.p_story_id === STORY;
      data = null; // SQL returns null when the visible story has no poll.
    }
    if (rpc === 'can_comment') {
      valid = exact(body, 'p_post_id') && body.p_post_id === POST;
      data = true; // This seeded public post has no restrictive comment policy.
    }
    if (rpc === 'report_client_error') {
      const report = body?.p_report;
      valid = exact(body, 'p_report') && exact(report, 'version,category,source,platform,fatal,appVersion')
        && report.version === 1 && CATEGORIES.has(report.category) && SOURCES.has(report.source)
        && ['android', 'ios'].includes(report.platform) && typeof report.fatal === 'boolean'
        && (report.appVersion === null || (typeof report.appVersion === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-z0-9.]{1,16})?$/.test(report.appVersion)));
    }
    if (!valid) return reject(method, url.pathname);
    if (rpc === 'report_client_error') {
      const now = Date.now(), report = body.p_report, key = [report.category, report.platform, report.source].join(':');
      while (diagnosticTimes.length && now - diagnosticTimes[0] >= 600000) diagnosticTimes.shift();
      const prior = diagnosticKeys.get(key);
      data = diagnosticTimes.length < 10 && (prior === undefined || now - prior >= 60000) && audit.diagnostics.length < 16;
      if (data) { diagnosticTimes.push(now); diagnosticKeys.set(key, now); audit.diagnostics.push({ ...report }); }
      else audit.diagnosticsDropped++;
      // A successfully received diagnostic is evidence of an underlying error,
      // not acceptance of the screen that reported it. Preserve its safe fields.
    }
    if (rpc === 'log_search_event') {
      if (audit.searchEvents.length < 16) audit.searchEvents.push({ queryLength: body.p_query.length, vertical: body.p_vertical });
      else audit.searchEventsDropped++;
    }
    record();
    return json(data);
  };
}
module.exports = { createReadContracts };
