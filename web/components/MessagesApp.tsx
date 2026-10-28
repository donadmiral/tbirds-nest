"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, Send, FileText, Tag, Wallet, Paperclip, Mic, Square, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { loadConversations, type Conv, type Msg } from "@/lib/messages";
import { signChatMedia, isChatMediaUrl } from "@/lib/chatMedia";
import { enqueueMessage, readOutbox, sendOutboxMessage, clearOutbox, forgetOutboxMessage, type OutboxMessage } from "@/lib/messageOutbox";
import { StoryAvatar } from "@/components/StoryAvatar";
import { CallButtons } from "@/components/CallButtons";
import { GroupCallBar } from "@/components/GroupCallBar";
import { ShareDetails } from "@/components/ShareDetails";
import { parseChatAttachmentCard, attachmentCardText, attachmentCardLinks } from "../../shared/chatAttachmentCards";
import { PrivateMediaViewer } from "@/components/PrivateMediaViewer";
import { SharedPostCard } from "@/components/SharedPostCard";
import { timeAgo } from "@/lib/feed";
import { MESSAGE_PAGE_SIZE, olderMessageFilter, mergeMessagePage, type MessageCursor } from "../../shared/messageHistory";
import { editMessage, reactToMessage, pinMessage, forwardMessage, canForwardMessage } from "@/lib/messageActions";

const PRIVATE_MEDIA_SESSIONS_ENABLED = process.env.NEXT_PUBLIC_PRIVATE_MEDIA_SESSIONS_ENABLED === 'true';

type OfferLive = { id: string; status: string; proposer_id: string; amount: number; currency: string };
type MiniListing = { id: string; title: string; price: number; currency: string; images: string[]; status: string };

