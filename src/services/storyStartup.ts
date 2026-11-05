import { supabase } from './supabase';
import type { CatchupUser } from './storiesService';
import type { StartupStory } from './startupContentSnapshots';

/** Resolve exact expiry once for the visible tray, after it is already painted. */
export async function readStoryStartup(rows: CatchupUser[]): Promise<StartupStory[]> {
  const selected = rows.slice(0, 30);
  const ids = [...new Set(selected.map(row => row.latest_story_id).filter(Boolean))];
  if (!ids.length) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const { data, error } = await supabase.from('stories').select('id,expires_at').in('id', ids).abortSignal(controller.signal);
    if (error || !Array.isArray(data)) throw error || new Error('Story expiry unavailable.');
    const expires = new Map(data.filter(row => typeof row.id === 'string' && typeof row.expires_at === 'string'
      && Date.parse(row.expires_at) > Date.now()).map(row => [row.id, row.expires_at as string]));
    return selected.filter(row => expires.has(row.latest_story_id)).map(row => ({ ...row, latest_story_expires_at: expires.get(row.latest_story_id)! }));
  } finally { clearTimeout(timeout); }
}
