import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSessionHistory, type HistoryStorage, type SessionHistory } from '../../shared/sessionHistory';
import { navigationScope, subscribeNavigationScope } from '../lib/navigationCache';

const PREFIX = 'pc-history-v1:';
const histories = new Set<SessionHistory<unknown>>();
let initialized = false, observedScope: string | null = null;
let cleanup: Promise<void> = Promise.resolve();
const clearPrefix = async (prefix: string) => {
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
  for (let from = 0; from < keys.length; from += 200) await AsyncStorage.multiRemove(keys.slice(from, from + 200));
};
export const nativeHistoryStorage: HistoryStorage = {
  async read(keys) { await cleanup; if (!keys.length) return []; const values = new Map(await AsyncStorage.multiGet(keys)); return keys.map(key => values.get(key) ?? null); },
  async write(entries) { await cleanup; if (entries.length) await AsyncStorage.multiSet(entries); },
  async clear(prefix) { await cleanup; await clearPrefix(prefix); },
};
function initialize() {
  if (initialized) return;
  initialized = true; observedScope = navigationScope();
  cleanup = clearPrefix(PREFIX).catch(() => {});
  subscribeNavigationScope(() => {
    const next = navigationScope(); if (next === observedScope) return;
    observedScope = next;
    const previous = [...histories]; histories.clear();
    previous.forEach(history => { void history.dispose().catch(() => {}); });
    cleanup = cleanup.then(() => clearPrefix(PREFIX)).catch(() => {});
  });
}
export function createNativeSessionHistory<T>(options: {
  id: (row: T) => string; fetch: (ids: string[], signal: AbortSignal) => Promise<T[]>; current: () => boolean; pageRows?: number;
}) {
  initialize();
  for (const saved of histories) if (!saved.available()) { void saved.dispose().catch(() => {}); }
  if (histories.size >= 16) {
    const oldest = [...histories].find(saved => saved.inactive());
    if (oldest) void oldest.dispose().catch(() => {});
    else throw new Error('Close an earlier reading window, then retry.');
  }
  const history = createSessionHistory({ ...options, storage: nativeHistoryStorage,
    namespace: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
  histories.add(history as SessionHistory<unknown>);
  const dispose = history.dispose;
  history.dispose = async () => { histories.delete(history as SessionHistory<unknown>); await dispose(); };
  return history;
}
