"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Share2, Check } from "lucide-react";

export function ProfileContext({ profileId, username }: { profileId: string; username: string }) {
  const supabase = createClient();
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
    const url = window.location.origin + "/" + username;
    try {
      if (navigator.share) { await navigator.share({ title: "@" + username + " on Platinum Circles", url }); return; }
    } catch { /* fall through */ }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };

  return (
    <div className="mt-2">
      {mutual ? <p className="text-[12.5px] text-ink/45">{mutual}</p> : null}
      {insights ? <p className="text-[12.5px] text-ink/45">{insights}</p> : null}
      <button onClick={share} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-ink/10">
        {copied ? <Check size={13} /> : <Share2 size={13} />}
        {copied ? "Link copied" : "Share profile"}
      </button>
    </div>
  );
}
