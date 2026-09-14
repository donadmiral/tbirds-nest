"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AtSign, Bell, Briefcase, CreditCard, Heart, MessageCircle, MessageSquare, Phone, Radio, Shield, Smile, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Instagram's categories, one switch each. These decide which kinds of activity reach the phone as a push;
// the Activity list always shows everything. The server maps every notification type to one category.
const CATEGORIES: { key: string; icon: React.ReactNode; label: string; sub: string }[] = [
  { key: "messages", icon: <MessageCircle size={16} />, label: "Messages", sub: "Direct messages, group messages and message requests" },
  { key: "message_reactions", icon: <Smile size={16} />, label: "Message reactions", sub: "Reactions to your messages" },
  { key: "calls", icon: <Phone size={16} />, label: "Calls", sub: "Incoming and missed voice and video calls" },
  { key: "likes", icon: <Heart size={16} />, label: "Likes", sub: "Likes on your posts, stories and comments, and reposts" },
  { key: "comments", icon: <MessageSquare size={16} />, label: "Comments", sub: "Comments on your posts and replies to your comments" },
  { key: "mentions", icon: <AtSign size={16} />, label: "Mentions and tags", sub: "When someone mentions or tags you in a post or story" },
  { key: "followers", icon: <UserPlus size={16} />, label: "Followers", sub: "New followers, follow requests and accepted requests" },
  { key: "updates", icon: <Radio size={16} />, label: "Content updates", sub: "Community and collab invitations, channel posts and business pages" },
  { key: "jobs", icon: <Briefcase size={16} />, label: "Jobs", sub: "Applications and referrals on your job posts" },
  { key: "payments", icon: <CreditCard size={16} />, label: "Payments", sub: "Money received in chat" },
  { key: "account", icon: <Shield size={16} />, label: "Account notices", sub: "Security alerts, sign-ins and system notices" },
];

export default function NotificationSettingsPage() {
  const supabase = useRef(createClient()).current;
  const [uid, setUid] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id ?? null;
      if (!alive) return;
      setUid(id);
      if (!id) { setPrefs({}); return; }
      const { data, error } = await supabase.from("profiles").select("notif_prefs").eq("id", id).maybeSingle();
      if (!alive) return;
      if (error) { setErr(error.message); setPrefs({}); return; }
      setPrefs(((data as { notif_prefs?: Record<string, boolean> } | null)?.notif_prefs) || {});
    })();
    return () => { alive = false; };
  }, [supabase]);

  const set = async (key: string, on: boolean) => {
    if (!uid || !prefs) return;
    const prev = prefs;
    const next = { ...prefs };
    if (on) delete next[key]; else next[key] = false;
    setPrefs(next);
    const { error } = await supabase.from("profiles").update({ notif_prefs: next }).eq("id", uid);
    if (error) { setPrefs(prev); alert("Not saved: " + error.message); }
  };

  const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
    <button onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label}
      className={"relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[140ms] " + (on ? "bg-pearl" : "bg-ink/20")}
    >
      <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-[140ms] " + (on ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/settings" aria-label="Back to Settings" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><Bell size={19} className="text-pearl" /> Notifications</h1>
      <p className="pb-5 text-[13px] text-ink/50">Choose which kinds of activity reach your phone as a push. The Activity list always shows everything, and quiet hours are set on the phone.</p>
      {err ? <p className="pb-3 text-sm text-red-400">{err}</p> : null}
      {prefs === null ? <p className="py-10 text-center text-sm text-ink/40">Loading</p> : (
        <div className="flex flex-col gap-2">
          {CATEGORIES.map((c) => (
            <div key={c.key} className="flex items-center gap-3 rounded-lg border border-ink/10 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pearl/15 text-pearl">{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ink">{c.label}</span>
                <span className="block text-[12px] text-ink/50">{c.sub}</span>
              </span>
              <Toggle on={prefs[c.key] !== false} onChange={(v) => set(c.key, v)} label={c.label} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
