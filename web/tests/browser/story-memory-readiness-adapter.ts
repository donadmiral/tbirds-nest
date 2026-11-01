/** Synthetic Auth/RPC only. Media travels through a real local no-store HTTP server. */
import type { createClient as actualClient } from '../../lib/supabase/client';
import type { MemoryAlbum, MemoryPage } from '../../lib/memoryAlbum';
import type { StoryRow } from '../../lib/stories';

export const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', AUTHOR_TWO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const BOOK = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const picture = (color: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><path fill="${color}" d="M0 0h360v640H0z"/></svg>`);
export const pages: MemoryPage[] = ['a', 'b', 'c'].map((letter, index) => ({
  id: `page-${letter}`, story_id: `${index + 1}1111111-1111-4111-8111-111111111111`, media_type: 'video', media_url: `/media/${letter}.mp4`,
  thumbnail_url: picture(['#9b4938', '#385f9b', '#409b54'][index]), caption: `Memory ${letter.toUpperCase()}`, taken_at: null, sort_order: index,
  duration_sec: 3, media_transform: { fit: 'contain', scale: 1, translateNX: 0, translateNY: 0, trimStart: .4, trimEnd: 2.8, speed: 1, mix: { orig: 100 } },
}));
export const stories: StoryRow[] = pages.map((page, index) => ({ ...page, id: page.story_id!, user_id: OTHER, duration_sec: 3, caption: `Story ${index + 1}`,
  views_count: 0, created_at: '2026-11-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }));
export const book: MemoryAlbum = { id: BOOK, user_id: OWNER, is_owner: true, can_view: true, title: 'Readiness memories',
  subtitle: 'Synthetic fixture', cover_color: '#172840', cover_design: 'night_film', audience: 'only_me', count: pages.length, pages,
  cover_page: { ...pages[0], thumbnail_url: null },
  film_settings: { version: 1, mode: 'original', style: 'reflective', length: 'full', order: 'book', titleCard: false, originalAudio: false } };

type Session = { user: { id: string }; access_token: string };
type Result = { data: unknown; error: unknown };
const listeners = new Set<(event: string, session: Session | null) => void>();
let owner: string | null = OWNER, revision = 0;
const session = (): Session | null => owner ? { user: { id: owner }, access_token: `synthetic-${owner}-${revision}` } : null;
const requests: { name: string; owner: string | null }[] = [];
const held = new Set<string>(), releases: (() => void)[] = [];

function request(name: string, args: Record<string, unknown> = {}, single = false) {
  let signal: AbortSignal | undefined, pending: Promise<Result> | null = null, one = single;
  const execute = async () => {
    const requestedOwner = owner;
    requests.push({ name, owner: requestedOwner });
    if (held.has(name)) await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error('Synthetic request aborted'));
      releases.push(() => { signal?.removeEventListener('abort', abort); resolve(); });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    if (signal?.aborted) throw new Error('Synthetic request aborted');
    if (name === 'get_memory_book') return { data: requestedOwner === OWNER ? structuredClone(book) : null, error: null };
    if (name === 'get_memory_albums') return { data: { is_owner: requestedOwner === OWNER, books: [] }, error: null };
    if (name === 'get_user_stories') return { data: requestedOwner === OWNER ? structuredClone(args.p_user_id === AUTHOR_TWO
      ? [{ ...stories[0], id: '44444444-4444-4444-8444-444444444444', user_id: AUTHOR_TWO, media_url: '/media/d.mp4', caption: 'Second author story' }] : stories) : [], error: null };
    if (name === 'get_story_poll') return { data: null, error: null };
    if (name === 'profiles' && one) return { data: { id: OTHER, full_name: 'Fixture author', username: 'fixture_author', is_verified: false }, error: null };
    return { data: one ? null : [], error: null };
  };
  const query = {
    select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; }, limit() { return query; },
    setHeader() { return query; }, maybeSingle() { one = true; return query; }, single() { one = true; return query; },
    abortSignal(value: AbortSignal) { signal = value; return query; },
    then(yes?: ((result: Result) => unknown) | null, no?: ((error: unknown) => unknown) | null) { pending ??= execute(); return pending.then(yes, no); },
  };
  return query;
}

export function createClient(): ReturnType<typeof actualClient> {
  return {
    auth: { getSession: async () => ({ data: { session: session() }, error: null }), getUser: async () => ({ data: { user: owner ? { id: owner } : null }, error: null }),
      onAuthStateChange: (listener: (event: string, value: Session | null) => void) => { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }; } },
    rpc: (name: string, args?: Record<string, unknown>) => request(name, args), from: (name: string) => request(name),
    functions: { invoke: async () => { throw new Error('This fixture must not issue hosted media capabilities.'); } },
  } as unknown as ReturnType<typeof actualClient>;
}

export const readinessFixture = {
  requests,
  changeAccount(id: string | null) { owner = id; revision++; listeners.forEach(listener => listener(id ? 'SIGNED_IN' : 'SIGNED_OUT', session())); },
  hold(name: string) { held.add(name); },
  release() { held.clear(); releases.splice(0).forEach(release => release()); },
};
