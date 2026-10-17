"use client";

import { useRef, useState } from "react";
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
  const saving = useRef(false);
  const messaging = useRef(false);
  const [savePending, setSavePending] = useState(false);

  async function toggleSave() {
    if (!viewerId) { router.push("/login"); return; }
    if (saving.current) return;
    saving.current = true;
    setSavePending(true);
    const next = !saved;
    setSaved(next);
    try {
      const { error } = next
        ? await supabase.from("job_saves").insert({ user_id: viewerId, job_id: jobId })
        : await supabase.from("job_saves").delete().eq("user_id", viewerId).eq("job_id", jobId);
      if (error && error.code !== "23505") throw error;
    } catch {
      setSaved(!next);
      alert("Could not save job. Please try again.");
    } finally { saving.current = false; setSavePending(false); }
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
    if (messaging.current) return;
    messaging.current = true;
    setMsgPending(true);
    try {
      const { data, error } = await supabase.rpc("start_dm_ctx", { p_receiver_id: posterId, p_context: "jobs", p_ref_id: jobId });
      if (error || !data) throw error || new Error("Could not start conversation");
      router.push("/jobs/messages?c=" + data);
    } catch { alert("Could not open the conversation. Please try again."); }
    finally { messaging.current = false; setMsgPending(false); }
  }

  const btn = "flex items-center gap-1.5 rounded-md bg-surface px-3.5 py-2 text-[13px] text-ink/80 transition-colors hover:bg-surface-elevated hover:text-ink";

  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={toggleSave} disabled={savePending} aria-pressed={saved} className={btn + (saved ? " text-pearl" : "")}>
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