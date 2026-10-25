"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, Link2, Send, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadConversations, type Conv } from "@/lib/messages";
import { sharePostToConversation } from "@/lib/postSharing";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; if (timer.current) clearTimeout(timer.current); }; }, []);
  const [n, setN] = useState(sharesCount ?? 0);
  useEffect(() => { setN(sharesCount ?? 0); }, [sharesCount, postId]);
  useEffect(() => { generation.current++; setError(null); setSent(null); setConvs([]); setGroups([]); setCommunities([]); setOpen(false); setSendMode(false); setCopied(false); }, [postId]);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
      generation.current++; setConvs([]); setGroups([]); setCommunities([]); setSendMode(false); setOpen(false);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setOpen(false); setSendMode(false); } }
    document.addEventListener("keydown", onKey);
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setSendMode(false); }
    }
    document.addEventListener("mousedown", onDoc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const url = () => window.location.origin + "/post/" + postId;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url());
      if (!alive.current) return;
      recordShare(postId); setN(v => v + 1); setCopied(true); setError(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (alive.current) { setCopied(false); setOpen(false); } }, 900);
    } catch { setError("The link could not be copied. Check your browser's clipboard permission and retry."); }
  }

  async function systemShare() {
    if (!navigator.share) { await copyLink(); return; }
    try {
      await navigator.share({ url: url() });
      if (!alive.current) return;
      recordShare(postId); setN(v => v + 1); setOpen(false);
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setError("Sharing failed. Try copying the link."); }
  }

  async function openSend() {
    const attempt = ++generation.current;
    const current = () => alive.current && attempt === generation.current;
    setSendMode(true); setLoading(true); setError(null); setSent(null);
    setConvs([]); setGroups([]); setCommunities([]);
    try {
      const { data, error: authError } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (authError || !uid) throw new Error("Sign in to share to a conversation.");
      const [list, cm] = await Promise.all([
        loadConversations(uid, "personal"),
        supabase.from("community_members").select("community_id").eq("user_id", uid).limit(100),
      ]);
      if (cm.error) throw new Error("Your communities could not be loaded. Please retry.");
      const cids = Array.from(new Set((cm.data ?? []).map(row => row.community_id).filter(Boolean)));
      let communityRows: { id: string; name: string; emoji: string | null }[] = [];
      if (cids.length) {
        const result = await supabase.from("communities").select("id, name, emoji").in("id", cids).order("name").limit(30);
        if (result.error) throw new Error("Your communities could not be loaded. Please retry.");
        communityRows = result.data ?? [];
      }
      const session = await supabase.auth.getSession();
      if (!current() || session.data.session?.user.id !== uid) return;
      setConvs(list.filter(c => !c.is_group).slice(0, 30));
      setGroups(list.filter(c => c.is_group).slice(0, 30).map(c => ({ id: c.id, name: c.title, emoji: null })));
      setCommunities(communityRows);
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : "Conversations could not be loaded. Please retry."); }
    finally { if (current()) setLoading(false); }
  }

  async function sendToConversation(destination: string, receiverId: string | null, community = false) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(null); setSent(null);
    const attempt = generation.current;
    try {
      const { data, error: authError } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (authError || !uid) throw new Error("Sign in again before sharing.");
      let convId = destination;
      if (community) {
        const result = await supabase.rpc("ensure_community_conversation", { p_community: destination });
        if (result.error || !result.data) throw new Error("The community conversation could not be opened. Retry shortly.");
        convId = result.data as string;
      }
      const result = await sharePostToConversation(supabase, uid, postId, convId, receiverId);
      if (!alive.current || attempt !== generation.current) return;
      if (result.status === 'pending') { setError("Saved for delivery. Open Messages to check or retry this share."); return; }
      if (result.status !== 'confirmed') { setError("The post could not be shared. Open Messages to review or retry it."); return; }
      setSent(destination); recordShare(postId); setN(v => v + 1);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (alive.current && attempt === generation.current) { setSent(null); setSendMode(false); setOpen(false); } }, 700);
    } catch (e) { if (alive.current && attempt === generation.current) setError(e instanceof Error ? e.message : "Sharing failed. Please retry."); }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  }

  const item = "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-ink/85 transition-colors hover:bg-surface-elevated";

  return (
    <div ref={boxRef} className="relative">
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        title="Share" aria-label="Share post" aria-expanded={open} aria-haspopup="dialog"
        className="flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-accent"
      >
        <Share2 size={16} strokeWidth={1.8} />
        {n > 0 ? (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : n) : ""}
      </button>
      {open ? (
        <div role="dialog" aria-label="Share post" className="absolute bottom-7 right-0 z-20 w-72 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto rounded-lg border border-ink/10 bg-surface shadow-2xl">
          {error ? <p role="status" className="px-3.5 py-3 text-[12px] text-danger">{error}{sendMode ? <button className="ml-2 underline" disabled={busy || loading} onClick={() => void openSend()}>Retry loading</button> : null}</p> : null}
          {busy ? <p role="status" className="px-3.5 pt-3 text-[12px] text-muted">Sending…</p> : null}
          {sendMode ? (
            loading ? <p role="status" className="px-3.5 py-3 text-[12px] text-muted">Loading conversations…</p> : convs.length === 0 && groups.length === 0 && communities.length === 0 ? (
              <p className="px-3.5 py-3 text-[12px] text-muted">{error ? "" : "No conversations yet."}</p>
            ) : (
              <>
                {convs.map((c) => (
                  <button key={c.id} onClick={(e) => { e.stopPropagation(); sendToConversation(c.id, c.other_id); }} className={item} disabled={busy || !!sent}>
                    {sent === c.id ? <Check size={15} className="text-success" /> : <Send size={15} />}
                    <span className="truncate">{c.title}</span>
                  </button>
                ))}
                {groups.length ? <p className="px-3.5 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-wider text-muted">Groups</p> : null}
                {groups.map((g) => (
                  <button key={g.id} onClick={(e) => { e.stopPropagation(); sendToConversation(g.id, null); }} className={item} disabled={busy || !!sent}>
                    {sent === g.id ? <Check size={15} className="text-success" /> : <span className="w-[15px] text-center text-[13px]">{g.emoji || "\u{1F465}"}</span>}
                    <span className="truncate">{g.name}</span>
                  </button>
                ))}
                {communities.length ? <p className="px-3.5 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-wider text-muted">Communities</p> : null}
                {communities.map((c) => (
                  <button key={c.id} onClick={(e) => { e.stopPropagation(); sendToConversation(c.id, null, true); }} className={item} disabled={busy || !!sent}>
                    <span className="w-[15px] text-center text-[13px]">{c.emoji || "\u{1F3DB}\uFE0F"}</span>
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </>
            )
          ) : (
            <>
              <button onClick={(e) => { e.stopPropagation(); copyLink(); }} className={item} disabled={busy || !!sent}>
                {copied ? <Check size={15} className="text-success" /> : <Link2 size={15} />} Copy link
              </button>
              <button onClick={(e) => { e.stopPropagation(); systemShare(); }} className={item} disabled={busy || !!sent}><Share2 size={15} /> Share via…</button>
              <button onClick={(e) => { e.stopPropagation(); openSend(); }} className={item} disabled={busy || !!sent}><Send size={15} /> Send to…</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}