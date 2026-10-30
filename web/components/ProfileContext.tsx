"use client";

import { profilePath } from "@/lib/profileLookup";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Share2, Check } from "lucide-react";

export function ProfileContext({ profileId, username, compact = false }: { profileId: string; username: string; compact?: boolean }) {
  const [supabase] = useState(createClient);
  const [mutual, setMutual] = useState<string | null>(null);
  const [insights, setInsights] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const me = sess.session?.user.id ?? null;
        if (!me) return;
        if (me === profileId) {
          const { data } = await supabase.rpc("get_profile_insights", { p_profile: profileId });
          if (alive && data && typeof (data as any).views_30d === "number") {
            setInsights(String((data as any).views_30d) + " profile views in the last 30 days");
          }
        } else {
          const { data } = await supabase.rpc("get_profile_context", { p_profile: profileId });
          if (alive && data) {
            const names: string[] = Array.isArray((data as any).mutual_names) ? (data as any).mutual_names : [];
            const extra = Math.max(0, ((data as any).mutual_count || 0) - names.length);
            if (names.length > 0) setMutual("Followed by " + names.join(", ") + (extra > 0 ? " and " + extra + " more" : ""));
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [profileId, supabase]);

  const share = async () => {
    setShareError('');
    const url = window.location.origin + profilePath(username, profileId);
    try {
      if (navigator.share) { await navigator.share({ title: (username ? "@" + username : "Profile") + " on Platinum Circles", url }); return; }
    } catch (error) { if (error instanceof Error && error.name === 'AbortError') return; }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setShareError('The link could not be copied. Please try again.'); }
  };

  return (
    <div className={compact ? 'min-w-0' : 'text-center'}>
      {!compact && mutual ? <p className="text-[12.5px] text-muted">{mutual}</p> : null}
      {!compact && insights ? <p className="text-[12.5px] text-muted">{insights}</p> : null}
      <button onClick={share} type="button" className={(compact ? '' : 'mt-3 ') + 'inline-flex min-h-10 items-center justify-center gap-2 rounded-[9px] border border-ink/15 bg-[var(--surface-raised)] px-4 py-2 text-[12px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-ink/5'}>
        {copied ? <Check size={15} /> : <Share2 size={15} />}
        {copied ? "Link copied" : "Share profile"}
      </button>
      {shareError ? <p role="alert" className="mt-2 max-w-60 text-xs text-danger">{shareError}</p> : null}
    </div>
  );
}
