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

type Counts = { market: number; jobs: number; groups: number; personal: number };

type State = {
  counts: Counts;
  loading: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
};

const EMPTY: Counts = { market: 0, jobs: 0, groups: 0, personal: 0 };

export const useUnreadStore = create<State>((set) => ({
  counts: EMPTY,
  loading: false,

  refresh: async () => {
    set({ loading: true });
    const { data, error } = await supabase.rpc('get_context_unread');
    if (error) {
      console.log('[UNREAD]', error.message);
      set({ loading: false });
      return;
    }
    const c = (data ?? {}) as Partial<Counts>;
    set({
      counts: {
        market: c.market ?? 0,
        jobs: c.jobs ?? 0,
        groups: c.groups ?? 0,
        personal: c.personal ?? 0,
      },
      loading: false,
    });
  },

  clear: () => set({ counts: EMPTY, loading: false }),
}));