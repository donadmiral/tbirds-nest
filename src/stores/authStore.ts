import { useAccountsStore } from './accountsStore';
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
  markRecoveryConsumed: (url: string) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

let authListenerHandle: { subscription: { unsubscribe: () => void } } | null = null;
let recoveryLinkHandle: { remove: () => void } | null = null;
let consumedRecoveryUrl: string | null = null;
let openedViaVerificationLink = false;
let authGeneration = 0;
let signingOut = false;
let profileRequest: { userId: string; generation: number; promise: Promise<Profile | null> } | null = null;

async function withTimeout<T>(work: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), milliseconds); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isCurrent(generation: number): boolean {
  return generation === authGeneration && !signingOut;
}

function getVerifiedStatus(profile: Profile | null): boolean {
  return !!(profile as any)?.is_verified_school_user;
}

function loadProfile(userId: string, generation: number, knownProfile: Profile | null = null): Promise<Profile | null> {
  // ProfileRestore polls while a request is running; share that request instead
  // of starting another fetch every four seconds on a slow connection.
  if (profileRequest?.userId === userId && profileRequest.generation === generation) return profileRequest.promise;
  const promise = (async (): Promise<Profile | null> => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (!isCurrent(generation)) return null;
      if (error) {
        console.log('[authStore.loadProfile]', error.message);
        return knownProfile?.id === userId ? knownProfile : null;
      }
      if (!data) {
        AsyncStorage.removeItem('pc-profile-cache').catch(() => {});
        return null;
      }
      // Signing in reactivates a self-deactivated account. A failed update must
      // not announce success or change the local value.
      if ((data as any).deactivated_at) {
        const { error: activationError } = await supabase.from('profiles').update({ deactivated_at: null }).eq('id', userId);
        if (!isCurrent(generation)) return null;
        if (!activationError) {
          (data as any).deactivated_at = null;
          setTimeout(() => {
            if (isCurrent(generation)) showMessage({ message: 'Welcome back', description: 'Your account is active again.', type: 'success' });
          }, 600);
        }
      }
      if (!isCurrent(generation)) return null;
      AsyncStorage.setItem('pc-profile-cache', JSON.stringify(data)).catch(() => {});
      supabase.auth.getSession().then(({ data: auth }) => {
        if (isCurrent(generation) && auth.session?.user.id === userId) {
          useAccountsStore.getState().remember(auth.session as any, {
            username: (data as any).username,
            full_name: (data as any).full_name,
            avatar_url: (data as any).avatar_url,
          }).catch(() => {});
        }
      }).catch(() => {});
      return data as Profile;
    } catch (error) {
      console.log('[authStore.loadProfile]', error);
      return knownProfile?.id === userId ? knownProfile : null;
    }
  })();
  profileRequest = { userId, generation, promise };
  void promise.finally(() => { if (profileRequest?.promise === promise) profileRequest = null; });
  return promise;
}

async function checkInitialUrl(): Promise<{ isRecovery: boolean; isVerification: boolean; url: string | null }> {
  try {
    const url = await Linking.getInitialURL();
    // Recovery URLs contain credentials; never write them to device logs.
    if (url?.includes('type=recovery')) return { isRecovery: true, isVerification: false, url };
    if (url?.includes('auth/callback')) return { isRecovery: false, isVerification: true, url };
  } catch (error) {
    console.log('[authStore] checkInitialUrl error:', error);
  }
  return { isRecovery: false, isVerification: false, url: null };
}

function registerSession(session: Session, generation: number, setupCalls = false) {
  if (!isCurrent(generation)) return;
  useAccountsStore.getState().remember(session as any).catch(() => {});
  void Promise.resolve(supabase.from('user_presence').upsert({
    user_id: session.user.id, is_online: true, last_seen: new Date().toISOString(),
  })).catch(() => {});
  registerForPushNotifications(session.user.id).catch((error) => console.log('[authStore] push registration failed:', error));
  if (!setupCalls) return;
  try {
    const { nativeCallService } = require('../services/nativeCallService');
    if (!nativeCallService) return;
    Promise.resolve(nativeCallService.setup({
      onAnswer: (uuid: string) => console.log('[voip] answerCall', uuid),
      onEnd: (uuid: string) => console.log('[voip] endCall', uuid),
      onAudioSessionActivated: () => console.log('[voip] audio session active'),
    })).catch((error: any) => console.log('[voip] setup error', error?.message));
    nativeCallService.registerVoipToken((token: string) => {
      // The callback survives token refreshes but must never register a token
      // for an account that has since signed out or switched.
      if (signingOut || useAuthStore.getState().session?.user.id !== session.user.id) return;
      supabase.rpc('save_voip_token', { p_expo_token: null, p_voip_token: token })
        .then(({ error }: any) => { if (error) console.log('[voip] save error', error.message); });
    });
  } catch (error: any) { console.log('[voip] bootstrap require failed', error?.message); }
}

