// src/hooks/useStudioLive.ts
// Live refresh for Studio desks. Subscribes to the tables that feed the inbox
// and overview; RLS decides what this session may see, so no filter is needed.
// Changes are debounced into one reload.
import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';

const TABLES = ['messages', 'business_reviews', 'job_applications', 'chat_payments', 'listing_offers'];

export function useStudioLive(onChange: () => void, enabled: boolean = true) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const kick = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; cb.current(); }, 800); };
    const ch = supabase.channel('studio-live-' + Math.random().toString(36).slice(2, 8));
    for (const table of TABLES) ch.on('postgres_changes', { event: '*', schema: 'public', table }, kick);
    ch.subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [enabled]);
}