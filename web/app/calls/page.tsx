"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { ArrowLeft, Phone, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { requestWebCall } from "@/lib/calls";

type Row = {
  id: string; initiator_id: string; receiver_id: string | null; conversation_id: string | null;
  status: string; is_video: boolean | null; duration_sec: number | null; created_at: string;
  other?: { id: string; full_name: string | null; username: string | null; avatar_url: string | null };
};

function fmtDuration(secs?: number | null) {
  if (!secs) return "";
  const m = Math.floor(secs / 60), s = secs % 60;
  return m === 0 ? s + "s" : m + "m " + s + "s";
}
function fmtTime(d: string) {
  const date = new Date(d), diff = Date.now() - date.getTime();
  const hours = diff / 3600000, days = diff / 86400000;
  if (hours < 1) return "Just now";
  if (hours < 24) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return date.toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function CallsPage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const me = auth.user?.id ?? null;
    setUid(me);
    if (!me) { setRows([]); return; }
    const { data } = await supabase.from("call_sessions").select("id, initiator_id, receiver_id, conversation_id, status, is_video, duration_sec, created_at")
      .or("initiator_id.eq." + me + ",receiver_id.eq." + me)
      .order("created_at", { ascending: false }).limit(100);
    const list = (data as Row[]) ?? [];
    if (!list.length) { setRows([]); return; }
    const otherIds = Array.from(new Set(list.map(c => (c.initiator_id === me ? c.receiver_id : c.initiator_id)).filter(Boolean))) as string[];
    const byId: Record<string, Row["other"]> = {};
    if (otherIds.length) {
      const { data: people } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", otherIds);
      (people ?? []).forEach(p => { byId[p.id] = p; });
    }
    setRows(list.map(c => ({ ...c, other: byId[c.initiator_id === me ? (c.receiver_id || "") : c.initiator_id] })));
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const redial = (row: Row, isVideo: boolean) => {
    if (!row.other) return;
    requestWebCall({ receiverId: row.other.id, conversationId: row.conversation_id, isVideo, name: row.other.full_name || row.other.username || "User" });
  };

  const icon = (row: Row) => {
    const outgoing = row.initiator_id === uid;
    if (row.status === "missed") return <PhoneMissed size={13} className="text-red-500" />;
    if (row.status === "declined") return <PhoneOff size={13} className="text-amber-500" />;
    return outgoing ? <PhoneOutgoing size={13} className="text-success" /> : <PhoneIncoming size={13} className="text-pearl" />;
  };
  const label = (row: Row) => {
    const outgoing = row.initiator_id === uid;
    if (row.status === "missed") return "Missed";
    if (row.status === "declined") return "Declined";
    if (row.status === "ringing") return "Ringing";
    return outgoing ? "Outgoing" : "Incoming";
  };

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/messages" aria-label="Back to Messages" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><Phone size={19} className="text-pearl" /> Calls</h1>
      <p className="pb-5 text-[13px] text-ink/50">Your call history.</p>

      {rows === null ? <p className="py-10 text-center text-sm text-ink/40">Loading</p>
      : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink/15 py-16 text-center">
          <Phone size={28} className="text-ink/25" />
          <p className="text-[14px] font-semibold text-ink">No calls yet</p>
          <p className="text-[12.5px] text-ink/45">Your call history will appear here.</p>
        </div>
      ) : rows.map(r => {
        const missed = r.status === "missed";
        return (
          <div key={r.id} className="flex items-center gap-3 border-b border-ink/[0.06] py-3 last:border-0">
            {r.other?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayImageUrl(r.other.avatar_url, 200) ?? r.other.avatar_url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
            ) : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-navy text-[13px] font-semibold text-white">{(r.other?.full_name || "U").charAt(0)}</span>}
            <div className="min-w-0 flex-1">
              <p className={"truncate text-[14px] font-semibold " + (missed ? "text-red-500" : "text-ink")}>{r.other?.full_name || "Unknown"} <VerifiedBadge userId={r.other?.id} size={13} /></p>
              <p className={"flex items-center gap-1.5 text-[12.5px] " + (missed ? "text-red-500" : "text-ink/45")}>
                {icon(r)} {label(r)}{r.is_video ? " · Video" : " · Audio"}{r.duration_sec ? " · " + fmtDuration(r.duration_sec) : ""}
              </p>
              <p className="text-[11px] text-ink/35">{fmtTime(r.created_at)}</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button onClick={() => redial(r, false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 text-ink transition-colors duration-[140ms] hover:bg-ink/10" aria-label="Voice call"><Phone size={15} /></button>
              <button onClick={() => redial(r, true)} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 text-ink transition-colors duration-[140ms] hover:bg-ink/10" aria-label="Video call"><Video size={15} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}