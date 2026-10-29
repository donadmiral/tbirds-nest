import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';

/** Keeps data scoped to the signed-in business and rejects late tab/search
 * responses. A transport failure stays an error, never an empty business. */
export function useStudioResource<T>(fetchData: () => Promise<T>, failure: string) {
  const scope = useAuthStore(state => `${state.session?.user.id || ''}:${state.profile?.id || ''}`);
  const currentScope = useRef(scope); currentScope.current = scope;
  const currentFetch = useRef(fetchData); currentFetch.current = fetchData;
  const mounted = useRef(true);
  const version = useRef(0);
  const [result, setResult] = useState<{ scope: string; fetch: typeof fetchData; data: T | null; error: string | null; loading: boolean } | null>(null);
  const reload = useCallback(async () => {
    if (!mounted.current || currentScope.current !== scope || currentFetch.current !== fetchData) return;
    const request = ++version.current;
    const current = () => mounted.current && currentScope.current === scope && currentFetch.current === fetchData && version.current === request;
    if (!current()) return;
    setResult(previous => ({ scope, fetch: fetchData, data: previous?.scope === scope && previous.fetch === fetchData ? previous.data : null, error: null, loading: true }));
    try {
      const data = await fetchData();
      if (current()) setResult({ scope, fetch: fetchData, data, error: null, loading: false });
    } catch {
      if (current()) setResult(previous => ({ scope, fetch: fetchData, data: previous?.scope === scope && previous.fetch === fetchData ? previous.data : null, error: failure, loading: false }));
    }
  }, [fetchData, scope, failure]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; ++version.current; };
  }, [reload]);
  const valid = result?.scope === scope && result.fetch === fetchData;
  return { data: valid ? result.data : null, error: valid ? result.error : null, loading: valid ? result.loading : true, reload };
}
