/** Synthetic browser adapter only. Never imported by the application. No network credentials. */
import type { FeedRow } from '../../lib/feed';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemoryAlbum } from '../../lib/memoryAlbum';
import { memoryCoverArtwork, memoryFilmSettings } from '../../../shared/memoryBookCreative';
import { notifyMemoryBookShelfChanged } from '../../lib/memoryBookEvents';
type FixtureRow = Record<string, unknown>;
type FixtureError = { message: string };
type QueryResult = { data: FixtureRow | FixtureRow[] | null; count: number | null; error: FixtureError | null };
type QueryOptions = { head?: boolean; count?: string };
export const CREATED_COMMUNITY = '40000000-0000-4000-8000-000000000001';
export const CREATED_CHANNEL = '40000000-0000-4000-8000-000000000002';
export const OWNER = '10000000-0000-4000-8000-000000000001';
export const CREATOR = '10000000-0000-4000-8000-000000000002';
export const SECOND = '10000000-0000-4000-8000-000000000003';
const initial = (id: string, name: string, username: string) => ({ id, full_name: name, username, avatar_url: null, banner_url: '/coast.svg', bio: 'Places, people and the moments in between.', headline: 'Filmmaker and independent creator', workplace: 'Independent', location: 'Cape Town', links: [{ title: 'Portfolio', url: 'https://example.com/work' }], profile_visibility: 'public', is_verified: false, verified_tier: null, account_type: 'personal', account_class: 'creator', account_labels: {}, created_at: '2026-01-02T10:00:00Z' });
export const profiles: Record<string, ReturnType<typeof initial>> = { [OWNER]: initial(OWNER, 'Avery Lane', 'avery_lane'), [CREATOR]: initial(CREATOR, 'Jordan Ellis', 'jordan_ellis'), [SECOND]: initial(SECOND, 'Casey Morgan', 'casey_morgan') };
export const posts = [
  { post_id: '20000000-0000-4000-8000-000000000001', author_id: CREATOR, content: 'A slower morning on the coast. A few moments from a place I keep coming back to.', author_name: 'Jordan Ellis', author_username: 'jordan_ellis', media: [{ id: 'media-1', url: '/coast.svg', media_type: 'image', width: 1200, height: 720, sort_order: 0 }] },
  { post_id: '20000000-0000-4000-8000-000000000002', author_id: OWNER, content: 'Make something that matters to you. Then share a little of the process.', author_name: 'Avery Lane', author_username: 'avery_lane', media: [] },
].map((row, index) => ({ body: null, media_url: null, products: [], link: null, channel: null, article_title: null, read_minutes: null, quoted_post_id: null, thread_parent_id: null, created_at: new Date(Date.now() - (index + 1) * 3600000).toISOString(), likes_count: 42 + index, comments_count: 8, reposts_count: 3, bookmarks_count: 5, views_count: 130, is_trending: false, author_avatar: null, author_verified: false, author_kind: 'personal', author_verified_tier: null, viewer_liked: false, viewer_bookmarked: false, viewer_reposted: false, viewer_follows: false, sort_key: 10 - index, innovation_field: null, innovation_stage: null, ...row } as FeedRow));
let owner: string | null = OWNER;
const listeners = new Set<(event: string, value: ReturnType<typeof session>) => void>();
const user = () => owner ? { id: owner, email: 'synthetic@example.invalid', email_confirmed_at: '2026-01-02T10:00:00Z' } : null;
const session = () => owner ? { user: user(), access_token: 'synthetic-only-no-live-access' } : null;
const receipt: FixtureRow[] = [];
const faults = { profileRead: false, profileWrite: false, authRead: false, signOut: false, discovery: false, dm: false, peopleRead: false, socialWrite: false, delayWrite: 0 };
const conversations = [{ id: 'conversation-fixture', user_1: OWNER, user_2: CREATOR, is_group: false, context: 'personal', last_message: 'A few moments from the coast.', last_message_time: new Date().toISOString() }];
const messages = [{ id: '30000000-0000-4000-8000-000000000001', conversation_id: 'conversation-fixture', sender_id: CREATOR, receiver_id: OWNER, text: 'A few moments from the coast.', media_url: '/coast.svg', media_type: 'image', reply_to_id: null, created_at: new Date().toISOString() }, { id: '30000000-0000-4000-8000-000000000002', conversation_id: 'conversation-fixture', sender_id: OWNER, receiver_id: CREATOR, text: 'The light is beautiful. Thanks for sharing these.', media_url: null, media_type: null, reply_to_id: null, created_at: new Date(Date.now() + 1000).toISOString() }];
const community = { id: 'community-fixture', name: 'City Walks', description: 'Share routes, small discoveries and the people who make a city.', icon_url: null, cover_color: 'sky', category: null, rules: 'Be respectful. Share original work. Keep conversations on topic.', join_mode: 'open', member_count: 128, is_member: true, my_role: 'owner', my_status: 'active', has_pending: false };
const channel = { id: 'channel-fixture', name: 'Field Notes', description: 'Updates from the creative process.', icon_url: null, member_count: 64, is_member: true, my_role: 'owner', owner_username: 'avery_lane', audience: 'everyone', replies_enabled: true, my_notification_level: 'all' };
const uploads = new Map<string, string>();
const books = Object.keys(profiles).flatMap((profileId, ownerIndex) => ['Postcards', 'City notes', 'Small wins', 'Weekend journal'].map((title, index):MemoryAlbum => {
 const pages=Array.from({length:index+3},(_,n)=>({id:`page-${ownerIndex}-${index}-${n}`,story_id:`60000000-0000-4000-8000-${String(ownerIndex*100+index*10+n+1).padStart(12,'0')}`,media_type:'image',media_url:'/coast.svg',thumbnail_url:null,caption:'A memory to keep',taken_at:'2026-08-01T12:00:00Z',sort_order:n}));
 return {id:`70000000-0000-4000-8000-${String(ownerIndex*10+index+1).padStart(12,'0')}`,user_id:profileId,is_owner:true,can_view:true,title,subtitle:'PLACES · PEOPLE · STORIES',cover_color:['#d4c2a0','#27496c','#c7b49c','#586756'][index],cover_design:['postcard','editorial','field_notes','botanical'][index],audience:index===3?'only_me':'profile',count:pages.length,pages,cover_story_id:pages[0].story_id,cover_page:pages[0],presentation_revision:0,cover_artwork:memoryCoverArtwork(),film_settings:memoryFilmSettings()};
}));
const hiddenProfiles=new Set<string>();
type NavigationRead = 'feed' | 'conversations' | 'messages' | 'profile-posts' | 'books';
const navigationHolds = new Map<NavigationRead, { promise: Promise<void>; release: () => void }>();
async function waitNavigationRead(kind: NavigationRead, signal?: AbortSignal) {
  const hold = navigationHolds.get(kind);
  if (!hold) return;
  const item = { operation: 'heldNavigationRead', kind, startedAt: performance.now(), finishedAt: 0, aborted: false };
  receipt.push(item);
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([hold.promise, new Promise<void>(resolve => {
      onAbort = () => { item.aborted = true; resolve(); };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    })]);
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    item.finishedAt = performance.now();
  }
}
export const fixture = { receipt, faults, profiles, books, owner: () => owner,
  switchOwner(id: string | null) { owner = id; listeners.forEach(listener => listener(id ? 'SIGNED_IN' : 'SIGNED_OUT', session())); window.dispatchEvent(new Event('fixture-owner')); },
  refreshToken() { listeners.forEach(listener => listener('TOKEN_REFRESHED', session())); },
  clear() { receipt.length = 0; },
  hideProfile(profileId:string) { hiddenProfiles.add(profileId); },
  renameBook(profileId:string,title:string) { const book=books.find(book=>book.user_id===profileId)!;book.title=title;book.presentation_revision!++;notifyMemoryBookShelfChanged(profileId); },
  holdNavigationReads(kinds: NavigationRead[]) {
    for (const kind of kinds) if (!navigationHolds.has(kind)) {
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      navigationHolds.set(kind, { promise, release });
    }
  },
  releaseNavigationReads(kinds: NavigationRead[]) {
    for (const kind of kinds) { navigationHolds.get(kind)?.release(); navigationHolds.delete(kind); }
  },
  prepareNavigationRows() {
    if (posts.length > 2) return;
    for (let index = 3; index <= 16; index++) posts.push({ ...posts[1],
      post_id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      content: `Warm navigation post ${index}. This is a synthetic retained feed row.`,
      created_at: new Date(Date.now() - index * 3600000).toISOString() });
    messages.unshift(...Array.from({ length: 32 }, (_, index) => ({ ...messages[1],
      id: `30000000-0000-4000-8000-${String(index + 3).padStart(12, '0')}`,
      sender_id: index % 2 ? OWNER : CREATOR, receiver_id: index % 2 ? CREATOR : OWNER,
      text: `Retained conversation line ${index + 1}. A synthetic history row for scroll restoration.`,
      created_at: new Date(Date.now() - (40 - index) * 60_000).toISOString() })));
  },
};
declare global { interface Window { __socialFixture: typeof fixture } }
if (typeof window !== 'undefined') window.__socialFixture = fixture;
class Query implements PromiseLike<QueryResult> {
  filters: [string, string, unknown][] = []; cols = '*'; options: QueryOptions = {}; one = false; operation = 'select'; values: FixtureRow = {}; maximum = Infinity;
  headers = new Map<string, string>(); signal?: AbortSignal;
  constructor(public table: string) {}
  select(cols = '*', options: QueryOptions = {}) { this.cols = cols; this.options = options; return this; }
  update(value: FixtureRow) { this.operation = 'update'; this.values = value; return this; }
  insert(value: FixtureRow) { this.operation = 'insert'; this.values = value; return this; }
  upsert(value: FixtureRow) { this.operation = 'upsert'; this.values = value; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(key: string, value: unknown) { this.filters.push(['eq', key, value]); return this; }
  neq(key: string, value: unknown) { this.filters.push(['neq', key, value]); return this; }
  ilike(key: string, value: unknown) { this.filters.push(['ilike', key, value]); return this; }
  in(key: string, value: unknown) { this.filters.push(['in', key, value]); return this; }
  is() { return this; } gte() { return this; } gt() { return this; } lt() { return this; } lte() { return this; } or() { return this; }
  order() { return this; } limit(count: number) { this.maximum = count; return this; } range() { return this; }
  abortSignal(signal: AbortSignal) { this.signal = signal; return this; }
  setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); return this; }
  single() { this.one = true; return this; } maybeSingle() { this.one = true; return this; }
  async execute(): Promise<QueryResult> {
    if (this.signal?.aborted) return { data: null, count: null, error: { message: 'Synthetic request cancelled' } };
    const requestedOwner = owner;
    if (this.operation === 'select' && this.cols === '*' && (this.table === 'conversations' || this.table === 'messages')) {
      await waitNavigationRead(this.table, this.signal);
      if (this.signal?.aborted) return { data: null, count: null, error: { message: 'Synthetic request cancelled' } };
    }
    if (this.table === 'conversations' && this.operation === 'select' && this.cols === '*') receipt.push({ table: this.table, operation: 'select', authorizationPinned: this.headers.get('authorization') === `Bearer ${session()?.access_token}`, cancellable: !!this.signal });
    let rows: FixtureRow[] = this.table === 'conversations' ? conversations : this.table === 'messages' ? messages : this.table === 'profiles' ? Object.values(profiles) : this.table === 'posts' ? posts.map(row => ({ ...row, id: row.post_id, user_id: row.author_id })) : [];
    for (const [op, key, value] of this.filters) rows = rows.filter(row => op === 'eq' ? row[key] === value : op === 'neq' ? row[key] !== value : op === 'in' ? Array.isArray(value) && value.includes(row[key]) : op === 'ilike' ? String(row[key]).toLowerCase().startsWith(String(value).replace(/[%\\]/g, '').toLowerCase()) : true);
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
  then<A = QueryResult, B = never>(onFulfilled?: ((value: QueryResult) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> { return this.execute().then(onFulfilled, onRejected); }
}
const client = {
  auth: {
    getSession: async () => ({ data: { session: session() }, error: null }),
    getUser: async () => faults.authRead ? ({ data: { user: null }, error: { message: 'Synthetic account read failure' } }) : ({ data: { user: user() }, error: null }),
    onAuthStateChange(callback: (event: string, value: ReturnType<typeof session>) => void) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
    async signOut() { receipt.push({ operation: 'signOut' }); if (faults.signOut) return { error: { message: 'Synthetic sign-out failure' } }; fixture.switchOwner(null); return { error: null }; },
  },
  from: (table: string) => new Query(table),
  rpc(name: string, args: FixtureRow = {}) {
    const request: FixtureRow = { rpc: name, args, owner };
    receipt.push(request);
    let data: unknown = [], error: FixtureError | null = null;
    if (name === 'get_feed' || name === 'get_discover_page') data = posts;
    else if (name === 'get_communities_page') data = community.name.toLowerCase().includes(String(args.p_query || '').toLowerCase()) ? [community] : [];
    else if (name === 'get_channels_page') data = channel.name.toLowerCase().includes(String(args.p_query || '').toLowerCase()) ? [channel] : [];
    else if (name === 'get_community') data = { ...community, id: args.p_community };
    else if (name === 'get_channel_detail') data = { ...channel, id: args.p_channel };
    else if (name === 'get_community_members_page' || name === 'get_channel_members_page') data = [{ user_id: OWNER, full_name: 'Avery Lane', username: 'avery_lane', avatar_url: null, role: 'owner', status: 'active', notification_level: 'all' }];
    else if (name === 'create_community' || name === 'create_channel') { data = faults.socialWrite ? null : name === 'create_community' ? CREATED_COMMUNITY : CREATED_CHANNEL; if (faults.socialWrite) error = {message:'Synthetic create failure'}; }
    else if (name === 'update_community_settings' || name === 'update_channel_settings') { if(faults.socialWrite) error = {message:'Synthetic settings failure'}; else { const record: FixtureRow = name === 'update_community_settings' ? community : channel; for(const [key,value] of Object.entries(args)) if(!['p_community','p_channel'].includes(key)) record[key.slice(2)] = value; } }
    else if (name === 'get_community_conversation') data = 'community-conversation-fixture';
    else if (name === 'post_channel_poll' && faults.socialWrite) error = {message:'Synthetic poll failure'};
    else if (name === 'get_profile_posts_page') data = hiddenProfiles.has(String(args.p_profile_id))&&args.p_profile_id!==owner?[]:posts.filter(post => post.author_id === args.p_profile_id).slice(Number(args.p_offset??0),Number(args.p_offset??0)+Number(args.p_limit??20)).map(row=>({...row}));
    else if (name === 'get_feed_visibility') data = (Array.isArray(args.p_ids) ? args.p_ids : []).map((id: string) => ({ post_id: id, snapshot_eligible: true }));
    else if (name === 'get_trending_topics') { data = [{ topic: 'CreativeProcess', post_count: 140 }, { topic: 'CoastalStories', post_count: 82 }, { topic: 'SmallMoments', post_count: 58 }]; if (faults.discovery) error = { message: 'Synthetic discovery failure' }; }
    else if (name === 'get_memory_albums') data = {is_owner:args.p_owner===owner,books:books.filter(book=>book.user_id===args.p_owner&&(args.p_owner===owner||(!hiddenProfiles.has(String(args.p_owner))&&book.audience==='profile'))).map(book=>({...book,is_owner:book.user_id===owner}))};
    else if (name === 'get_memory_book') { const book=books.find(book=>book.id===args.p_album);data=book?{...book,is_owner:book.user_id===owner,can_view:book.user_id===owner||book.audience==='profile'}:null; }
    else if (name === 'get_memory_book_creative_capabilities') data={version:1,supported:true};
    else if (name === 'save_memory_book_creative_presentation') {
      const book=books.find(book=>book.id===args.p_album);
      if(!book||book.user_id!==owner||book.presentation_revision!==args.p_expected_revision){data=null;error={message:'MEMORY_BOOK_CHANGED'};}
      else {Object.assign(book,{title:args.p_title,subtitle:args.p_subtitle,cover_color:args.p_cover_color,cover_design:args.p_cover_design,cover_story_id:args.p_cover_story_id,cover_artwork:args.p_cover_artwork,film_settings:args.p_film_settings,audience:args.p_audience,presentation_revision:book.presentation_revision!+1});data={id:book.id,presentation_revision:book.presentation_revision,cover_artwork:book.cover_artwork,film_settings:book.film_settings};}
    }
    else if (name === 'get_profile_insights') data = { views_7d: 12, views_30d: 36 };
    else if (name === 'get_profile_context') data = { mutual_names: [], mutual_count: 0, shared_communities: [] };
    else if (name === 'search_people_page') { data = Object.values(profiles).filter(person => (person.full_name + person.username).toLowerCase().includes(String(args.p_q).toLowerCase())); if(faults.peopleRead) error = {message:'Synthetic people read failure'}; }
    else if (name === 'start_dm_ctx') { data = 'conversation-fixture'; if (faults.dm) error = { message: 'Synthetic conversation failure' }; }
    else if (name === 'handle_follow_action') data = { action: 'followed' };
    let signal: AbortSignal | undefined;
    const result = Object.assign(Promise.resolve().then(async () => {
      if (name === 'get_feed') await waitNavigationRead('feed', signal);
      if (name === 'get_profile_posts_page') await waitNavigationRead('profile-posts', signal);
      if (name === 'get_memory_albums') await waitNavigationRead('books', signal);
      return signal?.aborted ? { data: null, error: { message: 'Synthetic request cancelled' } } : { data, error };
    }), {
      abortSignal(value: AbortSignal) { signal = value; request.cancellable = true; return result; },
      setHeader(header: string, value: string) { if (header.toLowerCase() === 'authorization') request.authorizationPinned = value === `Bearer ${session()?.access_token}`; return result; },
    }); return result;
  },
  functions: { invoke: async () => ({ data: null, error: null }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe: async () => {} }),
  removeChannel: async () => {},
  storage: { from: (bucket: string) => ({
    upload: async (key: string, file: File) => { receipt.push({ operation: 'upload', bucket, key, owner }); uploads.set(key, URL.createObjectURL(file)); return { data: { path: key }, error: null }; },
    getPublicUrl: (key: string) => ({ data: { publicUrl: uploads.get(key) ?? '/coast.svg' } }),
    createSignedUrl: async (key: string) => ({ data: { signedUrl: uploads.get(key) ?? '/coast.svg' }, error: null }),
  }) },
};
export const createClient = () => client as unknown as SupabaseClient;
export const getServerViewer = async () => ({ user: user() });
export const hydratePostMedia = async <T,>(rows: T[]) => rows;
export const hydrateStoryMedia = hydratePostMedia;
export const hydrateStoryDraftMedia = hydratePostMedia;
export const hydrateMemoryAlbumMedia = hydratePostMedia;
export const hydrateHighlightMedia = hydratePostMedia;
export const hydrateUploadMedia = hydratePostMedia;
export const hydrateSoundMedia = hydratePostMedia;
