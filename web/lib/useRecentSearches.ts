'use client';
import { useState, useSyncExternalStore } from 'react';
import { createRecentSearchStore, recentSearchKey } from '../../shared/recentSearches';
import { getNavigationStore } from './navigationCache';
function createStore() {
  const history = createRecentSearchStore({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key),
  });
  if (typeof window !== 'undefined') {
    const navigation = getNavigationStore();
    const sync = () => { void history.bind(navigation.getSnapshot().owner); };
    navigation.subscribe(sync); sync();
    window.addEventListener('storage', event => {
      const owner = navigation.getSnapshot().owner;
      if (owner && (event.key === null || event.key === recentSearchKey(owner))) void history.bind(owner, true);
    });
  }
  return history;
}
let browserStore: ReturnType<typeof createStore> | undefined;
export function useRecentSearches() {
  const [store] = useState(() => typeof window === 'undefined' ? createStore() : browserStore ??= createStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { ...snapshot, record: store.record, remove: store.remove, clear: store.clear };
}
