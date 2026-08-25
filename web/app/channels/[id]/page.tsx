"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronUp, Radio, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const EMOJIS = ["\u2764\uFE0F", "\uD83D\uDD25", "\uD83D\uDC4F", "\uD83D\uDE02", "\uD83D\uDE2E"];

type Msg = {
  id: string; content: string | null; created_at: string;
  media_url: string | null; media_type: string | null;
  sender_name: string | null; sender_avatar: string | null; sender_role: string | null;
  reactions: Record<string, number> | null; my_reactions: string[] | null; reply_count: number | null;
};
type Reply = { id: string; content: string | null; created_at: string; user_name: string | null; user_avatar: string | null };

function relTime(iso?: string) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

function ChannelInner() {
  const supabase = useRef(createClient()).current;
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const channelId = String(params.id || "");
  const [name, setName] = useState(sp.get("n") || "Channel");
  const [iconUrl, setIconUrl] = useState<string | null>(sp.get("i"));
  const [memberCount, setMemberCount] = useState<number>(Number(sp.get("m") || 0));
  const [myRole, setMyRole] = useState<string>(sp.get("r") || "");
  const [isMember, setIsMember] = useState<boolean>(sp.get("j") === "1");
  const [seeded, setSeeded] = useState<boolean>(!!sp.get("n"));
  const [me, setMe] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, Reply[]>>({});
  const [replyDraft, setReplyDraft] = useState("");
  const [replySending, setReplySending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const canPost = myRole === "owner" || myRole === "collaborator";

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null));
  }, [supabase]);

  useEffect(() => {
    if (seeded || !channelId) return;
    (async () => {
      const { data } = await supabase.rpc("get_channels", { p_query: null, p_limit: 40 });
      const hit = ((data as any[]) ?? []).find(c => c.id === channelId);
      if (hit) {
        setName(hit.name); setIconUrl(hit.icon_url ?? null);
        setMemberCount(hit.member_count || 0); setMyRole(hit.my_role || ""); setIsMember(!!hit.is_member);
      }
      setSeeded(true);
    })();
  }, [seeded, channelId, supabase]);

  const load = useCallback(async () => {
    if (!channelId) return;
    try {
      const { data, error } = await supabase.rpc("get_channel_messages", { p_channel: channelId, p_limit: 40 });
      if (!error) {
        const rows = (data as Msg[]) ?? [];
        setMessages(rows);
        if (rows.length > 0) void supabase.rpc("mark_channel_read", { p_channel: channelId, p_message: rows[0].id });
      }
    } finally { setLoading(false); }
  }, [channelId, supabase]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, loading]);

  const join = async () => {
    setIsMember(true); setMemberCount(c => c + 1);
    const { error } = await supabase.rpc("join_channel", { p_channel: channelId });
    if (error) { setIsMember(false); setMemberCount(c => Math.max(c - 1, 0)); }
  };

  const post = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc("post_channel_message", { p_channel: channelId, p_content: body });
      if (error) throw error;
      const mine: Msg = {
        id: typeof data === "string" ? data : (data as any)?.id || "tmp-" + Date.now(),
        content: body, created_at: new Date().toISOString(),
        media_url: null, media_type: null,
        sender_name: "You", sender_avatar: null, sender_role: myRole,
        reactions: {}, my_reactions: [], reply_count: 0,
      };
      setMessages(prev => [mine, ...prev]);
      setDraft("");
    } catch { /* keep draft */ } finally { setSending(false); }
  };

  const react = (msg: Msg, emoji: string) => {
    if (!me) return;
    setMessages(prev => prev.map(m => {
      if (m.id !== msg.id) return m;
      const mine: string[] = Array.isArray(m.my_reactions) ? [...m.my_reactions] : [];
      const counts = { ...(m.reactions || {}) } as Record<string, number>;
      const has = mine.includes(emoji);
      if (has) { counts[emoji] = Math.max((counts[emoji] || 1) - 1, 0); if (counts[emoji] === 0) delete counts[emoji]; }
      else { counts[emoji] = (counts[emoji] || 0) + 1; }
      return { ...m, reactions: counts, my_reactions: has ? mine.filter(e => e !== emoji) : [...mine, emoji] };
    }));
    void supabase.rpc("react_channel_message", { p_message: msg.id, p_emoji: emoji });
  };

  const toggleThread = async (msg: Msg) => {
    if (openThread === msg.id) { setOpenThread(null); return; }
    setOpenThread(msg.id); setReplyDraft("");
    if (!replies[msg.id]) {
      const { data } = await supabase.rpc("get_channel_replies", { p_message: msg.id, p_limit: 60 });
      setReplies(prev => ({ ...prev, [msg.id]: (data as Reply[]) ?? [] }));
    }
  };

  const sendReply = async (msg: Msg) => {
    const body = replyDraft.trim();
    if (!body || replySending) return;
    setReplySending(true);
    try {
      const { error } = await supabase.rpc("reply_channel_message", { p_message: msg.id, p_content: body });
      if (error) throw error;
      const mine: Reply = { id: "tmp-" + Date.now(), content: body, created_at: new Date().toISOString(), user_name: "You", user_avatar: null };
      setReplies(prev => ({ ...prev, [msg.id]: [...(prev[msg.id] || []), mine] }));
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, reply_count: (m.reply_count || 0) + 1 } : m));
      setReplyDraft("");
    } catch { /* keep draft */ } finally { setReplySending(false); }
  };

  const ordered = [...messages].reverse();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[640px] flex-col px-4">
      <div className="sticky top-0 z-20 -mx-4 flex items-center gap-2.5 border-b border-ink/10 bg-white/85 px-4 py-2.5 backdrop-blur-md">
        <Link href="/channels" className="rounded-full p-1.5 text-ink/60 hover:bg-black/5" aria-label="Back"><ArrowLeft size={18} /></Link>
        {iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={iconUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0B1E3D] text-white"><Radio size={15} /></span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink">{name}</p>
          <p className="text-[11.5px] text-ink/45">{String(memberCount)} {memberCount === 1 ? "member" : "members"}</p>
        </div>
      </div>

      <div className="flex-1 py-4">
        {loading ? (
          <p className="py-16 text-center text-sm text-ink/40">Loading…</p>
        ) : ordered.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink/40">{canPost ? "Post the first update." : "No updates yet."}</p>
        ) : (
          ordered.map(m => (
            <div key={m.id} className="mb-5">
              <div className="flex items-center gap-2">
                {m.sender_avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.sender_avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/5 text-[11px] font-bold text-[#0B1E3D]">{(m.sender_name || "C").charAt(0).toUpperCase()}</span>
                )}
                <span className="text-[13px] font-semibold text-ink">{m.sender_name || "Channel"}</span>
                {m.sender_role ? <span className="rounded-full bg-ink/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/50">{m.sender_role}</span> : null}
                <span className="text-[11.5px] text-ink/35">{relTime(m.created_at)}</span>
              </div>
              <div className="ml-9 mt-1 rounded-2xl rounded-tl-md bg-ink/[0.04] px-3.5 py-2.5">
                {m.content ? <p className="whitespace-pre-wrap text-[14px] leading-snug text-ink">{m.content}</p> : null}
                {m.media_url && m.media_type !== "video" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.media_url} alt="" className="mt-2 max-h-[340px] w-auto max-w-full rounded-lg object-contain" />
                ) : null}
                {m.media_url && m.media_type === "video" ? (
                  <video src={m.media_url} controls playsInline className="mt-2 max-h-[340px] w-auto max-w-full rounded-lg" />
                ) : null}
              </div>
              <div className="ml-9 mt-1.5 flex flex-wrap items-center gap-1.5">
                {Object.entries(m.reactions || {}).map(([em, n]) => (
                  <button key={em} onClick={() => react(m, em)}
                    className={"rounded-full border px-2 py-0.5 text-[12px] " + ((m.my_reactions || []).includes(em) ? "border-ink/40 bg-ink/5 font-semibold text-ink" : "border-ink/10 text-ink/60")}>
                    {em} {String(n)}
                  </button>
                ))}
                {me ? EMOJIS.filter(em => !(m.reactions || {})[em]).slice(0, 3).map(em => (
                  <button key={em} onClick={() => react(m, em)} className="rounded-full px-1 py-0.5 text-[12px] opacity-35 hover:opacity-90">{em}</button>
                )) : null}
                <button onClick={() => toggleThread(m)} className="ml-1 inline-flex items-center gap-1 text-[12px] font-semibold text-ink/50 hover:text-ink">
                  {openThread === m.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {String(m.reply_count || 0)} {m.reply_count === 1 ? "reply" : "replies"}
                </button>
              </div>
              {openThread === m.id ? (
                <div className="ml-9 mt-2 border-l-2 border-ink/10 pl-3">
                  {(replies[m.id] || []).map(r => (
                    <div key={r.id} className="mb-2">
                      <p className="text-[12.5px]"><span className="font-semibold text-ink">{r.user_name || "Member"}</span> <span className="text-ink/35">{relTime(r.created_at)}</span></p>
                      <p className="whitespace-pre-wrap text-[13.5px] text-ink/85">{r.content}</p>
                    </div>
                  ))}
                  {me && isMember ? (
                    <div className="mt-1 flex items-center gap-2">
                      <input value={replyDraft} onChange={e => setReplyDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") void sendReply(m); }}
                        placeholder="Reply" className="w-full rounded-full bg-ink/5 px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink/40" />
                      <button onClick={() => sendReply(m)} disabled={!replyDraft.trim() || replySending} className="rounded-full bg-ink p-1.5 text-white disabled:opacity-30" aria-label="Send reply"><Send size={13} /></button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 -mx-4 border-t border-ink/10 bg-white/90 px-4 py-2.5 backdrop-blur-md">
        {canPost ? (
          <div className="flex items-center gap-2">
            <input value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void post(); }}
              placeholder="Post an update" className="w-full rounded-full bg-ink/5 px-4 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink/40" />
            <button onClick={post} disabled={!draft.trim() || sending} className="rounded-full bg-ink p-2.5 text-white disabled:opacity-30" aria-label="Post"><Send size={15} /></button>
          </div>
        ) : !me ? (
          <p className="py-1 text-center text-[13px] text-ink/50">Sign in to join this channel.</p>
        ) : !isMember ? (
          <button onClick={join} className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white">Join channel</button>
        ) : (
          <p className="py-1 text-center text-[12.5px] text-ink/45">Only the owner and collaborators post here. React and reply to join in.</p>
        )}
      </div>
    </main>
  );
}

export default function ChannelPage() {
  return (
    <Suspense fallback={null}>
      <ChannelInner />
    </Suspense>
  );
}
