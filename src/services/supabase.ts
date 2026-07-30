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
 * Dev error lens: every non-ok database response prints itself in the
 * Metro terminal - table, verb, status and the database's own words -
 * so no swallowed error stays invisible while testing. Production
 * builds use plain fetch. 406 (maybeSingle finding no row) and 401
 * (auth refresh churn) are normal and excluded.
 */
const devFetch: typeof fetch = async (input: any, init?: any) => {
  const res = await fetch(input, init);
  if (__DEV__ && !res.ok && res.status !== 406 && res.status !== 401) {
    try {
      const body = await res.clone().text();
      const u = String(input?.url ?? input);
      const path = u.split('/rest/v1/')[1]?.split('?')[0] ?? u.split('/functions/v1/')[1] ?? u;
      console.warn('[db ' + res.status + '] ' + ((init?.method) || 'GET') + ' ' + path + ' -> ' + body.slice(0, 220));
    } catch {}
  }
  return res;
};
export const supabase = createClient(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
  global: {
    fetch: devFetch,
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