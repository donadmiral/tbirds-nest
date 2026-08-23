"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function EditPostModal({ postId, initialText, onClose }: { postId: string; initialText: string; onClose: () => void }) {
  const supabase = useRef(createClient()).current;
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) { setErr("Sign in first."); setBusy(false); return; }
    const { error } = await supabase.from("posts")
      .update({ content: text.trim(), edited_at: new Date().toISOString() })
      .eq("id", postId).eq("user_id", uid);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onClose();
    window.dispatchEvent(new Event("pc-refresh-feed"));
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-ink/10 bg-navy p-5" onClick={(e) => e.stopPropagation()}>
        <p className="flex items-center justify-between text-[15px] font-semibold text-ink">
          Edit post
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-ink/40 hover:bg-surface hover:text-ink"><X size={16} /></button>
        </p>
        <p className="mt-1 text-[12px] text-ink/45">The post will carry an Edited label.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={2000} autoFocus
          className="mt-3 w-full resize-none rounded-md bg-surface px-3 py-2.5 text-[14px] text-ink outline-none focus:bg-surface-elevated"
        />
        {err ? <p className="mt-2 text-[12px] text-danger">{err}</p> : null}
        <button onClick={save} disabled={busy || !text.trim()}
          className="mt-3 w-full rounded-md bg-pearl py-2.5 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving" : "Save changes"}
        </button>
      </div>
    </div>
  );
}