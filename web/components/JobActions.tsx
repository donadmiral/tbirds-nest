"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/app/jobs/JobsWorkspace.module.css";
import { useRouter } from "next/navigation";
import { Bookmark, Share2, MessageCircle, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function JobActions({ jobId, posterId, initiallySaved, viewerId }: {
  jobId: string; posterId: string; initiallySaved: boolean; viewerId: string | null;
}) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [copied, setCopied] = useState(false);
  const [msgPending, setMsgPending] = useState(false);
  const saving = useRef(false);
  const messaging = useRef(false);
  const [savePending, setSavePending] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function toggleSave() {
    if (!viewerId) { router.push("/login"); return; }
    if (saving.current) return;
    saving.current = true;
    setSavePending(true); setError("");
    const next = !saved;
    setSaved(next);
    try {
      const { error } = next
        ? await supabase.from("job_saves").insert({ user_id: viewerId, job_id: jobId })
        : await supabase.from("job_saves").delete().eq("user_id", viewerId).eq("job_id", jobId);
      if (error && error.code !== "23505") throw error;
    } catch {
      setSaved(!next);
      setError("Could not save the job. Please try again.");
    } finally { saving.current = false; setSavePending(false); }
  }

  async function share() {
    const url = window.location.origin + "/jobs/" + jobId;
    setError("");
    try {
      if (navigator.share) {
        try { await navigator.share({ url }); return; }
        catch (reason) { if (reason instanceof Error && reason.name === "AbortError") return; }
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } catch { setError("The link couldn’t be copied. Copy the page address to share this role."); }
  }

  async function messageEmployer() {
    if (!viewerId) { router.push("/login"); return; }
    if (messaging.current) return;
    messaging.current = true;
    setMsgPending(true); setError("");
    try {
      const { data, error } = await supabase.rpc("start_dm_ctx", { p_receiver_id: posterId, p_context: "jobs", p_ref_id: jobId });
      if (error || !data) throw error || new Error("Could not start conversation");
      router.push("/jobs/messages?c=" + data);
    } catch { setError("Could not open the conversation. Please try again."); }
    finally { messaging.current = false; setMsgPending(false); }
  }

  const btn = styles.button;

  return (
    <div><div className={styles.actions}>
      <button onClick={toggleSave} disabled={savePending} aria-pressed={saved} className={btn + (saved ? " text-accent" : "")}>
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
    </div>{error ? <p role="alert" className={styles.error + " mt-2"}>{error}</p> : copied ? <p role="status" className={styles.help + " mt-2"}>Job link copied.</p> : null}</div>
  );
}