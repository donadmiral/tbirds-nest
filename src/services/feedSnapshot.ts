import AsyncStorage from '@react-native-async-storage/async-storage';
import { createFeedSnapshotStore, FEED_SNAPSHOT_MAX_AGE, type FeedSnapshot } from '../../shared/feedSnapshot';
import { supabase } from './supabase';
import { useAuthStore } from '../stores/authStore';
import { applyFeedStartupPreviews, clearFeedStartupPreviews, feedStartupPreviews, saveFeedStartupPreviews } from './feedStartupPreviews';

const diskSnapshots = createFeedSnapshotStore(AsyncStorage);
let readRevision = 0;
const reads = new Map<string, { revision: number; promise: Promise<FeedSnapshot | null>; savedAt?: number; value?: FeedSnapshot }>();
const invalidateReads = () => { readRevision++; reads.clear(); };
const withPreviews = (account: string, snapshot: FeedSnapshot | null) => snapshot
  ? { ...snapshot, rows: applyFeedStartupPreviews(account, snapshot.rows) } : null;
const afterPreviewHydration = async (account: string, work: Promise<FeedSnapshot | null>, revision: number) => {
  const [snapshot] = await Promise.all([work, feedStartupPreviews.hydrate(account)]);
  return readRevision === revision ? withPreviews(account, snapshot) : null;
};
export const feedSnapshots = {
  ...diskSnapshots,
  peek(account: string, mode: string): FeedSnapshot | null {
    const entry = reads.get(`${account}:${mode}`);
    return entry?.revision === readRevision && entry.value && Date.now() >= entry.value.savedAt
      && Date.now() - entry.value.savedAt < FEED_SNAPSHOT_MAX_AGE ? withPreviews(account, entry.value) : null;
  },
  setAccount(account: string | null) {
    const before = diskSnapshots.revision();
    diskSnapshots.setAccount(account);
    if (before !== diskSnapshots.revision()) invalidateReads();
  },
  read(account: string, mode: string): Promise<FeedSnapshot | null> {
    if (!['forYou', 'latest', 'trending'].includes(mode)) return Promise.resolve(null);
    const key = `${account}:${mode}`, existing = reads.get(key), revision = readRevision;
    if (existing && existing.revision === revision && (existing.savedAt === undefined
      || (Date.now() >= existing.savedAt && Date.now() - existing.savedAt < FEED_SNAPSHOT_MAX_AGE))) return afterPreviewHydration(account, existing.promise, revision);
    const entry = { revision, promise: Promise.resolve(null) as Promise<FeedSnapshot | null>, savedAt: undefined as number | undefined, value: undefined as FeedSnapshot | undefined };
    entry.promise = diskSnapshots.read(account, mode).then(value => {
      if (readRevision !== revision) return null;
      if (!value) reads.delete(key);
      else { entry.savedAt = value.savedAt; entry.value = value; }
      return value;
    });
    // Only the three active feed modes can remain warm.
    if (reads.size >= 3 && !reads.has(key)) reads.delete(reads.keys().next().value!);
    reads.set(key, entry);
    return afterPreviewHydration(account, entry.promise, revision);
  },
  write(...args: Parameters<typeof diskSnapshots.write>) { invalidateReads(); return diskSnapshots.write(...args); },
  clear(account: string) { invalidateReads(); void clearFeedStartupPreviews(account); return diskSnapshots.clear(account); },
};
export const warmFeedSnapshots = async (account: string) => {
  await Promise.all([feedSnapshots.read(account, 'forYou'), feedStartupPreviews.hydrate(account)]);
  return feedSnapshots.peek(account, 'forYou');
};
const owns = (account: string) => useAuthStore.getState().profile?.id === account;

/** Reconcile all current IDs in batches, at most two requests in flight. */
export async function reconcileFeedVisibility(account: string, ids: string[], isCurrent: () => boolean, signal?: AbortSignal): Promise<Set<string> | null> {
  const unique = [...new Set(ids)];
  const visible = new Set<string>();
  for (let index = 0; index < unique.length; index += 200) {
    if (!isCurrent() || !owns(account) || signal?.aborted) return null;
    const batches = [unique.slice(index, index + 100), unique.slice(index + 100, index + 200)].filter(batch => batch.length);
    const results = await Promise.all(batches.map(batch => {
      const work = supabase.rpc('get_feed_visibility', { p_ids: batch }); return signal ? work.abortSignal(signal) : work;
    }));
    if (!isCurrent() || !owns(account) || signal?.aborted) return null;
    if (results.some(result => result.error)) throw new Error('Could not refresh post visibility. Please try again.');
    results.forEach(result => (result.data ?? []).forEach((row: any) => visible.add(row.post_id)));
  }
  if (unique.some(id => !visible.has(id))) await feedSnapshots.clear(account);
  return visible;
}

/** Eligibility is checked off the display path. Failure never saves new content. */
export async function savePublicFeedSnapshot(account: string, mode: string, rows: any[], isCurrent: () => boolean) {
  if (!isCurrent() || !owns(account) || mode === 'discover') return;
  if (!rows.length) { await feedSnapshots.write(account, mode, [], new Set()); if (mode === 'forYou') await clearFeedStartupPreviews(account); return; }
  const revision = feedSnapshots.revision();
  const candidates = rows.slice(0, 20);
  try {
    const result = await supabase.rpc('get_feed_visibility', { p_ids: candidates.map(row => row.post_id) });
    if (!isCurrent() || !owns(account) || result.error) return;
    const eligible = new Set<string>((result.data ?? []).filter((row: any) => row.snapshot_eligible === true).map((row: any) => row.post_id));
    await feedSnapshots.write(account, mode, candidates, eligible, revision);
    if (mode === 'forYou') void saveFeedStartupPreviews(account, candidates, eligible,
      () => isCurrent() && owns(account) && feedSnapshots.revision() === revision);
  } catch { /* A cache failure must not fail a live feed. */ }
}
