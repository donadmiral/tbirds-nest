"use client";

import { PersonName } from "@/components/PersonName";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Opt = { option_id: string; label: string; votes: number; viewer_vote: string | null; ends_at: string; total: number };

export function PollCard({ postId }: { postId: string }) {
  const [isAuthor, setIsAuthor] = useState(false);
  const [votersOpen, setVotersOpen] = useState(false);
  useEffect(() => { (async () => { const sb = createClient(); const { data: s } = await sb.auth.getSession(); const uid = s.session?.user.id; if (!uid) return; const { data } = await sb.from("posts").select("user_id").eq("id", postId).maybeSingle(); setIsAuthor(!!data && (data as { user_id: string }).user_id === uid); })(); }, [postId]);
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
        {total} {total === 1 ? "vote" : "votes"} · {ended ? "Final results" : hoursLeft + "h left"}{isAuthor ? <> · <button type="button" onClick={() => setVotersOpen(true)} className="underline">See votes</button></> : null}
      </span>
      {votersOpen ? <PollVoters postId={postId} onClose={() => setVotersOpen(false)} /> : null}
    </div>
  );
}

export function PollVoters({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [rows, setRows] = useState<{ option_id: string; label: string; user_id: string; full_name: string | null; username: string | null; avatar_url: string | null }[] | null>(null);
  useEffect(() => { createClient().rpc("get_poll_voters", { p_post_id: postId }).then(({ data }) => setRows((data ?? []) as never)); }, [postId]);
  const groups: Record<string, typeof rows> = {};
  (rows ?? []).forEach((r) => { (groups[r.label] = groups[r.label] ?? []).push(r); });
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-[15px] font-semibold">Votes</div>
        {rows === null ? <div className="text-[13px] text-ink/50">Loading</div> : rows.length === 0 ? <div className="text-[13px] text-ink/50">No votes yet</div> : Object.entries(groups).map(([label, list]) => (
          <div key={label} className="mb-3">
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink/50">{label} · {list?.length}</div>
            {(list ?? []).map((r) => (
              <a key={r.user_id} href={"/" + (r.username ?? "")} className="flex items-center gap-2 py-1.5">
                {r.avatar_url ? <img src={r.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="h-8 w-8 rounded-full bg-surface" />}
                <PersonName name={r.full_name ?? r.username ?? ""} userId={r.user_id} className="text-[14px] font-semibold" />
              </a>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