export function MessagesApp({ context = "personal", heading = "Messages", compact: compactProp = false }: { context?: string; heading?: string; compact?: boolean }) {
  // A phone width uses the one-pane layout on its own.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => { const mq = window.matchMedia("(max-width: 767px)"); const apply = () => setIsNarrow(mq.matches); apply(); mq.addEventListener("change", apply); return () => mq.removeEventListener("change", apply); }, []);
  const compact = compactProp || isNarrow;
  const supabase = useRef(createClient()).current;
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [shareDetails,setShareDetails] = useState<"contact"|"location"|null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [active, setActive] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [privateMedia, setPrivateMedia] = useState<{ id: string; userId: string; conversationId: string; account: number } | null>(null);
  const [viewedPrivateIds, setViewedPrivateIds] = useState<Set<string>>(new Set());
  useEffect(() => { setPrivateMedia(null); setShareDetails(null); setViewedPrivateIds(new Set()); }, [uid, active?.id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [forwarding, setForwarding] = useState<Msg | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<Msg | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const messageActionPending = useRef(false);
  const sendPending = useRef(false);
  const uploadPending = useRef(false);
  const uploadGeneration = useRef(0);
  const accountGeneration = useRef(0);
  const recorderPending = useRef(false);
  const recordingGeneration = useRef(0);
  const inboxGeneration = useRef(0);
  const componentLive = useRef(true);
  const historyCursor = useRef<MessageCursor | null>(null);
  const historyGeneration = useRef(0);
  const olderPending = useRef(false);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const drafts = useRef(new Map<string, string>());
  const [attachmentDraft, setAttachmentDraft] = useState<File | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  // Chats holds people and plain groups; a community's chat lives under Groups, labelled, the same as on the phone.
  const [tab, setTab] = useState<"chats" | "groups" | "unread">("chats");
  const [offers, setOffers] = useState<Record<string, OfferLive>>({});
  const [refListing, setRefListing] = useState<MiniListing | null>(null);
  const [countering, setCountering] = useState<string | null>(null);
  const [counterAmt, setCounterAmt] = useState("");
  const [otherTyping, setOtherTyping] = useState(false);
  const [sendingFile, setSendingFile] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // The list stays at its end while you're there, through every height change; scrolling up releases it.
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollToEnd = () => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; };
  const pinnedRef = useRef(true);
  // iOS keyboard: Safari scrolls the layout instead of shrinking a fixed surface, so the surface tracks the visual viewport itself and the page stays locked.
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // ?debug=1 draws a live readout of everything that can move the chat, for measuring on a real phone.
  const debugRef = useRef<HTMLPreElement | null>(null);
  const debugCounts = useRef({ resize: 0, ro: 0, mo: 0, scroll: 0, msgs: 0 });
  const [debugOn, setDebugOn] = useState(false);
  useEffect(() => { setDebugOn(window.location.search.includes('debug=1')); }, []);
  useEffect(() => {
    if (!debugOn) return;
    const vv = window.visualViewport; const t = setInterval(() => { const el = listRef.current; const d = debugCounts.current; if (debugRef.current) debugRef.current.textContent = ['vv h ' + (vv ? Math.round(vv.height) : '-') + ' top ' + (vv ? Math.round(vv.offsetTop) : '-') + ' inner ' + window.innerHeight, 'pageY ' + Math.round(window.scrollY) + ' body ' + document.body.style.position + ' ' + document.body.style.top, 'list top ' + (el ? Math.round(el.scrollTop) : '-') + ' / ' + (el ? el.scrollHeight : '-') + ' client ' + (el ? el.clientHeight : '-') + ' pinned ' + pinnedRef.current, 'events resize ' + d.resize + ' ro ' + d.ro + ' mo ' + d.mo + ' scroll ' + d.scroll + ' msgs ' + d.msgs].join('\n'); }, 250);
    return () => clearInterval(t);
  }, [debugOn]);
  useEffect(() => {
    if (!compact || !active) return;
    const vv = window.visualViewport; const el = surfaceRef.current; if (!vv || !el) return;
    // iOS ignores overflow hidden; the only lock it honours is pinning the body in place, restored exactly on close.
    const body = document.body; const y = window.scrollY; const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow, overscroll: (body.style as any).overscrollBehavior };
    body.style.position = 'fixed'; body.style.top = (-y) + 'px'; body.style.width = '100%'; body.style.overflow = 'hidden'; (body.style as any).overscrollBehavior = 'none';
    let raf = 0;
    const apply = () => { debugCounts.current.resize++; el.style.height = vv.height + 'px'; el.style.top = vv.offsetTop + 'px'; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (pinnedRef.current) scrollToEnd(); }); };
    apply(); vv.addEventListener('resize', apply);
    return () => { vv.removeEventListener('resize', apply); cancelAnimationFrame(raf); body.style.position = prev.position; body.style.top = prev.top; body.style.width = prev.width; body.style.overflow = prev.overflow; (body.style as any).overscrollBehavior = prev.overscroll; window.scrollTo(0, y); el.style.height = ''; el.style.top = ''; };
  }, [compact, active?.id]);
  useEffect(() => {
    const el = listRef.current; if (!el) return;
    const onScroll = () => { debugCounts.current.scroll++; pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
    el.addEventListener('scroll', onScroll, { passive: true });
    let settle: ReturnType<typeof setTimeout> | null = null;
    const settleThenScroll = () => { if (settle) clearTimeout(settle); settle = setTimeout(() => { settle = null; if (pinnedRef.current) requestAnimationFrame(scrollToEnd); }, 80); };
    const ro = new ResizeObserver(() => { debugCounts.current.ro++; settleThenScroll(); });
    ro.observe(el); Array.from(el.children).forEach((ch) => ro.observe(ch));
    const mo = new MutationObserver(() => { debugCounts.current.mo++; Array.from(el.children).forEach((ch) => ro.observe(ch)); settleThenScroll(); });
    mo.observe(el, { childList: true });
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); mo.disconnect(); if (settle) clearTimeout(settle); };
  }, [active?.id]);
  const activeRef = useRef<Conv | null>(null);
  const typingSentAt = useRef(0);
  const typingIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  activeRef.current = active;

  const hydrateOffers = useCallback(async (rows: Msg[]) => {
    const generation = accountGeneration.current;
    const ids: string[] = [];
    rows.forEach((m) => {
      if (m.media_type === "offer" && m.media_url) {
        try { const j = JSON.parse(m.media_url); if (j?.offer_id) ids.push(j.offer_id); } catch { /* not json */ }
      }
    });
    if (ids.length === 0) return;
    const { data } = await supabase.from("listing_offers").select("id, status, proposer_id, amount, currency").in("id", ids);
    if (!componentLive.current || generation !== accountGeneration.current) return;
    setOffers((prev) => {
      const next = { ...prev };
      ((data ?? []) as OfferLive[]).forEach((o) => { next[o.id] = o; });
      return next;
    });
  }, [supabase]);

  const loadReactions = useCallback(async (rows: Msg[], conversationId: string) => {
    if (!rows.length) return;
    const generation = accountGeneration.current;
    const ids = rows.map(row => row.id).filter(id => !id.startsWith('temp-'));
    const { data, error } = await supabase.from('message_reactions').select('message_id, user_id, emoji').in('message_id', ids);
    if (error || !componentLive.current || generation !== accountGeneration.current || activeRef.current?.id !== conversationId) return;
    const byId = new Map<string, { user_id: string; emoji: string }[]>();
    for (const row of data || []) byId.set(row.message_id, [...(byId.get(row.message_id) || []), row]);
    setMsgs(prev => prev.map(row => ids.includes(row.id) ? { ...row, _reactions: byId.get(row.id) || [] } : row));
  }, [supabase]);

  const loadPin = useCallback(async (conversationId: string) => {
    const generation = accountGeneration.current;
    const { data, error } = await supabase.from('conversations').select('pinned_message_id').eq('id', conversationId).maybeSingle();
    if (error || !componentLive.current || generation !== accountGeneration.current || activeRef.current?.id !== conversationId) return;
    if (!data?.pinned_message_id) { setPinnedMessage(null); return; }
    const { data: row } = await supabase.from('messages').select('*').eq('id', data.pinned_message_id).eq('conversation_id', conversationId).maybeSingle();
    if (componentLive.current && generation === accountGeneration.current && activeRef.current?.id === conversationId) setPinnedMessage(row && !row.deleted_at ? row as Msg : null);
  }, [supabase]);

  const openConv = useCallback(async (c: Conv) => {
    const generation = ++historyGeneration.current;
    activeRef.current = c;
    setActive(c);
    setLoadingMsgs(true); setHistoryError(null); setActionError(null); setNotice(null);
    setMsgs(uidRef.current ? readOutbox(uidRef.current, c.id).map(row => ({ ...row, media_url: isChatMediaUrl(row.media_url) ? null : row.media_url })) : []); setDraft(drafts.current.get(c.id) || ''); setAttachmentDraft(null); setReplyTo(null); setEditing(null); setForwarding(null); setPinnedMessage(null);
    historyCursor.current = null; olderPending.current = false; setHasOlder(false); setLoadingOlder(false);
    setRefListing(null); setOtherTyping(false);
    const current = () => historyGeneration.current === generation && activeRef.current?.id === c.id;
    try {
      const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', c.id)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MESSAGE_PAGE_SIZE);
      if (error) throw error;
      const raw = (data || []) as Msg[];
      const rows = await signChatMedia(raw);
      if (!current()) return;
      historyCursor.current = raw[raw.length - 1] || null;
      setHasOlder(raw.length === MESSAGE_PAGE_SIZE);
      for (const row of raw) if (row.sender_id === uidRef.current) forgetOutboxMessage(row.sender_id, row.id);
      setMsgs(prev => mergeMessagePage(prev, rows.map(row => ({ ...row, _delivery: undefined })), true));
      void hydrateOffers(rows); void loadReactions(rows, c.id); void loadPin(c.id);
      const { error: readError } = await supabase.rpc('mark_conversation_read_v2', { p_conversation_id: c.id });
      if (!readError) setConvs(list => list.map(item => item.id === c.id ? { ...item, unread: 0 } : item));
      if (c.context === 'market' && c.context_ref_id) {
        const { data: listing } = await supabase.from('marketplace_listings').select('id, title, price, currency, images, status').eq('id', c.context_ref_id).maybeSingle();
        if (current() && listing) setRefListing(listing as MiniListing);
      }
      if (current()) { pinnedRef.current = true; requestAnimationFrame(() => { if (current()) scrollToEnd(); }); }
    } catch {
      if (current()) setHistoryError('Messages could not be loaded. Please try again.');
    } finally { if (current()) setLoadingMsgs(false); }
  }, [supabase, hydrateOffers, loadReactions, loadPin]);

  const loadOlder = useCallback(async () => {
    const c = activeRef.current;
    const cursor = historyCursor.current;
    if (!c || !cursor || !hasOlder || olderPending.current) return;
    const generation = historyGeneration.current;
    const current = () => historyGeneration.current === generation && activeRef.current?.id === c.id;
    olderPending.current = true; setLoadingOlder(true); setHistoryError(null);
    try {
      const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', c.id)
        .or(olderMessageFilter(cursor)).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MESSAGE_PAGE_SIZE);
      if (error) throw error;
      const raw = (data || []) as Msg[];
      const rows = await signChatMedia(raw);
      if (!current()) return;
      const el = listRef.current; const oldHeight = el?.scrollHeight || 0; const oldTop = el?.scrollTop || 0;
      pinnedRef.current = false;
      setMsgs(prev => mergeMessagePage(rows, prev, true));
      if (raw.length) historyCursor.current = raw[raw.length - 1];
      setHasOlder(raw.length === MESSAGE_PAGE_SIZE);
      void hydrateOffers(rows); void loadReactions(rows, c.id);
      requestAnimationFrame(() => { if (current() && el) el.scrollTop = oldTop + el.scrollHeight - oldHeight; });
    } catch { if (current()) setHistoryError('Older messages could not be loaded. Please try again.'); }
    finally { if (current()) { olderPending.current = false; setLoadingOlder(false); } }
  }, [supabase, hasOlder, hydrateOffers, loadReactions]);

  const loadInbox = useCallback(async () => {
    const generation = ++inboxGeneration.current;
    const current = () => componentLive.current && inboxGeneration.current === generation;
    setLoadingConvs(true); setConversationError(null);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!current()) return;
      const id = data.session?.user.id ?? null;
      uidRef.current = id; setUid(id);
      if (!id) { setConvs([]); return; }
      const list = await loadConversations(id, context);
      if (!current() || uidRef.current !== id) return;
      setConvs(list);
      const target = new URLSearchParams(window.location.search).get('c');
      const selected = target ? list.find(item => item.id === target) : null;
      if (selected && !activeRef.current) void openConv(selected);
    } catch { if (current()) setConversationError('Conversations could not be loaded. Please try again.'); }
    finally { if (current()) setLoadingConvs(false); }
  }, [supabase, context, openConv]);

  useEffect(() => {
    componentLive.current = true;
    let authReload: ReturnType<typeof setTimeout> | undefined;
    void loadInbox();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id ?? null;
      if (_event === 'SIGNED_OUT' && uidRef.current) clearOutbox(uidRef.current);
      if (uidRef.current !== nextId) {
        ++accountGeneration.current;
        ++uploadGeneration.current;
        uploadPending.current = false;
        drafts.current.clear();
        uidRef.current = nextId; setUid(nextId); activeRef.current = null; ++historyGeneration.current;
        setActive(null); setMsgs([]); setConvs([]); setDraft('');
        setAttachmentDraft(null); setSendingFile(false); setReplyTo(null); setEditing(null); setForwarding(null); setPinnedMessage(null); setOffers({});
        setActionError(null); setNotice(null);
        ++inboxGeneration.current;
        if (nextId) authReload = setTimeout(() => { if (componentLive.current) void loadInbox(); }, 0);
      }
    });
    return () => { componentLive.current = false; clearTimeout(authReload); subscription.unsubscribe(); ++inboxGeneration.current; ++historyGeneration.current; activeRef.current = null; };
  }, [supabase, loadInbox]);

  useEffect(() => {
    if (!active || !uid) return;
    let live = true; const account = accountGeneration.current;
    const current = () => live && componentLive.current && account === accountGeneration.current && uidRef.current === uid && activeRef.current?.id === active.id;
    const ch = supabase
      .channel("web_messages_" + active.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "conversation_id=eq." + active.id }, async (p) => {
        let incoming = p.new as Msg;
        if (!current() || activeRef.current?.id !== incoming.conversation_id) return;
        if (isChatMediaUrl(incoming.media_url)) incoming = (await signChatMedia([incoming]))[0];
        if (!current() || activeRef.current?.id !== incoming.conversation_id) return;
        if (incoming.sender_id === uid) forgetOutboxMessage(uid, incoming.id);
        setMsgs(list => mergeMessagePage(list, [{ ...incoming, _delivery: undefined }], true));
        hydrateOffers([incoming]);
        if (incoming.sender_id !== uid) {
          supabase.rpc("mark_conversation_read_v2", { p_conversation_id: incoming.conversation_id }).then(() => {}, () => {});
        }
        setTimeout(() => { if (pinnedRef.current) scrollToEnd(); }, 40);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: "conversation_id=eq." + active.id }, async (p) => {
        let upd = p.new as Msg;
        if (!current() || activeRef.current?.id !== upd.conversation_id) return;
        if (isChatMediaUrl(upd.media_url)) upd = (await signChatMedia([upd]))[0];
        if (!current() || activeRef.current?.id !== upd.conversation_id) return;
        setMsgs((l) => l.map((m) => (m.id === upd.id ? { ...m, ...upd, _delivery: undefined } : m)));
        void loadPin(upd.conversation_id);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages", filter: "conversation_id=eq." + active.id }, (payload) => {
        if (current()) setMsgs(list => list.filter(message => message.id !== (payload.old as { id?: string }).id));
      })
      .subscribe();

    const fetchTyping = async () => {
      const { data } = await supabase.from("conversation_typing").select("*").eq("conversation_id", active.id);
      const fresh = ((data ?? []) as { user_id: string; is_typing: boolean; updated_at: string }[])
        .filter((r) => r.user_id !== uid && r.is_typing && Date.now() - new Date(r.updated_at).getTime() >= 0 && Date.now() - new Date(r.updated_at).getTime() < 7000);
      if (current()) setOtherTyping(fresh.length > 0);
    };
    const typeCh = supabase
      .channel("web_typing_" + active.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_typing", filter: "conversation_id=eq." + active.id }, fetchTyping)
      .subscribe();
    const typePoll = setInterval(fetchTyping, 3000);
    void fetchTyping();
    const reactionChannel = supabase.channel('web_reactions_' + active.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => { const messageId = (payload.new as { message_id?: string }).message_id || (payload.old as { message_id?: string }).message_id; const rows = messageId ? msgsRef.current.filter(row => row.id === messageId) : msgsRef.current; for (let i = 0; i < rows.length; i += MESSAGE_PAGE_SIZE) void loadReactions(rows.slice(i, i + MESSAGE_PAGE_SIZE), active.id); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: 'id=eq.' + active.id }, () => { void loadPin(active.id); })
      .subscribe();

    return () => {
      live = false;
      supabase.removeChannel(ch);
      supabase.removeChannel(typeCh);
      clearInterval(typePoll);
      supabase.removeChannel(reactionChannel);
    };
  }, [supabase, active, uid, hydrateOffers, loadReactions, loadPin]);

  const setTyping = useCallback(async (isTyping: boolean) => {
    if (!active || !uid) return;
    try {
      await supabase.from("conversation_typing").upsert(
        { conversation_id: active.id, user_id: uid, is_typing: isTyping, updated_at: new Date().toISOString() },
        { onConflict: "conversation_id,user_id" }
      );
    } catch { /* non-fatal */ }
  }, [supabase, active, uid]);

  useEffect(() => {
    typingSentAt.current = 0;
    return () => {
      if (typingIdle.current) clearTimeout(typingIdle.current);
      typingIdle.current = null;
      // This closure belongs to the departing account and conversation.
      void setTyping(false);
    };
  }, [setTyping]);

  function onDraftChange(v: string) {
    setDraft(v);
    if (active && !editing) drafts.current.set(active.id, v);
    if (typingIdle.current) clearTimeout(typingIdle.current);
    if (!v.trim()) { void setTyping(false); return; }
    const now = Date.now();
    if (now - typingSentAt.current > 2000) {
      typingSentAt.current = now;
      void setTyping(true);
    }
    typingIdle.current = setTimeout(() => { typingIdle.current = null; void setTyping(false); }, 1500);
  }

  const deliverQueued = useCallback(async (queued: OutboxMessage) => {
    const generation = accountGeneration.current;
    const result = await sendOutboxMessage(supabase, queued);
    if (!componentLive.current || generation !== accountGeneration.current || uidRef.current !== queued.sender_id) return;
    if (result.status === 'confirmed') {
      const [saved] = await signChatMedia([result.row as Msg]);
      if (!componentLive.current || generation !== accountGeneration.current) return;
      if (activeRef.current?.id === queued.conversation_id) setMsgs(list => mergeMessagePage(list, [{ ...saved, _delivery: undefined }], true));
      setConvs(list => list.map(c => c.id === queued.conversation_id ? { ...c, last_message: queued.text || 'Attachment', last_message_time: saved.created_at } : c));
    } else if (activeRef.current?.id === queued.conversation_id) {
      setMsgs(list => list.map(row => row.id === queued.id && row._delivery ? { ...row, _delivery: result.status } : row));
    }
  }, [supabase]);

  useEffect(() => {
    if (!uid) return;
    let live = true;
    const recover = async () => {
      for (const row of readOutbox(uid)) {
        if (!live || uidRef.current !== uid) return;
        if (row._delivery === 'pending') await deliverQueued(row);
      }
    };
    void recover();
    window.addEventListener('online', recover);
    return () => { live = false; window.removeEventListener('online', recover); };
  }, [uid, deliverQueued]);

  async function insertMessage(text: string | null, mediaUrl: string | null, mediaType: string | null, target = activeRef.current, replyId = replyTo?.id ?? null) {
    const senderId = uidRef.current;
    if (!target || !senderId) return false;
    try {
      const queued = enqueueMessage({ conversation_id: target.id, sender_id: senderId,
        receiver_id: target.is_group ? null : target.other_id, text, media_url: mediaUrl,
        media_type: mediaType, thumbnail_url: null, reply_to_id: replyId, view_limit: null });
      if (activeRef.current?.id === target.id) {
        // A canonical private object locator is never a playback URL.
        setMsgs(list => mergeMessagePage(list, [{ ...queued, media_url: isChatMediaUrl(mediaUrl) ? null : mediaUrl }], true));
        pinnedRef.current = true;
      }
      void deliverQueued(queued);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Message could not be saved. Please try again.');
      return false;
    }
  }

  async function send() {
    const text = draft.trim(); const target = activeRef.current;
    if (!text || !target || !uid || sendPending.current) return;
    const generation = accountGeneration.current;
    const current = () => componentLive.current && generation === accountGeneration.current;
    sendPending.current = true; setSending(true); setActionError(null); setNotice(null);
    try {
      if (editing) {
        const saved = await editMessage(supabase, editing, uid, text);
        if (current() && activeRef.current?.id === target.id) { setMsgs(list => mergeMessagePage(list, [saved], true)); setEditing(null); setDraft(drafts.current.get(target.id) || ''); }
      } else {
        const ok = await insertMessage(text, null, null, target);
        if (ok && current()) drafts.current.delete(target.id);
        if (ok && current() && activeRef.current?.id === target.id) { setDraft(''); setReplyTo(null); void setTyping(false); }
      }
    } catch (error) { if (current() && activeRef.current?.id === target.id) setActionError(error instanceof Error ? error.message : 'Message not saved. Please try again.'); }
    finally { sendPending.current = false; setSending(false); }
  }

  async function runMessageAction(message: Msg, action: () => Promise<void>) {
    if (messageActionPending.current || !!message._delivery || message.id.startsWith('temp-')) return;
    const conversationId = activeRef.current?.id;
    messageActionPending.current = true; setBusyMessage(message.id); setActionError(null); setNotice(null);
    try { await action(); }
    catch (error) { if (activeRef.current?.id === conversationId) setActionError(error instanceof Error ? error.message : 'The action could not be completed. Please try again.'); }
    finally { messageActionPending.current = false; setBusyMessage(null); }
  }

  const messageActions: MessageActions = {
    openPrivate: message => { if (PRIVATE_MEDIA_SESSIONS_ENABLED && uid && uidRef.current === uid && message.view_limit && message.conversation_id === activeRef.current?.id && message.sender_id !== uid && !viewedPrivateIds.has(message.id)) setPrivateMedia({ id: message.id, userId: uid, conversationId: message.conversation_id, account: accountGeneration.current }); },
    viewedPrivateIds,
    refreshMedia: message => { void runMessageAction(message, async () => {
      const account = accountGeneration.current;
      const [signed] = await signChatMedia([message]);
      if (account === accountGeneration.current && activeRef.current?.id === message.conversation_id) setMsgs(list => list.map(row => row.id === message.id ? signed : row));
    }); },
    busy: busyMessage, pinnedId: pinnedMessage?.id ?? null,
    retry: message => { const queued = uid ? readOutbox(uid).find(row => row.id === message.id) : null; if (queued && queued._delivery !== 'conflict') void deliverQueued(queued); },
    reply: message => { setReplyTo(message); setEditing(null); setActionError(null); },
    edit: message => { setEditing(message); setReplyTo(null); setDraft(message.text || ''); setActionError(null); },
    forward: message => { setForwarding(message); setActionError(null); },
    react: (message, emoji) => { if (uid) void runMessageAction(message, async () => { await reactToMessage(supabase, message.id, uid, emoji); await loadReactions([message], message.conversation_id); }); },
    pin: message => { void runMessageAction(message, async () => { await pinMessage(supabase, message.conversation_id, pinnedMessage?.id === message.id ? null : message.id); await loadPin(message.conversation_id); }); },
  };

  async function attach(list: FileList | readonly File[] | null) {
    if (!list || !active || !uid || uploadPending.current || recording || recorderPending.current) return;
    const target = activeRef.current; const senderId = uidRef.current;
    const f = list[0];
    if (!f || !target || !senderId) return;
    const generation = accountGeneration.current;
    const uploadId = ++uploadGeneration.current;
    uploadPending.current = true; setAttachmentDraft(f);
    setSendingFile(true); setActionError(null);
    try {
    const isImage = f.type.startsWith("image/");
    const isVideo = f.type.startsWith("video/");
    const bucket = isImage || isVideo ? "chat-media" : "chat-files";
    const safeName = f.name.replace(/[^a-zA-Z0-9_.\-]/g, "_");
    const path = senderId + "/" + crypto.randomUUID() + "_" + safeName;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (upErr) throw new Error("Upload failed. Please try again.");
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    if (!componentLive.current || generation !== accountGeneration.current || uidRef.current !== senderId) return;
    const sent = await insertMessage(isImage || isVideo ? null : '📄 ' + f.name, pub.publicUrl, isImage ? 'image' : isVideo ? 'video' : 'document', target);
    if (sent && activeRef.current?.id === target.id) { setAttachmentDraft(null); if (fileRef.current) fileRef.current.value = ''; if(cameraRef.current)cameraRef.current.value=''; }
    } catch (error) { if (componentLive.current && generation === accountGeneration.current && activeRef.current?.id === target.id) setActionError(error instanceof Error ? error.message : 'Attachment not sent. Please try again.'); }
    finally { if (uploadId === uploadGeneration.current) { uploadPending.current = false; setSendingFile(false); } }
  }

  useEffect(() => {
    return () => {
      ++recordingGeneration.current;
      const rec = recRef.current;
      if (rec?.state === 'recording') { try { rec.stop(); } catch { /* already stopped */ } }
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null; recRef.current = null;
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      recTimerRef.current = null; recorderPending.current = false;
      setRecording(false); setRecSecs(0);
    };
  }, [active?.id, uid]);

  async function startRecording() {
    const target = activeRef.current;
    if (recording || !target || !uid || recorderPending.current || uploadPending.current || sendPending.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setActionError('Voice recording is not supported in this browser. You can attach an audio file instead.'); return;
    }
    const generation = recordingGeneration.current;
    recorderPending.current = true; setActionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== recordingGeneration.current || uidRef.current !== uid || activeRef.current?.id !== target.id) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      chunksRef.current = chunks;
      rec.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
      rec.start(); recRef.current = rec;
      setRecSecs(0); setRecording(true);
      recTimerRef.current = setInterval(() => setRecSecs(seconds => seconds + 1), 1000);
    } catch {
      streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
      if (activeRef.current?.id === target.id) setActionError('Microphone access is needed for voice messages. Please allow it and try again.');
    } finally { if (generation === recordingGeneration.current) recorderPending.current = false; }
  }

  function teardownRecording() {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null; recRef.current = null;
    setRecording(false); setRecSecs(0);
  }

  async function stopRecording(sendIt: boolean) {
    const rec = recRef.current; const target = activeRef.current; const senderId = uidRef.current;
    if (!rec || recorderPending.current) return;
    recorderPending.current = true;
    const generation = recordingGeneration.current;
    const account = accountGeneration.current;
    let uploadId: number | undefined;
    const mime = rec.mimeType || 'audio/webm';
    try {
      await new Promise<void>((resolve, reject) => {
        rec.onstop = () => resolve(); rec.onerror = () => reject(new Error('Recording failed. Please try again.'));
        try { if (rec.state === 'inactive') resolve(); else rec.stop(); } catch (error) { reject(error); }
      });
      if (generation !== recordingGeneration.current) return;
      const blob = new Blob(chunksRef.current, { type: mime });
      teardownRecording();
      if (!sendIt || !blob.size || !target || !senderId || generation !== recordingGeneration.current || uidRef.current !== senderId) return;
      uploadPending.current = true; setSendingFile(true);
      uploadId = ++uploadGeneration.current;
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      const path = senderId + '/' + crypto.randomUUID() + '_voice.' + ext;
      const { error } = await supabase.storage.from('chat-media').upload(path, blob, { contentType: mime });
      if (error) throw new Error('Voice message not sent. Please try again.');
      const { data } = supabase.storage.from('chat-media').getPublicUrl(path);
      if (componentLive.current && account === accountGeneration.current && uidRef.current === senderId) await insertMessage(null, data.publicUrl, 'audio', target);
    } catch (error) {
      if (generation === recordingGeneration.current) teardownRecording();
      if (componentLive.current && account === accountGeneration.current && activeRef.current?.id === target?.id) setActionError(error instanceof Error ? error.message : 'Voice message not sent.');
    } finally {
      if (generation === recordingGeneration.current) recorderPending.current = false;
      if (uploadId !== undefined && uploadId === uploadGeneration.current) { uploadPending.current = false; setSendingFile(false); }
    }
  }

  async function respondOffer(offerId: string, action: string, counterAmount?: number) {
    const { error } = await supabase.rpc("respond_offer", { p_offer_id: offerId, p_action: action, p_counter_amount: counterAmount ?? null });
    if (error) { alert("Could not respond: " + error.message); return; }
    setOffers((prev) => ({ ...prev, [offerId]: { ...(prev[offerId] || ({} as OfferLive)), status: action } }));
    setCountering(null);
    setCounterAmt("");
  }

  const shownConvs = useMemo(() => {
    const t = query.trim().toLowerCase();
    // A community's chat never lists here; it opens from the community page and lives there.
    const base = convs.filter((c) => !(c.is_group && c.group_type === "community") && !c.request_pending && (tab === "groups" ? c.is_group : tab === "unread" ? c.unread > 0 : true));
    if (!t) return base;
    return base.filter((c) => (c.title + " " + (c.username ?? "")).toLowerCase().includes(t));
  }, [convs, query, tab]);

  const offerProps: OfferProps = { uid, offers, countering, counterAmt, setCountering, setCounterAmt, respondOffer };

  const refCard = refListing ? (
    <Link href={"/market/" + refListing.id} className="mt-2 flex items-center gap-3 rounded-lg border border-ink/10 p-2.5 transition-colors duration-[140ms] hover:bg-surface">
      {refListing.images?.[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={refListing.images[0]} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{refListing.title}</span>
        <span className="block text-[13px] text-accent">{(refListing.currency === "USD" ? "$" : refListing.currency + " ") + Number(refListing.price).toLocaleString()}</span>
      </span>
      {refListing.status !== "available" ? (
        <span className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase text-secondary">{refListing.status}</span>
      ) : null}
    </Link>
  ) : null;

  const typingLine = otherTyping ? <p className="text-[12px] text-accent">typing…</p> : null;

  const convButton = (c: Conv) => (
    <div key={c.id} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void openConv(c); } }}
      onClick={() => openConv(c)}
      className={"flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[140ms] " + (active?.id === c.id ? "bg-surface-elevated" : "hover:bg-surface")}
    >
      <StoryAvatar userId={c.other_id} name={c.title} avatarUrl={c.avatar} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[14px] font-semibold text-ink">{c.title}</span>{!c.is_group && c.other_id ? <VerifiedBadge userId={c.other_id} size={13} /> : null}{c.is_group && c.group_type === "community" ? <span className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase text-secondary">Community</span> : null}
            {c.unread > 0 ? <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-pearl" aria-hidden /> : null}
          </span>
          {c.last_message_time ? <span className="shrink-0 text-[11px] text-muted">{timeAgo(c.last_message_time)}</span> : null}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={"truncate text-[13px] " + (c.unread > 0 ? "font-medium text-secondary" : "text-muted")}>{c.last_message || "Say hello"}</span>
          {c.unread > 0 ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-pearl px-1.5 text-[11px] font-bold text-on-pearl">{c.unread}</span> : null}
        </span>
      </span>
    </div>
  );

  const composer = (
    <div>
      {shareDetails && <ShareDetails key={(uid||'')+':'+(active?.id||'')} kind={shareDetails} onClose={()=>setShareDetails(null)} onSend={async card=>{
        if(uidRef.current!==uid || activeRef.current?.id!==active?.id)return false;
        return insertMessage(attachmentCardText(card),JSON.stringify(card),'link');
      }}/>}
      {PRIVATE_MEDIA_SESSIONS_ENABLED && privateMedia && privateMedia.userId === uid && privateMedia.conversationId === active?.id && privateMedia.account === accountGeneration.current && <PrivateMediaViewer key={privateMedia.userId+":"+privateMedia.id} messageId={privateMedia.id} userId={privateMedia.userId}
        onClose={() => setPrivateMedia(current => current?.id === privateMedia.id && current?.userId === privateMedia.userId && current?.account === privateMedia.account ? null : current)} onConsumed={remaining => { if (remaining <= 0 && privateMedia.account === accountGeneration.current && privateMedia.conversationId === activeRef.current?.id) setViewedPrivateIds(prev => new Set(prev).add(privateMedia.id)); }} />}
      {actionError ? <div role="alert" className="mb-2 text-sm text-danger"><p>{actionError}</p>{attachmentDraft ? <button type="button" disabled={sendingFile} className="mt-1 underline" onClick={() => void attach([attachmentDraft])}>Retry attachment</button> : null}</div> : null}
      {notice ? <p role="status" className="mb-2 text-sm text-ink">{notice}</p> : null}
      {editing || replyTo ? <div className="mb-2 flex items-center justify-between gap-3 rounded-md bg-surface p-2 text-sm text-ink"><span className="truncate">{editing ? 'Editing message' : 'Replying to: ' + (replyTo?.text || 'Attachment')}</span><button type="button" onClick={() => { if (editing) setDraft(active ? drafts.current.get(active.id) || '' : ''); setEditing(null); setReplyTo(null); }}>Cancel</button></div> : null}
      {forwarding ? <div className="mb-2 rounded-md bg-surface p-3 text-sm text-ink"><div className="flex justify-between"><strong>Forward to</strong><button type="button" disabled={!!busyMessage} onClick={() => setForwarding(null)}>Cancel</button></div><div className="mt-2 max-h-40 overflow-y-auto">{convs.filter(c => c.id !== active?.id && !c.request_pending).map(c => <button type="button" key={c.id} disabled={!!busyMessage} className="block w-full rounded px-2 py-2 text-left hover:bg-surface-elevated" onClick={() => { if (uid) void runMessageAction(forwarding, async () => { await forwardMessage(supabase, forwarding, c, uid); if (activeRef.current?.id === forwarding.conversation_id) { setForwarding(null); setNotice('Forwarded to ' + c.title + '.'); } }); }}>{c.title}</button>)}{convs.filter(c => c.id !== active?.id && !c.request_pending).length === 0 ? <p>No other conversations available.</p> : null}</div></div> : null}
    <div className="flex items-end gap-2">
      <button onClick={() => fileRef.current?.click()} disabled={sendingFile || sending || !!editing} title="Attach" aria-label="Attach a file" className="rounded-md p-2.5 text-muted transition-colors duration-[140ms] hover:bg-surface hover:text-accent disabled:opacity-40">
        <Paperclip size={18} />
      </button>
      <button type="button" title="Take a photo or video" onClick={()=>cameraRef.current?.click()} disabled={sendingFile||sending||!!editing} className="p-2 text-muted" aria-label="Camera">Camera</button>
      <input ref={cameraRef} type="file" accept="image/*,video/*" capture="environment" hidden onChange={e=>attach(e.target.files)}/>
      <details className="relative"><summary className="cursor-pointer p-2 text-muted" aria-label="Share contact or location">More</summary><div className="absolute bottom-full left-0 z-20 rounded-lg bg-surface-elevated p-2 shadow-lg"><button type="button" onClick={()=>setShareDetails('contact')} className="block p-2">Contact</button><button type="button" onClick={()=>setShareDetails('location')} className="block p-2">Location</button></div></details>
      <input ref={fileRef} type="file" hidden onChange={(e) => attach(e.target.files)} />
      {recording ? (
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-danger">{Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, "0")}</span>
          <button onClick={() => stopRecording(false)} title="Cancel" className="rounded-md bg-surface px-2.5 py-2 text-[12px] text-ink transition-colors duration-[140ms] hover:bg-surface-elevated">Cancel</button>
          <button onClick={() => stopRecording(true)} title="Send voice note" className="rounded-md bg-danger p-2.5 text-white transition-opacity duration-[140ms] hover:opacity-90"><Square size={16} /></button>
        </span>
      ) : (
        <button onClick={startRecording} disabled={sendingFile || sending || !!editing} title="Voice message" aria-label="Record a voice message" className="rounded-md p-2.5 text-muted transition-colors duration-[140ms] hover:bg-surface hover:text-accent disabled:opacity-40"><Mic size={18} /></button>
      )}
      <textarea aria-label={editing ? "Edit message" : "Message"} disabled={sending} value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        onBlur={() => setTyping(false)}
        placeholder={sendingFile ? "Sending attachment" : "Message"}
        rows={1}
        className="max-h-32 flex-1 resize-none rounded-md bg-surface px-4 py-2.5 text-[16px] sm:text-[14px] text-ink placeholder:text-muted outline-none transition-colors duration-[140ms] focus:bg-surface-elevated"
      />
      <button onClick={send} disabled={!draft.trim() || sending} className="rounded-md bg-pearl p-2.5 text-on-pearl transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-30" title="Send">
        <Send size={18} />
      </button>
    </div>
    </div>
  );

  const historyControl = historyError || hasOlder ? <div className="py-2 text-center text-sm text-ink">{historyError ? <p role="alert">{historyError}</p> : null}<button type="button" disabled={loadingOlder || loadingMsgs} className="rounded-md bg-surface px-3 py-2" onClick={() => { if (historyCursor.current) void loadOlder(); else if (active) void openConv(active); }}>{loadingOlder ? "Loading older messages…" : historyError ? "Try again" : "Load older messages"}</button></div> : null;
  const pinnedBanner = pinnedMessage ? <div className="mt-2 flex items-center gap-2 rounded-md bg-surface p-2 text-sm text-ink"><span className="min-w-0 flex-1 truncate">Pinned · {pinnedMessage.text || "Attachment"}</span><button type="button" disabled={!!busyMessage} onClick={() => messageActions.pin(pinnedMessage)}>Unpin</button></div> : null;
  const inboxError = conversationError ? <div role="alert" className="p-4 text-sm text-ink">{conversationError}<button type="button" className="ml-2 underline" onClick={() => void loadInbox()}>Try again</button></div> : null;

  if (compact) {
    return (
      <div ref={surfaceRef} className={active ? "fixed left-0 top-0 z-[70] flex h-[100dvh] w-full touch-none flex-col overflow-hidden bg-white px-3 pt-[max(env(safe-area-inset-top),8px)]" : "flex h-[calc(100dvh-96px)] min-h-[70vh] flex-col px-1"}>
        {!active ? (
          <>
            <h1 className="mb-3 font-display text-xl text-porcelain">{heading}</h1>
            {inboxError}
            {loadingConvs ? (
              <p className="py-12 text-center text-sm text-muted">Loading</p>
            ) : shownConvs.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted">No conversations here yet.</p>
            ) : (
              shownConvs.map(convButton)
            )}
          </>
        ) : (
          <>
            <header className="border-b border-ink/10 pb-3">
              <div className="flex items-center gap-3">
                <button onClick={() => { activeRef.current = null; ++historyGeneration.current; setActive(null); }} className="rounded-md p-1.5 text-secondary transition-colors duration-[140ms] hover:bg-surface hover:text-ink" title="Back">←</button>
                <StoryAvatar userId={active.other_id} name={active.title} avatarUrl={active.avatar} size={36} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-[15px] font-semibold text-ink"><span className="truncate">{active.title}</span>{!active.is_group && active.other_id ? <VerifiedBadge userId={active.other_id} size={13} /> : null}</p>
                  {typingLine}
                  {active.is_group && active.group_type === "community" && active.group_ref_id ? <Link href={"/communities/" + active.group_ref_id} className="text-[12px] text-accent hover:underline">Community chat · open the community</Link> : null}
                </div>
              </div>
              {active && !active.is_group ? <CallButtons otherId={active.other_id} conversationId={active.id} name={active.title} /> : null}
              {active && active.is_group ? <GroupCallBar conversationId={active.id} /> : null}
              {refCard}
              {pinnedBanner}
            </header>
            <div ref={listRef} className="min-h-0 flex-1 touch-pan-y space-y-2 overflow-y-auto overscroll-contain py-4">
              {historyControl}
              {loadingMsgs ? <p className="py-12 text-center text-sm text-muted">Loading</p> : msgs.map((m) => <BubbleView key={m.id} m={m} uid={uid} offer={offerProps} actions={messageActions} replySource={msgs.find(row => row.id === m.reply_to_id)} />)}
              <div ref={bottomRef} />
            </div>
            <footer className="border-t border-ink/10 pt-3">{composer}</footer>
            {debugOn ? <pre ref={debugRef} className="pointer-events-none fixed left-2 top-2 z-[90] rounded bg-black/80 p-2 text-[11px] leading-tight text-white" /> : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <section className="flex w-[340px] shrink-0 flex-col border-r border-ink/10">
        <div className="px-4 pb-2 pt-6">
          <h1 className="font-display text-xl text-porcelain">{heading}</h1>
          {context === "personal" ? (
            <p className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold">
              <Link href="/messages/requests" className="text-accent hover:underline">Message requests</Link>
              <span className="text-muted">·</span>
              <Link href="/calls" className="flex items-center gap-1 text-accent hover:underline"><Phone size={11} /> Calls</Link>
            </p>
          ) : null}
          <div className="relative mt-3">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-md bg-surface py-2 pl-9 pr-3 text-[13px] text-ink placeholder:text-muted outline-none transition-colors duration-[140ms] focus:bg-surface-elevated"
            />
          </div>
          {context === "personal" ? (
            <div className="mt-3 flex gap-1.5">
              {(["chats", "groups", "unread"] as const).map((k) => (
                <button key={k} onClick={() => setTab(k)} className={"rounded-full px-3 py-1 text-[12px] font-semibold transition-colors duration-[140ms] " + (tab === k ? "bg-ink text-white" : "bg-surface text-secondary hover:text-ink")}>{k === "chats" ? "Chats" : k === "groups" ? "Groups" : "Unread"}</button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto">
          {inboxError}
            {loadingConvs ? (
            <p className="py-12 text-center text-sm text-muted">Loading</p>
          ) : shownConvs.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted">No conversations yet.</p>
          ) : (
            shownConvs.map(convButton)
          )}
        </div>
      </section>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-pearl/50" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-pearl" />
            </span>
            <p className="text-[14px] text-muted">Pick a conversation</p>
          </div>
        ) : (
          <>
            <header className="border-b border-ink/10 px-5 py-3">
              <div className="flex items-center gap-3">
                <StoryAvatar userId={active.other_id} name={active.title} avatarUrl={active.avatar} size={38} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-[15px] font-semibold text-ink"><span className="truncate">{active.title}</span>{!active.is_group && active.other_id ? <VerifiedBadge userId={active.other_id} size={13} /> : null}</p>
                  {typingLine ?? (active.username ? <p className="text-[12px] text-muted">@{active.username}</p> : null)}
                  {active.is_group && active.group_type === "community" && active.group_ref_id ? <Link href={"/communities/" + active.group_ref_id} className="text-[12px] text-accent hover:underline">Community chat · open the community</Link> : null}
                </div>
              </div>
              {active && !active.is_group ? <CallButtons otherId={active.other_id} conversationId={active.id} name={active.title} /> : null}
              {active && active.is_group ? <GroupCallBar conversationId={active.id} /> : null}
              {refCard}
              {pinnedBanner}
            </header>
            <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
              {historyControl}
              {loadingMsgs ? (
                <p className="py-12 text-center text-sm text-muted">Loading</p>
              ) : (
                msgs.map((m) => <BubbleView key={m.id} m={m} uid={uid} offer={offerProps} actions={messageActions} replySource={msgs.find(row => row.id === m.reply_to_id)} />)
              )}
              <div ref={bottomRef} />
            </div>
            <footer className="border-t border-ink/10 px-4 py-3">{composer}</footer>
          </>
        )}
      </section>
    </div>
  );
}

// Declared once, outside the component: a render updates these, it never rebuilds them.
type OfferProps = { uid: string | null; offers: Record<string, OfferLive>; countering: string | null; counterAmt: string; setCountering: (v: string | null) => void; setCounterAmt: (v: string) => void; respondOffer: (offerId: string, action: string, counterAmount?: number) => void };
function OfferCardView({ m, uid, offers, countering, counterAmt, setCountering, setCounterAmt, respondOffer }: { m: Msg } & OfferProps) {
    let j: { offer_id?: string; amount?: number; currency?: string; status?: string } = {};
    try { j = JSON.parse(m.media_url || "{}"); } catch { return null; }
    if (!j.offer_id) return null;
    const live = offers[j.offer_id];
    const status = live?.status || j.status || "pending";
    const amount = live?.amount ?? j.amount ?? 0;
    const currency = live?.currency ?? j.currency ?? "";
    const proposer = live?.proposer_id ?? m.sender_id;
    const canRespond = status === "pending" && uid !== null && uid !== proposer;
    const color = status === "accepted" ? "text-success" : status === "pending" ? "text-accent" : "text-muted";
    return (
      <div className="min-w-48 rounded-lg border border-ink/15 bg-surface p-3">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted"><Tag size={12} /> Offer</p>
        <p className="mt-0.5 text-[18px] font-semibold text-ink">{(currency === "USD" ? "$" : currency + " ") + Number(amount).toLocaleString()}</p>
        <p className={"text-[12px] font-semibold capitalize " + color}>{status}</p>
        {canRespond ? (
          countering === j.offer_id ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <input value={counterAmt} onChange={(e) => setCounterAmt(e.target.value)} inputMode="numeric" placeholder="Counter amount" className="rounded-md bg-surface-elevated px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted outline-none" />
              <div className="flex gap-1.5">
                <button onClick={() => { const n = Number(counterAmt.replace(/,/g, "")); if (n > 0) respondOffer(j.offer_id!, "countered", n); }} className="rounded-md bg-pearl px-2.5 py-1.5 text-[12px] font-semibold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90">Send counter</button>
                <button onClick={() => setCountering(null)} className="rounded-md bg-surface-elevated px-2.5 py-1.5 text-[12px] text-ink transition-colors duration-[140ms] hover:bg-surface">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => respondOffer(j.offer_id!, "accepted")} className="rounded-md bg-success/20 px-2.5 py-1.5 text-[12px] font-semibold text-success transition-opacity duration-[140ms] hover:opacity-80">Accept</button>
              <button onClick={() => setCountering(j.offer_id!)} className="rounded-md bg-surface-elevated px-2.5 py-1.5 text-[12px] text-ink transition-colors duration-[140ms] hover:bg-surface">Counter</button>
              <button onClick={() => respondOffer(j.offer_id!, "declined")} className="rounded-md bg-danger/15 px-2.5 py-1.5 text-[12px] font-semibold text-danger transition-opacity duration-[140ms] hover:opacity-80">Decline</button>
            </div>
          )
        ) : null}
      </div>
    );
  }

type MessageActions = { openPrivate: (message: Msg) => void; viewedPrivateIds: Set<string>; refreshMedia: (message: Msg) => void; retry: (message: Msg) => void; busy: string | null; pinnedId: string | null; reply: (message: Msg) => void; edit: (message: Msg) => void; forward: (message: Msg) => void; react: (message: Msg, emoji: string) => void; pin: (message: Msg) => void };
const BubbleView = memo(function BubbleView({ m, uid, offer, actions, replySource }: { m: Msg; uid: string | null; offer: OfferProps; actions: MessageActions; replySource?: Msg }) {
    const retriedMedia = useRef<string | null>(null);
    const renewMedia = () => { if (m.media_url && retriedMedia.current !== m.media_url) { retriedMedia.current = m.media_url; actions.refreshMedia(m); } };
    const mine = m.sender_id === uid;
    if (m.deleted_at) return null;
    const pending = !!m._delivery || m.id.startsWith('temp-');
    const reactions = [...new Set((m._reactions || []).map(row => row.emoji))];
    return (
      <div className={"flex " + (mine ? "justify-end" : "justify-start")}>
        <div className={"max-w-[70%] rounded-2xl px-3.5 py-2 " + (mine ? "bg-[#0B1E3D] text-white shadow-sm" : "bg-surface text-ink")}>
          {m.forwarded_from_id ? <p className="mb-1 text-xs opacity-80">Forwarded</p> : null}
          {m.reply_to_id ? <blockquote className="mb-2 border-l-2 border-current pl-2 text-xs opacity-80">{replySource?.deleted_at ? 'Message removed' : replySource?.text || (replySource ? 'Attachment' : 'Reply to an earlier message')}</blockquote> : null}
          {m.media_type === "payment" || m.payment_id ? (
            <span className={"flex items-center gap-1.5 text-[13px] " + (mine ? "text-white/75" : "text-secondary")}><Wallet size={14} /> Payment · open the Platinum Circles app</span>
          ) : null}
          {m.view_limit ? PRIVATE_MEDIA_SESSIONS_ENABLED ? <button type="button" disabled={mine || actions.viewedPrivateIds.has(m.id)} onClick={() => actions.openPrivate(m)} className="rounded-lg border border-current/30 p-3 text-sm disabled:opacity-60">{actions.viewedPrivateIds.has(m.id) ? "Viewed" : mine ? "Private attachment" : "Open private attachment"}</button> : <p className="text-sm">Limited-view attachment · Open in phone app</p> : null}
          {(() => { const card=m.view_limit?null:parseChatAttachmentCard(m.media_url); return card?<div className="my-2 rounded-lg border border-current/30 p-3"><strong>{attachmentCardText(card)}</strong>{attachmentCardLinks(card).map(link=><a key={link.url} href={link.url} target={card.kind==='location'?'_blank':undefined} rel="noopener noreferrer" className="block py-2 underline">{link.label}</a>)}</div>:null; })()}
          {m.shared_post_id ? <SharedPostCard postId={m.shared_post_id} /> : null}
          {m.media_type === "offer" && m.media_url ? <OfferCardView m={m} {...offer} /> : null}
          {!m.view_limit && (m.media_type === "image" || m.media_type === "gif" || m.media_type === "sticker") && m.media_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.media_url} onError={renewMedia} alt="Shared image" role="button" tabIndex={0} onClick={() => window.dispatchEvent(new CustomEvent("pc-view-media", { detail: { url: m.media_url } }))} onKeyDown={(e) => { if (e.key === "Enter") window.dispatchEvent(new CustomEvent("pc-view-media", { detail: { url: m.media_url } })); }} className="mb-1 max-h-72 cursor-zoom-in rounded-lg object-contain" />
          ) : null}
          {!m.view_limit && m.media_type === "video" && m.media_url ? (
            <video src={m.media_url} onError={renewMedia} controls preload="metadata" className="mb-1 max-h-72 rounded-lg" />
          ) : null}
          {!m.view_limit && (m.media_type === "audio" || m.media_type === "voice") && m.media_url ? (
            <audio onError={renewMedia} controls preload="metadata" className="mb-1 w-[240px] max-w-full"><source src={m.media_url} type={/\.(m4a|mp4)(\?|$)/i.test(m.media_url) ? "audio/mp4" : /\.webm(\?|$)/i.test(m.media_url) ? "audio/webm" : undefined} /><a href={m.media_url} target="_blank" rel="noopener noreferrer" className="underline">Voice message</a></audio>
          ) : null}
          {!m.view_limit && m.media_type === "document" && m.media_url ? (
            <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-1.5 text-[13px] underline">
              <FileText size={14} /> {m.text?.replace("📄 ", "") || "Document"}
            </a>
          ) : null}
          {m.text && m.media_type !== "document" ? <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{m.text}</p> : null}
          <p className={"mt-0.5 text-[10px] " + (mine ? "text-white/80" : "text-secondary")}>{timeAgo(m.created_at)}{m.edited_at ? ' · edited' : ''}{mine ? pending ? m._delivery === 'rejected' ? ' · Not sent' : m._delivery === 'conflict' ? ' · Delivery conflict' : ' · Waiting for confirmation'  : m.read_at ? ' · Read' : m.delivered_at ? ' · Delivered' : ' · Sent' : ''}</p>
          {pending && m._delivery !== 'conflict' ? <button type="button" onClick={() => actions.retry(m)} className="mt-1 text-xs underline">Retry delivery</button> : null}
          {!pending && !m.view_limit && m.media_type && ['image', 'gif', 'sticker', 'video', 'audio', 'voice', 'document'].includes(m.media_type) && !m.media_url ? <button type="button" onClick={() => actions.refreshMedia(m)} className="text-xs underline">Attachment unavailable · Retry</button> : null}
          {reactions.length ? <div className="mt-1 flex flex-wrap gap-1">{reactions.map(emoji => <button type="button" key={emoji} disabled={!!actions.busy} aria-pressed={m._reactions?.some(row => row.emoji === emoji && row.user_id === uid)} aria-label={'React ' + emoji} onClick={() => actions.react(m, emoji)} className="rounded border border-current/30 px-1.5 py-0.5 text-xs">{emoji} {m._reactions?.filter(row => row.emoji === emoji).length}</button>)}</div> : null}
          {!pending && !m.is_system_message ? <details className="mt-1 text-xs"><summary className="cursor-pointer py-1" aria-label="Message actions">More</summary><div className="flex flex-wrap gap-2 py-1">
            <button type="button" disabled={!!actions.busy} onClick={() => actions.reply(m)}>Reply</button>
            {mine && !m.media_type && !m.shared_post_id && !m.payment_id ? <button type="button" disabled={!!actions.busy} onClick={() => actions.edit(m)}>Edit</button> : null}
            <button type="button" disabled={!!actions.busy} onClick={() => actions.pin(m)}>{actions.pinnedId === m.id ? 'Unpin' : 'Pin'}</button>
            {canForwardMessage(m) ? <button type="button" disabled={!!actions.busy} onClick={() => actions.forward(m)}>Forward</button> : null}
          </div><div className="flex flex-wrap gap-1">{['❤️', '😂', '👍', '😮', '😢', '🔥'].map(emoji => <button type="button" key={emoji} aria-label={'React ' + emoji} aria-pressed={m._reactions?.some(row => row.emoji === emoji && row.user_id === uid) ?? false} disabled={!!actions.busy} onClick={() => actions.react(m, emoji)} className="p-1.5">{emoji}</button>)}</div></details> : null}
        </div>
      </div>
    );
});
