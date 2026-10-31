'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from './supabase/client';
import { withTimeout } from './withTimeout';

/** Client identity for optional panels. RLS remains the authority for every query. */
export function useViewerIdentity() {
  const [client] = useState(createClient);
  const [viewer, setViewer] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let alive = true, generation = 0, acceptedId: string | null | undefined;
    const accept = (user: User | null) => {
      if (!alive) return;
      const next = user?.id ?? null;
      if (next !== acceptedId) { acceptedId = next; setEpoch(value => value + 1); }
      setViewer(user); setLoading(false); setError('');
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => { generation++; accept(session?.user ?? null); });
    const request = generation;
    void withTimeout(client.auth.getSession()).then(({ data, error: cause }) => {
      if (!alive || request !== generation) return;
      if (cause) throw cause;
      accept(data.session?.user ?? null);
    }).catch(() => { if (alive && request === generation) { setViewer(null); setLoading(false); setError('Your account could not be checked.'); } });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [client, attempt]);
  return { viewer, epoch, loading, error, retry: () => { setLoading(true); setError(''); setAttempt(value => value + 1); } };
}
