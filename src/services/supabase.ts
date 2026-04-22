import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    '[supabase] Missing env vars. Check .env for EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

/**
 * Canonical Supabase client for the whole app.
 *
 * - AsyncStorage is used on native so sessions persist across restarts.
 * - processLock serialises auth operations across multiple JS instances.
 * - detectSessionInUrl is off because we use deep links, not hash fragments.
 * - AppState listener keeps the token refreshing while the app is foregrounded.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
  global: {
    headers: {
      'x-client-info': 'tbirds-nest-mobile',
    },
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/**
 * Exported so mediaService can POST directly to the storage REST endpoint
 * without re-reading process.env. Do not import these elsewhere unless you
 * genuinely need the raw URL or anon key.
 */
export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;