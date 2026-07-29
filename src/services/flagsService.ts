/**
 * flagsService - the app's ear for the operations kill switches.
 * Reads feature_flags with a 60 second cache. FAIL-OPEN: if the read
 * fails or a key is missing, the feature stays ON - a broken flags
 * fetch must never take the app down.
 */
import { supabase } from './supabase';

let cache: Record<string, boolean> | null = null;
let fetchedAt = 0;
const TTL_MS = 60000;

async function load(): Promise<Record<string, boolean>> {
  const now = Date.now();
  if (cache && now - fetchedAt < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('feature_flags').select('key, enabled');
    if (error || !data) return cache ?? {};
    const next: Record<string, boolean> = {};
    data.forEach((r: any) => { next[r.key] = !!r.enabled; });
    cache = next; fetchedAt = now;
    return next;
  } catch {
    return cache ?? {};
  }
}

export const flagsService = {
  async isEnabled(key: string): Promise<boolean> {
    const flags = await load();
    return flags[key] !== false;
  },
};