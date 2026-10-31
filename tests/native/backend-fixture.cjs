/** Disposable native UI transport. Imported only by tests/native/entry.js.
 * The real app, Supabase client, stores, navigation and screens still execute.
 * No request is forwarded to a hosted project or an external provider. */
const OWNER = '10000000-0000-4000-8000-000000000001';
const PEER = '10000000-0000-4000-8000-000000000002';
const SECOND = '10000000-0000-4000-8000-000000000003';
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

function createFixture(onChange = () => {}) {
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
    thumbnail_url: null, text_content: 'A moment worth remembering.', background_color: '#24354f',
    text_color: '#ffffff', font_style: 'classic', duration: 8, duration_sec: 8,
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
    audience: 'everyone', seen: false, stickers: [], text_stickers: [], audio: null,
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
    'post_shares', 'post_media', 'hidden_posts', 'blocked_users', 'restricted_users', 'close_friends',
    'muted_stories', 'muted_users', 'conversation_members', 'conversation_settings', 'conversation_typing',
    'message_mentions', 'message_reactions', 'message_stars', 'message_saves', 'message_requests',
    'call_sessions', 'call_participants', 'user_push_tokens', 'job_saves', 'job_applications', 'job_recommendations',
    'job_referrals', 'saved_listings', 'business_members', 'business_profiles', 'business_applications',
    'story_views', 'story_reactions', 'story_highlights', 'story_mutes', 'hidden_words', 'support_tickets',
    'user_devices', 'login_history', 'login_events', 'verification_applications', 'member_strikes']) rows[table] = [];
  let owner = null;
  let sessionCounter = 0;
  let sessionId = '';
  let offline = false;
  let delayMs = 0;
  const receipt = { mode: 'synthetic-native-ui', networkForwarded: false, requests: [], unhandled: [], mutations: [] };
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
  function rpc(name, args) {
    if (name === 'get_feed' || name === 'get_discover_page' || name === 'get_trending_feed') return args.p_cursor_id || args.p_offset ? [] : posts;
    if (name === 'get_feed_visibility') return (args.p_ids || []).map(post_id => ({ post_id, snapshot_eligible: true }));
    if (name === 'get_profile') return profiles.find(profile => profile.id === args.p_profile_id) || null;
    if (name === 'get_my_actors') return [{ ...profiles.find(profile => profile.id === owner), actor_type: 'personal', is_self: true }];
    if (name === 'get_profile_posts_page') return posts.filter(post => post.author_id === args.p_profile_id);
    if (name === 'get_profile_reach_28d') return 12;
    if (name === 'get_profile_insights') return { views_7d: 3, views_30d: 12 };
    if (name === 'get_profile_context') return { mutual_names: [], mutual_count: 0, shared_communities: [] };
    if (name === 'get_memory_albums') return { is_owner: args.p_owner === owner, books: [] };
    if (name === 'get_market_feed') return args.p_offset ? [] : rows.marketplace_listings;
    if (name === 'get_unread_counts') return [{ conversation_id: CONVERSATION, unread_count: 1 }];
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
    if (['get_recent_likers', 'get_active_promos', 'get_user_highlights', 'get_my_story_reactions', 'get_story_reactions',
      'get_story_viewers', 'get_story_sticker_summary', 'get_my_sticker_response', 'get_communities',
      'get_my_communities', 'get_channels', 'get_my_channels', 'get_market_orders', 'get_my_market_orders',
      'get_my_applications_page', 'get_story_poll', 'list_playable_sounds'].includes(name)) return [];
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
    if (offline) throw new TypeError('Synthetic offline state');
    if (init.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    if (delayMs) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); }, { once: true });
    });
    record('requests', { method, path, owner });
    const headers = new Headers(init.headers || input.headers || {});
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
    if (path === '/auth/v1/token' && method === 'POST') {
      const match = profiles.find(profile => profile.email === body.email);
      if (url.searchParams.get('grant_type') === 'refresh_token' && body.refresh_token?.startsWith('synthetic-refresh-')) {
        owner = body.refresh_token.slice('synthetic-refresh-'.length);
        if (!profiles.some(profile => profile.id === owner)) return response({ msg: 'Invalid synthetic session' }, 401);
      } else if (match && body.password === 'FixtureOnly-2026!') owner = match.id;
      else return response({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      sessionId = '90000000-0000-4000-8000-' + String(++sessionCounter).padStart(12, '0');
      return response(session());
    }
    if (path === '/auth/v1/logout') { owner = null; return response(null, 204); }
    if (path === '/auth/v1/user') {
      if (!owner) return response({ msg: 'No synthetic session' }, 401);
      return response(user());
    }
    if (path === '/auth/v1/factors') return response({ all: [], totp: [], phone: [] });
    if (!owner && path.startsWith('/rest/v1/')) return response({ message: 'Authentication required' }, 401);
    if (path.startsWith('/rest/v1/rpc/')) {
      const value = rpc(path.slice('/rest/v1/rpc/'.length), body);
      return value === undefined ? unknown(method, path) : response(value);
    }
    if (path === '/functions/v1/crisp-bridge') return response({ success: true, linked: false, linked_at: null });
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
      if (headers.get('accept')?.includes('vnd.pgrst.object')) return selected.length === 1 ? response(selected[0], 200, countHeaders)
        : response({ code: 'PGRST116', details: 'The result contains ' + selected.length + ' rows', message: 'Expected one row' }, 406);
      return response(selected, 200, countHeaders);
    }
    return unknown(method, path);
  }
  return { fetch: fetchFixture, receipt, profiles, posts,
    configure({ offline: nextOffline, delayMs: nextDelay } = {}) {
      if (typeof nextOffline === 'boolean') offline = nextOffline;
      if (Number.isFinite(nextDelay)) delayMs = Math.min(15000, Math.max(0, nextDelay));
    } };
}

class FixtureWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor() {
    this.readyState = 0; this.bufferedAmount = 0; this.listeners = new Map();
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
    if (['phx_join', 'phx_leave', 'heartbeat'].includes(event)) {
      const payload = { status: 'ok', response: { postgres_changes: [] } };
      const reply = Array.isArray(message) ? [joinRef, ref, topic, 'phx_reply', payload] : { ref, topic, event: 'phx_reply', payload };
      setTimeout(() => this.emit('message', { data: JSON.stringify(reply) }), 0);
    }
  }
  close() { this.readyState = 3; this.emit('close', { code: 1000, reason: 'Synthetic socket closed', wasClean: true }); }
}

module.exports = { createFixture, FixtureWebSocket, OWNER, PEER, SECOND };
