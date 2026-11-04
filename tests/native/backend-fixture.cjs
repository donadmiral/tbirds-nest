/** Disposable native UI transport. Imported only by tests/native/entry.js.
 * The real app, Supabase client, stores, navigation and screens still execute.
 * No request is forwarded to a hosted project or an external provider. */
const OWNER = '10000000-0000-4000-8000-000000000001';
const PEER = '10000000-0000-4000-8000-000000000002';
const SECOND = '10000000-0000-4000-8000-000000000003';
const { BOOK, NAVIGATION_BOOK, MEDIA, capability, memoryBook, navigationBook } = require('./memory-fixture.cjs');
const { createCaptureBoundaryRecorder, createReaderResponseObserver } = require('./capture-boundary-trace.cjs');
const CONVERSATION = '30000000-0000-4000-8000-000000000001';
const STORY = '40000000-0000-4000-8000-000000000001';
const created = '2026-01-02T10:00:00.000Z';
const makeProfile = (id, full_name, username, email) => ({
  id, full_name, username, email, avatar_url: null, banner_url: null,
  bio: 'Making memories, one day at a time.', headline: 'Independent creator',
  workplace: 'Creative studio', location: 'Phoenix', links: [],
  role: 'student', account_type: 'personal', account_class: 'creator',
  profile_visibility: 'public', is_verified: false, verified_tier: null,
  is_verified_school_user: false, deactivated_at: null, muted_words: [],
  notif_prefs: {}, sensitive_content: 'show', created_at: created,
  counts: { posts: 1, followers: 0, following: 0, reposts: 0, media: 0, saved: 0 },
});

