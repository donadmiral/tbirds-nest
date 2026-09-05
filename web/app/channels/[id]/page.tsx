"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, BarChart2, Camera, Check, ChevronDown, ChevronUp, HelpCircle, Image as ImageIcon, Plus, Radio, Send, Settings2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";

const EMOJIS = ["\u2764\uFE0F", "\uD83D\uDD25", "\uD83D\uDC4F", "\uD83D\uDE02", "\uD83D\uDE2E"];

type PollOpt = { id: string; label: string; votes: number };
type Poll = { ends_at: string; total: number; my_option: string | null; options: PollOpt[] };
type Msg = {
  id: string; content: string | null; created_at: string;
  media_url: string | null; media_type: string | null;
  sender_name: string | null; sender_avatar: string | null; sender_role: string | null;
  reactions: Record<string, number> | null; my_reactions: string[] | null; reply_count: number | null;
  is_prompt?: boolean; poll?: Poll | null;
};
type Reply = { id: string; content: string | null; created_at: string; user_name: string | null; user_avatar: string | null };
type Member = { user_id: string; full_name: string | null; username: string | null; avatar_url: string | null; role: string; notification_level: string };

function relTime(iso?: string) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

function pollTimeLeft(endsAt?: string) {
  if (!endsAt) return "";
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "Final results";
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "Ends soon";
  if (h < 24) return "Ends in " + String(h) + "h";
  return "Ends in " + String(Math.floor(h / 24)) + "d";
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
  const [repliesEnabled, setRepliesEnabled] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [promptMode, setPromptMode] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQ, setPollQ] = useState("");
  const [pollOpts, setPollOpts] = useState<string[]>(["", ""]);
  const [pollDays, setPollDays] = useState(3);
  const [pollBusy, setPollBusy] = useState(false);
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

  useEffect(() => {
    if (!isMember || !channelId) return;
    (async () => {
      const { data } = await supabase.rpc("get_channel_settings", { p_channel: channelId });
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        setRepliesEnabled(row.replies_enabled !== false);
        if (row.icon_url) setIconUrl(row.icon_url);
        if (row.name) setName(row.name);
        if (typeof row.member_count === "number") setMemberCount(row.member_count);
      }
    })();
  }, [isMember, channelId, supabase]);

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
      const { data, error } = await supabase.rpc("post_channel_message", { p_channel: channelId, p_content: body, p_is_prompt: promptMode });
      if (error) throw error;
      const mine: Msg = {
        id: typeof data === "string" ? data : (data as any)?.id || "tmp-" + Date.now(),
        content: body, created_at: new Date().toISOString(),
        media_url: null, media_type: null,
        sender_name: "You", sender_avatar: null, sender_role: myRole,
        reactions: {}, my_reactions: [], reply_count: 0, is_prompt: promptMode, poll: null,
      };
      setMessages(prev => [mine, ...prev]);
      setDraft(""); setPromptMode(false);
    } catch { /* keep draft */ } finally { setSending(false); }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !me || attaching) return;
    setAttaching(true);
    try {
      const isVideo = file.type.startsWith("video");
      const ext = (file.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase().replace("jpeg", "jpg");
      const path = me + "/channel_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
      const up = await supabase.storage.from("chat-media").upload(path, file, { contentType: file.type || (isVideo ? "video/mp4" : "image/jpeg") });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
      const url = pub.publicUrl;
      const body = draft.trim();
      const { data, error } = await supabase.rpc("post_channel_message", {
        p_channel: channelId, p_content: body || null, p_media_url: url, p_media_type: isVideo ? "video" : "image", p_is_prompt: promptMode,
      });
      if (error) throw error;
      const mine: Msg = {
        id: typeof data === "string" ? data : (data as any)?.id || "tmp-" + Date.now(),
        content: body || null, created_at: new Date().toISOString(),
        media_url: url, media_type: isVideo ? "video" : "image",
        sender_name: "You", sender_avatar: null, sender_role: myRole,
        reactions: {}, my_reactions: [], reply_count: 0, is_prompt: promptMode, poll: null,
      };
      setMessages(prev => [mine, ...prev]);
      setDraft(""); setPromptMode(false);
    } catch (err: any) { alert(err?.message || "Could not post the media."); }
    finally { setAttaching(false); }
  };

  const createPoll = async () => {
    const question = pollQ.trim();
    const opts = pollOpts.map(o => o.trim()).filter(Boolean);
    if (!question || opts.length < 2 || pollBusy) return;
    setPollBusy(true);
    try {
      const { error } = await supabase.rpc("post_channel_poll", { p_channel: channelId, p_question: question, p_options: opts, p_days: pollDays });
      if (error) throw error;
      setPollOpen(false); setPollQ(""); setPollOpts(["", ""]); setPollDays(3);
      setLoading(true);
      await load();
    } catch (err: any) { alert(err?.message || "Could not create the poll."); }
    finally { setPollBusy(false); }
  };

  const votePoll = async (msg: Msg, optionId: string) => {
    if (!me) return;
    if (!isMember) { void join(); return; }
    const poll = msg.poll;
    if (!poll || new Date(poll.ends_at).getTime() < Date.now() || poll.my_option === optionId) return;
    setMessages(prev => prev.map(m => {
      if (m.id !== msg.id || !m.poll) return m;
      const hadVote = !!m.poll.my_option;
      const options = (m.poll.options || []).map(o => {
        let votes = o.votes || 0;
        if (o.id === m.poll!.my_option) votes = Math.max(votes - 1, 0);
        if (o.id === optionId) votes = votes + 1;
        return { ...o, votes };
      });
      return { ...m, poll: { ...m.poll, options, my_option: optionId, total: (m.poll.total || 0) + (hadVote ? 0 : 1) } };
    }));
    const { error } = await supabase.rpc("vote_channel_poll", { p_message: msg.id, p_option: optionId });
    if (error) alert(error.message);
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
        {isMember ? (
          <button onClick={() => setSettingsOpen(true)} className="rounded-full p-2 text-ink/60 hover:bg-black/5" aria-label="Channel settings"><Settings2 size={17} /></button>
        ) : null}
      </div>

      <div className="flex-1 py-4">
        {loading ? (
          <p className="py-16 text-center text-sm text-ink/40">Loading&hellip;</p>
        ) : ordered.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink/40">{canPost ? "Post the first update." : "No updates yet."}</p>
        ) : (
          ordered.map(m => {
            const poll = m.poll || null;
            const pollClosed = poll ? new Date(poll.ends_at).getTime() < Date.now() : false;
            return (
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
              <div className={"ml-9 mt-1 rounded-2xl rounded-tl-md bg-ink/[0.04] px-3.5 py-2.5" + (m.is_prompt ? " border-l-2 border-[#0B1E3D]" : "")}>
                {m.is_prompt ? (
                  <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-[#0B1E3D]/10 px-2 py-0.5 text-[11px] font-semibold text-[#0B1E3D]"><HelpCircle size={11} /> Prompt &middot; answer in the replies</span>
                ) : null}
                {m.content ? <p className="whitespace-pre-wrap text-[14px] leading-snug text-ink">{m.content}</p> : null}
                {m.media_url && m.media_type !== "video" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.media_url} alt="" className="mt-2 max-h-[340px] w-auto max-w-full rounded-lg object-contain" />
                ) : null}
                {m.media_url && m.media_type === "video" ? (
                  <video src={m.media_url} controls playsInline className="mt-2 max-h-[340px] w-auto max-w-full rounded-lg" />
                ) : null}
                {poll ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {(poll.options || []).map(o => {
                      const total = Math.max(poll.total || 0, 1);
                      const pct = Math.round(((o.votes || 0) / total) * 100);
                      const on = poll.my_option === o.id;
                      return (
                        <button key={o.id} onClick={() => votePoll(m, o.id)} disabled={pollClosed}
                          className={"relative overflow-hidden rounded-lg border bg-white text-left " + (on ? "border-[#0B1E3D]/50" : "border-ink/10") + (pollClosed ? " cursor-default" : "")}>
                          <span className={"absolute inset-y-0 left-0 " + (on ? "bg-[#0B1E3D]/20" : "bg-[#0B1E3D]/10")} style={{ width: String(Math.max(pct, 3)) + "%" }} />
                          <span className="relative flex items-center justify-between px-3 py-2">
                            <span className={"truncate pr-2 text-[13px] " + (on ? "font-bold text-[#0B1E3D]" : "text-ink")}>{o.label}</span>
                            <span className="text-[12px] font-bold text-ink/50">{(poll.total || 0) > 0 ? String(pct) + "%" : ""}</span>
                          </span>
                        </button>
                      );
                    })}
                    <span className="text-[11.5px] text-ink/45">{String(poll.total || 0)} {poll.total === 1 ? "vote" : "votes"} &middot; {pollTimeLeft(poll.ends_at)}</span>
                  </div>
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
                {repliesEnabled ? (
                  <button onClick={() => toggleThread(m)} className="ml-1 inline-flex items-center gap-1 text-[12px] font-semibold text-ink/50 hover:text-ink">
                    {openThread === m.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    {String(m.reply_count || 0)} {m.reply_count === 1 ? "reply" : "replies"}
                  </button>
                ) : null}
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
          ); })
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 -mx-4 border-t border-ink/10 bg-white/90 px-4 py-2.5 backdrop-blur-md">
        {canPost ? (
          <div>
            {promptMode ? (
              <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#0B1E3D]"><HelpCircle size={13} /> Posting as a prompt. Members answer in the replies.</p>
            ) : null}
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPromptMode(p => !p)} className={"rounded-full p-2 hover:bg-black/5 " + (promptMode ? "text-[#0B1E3D]" : "text-ink/45")} aria-label="Post a prompt" title="Prompt"><HelpCircle size={19} /></button>
              <button onClick={() => setPollOpen(true)} className="rounded-full p-2 text-ink/45 hover:bg-black/5" aria-label="Create a poll" title="Poll"><BarChart2 size={19} /></button>
              <button onClick={() => fileRef.current?.click()} disabled={attaching} className="rounded-full p-2 text-ink/45 hover:bg-black/5 disabled:opacity-40" aria-label="Attach a photo or video" title="Photo or video"><ImageIcon size={19} /></button>
              <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={onPickFile} />
              <input value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void post(); }}
                placeholder={attaching ? "Uploading&hellip;".replace("&hellip;", "\u2026") : promptMode ? "Ask your members something" : "Post an update"}
                className="w-full rounded-full bg-ink/5 px-4 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink/40" />
              <button onClick={post} disabled={!draft.trim() || sending} className="rounded-full bg-ink p-2.5 text-white disabled:opacity-30" aria-label="Post"><Send size={15} /></button>
            </div>
          </div>
        ) : !me ? (
          <p className="py-1 text-center text-[13px] text-ink/50">Sign in to join this channel.</p>
        ) : !isMember ? (
          <button onClick={join} className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white">Join channel</button>
        ) : (
          <p className="py-1 text-center text-[12.5px] text-ink/45">Only the owner and collaborators post here. React and reply to join in.</p>
        )}
      </div>

      {pollOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setPollOpen(false)}>
          <div className="w-full max-w-[440px] rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">New poll</p>
              <button onClick={() => setPollOpen(false)} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            <input value={pollQ} onChange={e => setPollQ(e.target.value)} maxLength={140} placeholder="Ask a question"
              className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
            {pollOpts.map((o, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <input value={o} maxLength={60} placeholder={"Option " + String(i + 1)}
                  onChange={e => setPollOpts(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                  className="w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
                {pollOpts.length > 2 ? (
                  <button onClick={() => setPollOpts(prev => prev.filter((_, j) => j !== i))} className="rounded-full p-1 text-ink/40 hover:text-red-600" aria-label="Remove option"><X size={15} /></button>
                ) : null}
              </div>
            ))}
            {pollOpts.length < 4 ? (
              <button onClick={() => setPollOpts(prev => [...prev, ""])} className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[#0B1E3D]"><Plus size={14} /> Add option</button>
            ) : null}
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Runs for</p>
            <div className="mb-4 flex gap-2">
              {[1, 3, 7].map(d => (
                <button key={d} onClick={() => setPollDays(d)}
                  className={"flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold " + (pollDays === d ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>
                  {d === 1 ? "1 day" : String(d) + " days"}
                </button>
              ))}
            </div>
            <button onClick={createPoll} disabled={!pollQ.trim() || pollOpts.filter(o => o.trim()).length < 2 || pollBusy}
              className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {pollBusy ? "Creating\u2026" : "Create poll"}
            </button>
          </div>
        </div>
      ) : null}

      {settingsOpen && isMember ? (
        <ChannelSettings channelId={channelId} myRole={myRole} meId={me} onClose={() => setSettingsOpen(false)}
          onUpdated={p => {
            if (p.name) setName(p.name);
            if (p.icon_url) setIconUrl(p.icon_url);
            if (typeof p.replies_enabled === "boolean") setRepliesEnabled(p.replies_enabled);
          }} />
      ) : null}
    </main>
  );
}

function ChannelSettings({ channelId, myRole, meId, onClose, onUpdated }: {
  channelId: string; myRole: string; meId: string | null; onClose: () => void;
  onUpdated: (p: { name?: string; icon_url?: string; replies_enabled?: boolean }) => void;
}) {
  const supabase = useRef(createClient()).current;
  const isOwner = myRole === "owner";
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [audience, setAudience] = useState<"everyone" | "followers">("everyone");
  const [replies, setReplies] = useState(true);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [myLevel, setMyLevel] = useState("all");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [inviting, setInviting] = useState<string | null>(null);
  const iconRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      const [st, mem] = await Promise.all([
        supabase.rpc("get_channel_settings", { p_channel: channelId }),
        supabase.rpc("get_channel_members", { p_channel: channelId, p_limit: 100 }),
      ]);
      const row = Array.isArray(st.data) ? st.data[0] : st.data;
      if (row) {
        setName(row.name || ""); setDesc(row.description || "");
        setAudience(row.audience === "followers" ? "followers" : "everyone");
        setReplies(row.replies_enabled !== false);
        setIconUrl(row.icon_url || null);
        onUpdated({ replies_enabled: row.replies_enabled !== false });
      }
      const rows: Member[] = mem.data || [];
      setMembers(rows);
      const mine = rows.find(r => r.user_id === meId);
      if (mine) setMyLevel(mine.notification_level || "all");
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const term = q.trim();
      const { data } = await supabase.from("profiles")
        .select("id, full_name, username, avatar_url")
        .or("full_name.ilike.%" + term + "%,username.ilike.%" + term + "%")
        .limit(8);
      const taken = new Set(members.map(m => m.user_id));
      setResults((data || []).filter((r: any) => !taken.has(r.id)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, members, supabase]);

  const onPickIcon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !meId || iconBusy) return;
    setIconBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace("jpeg", "jpg");
      const path = meId + "/channel_" + channelId + "_" + Date.now() + "." + ext;
      const up = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type || "image/jpeg" });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error } = await supabase.rpc("update_channel_settings", { p_channel: channelId, p_icon_url: pub.publicUrl });
      if (error) throw error;
      setIconUrl(pub.publicUrl);
      onUpdated({ icon_url: pub.publicUrl });
    } catch (err: any) { alert(err?.message || "Could not update the icon."); }
    finally { setIconBusy(false); }
  };

  const save = async () => {
    if (!isOwner || saving || !name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("update_channel_settings", {
        p_channel: channelId, p_name: name.trim(), p_description: desc.trim() || null,
        p_audience: audience, p_replies_enabled: replies,
      });
      if (error) throw error;
      onUpdated({ name: name.trim(), replies_enabled: replies });
      onClose();
    } catch (err: any) { alert(err?.message || "Could not save."); }
    finally { setSaving(false); }
  };

  const setLevel = async (level: "all" | "highlights" | "mute") => {
    const prev = myLevel;
    setMyLevel(level);
    const { error } = await supabase.rpc("set_channel_notifications", { p_channel: channelId, p_level: level });
    if (error) { setMyLevel(prev); alert(error.message); }
  };

  const applyRole = async (m: Member, role: string) => {
    const { error } = await supabase.rpc("set_channel_role", { p_channel: channelId, p_user: m.user_id, p_role: role });
    if (error) { alert(error.message); return; }
    if (role === "remove") setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
    else setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, role } : x));
  };

  const invite = async (r: any) => {
    setInviting(r.id);
    try {
      const { error } = await supabase.rpc("set_channel_role", { p_channel: channelId, p_user: r.id, p_role: "collaborator" });
      if (error) throw error;
      setMembers(prev => [...prev, { user_id: r.id, full_name: r.full_name, username: r.username, avatar_url: r.avatar_url, role: "collaborator", notification_level: "all" }]);
      setQ(""); setResults([]);
    } catch (err: any) { alert(err?.message || "Could not invite."); }
    finally { setInviting(null); }
  };

  const roleLabel = (r: string) => r === "owner" ? "Owner" : r === "collaborator" ? "Collaborator" : r === "moderator" ? "Moderator" : null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-[520px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[15px] font-semibold text-ink">Channel settings</p>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={16} /></button>
        </div>
        {loading ? (
          <p className="py-10 text-center text-sm text-ink/40">Loading&hellip;</p>
        ) : (
          <div>
            {isOwner ? (
              <div>
                <div className="mb-4 flex flex-col items-center">
                  <button onClick={() => iconRef.current?.click()} className="relative" aria-label="Change the channel icon">
                    {iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={iconUrl} alt="" className="h-[76px] w-[76px] rounded-full object-cover" />
                    ) : (
                      <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-[#0B1E3D] text-white"><Radio size={26} /></span>
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#0B1E3D] text-white">
                      {iconBusy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Camera size={12} />}
                    </span>
                  </button>
                  <input ref={iconRef} type="file" accept="image/*" className="hidden" onChange={onPickIcon} />
                  <p className="mt-2 text-[12px] text-ink/50">Tap to change the channel icon</p>
                </div>
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Name</p>
                <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
                  className="mb-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Description</p>
                <input value={desc} onChange={e => setDesc(e.target.value)} maxLength={160} placeholder="What is it about?"
                  className="mb-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Who can join</p>
                <div className="mb-3 flex gap-2">
                  {(["everyone", "followers"] as const).map(k => (
                    <button key={k} onClick={() => setAudience(k)}
                      className={"flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold " + (audience === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>
                      {k === "everyone" ? "Everyone can join" : "My followers"}
                    </button>
                  ))}
                </div>
                <label className="mb-4 flex cursor-pointer items-center justify-between gap-3">
                  <span>
                    <span className="block text-[14px] font-semibold text-ink">Member replies</span>
                    <span className="block text-[12px] text-ink/50">Members can reply in threads under each update.</span>
                  </span>
                  <input type="checkbox" checked={replies} onChange={e => setReplies(e.target.checked)} className="h-5 w-5 accent-[#0B1E3D]" />
                </label>
                <button onClick={save} disabled={saving || !name.trim()} className="mb-4 w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                  {saving ? "Saving\u2026" : "Save changes"}
                </button>
                <div className="mb-4 h-px bg-ink/10" />
              </div>
            ) : null}

            <p className="mb-2 text-[13px] font-semibold text-ink">Notifications</p>
            <div className="mb-1.5 flex gap-2">
              {(["all", "highlights", "mute"] as const).map(k => (
                <button key={k} onClick={() => setLevel(k)}
                  className={"flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold " + (myLevel === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>
                  {k === "all" ? "All" : k === "highlights" ? "Highlights" : "Mute"}
                </button>
              ))}
            </div>
            <p className="mb-4 text-[11.5px] text-ink/45">All notifies every update. Highlights keeps it occasional. Mute stays silent.</p>
            <div className="mb-4 h-px bg-ink/10" />

            {isOwner ? (
              <div className="mb-4">
                <p className="mb-2 text-[13px] font-semibold text-ink">Invite a collaborator</p>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people"
                  className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/40" />
                {results.map(r => (
                  <div key={r.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                    {r.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0B1E3D] text-[12px] font-bold text-white">{(r.full_name || "?").charAt(0)}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-ink">{r.full_name || "Member"} <VerifiedBadge userId={r.id} size={12} /></span>
                      {r.username ? <span className="block text-[12px] text-ink/45">@{r.username}</span> : null}
                    </span>
                    <button onClick={() => invite(r)} disabled={inviting === r.id} className="rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">Invite</button>
                  </div>
                ))}
              </div>
            ) : null}

            <p className="mb-2 text-[13px] font-semibold text-ink">{members.length === 1 ? "1 member" : String(members.length) + " members"}</p>
            {members.map(m => (
              <div key={m.user_id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(m.avatar_url, 200) ?? m.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0B1E3D] text-[12px] font-bold text-white">{(m.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{m.full_name || "Member"} <VerifiedBadge userId={m.user_id} size={12} />{m.user_id === meId ? " (you)" : ""}</span>
                  {m.username ? <span className="block text-[12px] text-ink/45">@{m.username}</span> : null}
                </span>
                {roleLabel(m.role) ? <span className="rounded-full bg-[#0B1E3D]/8 px-2 py-0.5 text-[10.5px] font-bold text-[#0B1E3D]">{roleLabel(m.role)}</span> : null}
                {isOwner && m.role !== "owner" && m.user_id !== meId ? (
                  <select value={m.role} onChange={e => applyRole(m, e.target.value)} aria-label="Change role"
                    className="rounded-md border border-ink/15 bg-white px-1.5 py-1 text-[12px] text-ink outline-none">
                    <option value="member">Member</option>
                    <option value="moderator">Moderator</option>
                    <option value="collaborator">Collaborator</option>
                    <option value="remove">Remove</option>
                  </select>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChannelPage() {
  return (
    <Suspense fallback={null}>
      <ChannelInner />
    </Suspense>
  );
}
