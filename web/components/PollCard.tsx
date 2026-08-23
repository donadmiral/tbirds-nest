"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Opt = { option_id: string; label: string; votes: number; viewer_vote: string | null; ends_at: string; total: number };

export function PollCard({ postId }: { postId: string }) {
  const supabase = useRef(createClient()).current;
  const [opts, setOpts] = useState<Opt[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("get_poll", { p_post_id: postId });
    setOpts((data ?? []) as Opt[]);
  }, [postId, supabase]);

  useEffect(() => { load(); }, [load]);
  if (opts.length === 0) return null;

  const ended = new Date(opts[0].ends_at).getTime() < Date.now();
  const voted = !!opts[0].viewer_vote;
  const total = opts[0].total;
  const showResults = voted || ended;
  const hoursLeft = Math.max(0, Math.round((new Date(opts[0].ends_at).getTime() - Date.now()) / 3600000));

  async function vote(id: string) {
    if (showResults) return;
    await supabase.rpc("vote_poll", { p_post_id: postId, p_option_id: id });
    load();
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {opts.map((o) => {
        const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
        const mine = o.viewer_vote === o.option_id;
        return showResults ? (
          <span key={o.option_id} className="relative overflow-hidden rounded-md border border-ink/10 px-3 py-2">
            <span aria-hidden className={"absolute inset-y-0 left-0 " + (mine ? "bg-pearl/40" : "bg-ink/10")} style={{ width: pct + "%" }} />
            <span className="relative flex items-center justify-between text-[13.5px] text-ink">
              <span className={mine ? "font-semibold" : ""}>{o.label}{mine ? " ✓" : ""}</span>
              <span className="text-ink/55">{pct}%</span>
            </span>
          </span>
        ) : (
          <button key={o.option_id} onClick={() => vote(o.option_id)}
            className="rounded-md border border-pearl px-3 py-2 text-left text-[13.5px] font-semibold text-ink transition-colors hover:bg-pearl/15"
          >
            {o.label}
          </button>
        );
      })}
      <span className="text-[12px] text-ink/45">
        {total} {total === 1 ? "vote" : "votes"} · {ended ? "Final results" : hoursLeft + "h left"}
      </span>
    </div>
  );
}