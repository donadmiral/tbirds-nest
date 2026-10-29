import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import { hydratePostMedia } from '../services/contentMedia';
import { normalizeProfilePost } from '../utils/profilePost';

/** Keep profile capabilities fresh without replacing the list or dropping paged posts. */
export function useProfileMediaRefresh<T extends { id: string }>(rows: T[], setRows: Dispatch<SetStateAction<T[]>>, identity: string, active: boolean, onError: (message: string) => void) {
  const latest = useRef(rows); latest.current = rows;
  const error = useRef(onError); error.current = onError;
  useEffect(() => {
    if (!active) return;
    let alive = true, busy = false;
    const refresh = async () => {
      if (!alive || busy || AppState.currentState !== 'active') return;
      const expiring = latest.current.filter(row => {
        const expiry = (row as any)._mediaExpiresAt;
        return typeof expiry === 'number' && expiry <= Date.now() + 60_000;
      });
      if (!expiring.length) return;
      busy = true;
      try {
        const renewed = await hydratePostMedia(expiring);
        if (!alive) return;
        const byId = new Map(renewed.map(row => [row.id, normalizeProfilePost(row)]));
        const before = new Map(expiring.map(row => [row.id, (row as any)._mediaExpiresAt]));
        setRows(current => current.map(row => before.has(row.id) && (row as any)._mediaExpiresAt === before.get(row.id) ? byId.get(row.id) as T ?? row : row));
      } catch { if (alive) error.current('Photos and videos could not refresh. Tap Retry to restore access.'); }
      finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    const app = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { alive = false; clearInterval(timer); app.remove(); };
  }, [identity, active, setRows]);
}
