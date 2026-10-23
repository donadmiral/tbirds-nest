import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { replaceContentMedia } from '../../shared/contentMedia';
import { hydrateUploadMedia } from '../services/contentMedia';
import { supabase, SUPABASE_URL } from '../services/supabase';

/** Signed media is a render copy. Drafts and writes retain the canonical source. */
export function useUploadPreview<T>(value: T) {
  const safe = useMemo(() => replaceContentMedia(value, SUPABASE_URL, new Map()), [value]);
  const [result, setResult] = useState<{ source: T; data: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true, generation = 0;
    const load = async () => {
      const request = ++generation;
      try {
        const [data] = await hydrateUploadMedia([value]);
        if (alive && generation === request) { setResult({ source: value, data }); setError(null); }
      } catch { if (alive && generation === request) { setResult(null); setError('Media preview could not load. Tap to retry.'); } }
    };
    const refresh = () => { if (AppState.currentState === 'active') void load(); };
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { generation++; setResult(null); queueMicrotask(() => { if (alive) void load(); }); });
    const app = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    void load(); const timer = setInterval(refresh, 240000);
    return () => { alive = false; generation++; clearInterval(timer); subscription.unsubscribe(); app.remove(); };
  }, [value, retry]);
  return { preview: result?.source === value ? result.data : safe, error, retry: () => setRetry(n => n + 1) };
}
