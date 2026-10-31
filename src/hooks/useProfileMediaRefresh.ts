import { useEffect, useRef, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import { profileContentRead } from '../services/profileContent';
import { navigationScope, subscribeNavigationScope } from '../lib/navigationCache';
import { useAuthStore } from '../stores/authStore';
import { normalizeProfilePost } from '../utils/profilePost';

/** Keep profile capabilities fresh without replacing the list or dropping paged posts. */
export function useProfileMediaRefresh<T extends { id: string }>(rows: T[], setRows: Dispatch<SetStateAction<T[]>>, identity: string, active: boolean, onError: (message: string) => void) {
  const latest = useRef(rows); latest.current = rows;
  const error = useRef(onError); error.current = onError;
  const sessionScope = useSyncExternalStore(subscribeNavigationScope, navigationScope, navigationScope);
  useEffect(() => {
    const viewer = useAuthStore.getState().session?.user.id;
    if (!active || !sessionScope || !viewer) return;
    let alive = true, busy = false;
    let request: AbortController | null = null;
    const current = () => alive && navigationScope() === sessionScope;
    const refresh = async () => {
      if (!current() || busy || AppState.currentState !== 'active') return;
      const expiring = latest.current.filter(row => {
        const expiry = (row as any)._mediaExpiresAt;
        return typeof expiry === 'number' && expiry <= Date.now() + 60_000;
      });
      if (!expiring.length) return;
      busy = true;
      request = new AbortController();
      try {
        const renewed = await profileContentRead(viewer, sessionScope, request.signal, reader => reader.sign(expiring));
        if (!current()) return;
        const byId = new Map(renewed.map(row => [row.id, normalizeProfilePost(row)]));
        const before = new Map(expiring.map(row => [row.id, row]));
        // A metadata refresh can keep the same media expiry. Only replace the
        // exact rows this renewal started with, preserving newer edits/counts.
        setRows(rows => current() ? rows.map(row => row === before.get(row.id) ? byId.get(row.id) as T ?? row : row) : rows);
      } catch { if (current()) error.current('Photos and videos could not refresh. Tap Retry to restore access.'); }
      finally { busy = false; request = null; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    const app = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { alive = false; request?.abort(); clearInterval(timer); app.remove(); };
  }, [identity, active, setRows, sessionScope]);
}
