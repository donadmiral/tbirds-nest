"use client";
// Download your data: one JSON of everything on the account.
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function DownloadPage() {
  const supabase = useRef(createClient()).current;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("export-my-data", { body: {} });
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "platinum-circles-data-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMsg("Your file is downloading.");
    } catch (e: unknown) { setMsg((e as { message?: string })?.message || "Could not export."); }
    finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="mt-4 flex items-center gap-2 font-display text-[24px] font-bold text-ink"><Download size={22} className="text-pearl" /> Download your data</h1>
      <p className="mt-1 text-[13.5px] text-ink/60">One file with your profile, posts, comments, likes, saves, follows, stories, the messages you sent, listings, applications and support tickets. Only you can request it, and only for your own account.</p>
      <button type="button" onClick={run} disabled={busy} className="mt-5 rounded-full bg-ink px-5 py-2.5 text-[14px] font-bold text-white hover:opacity-90 disabled:opacity-50">{busy ? "Preparing" : "Download"}</button>
      {msg ? <p className="mt-3 text-[13px] text-ink/70">{msg}</p> : null}
    </div>
  );
}