"use client";

import { profilePath } from "@/lib/profileLookup";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Share2, Check } from "lucide-react";

export function ProfileContext({ profileId, username }: { profileId: string; username: string }) {
  const [supabase] = useState(createClient);
  const [mutual, setMutual] = useState<string | null>(null);
  const [insights, setInsights] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    const url = window.location.origin + profilePath(username, profileId);
    try {
      if (navigator.share) { await navigator.share({ title: (username ? "@" + username : "Profile") + " on Platinum Circles", url }); return; }
    } catch { /* fall through */ }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };

  return (
    <div className="text-center">
      {mutual ? <p className="text-[12.5px] text-muted">{mutual}</p> : null}
      {insights ? <p className="text-[12.5px] text-muted">{insights}</p> : null}
      <button onClick={share} className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-ink/10 bg-[var(--surface-raised)] px-5 py-2 text-[13px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-ink/5">
        {copied ? <Check size={15} /> : <Share2 size={15} />}
        {copied ? "Link copied" : "Share profile"}
      </button>
    </div>
  );
}
