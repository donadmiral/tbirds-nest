"use client";

import { errorMessage } from "@/lib/errors";

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { checkUploadableBytes, displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BarChart2, Camera, ChevronDown, ChevronUp, HelpCircle, Image as ImageIcon, Plus, Radio, Send, Settings2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { channelMediaObject } from "@/lib/channelMedia";
import { useSocialPages } from "@/lib/useSocialPages";
import { SocialPageFooter } from "@/components/SocialPageFooter";
import { withTimeout } from "@/lib/withTimeout";
import { ErrorState } from "@/components/ErrorState";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { ProductDialog } from "@/components/ProductDialog";
import type { DirectoryPerson } from "@/lib/socialTypes";
import styles from "@/components/SocialWorkspace.module.css";

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
  const [supabase] = useState(createClient);
  const params = useParams<{ id: string }>();
  const channelId = String(params.id || "");
  const [name, setName] = useState("Channel");
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState<number>(0);
  const [myRole, setMyRole] = useState<string>("");
  const [isMember, setIsMember] = useState<boolean>(false);
  const epoch = useRef(0);
  const latestLoad = useRef<(() => Promise<void>) | null>(null);
  const historyScroll = useRef<{ height: number; top: number } | null>(null);
  const activeLoads = useRef(false);
  const pendingRefresh = useRef(false);
  const locks = useRef(new Set<string>());
  const cursor = useRef<Msg | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyMore, setReplyMore] = useState<Record<string, boolean>>({});
  const [replyLoading, setReplyLoading] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const scrollOnce = useRef(true);
  const [repliesEnabled, setRepliesEnabled] = useState(true);
  const [settingsScope, setSettingsScope] = useState<number | null>(null);
  const settingsOpen = settingsScope !== null;
  const setSettingsOpen = (open: boolean) => setSettingsScope(open ? epoch.current : null);
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
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const [pollBusy, setPollBusy] = useState(false);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, Reply[]>>({});
  const [replyDraft, setReplyDraft] = useState("");
  const [replySending, setReplySending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const readPending = useRef(false), lastRead = useRef('');
  const readState = useRef({ message: '', ready: false });
  useLayoutEffect(() => { readState.current = { message: messages[0]?.id || '', ready: !!me && isMember && !loading && !settingsOpen && !pollOpen && !openThread }; }, [messages, me, isMember, loading, settingsOpen, pollOpen, openThread]);

  const markRead = useCallback(async function markVisibleChannelRead(): Promise<void> {
    const version = epoch.current, message = readState.current.message;
    const marker = `${version}:${message}`;
    const rect = endRef.current?.getBoundingClientRect();
    if (!message || !readState.current.ready || readPending.current || lastRead.current === marker || document.visibilityState !== 'visible' || !document.hasFocus() || !rect || rect.top < 0 || rect.bottom > window.innerHeight + 64) return;
    readPending.current = true;
    try {
      const { error } = await withTimeout(supabase.rpc('mark_channel_read', { p_channel: channelId, p_message: message }));
      if (error) throw error;
      if (version === epoch.current) lastRead.current = marker;
    } catch { if (version === epoch.current) setError('Updates loaded, but the read marker could not be saved.'); }
    finally {
      if (version === epoch.current) {
        readPending.current = false;
        if (readState.current.message !== message) void markVisibleChannelRead();
      }
    }
  }, [channelId, supabase]);

  const canPost = myRole === "owner" || myRole === "collaborator";

  const load = useCallback(async (more = false) => {
    if (!channelId) return;
    if (activeLoads.current) { if (!more) pendingRefresh.current = true; return; }
    activeLoads.current = true;
    const version = epoch.current;
    if (more) setLoadingMore(true);
    setError(null);
    try {
      const [result, detail] = await withTimeout(Promise.all([
        supabase.rpc("get_channel_messages_page", {
          p_channel: channelId, p_limit: 40,
          p_cursor: more ? cursor.current?.created_at ?? null : null,
          p_cursor_id: more ? cursor.current?.id ?? null : null,
        }),
        supabase.rpc("get_channel_detail", { p_channel: channelId }),
      ]));
      if (result.error || detail.error) throw result.error || detail.error;
      if (version !== epoch.current) return;
      const metadata = Array.isArray(detail.data) ? detail.data[0] : detail.data;
      if (!metadata) {setMessages([]);setMediaUrls({});setReplies({});throw new Error("This channel is unavailable.");}
      setName(metadata.name); setIconUrl(metadata.icon_url ?? null); setMyRole(metadata.my_role ?? "");
      setMemberCount(metadata.member_count ?? 0); setIsMember(!!metadata.is_member); setRepliesEnabled(metadata.replies_enabled !== false);
      const rows = (result.data ?? []) as Msg[];
      if(metadata.audience!=="everyone"&&!metadata.is_member&&!metadata.my_role){setMessages([]);setMediaUrls({});setReplies({});setHasMore(false);return;}
      if (more) historyScroll.current = { height: document.documentElement.scrollHeight, top: window.scrollY };
      setMessages((previous) => {
        const seen = new Set<string>();
        return [...rows, ...previous].filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; })
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      });
      if (more || !cursor.current) {
        cursor.current = rows.at(-1) ?? cursor.current;
        setHasMore(rows.length === 40);
      }
      const signed = await Promise.all(rows.filter((row) => row.media_url).map(async (row) => {
        const object = channelMediaObject(row.media_url!, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
        if (!object) return [row.id, ""] as const;
        const response = await withTimeout(supabase.storage.from(object.bucket).createSignedUrl(object.path, 300));
        return [row.id, response.error ? "" : response.data?.signedUrl ?? ""] as const;
      }));
      if (version !== epoch.current) return;
      setMediaUrls((previous) => ({ ...previous, ...Object.fromEntries(signed) }));
    } catch (cause) {
      if (version === epoch.current) setError(cause instanceof Error ? cause.message : "Could not load this channel. Please try again.");
    } finally {
      if (version === epoch.current) {
        activeLoads.current = false;setLoading(false);setLoadingMore(false);
        if (pendingRefresh.current) { pendingRefresh.current = false; void latestLoad.current?.(); }
      }
    }
  }, [channelId, supabase]);
  useEffect(() => { latestLoad.current = load; }, [load]);
  useLayoutEffect(() => {
    if (!historyScroll.current) return;
    window.scrollTo({ top: historyScroll.current.top + document.documentElement.scrollHeight - historyScroll.current.height, behavior: "instant" });
    historyScroll.current = null;
  }, [messages]);
  const renewMedia = async (row: Msg) => {
    if (!row.media_url) return;
    const object = channelMediaObject(row.media_url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (!object) return;
    const version = epoch.current;
    try {
      const result = await withTimeout(supabase.storage.from(object.bucket).createSignedUrl(object.path, 300));
      if (version === epoch.current) setMediaUrls((previous) => ({ ...previous, [row.id]: result.error ? "" : result.data?.signedUrl ?? "" }));
    } catch {if(version===epoch.current)setMediaUrls(previous=>({...previous,[row.id]:""}));}
  };

  useEffect(() => {
    let alive = true;
    let uid: string | null | undefined;
    let realtime: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { if (alive) void load(); }, 180); };
    const bind = (next: string | null) => {
      if (!alive || uid === next) return;
      uid = next; epoch.current += 1; activeLoads.current=false;pendingRefresh.current=false;locks.current.clear();setSending(false);setAttaching(false);setPollBusy(false);setReplySending(false);setReplyLoading(null);setReplyMore({});cursor.current = null; scrollOnce.current = true;
      readPending.current = false; lastRead.current = '';
      setMe(next); setOpenThread(null); setDraft(""); setReplyDraft(""); setSettingsOpen(false); setPollOpen(false); setName("Channel"); setMyRole(""); setIsMember(false); setMessages([]); setReplies({}); setMediaUrls({}); setLoading(true); setHasMore(true);
      if (realtime) void supabase.removeChannel(realtime);
      realtime = supabase.channel("channel-history-" + channelId + "-" + Math.random().toString(36).slice(2))
        .on("postgres_changes", { event: "*", schema: "public", table: "channel_messages", filter: "channel_id=eq." + channelId }, (event) => {
          if (event.eventType === "DELETE") setMessages((previous) => previous.filter((row) => row.id !== event.old.id));
          if (event.eventType === "UPDATE") setMessages((previous) => previous.map((row) => row.id === event.new.id ? { ...row, ...event.new } : row));
          refresh();
        }).subscribe();
      refresh();
    };
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => bind(session?.user.id ?? null));
    withTimeout(supabase.auth.getSession()).then(({ data, error }) => { if(error)throw error;if (uid === undefined) bind(data.session?.user.id ?? null); }).catch(()=>{if(alive&&uid===undefined){setLoading(false);setError("Your session could not be loaded. Reload to retry.");}});
    const focus = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", focus);
    // Reconcile missed events and renew expiring attachment URLs while the page is open.
    const renewal = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 4 * 60 * 1000);
    return () => { alive = false; epoch.current += 1; pendingRefresh.current = false; auth.subscription.unsubscribe(); if (timer) clearTimeout(timer); if (realtime) void supabase.removeChannel(realtime); document.removeEventListener("visibilitychange", focus); clearInterval(renewal); };
  }, [channelId, supabase, load]);
  useEffect(() => {
    if (!loading && scrollOnce.current) { scrollOnce.current = false; endRef.current?.scrollIntoView({ block: "end" }); }
  }, [loading]);
  useEffect(() => { void markRead(); }, [messages, loading, isMember, settingsOpen, pollOpen, openThread, markRead]);
  useEffect(() => {
    const acknowledge = () => { void markRead(); };
    window.addEventListener('scroll', acknowledge, { passive: true });
    window.addEventListener('focus', acknowledge);
    document.addEventListener('visibilitychange', acknowledge);
    return () => { window.removeEventListener('scroll', acknowledge); window.removeEventListener('focus', acknowledge); document.removeEventListener('visibilitychange', acknowledge); };
  }, [markRead]);

  const join = async () => {
    const version=epoch.current;
    if (locks.current.has("join")) return;
    locks.current.add("join"); setError(null);
    try {
      const { error } = await supabase.rpc("join_channel", { p_channel: channelId });
      if (error) throw error;
      await load();
    } catch { if(version===epoch.current)setError("Could not join this channel. Please try again."); }
    finally { if(version===epoch.current)locks.current.delete("join"); }
  };

  const post = async () => {
    const body = draft.trim();
    if (!body || !canPost || locks.current.has("post")) return;
    locks.current.add("post"); setSending(true); setError(null);
    const version = epoch.current;
    try {
      const { error } = await supabase.rpc("post_channel_message", { p_channel: channelId, p_content: body, p_is_prompt: promptMode });
      if (error) throw error;
      if (version !== epoch.current) return;
      setDraft(""); setPromptMode(false);
      await load(); endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    } catch { if (version === epoch.current) setError("Could not confirm this post. Refresh the channel before trying again; your draft is saved here."); }
    finally { if(version===epoch.current){locks.current.delete("post"); setSending(false);} }
  };

  const onPickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !me || !canPost || locks.current.has("post")) return;
    const types: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
    if (!types[file.type] || file.size > 100 * 1024 * 1024) { setError("Choose a JPG, PNG, WebP, GIF, MP4, WebM or MOV smaller than 100 MB."); return; }
    locks.current.add("post"); setAttaching(true); setError(null);
    const version = epoch.current;
    try {
      const path = channelId + "/" + me + "/" + crypto.randomUUID() + "." + types[file.type];
      const bucket = supabase.storage.from("channel-media");
      const upload = await bucket.upload(path, file, { contentType: file.type });
      if (upload.error) throw upload.error;
      if (version !== epoch.current) return;
      const reference = bucket.getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.rpc("post_channel_message", {
        p_channel: channelId, p_content: draft.trim() || null, p_media_url: reference,
        p_media_type: file.type.startsWith("video/") ? "video" : "image", p_is_prompt: promptMode,
      });
      if (error) throw error;
      if (version !== epoch.current) return;
      setDraft(""); setPromptMode(false);
      await load(); endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    } catch { if (version === epoch.current) setError("Could not confirm the attachment. Refresh the channel before trying again."); }
    finally { if(version===epoch.current){locks.current.delete("post"); setAttaching(false);} }
  };

  const createPoll = async () => {
    const version=epoch.current;
    const question = pollQ.trim();
    const opts = pollOpts.map(o => o.trim()).filter(Boolean);
    if (!question || opts.length < 2 || locks.current.has("poll")) return;
    locks.current.add("poll");
    setPollBusy(true);
    try {
      const { error } = await withTimeout(supabase.rpc("post_channel_poll", { p_channel: channelId, p_question: question, p_options: opts, p_days: pollDays }));
      if (error) throw error;
      if(version!==epoch.current)return;setPollOpen(false); setPollQ(""); setPollOpts(["", ""]); setPollDays(3);
      setLoading(true);
      await load();
    } catch (err: unknown) { if(version===epoch.current)setError(errorMessage(err, "Could not create the poll.")); }
    finally { if(version===epoch.current){locks.current.delete("poll"); setPollBusy(false);} }
  };

  const votePoll = async (msg: Msg, optionId: string) => {
    if (!me) return;
    if (!isMember) { void join(); return; }
    const poll = msg.poll;
    if (!poll || new Date(poll.ends_at).getTime() < clock || poll.my_option === optionId) return;
    if (locks.current.has(msg.id)) return;
    const version=epoch.current;locks.current.add(msg.id);
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
    try {
      const { error } = await supabase.rpc("vote_channel_poll", { p_message: msg.id, p_option: optionId });
      if (error) throw error;
    } catch {
      if(version!==epoch.current)return;
      setMessages((previous) => previous.map((row) => row.id === msg.id ? msg : row));
      setError("Could not save your vote. Please try again.");
    } finally { if(version===epoch.current)locks.current.delete(msg.id); }
  };

  const react = async (msg: Msg, emoji: string) => {
    if (!me || locks.current.has(msg.id)) return;
    const version=epoch.current;locks.current.add(msg.id);
    setMessages(prev => prev.map(m => {
      if (m.id !== msg.id) return m;
      const mine: string[] = Array.isArray(m.my_reactions) ? [...m.my_reactions] : [];
      const counts = { ...(m.reactions || {}) } as Record<string, number>;
      const has = mine.includes(emoji);
      if (has) { counts[emoji] = Math.max((counts[emoji] || 1) - 1, 0); if (counts[emoji] === 0) delete counts[emoji]; }
      else { counts[emoji] = (counts[emoji] || 0) + 1; }
      return { ...m, reactions: counts, my_reactions: has ? mine.filter(e => e !== emoji) : [...mine, emoji] };
    }));
    try {
      const { error } = await supabase.rpc("react_channel_message", { p_message: msg.id, p_emoji: emoji });
      if (error) throw error;
    } catch {
      if(version!==epoch.current)return;
      setMessages((previous) => previous.map((row) => row.id === msg.id ? msg : row));
      setError("Could not save your reaction. Please try again.");
    } finally { if(version===epoch.current)locks.current.delete(msg.id); }
  };

  const loadReplies = async (message: Msg, more = false, refresh = false) => {
    const lock = "replies:" + message.id;
    if (locks.current.has(lock)) return;
    locks.current.add(lock); setReplyLoading(message.id); setError(null);
    const version = epoch.current;
    const last = more ? replies[message.id]?.at(-1) : null;
    try {
      const { data, error } = await supabase.rpc("get_channel_replies_page", {
        p_message: message.id, p_cursor: last?.created_at ?? null, p_cursor_id: last?.id ?? null, p_limit: 40,
      });
      if (error) throw error;
      if (version !== epoch.current) return;
      const rows = (data ?? []) as Reply[];
      setReplies((previous) => {
        const seen = new Set<string>();
        return { ...previous, [message.id]: [...(more || refresh ? previous[message.id] ?? [] : []), ...rows].filter((row) => { if (seen.has(row.id)) return false; seen.add(row.id); return true; }) };
      });
      if (!refresh) setReplyMore((previous) => ({ ...previous, [message.id]: rows.length === 40 }));
    } catch { if (version === epoch.current) setError("Could not load the replies. Open the thread again to retry."); }
    finally { if(version===epoch.current){locks.current.delete(lock); setReplyLoading(null);} }
  };
  const toggleThread = async (message: Msg) => {
    if (openThread === message.id) { setOpenThread(null); return; }
    setOpenThread(message.id); setReplyDraft("");
    await loadReplies(message);
  };
  const sendReply = async (message: Msg) => {
    const body = replyDraft.trim();
    if (!body || locks.current.has("reply")) return;
    locks.current.add("reply"); setReplySending(true); setError(null);
    const version = epoch.current;
    try {
      const { data, error } = await supabase.rpc("reply_channel_message", { p_message: message.id, p_content: body });
      if (error) throw error;
      if (version !== epoch.current) return;
      if (typeof data !== "string") throw new Error("Reply could not be confirmed");
      const mine: Reply = { id: data, content: body, created_at: new Date().toISOString(), user_name: "You", user_avatar: null };
      // Only append into a complete thread: jumping over unloaded replies would lose their cursor.
      if (!replyMore[message.id]) setReplies((previous) => ({ ...previous, [message.id]: [...(previous[message.id] ?? []).filter((row) => row.id !== data), mine] }));
      setReplyDraft(""); await load();
    } catch { if (version === epoch.current) setError("Could not confirm your reply. Reopen the thread before trying again; your draft is saved here."); }
    finally { if(version===epoch.current){locks.current.delete("reply"); setReplySending(false);} }
  };

  const latestReplies = useRef(loadReplies);
  useEffect(() => { latestReplies.current = loadReplies; });
  useEffect(() => {
    if (!openThread) return;
    const realtime = supabase.channel("channel-thread-" + openThread + "-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "channel_replies", filter: "message_id=eq." + openThread }, (event) => {
        if (event.eventType === "DELETE") setReplies((previous) => ({ ...previous, [openThread]: (previous[openThread] ?? []).filter((row) => row.id !== event.old.id) }));
        if (event.eventType === "UPDATE") setReplies((previous) => ({ ...previous, [openThread]: (previous[openThread] ?? []).map((row) => row.id === event.new.id ? { ...row, ...event.new } : row) }));
        const message = messages.find((row) => row.id === openThread);
        if (message) void latestReplies.current(message, false, true);
      }).subscribe();
    return () => { void supabase.removeChannel(realtime); };
    // The ID identifies the thread; the ref reads the current request function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThread, channelId, supabase]);

  const ordered = [...messages].reverse();

  return (
    <section className={styles.channel}>
      <header className={styles.channelHeader}>
        <Link href="/channels" className="rounded-full p-1.5 text-ink/60 hover:bg-black/5" aria-label="Back to channels"><ArrowLeft size={18} /></Link>
        {iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={iconUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white"><Radio size={15} /></span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-ink">{name}</h1>
          <p className="text-xs text-muted">{String(memberCount)} {memberCount === 1 ? "member" : "members"} · Host announcements</p>
        </div>
        {isMember ? (
          <button onClick={() => setSettingsOpen(true)} className="rounded-full p-2 text-ink/60 hover:bg-black/5" aria-label="Channel settings"><Settings2 size={17} /></button>
        ) : null}
      </header>

      <div className={styles.channelBody}>
        {error ? <ErrorState title={error} onRetry={() => void load()} /> : null}
        {!loading && hasMore ? <button type="button" disabled={loadingMore} onClick={() => void load(true)} className="mb-4 w-full rounded-full bg-surface py-2 text-sm text-ink disabled:opacity-50">{loadingMore ? "Loading…" : "Load older updates"}</button> : null}
        {loading ? (
          <p className="py-16 text-center text-sm text-muted">Loading&hellip;</p>
        ) : ordered.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">{canPost ? "Post the first update." : "No updates yet."}</p>
        ) : (
          ordered.map(m => {
            const poll = m.poll || null;
            const pollClosed = poll ? new Date(poll.ends_at).getTime() < clock : false;
            return (
            <div key={m.id} className="mb-5">
              <div className="flex items-center gap-2">
                {m.sender_avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.sender_avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/5 text-[11px] font-bold text-ink">{(m.sender_name || "C").charAt(0).toUpperCase()}</span>
                )}
                <span className="text-[13px] font-semibold text-ink">{m.sender_name || "Channel"}</span>
                {m.sender_role ? <span className="rounded-full bg-ink/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{m.sender_role}</span> : null}
                <span className="text-[11.5px] text-muted">{relTime(m.created_at)}</span>
              </div>
              <div className={"ml-9 mt-1 rounded-2xl rounded-tl-md bg-ink/[0.04] px-3.5 py-2.5" + (m.is_prompt ? " border-l-2 border-ink" : "")}>
                {m.is_prompt ? (
                  <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-ink/10 px-2 py-0.5 text-[11px] font-semibold text-ink"><HelpCircle size={11} /> Prompt &middot; answer in the replies</span>
                ) : null}
                {m.content ? <p className="whitespace-pre-wrap text-[14px] leading-snug text-ink">{m.content}</p> : null}
                {mediaUrls[m.id] && m.media_type !== "video" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrls[m.id]} onError={() => void renewMedia(m)} alt="" className="mt-2 max-h-[340px] w-auto max-w-full rounded-lg object-contain" />
                ) : null}
                {mediaUrls[m.id] && m.media_type === "video" ? (
                  <video src={mediaUrls[m.id]} onError={() => void renewMedia(m)} preload="metadata" controls playsInline className="mt-2 max-h-[340px] w-auto max-w-full rounded-lg" />
                ) : null}
                {m.media_url && !mediaUrls[m.id] ? <button onClick={() => void renewMedia(m)} className="mt-2 text-sm text-muted underline">Attachment unavailable. Retry</button> : null}
                {poll ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {(poll.options || []).map(o => {
                      const total = Math.max(poll.total || 0, 1);
                      const pct = Math.round(((o.votes || 0) / total) * 100);
                      const on = poll.my_option === o.id;
                      return (
                        <button key={o.id} onClick={() => votePoll(m, o.id)} disabled={pollClosed}
                          className={"relative overflow-hidden rounded-lg border bg-white text-left " + (on ? "border-ink/50" : "border-ink/10") + (pollClosed ? " cursor-default" : "")}>
                          <span className={"absolute inset-y-0 left-0 " + (on ? "bg-ink/20" : "bg-ink/10")} style={{ width: String(Math.max(pct, 3)) + "%" }} />
                          <span className="relative flex items-center justify-between px-3 py-2">
                            <span className={"truncate pr-2 text-[13px] " + (on ? "font-bold text-ink" : "text-ink")}>{o.label}</span>
                            <span className="text-[12px] font-bold text-muted">{(poll.total || 0) > 0 ? String(pct) + "%" : ""}</span>
                          </span>
                        </button>
                      );
                    })}
                    <span className="text-[11.5px] text-muted">{String(poll.total || 0)} {poll.total === 1 ? "vote" : "votes"} &middot; {pollTimeLeft(poll.ends_at)}</span>
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
                  <button onClick={() => toggleThread(m)} className="ml-1 inline-flex items-center gap-1 text-[12px] font-semibold text-muted hover:text-ink">
                    {openThread === m.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    {String(m.reply_count || 0)} {m.reply_count === 1 ? "reply" : "replies"}
                  </button>
                ) : null}
              </div>
              {openThread === m.id ? (
                <div className="ml-9 mt-2 border-l-2 border-ink/10 pl-3">
                  {(replies[m.id] || []).map(r => (
                    <div key={r.id} className="mb-2">
                      <p className="text-[12.5px]"><span className="font-semibold text-ink">{r.user_name || "Member"}</span> <span className="text-muted">{relTime(r.created_at)}</span></p>
                      <p className="whitespace-pre-wrap text-[13.5px] text-ink/85">{r.content}</p>
                    </div>
                  ))}
                  {replyLoading === m.id ? <p className="py-2 text-xs text-muted">Loading replies…</p> : null}
                  {replyMore[m.id] ? <button disabled={replyLoading === m.id} onClick={() => void loadReplies(m, true)} className="py-2 text-xs font-semibold text-ink">More replies</button> : null}
                  {me && isMember ? (
                    <div className="mt-1 flex items-center gap-2">
                      <input value={replyDraft} onChange={e => setReplyDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") void sendReply(m); }}
                        placeholder="Reply" className="w-full rounded-full bg-ink/5 px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-muted" />
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
              <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-ink"><HelpCircle size={13} /> Posting as a prompt. Members answer in the replies.</p>
            ) : null}
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPromptMode(p => !p)} className={"rounded-full p-2 hover:bg-black/5 " + (promptMode ? "text-ink" : "text-muted")} aria-label="Post a prompt" title="Prompt"><HelpCircle size={19} /></button>
              <button onClick={() => setPollOpen(true)} className="rounded-full p-2 text-muted hover:bg-black/5" aria-label="Create a poll" title="Poll"><BarChart2 size={19} /></button>
              <button onClick={() => fileRef.current?.click()} disabled={attaching} className="rounded-full p-2 text-muted hover:bg-black/5 disabled:opacity-40" aria-label="Attach a photo or video" title="Photo or video"><ImageIcon size={19} /></button>
              <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={onPickFile} />
              <input value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void post(); }}
                placeholder={attaching ? "Uploading&hellip;".replace("&hellip;", "\u2026") : promptMode ? "Ask your members something" : "Post an update"}
                className="w-full rounded-full bg-ink/5 px-4 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted" />
              <button onClick={post} disabled={!draft.trim() || sending} className="rounded-full bg-ink p-2.5 text-white disabled:opacity-30" aria-label="Post"><Send size={15} /></button>
            </div>
          </div>
        ) : !me ? (
          <p className="py-1 text-center text-[13px] text-muted">Sign in to join this channel.</p>
        ) : !isMember ? (
          <button onClick={join} className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white">Join channel</button>
        ) : (
          <p className="py-1 text-center text-[12.5px] text-muted">Only the owner and collaborators post here. React and reply to join in.</p>
        )}
      </div>

      <ProductDialog open={pollOpen} title="New poll" description="Ask your channel a question. Closing keeps your draft on this page." busy={pollBusy} onClose={() => setPollOpen(false)}>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); void createPoll(); }}>
          <label>Question<input autoFocus disabled={pollBusy} required value={pollQ} maxLength={140} onChange={event => setPollQ(event.target.value)} placeholder="What would you like to ask?" /></label>
          {pollOpts.map((option, index) => <label key={index}>Option {index + 1}<div className="flex items-center gap-2"><input disabled={pollBusy} value={option} maxLength={60} onChange={event => setPollOpts(previous => previous.map((value, at) => at === index ? event.target.value : value))} />{pollOpts.length > 2 ? <button type="button" disabled={pollBusy} className={styles.button} onClick={() => setPollOpts(previous => previous.filter((_value, at) => at !== index))} aria-label={`Remove option ${index + 1}`}><X size={16} aria-hidden /></button> : null}</div></label>)}
          {pollOpts.length < 4 ? <button type="button" disabled={pollBusy} className={styles.button} onClick={() => setPollOpts(previous => [...previous, ''])}><Plus size={16} aria-hidden />Add option</button> : null}
          <fieldset disabled={pollBusy}><legend>Poll duration</legend><div className={styles.choices}>{[1,3,7].map(days => <button type="button" key={days} aria-pressed={pollDays === days} onClick={() => setPollDays(days)}>{days} {days === 1 ? 'day' : 'days'}</button>)}</div></fieldset>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          <footer className={styles.footer}><button type="button" disabled={pollBusy} className={styles.button} onClick={() => setPollOpen(false)}>Cancel</button><button type="submit" disabled={!pollQ.trim() || pollOpts.filter(option => option.trim()).length < 2 || pollBusy} className={styles.primary}>{pollBusy ? 'Creating…' : 'Create poll'}</button></footer>
        </form>
      </ProductDialog>

      {settingsOpen && isMember ? (
        <ChannelSettings key={channelId + ":" + me} channelId={channelId} myRole={myRole} meId={me} isCurrent={() => settingsScope === epoch.current} onClose={() => setSettingsOpen(false)}
          onUpdated={p => {
            if (p.name) setName(p.name);
            if (p.icon_url) setIconUrl(p.icon_url);
            if (typeof p.replies_enabled === "boolean") setRepliesEnabled(p.replies_enabled);
          }} />
      ) : null}
    </section>
  );
}

