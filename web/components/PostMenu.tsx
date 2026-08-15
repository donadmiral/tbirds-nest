"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Copy, EyeOff, Flag, Ban, Trash2, Check, BarChart3 } from "lucide-react";
import { InsightsModal } from "@/components/InsightsModal";
import { PromoteModal } from "@/components/PromoteModal";
import { Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const REASONS = [
  { key: "spam", label: "Spam" },
  { key: "harassment", label: "Harassment" },
  { key: "false_information", label: "False information" },
  { key: "inappropriate", label: "Inappropriate content" },
];

export function PostMenu({ postId, authorId, text, onHidden }: {
  postId: string;
  authorId: string;
  text: string;
  onHidden: () => void;
}) {
  const supabase = useRef(createClient()).current;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null));
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setReporting(false); }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const mine = uid !== null && uid === authorId;
  const item = "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-white/85 transition-colors hover:bg-surface-elevated";

  async function copyText() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => { setCopied(false); setOpen(false); }, 900);
  }

  async function notInterested() {
    if (!uid) return;
    setOpen(false);
    onHidden();
    await supabase.from("hidden_posts").upsert({ user_id: uid, post_id: postId });
  }

  async function report(reason: string) {
    if (!uid) return;
    setOpen(false);
    setReporting(false);
    const { error } = await supabase.from("post_reports").insert({ reporter_id: uid, post_id: postId, reason });
    alert(error ? "Could not send the report: " + error.message : "Report sent. Thank you.");
  }

  async function blockAuthor() {
    if (!uid) return;
    if (!window.confirm("Block this person? You will not see each other on Platinum Circles.")) return;
    setOpen(false);
    onHidden();
    await supabase.from("blocked_users").upsert({ blocker_id: uid, blocked_id: authorId });
  }

  async function deletePost() {
    if (!uid || !mine) return;
    if (!window.confirm("Delete this post permanently?")) return;
    setOpen(false);
    const { error } = await supabase.from("posts").delete().eq("id", postId).eq("user_id", uid);
    if (error) { alert("Could not delete: " + error.message); return; }
    onHidden();
  }

  return (
    <div ref={boxRef} className="relative ml-auto shrink-0">
      {insightsOpen ? <InsightsModal postId={postId} onClose={() => setInsightsOpen(false)} /> : null}
      {promoteOpen ? <PromoteModal postId={postId} onClose={() => setPromoteOpen(false)} /> : null}
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        title="More"
        className="rounded-full p-1.5 text-white/40 transition-colors hover:bg-surface hover:text-white"
      >
        <MoreHorizontal size={17} />
      </button>
      {open ? (
        <div className="absolute right-0 top-8 z-20 w-56 overflow-hidden rounded-lg border border-white/10 bg-navy shadow-2xl">
          {reporting ? (
            REASONS.map((r) => (
              <button key={r.key} onClick={() => report(r.key)} className={item}>
                <Flag size={15} /> {r.label}
              </button>
            ))
          ) : (
            <>
              <button onClick={copyText} className={item}>
                {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />} Copy post text
              </button>
              {!mine ? (
                <>
                  <button onClick={notInterested} className={item}><EyeOff size={15} /> Not interested</button>
                  <button onClick={() => setReporting(true)} className={item}><Flag size={15} /> Report post</button>
                  <button onClick={blockAuthor} className={item + " text-danger"}><Ban size={15} /> Block author</button>
                </>
              ) : (
                <>
                <button onClick={() => { setOpen(false); setInsightsOpen(true); }} className={item}><BarChart3 size={15} /> View insights</button>
                <button onClick={() => { setOpen(false); setPromoteOpen(true); }} className={item}><Megaphone size={15} /> Promote post</button>
                <button onClick={deletePost} className={item + " text-danger"}><Trash2 size={15} /> Delete post</button>
                </>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}