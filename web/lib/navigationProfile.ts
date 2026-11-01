import type { SupabaseClient } from '@supabase/supabase-js';
import { withTimeout } from './withTimeout';

/** Optional chrome must not keep an already authorized page waiting forever. */
export async function loadNavigationProfile(client: SupabaseClient, owner: string, timeoutMs = 5_000) {
  const controller = new AbortController();
  try {
    const result = await withTimeout(client
      .from('profiles')
      .select('full_name,username,account_type,avatar_url,is_verified,verified_tier')
      .eq('id', owner)
      .abortSignal(controller.signal)
      .maybeSingle(), timeoutMs);
    return result.error ? null : result.data;
  } catch {
    // The page still uses getServerViewer's verified identity. Its existing
    // neutral navigation defaults need no profile data or extra permissions.
    return null;
  } finally {
    controller.abort();
  }
}
