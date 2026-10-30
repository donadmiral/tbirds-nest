'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { preferenceValue } from './browserPreferences';

const serverSnapshot = () => '';
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener('platinum:preference', listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener('platinum:preference', listener); };
}

/** Primitive snapshots are stable, survive unavailable storage, and hydrate with
 * the server default before React subscribes to the browser's actual settings. */
export function usePreference(key: string): string {
  const snapshot = useCallback(() => preferenceValue(key), [key]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function preferenceList(raw: string, allowed?: ReadonlySet<string>): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]');
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && (!allowed || allowed.has(item))))].slice(0, 30) : [];
  } catch { return []; }
}
