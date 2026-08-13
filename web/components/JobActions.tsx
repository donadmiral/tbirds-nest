"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Share2, MessageCircle, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function JobActions({ jobId, posterId, initiallySaved, viewerId }: {
  jobId: string; posterId: string; initiallySaved: boolean; viewerId: string | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [copied, setCopied] = useState(false);
  const [msgPending, setMsgPending] = useState(false);

  async function toggleSave() {
    if (!viewerId) { router.push("/login"); return; }
    const next = !saved;
    setSaved(next);
    const { error } = next
      ? await supabase.from("job_saves").insert({ user_id: viewerId, job_id: jobId })
      : await supabase.from("job_saves").delete().eq("user_id", viewerId).eq("job_id", jobId);
    if (error && !String(error.message || "").toLowerCase().includes("duplicate")) setSaved(!next);
  }

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ url }); return; } catch { /* cancelled */ }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function messageEmployer() {
    if (!viewerId) { router.push("/login"); return; }
    if (msgPending) return;
    setMsgPending(true);
    const { data } = await supabase.rpc("start_dm_ctx", { p_receiver_id: posterId, p_context: "jobs", p_ref_id: jobId });
    setMsgPending(false);
    router.push(data ? "/messages?started=1" : "/messages");
  }

  const btn = "flex items-center gap-1.5 rounded-md bg-surface px-3.5 py-2 text-[13px] text-white/80 transition-colors hover:bg-surface-elevated hover:text-white";

  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={toggleSave} className={btn + (saved ? " text-pearl" : "")}>
        <Bookmark size={16} fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save"}
      </button>
      <button onClick={share} className={btn}>
        {copied ? <Check size={16} className="text-success" /> : <Share2 size={16} />} Share
      </button>
      {viewerId !== posterId ? (
        <button onClick={messageEmployer} disabled={msgPending} className={btn}>
          <MessageCircle size={16} /> {msgPending ? "Opening" : "Message employer"}
        </button>
      ) : null}
    </div>
  );
}