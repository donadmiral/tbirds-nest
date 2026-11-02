"use client";

import { createSessionHistory, type HistoryStorage, type SessionHistory } from '../../shared/sessionHistory';
import { getNavigationStore } from './navigationCache';

const PREFIX = 'pc-history-v1:';
let initialized = false, observedScope: string | null = null;
const histories = new Set<SessionHistory<unknown>>();

/** sessionStorage is tab-local and never contains row content, authentication
 * tokens or signed media URLs. Browser quota failure is returned to the
 * reader before any visible content can be evicted. */
export const webHistoryStorage: HistoryStorage = {
  async read(keys) { return keys.map(key => sessionStorage.getItem(key)); },
  async write(entries) { for (const [key, value] of entries) sessionStorage.setItem(key, value); },
  async clear(prefix) {
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index); if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  },
};

function initialize() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  // The numeric geometry belongs to this running application. A browser
  // reload cannot reuse an old ledger without that geometry, so remove it.
  void webHistoryStorage.clear(PREFIX).catch(() => {});
  const navigation = getNavigationStore(); observedScope = navigation.getSnapshot().scope;
  navigation.subscribe(() => {
    const next = navigation.getSnapshot().scope;
    if (next === observedScope) return;
    observedScope = next;
    const previous = [...histories]; histories.clear();
    previous.forEach(history => { void history.dispose().catch(() => {}); });
    void webHistoryStorage.clear(PREFIX).catch(() => {});
  });
}

export function createWebSessionHistory<T>(options: {
  id: (row: T) => string; fetch: (ids: string[], signal: AbortSignal) => Promise<T[]>; current: () => boolean;
}) {
  initialize();
  for (const saved of histories) if (!saved.available()) { void saved.dispose().catch(() => {}); }
  if (histories.size >= 16) {
    const oldest = [...histories].find(saved => saved.inactive());
    if (oldest) void oldest.dispose().catch(() => {});
    else throw new Error('Close an earlier reading window, then retry.');
  }
  const history = createSessionHistory({ ...options, storage: webHistoryStorage,
    namespace: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}` });
  histories.add(history as SessionHistory<unknown>);
  const dispose = history.dispose;
  history.dispose = async () => { histories.delete(history as SessionHistory<unknown>); await dispose(); };
  return history;
}
