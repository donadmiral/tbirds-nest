import type { CatchupUser } from './stories';
import { getNavigationStore } from './navigationCache';
import { createClient } from './supabase/client';
import { hydrateStoryMedia } from './contentMedia';
import { withTimeout } from './withTimeout';
import { loadTrendingStories } from '../../shared/trendingStories';

export type StoryNavigationMemory = {
  scope: string; owner: string; mode: string; checkedAt: number;
  users: CatchupUser[]; spot: CatchupUser[]; avatar: string | null;
};
const key = (mode: string) => `story-strip:${mode}`;

/** Ring metadata uses the same session lifetime as the feed and message caches. */
export function storyNavigationMemory(mode = 'all'): StoryNavigationMemory | null {
  const store = getNavigationStore(), session = store.getSnapshot();
  const saved = store.cache.read<StoryNavigationMemory>(session.scope, key(mode));
  if (!saved || session.changed || saved.owner !== session.owner || saved.scope !== session.scope) return null;
  const age = Date.now() - saved.checkedAt;
  return age >= 0 && age < 60_000 ? saved : null;
}

export function invalidateStoryNavigation(mode = 'all') {
  const store = getNavigationStore();
  store.cache.remove(store.getSnapshot().scope, key(mode));
}

export async function loadStoryNavigation(mode = 'all', force = false): Promise<StoryNavigationMemory> {
  if (!force) { const saved = storyNavigationMemory(mode); if (saved) return saved; }
  const store = getNavigationStore(), client = createClient();
  const initial = store.getSnapshot();
  // Early avatars can mount before the shared Auth bootstrap resolves.
  if (!initial.initialized) await withTimeout(client.auth.getSession(), 12_000);
  const session = store.getSnapshot(), scope = session.scope, owner = session.owner;
  if (!scope || !owner || session.changed || (initial.initialized && initial.scope !== scope)) throw new Error('Sign in to load stories.');
  return store.cache.load(scope, key(mode), async signal => {
    const check = () => {
      if (signal.aborted || store.getSnapshot().scope !== scope) throw new Error('The story account changed.');
    };
    check();
    const { data: auth, error: authError } = await client.auth.getSession();
    check();
    if (authError || auth.session?.user.id !== owner || !auth.session.access_token) throw new Error('The story account could not be verified.');
    const token = auth.session.access_token;
    const caught = await client.rpc('get_catchup_feed', { p_mode: mode, p_limit: 50 })
      .setHeader('Authorization', `Bearer ${token}`).abortSignal(signal);
    check();
    if (caught.error || !Array.isArray(caught.data) || caught.data.some(row => !row || typeof row.user_id !== 'string')) throw new Error('Stories could not be refreshed.');
    const users = caught.data as CatchupUser[];
    const [profile, hot] = await Promise.all([
      client.from('profiles').select('avatar_url').eq('id', owner).setHeader('Authorization', `Bearer ${token}`).abortSignal(signal).maybeSingle(),
      loadTrendingStories({
        session: async () => { check(); return { data: { session: auth.session }, error: null }; },
        ranked: limit => { check(); return client.rpc('get_trending_stories', { p_limit: limit }).setHeader('Authorization', `Bearer ${token}`).abortSignal(signal); },
        stories: ids => { check(); return client.from('stories').select('id,user_id,media_url,thumbnail_url,media_type,expires_at,created_at').in('id', ids).setHeader('Authorization', `Bearer ${token}`).abortSignal(signal); },
      }, rows => hydrateStoryMedia(rows, {
        auth: {
          async getSession() { check(); return { data: { session: auth.session! }, error: null }; },
          async getUser() { check(); const result = await client.auth.getUser(token); check(); return result; },
        },
        functions: {
          async invoke(name, options) {
            check();
            const result = await client.functions.invoke(name, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal });
            check(); return result;
          },
        },
      }), 12).catch(() => []),
    ]);
    check();
    const known = new Set(users.map(row => row.user_id)); known.add(owner);
    return { scope, owner, mode, checkedAt: Date.now(), users,
      avatar: profile.error ? null : profile.data?.avatar_url ?? null,
      spot: hot.filter(row => !known.has(row.user_id)).map(row => ({ user_id: row.user_id, full_name: row.full_name,
        username: row.username, avatar_url: row.avatar_url, story_count: 1, unseen_count: 1,
        latest_story_at: row.created_at!, latest_story_id: row.story_id, has_unseen: true })),
    };
  }, 12_000);
}
