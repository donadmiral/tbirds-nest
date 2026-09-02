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
  const [groups, setGroups] = useState<{ id: string; name: string; emoji: string | null }[]>([]);
  const [communities, setCommunities] = useState<{ id: string; name: string; emoji: string | null }[]>([]);
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
    // Groups you belong to and communities you are in, same as the phone's sheet.
    try {
      const { data: mem } = await supabase.from("conversation_members").select("conversation_id").eq("user_id", uid);
      const gids = Array.from(new Set((mem || []).map((r: any) => r.conversation_id).filter(Boolean)));
      if (gids.length) {
        const { data: gs } = await supabase.from("conversations").select("id, group_name, group_emoji, last_message_time").eq("is_group", true).in("id", gids).order("last_message_time", { ascending: false }).limit(8);
        setGroups((gs || []).map((g: any) => ({ id: g.id, name: g.group_name || "Group", emoji: g.group_emoji ?? null })));
      } else setGroups([]);
      const { data: cm } = await supabase.from("community_members").select("community_id").eq("user_id", uid);
      const cids = Array.from(new Set((cm || []).map((r: any) => r.community_id).filter(Boolean)));
      if (cids.length) {
        const { data: cs } = await supabase.from("communities").select("id, name, emoji").in("id", cids).order("name").limit(8);
        setCommunities((cs || []).map((c: any) => ({ id: c.id, name: c.name, emoji: c.emoji ?? null })));
      } else setCommunities([]);
    } catch { setGroups([]); setCommunities([]); }
  }

  async function sendToConversation(convId: string, receiverId: string | null) {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid || sent) return;
    setSent(convId);
    const { error } = await supabase.from("messages").insert({ conversation_id: convId, sender_id: uid, receiver_id: receiverId, text: null, shared_post_id: postId });
    if (error) { setSent(null); alert("Could not send: " + error.message); return; }
    recordShare(postId);
    setN((v) => v + 1);
    await supabase.from("conversations").update({ last_message: "Shared a post", last_message_time: new Date().toISOString(), last_message_sender_id: uid }).eq("id", convId);
    setTimeout(() => { setSent(null); setSendMode(false); setOpen(false); }, 700);
  }

  async function sendToCommunity(communityId: string) {
    if (sent) return;
    const { data: convId, error } = await supabase.rpc("ensure_community_conversation", { p_community: communityId });
    if (error || !convId) { alert("Could not send: " + (error?.message || "no conversation")); return; }
    await sendToConversation(convId as string, null);
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
            convs.length === 0 && groups.length === 0 && communities.length === 0 ? (
              <p className="px-3.5 py-3 text-[12px] text-ink/40">No conversations yet.</p>
            ) : (
              <>
                {convs.map((c) => (
                  <button key={c.id} onClick={(e) => { e.stopPropagation(); sendTo(c); }} className={item}>
                    {sent === c.id ? <Check size={15} className="text-success" /> : <Send size={15} />}
                    <span className="truncate">{c.title}</span>
                  </button>
                ))}
                {groups.length ? <p className="px-3.5 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-wider text-ink/45">Groups</p> : null}
                {groups.map((g) => (
                  <button key={g.id} onClick={(e) => { e.stopPropagation(); sendToConversation(g.id, null); }} className={item}>
                    {sent === g.id ? <Check size={15} className="text-success" /> : <span className="w-[15px] text-center text-[13px]">{g.emoji || "\u{1F465}"}</span>}
                    <span className="truncate">{g.name}</span>
                  </button>
                ))}
                {communities.length ? <p className="px-3.5 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-wider text-ink/45">Communities</p> : null}
                {communities.map((c) => (
                  <button key={c.id} onClick={(e) => { e.stopPropagation(); sendToCommunity(c.id); }} className={item}>
                    <span className="w-[15px] text-center text-[13px]">{c.emoji || "\u{1F3DB}\uFE0F"}</span>
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </>
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