function ChannelSettings({ channelId, myRole, meId, onClose, onUpdated, isCurrent }: {
  channelId: string; myRole: string; meId: string | null; onClose: () => void; isCurrent: () => boolean;
  onUpdated: (p: { name?: string; icon_url?: string; replies_enabled?: boolean }) => void;
}) {
  const [supabase] = useState(createClient);
  const isOwner = myRole === "owner";
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [audience, setAudience] = useState<"everyone" | "followers">("everyone");
  const [replies, setReplies] = useState(true);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftPhoto, setDraftPhoto] = useState<{file: File; path: string; url: string} | null>(null);
  const [writeError, setWriteError] = useState('');
  const [baseline, setBaseline] = useState('');
  useEffect(() => () => { if (draftPhoto) URL.revokeObjectURL(draftPhoto.url); }, [draftPhoto]);
  const membersPage = useSocialPages<Member>("get_channel_members_page", { p_channel: channelId }, { key: "user_id" });
  const { items: members, setItems: setMembers } = membersPage;
  const [settingsError, setSettingsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const actionLocks = useRef(new Set<string>());
  const [myLevel, setMyLevel] = useState("all");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirectoryPerson[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const iconRef = useRef<HTMLInputElement | null>(null);
  const live = useRef(true);
  const identity = channelId + ':' + meId;
  const currentIdentity = useRef(identity);
  useLayoutEffect(() => { currentIdentity.current = identity; }, [identity]);
  const checkOwner=useRef(isCurrent);
  useLayoutEffect(()=>{checkOwner.current=isCurrent;},[isCurrent]);
  const current = useCallback(() => live.current && currentIdentity.current === identity && checkOwner.current(),[identity]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, [identity]);

  useEffect(() => {
    let alive = true;
    withTimeout(supabase.rpc("get_channel_detail", { p_channel: channelId })).then(({ data, error }) => {
      if (!alive || !current()) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.is_member) { setSettingsError(true); setLoading(false); return; }
      setName(row.name || ""); setDesc(row.description || "");
      setAudience(row.audience === "followers" ? "followers" : "everyone");
      setReplies(row.replies_enabled !== false); setIconUrl(row.icon_url || null); setMyLevel(row.my_notification_level || "all");
      setBaseline(JSON.stringify({ name: row.name || "", desc: row.description || "", audience: row.audience === "followers" ? "followers" : "everyone", replies: row.replies_enabled !== false }));
      setLoading(false);
    }, () => { if (alive && current()) { setSettingsError(true); setLoading(false); } });
    return () => { alive = false; };
  }, [channelId, meId, supabase, retry, current]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("search_people_page", { p_q: q.trim(), p_limit: 8, p_offset: 0 });
        if (!alive || !current()) return;
        if (error) throw error;
        const taken = new Set(members.map((member) => member.user_id));
        setResults((data ?? []).filter((row: { id: string }) => !taken.has(row.id)));
      } catch { if (alive && current()) { setResults([]); setSearchError("People could not be loaded. Edit your search to retry."); } }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, members, supabase, current]);

  const close = () => {
    if (saving || iconBusy) return;
    const dirty = !!draftPhoto || (!!baseline && baseline !== JSON.stringify({ name, desc, audience, replies }));
    if (!dirty || window.confirm('Discard these unsaved channel changes?')) onClose();
  };
  const verifyOwner = async () => {
    const { data, error } = await withTimeout(supabase.auth.getUser());
    if (error || !current() || !meId || data.user?.id !== meId) throw new Error('Your account changed. Reopen channel settings before saving.');
  };
  const onPickIcon = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !meId || !isOwner || !current() || actionLocks.current.has('icon') || actionLocks.current.has('save')) return;
    actionLocks.current.add('icon'); setIconBusy(true); setWriteError('');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP photo under 10 MB.');
      const issue = await checkUploadableBytes(file); if (issue) throw new Error(issue);
      if (!current()) return;
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      setDraftPhoto({file, path: `${meId}/channel_${channelId}_${crypto.randomUUID()}.${ext}`, url: URL.createObjectURL(file)});
    } catch(cause) { if(current()) setWriteError(cause instanceof Error ? cause.message : 'This photo could not be opened.'); }
    finally { actionLocks.current.delete('icon'); if(current())setIconBusy(false); }
  };
  const save = async () => {
    if (!isOwner || !current() || actionLocks.current.has('save') || actionLocks.current.has('icon') || !name.trim()) return;
    actionLocks.current.add('save'); setSaving(true); setWriteError('');
    try {
      await verifyOwner();
      let savedIcon = iconUrl;
      if(draftPhoto) {
        const upload = await withTimeout(supabase.storage.from('avatars').upload(draftPhoto.path, draftPhoto.file, { contentType: draftPhoto.file.type, upsert:true }),45000);
        if(!current())return;
        if(upload.error)throw new Error('The channel photo could not upload. Your changes are still here; try again.');
        savedIcon = supabase.storage.from('avatars').getPublicUrl(draftPhoto.path).data.publicUrl;
      }
      await verifyOwner();
      const {error} = await withTimeout(supabase.rpc('update_channel_settings',{p_channel:channelId,p_name:name.trim(),p_description:desc.trim()||null,p_audience:audience,p_replies_enabled:replies,...(draftPhoto ? {p_icon_url:savedIcon} : {})}));
      if(error)throw new Error('Your changes could not be confirmed. Keep this window open and retry.');
      if(!current())return;
      onUpdated({name:name.trim(),replies_enabled:replies,...(draftPhoto&&savedIcon ? {icon_url:savedIcon} : {})});onClose();
    } catch(cause){if(current())setWriteError(cause instanceof Error ? cause.message : 'Your changes could not be confirmed.');}
    finally{actionLocks.current.delete('save');if(current())setSaving(false);}
  };

  const setLevel = async (level: "all" | "highlights" | "mute") => {
    if (!current() || actionLocks.current.has("level")) return;
    actionLocks.current.add("level");

    try {
      const { error } = await supabase.rpc("set_channel_notifications", { p_channel: channelId, p_level: level });
      if (error) throw error;
      if (current()) setMyLevel(level);
    } catch { if (current()) alert("Could not save notification settings. Please try again."); }
    finally { if (current()) actionLocks.current.delete("level"); }
  };

  const applyRole = async (member: Member, role: string) => {
    const key = 'member:' + member.user_id;
    if (!isOwner || !current() || actionLocks.current.has(key)) return;
    actionLocks.current.add(key);
    try {
      const { error } = await supabase.rpc("set_channel_role", { p_channel: channelId, p_user: member.user_id, p_role: role });
      if (error) throw error;
      if (!current()) return;
      setMembers(previous => role === "remove" ? previous.filter(item => item.user_id !== member.user_id) : previous.map(item => item.user_id === member.user_id ? { ...item, role } : item));
    } catch { if (current()) alert("Could not update this member. Refresh settings and try again."); }
    finally { if (current()) actionLocks.current.delete(key); }
  };

  const invite = async (r: DirectoryPerson) => {
    if (!isOwner || !current() || actionLocks.current.has("invite")) return;
    actionLocks.current.add("invite");
    setInviting(r.id);
    try {
      const { error } = await supabase.rpc("set_channel_role", { p_channel: channelId, p_user: r.id, p_role: "collaborator" });
      if (error) throw error;
      if (!current()) return;
      setMembers(prev => [...prev.filter(member => member.user_id !== r.id), { user_id: r.id, full_name: r.full_name, username: r.username, avatar_url: r.avatar_url, role: "collaborator", notification_level: "all" }]);
      setQ(""); setResults([]);
    } catch (err: unknown) { if (current()) alert(errorMessage(err, "Could not invite.")); }
    finally { if (current()) { actionLocks.current.delete("invite"); setInviting(null); } }
  };

  const roleLabel = (r: string) => r === "owner" ? "Owner" : r === "collaborator" ? "Collaborator" : r === "moderator" ? "Moderator" : null;

  return <ProductDialog open title="Channel settings" description="Profile changes are applied when you save. Notification and member actions apply individually." busy={saving || iconBusy} onClose={close}>
      {writeError ? <p role="alert" className={styles.error}>{writeError}</p> : null}
      <fieldset disabled={saving || iconBusy} className="min-w-0 border-0 p-0">
        {settingsError ? <ErrorState title="Could not load channel settings" onRetry={() => { setLoading(true); setSettingsError(false); setRetry((value) => value + 1); }} /> : loading ? (
          <p className="py-10 text-center text-sm text-muted">Loading&hellip;</p>
        ) : (
          <div>
            {isOwner ? (
              <div>
                <div className="mb-4 flex flex-col items-center">
                  <button onClick={() => iconRef.current?.click()} className="relative" aria-label="Change the channel icon">
                    {draftPhoto?.url || iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={draftPhoto?.url || iconUrl!} alt="Channel photo preview" className="h-[76px] w-[76px] rounded-full object-cover" />
                    ) : (
                      <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-ink text-white"><Radio size={26} /></span>
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-ink text-white">
                      {iconBusy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Camera size={12} />}
                    </span>
                  </button>
                  <input ref={iconRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Channel photo file" onChange={onPickIcon} />
                  <p className="mt-2 text-[12px] text-muted">Preview a JPG, PNG or WebP photo, then save. Up to 10 MB.</p>
                </div>
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Name</p>
                <input aria-label="Channel name" value={name} onChange={e => setName(e.target.value)} maxLength={60}
                  className="mb-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Description</p>
                <input aria-label="Channel description" value={desc} onChange={e => setDesc(e.target.value)} maxLength={160} placeholder="What is it about?"
                  className="mb-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Who can join</p>
                <div className="mb-3 flex gap-2">
                  {(["everyone", "followers"] as const).map(k => (
                    <button key={k} onClick={() => setAudience(k)} aria-pressed={audience === k}
                      className={"flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold " + (audience === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>
                      {k === "everyone" ? "Everyone can join" : "My followers"}
                    </button>
                  ))}
                </div>
                <label className="mb-4 flex cursor-pointer items-center justify-between gap-3">
                  <span>
                    <span className="block text-[14px] font-semibold text-ink">Member replies</span>
                    <span className="block text-[12px] text-muted">Members can reply in threads under each update.</span>
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
                <button key={k} onClick={() => setLevel(k)} aria-pressed={myLevel === k}
                  className={"flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold " + (myLevel === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>
                  {k === "all" ? "All" : k === "highlights" ? "Highlights" : "Mute"}
                </button>
              ))}
            </div>
            <p className="mb-4 text-[11.5px] text-muted">All notifies every update. Highlights keeps it occasional. Mute stays silent.</p>
            <div className="mb-4 h-px bg-ink/10" />

            {isOwner ? (
              <div className="mb-4">
                <p className="mb-2 text-[13px] font-semibold text-ink">Invite a collaborator</p>
                <input aria-label="Search collaborators" value={q} onChange={e => { setQ(e.target.value); setResults([]); setSearchError(null); }} placeholder="Search people"
                  className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/40" />
                {searchError ? <p role="alert" className="text-sm text-danger">{searchError}</p> : null}
            {results.map(r => (
                  <div key={r.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                    {r.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white">{(r.full_name || "?").charAt(0)}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-ink">{r.full_name || "Member"} <VerifiedBadge userId={r.id} size={12} /></span>
                      {r.username ? <span className="block text-[12px] text-muted">@{r.username}</span> : null}
                    </span>
                    <button onClick={() => invite(r)} disabled={!!inviting} className="rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">Invite</button>
                  </div>
                ))}
              </div>
            ) : null}

            <p className="mb-2 text-[13px] font-semibold text-ink">{members.length === 1 ? "1 member loaded" : String(members.length) + " members loaded"}</p>
            {members.map(m => (
              <div key={m.user_id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(m.avatar_url, 200) ?? m.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white">{(m.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{m.full_name || "Member"} <VerifiedBadge userId={m.user_id} size={12} />{m.user_id === meId ? " (you)" : ""}</span>
                  {m.username ? <span className="block text-[12px] text-muted">@{m.username}</span> : null}
                </span>
                {roleLabel(m.role) ? <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[10.5px] font-bold text-ink">{roleLabel(m.role)}</span> : null}
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
            <SocialPageFooter {...membersPage} />
          </div>
        )}
      </fieldset>
      <button type="button" className={styles.button} onClick={close} disabled={saving || iconBusy}>Close settings</button>
    </ProductDialog>;
}

export default function ChannelPage() {
  return (
    <Suspense fallback={null}>
      <ChannelInner />
    </Suspense>
  );
}
