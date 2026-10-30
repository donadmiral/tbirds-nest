/** Synthetic browser adapter only. Never imported by the application. No network credentials. */
import type { FeedRow } from '../../lib/feed';
export const OWNER = '10000000-0000-4000-8000-000000000001';
export const CREATOR = '10000000-0000-4000-8000-000000000002';
export const SECOND = '10000000-0000-4000-8000-000000000003';
const initial = (id: string, name: string, username: string) => ({ id, full_name: name, username, avatar_url: null, banner_url: '/coast.svg', bio: 'Places, people and the moments in between.', headline: 'Filmmaker and independent creator', workplace: 'Independent', location: 'Cape Town', links: [{ title: 'Portfolio', url: 'https://example.com/work' }], profile_visibility: 'public', is_verified: false, verified_tier: null, account_type: 'personal', account_class: 'creator', account_labels: {}, created_at: '2026-01-02T10:00:00Z' });
export const profiles: Record<string, any> = { [OWNER]: initial(OWNER, 'Avery Lane', 'avery_lane'), [CREATOR]: initial(CREATOR, 'Jordan Ellis', 'jordan_ellis'), [SECOND]: initial(SECOND, 'Casey Morgan', 'casey_morgan') };
export const posts = [
  { post_id: '20000000-0000-4000-8000-000000000001', author_id: CREATOR, content: 'A slower morning on the coast. A few moments from a place I keep coming back to.', author_name: 'Jordan Ellis', author_username: 'jordan_ellis', media: [{ id: 'media-1', url: '/coast.svg', media_type: 'image', width: 1200, height: 720, sort_order: 0 }] },
  { post_id: '20000000-0000-4000-8000-000000000002', author_id: OWNER, content: 'Make something that matters to you. Then share a little of the process.', author_name: 'Avery Lane', author_username: 'avery_lane', media: [] },
].map((row, index) => ({ body: null, media_url: null, products: [], link: null, channel: null, article_title: null, read_minutes: null, quoted_post_id: null, thread_parent_id: null, created_at: new Date(Date.now() - (index + 1) * 3600000).toISOString(), likes_count: 42 + index, comments_count: 8, reposts_count: 3, bookmarks_count: 5, views_count: 130, is_trending: false, author_avatar: null, author_verified: false, author_kind: 'personal', author_verified_tier: null, viewer_liked: false, viewer_bookmarked: false, viewer_reposted: false, viewer_follows: false, sort_key: 10 - index, innovation_field: null, innovation_stage: null, ...row } as FeedRow));
let owner: string | null = OWNER;
const listeners = new Set<(event: string, session: any) => void>();
const user = () => owner ? { id: owner, email: 'synthetic@example.invalid', email_confirmed_at: '2026-01-02T10:00:00Z' } : null;
const session = () => owner ? { user: user(), access_token: 'synthetic-only-no-live-access' } : null;
const receipt: any[] = [];
const faults = { profileRead: false, profileWrite: false, authRead: false, signOut: false, discovery: false, dm: false, peopleRead: false, socialWrite: false, delayWrite: 0 };
const conversations = [{ id: 'conversation-fixture', user_1: OWNER, user_2: CREATOR, is_group: false, context: 'personal', last_message: 'A few moments from the coast.', last_message_time: new Date().toISOString() }];
const messages = [{ id: '30000000-0000-4000-8000-000000000001', conversation_id: 'conversation-fixture', sender_id: CREATOR, receiver_id: OWNER, text: 'A few moments from the coast.', media_url: '/coast.svg', media_type: 'image', reply_to_id: null, created_at: new Date().toISOString() }, { id: '30000000-0000-4000-8000-000000000002', conversation_id: 'conversation-fixture', sender_id: OWNER, receiver_id: CREATOR, text: 'The light is beautiful. Thanks for sharing these.', media_url: null, media_type: null, reply_to_id: null, created_at: new Date(Date.now() + 1000).toISOString() }];
const community = { id: 'community-fixture', name: 'City Walks', description: 'Share routes, small discoveries and the people who make a city.', icon_url: null, cover_color: 'sky', category: null, rules: 'Be respectful. Share original work. Keep conversations on topic.', join_mode: 'open', member_count: 128, is_member: true, my_role: 'owner', my_status: 'active', has_pending: false };
const channel = { id: 'channel-fixture', name: 'Field Notes', description: 'Updates from the creative process.', icon_url: null, member_count: 64, is_member: true, my_role: 'owner', owner_username: 'avery_lane', audience: 'everyone', replies_enabled: true, my_notification_level: 'all' };
const uploads = new Map<string, string>();
export const fixture = { receipt, faults, profiles, owner: () => owner,
  switchOwner(id: string | null) { owner = id; listeners.forEach(listener => listener(id ? 'SIGNED_IN' : 'SIGNED_OUT', session())); window.dispatchEvent(new Event('fixture-owner')); },
  refreshToken() { listeners.forEach(listener => listener('TOKEN_REFRESHED', session())); },
  clear() { receipt.length = 0; },
};
if (typeof window !== 'undefined') (window as any).__socialFixture = fixture;
class Query implements PromiseLike<any> {
  filters: [string, string, any][] = []; cols = '*'; options: any = {}; one = false; operation = 'select'; values: any; maximum = Infinity;
  constructor(public table: string) {}
  select(cols = '*', options: any = {}) { this.cols = cols; this.options = options; return this; }
  update(value: any) { this.operation = 'update'; this.values = value; return this; }
  insert(value: any) { this.operation = 'insert'; this.values = value; return this; }
  upsert(value: any) { this.operation = 'upsert'; this.values = value; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(key: string, value: any) { this.filters.push(['eq', key, value]); return this; }
  neq(key: string, value: any) { this.filters.push(['neq', key, value]); return this; }
  ilike(key: string, value: any) { this.filters.push(['ilike', key, value]); return this; }
  in(key: string, value: any) { this.filters.push(['in', key, value]); return this; }
  is() { return this; } gte() { return this; } gt() { return this; } lt() { return this; } lte() { return this; } or() { return this; }
  order() { return this; } limit(count: number) { this.maximum = count; return this; } range() { return this; } abortSignal() { return this; }
  single() { this.one = true; return this; } maybeSingle() { this.one = true; return this; }
  async execute() {
    const requestedOwner = owner;
    let rows: any[] = this.table === 'conversations' ? conversations : this.table === 'messages' ? messages : this.table === 'profiles' ? Object.values(profiles) : this.table === 'posts' ? posts.map(row => ({ ...row, id: row.post_id, user_id: row.author_id })) : [];
    for (const [op, key, value] of this.filters) rows = rows.filter(row => op === 'eq' ? row[key] === value : op === 'neq' ? row[key] !== value : op === 'in' ? value.includes(row[key]) : op === 'ilike' ? String(row[key]).toLowerCase().startsWith(String(value).replace(/[%\\]/g, '').toLowerCase()) : true);
    const fail = (message: string) => ({ data: null, count: null, error: { message } });
    if (this.table === 'profiles' && this.operation === 'select' && faults.profileRead && this.cols.includes('bio')) return fail('Synthetic profile read failure');
    if (this.operation !== 'select') {
      const write = { table: this.table, operation: this.operation, owner: requestedOwner, filters: this.filters, values: this.values, completed: false };
      receipt.push(write);
      if (this.table === 'profiles') {
        if (faults.delayWrite) await new Promise(resolve => setTimeout(resolve, faults.delayWrite));
        if (faults.profileWrite) { write.completed = true; return fail('Synthetic write failure'); }
        if (!rows[0] || rows[0].id !== requestedOwner) { write.completed = true; return fail('Synthetic owner restriction'); }
        Object.assign(rows[0], this.values);
      }
      write.completed = true;
    }
    const count = this.table === 'notifications' ? 3 : rows.length;
    rows = rows.slice(0, this.maximum);
    return { data: this.options.head ? null : this.one ? rows[0] ?? null : rows, count, error: null };
  }
  then<A = any, B = never>(onFulfilled?: ((value: any) => A | PromiseLike<A>) | null, onRejected?: ((reason: any) => B | PromiseLike<B>) | null): Promise<A | B> { return this.execute().then(onFulfilled, onRejected); }
}
const client = {
  auth: {
    getSession: async () => ({ data: { session: session() }, error: null }),
    getUser: async () => faults.authRead ? ({ data: { user: null }, error: { message: 'Synthetic account read failure' } }) : ({ data: { user: user() }, error: null }),
    onAuthStateChange(callback: (event: string, session: any) => void) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
    async signOut() { receipt.push({ operation: 'signOut' }); if (faults.signOut) return { error: { message: 'Synthetic sign-out failure' } }; fixture.switchOwner(null); return { error: null }; },
  },
  from: (table: string) => new Query(table),
  rpc(name: string, args: any = {}) {
    receipt.push({ rpc: name, args, owner });
    let data: any = [], error: any = null;
    if (name === 'get_feed' || name === 'get_discover_page') data = posts;
    else if (name === 'get_communities_page') data = community.name.toLowerCase().includes(String(args.p_query || '').toLowerCase()) ? [community] : [];
    else if (name === 'get_channels_page') data = channel.name.toLowerCase().includes(String(args.p_query || '').toLowerCase()) ? [channel] : [];
    else if (name === 'get_community') data = { ...community, id: args.p_community };
    else if (name === 'get_channel_detail') data = { ...channel, id: args.p_channel };
    else if (name === 'get_community_members_page' || name === 'get_channel_members_page') data = [{ user_id: OWNER, full_name: 'Avery Lane', username: 'avery_lane', avatar_url: null, role: 'owner', status: 'active', notification_level: 'all' }];
    else if (name === 'create_community' || name === 'create_channel') { data = faults.socialWrite ? null : { id: name === 'create_community' ? 'new-community-fixture' : 'new-channel-fixture' }; if (faults.socialWrite) error = {message:'Synthetic create failure'}; }
    else if (name === 'update_community_settings' || name === 'update_channel_settings') { if(faults.socialWrite) error = {message:'Synthetic settings failure'}; else { const record: any = name === 'update_community_settings' ? community : channel; for(const [key,value] of Object.entries(args)) if(!['p_community','p_channel'].includes(key)) record[key.slice(2)] = value; } }
    else if (name === 'get_community_conversation') data = 'community-conversation-fixture';
    else if (name === 'post_channel_poll' && faults.socialWrite) error = {message:'Synthetic poll failure'};
    else if (name === 'get_profile_posts_page') data = posts.filter(post => post.author_id === args.p_profile_id);
    else if (name === 'get_feed_visibility') data = (args.p_ids ?? []).map((id: string) => ({ post_id: id, snapshot_eligible: true }));
    else if (name === 'get_trending_topics') { data = [{ topic: 'CreativeProcess', post_count: 140 }, { topic: 'CoastalStories', post_count: 82 }, { topic: 'SmallMoments', post_count: 58 }]; if (faults.discovery) error = { message: 'Synthetic discovery failure' }; }
    else if (name === 'get_memory_albums') data = { is_owner: args.p_owner === owner, books: ['Postcards', 'City notes', 'Small wins', 'Weekend journal'].map((title, index) => ({ id: 'book-' + index, title, subtitle: 'PLACES · PEOPLE · STORIES', cover_color: ['#d4c2a0', '#27496c', '#c7b49c', '#586756'][index], cover_design: ['postcard', 'editorial', 'field_notes', 'botanical'][index], audience: index === 3 ? 'only_me' : 'profile', count: index + 3, cover_page: { media_type: 'image', media_url: '/coast.svg' } })) };
    else if (name === 'get_profile_insights') data = { views_7d: 12, views_30d: 36 };
    else if (name === 'get_profile_context') data = { mutuals: [], shared_communities: [] };
    else if (name === 'search_people_page') { data = Object.values(profiles).filter(person => (person.full_name + person.username).toLowerCase().includes(String(args.p_q).toLowerCase())); if(faults.peopleRead) error = {message:'Synthetic people read failure'}; }
    else if (name === 'start_dm_ctx') { data = 'conversation-fixture'; if (faults.dm) error = { message: 'Synthetic conversation failure' }; }
    else if (name === 'handle_follow_action') data = { action: 'followed' };
    const result: any = Promise.resolve({ data, error }); result.abortSignal = () => result; return result;
  },
  functions: { invoke: async () => ({ data: null, error: null }) },
  channel: () => { const channel: any = { on: () => channel, subscribe: () => channel, unsubscribe: async () => {} }; return channel; },
  removeChannel: async () => {},
  storage: { from: (bucket: string) => ({
    upload: async (key: string, file: File) => { receipt.push({ operation: 'upload', bucket, key, owner }); uploads.set(key, URL.createObjectURL(file)); return { data: { path: key }, error: null }; },
    getPublicUrl: (key: string) => ({ data: { publicUrl: uploads.get(key) ?? '/coast.svg' } }),
    createSignedUrl: async (key: string) => ({ data: { signedUrl: uploads.get(key) ?? '/coast.svg' }, error: null }),
  }) },
};
export const createClient = () => client as any;
export const getServerViewer = async () => ({ user: user() });
export const hydratePostMedia = async <T,>(rows: T[]) => rows;
export const hydrateStoryMedia = hydratePostMedia;
export const hydrateStoryDraftMedia = hydratePostMedia;
export const hydrateMemoryAlbumMedia = hydratePostMedia;
export const hydrateHighlightMedia = hydratePostMedia;
export const hydrateUploadMedia = hydratePostMedia;
export const hydrateSoundMedia = hydratePostMedia;
