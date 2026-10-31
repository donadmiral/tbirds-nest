/**
 * unreadStore
 *
 * One source for the context unread badges. Market, Jobs and Messages all show
 * counts from the same data, and three independent queries would disagree with
 * each other within seconds.
 *
 * Deliberately not realtime yet: refreshed on focus and after reading a thread.
 * A realtime subscription here would fire on every message in the app, which is
 * a lot of traffic for four numbers.
 */
import { create } from 'zustand';
import { supabase } from '../services/supabase';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from './authStore';
import { navigationCache, navigationScope, subscribeNavigationScope } from '../lib/navigationCache';

type Counts = { market: number; jobs: number; groups: number; personal: number };

type State = {
  counts: Counts;
  loading: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
};

const EMPTY: Counts = { market: 0, jobs: 0, groups: 0, personal: 0 };
const KEYS = ['market', 'jobs', 'groups', 'personal'] as const;
let generation = 0;
let pending: { scope: string; promise: Promise<void> } | null = null;
let badgeWrites = Promise.resolve();

function updateBadge(count: number, scope: string | null, version: number) {
  // Serialize native writes so a late old-account completion cannot overtake
  // the reset or the next account's badge.
  badgeWrites = badgeWrites.catch(() => {}).then(async () => {
    if (version === generation && scope === navigationScope()) {
      await Notifications.setBadgeCountAsync(Math.min(count, 9999));
    }
  }).catch(() => {});
}

export const useUnreadStore = create<State>((set) => ({
  counts: EMPTY,
  loading: false,

  refresh: () => {
    const scope = navigationScope();
    const session = useAuthStore.getState().session;
    if (!scope || !session) { useUnreadStore.getState().clear(); return Promise.resolve(); }
    if (pending?.scope === scope) return pending.promise;
    const version = generation;
    const current = () => version === generation && scope === navigationScope();
    set({ loading: true });
    const promise = navigationCache.load<Counts>(scope, 'unread:context', async signal => {
      const { data, error } = await supabase.rpc('get_context_unread')
        .setHeader('Authorization', `Bearer ${session.access_token}`).abortSignal(signal);
      if (error || !data || typeof data !== 'object'
        || !KEYS.every(key => Number.isSafeInteger(data[key]) && data[key] >= 0)) {
        throw new Error('Unread counts could not be refreshed.');
      }
      return { market: data.market, jobs: data.jobs, groups: data.groups, personal: data.personal };
    }).then(counts => {
      if (!current()) return;
      set({ counts, loading: false });
      updateBadge(counts.personal + counts.groups, scope, version);
    }).catch(() => {
      // An offline or malformed response says nothing about the saved count.
      if (current()) set({ loading: false });
    }).finally(() => { if (pending?.promise === promise) pending = null; });
    pending = { scope, promise };
    return promise;
  },

  clear: () => {
    generation++; pending = null;
    set({ counts: EMPTY, loading: false });
    updateBadge(0, navigationScope(), generation);
  },
}));

subscribeNavigationScope(() => useUnreadStore.getState().clear());
