import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import { createAuthDeadlineFetch } from '../../shared/authFetch';
const nativeAuthTiming = require('../../tests/native/auth-diagnostics.cjs').nativeAuthDiagnostics();

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
    storage: Platform.OS === 'web' ? undefined : nativeAuthTiming.wrapStorage(AsyncStorage),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: nativeAuthTiming.wrapLock(processLock),
  },
  global: {
    headers: {
      'x-client-info': 'PlatinumCircles-nest-mobile',
    },
    fetch: createAuthDeadlineFetch(url, (input: any, init: any = {}) => {
      const ctrl = new AbortController();
      const callerSignal = init?.signal ?? input?.signal;
      // A query can be cancelled while waiting for the SDK's session lock,
      // before this transport is reached. Do not resurrect that request.
      if (callerSignal?.aborted) {
        const error = new Error('The request was cancelled.');
        error.name = 'AbortError';
        return Promise.reject(error);
      }
      const u = String((input as any)?.url ?? input);
      // Keep existing service budgets. The outer Auth-only wrapper applies
      // its deadline through the complete response body, not just headers.
      const ms = u.includes('/storage/v1/') ? 90000 : u.includes('/auth/v1/') ? 60000 : u.includes('/rest/v1/stories') ? 45000 : 15000;
      const timer = setTimeout(() => ctrl.abort(), ms);
      // Listen to BOTH abort sources: the caller's signal and our deadline.
      const abortFromCaller = () => ctrl.abort();
      if (callerSignal) { try { callerSignal.addEventListener('abort', abortFromCaller, { once: true }); } catch {} }
      const merged = { ...init, signal: ctrl.signal };
      return fetch(input, merged).then((res) => {
        // error lens folded in - 401 now VISIBLE, only 406 (no-row) excluded
        if (__DEV__ && !res.ok && res.status !== 406) {
          res.clone().text().then((body) => {
            const path = u.split('/rest/v1/')[1]?.split('?')[0] ?? u.split('/functions/v1/')[1] ?? u;
            console.warn('[db ' + res.status + '] ' + ((merged as any)?.method || 'GET') + ' ' + path + ' -> ' + String(body).slice(0, 220));
          }).catch(() => {});
        }
        return res;
      }).finally(() => {
        clearTimeout(timer);
        if (callerSignal) { try { callerSignal.removeEventListener('abort', abortFromCaller); } catch {} }
      }); /* fetchWithDeadline */
    }),
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
