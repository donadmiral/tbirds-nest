"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { withTimeout } from "@/lib/withTimeout";

export function MessageButton({ profileId }: { profileId: string }) {
  const [uid, setUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [supabase] = useState(createClient);
  const generation = useRef(0), pending = useRef(false), currentOwner = useRef<string | null | undefined>(undefined);
  const router = useRouter();

  useEffect(() => {
    let alive = true, version = 0;
    currentOwner.current = undefined;
    const accept = (id: string | null) => { if (alive && currentOwner.current !== id) { currentOwner.current = id; generation.current++; setUid(id); setError(''); setBusy(false); } };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { version++; accept(session?.user.id ?? null); });
    const initial = version;
    void supabase.auth.getSession().then(({ data }) => { if (version === initial) accept(data.session?.user.id ?? null); }).catch(() => { if (version === initial) accept(null); });
    return () => { alive = false; generation.current++; subscription.unsubscribe(); };
  }, [supabase, profileId]);

  if (!uid || uid === profileId) return null;

  const open = async () => {
    if (pending.current || !uid) return;
    pending.current = true; setBusy(true); setError('');
    const request = generation.current;
    try {
      const latest = await withTimeout(supabase.auth.getUser());
      if (request !== generation.current) return;
      if (latest.error || latest.data.user?.id !== uid) throw new Error('Your account changed. Please reload this profile.');
      const { data, error: cause } = await withTimeout(supabase.rpc("start_dm_ctx", { p_receiver_id: profileId, p_context: "personal" }));
      if (request !== generation.current) return;
      if (cause || typeof data !== 'string' || !data) throw new Error('This conversation could not open. Check your connection and try again.');
      router.push("/messages?c=" + encodeURIComponent(data));
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'The conversation could not open. Try again.');
    } finally {
      pending.current = false;
      if (request === generation.current) setBusy(false);
    }
  };

  return (
    <div><button
      type="button"
      onClick={open}
      disabled={busy}
      className="inline-flex min-h-10 items-center gap-2 rounded-[9px] border border-ink/15 bg-white px-4 py-2 text-[12px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-ink/5 disabled:opacity-60"
    >
      <Mail size={14} strokeWidth={2} />
      {busy ? 'Opening…' : 'Message'}
    </button>{error ? <p role="alert" className="mt-2 max-w-64 text-xs text-danger">{error}</p> : null}</div>
  );
}
