'use client';
import { useEffect, useMemo, useState } from 'react';
import { replaceContentMedia } from '../../shared/contentMedia';
import { hydrateUploadMedia } from './contentMedia';
import { createClient } from './supabase/client';

/** Keep the source editable/canonical; capabilities exist only in this render copy. */
export function useUploadPreview<T>(value: T) {
  const [client] = useState(() => createClient());
  const safe = useMemo(() => replaceContentMedia(value, process.env.NEXT_PUBLIC_SUPABASE_URL!, new Map()), [value]);
  const [result, setResult] = useState<{ source: T; data: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true, generation = 0;
    const load = async () => {
      const request = ++generation;
      try {
        const [data] = await hydrateUploadMedia([value], client);
        if (alive && generation === request) { setResult({ source: value, data }); setError(null); }
      } catch { if (alive && generation === request) { setResult(null); setError('Media preview could not load. Please retry.'); } }
    };
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const { data: { subscription } } = client.auth.onAuthStateChange(() => { generation++; setResult(null); queueMicrotask(() => { if (alive) void load(); }); });
    void load();
    const timer = setInterval(refresh, 240000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { alive = false; generation++; clearInterval(timer); subscription.unsubscribe(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [client, value, retry]);
  return { preview: result?.source === value ? result.data : safe, error, retry: () => setRetry(n => n + 1) };
}
