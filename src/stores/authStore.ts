import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import type { Profile } from '../types';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  initialized: boolean;
  pendingInstitutionId: string | null;
  initialize: () => Promise<void>;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setPendingInstitutionId: (id: string | null) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

/**
 * Module-level handle to the auth listener. Held outside the store so a
 * hot reload or a second call to initialize() can tear down the previous
 * subscription cleanly instead of stacking listeners.
 */
let authListenerHandle: { subscription: { unsubscribe: () => void } } | null = null;

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    console.log('[authStore.loadProfile]', error.message);
    return null;
  }
  return (data ?? null) as Profile | null;
}

/**
 * Called after sign-in to apply the institution the user picked during
 * sign-up. Idempotent: re-calling with the same id is a no-op on the server.
 */
async function claimPendingInstitution(institutionId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('claim_institution', {
      p_institution_id: institutionId,
      p_relationship_type: 'current',
      p_start_year: null,
      p_end_year: null,
      p_make_primary: true,
    });
    if (error) console.log('[authStore.claimPendingInstitution]', error.message);
  } catch (e) {
    console.log('[authStore.claimPendingInstitution]', e);
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  loading: true,
  initialized: false,
  pendingInstitutionId: null,

  initialize: async () => {
    try {
      set({ loading: true });

      const { data: { session } } = await supabase.auth.getSession();

      let profile: Profile | null = null;
      if (session?.user?.id) {
        profile = await loadProfile(session.user.id);
      }

      set({
        session: session ?? null,
        profile,
        loading: false,
        initialized: true,
      });

      // Clean up any prior listener before installing a new one.
      authListenerHandle?.subscription?.unsubscribe();

      const { data } = supabase.auth.onAuthStateChange(async (event, newSession) => {
        console.log('[authStore] event:', event);

        if (event === 'SIGNED_OUT' || !newSession) {
          set({ session: null, profile: null, pendingInstitutionId: null });
          return;
        }

        set({ session: newSession });

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          // Claim the pending institution the user picked at sign-up.
          const pending = get().pendingInstitutionId;
          if (event === 'SIGNED_IN' && pending && newSession.user?.id) {
            await claimPendingInstitution(pending);
            set({ pendingInstitutionId: null });
          }

          const p = await loadProfile(newSession.user.id);
          set({ profile: p });
        }
      });
      authListenerHandle = data;
    } catch (error) {
      console.log('[authStore.initialize]', error);
      set({
        session: null,
        profile: null,
        loading: false,
        initialized: true,
      });
    }
  },

  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setPendingInstitutionId: (id) => set({ pendingInstitutionId: id }),

  signOut: async () => {
    const uid = get().session?.user?.id;
    try {
      if (uid) {
        await supabase.from('user_presence').upsert({
          user_id: uid,
          is_online: false,
          last_seen: new Date().toISOString(),
        });
      }
      await supabase.auth.signOut();
    } catch (error) {
      console.log('[authStore.signOut]', error);
    } finally {
      set({ session: null, profile: null, pendingInstitutionId: null });
    }
  },

  refreshProfile: async () => {
    const uid = get().session?.user?.id;
    if (!uid) {
      set({ profile: null });
      return;
    }
    const p = await loadProfile(uid);
    set({ profile: p });
  },
}));