export const useAuthStore = create<AuthState>((set, get) => {
  const clearSession = (resetRecovery = true) => {
    setCachedUserId(null);
    set({
      session: null, profile: null, isVerifiedSchoolUser: false, loading: false, initialized: true,
      ...(resetRecovery ? { isPasswordRecovery: false, suppressRecoveryRedirect: false, recoveryUrl: null } : {}),
    });
  };

  const applySession = async (session: Session, generation: number, cachedProfile: Profile | null = null) => {
    if (!isCurrent(generation)) return;
    const profile = get().profile?.id === session.user.id ? get().profile : cachedProfile;
    setCachedUserId(session.user.id);
    set({ session, profile, isVerifiedSchoolUser: getVerifiedStatus(profile), loading: !profile, initialized: true });
    const pending = loadProfile(session.user.id, generation, profile);
    const applyProfile = (next: Profile | null) => {
      if (isCurrent(generation) && get().session?.user.id === session.user.id) {
        set({ profile: next, isVerifiedSchoolUser: getVerifiedStatus(next), loading: false, initialized: true });
      }
    };
    // The same request heals after the deadline. Never issue a second request
    // merely because the launch budget expired.
    void pending.then(applyProfile);
    if (!profile) applyProfile(await withTimeout(pending, 8000, null));
  };

  return {
    session: null,
    profile: null,
    loading: true,
    initialized: false,
    isVerifiedSchoolUser: false,
    isPasswordRecovery: false,
    suppressRecoveryRedirect: false,
    recoveryUrl: null,

    initialize: async () => {
      if (signingOut) return;
      const generation = ++authGeneration;
      let startupFinished = false;
      let observedSession: Session | null = null;
      const recoverSession = () => {
        if (!startupFinished || !observedSession || !isCurrent(generation) || get().session) return;
        void applySession(observedSession, generation);
        registerSession(observedSession, generation, true);
      };
      let resolveInitialSession!: (session: Session | null) => void;
      const initialSession = new Promise<Session | null>((resolve) => { resolveInitialSession = resolve; });
      set({ loading: true });
      authListenerHandle?.subscription.unsubscribe();
      recoveryLinkHandle?.remove();
      // Subscribe before touching storage/network so sign-out and account
      // changes cannot be missed during launch. Keep the callback synchronous:
      // Supabase auth work is deferred until its internal lock is released.
      const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
        if (event === 'INITIAL_SESSION') {
          if (!isCurrent(generation)) return;
          resolveInitialSession(newSession);
          if (startupFinished && !get().session && newSession) {
            setTimeout(() => {
              if (!isCurrent(generation) || get().session) return;
              void applySession(newSession, generation);
              registerSession(newSession, generation, true);
            }, 0);
          }
          return;
        }
        // Invalidate old reads immediately, before the deferred handler runs.
        const eventGeneration = ++authGeneration;
        if (signingOut) return;
        // Recovery is a navigation gate, not a profile fetch. Preserve it even
        // if a token refresh arrives before this event's deferred work runs.
        if (event === 'PASSWORD_RECOVERY' && newSession && !get().suppressRecoveryRedirect) {
          set({ isPasswordRecovery: true });
        }
        setTimeout(() => {
          if (!isCurrent(eventGeneration)) return;
          if (get().suppressRecoveryRedirect) {
            if (event === 'SIGNED_OUT' || !newSession) clearSession();
            else set({ loading: false, initialized: true });
            return;
          }
          if (event === 'SIGNED_OUT' || !newSession) { clearSession(); return; }
          if (event === 'SIGNED_IN' && openedViaVerificationLink) {
            openedViaVerificationLink = false;
            showMessage({ message: 'Email verified', description: 'Your account is ready. Welcome to PlatinumCircles!', type: 'success', duration: 4000 });
          }
          void applySession(newSession, eventGeneration);
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') registerSession(newSession, eventGeneration, event === 'SIGNED_IN');
        }, 0);
      });
      authListenerHandle = data;
      recoveryLinkHandle = Linking.addEventListener('url', ({ url }) => {
        if (!signingOut && url?.includes('type=recovery') && url !== consumedRecoveryUrl) {
          set({ isPasswordRecovery: true, recoveryUrl: url });
        }
      });
      try {
        // Fetch the session alongside local link/cache metadata, not after it.
        const sessionWork = Promise.race([
          supabase.auth.getSession().then(({ data: auth }) => auth.session), initialSession,
        ]);
        // A slow successful getSession can recover the shell after the launch
        // deadline, but only if no newer auth action has taken place.
        void sessionWork.then((session) => { observedSession = session; recoverSession(); }).catch(() => {});
        const [session, consumed, link] = await Promise.all([
          withTimeout(sessionWork, 6000, null),
          withTimeout(AsyncStorage.getItem('pc-consumed-recovery').catch(() => null), 6000, null),
          withTimeout(checkInitialUrl(), 6000, { isRecovery: false, isVerification: false, url: null }),
        ]);
        if (!isCurrent(generation)) return;
        consumedRecoveryUrl = consumed;
        if (link.isRecovery && link.url !== consumedRecoveryUrl) set({ isPasswordRecovery: true, recoveryUrl: link.url });
        openedViaVerificationLink = link.isVerification;
        if (!session) { clearSession(false); return; }
        let cachedProfile: Profile | null = null;
        try {
          const raw = await withTimeout(AsyncStorage.getItem('pc-profile-cache'), 1000, null);
          const cached = raw ? JSON.parse(raw) : null;
          if (cached?.id === session.user.id) cachedProfile = cached;
        } catch {}
        if (!isCurrent(generation)) return;
        const applied = applySession(session, generation, cachedProfile);
        registerSession(session, generation, true);
        await applied;
      } catch (error) {
        console.log('[authStore.initialize]', error);
        if (isCurrent(generation)) clearSession(false);
      } finally { startupFinished = true; recoverSession(); }
    },

    setSession: (session) => {
      ++authGeneration;
      const profile = session && get().profile?.id === session.user.id ? get().profile : null;
      setCachedUserId(session?.user.id ?? null);
      set({ session, profile, isVerifiedSchoolUser: getVerifiedStatus(profile), loading: false, initialized: true });
    },
    setProfile: (profile) => {
      if (profile && profile.id !== get().session?.user.id) return;
      set({ profile, isVerifiedSchoolUser: getVerifiedStatus(profile) });
    },
    setPasswordRecovery: (value) => {
      set({ isPasswordRecovery: value });
      if (!value && get().session && !get().profile) void get().healProfile();
    },
    setSuppressRecoveryRedirect: (value) => set({ suppressRecoveryRedirect: value }),
    setRecoveryUrl: (url) => set({ recoveryUrl: url }),
    markRecoveryConsumed: (url) => { consumedRecoveryUrl = url; AsyncStorage.setItem('pc-consumed-recovery', url).catch(() => {}); },

    healProfile: async () => {
      const userId = get().session?.user.id;
      const generation = authGeneration;
      if (!userId || !isCurrent(generation)) return;
      const profile = await loadProfile(userId, generation, get().profile);
      if (isCurrent(generation) && get().session?.user.id === userId) {
        set({ profile, isVerifiedSchoolUser: getVerifiedStatus(profile) });
      }
    },

    signOut: async () => {
      if (signingOut) return;
      ++authGeneration;
      signingOut = true;
      const userId = get().session?.user.id;
      clearSession();
      AsyncStorage.removeItem('pc-profile-cache').catch(() => {});
      try {
        if (userId && lastPushToken) {
          const { pushTokenService } = await import('../services/pushTokenService');
          await withTimeout(pushTokenService.removeToken(userId, lastPushToken), 3000, undefined);
        }
      } catch (error) { console.log('[signOut] token removal:', error); }
      try {
        if (userId) {
          await withTimeout(Promise.resolve(supabase.from('user_presence').upsert({
            user_id: userId, is_online: false, last_seen: new Date().toISOString(),
          })), 3000, null);
        }
        await supabase.auth.signOut();
      } catch (error) { console.log('[authStore.signOut]', error); }
      finally {
        ++authGeneration;
        signingOut = false;
        clearSession();
      }
    },

    refreshProfile: async () => {
      if (!get().session) { set({ profile: null, isVerifiedSchoolUser: false }); return; }
      await get().healProfile();
    },
  };
});
