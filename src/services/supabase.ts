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
      'x-client-info': 'PlatinumCircles-nest-mobile',
    },
  },
});

let _cachedUserId: string | null = null;
let _heartbeat: ReturnType<typeof setInterval> | null = null;
export function setCachedUserId(id: string | null) { _cachedUserId = id; }

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
      if (_cachedUserId) {
        supabase.from('user_presence').upsert({
          user_id: _cachedUserId,
          is_online: true,
          last_seen: new Date().toISOString(),
        })// @ts-ignore
.then(() => {}).catch(() => {});
        if (_heartbeat) clearInterval(_heartbeat);
        _heartbeat = setInterval(() => {
          if (_cachedUserId) {
            supabase.from('user_presence').upsert({
              user_id: _cachedUserId,
              is_online: true,
              last_seen: new Date().toISOString(),
            }).then(() => {}, () => {});
          }
        }, 60000);
      }
    } else {
      if (_heartbeat) { clearInterval(_heartbeat); _heartbeat = null; }
      if (_cachedUserId) {
        supabase.from('user_presence').upsert({
          user_id: _cachedUserId,
          is_online: false,
          last_seen: new Date().toISOString(),
        }).then(() => {}, () => {});
      }
      supabase.auth.stopAutoRefresh();
    }
  });
}

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;