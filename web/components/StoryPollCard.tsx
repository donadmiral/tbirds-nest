"use client";
/**
 * StoryPollCard - web twin of the phone PollCard. Solid light card, ink type,
 * full-width option rows; after voting (or for the owner) rows fill as bars
 * with the percentage on the right. Same RPCs as the phone.
 */
import { useState } from "react";
import { voteStoryPoll, type StoryPoll } from "@/lib/stories";

export function StoryPollCard({ poll, isOwn, onUpdate }: { poll: StoryPoll; isOwn: boolean; onUpdate: (p: StoryPoll) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const revealed = isOwn || !!poll.my_vote;
  const total = Math.max(0, poll.total_votes || poll.options.reduce((a, o) => a + (o.vote_count || 0), 0));
  const top = poll.options.reduce((m, o) => Math.max(m, o.vote_count || 0), 0);
  const vote = async (optionId: string) => {
    if (isOwn || poll.my_vote || busy) return;
    setBusy(optionId);
    try { const next = await voteStoryPoll(poll.poll_id, optionId); if (next) onUpdate(next); } catch {} finally { setBusy(null); }
  };
  return (
    <div className="pointer-events-auto" style={{ position: "absolute", left: (poll.nx * 100) + "%", top: (poll.ny * 100) + "%", transform: "translate(-50%, -50%) scale(" + (poll.scale || 1) + ")", width: "78%", maxWidth: 300, zIndex: 5 }}>
      <div style={{ background: "#FFFFFF", borderRadius: 18, padding: "14px 14px 10px", boxShadow: "0 10px 30px rgba(0,0,0,0.28)" }}>
        <div style={{ color: "#0B1E3D", fontSize: 16, fontWeight: 800, letterSpacing: -0.2, lineHeight: "20px", textAlign: "center", marginBottom: 10 }}>{poll.question}</div>
        {poll.options.slice().sort((a, b) => a.position - b.position).map((o) => {
          const pct = total > 0 ? Math.round(((o.vote_count || 0) / total) * 100) : 0;
          const mine = poll.my_vote === o.id;
          const lead = revealed && total > 0 && (o.vote_count || 0) === top;
          return (
            <button key={o.id} type="button" onClick={() => vote(o.id)} disabled={revealed || !!busy} style={{ position: "relative", display: "block", width: "100%", overflow: "hidden", borderRadius: 12, border: "1.5px solid rgba(11,30,61,0.14)", background: "#F6F5F2", marginBottom: 8, padding: 0, cursor: revealed ? "default" : "pointer", textAlign: "left" }}>
              {revealed ? <span style={{ position: "absolute", inset: 0, width: pct + "%", background: lead ? "#C9BFB0" : "rgba(11,30,61,0.10)", transition: "width 520ms cubic-bezier(0.16,1,0.3,1)" }} /> : null}
              <span style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 12px", color: "#0B1E3D", fontSize: 14, fontWeight: mine ? 800 : 600 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mine ? "\u2713 " : ""}{o.label}</span>
                {revealed ? <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800, marginLeft: 8 }}>{pct}%</span> : null}
              </span>
            </button>
          );
        })}
        {revealed ? <div style={{ color: "rgba(11,30,61,0.55)", fontSize: 11.5, fontWeight: 600, textAlign: "center", marginTop: 2 }}>{total === 1 ? "1 vote" : total + " votes"}</div> : null}
      </div>
    </div>
  );
}
