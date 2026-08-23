"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, Link2, Send, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadConversations, type Conv } from "@/lib/messages";

function recordShare(postId: string) {
  const supabase = createClient();
  supabase.rpc("increment_share_count", { p_post_id: postId }).then(() => {}, () => {});
}

export function ShareMenu({ postId, sharesCount }: { postId: string; sharesCount?: number }) {
  const supabase = useRef(createClient()).current;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [sendMode, setSendMode] = useState(false);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [n, setN] = useState(sharesCount ?? 0);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setSendMode(false); }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const url = () => window.location.origin + "/post/" + postId;

  async function copyLink() {
    await navigator.clipboard.writeText(url());
    recordShare(postId);
    setN((v) => v + 1);
    setCopied(true);
    setTimeout(() => { setCopied(false); setOpen(false); }, 900);
  }

  async function systemShare() {
    if (!navigator.share) { copyLink(); return; }
    try {
      await navigator.share({ url: url() });
      recordShare(postId);
      setN((v) => v + 1);
      setOpen(false);
    } catch { /* cancelled shares do not count, the phone's rule */ }
  }

  async function openSend() {
    setSendMode(true);
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    const list = await loadConversations(uid, "personal");
    setConvs(list.slice(0, 8));
  }

  async function sendTo(c: Conv) {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid || sent) return;
    setSent(c.id);
    const { error } = await supabase.from("messages").insert({
      conversation_id: c.id, sender_id: uid, receiver_id: c.other_id,
      text: null, shared_post_id: postId,
    });
    if (error) { setSent(null); alert("Could not send: " + error.message); return; }
    recordShare(postId);
    setN((v) => v + 1);
    await supabase.from("conversations").update({ last_message: "Shared a post", last_message_time: new Date().toISOString(), last_message_sender_id: uid }).eq("id", c.id);
    setTimeout(() => { setSent(null); setSendMode(false); setOpen(false); }, 700);
  }

  const item = "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-ink/85 transition-colors hover:bg-surface-elevated";

  return (
    <div ref={boxRef} className="relative">
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        title="Share"
        className="flex items-center gap-1.5 text-[13px] text-ink/50 transition-colors hover:text-pearl"
      >
        <Share2 size={16} strokeWidth={1.8} />
        {n > 0 ? (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : n) : ""}
      </button>
      {open ? (
        <div className="absolute bottom-7 right-0 z-20 w-60 overflow-hidden rounded-lg border border-ink/10 bg-navy shadow-2xl">
          {sendMode ? (
            convs.length === 0 ? (
              <p className="px-3.5 py-3 text-[12px] text-ink/40">No conversations yet.</p>
            ) : (
              convs.map((c) => (
                <button key={c.id} onClick={(e) => { e.stopPropagation(); sendTo(c); }} className={item}>
                  {sent === c.id ? <Check size={15} className="text-success" /> : <Send size={15} />}
                  <span className="truncate">{c.title}</span>
                </button>
              ))
            )
          ) : (
            <>
              <button onClick={(e) => { e.stopPropagation(); copyLink(); }} className={item}>
                {copied ? <Check size={15} className="text-success" /> : <Link2 size={15} />} Copy link
              </button>
              <button onClick={(e) => { e.stopPropagation(); systemShare(); }} className={item}><Share2 size={15} /> Share via…</button>
              <button onClick={(e) => { e.stopPropagation(); openSend(); }} className={item}><Send size={15} /> Send to…</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}