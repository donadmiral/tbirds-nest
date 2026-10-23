import { hydratePostMedia } from './contentMedia';
import type { FeedRow } from './feed';
import type { FeedSeed } from './homeFeedController';
import { withTimeout } from './withTimeout';
import type { SupabaseClient } from '@supabase/supabase-js';
import { replaceContentMedia } from '../../shared/contentMedia';

/** Start feed and preferences together. Optional panels never delay first content. */
export async function loadInitialFeed(supabase: SupabaseClient, owner: string): Promise<FeedSeed> {
  const started = performance.now();
  try {
    const [feed, preferences] = await withTimeout(Promise.all([
      supabase.rpc('get_feed', { p_mode: 'for_you', p_cursor_key: null, p_cursor_id: null, p_limit: 20 }),
      supabase.from('profiles').select('muted_words').eq('id', owner).maybeSingle(),
    ]), 5_000);
    if (feed.error || preferences.error) throw feed.error ?? preferences.error;
    const mutedWords = ((preferences.data?.muted_words ?? []) as unknown[]).filter((word): word is string => typeof word === 'string');
    const raw = (feed.data ?? []) as FeedRow[];
    let rows: FeedRow[], error: string | null = null;
    try { rows = await withTimeout(hydratePostMedia(raw, supabase), 5_000); }
    catch {
      // Keep authorized text usable while the signer recovers. Never fall back to a public bucket URL.
      rows = replaceContentMedia(raw, process.env.NEXT_PUBLIC_SUPABASE_URL!, new Map())
        .map(row => ({ ...row, media: (row.media ?? []).filter(item => typeof item.url === 'string' && item.url.length > 0) }));
      error = 'Some media could not load. Please try again.';
    }
    console.info(JSON.stringify({ event: 'platinum.feed.initial', durationMs: Math.round(performance.now() - started), rows: rows.length, outcome: error ? 'media_error' : 'ok' }));
    return { owner, rows, mutedWords, error };
  } catch {
    console.info(JSON.stringify({ event: 'platinum.feed.initial', durationMs: Math.round(performance.now() - started), rows: 0, outcome: 'error' }));
    return { owner, rows: [], mutedWords: [], error: 'Your feed could not load yet. Please try again.' };
  }
}
