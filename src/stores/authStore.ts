import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { showMessage } from 'react-native-flash-message';
import { supabase, setCachedUserId } from '../services/supabase';
import { registerForPushNotifications, lastPushToken } from '../services/notificationBootstrap';
import type { Profile } from '../types';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  initialized: boolean;
  isVerifiedSchoolUser: boolean;
  isPasswordRecovery: boolean;
  suppressRecoveryRedirect: boolean;
  recoveryUrl: string | null;

  initialize: () => Promise<void>;
  healProfile: () => Promise<void>;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setPasswordRecovery: (v: boolean) => void;
  setSuppressRecoveryRedirect: (v: boolean) => void;
  setRecoveryUrl: (url: string | null) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

let authListenerHandle: { subscription: { unsubscribe: () => void } } | null = null;

let openedViaVerificationLink = false;

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
  if (data) { AsyncStorage.setItem('pc-profile-cache', JSON.stringify(data)).catch(() => {}); }
  return (data ?? null) as Profile | null;
}

function getVerifiedStatus(profile: Profile | null): boolean {
  return !!(profile as any)?.is_verified_school_user;
}

async function checkInitialUrl(): Promise<{ isRecovery: boolean; isVerification: boolean; url: string | null }> {
  try {
    const url = await Linking.getInitialURL();
    if (!url) return { isRecovery: false, isVerification: false, url: null };

    console.log('[authStore] Initial URL:', url);

    if (url.includes('type=recovery')) {
      return { isRecovery: true, isVerification: false, url };
    }
    if (url.includes('auth/callback')) {
      return { isRecovery: false, isVerification: true, url };
    }
  } catch (e) {
    console.log('[authStore] checkInitialUrl error:', e);
  }
  return { isRecovery: false, isVerification: false, url: null };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  loading: true,
  initialized: false,
  isVerifiedSchoolUser: false,
  isPasswordRecovery: false,
  suppressRecoveryRedirect: false,
  recoveryUrl: null,

  initialize: async () => {
    try {
      set({ loading: true });

      try { consumedRecoveryUrl = await AsyncStorage.getItem('pc-consumed-recovery'); } catch {}
      const { isRecovery, isVerification, url } = await checkInitialUrl();

      if (isRecovery && url !== consumedRecoveryUrl) {
        console.log('[authStore] Password recovery link detected');
        set({ isPasswordRecovery: true, recoveryUrl: url });
      }
      if (isVerification) {
        console.log('[authStore] Verification link detected');
        openedViaVerificationLink = true;
      }

      const { data: { session } } = await Promise.race([supabase.auth.getSession(), new Promise<any>((res) => setTimeout(() => { console.log('[authStore] getSession() hung - proceeding without'); res({ data: { session: null } }); }, 6000))]);

      let profile: Profile | null = null;
      if (session?.user?.id) {
        try {
          const cachedRaw = await AsyncStorage.getItem('pc-profile-cache');
          if (cachedRaw) { const cp = JSON.parse(cachedRaw); if (cp?.id === session.user.id) { profile = cp; console.log('[authStore] shell opens on cached profile'); } }
        } catch {}
        if (profile) {
          loadProfile(session.user.id).then((p) => { if (p) set({ profile: p, isVerifiedSchoolUser: getVerifiedStatus(p) }); }).catch(() => {});
        } else {
          profile = await Promise.race([loadProfile(session.user.id), new Promise<any>((res) => setTimeout(() => { console.log('[authStore] profile load timed out - healing in background'); res(null); }, 8000))]);
          if (!profile) { loadProfile(session.user.id).then((p) => { if (p) set({ profile: p, isVerifiedSchoolUser: getVerifiedStatus(p) }); }).catch(() => {}); }
        }
        setCachedUserId(session.user.id);
        supabase.from('user_presence').upsert({
          user_id: session.user.id,
          is_online: true,
          last_seen: new Date().toISOString(),
        // @ts-ignore
}).then(() => {}).catch(() => {});

        registerForPushNotifications(session.user.id).catch((e) =>
          console.log('[authStore] push token registration failed:', e)
        );
        try {
          // The REAL orchestrator: the toolkit exports setup() and
          // registerVoipToken() - no bootstrap ever existed. Wire both:
          // CallKit listeners armed, PushKit token saved via the upsert
          // that accepts a null expo token by design.
          const { nativeCallService } = require('../services/nativeCallService');
          if (nativeCallService) {
            console.log('[voip] bootstrap invoked');
            Promise.resolve(nativeCallService.setup({
              onAnswer: (uuid: string) => console.log('[voip] answerCall', uuid),
              onEnd: (uuid: string) => console.log('[voip] endCall', uuid),
              onAudioSessionActivated: () => console.log('[voip] audio session active'),
            })).catch((e: any) => console.log('[voip] setup error', e?.message));
            nativeCallService.registerVoipToken((tok: string) => {
              console.log('[voip] token', String(tok).slice(0, 12));
              supabase.rpc('save_voip_token', { p_expo_token: null, p_voip_token: tok })
                .then(({ error }: any) => { if (error) console.log('[voip] save error', error.message); });
            });
          }
        } catch (e: any) { console.log('[voip] bootstrap require failed', e?.message); }
      }

      set({
        session: session ?? null,
        profile,
        isVerifiedSchoolUser: getVerifiedStatus(profile),
        loading: false,
        initialized: true,
      });

      authListenerHandle?.subscription?.unsubscribe();

      const { data } = supabase.auth.onAuthStateChange((event, newSession) => { setTimeout(async () => {
        console.log('[authStore] event:', event);

        if (get().suppressRecoveryRedirect) {
          if (event === 'SIGNED_OUT' || !newSession) {
            console.log('[authStore] Suppressed recovery: SIGNED_OUT, clearing all state');
            setCachedUserId(null);
            set({
              session: null,
              profile: null,
              isVerifiedSchoolUser: false,
              isPasswordRecovery: false,
              suppressRecoveryRedirect: false,
              recoveryUrl: null,
            });
            return;
          }
          console.log('[authStore] Suppressed recovery event:', event);
          return;
        }

        if (event === 'PASSWORD_RECOVERY') {
          console.log('[authStore] PASSWORD_RECOVERY event fired');
          set({ session: newSession, isPasswordRecovery: true });
          return;
        }

        if (event === 'SIGNED_OUT' || !newSession) {
          setCachedUserId(null);
          set({
            session: null,
            profile: null,
            isVerifiedSchoolUser: false,
            isPasswordRecovery: false,
            suppressRecoveryRedirect: false,
            recoveryUrl: null,
          });
          return;
        }

        if (get().isPasswordRecovery) {
          // Recovery jail must not starve the profile: load it here so the
          // moment the flag clears the navigator has everything it needs.
          const rp = get().profile ?? await loadProfile(newSession.user.id);
          setCachedUserId(newSession.user.id);
          set({ session: newSession, profile: rp, isVerifiedSchoolUser: getVerifiedStatus(rp) });
          return;
        }

        // ── CRITICAL FIX: Batch session + profile into ONE set() call ──
        // Previously this was two separate set() calls:
        //   set({ session: newSession })  ← triggered AppNavigator re-render
        //   ... await loadProfile ...
        //   set({ profile: p })           ← triggered ANOTHER re-render
        //
        // Now: load profile FIRST, then update everything in one atomic call.
        // This prevents intermediate states where session is new but profile is stale,
        // which caused navigation flicker and Android tab resets.

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (event === 'SIGNED_IN' && openedViaVerificationLink) {
            openedViaVerificationLink = false;
            showMessage({
              message: 'Email verified',
              description: 'Your account is ready. Welcome to PlatinumCircles!',
              type: 'success',
              duration: 4000,
            });
          }


          // Load profile BEFORE updating state
          const p = await loadProfile(newSession.user.id);
          setCachedUserId(newSession.user.id);

          // Single atomic state update
          set({
            session: newSession,
            profile: p,
            isVerifiedSchoolUser: getVerifiedStatus(p),
          });

          // Fire-and-forget side effects (do not trigger state changes)
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            supabase.from('user_presence').upsert({
              user_id: newSession.user.id,
              is_online: true,
              last_seen: new Date().toISOString(),
            // @ts-ignore
}).then(() => {}).catch(() => {});

            registerForPushNotifications(newSession.user.id).catch((e) =>
              console.log('[authStore] push token re-registration failed:', e)
            );
          }
        } else {
          // For any other event, just update session
          set({ session: newSession });
        }
      }, 0); });
      authListenerHandle = data;

      Linking.addEventListener('url', ({ url }) => {
        if (url && url.includes('type=recovery') && url !== consumedRecoveryUrl) {
          console.log('[authStore] Warm-start recovery URL detected:', url);
          set({ isPasswordRecovery: true, recoveryUrl: url });
        }
      });
    } catch (error) {
      console.log('[authStore.initialize]', error);
      set({
        session: null,
        profile: null,
        loading: false,
        initialized: true,
        isVerifiedSchoolUser: false,
      });
    }
  },

  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile, isVerifiedSchoolUser: getVerifiedStatus(profile) }),
  setPasswordRecovery: (v) => { set({ isPasswordRecovery: v }); /* self-heal */ if (!v) { const s = get().session; if (s?.user?.id && !get().profile) { loadProfile(s.user.id).then((p) => set({ profile: p, isVerifiedSchoolUser: getVerifiedStatus(p) })).catch(() => {}); } } },
  setSuppressRecoveryRedirect: (v) => set({ suppressRecoveryRedirect: v }),
  setRecoveryUrl: (url) => set({ recoveryUrl: url }),
  markRecoveryConsumed: (url: string) => { consumedRecoveryUrl = url; AsyncStorage.setItem('pc-consumed-recovery', url).catch(() => {}); },

  healProfile: async () => {
    const s = get().session;
    if (!s?.user?.id) return;
    try {
      const p = await loadProfile(s.user.id);
      if (p) set({ profile: p, isVerifiedSchoolUser: getVerifiedStatus(p) });
    } catch {}
  },

  signOut: async () => {
    const uid = get().session?.user?.id;
    try {
      if (uid && lastPushToken) {
        const { pushTokenService } = await import('../services/pushTokenService');
        await pushTokenService.removeToken(uid, lastPushToken);
      }
    } catch (e) { console.log('[signOut] token removal:', e); }
    try {
      if (uid) {
        await supabase.from('user_presence').upsert({
          user_id: uid,
          is_online: false,
          last_seen: new Date().toISOString(),
        });
      }
      setCachedUserId(null);
      set({ suppressRecoveryRedirect: false });
      AsyncStorage.removeItem('pc-profile-cache').catch(() => {});
      await supabase.auth.signOut();
    } catch (error) {
      console.log('[authStore.signOut]', error);
    } finally {
      set({
        session: null,
        profile: null,
        isVerifiedSchoolUser: false,
        isPasswordRecovery: false,
        suppressRecoveryRedirect: false,
        recoveryUrl: null,
      });
    }
  },

  refreshProfile: async () => {
    const uid = get().session?.user?.id;
    if (!uid) {
      set({ profile: null, isVerifiedSchoolUser: false });
      return;
    }
    const p = await loadProfile(uid);
    set({ profile: p, isVerifiedSchoolUser: getVerifiedStatus(p) });
  },
}));