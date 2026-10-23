import AsyncStorage from '@react-native-async-storage/async-storage';
import { createFeedSnapshotStore } from '../../shared/feedSnapshot';
import { supabase } from './supabase';
import { useAuthStore } from '../stores/authStore';

export const feedSnapshots = createFeedSnapshotStore(AsyncStorage);
const owns = (account: string) => useAuthStore.getState().profile?.id === account;

/** Reconcile all current IDs in batches, at most two requests in flight. */
export async function reconcileFeedVisibility(account: string, ids: string[], isCurrent: () => boolean): Promise<Set<string> | null> {
  const unique = [...new Set(ids)];
  const visible = new Set<string>();
  for (let index = 0; index < unique.length; index += 200) {
    if (!isCurrent() || !owns(account)) return null;
    const batches = [unique.slice(index, index + 100), unique.slice(index + 100, index + 200)].filter(batch => batch.length);
    const results = await Promise.all(batches.map(batch => supabase.rpc('get_feed_visibility', { p_ids: batch })));
    if (!isCurrent() || !owns(account)) return null;
    if (results.some(result => result.error)) throw new Error('Could not refresh post visibility. Please try again.');
    results.forEach(result => (result.data ?? []).forEach((row: any) => visible.add(row.post_id)));
  }
  if (unique.some(id => !visible.has(id))) await feedSnapshots.clear(account);
  return visible;
}

/** Eligibility is checked off the display path. Failure never saves new content. */
export async function savePublicFeedSnapshot(account: string, mode: string, rows: any[], isCurrent: () => boolean) {
  if (!isCurrent() || !owns(account) || mode === 'discover') return;
  if (!rows.length) { await feedSnapshots.write(account, mode, [], new Set()); return; }
  const revision = feedSnapshots.revision();
  const candidates = rows.slice(0, 20);
  try {
    const result = await supabase.rpc('get_feed_visibility', { p_ids: candidates.map(row => row.post_id) });
    if (!isCurrent() || !owns(account) || result.error) return;
    const eligible = new Set<string>((result.data ?? []).filter((row: any) => row.snapshot_eligible === true).map((row: any) => row.post_id));
    await feedSnapshots.write(account, mode, candidates, eligible, revision);
  } catch { /* A cache failure must not fail a live feed. */ }
}