function createFixture(onChange = () => {}, { feedVideoSource, immersiveLive = false } = {}) {
  const profiles = [makeProfile(OWNER, 'Alex Rivera', 'qa_alex', 'qa.alex@example.invalid'),
    makeProfile(PEER, 'Jordan Ellis', 'qa_jordan', 'qa.jordan@example.invalid'),
    makeProfile(SECOND, 'Morgan Lee', 'qa_morgan', 'qa.morgan@example.invalid')];
  const posts = [
    { post_id: '20000000-0000-4000-8000-000000000001', author_id: PEER, content: 'A quiet morning in the desert. Small moments worth keeping.' },
    { post_id: '20000000-0000-4000-8000-000000000002', author_id: OWNER, content: 'My first memory from this week.' },
  ].map((row, index) => ({ ...row, id: row.post_id, user_id: row.author_id, body: row.content,
    created_at: new Date(Date.now() - (index + 1) * 3600000).toISOString(),
    author_name: profiles.find(profile => profile.id === row.author_id).full_name,
    author_username: profiles.find(profile => profile.id === row.author_id).username,
    author_avatar: null, author_verified: false, author_verified_tier: null,
    author_kind: 'personal', media: [], post_media: [], media_url: null, products: [],
    link: null, channel: null, article_title: null, quoted_post_id: null, thread_parent_id: null,
    likes_count: 2, comments_count: 0, reposts_count: 0, bookmarks_count: 0, views_count: 10,
    viewer_liked: false, viewer_bookmarked: false, viewer_reposted: false, viewer_follows: false,
    sort_key: 10 - index, is_trending: false,
  }));
  const story = { id: STORY, user_id: PEER, media_type: 'text', media_url: null,
    thumbnail_url: null, caption: 'A moment worth remembering.', duration_sec: 8,
    text_background: { kind: 'solid', color: '#24354f' }, stickers_json: [],
    scope: 'global', institution_id: null, affiliation_id: null, views_count: 0,
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
    audience: 'everyone', is_viewed: false,
  };
  const rows = {
    profiles, posts, stories: [story],
    conversations: [{ id: CONVERSATION, user_1: OWNER, user_2: PEER, is_group: false,
      context: 'personal', last_message: 'Ready for our next adventure?', last_message_time: created }],
    messages: [{ id: '50000000-0000-4000-8000-000000000001', conversation_id: CONVERSATION,
      sender_id: PEER, receiver_id: OWNER, text: 'Ready for our next adventure?', content: 'Ready for our next adventure?',
      media_url: null, media_type: null, reply_to_id: null, created_at: created, delivered_at: created, read_at: null }],
    jobs: [{ id: '60000000-0000-4000-8000-000000000001', posted_by: PEER, title: 'Product designer',
      company: 'Desert Studio', location: 'Phoenix', description: 'Design useful tools with a small creative team.',
      category: 'full_time', job_type: 'full_time', remote_type: 'remote', experience_level: 'mid',
      salary_range: '$60,000 - $90,000', applications_count: 0, created_at: created, deadline: null, status: 'open',
      updated_at: created, urgent: false, verified: false, visa_sponsorship: false }],
    marketplace_listings: [{ id: '70000000-0000-4000-8000-000000000001', seller_id: PEER,
      title: 'Travel journal', description: 'A blank journal for your next adventure.', price: 12,
      currency: 'USD', category: 'Other', condition: 'New', city: 'Phoenix', status: 'available',
      images: [], media: [], created_at: created, updated_at: created, seller: profiles[1] }],
    feature_flags: [{ key: 'jobs_enabled', enabled: true }],
  };
  // Each explicitly empty table represents an empty synthetic account state.
  for (const table of ['user_presence', 'notifications', 'follows', 'follow_requests', 'post_seen',
    'post_likes', 'post_comments', 'post_reposts', 'post_bookmarks', 'post_polls', 'post_collaborators',
    'post_shares', 'post_media', 'post_media_tags', 'hidden_posts', 'blocked_users', 'restricted_users', 'close_friends',
    'muted_stories', 'muted_users', 'conversation_members', 'conversation_settings', 'conversation_typing',
    'message_mentions', 'message_reactions', 'message_stars', 'message_saves', 'message_requests',
    'call_sessions', 'call_participants', 'user_push_tokens', 'job_saves', 'job_applications', 'job_recommendations',
    'job_referrals', 'saved_listings', 'business_members', 'business_profiles', 'business_applications',
    'story_views', 'story_reactions', 'story_highlights', 'story_mutes', 'hidden_words', 'support_tickets',
    'user_devices', 'login_history', 'login_events', 'verification_applications', 'member_strikes', 'memory_album_access', 'announcements']) rows[table] = [];
  const savedBook = navigationBook();
  const liveIds = ['90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002'];
  const liveSessions = liveIds.map((id, index) => ({ id,
    title: index ? 'Guest approval rehearsal' : 'Community creator hour',
    description: 'Isolated native layout and controls. No provider broadcast.', topic: 'irl', state: 'live',
    audience: 'public', language: 'en', chat_mode: 'open', slow_mode_seconds: 0, recording_enabled: false,
    started_at: created, ended_at: null, scheduled_at: null, has_cover: false, thumbnail_url: null,
    viewer_count: 12, replay_available: false, host: profiles[index ? 2 : 1] }));
  const liveTopic = id => 'live:' + id + ':91000000-0000-4000-8000-000000000001';
  const liveRequests = new Map();
  const liveMembers = [];
  const liveMessages = liveIds.map((id, index) => ({ id: '92000000-0000-4000-8000-00000000000' + (index + 1),
    session_id: id, user_id: PEER, author: profiles[1], body: 'Welcome to the live conversation.', created_at: created, removed: false }));
  if (immersiveLive) liveRequests.set(liveIds[1] + ':' + PEER, { user_id: PEER, profile: profiles[1], status: 'pending', created_at: created });
  let owner = null;
  let sessionCounter = 0;
  let sessionId = '';
  let offline = false;
  let delayMs = 0;
  let memoryMode = 'normal';
  let feedVideoReady;
  const issuedMedia = new Set();
  const receipt = { mode: 'synthetic-native-ui', networkForwarded: false,
    featureConfiguration: { pagedReaders: { books: false, inbox: false }, feedBroadcast: { enabled: false } },
    requests: [], unhandled: [], mutations: [], media: [], bookReads: [], accountReadbacks: [], feedRefreshes: [],
    immersiveLive: { enabled: immersiveLive, providerAcceptance: false, providerStageConnected: false, commands: [], frames: [], progress: [] } };
  const recordCaptureBoundary = createCaptureBoundaryRecorder(receipt, onChange);
  const observeReaderResponse = createReaderResponseObserver(receipt, onChange);
  const record = (kind, value) => { receipt[kind].push(value); onChange(receipt); };
  const response = (value, status = 200, headers = {}) => new Response(value === null && status === 204 ? null : JSON.stringify(value),
    { status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01', ...headers } });
  const user = () => ({ ...profiles.find(profile => profile.id === owner), aud: 'authenticated', role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
    email_confirmed_at: created, confirmed_at: created });
  function session() {
    const now = Math.floor(Date.now() / 1000);
    const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: owner, aud: 'authenticated', role: 'authenticated',
      session_id: sessionId, aal: 'aal1', iat: now, exp: now + 3600 }) + '.synthetic-not-a-signature';
    return { access_token: token, refresh_token: 'synthetic-refresh-' + owner, token_type: 'bearer', expires_in: 3600,
      expires_at: now + 3600, user: user() };
  }
  const unknown = (method, path) => {
    record('unhandled', { method, path });
    return response({ code: 'NATIVE_UI_UNHANDLED', message: 'No synthetic contract for ' + method + ' ' + path }, 501);
  };
  function rpc(name, args, headers) {
    const plainArgs = args !== null && typeof args === 'object' && !Array.isArray(args);
    if (name === 'get_paged_reader_capabilities' || name === 'get_feed_live_capability') {
      if (!plainArgs || Object.keys(args).length !== 0) return undefined;
      // This established fixture exercises the supported legacy book/inbox readers.
      // Feed broadcast is separate from Live video and this transport has no invalidation feed.
      return name === 'get_paged_reader_capabilities'
        ? { version: 1, books: false, inbox: false, books_window: false, book_page_limit: 40, inbox_page_limit: 50 }
        : { version: 1, max_ids: 24, configured: false, recovery_generation: 0, enabled: false };
    }
    if (name === 'get_feed_rows_by_ids_v1' || name === 'get_post_engagement_counts_v1') {
      if (!plainArgs || Object.keys(args).length !== 1 || !Object.hasOwn(args, 'p_ids')
        || args.p_ids !== null && !Array.isArray(args.p_ids)) return undefined;
      const ids = args.p_ids || [];
      if (ids.length > 100 || ids.some(id => typeof id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return undefined;
      const selected = posts.filter(post => ids.includes(post.post_id));
      return name === 'get_feed_rows_by_ids_v1' ? selected : selected.map(post => ({
        post_id: post.post_id, likes_count: post.likes_count, comments_count: post.comments_count,
        reposts_count: post.reposts_count, bookmarks_count: post.bookmarks_count, views_count: post.views_count,
        shares_count: post.shares_count || 0, quotes_count: posts.filter(quote => quote.quoted_post_id === post.post_id).length,
      }));
    }
    if (name === 'live_directory') {
      if (!['for_you', 'mine', 'following'].includes(args.p_filter) || args.p_state !== 'live' || args.p_topic !== null
        || args.p_cursor !== null || ![1, 24].includes(args.p_limit)) return undefined;
      if (immersiveLive) return { items: args.p_filter === 'mine' ? [] : liveSessions,
        next_cursor: null, capabilities: { create: true, broadcast: true, view: true, reminders: true, recording: true } };
      return { items: args.p_filter === 'mine' ? [] : [{ id: '90000000-0000-4000-8000-000000000001',
        title: 'Community creator hour', description: 'A controlled native UI preview.', topic: 'irl', state: 'live',
        audience: 'public', language: 'en', chat_mode: 'open', slow_mode_seconds: 0, recording_enabled: false,
        started_at: created, ended_at: null, scheduled_at: null, has_cover: false, thumbnail_url: null,
        viewer_count: 12, replay_available: false, host: profiles[1] }], next_cursor: null,
        capabilities: { create: true, broadcast: true, view: true, reminders: true, recording: true } };
    }
    if (immersiveLive && name === 'live_session') {
      const session = liveSessions.find(item => item.id === args.p_session_id);
      if (!session) return undefined;
      const manages = session.id === liveIds[1] && owner === OWNER;
      return { session, role: manages ? 'producer' : 'viewer', capabilities: { view: true, chat: true },
        chat_topic: liveTopic(session.id), guest_topic: '', pinned_message: null,
        own_join_request: liveRequests.get(session.id + ':' + owner) || null,
        join_requests: manages ? [...liveRequests.entries()].filter(([key]) => key.startsWith(session.id + ':')).map(([,row]) => row) : [],
        members: manages ? liveMembers : [], stage: { maximum: 12, occupied: 1 + liveMembers.length, available: 11 - liveMembers.length } };
    }
    if (immersiveLive && name === 'live_messages' && liveIds.includes(args.p_session_id)) {
      return { items: liveMessages.filter(row => row.session_id === args.p_session_id), next_cursor: null };
    }
    if (immersiveLive && name === 'live_viewer_heartbeat' && liveIds.includes(args.p_session_id)) return { ok: true, viewer_count: 12 };
    if (immersiveLive && name === 'live_command' && liveIds.includes(args.p_session_id)) {
      const id = args.p_session_id, action = args.p_action, payload = args.p_payload || {};
      if (!/^[0-9a-f-]{36}$/i.test(args.p_request_id || '')) return undefined;
      if (action === 'request_join' && id === liveIds[0]) liveRequests.set(id + ':' + owner, { user_id: owner, profile: profiles[0], status: 'pending', created_at: created });
      else if (action === 'cancel_join_request' && id === liveIds[0]) liveRequests.delete(id + ':' + owner);
      else if (action === 'accept_join_request' && id === liveIds[1] && owner === OWNER && payload.user_id === PEER) {
        const request = liveRequests.get(id + ':' + PEER);
        if (!request || request.status !== 'pending') return undefined;
        request.status = 'accepted'; liveMembers.push({ user_id: PEER, role: 'guest', status: 'accepted', profile: profiles[1] });
      } else if (action === 'chat' && typeof payload.body === 'string' && payload.body.trim()) {
        const row = { id: '92000000-0000-4000-8000-' + String(liveMessages.length + 1).padStart(12, '0'),
          session_id: id, user_id: owner, author: profiles.find(profile => profile.id === owner), body: payload.body.trim(), created_at: new Date().toISOString(), removed: false };
        liveMessages.push(row); FixtureWebSocket.broadcast(liveTopic(id), 'message', row);
      } else return undefined;
      receipt.immersiveLive.commands.push({ sessionId: id, action, payload, owner }); onChange(receipt);
      return { ok: true };
    }
    if (name === 'get_feed' || name === 'get_discover_page' || name === 'get_trending_feed') return args.p_cursor_id || args.p_offset ? [] : posts;
    if (name === 'get_feed_visibility') return (args.p_ids || []).map(post_id => ({ post_id, snapshot_eligible: true }));
    if (name === 'get_profile') return profiles.find(profile => profile.id === args.p_profile_id) || null;
    if (name === 'get_my_actors') return [{ ...profiles.find(profile => profile.id === owner), actor_type: 'personal', is_self: true }];
    if (name === 'get_profile_posts_page') return posts.filter(post => post.author_id === args.p_profile_id);
    if (name === 'get_profile_reach_28d') return 12;
    if (name === 'get_profile_insights') return { views_7d: 3, views_30d: 12 };
    if (name === 'get_profile_context') return { mutual_names: [], mutual_count: 0, shared_communities: [] };
    if (name === 'get_memory_albums') {
      const summary = { ...savedBook };
      delete summary.pages;
      return { is_owner: args.p_owner === owner, books: owner === OWNER && args.p_owner === OWNER ? [summary] : [] };
    }
    if (name === 'get_memory_book') {
      if (owner !== OWNER) return null;
      if (args.p_album === BOOK) return memoryBook();
      if (args.p_album !== NAVIGATION_BOOK) return null;
      record('bookReads', { id: savedBook.id, owner, revision: savedBook.presentation_revision,
        title: savedBook.title, cover_color: savedBook.cover_color, cover_design: savedBook.cover_design,
        cover_artwork: savedBook.cover_artwork, film_settings: savedBook.film_settings });
      return savedBook;
    }
    if (name === 'get_memory_book_creative_capabilities') return { version: 1, supported: true };
    if (name === 'save_memory_book_creative_presentation') {
      let claims;
      try { claims = JSON.parse(atob((headers.get('authorization') || '').replace(/^Bearer /, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { /* Invalid claims are rejected by the ownership check below. */ }
      if (owner !== OWNER || claims?.sub !== OWNER || claims?.session_id !== sessionId || args.p_album !== NAVIGATION_BOOK) {
        return response({ code: '42501', message: 'The synthetic book belongs to another account.' }, 403);
      }
      if (args.p_expected_revision !== savedBook.presentation_revision) return response({ code: '40001', message: 'MEMORY_BOOK_CHANGED' }, 409);
      // Match the versioned creative contract, with no arbitrary delivery URLs.
      const artwork = args.p_cover_artwork, film = args.p_film_settings;
      const sameKeys = (value, example) => value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).sort().join(',') === Object.keys(example).sort().join(',');
      const text = (value, limit) => typeof value === 'string' && Array.from(value).length <= limit;
      const range = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
      if (!text(args.p_title, 30) || !args.p_title.trim() || !text(args.p_subtitle, 120)
        || !['blush', 'rose', 'pearl', 'cream', 'sage', 'sky', 'lilac', 'ink'].includes(args.p_cover_color)
        || !['keepsake', 'postcard', 'editorial', 'field_notes', 'night_film', 'daybook', 'botanical', 'classic'].includes(args.p_cover_design)
        || !['profile', 'followers', 'custom', 'only_me'].includes(args.p_audience)
        || args.p_cover_story_id !== null && !savedBook.pages.some(page => page.story_id === args.p_cover_story_id)
        || !sameKeys(artwork, savedBook.cover_artwork) || artwork.version !== 1
        || !text(artwork.inscription, 160) || !text(artwork.postmark, 32)
        || !['handwritten', 'serif', 'sans'].includes(artwork.inscriptionStyle)
        || !['top', 'bottom'].includes(artwork.inscriptionPosition) || typeof artwork.showDate !== 'boolean'
        || !sameKeys(artwork.photo, savedBook.cover_artwork.photo) || !range(artwork.photo.x, 0, 1)
        || !range(artwork.photo.y, 0, 1) || !range(artwork.photo.scale, 1, 2.5)
        || !sameKeys(film, savedBook.film_settings) || film.version !== 1
        || !['automatic', 'original'].includes(film.mode) || !['reflective', 'bright', 'cinematic'].includes(film.style)
        || !['short', 'standard', 'full'].includes(film.length) || !['book', 'chronological'].includes(film.order)
        || typeof film.titleCard !== 'boolean' || typeof film.originalAudio !== 'boolean') {
        return response({ code: '22023', message: 'Invalid synthetic creative settings.' }, 400);
      }
      Object.assign(savedBook, { title: args.p_title, subtitle: args.p_subtitle, cover_color: args.p_cover_color,
        cover_design: args.p_cover_design, cover_story_id: args.p_cover_story_id, audience: args.p_audience,
        cover_artwork: artwork, film_settings: film, presentation_revision: savedBook.presentation_revision + 1 });
      record('mutations', { rpc: name, owner, id: savedBook.id, revision: savedBook.presentation_revision,
        title: savedBook.title, cover_color: savedBook.cover_color, cover_design: savedBook.cover_design,
        cover_artwork: artwork, film_settings: film });
      return { id: savedBook.id, presentation_revision: savedBook.presentation_revision, cover_artwork: artwork, film_settings: film };
    }
    if (name === 'my_application_page') return { applications: [], has_more: false, cursor: null };
    if (name === 'get_market_feed') return args.p_offset ? [] : rows.marketplace_listings;
    if (name === 'get_unread_counts') return [{ conversation_id: CONVERSATION, unread_count: 1 }];
    if (name === 'get_context_unread') return { market: 0, jobs: 0, groups: 0,
      personal: rows.messages.filter(message => message.receiver_id === owner && message.sender_id !== owner && message.read_at === null).length };
    if (name === 'get_catchup_feed') return [{ ...profiles[1], user_id: PEER, story_count: 1, unseen_count: 1,
      latest_story_at: story.created_at, latest_story_id: STORY, has_unseen: true }];
    if (name === 'get_user_stories') return args.p_user_id === PEER ? [story] : [];
    if (name === 'viewer_can_see_story') return args.p_story_id === STORY;
    if (name === 'search_people_page') return profiles.filter(profile => (profile.username + profile.full_name).toLowerCase().includes(String(args.p_q || '').toLowerCase()));
    if (name === 'get_original_audio_capabilities') return { uploads_enabled: false, catalogue_playback_enabled: false };
    if (name === 'get_trending_topics') return [{ topic: 'Memories', post_count: 2 }];
    if (name === 'toggle_post_like') {
      const post = posts.find(item => item.post_id === args.p_post_id);
      post.viewer_liked = !post.viewer_liked; post.likes_count += post.viewer_liked ? 1 : -1;
      record('mutations', { rpc: name, owner, id: post.id });
      return { liked: post.viewer_liked, likes_count: post.likes_count };
    }
    if (name === 'start_dm_ctx') return CONVERSATION;
    if (['get_recent_likers', 'get_active_promos', 'get_trending_stories', 'home_marketplace_recommendations', 'get_user_highlights', 'get_my_story_reactions', 'get_story_reactions',
      'get_story_viewers', 'get_story_sticker_summary', 'get_my_sticker_response', 'get_communities',
      'get_my_communities', 'get_channels', 'get_my_channels', 'get_market_orders', 'get_my_market_orders',
      'get_story_poll', 'list_playable_sounds'].includes(name)) return [];
    if (['mark_story_viewed', 'mark_conversation_read', 'save_push_token', 'save_voip_token', 'record_video_view',
      'record_post_view', 'increment_share_count', 'record_ad_event', 'register_login', 'record_login'].includes(name)) return null;
    return undefined;
  }
  function filterRows(table, url) {
    let selected = rows[table].slice();
    for (const [field, filter] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'or', 'and'].includes(field)) continue;
      const dot = filter.indexOf('.');
      const op = filter.slice(0, dot), value = filter.slice(dot + 1);
      if (op === 'eq') selected = selected.filter(row => String(row[field]) === value);
      else if (op === 'neq') selected = selected.filter(row => String(row[field]) !== value);
      else if (op === 'in') selected = selected.filter(row => value.slice(1, -1).replace(/"/g, '').split(',').includes(String(row[field])));
      else if (op === 'is') selected = selected.filter(row => value === 'null' ? row[field] == null : String(row[field]) === value);
      else if (op === 'ilike') selected = selected.filter(row => String(row[field] || '').toLowerCase().includes(value.replace(/[%*]/g, '').toLowerCase()));
      else if (op === 'gt' || op === 'gte') selected = selected.filter(row => row[field] >= value);
      else if (op === 'lt' || op === 'lte') selected = selected.filter(row => row[field] <= value);
    }
    return selected;
  }
  async function fetchFixture(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input));
    const method = (init.method || input.method || 'GET').toUpperCase();
    const path = url.pathname;
    if (url.origin !== 'https://uaulhuelcfkjwojtymmw.supabase.co') return unknown(method, url.origin + path);
    const readerKind = path === '/rest/v1/rpc/get_memory_book' && method === 'POST' ? 'book'
      : path === '/rest/v1/story_reactions' && method === 'GET' ? 'reactions' : null;
    const readerResponse = value => readerKind ? observeReaderResponse(value, readerKind) : value;
    if (offline) throw new TypeError('Synthetic offline state');
    if (init.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    if (delayMs) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); }, { once: true });
    });
    record('requests', { method, path, owner });
    const headers = new Headers(init.headers || input.headers || {});
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
    if (path === '/auth/v1/health' && method === 'GET') return response({ name: 'Synthetic native UI Auth health' });
    if (path === '/auth/v1/token' && method === 'POST') {
      const match = profiles.find(profile => profile.email === body.email);
      if (url.searchParams.get('grant_type') === 'refresh_token' && body.refresh_token?.startsWith('synthetic-refresh-')) {
        owner = body.refresh_token.slice('synthetic-refresh-'.length);
        if (!profiles.some(profile => profile.id === owner)) return response({ msg: 'Invalid synthetic session' }, 401);
      } else if (match && body.password === 'FixtureOnly-2026!') owner = match.id;
      else return response({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      issuedMedia.clear();
      sessionId = '90000000-0000-4000-8000-' + String(++sessionCounter).padStart(12, '0');
      return response(session());
    }
    if (path === '/auth/v1/logout') { owner = null; issuedMedia.clear(); return response(null, 204); }
    if (path === '/auth/v1/user') {
      if (!owner) return response({ msg: 'No synthetic session' }, 401);
      return response(user());
    }
    if (path === '/auth/v1/factors') return response({ all: [], totp: [], phone: [] });
    if (!owner && path.startsWith('/rest/v1/')) return readerResponse(response({ message: 'Authentication required' }, 401));
    if (path === '/rest/v1/rpc/get_feed' && feedVideoSource && !posts[0].media.length) {
      if (!feedVideoReady) feedVideoReady = (async () => {
        const url = await feedVideoSource();
        if (typeof url !== 'string' || !url.startsWith('file://')) throw new Error('Native feed video must use the packaged local fixture.');
        const media = { id: '21000000-0000-4000-8000-000000000001', post_id: posts[0].id,
          url, media_type: 'video', sort_order: 0, width: 320, height: 240, edit: { aspect: 'original' } };
        posts[0].media = [media]; posts[0].post_media = [media]; posts[0].media_url = url;
        rows.post_media = [media];
        for (let index = 3; index <= 8; index++) {
          const id = '20000000-0000-4000-8000-' + String(index).padStart(12, '0');
          const content = index === 8 ? 'Feed scroll checkpoint.' : 'A small moment from day ' + index + '.';
          posts.push({ ...posts[1], id, post_id: id, user_id: PEER, author_id: PEER, content, body: content,
            sort_key: 10 - index, created_at: new Date(Date.now() - index * 3600000).toISOString() });
        }
      })();
      await feedVideoReady;
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const value = rpc(path.slice('/rest/v1/rpc/'.length), body, headers);
      return readerResponse(value === undefined ? unknown(method, path) : value instanceof Response ? value : response(value));
    }
    if (path === '/functions/v1/crisp-bridge') return response({ success: true, linked: false, linked_at: null });
    if (immersiveLive && path === '/functions/v1/live-playback' && liveIds.includes(body.sessionId)) {
      if (!owner) return response({ error: 'AUTH_REQUIRED' }, 401);
      const uri = await feedVideoSource?.();
      if (!uri?.startsWith('file://')) throw new Error('Native Live layout requires the packaged local video.');
      issuedMedia.add(uri);
      return response({ format: 'hls', url: 'https://native-ui.invalid/packaged-live.m3u8',
        live: true, expires_at: new Date(Date.now() + 5 * 60000).toISOString() });
    }
    if (path === '/functions/v1/content-media-sign') {
      let claims;
      try { claims = JSON.parse(atob((headers.get('authorization') || '').replace(/^Bearer /, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { /* Invalid claims are rejected by the ownership check below. */ }
      if (owner !== OWNER || claims?.sub !== owner || claims?.session_id !== sessionId) return response({ message: 'Synthetic media ownership changed.' }, 403);
      if (method !== 'POST' || body.delivery !== 'no-store' || !Array.isArray(body.references) || body.references.length !== 1
        || body.references[0].kind !== 'memory_album' || body.references[0].id !== BOOK) return unknown(method, path);
      const urls = Object.keys(MEDIA).map(key => ({ key, url: capability(key) }));
      urls.forEach(item => issuedMedia.add(item.url));
      return response({ urls, expiresAt: Date.now() + 60000 });
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      if (!Object.hasOwn(rows, table)) return unknown(method, path);
      let selected = filterRows(table, url);
      if (method === 'PATCH') { selected.forEach(row => Object.assign(row, body)); record('mutations', { table, method, owner }); }
      else if (method === 'POST') {
        const values = Array.isArray(body) ? body : [body];
        selected = values.map(value => ({ id: '80000000-0000-4000-8000-' + String(rows[table].length + 1).padStart(12, '0'), created_at: new Date().toISOString(), ...value }));
        rows[table].push(...selected); record('mutations', { table, method, owner });
      } else if (method === 'DELETE') {
        rows[table] = rows[table].filter(row => !selected.includes(row)); record('mutations', { table, method, owner });
      }
      const total = selected.length;
      selected = selected.slice(Number(url.searchParams.get('offset') || 0));
      if (url.searchParams.has('limit')) selected = selected.slice(0, Number(url.searchParams.get('limit')));
      const countHeaders = { 'content-range': selected.length ? `0-${selected.length - 1}/${total}` : `*/${total}` };
      if (method === 'HEAD') return new Response(null, { status: 200, headers: countHeaders });
      if (headers.get('accept')?.includes('vnd.pgrst.object')) return readerResponse(selected.length === 1 ? response(selected[0], 200, countHeaders)
        : response({ code: 'PGRST116', details: 'The result contains ' + selected.length + ' rows', message: 'Expected one row' }, 406));
      return readerResponse(response(selected, 200, countHeaders));
    }
    return unknown(method, path);
  }
  return { fetch: fetchFixture, receipt, profiles, posts, recordCaptureBoundary,
    nativeLiveVideoSource(grant) {
      const uri = [...issuedMedia].find(value => value.startsWith('file://'));
      if (!immersiveLive || grant.url !== 'https://native-ui.invalid/packaged-live.m3u8' || !uri) throw new Error('Unexpected native Live fixture source.');
      return { uri, contentType: 'progressive', useCaching: false };
    },
    recordLiveFrame(id) { if (immersiveLive && liveIds.includes(id) && !receipt.immersiveLive.frames.includes(id)) { receipt.immersiveLive.frames.push(id); onChange(receipt); } },
    recordLiveProgress(id, seconds) { if (immersiveLive && liveIds.includes(id) && seconds > 0.2 && !receipt.immersiveLive.progress.some(row => row.id === id)) { receipt.immersiveLive.progress.push({ id, seconds }); onChange(receipt); } },
    observeFeedRefresh(work) {
      const reads = () => receipt.requests.filter(row => row.path === '/rest/v1/rpc/get_feed').length;
      const before = reads();
      const result = work();
      Promise.resolve(result).then(() => record('feedRefreshes', { before, after: reads(), completed: true }),
        () => record('feedRefreshes', { before, after: reads(), completed: false }));
      return result;
    },
    authorizeMemoryMedia(url) {
      if (owner !== OWNER || offline || !issuedMedia.has(url)) {
        record('unhandled', { method: 'MEDIA', path: String(url).split('?')[0] });
        throw new Error('Synthetic memory media was not authorized for this account.');
      }
      const key = Object.keys(MEDIA).find(value => capability(value) === url);
      if (!key) throw new Error('Unknown synthetic memory media.');
      return { key, file: MEDIA[key], mode: memoryMode };
    },
    recordMemoryMedia(event) { record('media', { ...event, owner }); },
    recordAccountReadback(result) {
      record('accountReadbacks', { passed: result.passed === true, reloaded: result.reloaded === true,
        accountCount: Number.isSafeInteger(result.accountCount) ? result.accountCount : -1 });
    },
    configure({ offline: nextOffline, delayMs: nextDelay, memoryMode: nextMemoryMode } = {}) {
      if (typeof nextOffline === 'boolean') offline = nextOffline;
      if (Number.isFinite(nextDelay)) delayMs = Math.min(15000, Math.max(0, nextDelay));
      if (nextMemoryMode === 'normal' || nextMemoryMode === 'cancel') memoryMode = nextMemoryMode;
    } };
}

class FixtureWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static sockets = new Set();
  static broadcast(topic, event, payload) {
    for (const socket of this.sockets) for (const [name, join] of socket.topics) if (name === 'realtime:' + topic) {
      const value = { type: 'broadcast', event, payload };
      const message = join.array ? [join.ref, null, name, 'broadcast', value] : { topic: name, event: 'broadcast', payload: value };
      setTimeout(() => { if (socket.readyState === 1) socket.emit('message', { data: JSON.stringify(message) }); }, 0);
    }
  }
  constructor() {
    this.readyState = 0; this.bufferedAmount = 0; this.listeners = new Map(); this.topics = new Map(); FixtureWebSocket.sockets.add(this);
    setTimeout(() => { this.readyState = 1; this.emit('open', {}); }, 0);
  }
  emit(type, event) {
    this['on' + type]?.(event);
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
  addEventListener(type, listener) { const list = this.listeners.get(type) || new Set(); list.add(listener); this.listeners.set(type, list); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  send(data) {
    const message = JSON.parse(data);
    const [joinRef, ref, topic, event] = Array.isArray(message) ? message : [null, message.ref, message.topic, message.event];
    if (event === 'phx_join') this.topics.set(topic, { ref: joinRef, array: Array.isArray(message) });
    if (event === 'phx_leave') this.topics.delete(topic);
    if (['phx_join', 'phx_leave', 'heartbeat'].includes(event)) {
      const payload = { status: 'ok', response: { postgres_changes: [] } };
      const reply = Array.isArray(message) ? [joinRef, ref, topic, 'phx_reply', payload] : { ref, topic, event: 'phx_reply', payload };
      setTimeout(() => this.emit('message', { data: JSON.stringify(reply) }), 0);
    }
  }
  close() { this.readyState = 3; this.topics.clear(); FixtureWebSocket.sockets.delete(this); this.emit('close', { code: 1000, reason: 'Synthetic socket closed', wasClean: true }); }
}

module.exports = { createFixture, FixtureWebSocket, OWNER, PEER, SECOND };
