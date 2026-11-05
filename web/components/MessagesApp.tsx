"use client";
import NextImage from "next/image";

import { memo, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, Info, Mail, MoreHorizontal, Search, Send, FileText, Tag, Wallet, Paperclip, Mic, Square, Phone, SquarePen, UserRound, Video, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { loadConversations, loadConversationWindow, loadMoreConversations, lookupConversations,
  webInboxOptions, matchesWebInbox, compareWebInbox, type Conv, type Msg } from "@/lib/messages";
import { createInboxMergeGuard, inboxQueryKey, type InboxPaging } from '../../shared/inboxWindow';
import { createInboxRefreshQueue } from '../../shared/inboxRefreshQueue';
import { signChatMedia, isChatMediaUrl, withoutChatMedia } from "@/lib/chatMedia";
import { enqueueMessage, readOutbox, sendOutboxMessage, clearOutbox, forgetOutboxMessage, type OutboxMessage } from "@/lib/messageOutbox";
import { StoryAvatar } from "@/components/StoryAvatar";
import { CallButtons } from "@/components/CallButtons";
import { GroupCallBar } from "@/components/GroupCallBar";
import { ShareDetails } from "@/components/ShareDetails";
import { parseChatAttachmentCard, attachmentCardText, attachmentCardLinks } from "../../shared/chatAttachmentCards";
import { PrivateMediaViewer } from "@/components/PrivateMediaViewer";
import { ChatVideo } from "@/components/ChatVideo";
import { SharedPostCard } from "@/components/SharedPostCard";
import { RelativeTime } from "@/components/RelativeTime";
import { MESSAGE_PAGE_SIZE, olderMessageFilter, mergeMessagePage, type MessageCursor } from "../../shared/messageHistory";
import { editMessage, reactToMessage, pinMessage, forwardMessage, canForwardMessage } from "@/lib/messageActions";
import { acknowledgeConversationRead, canMarkConversationRead } from "../../shared/messageReceipts";
import { createTypingActivity, type TypingRow } from "../../shared/typingActivity";
import { GifPicker } from "@/components/GifPicker";
import { parseStoryMessageReference } from "../../shared/storyMessageReference";
import { RichText } from "@/components/RichText";
import { NewMessageDialog } from "@/components/NewMessageDialog";
import { ForwardConversationPicker } from '@/components/ForwardConversationPicker';
import { withTimeout } from "@/lib/withTimeout";
import { getNavigationStore } from '@/lib/navigationCache';
import { createWebSessionHistory } from '@/lib/sessionHistory';
import { MeasuredHistoryPage } from './MeasuredHistoryPage';
import { MeasuredThreadMessage } from './MeasuredThreadMessage';
import { createThreadWindow, type ThreadWindow, type ThreadSnapshot } from '../../shared/threadWindow';
import { retainRecord } from '../../shared/retainedMaps';
import type { HistorySnapshot, SessionHistory } from '../../shared/sessionHistory';
import { navigationMessages, revalidateMessageWindow, type MessageNavigationMemory } from '@/lib/messageNavigationMemory';
import { profilePath } from "@/lib/profileLookup";
import workspace from "./MessagesWorkspace.module.css";

const LIMITED_MEDIA_VIEWER_ENABLED = process.env.NEXT_PUBLIC_PRIVATE_MEDIA_SESSIONS_ENABLED === 'true'
  || process.env.NEXT_PUBLIC_LEGACY_LIMITED_MEDIA_ENABLED === 'true';

const subscribeLocation = (listener: () => void) => { window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); };
const debugSnapshot = () => new URLSearchParams(window.location.search).get("debug") === "1";
const noDebugSnapshot = () => false;

type OfferLive = { id: string; status: string; proposer_id: string; amount: number; currency: string };
type MiniListing = { id: string; title: string; price: number; currency: string; images: string[]; status: string };

export function MessagesApp({ context = "personal", heading = "Messages", compact: compactProp = false }: { context?: string; heading?: string; compact?: boolean }) {
  // A phone width uses the one-pane layout on its own.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => { const mq = window.matchMedia("(max-width: 767px)"); const apply = () => setIsNarrow(mq.matches); apply(); mq.addEventListener("change", apply); return () => mq.removeEventListener("change", apply); }, []);
  const compact = compactProp || isNarrow;
  const [supabase] = useState(createClient);
  const [navigationStore] = useState(getNavigationStore);
  const [navigationMemory] = useState(() => {
    const session = navigationStore.getSnapshot();
    const saved = navigationStore.cache.read<MessageNavigationMemory>(session.scope, `messages:${context}`);
    if (!saved || saved.owner !== session.owner || saved.context !== context) return null;
    const requested = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('c');
    return requested && requested !== saved.active?.id ? { ...saved, active: null, messages: [], draft: '', cursor: null, hasOlder: false, top: 0, pinned: true } : saved;
  });
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [shareDetails,setShareDetails] = useState<"contact"|"location"|null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uid, setUid] = useState<string | null>(navigationMemory?.owner ?? null);
  const [convs, setConversationState] = useState<Conv[]>(navigationMemory?.conversations ?? []);
  const convsRef = useRef(convs); convsRef.current = convs;
  const inboxHistory = useRef<SessionHistory<Conv> | null>(navigationMemory?.inboxHistory ?? null);
  const inboxHistoryStop = useRef<(() => void) | null>(null);
  const [inboxWindow, setInboxWindow] = useState<HistorySnapshot<Conv> | null>(navigationMemory?.inboxHistory?.getSnapshot() ?? null);
  const inboxList = useRef<HTMLDivElement | null>(null), inboxScroller = useRef<HTMLDivElement | null>(null);
  const inboxTop = useRef(navigationMemory?.inboxTop ?? 0);
  const inboxHeadPending = useRef(false), inboxHeadReload = useRef<(() => void) | null>(null);
  const inboxRenderRevision = useRef(0);
  const setConvs = useCallback((update: Conv[] | ((rows: Conv[]) => Conv[])) => {
    const rows = typeof update === 'function' ? update(convsRef.current) : update;
    const reading = inboxHistory.current;
    if (reading?.available()) {
      const snapshot = reading.getSnapshot(), previous = new Set(snapshot.rows.map(row => row.id));
      const reordered = rows.some((row, index) => row.id !== snapshot.rows[index]?.id);
      if (reordered && snapshot.before === 0 && snapshot.after === 0 && rows.length <= 120) {
        const version = ++inboxRenderRevision.current, owner = uidRef.current, account = accountGeneration.current;
        void commitInboxWindow(rows, 'reset', () => componentLive.current && inboxRenderRevision.current === version
          && uidRef.current === owner && accountGeneration.current === account).catch(() => setConversationError('Conversations could not be saved on this device. Please retry.'));
        return;
      }
      if (rows.some(row => !previous.has(row.id))) inboxHeadPending.current = true;
      reading.replaceHot(rows);
      if (inboxHeadPending.current && inboxTop.current < 80) inboxHeadReload.current?.();
      return;
    }
    convsRef.current = rows; setConversationState(rows);
  }, []);
  const [inboxPaging, setInboxPagingState] = useState<InboxPaging | null>(navigationMemory?.inboxPaging ?? null);
  const inboxPagingRef = useRef(inboxPaging);
  const setInboxPaging = useCallback((paging: InboxPaging | null) => { inboxPagingRef.current = paging; setInboxPagingState(paging); }, []);
  const inboxMerge = useRef(createInboxMergeGuard<Conv>());
  const inboxReads = useRef(new Set<AbortController>());
  const inboxMorePending = useRef(false);
  const inboxMoreAbort = useRef<AbortController | null>(null);
  const [loadingMoreConvs, setLoadingMoreConvs] = useState(false);
  const inboxSentinel = useRef<HTMLDivElement | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(navigationMemory === null);
  const [active, setActive] = useState<Conv | null>(navigationMemory?.active ?? null);
  const [msgs, setMessageState] = useState<Msg[]>(navigationMemory?.messages ?? []);
  const threadHistory = useRef<ThreadWindow<Msg> | null>(navigationMemory?.threadHistory ?? null);
  const threadScope = useRef(navigationMemory?.active ? `0:${navigationMemory.owner}:${navigationMemory.active.id}` : '');
  const threadStop = useRef<(() => void) | null>(null);
  const threadContent = useRef<HTMLDivElement | null>(null);
  const [threadWindow, setThreadWindow] = useState<ThreadSnapshot<Msg> | null>(navigationMemory?.threadHistory?.getSnapshot() ?? null);
  const setMsgs = useCallback((update: Msg[] | ((rows: Msg[]) => Msg[])) => {
    const rows = typeof update === 'function' ? update(msgsRef.current) : update;
    const reading = bindThreadHistory();
    if (!reading) { msgsRef.current = rows; setMessageState(rows); return true; }
    if (typeof update !== 'function' && !rows.length) { reading.clear(); return true; }
    try { reading.replace(rows, pinnedRef.current); return true; }
    catch { return false; } // The reader publishes a retryable error without losing the current window.
  }, []);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyErrorOperation = useRef<'refresh' | 'older' | 'restore'>('refresh');
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [privateMedia, setPrivateMedia] = useState<{ id: string; userId: string; conversationId: string; account: number } | null>(null);
  const [viewedPrivateIds, setViewedPrivateIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(navigationMemory?.hasOlder ?? false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [gifMode, setGifMode] = useState<'gifs' | 'stickers' | null>(null);
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
  const [accountVersion, setAccountVersion] = useState(0);
  const recorderPending = useRef(false);
  const recordingGeneration = useRef(0);
  const inboxGeneration = useRef(0);
  const componentLive = useRef(true);
  const historyCursor = useRef<MessageCursor | null>(navigationMemory?.cursor ?? null);
  const historyAbort = useRef<AbortController | null>(null);
  const inboxAbort = useRef<AbortController | null>(null);
  const restoreThread = useRef(!!navigationMemory?.active);
  const historyGeneration = useRef(0);
  const olderPending = useRef(false);
  const msgsRef = useRef<Msg[]>(msgs);
  useLayoutEffect(() => { msgsRef.current = msgs; }, [msgs]);
  const historyReady = useRef(false);
  const readPending = useRef(new Set<string>());
  const readRequested = useRef(new Set<string>());
  const lastRead = useRef('');
  const markReadRef = useRef<() => Promise<void>>(async () => {});
  const uidRef = useRef(uid);
  useLayoutEffect(() => { uidRef.current = uid; }, [uid]);
  const drafts = useRef(new Map<string, string>(navigationMemory?.drafts));
  const dismissedTarget = useRef<string | null>(null);
  const [attachmentDraft, setAttachmentDraft] = useState<File | null>(null);
  const [draft, setDraft] = useState(navigationMemory?.draft ?? '');
  const [query, setQuery] = useState(navigationMemory?.query ?? '');
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(navigationMemory?.detailsOpen ?? true);
  // Chats holds people and plain groups; a community's chat lives under Groups, labelled, the same as on the phone.
  const [tab, setTab] = useState<"chats" | "groups" | "unread">(navigationMemory?.tab ?? 'chats');
  const inboxOptionsRef = useRef(webInboxOptions(context, query, tab));
  inboxOptionsRef.current = webInboxOptions(context, query, tab);
  const inboxQuery = inboxQueryKey(inboxOptionsRef.current);
  const previousInboxQuery = useRef(inboxQuery);
  const bindInboxHistory = useCallback((value: SessionHistory<Conv> | null) => {
    inboxHistoryStop.current?.(); inboxHistoryStop.current = null;
    if (value && !value.available()) value = null;
    inboxHistory.current = value;
    if (!value) { setInboxWindow(null); return; }
    const owner = uidRef.current, account = accountGeneration.current, scope = navigationStore.getSnapshot().scope;
    const options = inboxOptionsRef.current, key = inboxQueryKey(options);
    const current = () => componentLive.current && accountGeneration.current === account && uidRef.current === owner
      && navigationStore.getSnapshot().scope === scope && inboxQueryKey(inboxOptionsRef.current) === key;
    value.rebind({ current, fetch: async (ids, signal) => {
      const revision = inboxMerge.current.begin(), { data, error } = await supabase.auth.getSession();
      if (error || data.session?.user.id !== owner || !current()) throw new Error('The account changed.');
      const rows = await lookupConversations({ viewer: owner!, token: data.session.access_token, signal, current }, options, ids);
      if (!current() || signal.aborted) throw new Error('The conversation filter changed.');
      return [...rows.values()].filter(row => matchesWebInbox(row, options) && inboxMerge.current.canApply(row.id, revision));
    } });
    const sync = () => {
      if (!current()) return;
      const snapshot = value.getSnapshot(); convsRef.current = snapshot.rows; setConversationState(snapshot.rows); setInboxWindow(snapshot);
      if (snapshot.error) setConversationError(snapshot.error);
    };
    inboxHistoryStop.current = value.subscribe(sync); sync();
  }, [navigationStore, supabase]);
  const commitInboxWindow = useCallback(async (rows: Conv[], operation: 'reset' | 'append' | 'refresh', current: () => boolean) => {
    let value = inboxHistory.current;
    if (!value?.available() || operation === 'reset') {
      const previous = value, replacement = createWebSessionHistory<Conv>({ id: row => row.id, current, fetch: async () => [] });
      try { for (let from = 0; from < rows.length; from += 100) await replacement.append(rows.slice(from, from + 100));
        if (!current()) { await replacement.dispose(); return; } }
      catch (error) { await replacement.dispose(); throw error; }
      inboxHeadPending.current = false; bindInboxHistory(replacement); void previous?.dispose().catch(() => {});
    } else if (operation === 'append') {
      value.update(rows); const existing = new Set(value.getSnapshot().rows.map(row => row.id));
      await value.append(rows.filter(row => !existing.has(row.id)));
    } else value.replaceHot(rows);
  }, [bindInboxHistory]);
  const measureInboxPage = useCallback((index: number, height: number) => { inboxHistory.current?.measure(index, height); }, []);
  useLayoutEffect(() => {
    const node = inboxList.current; if (!node || !inboxWindow) return;
    const scroll = inboxScroller.current;
    if (scroll) scroll.scrollTop = inboxTop.current;
    else if (inboxTop.current > 0) window.scrollTo({ top: window.scrollY + node.getBoundingClientRect().top + inboxTop.current, behavior: 'instant' });
    const onScroll = () => {
      const top = scroll ? scroll.getBoundingClientRect().top : 0;
      const offset = Math.max(0, top - node.getBoundingClientRect().top), viewport = scroll?.clientHeight ?? window.innerHeight;
      inboxTop.current = offset;
      void inboxHistory.current?.near(offset, viewport).catch(() => {});
      if (offset < 80 && inboxHeadPending.current) { inboxHeadPending.current = false; inboxHeadReload.current?.(); }
    };
    const target = scroll ?? window; target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [!!inboxWindow, compact, active?.id, context]);
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
  const pinnedRef = useRef(navigationMemory?.pinned ?? true);
  const threadPosition = useRef({ conversationId: navigationMemory?.active?.id ?? null, top: navigationMemory?.top ?? 0 });
  // iOS keyboard: Safari scrolls the layout instead of shrinking a fixed surface, so the surface tracks the visual viewport itself and the page stays locked.
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // ?debug=1 draws a live readout of everything that can move the chat, for measuring on a real phone.
  const debugRef = useRef<HTMLPreElement | null>(null);
  const debugCounts = useRef({ resize: 0, ro: 0, mo: 0, scroll: 0, msgs: 0 });
  const debugOn = useSyncExternalStore(subscribeLocation, debugSnapshot, noDebugSnapshot);
  useEffect(() => {
    if (!debugOn) return;
    const vv = window.visualViewport; const t = setInterval(() => { const el = listRef.current; const d = debugCounts.current; if (debugRef.current) debugRef.current.textContent = ['vv h ' + (vv ? Math.round(vv.height) : '-') + ' top ' + (vv ? Math.round(vv.offsetTop) : '-') + ' inner ' + window.innerHeight, 'pageY ' + Math.round(window.scrollY) + ' body ' + document.body.style.position + ' ' + document.body.style.top, 'list top ' + (el ? Math.round(el.scrollTop) : '-') + ' / ' + (el ? el.scrollHeight : '-') + ' client ' + (el ? el.clientHeight : '-') + ' pinned ' + pinnedRef.current, 'events resize ' + d.resize + ' ro ' + d.ro + ' mo ' + d.mo + ' scroll ' + d.scroll + ' msgs ' + d.msgs].join('\n'); }, 250);
    return () => clearInterval(t);
  }, [debugOn]);
  const activeId=active?.id??null;
  useEffect(() => {
    if (!compact || !activeId) return;
    const vv = window.visualViewport; const el = surfaceRef.current; if (!vv || !el) return;
    // iOS ignores overflow hidden; the only lock it honours is pinning the body in place, restored exactly on close.
    const body = document.body; const y = window.scrollY; const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow, overscroll: body.style.overscrollBehavior };
    body.style.position = 'fixed'; body.style.top = (-y) + 'px'; body.style.width = '100%'; body.style.overflow = 'hidden'; body.style.overscrollBehavior = 'none';
    let raf = 0;
    const apply = () => { debugCounts.current.resize++; el.style.height = vv.height + 'px'; el.style.top = vv.offsetTop + 'px'; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (pinnedRef.current) scrollToEnd(); }); };
    apply(); vv.addEventListener('resize', apply);
    return () => { vv.removeEventListener('resize', apply); cancelAnimationFrame(raf); body.style.position = prev.position; body.style.top = prev.top; body.style.width = prev.width; body.style.overflow = prev.overflow; body.style.overscrollBehavior = prev.overscroll; window.scrollTo(0, y); el.style.height = ''; el.style.top = ''; };
  }, [compact, activeId]);
  useEffect(() => {
    const el = listRef.current; if (!el || !activeId) return;
    const account = accountGeneration.current;
    let live = true;
    const current = () => live && listRef.current === el && activeRef.current?.id === activeId && accountGeneration.current === account;
    const onScroll = () => { if (!current()) return; debugCounts.current.scroll++; threadPosition.current = { conversationId: activeId, top: el.scrollTop }; pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; restoreVisibleThread(); if (pinnedRef.current) void markReadRef.current(); };
    el.addEventListener('scroll', onScroll, { passive: true });
    let settle: ReturnType<typeof setTimeout> | null = null;
    let frame: number | null = null;
    const settleThenScroll = () => {
      if (!current()) return;
      if (settle !== null) clearTimeout(settle);
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      settle = setTimeout(() => {
        settle = null;
        if (!current() || !pinnedRef.current) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          // A scroll or conversation change can happen after the settle timer.
          if (current() && pinnedRef.current) el.scrollTop = el.scrollHeight;
        });
      }, 80);
    };
    const ro = new ResizeObserver(() => { debugCounts.current.ro++; settleThenScroll(); });
    ro.observe(el); Array.from(el.children).forEach((ch) => ro.observe(ch));
    const mo = new MutationObserver(() => { if (!current()) return; debugCounts.current.mo++; Array.from(el.children).forEach((ch) => ro.observe(ch)); settleThenScroll(); });
    mo.observe(el, { childList: true });
    return () => { live = false; el.removeEventListener('scroll', onScroll); ro.disconnect(); mo.disconnect(); if (settle !== null) clearTimeout(settle); if (frame !== null) cancelAnimationFrame(frame); };
  }, [activeId, accountVersion]);
  const activeRef = useRef<Conv | null>(active);
  const typingSentAt = useRef(0);
  const typingIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useLayoutEffect(() => { activeRef.current = active; }, [active]);
  const remembered = useRef<MessageNavigationMemory | null>(navigationMemory);
  const [contentContext, setContentContext] = useState(context);
  useLayoutEffect(() => {
    if (contentContext === context) return;
    const session = navigationStore.getSnapshot();
    const saved = navigationStore.cache.read<MessageNavigationMemory>(session.scope, `messages:${context}`);
    const memory = saved?.owner === session.owner && saved.context === context ? saved : null;
    bindInboxHistory(null);
    historyAbort.current?.abort(); inboxAbort.current?.abort();
    inboxReads.current.forEach(request => request.abort()); inboxReads.current.clear(); inboxMerge.current.clear();
    inboxMorePending.current = false; setLoadingMoreConvs(false); setInboxPaging(memory?.inboxPaging ?? null);
    accountGeneration.current += 1; setAccountVersion(accountGeneration.current);
    historyGeneration.current += 1; inboxGeneration.current += 1;
    uploadGeneration.current += 1; uploadPending.current = false;
    historyReady.current = false; lastRead.current = '';
    drafts.current = new Map(memory?.drafts);
    remembered.current = memory; restoreThread.current = !!memory?.active;
    activeRef.current = memory?.active ?? null;
    historyCursor.current = memory?.cursor ?? null;
    pinnedRef.current = memory?.pinned ?? true;
    setUid(session.owner); setConvs(memory?.conversations ?? []); setLoadingConvs(!memory);
    inboxHistory.current = memory?.inboxHistory ?? null; inboxTop.current = memory?.inboxTop ?? 0;
    threadStop.current?.(); threadStop.current = null; threadHistory.current?.sanitize(navigationMessages); threadHistory.current?.detach();
    threadHistory.current = memory?.threadHistory ?? null; threadScope.current = '';
    setActive(memory?.active ?? null); setMsgs(memory?.messages ?? []); setDraft(memory?.draft ?? '');
    setQuery(memory?.query ?? ''); setTab(memory?.tab ?? 'chats'); setDetailsOpen(memory?.detailsOpen ?? true);
    setHasOlder(memory?.hasOlder ?? false); setLoadingMsgs(false); setLoadingOlder(false);
    setPrivateMedia(null); setViewedPrivateIds(new Set()); setShareDetails(null); setNewMessageOpen(false);
    setAttachmentDraft(null); setSendingFile(false); setReplyTo(null); setEditing(null); setForwarding(null); setPinnedMessage(null);
    setOffers({}); setRefListing(null); setOtherTyping(false); setGifMode(null);
    setActionError(null); setHistoryError(null); setConversationError(null); setNotice(null);
    setContentContext(context);
  }, [context, contentContext, navigationStore]);
  useLayoutEffect(() => {
    if (!uid || loadingConvs || contentContext !== context) return;
    remembered.current = { owner: uid, context, conversations: convs, active, messages: navigationMessages(msgs),
      drafts: [...drafts.current], draft, query, tab, detailsOpen, cursor: historyCursor.current, hasOlder,
      inboxPaging, inboxHistory: inboxHistory.current, inboxTop: inboxTop.current, threadHistory: threadHistory.current,
      top: listRef.current?.scrollTop ?? 0, pinned: pinnedRef.current };
  });
  useLayoutEffect(() => {
    const session = navigationStore.getSnapshot();
    const initialScope = session.owner === uid ? session.scope : null;
    const position = threadPosition;
    if (navigationMemory?.active && listRef.current) listRef.current.scrollTop = navigationMemory.top;
    return () => {
      const saved = remembered.current, current = navigationStore.getSnapshot();
      const scope = initialScope ?? (!current.changed && current.owner === saved?.owner ? current.scope : null);
      if (saved && saved.context === context) navigationStore.cache.save(scope, `messages:${context}`, {
        ...saved, top: position.current.conversationId === saved.active?.id ? position.current.top : saved.top, pinned: pinnedRef.current,
      });
    };
  }, [context, navigationStore, uid, navigationMemory]);


  useEffect(() => {
    if (!compact || !activeId || typeof document.querySelectorAll !== 'function') return;
    const chrome = Array.from(document.querySelectorAll<HTMLElement>('[data-app-chrome]'));
    const previous = chrome.map(element => ({ element, inert: element.inert }));
    previous.forEach(({ element }) => { element.inert = true; });
    return () => { previous.forEach(({ element, inert }) => { element.inert = inert; }); };
  }, [compact, activeId]);

  const markVisibleRead = useCallback(async () => {
    const c = activeRef.current, userId = uidRef.current, account = accountGeneration.current;
    if (!c || !userId) return;
    const key = `${account}:${userId}:${c.id}`;
    const current = () => componentLive.current && account === accountGeneration.current && uidRef.current === userId && activeRef.current?.id === c.id;
    const visible = () => current() && canMarkConversationRead({
      foreground: document.visibilityState !== 'hidden',
      focused: typeof document.hasFocus !== 'function' || document.hasFocus(),
      atLatest: pinnedRef.current && (threadHistory.current?.atLatest() ?? true), loaded: historyReady.current,
    });
    if (!visible()) return;
    readRequested.current.add(key);
    if (readPending.current.has(key)) return;
    readPending.current.add(key);
    try {
      while (readRequested.current.delete(key) && visible()) {
        const newest = [...msgsRef.current].reverse().find(row => !row._delivery)?.id || '';
        const receipt = `${key}:${newest}`;
        if (lastRead.current === receipt) break;
        await acknowledgeConversationRead(supabase, { conversationId: c.id, userId, isGroup: c.is_group });
        if (current()) { lastRead.current = receipt; inboxMerge.current.touch([c.id]); setConvs(list => list.map(item => item.id === c.id ? { ...item, unread: 0 } : item)); }
      }
    } catch { /* A failed receipt remains unread until the next visible retry. */ }
    finally { readPending.current.delete(key); }
  }, [supabase]);
  useLayoutEffect(() => { markReadRef.current = markVisibleRead; }, [markVisibleRead]);

  useEffect(() => {
    const retryRead = () => { void markVisibleRead(); };
    document.addEventListener('visibilitychange', retryRead);
    window.addEventListener('focus', retryRead); window.addEventListener('online', retryRead);
    return () => { document.removeEventListener('visibilitychange', retryRead); window.removeEventListener('focus', retryRead); window.removeEventListener('online', retryRead); };
  }, [markVisibleRead]);

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

  function bindThreadHistory(force = false) {
    const conversationId = activeRef.current?.id, owner = uidRef.current, account = accountGeneration.current;
    if (!conversationId || !owner) {
      threadStop.current?.(); threadStop.current = null; threadHistory.current?.dispose();
      threadHistory.current = null; threadScope.current = ''; setThreadWindow(null); return null;
    }
    const scope = `${account}:${owner}:${conversationId}`;
    if (threadHistory.current && threadScope.current === scope && threadStop.current && !force) return threadHistory.current;
    threadStop.current?.(); threadStop.current = null;
    if (threadScope.current && threadScope.current !== scope) { threadHistory.current?.dispose(); threadHistory.current = null; }
    threadScope.current = scope;
    const current = () => componentLive.current && accountGeneration.current === account && uidRef.current === owner && activeRef.current?.id === conversationId;
    const fetch = async (ids: string[], signal: AbortSignal) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !current() || sessionData.session?.user.id !== owner || signal.aborted) throw new Error('The conversation account changed.');
      const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).in('id', ids)
        .setHeader('Authorization', `Bearer ${sessionData.session.access_token}`).abortSignal(signal);
      if (error) throw error;
      const rows = await signChatMedia((data ?? []) as Msg[]);
      if (!current() || signal.aborted) throw new Error('The conversation account changed.');
      const { data: reactions, error: reactionError } = await supabase.from('message_reactions').select('message_id,user_id,emoji')
        .in('message_id', rows.map(row => row.id)).abortSignal(signal);
      if (reactionError) throw reactionError;
      if (!current() || signal.aborted) throw new Error('The conversation account changed.');
      void hydrateOffers(rows);
      return rows.map(row => ({ ...row, _reactions: (reactions ?? []).filter(reaction => reaction.message_id === row.id) }));
    };
    if (threadHistory.current) threadHistory.current.rebind({ current, fetch });
    else threadHistory.current = createThreadWindow<Msg>({ ascending: true, current, fetch });
    const reading = threadHistory.current;
    const publish = () => {
      if (!current() || threadHistory.current !== reading) return;
      const snapshot = reading.getSnapshot(); msgsRef.current = snapshot.rows; setMessageState(snapshot.rows); setThreadWindow(snapshot);
      if (snapshot.error) { historyErrorOperation.current = snapshot.errorKind === 'restore' ? 'restore' : 'older'; setHistoryError(snapshot.error); }
      else if (historyErrorOperation.current === 'restore') setHistoryError(null);
    };
    threadStop.current = reading.subscribe(publish); publish(); return reading;
  }
  function restoreVisibleThread() {
    const el = listRef.current, content = threadContent.current;
    if (!el || !content || !threadHistory.current) return;
    const offset = el.getBoundingClientRect().top - content.getBoundingClientRect().top;
    void threadHistory.current.near(offset, el.clientHeight).catch(() => {});
  }
  const measureThreadMessage = useCallback((id: string, height: number) => { threadHistory.current?.measure(id, height); }, []);
  useEffect(() => { restoreVisibleThread(); }, [threadWindow?.revision]);
  useEffect(() => () => {
    threadStop.current?.(); threadStop.current = null;
    threadHistory.current?.sanitize(navigationMessages); threadHistory.current?.detach();
  }, []);
  useEffect(() => {
    const ids = new Set(msgs.map(row => row.id));
    if (privateMedia) ids.add(privateMedia.id);
    const offerIds = new Set<string>();
    for (const row of msgs) if (row.media_type === 'offer' && row.media_url) {
      try { const value = JSON.parse(row.media_url); if (value?.offer_id) offerIds.add(value.offer_id); } catch { /* other media */ }
    }
    setOffers(previous => retainRecord(previous, offerIds));
    setViewedPrivateIds(previous => [...previous].every(id => ids.has(id)) ? previous : new Set([...previous].filter(id => ids.has(id))));
  }, [msgs, offers, privateMedia]);

  const openConv = useCallback(async (c: Conv, updateUrl = true, preserveLoaded = false) => {
    dismissedTarget.current = null;
    if (updateUrl && window.history) {
      const search = new URLSearchParams(window.location.search);
      if (search.get('c') !== c.id) {
        search.set('c', c.id);
        window.history.pushState({ ...window.history.state, pcConversation: true }, '', `${window.location.pathname}?${search}`);
      }
    }
    const keep = preserveLoaded && activeRef.current?.id === c.id;
    const retained = keep ? msgsRef.current : [];
    const oldCursor = historyCursor.current;
    const generation = historyGeneration.current += 1, account = accountGeneration.current;
    historyAbort.current?.abort();
    const request = new AbortController(); historyAbort.current = request;
    const current = () => componentLive.current && accountGeneration.current === account && historyGeneration.current === generation && activeRef.current?.id === c.id;
    activeRef.current = c;
    bindThreadHistory(true);
    setActive(c); setPrivateMedia(null); setShareDetails(null); setViewedPrivateIds(new Set());
    historyReady.current = false; lastRead.current = ''; setGifMode(null);
    setLoadingMsgs(retained.length === 0); setHistoryError(null); setActionError(null); setNotice(null);
    if (!keep) {
      setMsgs(uidRef.current ? readOutbox(uidRef.current, c.id).map(row => ({ ...row, media_url: isChatMediaUrl(row.media_url) ? null : row.media_url })) : []);
      setDraft(drafts.current.get(c.id) || '');
      historyCursor.current = null; setHasOlder(false);
    }
    setAttachmentDraft(null); setReplyTo(null); setEditing(null); setForwarding(null); setPinnedMessage(null);
    olderPending.current = false; setLoadingOlder(false);
    setRefListing(null); setOtherTyping(false);
    let contentReady = false;
    try {
      const { raw, rows } = await withTimeout((async () => {
        const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', c.id)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MESSAGE_PAGE_SIZE).abortSignal(request.signal);
        if (error) throw error;
        const raw = (data || []) as Msg[];
        const authorized = retained.length ? await revalidateMessageWindow(supabase, c.id, retained, raw, request.signal) : raw;
        if (!current() || request.signal.aborted) return { raw, rows: [] };
        if (!retained.length) {
          const safe = withoutChatMedia(authorized).map(row => ({ ...row, _delivery: undefined,
            _mediaPending: !row.view_limit && !!(row._private_media_url || row._private_thumbnail_url),
          }));
          contentReady = true;
          setMsgs(prev => current() ? mergeMessagePage(prev, safe, true) : prev);
          setLoadingMsgs(false);
          if (!keep) pinnedRef.current = true;
          requestAnimationFrame(() => { if (current() && pinnedRef.current) scrollToEnd(); });
        }
        return { raw, rows: await signChatMedia(authorized) };
      })(), 12000);
      if (!current() || request.signal.aborted) return;
      for (const row of raw) if (row.sender_id === uidRef.current) forgetOutboxMessage(row.sender_id, row.id);
      const priorIds = new Set(retained.map(row => row.id)), allowed = new Set(rows.map(row => row.id));
      if (setMsgs(prev => current() ? mergeMessagePage(prev.filter(row => !priorIds.has(row.id) || row._delivery || allowed.has(row.id)), rows.map(row => ({ ...row, _delivery: undefined, _mediaPending: false })), true) : prev) === false) return;
      historyCursor.current = keep && oldCursor ? oldCursor : raw[raw.length - 1] || null;
      if (!keep || !oldCursor) setHasOlder(raw.length === MESSAGE_PAGE_SIZE);
      historyReady.current = true;
      void hydrateOffers(rows); void loadReactions(rows, c.id); void loadPin(c.id);
      if (c.context === 'market' && c.context_ref_id) {
        const listingRequest = supabase.from('marketplace_listings').select('id, title, price, currency, images, status').eq('id', c.context_ref_id).abortSignal(request.signal).maybeSingle();
        const { data: listing } = await withTimeout(Promise.resolve(listingRequest), 12000);
        if (current() && listing) setRefListing(listing as MiniListing);
      }
      if (current()) {
        if (!keep) pinnedRef.current = true;
        requestAnimationFrame(() => { if (current()) { if (!keep || pinnedRef.current) scrollToEnd(); void markVisibleRead(); } });
      }
    } catch {
      if (current()) {
        historyErrorOperation.current = 'refresh';
        setHistoryError(contentReady ? 'Some attachments could not load. You can keep reading or try again.' : 'Messages could not be loaded. Please try again.');
        setMsgs(prev => current() ? prev.map(row => ({ ...row, _mediaPending: false })) : prev);
      }
    } finally {
      request.abort();
      if (historyAbort.current === request) historyAbort.current = null;
      if (current()) setLoadingMsgs(false);
    }
  }, [supabase, hydrateOffers, loadReactions, loadPin, markVisibleRead]);

  const loadOlder = useCallback(async () => {
    const c = activeRef.current;
    const cursor = historyCursor.current;
    if (!c || !cursor || !hasOlder || olderPending.current) return;
    const generation = historyGeneration.current;
    const current = () => componentLive.current && historyGeneration.current === generation && activeRef.current?.id === c.id;
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
      if (setMsgs(prev => mergeMessagePage(rows, prev, true)) === false) return;
      if (raw.length) historyCursor.current = raw[raw.length - 1];
      setHasOlder(raw.length === MESSAGE_PAGE_SIZE);
      void hydrateOffers(rows); void loadReactions(rows, c.id);
      requestAnimationFrame(() => { if (current() && el) el.scrollTop = oldTop + el.scrollHeight - oldHeight; });
    } catch { if (current()) { historyErrorOperation.current = 'older'; setHistoryError('Older messages could not be loaded. Please try again.'); } }
    finally { if (current()) { olderPending.current = false; setLoadingOlder(false); } }
  }, [supabase, hasOlder, hydrateOffers, loadReactions]);

  const loadInbox = useCallback(async (quiet = false, externalSignal?: AbortSignal) => {
    const generation = inboxGeneration.current += 1;
    inboxAbort.current?.abort();
    inboxMoreAbort.current?.abort(); inboxMoreAbort.current = null; inboxMorePending.current = false; setLoadingMoreConvs(false);
    const request = new AbortController(); inboxAbort.current = request;
    const account = accountGeneration.current;
    const current = () => !request.signal.aborted && componentLive.current && inboxGeneration.current === generation && accountGeneration.current === account;
    const cancel = () => request.abort(); externalSignal?.addEventListener('abort', cancel, { once: true });
    if (externalSignal?.aborted) cancel();
    const options = inboxOptionsRef.current, key = inboxQueryKey(options), revision = inboxMerge.current.begin();
    const reading = inboxHistory.current, previousPaging = inboxPagingRef.current;
    const preserve = !!reading?.available() && quiet && inboxTop.current >= 80 && previousPaging?.query === key;
    const target = new URLSearchParams(window.location.search).get('c');
    const activeAtStart = activeRef.current?.id;
    const extraIds = [...(preserve ? convsRef.current.map(row => row.id) : []), target, activeAtStart].filter((id): id is string => !!id);

    try {
      const authWork = supabase.auth.getSession();
      const { data, error } = externalSignal ? await authWork : await withTimeout(authWork, 12000);
      if (error) throw error;
      if (!current()) return false;
      if (!quiet && !remembered.current) setLoadingConvs(true);
      setConversationError(null);
      const id = data.session?.user.id ?? null;
      uidRef.current = id; setUid(id);
      if (!id) { setConvs([]); setInboxPaging(null); return true; }
      const work = loadConversationWindow({ viewer: id, token: data.session?.access_token,
        signal: request.signal, current }, options, preserve ? null : { items: convsRef.current, paging: inboxPagingRef.current }, extraIds);
      // The event queue retains its physical slot through ignored aborts;
      // only direct UI loads use their own recoverable timeout race.
      let result = externalSignal ? await work : await withTimeout(work, 12000);
      if (!current() || uidRef.current !== id) return false;
      if (result.paging && !preserve && result.items.length > 120) result = await loadConversationWindow({ viewer: id, token: data.session?.access_token,
        signal: request.signal, current }, options, null, [target, activeAtStart].filter((id): id is string => !!id));
      if (!current()) return false;
      if (result.paging && key !== inboxQueryKey(inboxOptionsRef.current)) {
        previousInboxQuery.current = ''; setInboxPaging(result.paging); return false;
      }
      const canUpdateActive = !!activeAtStart && inboxMerge.current.canApply(activeAtStart, revision);
      const canSelectTarget = !!target && inboxMerge.current.canApply(target, revision);
      const merged = inboxMerge.current.commit(result.items, convsRef.current, revision, result.checkedIds)
        .filter(row => !result.paging || matchesWebInbox(row, options)).sort(compareWebInbox);
      if (result.paging) {
        if (preserve && merged.some(row => !convsRef.current.some(previous => previous.id === row.id))) inboxHeadPending.current = true;
        await commitInboxWindow(merged, preserve ? 'refresh' : 'reset', current);
        if (!current()) return false;
        setInboxPaging(preserve && previousPaging ? { ...previousPaging, summary: result.paging.summary } : result.paging);
      } else { bindInboxHistory(null); setConvs(merged); setInboxPaging(null); }
      const currentTarget = new URLSearchParams(window.location.search).get('c');
      const selected = canSelectTarget && target && currentTarget === target && target !== dismissedTarget.current ? result.resolved.get(target) : null;
      if (canUpdateActive && activeAtStart && activeRef.current?.id === activeAtStart) {
        const confirmed = result.resolved.get(activeAtStart);
        if (confirmed && restoreThread.current) { restoreThread.current = false; void openConv(confirmed, false, true); }
        else if (confirmed) { activeRef.current = confirmed; setActive(confirmed); }
        else { restoreThread.current = false; activeRef.current = null; setActive(null); setMsgs([]); setDraft(''); historyReady.current = false; }
      } else if (selected && !activeRef.current) void openConv(selected, false);
      return true;
    } catch { if (current()) setConversationError(inboxHistory.current?.getSnapshot().error ?? 'Conversations could not be loaded. Please try again.'); return false; }
    finally {
      if (current()) setLoadingConvs(false);
      request.abort(); externalSignal?.removeEventListener('abort', cancel);
      if (inboxAbort.current === request) inboxAbort.current = null;
    }
  }, [supabase, context, openConv, setConvs, setInboxPaging, commitInboxWindow, bindInboxHistory]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    inboxHeadReload.current = () => { if (timer) return; timer = setTimeout(() => { timer = undefined; if (componentLive.current) void loadInbox(true); }, 150); };
    return () => { if (timer) clearTimeout(timer); inboxHeadReload.current = null; };
  }, [loadInbox]);
  useEffect(() => {
    if (inboxHistory.current && inboxPagingRef.current?.query === inboxQuery) bindInboxHistory(inboxHistory.current);
    return () => { inboxHistoryStop.current?.(); inboxHistoryStop.current = null; };
  }, [bindInboxHistory, inboxQuery, uid, context]);

  useEffect(() => {
    if (previousInboxQuery.current === inboxQuery) return;
    previousInboxQuery.current = inboxQuery;
    const previous = inboxHistory.current; bindInboxHistory(null); void previous?.dispose().catch(() => {}); inboxTop.current = 0;
    if (!inboxPagingRef.current && !loadingConvs) return;
    inboxGeneration.current++; inboxAbort.current?.abort(); setLoadingConvs(true);
    const timer = setTimeout(() => { void loadInbox(true); }, 250);
    return () => clearTimeout(timer);
  }, [inboxQuery, inboxPaging?.query, loadInbox, bindInboxHistory]);

  const loadMoreInbox = useCallback(async () => {
    const reading = inboxHistory.current;
    if (reading && !reading.atEnd()) { await reading.around((reading.getSnapshot().pages.at(-1)?.index ?? 0) + 1).catch(() => {}); return; }
    const paging = inboxPagingRef.current, owner = uidRef.current, options = inboxOptionsRef.current;
    if (!owner || loadingConvs || inboxMorePending.current || !paging?.cursor || paging.query !== inboxQueryKey(options)
      || document.visibilityState === 'hidden') return;
    inboxMorePending.current = true; setLoadingMoreConvs(true);
    const request = new AbortController(); inboxReads.current.add(request); inboxMoreAbort.current = request;
    const account = accountGeneration.current, generation = inboxGeneration.current, revision = inboxMerge.current.begin();
    const current = () => !request.signal.aborted && componentLive.current && uidRef.current === owner
      && accountGeneration.current === account && inboxGeneration.current === generation && inboxQueryKey(inboxOptionsRef.current) === paging.query;
    try {
      const { data, error } = await withTimeout(supabase.auth.getSession(), 12000);
      if (error || data.session?.user.id !== owner) throw error ?? new Error('The account changed.');
      const result = await withTimeout(loadMoreConversations({ viewer: owner, token: data.session.access_token, signal: request.signal, current },
        options, { items: convsRef.current, paging }), 12000);
      if (!current()) return;
      const merged = inboxMerge.current.commit(result.items, convsRef.current, revision, result.checkedIds).filter(row => matchesWebInbox(row, options)).sort(compareWebInbox);
      await commitInboxWindow(merged, 'append', current); if (!current()) return;
      setInboxPaging(result.paging); setConversationError(null);
    } catch { if (current()) setConversationError(inboxHistory.current?.getSnapshot().error ?? 'More conversations could not be loaded. Please try again.'); }
    finally { request.abort(); inboxReads.current.delete(request);
      if (inboxMoreAbort.current === request) { inboxMoreAbort.current = null; inboxMorePending.current = false; if (componentLive.current) setLoadingMoreConvs(false); } }
  }, [supabase, loadingConvs, setConvs, setInboxPaging, commitInboxWindow]);

  useEffect(() => {
    const element = inboxSentinel.current;
    if (!element || !inboxPaging?.cursor || loadingConvs || loadingMoreConvs || conversationError || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void loadMoreInbox(); }, { rootMargin: '600px 0px' });
    observer.observe(element); return () => observer.disconnect();
  }, [inboxPaging, loadingConvs, loadingMoreConvs, conversationError, compact, activeId, loadMoreInbox]);

  useEffect(() => {
    componentLive.current = true;
    let authReload: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    let mediaSession = navigationStore.getSnapshot();
    // Subscribe before starting the asynchronous bootstrap; an auth change must
    // invalidate it even when it occurs in the same event turn.
    queueMicrotask(() => { if (live) void loadInbox(!!navigationMemory); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id ?? null;
      const nextSession = navigationStore.getSnapshot();
      const changedSession = mediaSession.initialized && nextSession.scope !== mediaSession.scope;
      mediaSession = nextSession;
      if (_event === 'SIGNED_OUT' && uidRef.current) clearOutbox(uidRef.current);
      if (uidRef.current !== nextId || changedSession) {
        const previous = inboxHistory.current; bindInboxHistory(null); void previous?.dispose().catch(() => {}); inboxTop.current = 0;
        historyAbort.current?.abort(); inboxAbort.current?.abort(); remembered.current = null; restoreThread.current = false;
        inboxReads.current.forEach(request => request.abort()); inboxReads.current.clear(); inboxMerge.current.clear();
        setInboxPaging(null); inboxMorePending.current = false; setLoadingMoreConvs(false);
        setNewMessageOpen(false);
        accountGeneration.current += 1; setAccountVersion(accountGeneration.current);
        setPrivateMedia(null); setShareDetails(null); setViewedPrivateIds(new Set());
        uploadGeneration.current += 1;
        uploadPending.current = false;
        drafts.current.clear();
        uidRef.current = nextId; setUid(nextId); activeRef.current = null; historyGeneration.current += 1;
        setActive(null); setMsgs([]); setConvs([]); setDraft(''); setGifMode(null); historyReady.current = false; lastRead.current = '';
        setAttachmentDraft(null); setSendingFile(false); setReplyTo(null); setEditing(null); setForwarding(null); setPinnedMessage(null); setOffers({});
        setActionError(null); setNotice(null);
        inboxGeneration.current += 1;
        if (nextId) authReload = setTimeout(() => { if (componentLive.current) void loadInbox(); }, 0);
      }
    });
    return () => { live = false; componentLive.current = false; historyAbort.current?.abort(); inboxAbort.current?.abort(); inboxReads.current.forEach(request => request.abort()); inboxReads.current.clear(); clearTimeout(authReload); subscription.unsubscribe(); inboxGeneration.current += 1; historyGeneration.current += 1; };
  }, [supabase, loadInbox, navigationMemory, navigationStore]);

  useEffect(() => {
    if (!uid) return;
    let live = true;
    const account = accountGeneration.current;
    const current = () => live && componentLive.current && uidRef.current === uid && accountGeneration.current === account;
    const updates = createInboxRefreshQueue({ active: document.visibilityState !== 'hidden',
      read: async (ids, signal) => {
        if (!current()) return;
        if (!ids || !inboxPagingRef.current) { if (!await loadInbox(true, signal)) throw new Error('Conversation refresh failed.'); return; }
        const options = inboxOptionsRef.current, key = inboxQueryKey(options), revision = inboxMerge.current.begin();
        const { data, error } = await supabase.auth.getSession();
        if (error || data.session?.user.id !== uid) throw error ?? new Error('The account changed.');
        const rows = await lookupConversations({ viewer: uid, token: data.session.access_token, signal, current }, options, ids);
        if (!current() || signal.aborted || inboxQueryKey(inboxOptionsRef.current) !== key) return;
        const changed = new Set(ids), previous = convsRef.current;
        const activeMayUpdate = activeRef.current && inboxMerge.current.canApply(activeRef.current.id, revision);
        const next = [...previous.filter(row => !changed.has(row.id)), ...rows.values()].filter(row => matchesWebInbox(row, options));
        const merged = inboxMerge.current.commit(next, previous, revision, ids).filter(row => matchesWebInbox(row, options)).sort(compareWebInbox);
        setConvs(merged); setConversationError(null);
        if (activeMayUpdate && activeRef.current && changed.has(activeRef.current.id)) {
          const confirmed = rows.get(activeRef.current.id);
          if (confirmed) { activeRef.current = confirmed; setActive(confirmed); }
          else closeConversation(false);
        }
      },
      onError: () => { if (current()) setConversationError('Conversations could not be refreshed. Please try again.'); },
    });
    const refresh = () => updates.refresh();
    const changed = (payload: { new?: unknown; old?: unknown }, conversation = false) => {
      const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as { id?: string; conversation_id?: string } | undefined;
      const id = conversation ? row?.id : row?.conversation_id;
      if (inboxPagingRef.current && id) updates.changed(id); else updates.refresh();
    };
    const visibility = () => updates.setActive(document.visibilityState !== 'hidden');
    const channel = supabase.channel(`web_inbox_${uid}_${context}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, payload => changed(payload, true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, changed)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${uid}` }, refresh)
      .subscribe(status => { if (status === 'SUBSCRIBED') updates.refresh(); });
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => { live = false; updates.dispose(); void supabase.removeChannel(channel); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', visibility); };
  }, [supabase, uid, context, loadInbox, setConvs]);

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
        setTimeout(() => { if (current() && pinnedRef.current) { scrollToEnd(); void markVisibleRead(); } }, 40);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: "conversation_id=eq." + active.id }, async (p) => {
        let upd = p.new as Msg;
        if (!current() || activeRef.current?.id !== upd.conversation_id) return;
        if (isChatMediaUrl(upd.media_url)) upd = (await signChatMedia([upd]))[0];
        if (!current() || activeRef.current?.id !== upd.conversation_id) return;
        threadHistory.current?.invalidate(new Set([upd.id]));
        setMsgs((l) => l.map((m) => (m.id === upd.id ? { ...m, ...upd, _delivery: undefined } : m)));
        void loadPin(upd.conversation_id);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages", filter: "conversation_id=eq." + active.id }, (payload) => {
        if (current()) { const id = (payload.old as { id?: string }).id; if (id) threadHistory.current?.remove(new Set([id])); }
      })
      .subscribe();

    const typing = createTypingActivity({
      active: document.visibilityState !== 'hidden',
      accept: row => row.conversation_id === active.id && row.user_id !== uid,
      onChange: rows => { if (current()) setOtherTyping(rows.length > 0); },
      read: async signal => {
        const { data, error } = await supabase.from("conversation_typing").select("*").eq("conversation_id", active.id).abortSignal(signal);
        if (error) throw error;
        return current() ? (data ?? []) as TypingRow[] : [];
      },
    });
    const typeCh = supabase
      .channel("web_typing_" + active.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_typing", filter: "conversation_id=eq." + active.id }, payload => { if (current()) typing.change(payload); })
      .subscribe(status => typing.status(status));
    const typingVisibility = () => typing.setActive(document.visibilityState !== 'hidden');
    const typingRefresh = () => { if (document.visibilityState !== 'hidden') typing.refresh(); };
    document.addEventListener('visibilitychange', typingVisibility);
    window.addEventListener('online', typingRefresh);
    typing.refresh();
    const reactionChannel = supabase.channel('web_reactions_' + active.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => { const messageId = (payload.new as { message_id?: string }).message_id || (payload.old as { message_id?: string }).message_id; const rows = messageId ? msgsRef.current.filter(row => row.id === messageId) : msgsRef.current; for (let i = 0; i < rows.length; i += MESSAGE_PAGE_SIZE) void loadReactions(rows.slice(i, i + MESSAGE_PAGE_SIZE), active.id); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: 'id=eq.' + active.id }, () => { void loadPin(active.id); })
      .subscribe();

    return () => {
      live = false;
      supabase.removeChannel(ch);
      supabase.removeChannel(typeCh);
      typing.dispose();
      document.removeEventListener('visibilitychange', typingVisibility);
      window.removeEventListener('online', typingRefresh);
      supabase.removeChannel(reactionChannel);
    };
  }, [supabase, active, uid, hydrateOffers, loadReactions, loadPin, markVisibleRead]);

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
    openPrivate: message => { if (LIMITED_MEDIA_VIEWER_ENABLED && uid && uidRef.current === uid && message.view_limit && message.conversation_id === activeRef.current?.id && message.sender_id !== uid && !viewedPrivateIds.has(message.id)) setPrivateMedia({ id: message.id, userId: uid, conversationId: message.conversation_id, account: accountGeneration.current }); },
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
    const uploadId = uploadGeneration.current += 1;
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
      recordingGeneration.current += 1;
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
      uploadId = uploadGeneration.current += 1;
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

        <NextImage unoptimized width={48} height={48} src={refListing.images[0]} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
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

  function closeConversation(updateUrl = true) {
    dismissedTarget.current = activeRef.current?.id || null;
    activeRef.current = null;
    historyGeneration.current += 1;
    historyReady.current = false;
    setActive(null); setMsgs([]); setDraft(''); setLoadingMsgs(false); setHistoryError(null);
    setEditing(null); setReplyTo(null); setForwarding(null); setGifMode(null); setShareDetails(null); setPrivateMedia(null);
    setActionError(null); setNotice(null); setCountering(null);
    if (recRef.current || recorderPending.current) stopRecording(false);
    if (updateUrl && window.history) {
      const search = new URLSearchParams(window.location.search); search.delete('c');
      window.history.replaceState(window.history.state, '', window.location.pathname + (search.size ? '?' + search.toString() : ''));
    }
  }
  const resolveInboxConversation = useCallback(async (id: string) => {
    const owner = uidRef.current, account = accountGeneration.current;
    if (!owner) return null;
    const request = new AbortController(); inboxReads.current.add(request);
    const current = () => !request.signal.aborted && componentLive.current && uidRef.current === owner && accountGeneration.current === account;
    const revision = inboxMerge.current.begin(), options = inboxOptionsRef.current;
    try {
      const { data, error } = await withTimeout(supabase.auth.getSession(), 12000);
      if (error || data.session?.user.id !== owner) throw error ?? new Error('The account changed.');
      const scope = { viewer: owner, token: data.session.access_token, signal: request.signal, current };
      if (inboxPagingRef.current) {
        const rows = await withTimeout(lookupConversations(scope, options, [id]), 12000);
        if (!current()) return null;
        if (!inboxMerge.current.canApply(id, revision)) return convsRef.current.find(row => row.id === id)
          ?? (activeRef.current?.id === id ? activeRef.current : null);
        const row = rows.get(id) ?? null;
        const previous = convsRef.current;
        const next = [...previous.filter(item => item.id !== id), ...(row && matchesWebInbox(row, inboxOptionsRef.current) ? [row] : [])];
        const merged = inboxMerge.current.commit(next, previous, revision, [id]).sort(compareWebInbox);
        setConvs(merged);
        return row;
      }
      const rows = await withTimeout(loadConversations(owner, context, request.signal, data.session.access_token), 12000);
      if (!current()) return null;
      const mayResolve = inboxMerge.current.canApply(id, revision);
      setConvs(previous => inboxMerge.current.commit(rows, previous, revision).sort(compareWebInbox));
      return mayResolve ? rows.find(row => row.id === id) ?? null : convsRef.current.find(row => row.id === id) ?? null;
    } finally { request.abort(); inboxReads.current.delete(request); }
  }, [supabase, context, setConvs]);

  const handleHistory=useEffectEvent(() => {
      const id = new URLSearchParams(window.location.search).get('c');
      const target = id ? convs.find(conversation => conversation.id === id) : null;
      if (target && activeRef.current?.id !== id) void openConv(target, false);
      else if (!id && activeRef.current) closeConversation(false);
      else if (id && !target && activeRef.current?.id !== id) {
        const account = accountGeneration.current;
        void resolveInboxConversation(id).then(row => {
          if (!componentLive.current || accountGeneration.current !== account || new URLSearchParams(window.location.search).get('c') !== id) return;
          if (row) void openConv(row, false);
          else { closeConversation(false); setConversationError('The conversation is no longer available.'); }
        }).catch(() => { if (componentLive.current && accountGeneration.current === account) setConversationError('The conversation could not be loaded. Please try again.'); });
      }
  });
  const handleNavigationKey=useEffectEvent((event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !activeRef.current) return;
      event.preventDefault();
      if (privateMedia) setPrivateMedia(null);
      else if (shareDetails) setShareDetails(null);
      else if (gifMode) setGifMode(null);
      else if (forwarding) setForwarding(null);
      else if (editing) { setEditing(null); setDraft(drafts.current.get(activeRef.current.id) || ''); }
      else if (replyTo) setReplyTo(null);
      else if (countering) setCountering(null);
      else if (recording || recorderPending.current) stopRecording(false);
      else closeConversation();
  });
  useEffect(() => {
    const onPopState=()=>handleHistory();
    const onKey=(event: KeyboardEvent)=>handleNavigationKey(event);
    window.addEventListener('popstate', onPopState);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('popstate', onPopState); document.removeEventListener('keydown', onKey); };
  }, []);

  const typingLine = otherTyping ? <p className="text-[12px] text-accent">typing…</p> : null;

  const convButton = (c: Conv) => (
    <button key={c.id} type="button" aria-pressed={active?.id === c.id} aria-label={`Open conversation with ${c.title}`}
      onClick={() => openConv(c)}
      className={"flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[140ms] " + (active?.id === c.id ? "bg-surface-elevated" : "hover:bg-surface")}
    >
      {c.avatar ? <NextImage unoptimized width={44} height={44} src={c.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-sm font-semibold">{c.title.slice(0,1).toUpperCase()}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[14px] font-semibold text-ink">{c.title}</span>{!c.is_group && c.other_id ? <VerifiedBadge userId={c.other_id} size={13} /> : null}{c.is_group && c.group_type === "community" ? <span className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase text-secondary">Community</span> : null}
            {c.unread > 0 ? <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-pearl" aria-hidden /> : null}
          </span>
          {c.last_message_time ? <span className="shrink-0 text-[11px] text-muted"><RelativeTime dateTime={c.last_message_time} /></span> : null}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={"truncate text-[13px] " + (c.unread > 0 ? "font-medium text-secondary" : "text-muted")}>{c.last_message || "Say hello"}</span>
          {c.unread > 0 ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-pearl px-1.5 text-[11px] font-bold text-on-pearl">{c.unread}</span> : null}
        </span>
      </span>
    </button>
  );

  const composer = (
    <div>
      {gifMode && <GifPicker key={(uid || '') + ':' + (active?.id || '') + ':' + gifMode} mode={gifMode} busy={sending} onClose={() => setGifMode(null)} onPick={async gif => {
        if (sendPending.current || uidRef.current !== uid || activeRef.current?.id !== active?.id) return;
        sendPending.current = true; setSending(true);
        try { if (await insertMessage(null, gif.url, gifMode === 'stickers' ? 'sticker' : 'gif')) { setGifMode(null); setReplyTo(null); } }
        finally { sendPending.current = false; if (componentLive.current) setSending(false); }
      }} />}
      {shareDetails && <ShareDetails key={(uid||'')+':'+(active?.id||'')} kind={shareDetails} onClose={()=>setShareDetails(null)} onSend={async card=>{
        if(uidRef.current!==uid || activeRef.current?.id!==active?.id)return false;
        return insertMessage(attachmentCardText(card),JSON.stringify(card),'link');
      }}/>}
      {LIMITED_MEDIA_VIEWER_ENABLED && privateMedia && privateMedia.userId === uid && privateMedia.conversationId === active?.id && privateMedia.account === accountVersion && <PrivateMediaViewer key={privateMedia.userId+":"+privateMedia.id} messageId={privateMedia.id} userId={privateMedia.userId}
        onClose={() => setPrivateMedia(current => current?.id === privateMedia.id && current?.userId === privateMedia.userId && current?.account === privateMedia.account ? null : current)} onConsumed={remaining => { if (remaining <= 0 && privateMedia.account === accountGeneration.current && privateMedia.conversationId === activeRef.current?.id) setViewedPrivateIds(prev => new Set(prev).add(privateMedia.id)); }} />}
      {actionError ? <div role="alert" className="mb-2 text-sm text-danger"><p>{actionError}</p>{attachmentDraft ? <button type="button" disabled={sendingFile} className="mt-1 underline" onClick={() => void attach([attachmentDraft])}>Retry attachment</button> : null}</div> : null}
      {notice ? <p role="status" className="mb-2 text-sm text-ink">{notice}</p> : null}
      {editing || replyTo ? <div className="mb-2 flex items-center justify-between gap-3 rounded-md bg-surface p-2 text-sm text-ink"><span className="truncate">{editing ? 'Editing message' : 'Replying to: ' + (replyTo?.text || 'Attachment')}</span><button type="button" onClick={() => { if (editing) setDraft(active ? drafts.current.get(active.id) || '' : ''); setEditing(null); setReplyTo(null); }}>Cancel</button></div> : null}
      {forwarding && uid ? <div className="mb-2 rounded-md bg-surface p-3 text-sm text-ink"><div className="flex justify-between"><strong>Forward to</strong><button type="button" disabled={!!busyMessage} onClick={() => setForwarding(null)}>Cancel</button></div><ForwardConversationPicker key={`${accountVersion}:${uid}:${context}:${forwarding.id}`} owner={uid} context={context} activeId={active?.id ?? null} conversations={convs} paged={!!inboxPaging} busy={!!busyMessage} onSelect={c => { void runMessageAction(forwarding, async () => { await forwardMessage(supabase, forwarding, c, uid); if (activeRef.current?.id === forwarding.conversation_id) { setForwarding(null); setNotice('Forwarded to ' + c.title + '.'); } }); }} /></div> : null}
    <div className={workspace.composer} data-recording={recording}>
      <button onClick={() => fileRef.current?.click()} disabled={sendingFile || sending || !!editing || recording} title="Attach" aria-label="Attach a file" className="rounded-md p-2.5 text-muted transition-colors duration-[140ms] hover:bg-surface hover:text-accent disabled:opacity-40">
        <Paperclip size={18} />
      </button>
      <button type="button" title="Take a photo or video" onClick={()=>cameraRef.current?.click()} disabled={sendingFile||sending||!!editing||recording} className="p-2 text-muted" aria-label="Camera"><Camera size={18} aria-hidden /></button>
      <input ref={cameraRef} type="file" accept="image/*,video/*" capture="environment" hidden onChange={e=>attach(e.target.files)}/>
      <details className="relative"><summary className="cursor-pointer p-2 text-muted" aria-label="More attachments"><MoreHorizontal size={20} aria-hidden /></summary><div className="absolute bottom-full left-0 z-20 min-w-36 rounded-lg bg-surface-elevated p-2 text-ink shadow-lg"><button type="button" disabled={sending || sendingFile || !!editing || recording} onClick={() => setGifMode('gifs')} className="block w-full rounded p-2 text-left disabled:opacity-40">GIFs</button><button type="button" disabled={sending || sendingFile || !!editing || recording} onClick={() => setGifMode('stickers')} className="block w-full rounded p-2 text-left disabled:opacity-40">Stickers</button><button type="button" onClick={()=>setShareDetails('contact')} className="block p-2">Contact</button><button type="button" onClick={()=>setShareDetails('location')} className="block p-2">Location</button></div></details>
      <input ref={fileRef} type="file" hidden onChange={(e) => attach(e.target.files)} />
      {recording ? (
        <span className={workspace.recordingControls}>
          <span className="text-[13px] font-semibold text-danger">{Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, "0")}</span>
          <button onClick={() => stopRecording(false)} title="Cancel" className="rounded-md bg-surface px-2.5 py-2 text-[12px] text-ink transition-colors duration-[140ms] hover:bg-surface-elevated">Cancel</button>
          <button onClick={() => stopRecording(true)} title="Send voice note" aria-label="Send voice note" className="rounded-md bg-danger p-2.5 text-white transition-opacity duration-[140ms] hover:opacity-90"><Square size={16} /></button>
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
        className="max-h-32 min-w-0 flex-1 resize-none rounded-md bg-surface px-4 py-2.5 text-[16px] sm:text-[14px] text-ink placeholder:text-muted outline-none transition-colors duration-[140ms] focus:bg-surface-elevated"
      />
      <button onClick={send} disabled={!draft.trim() || sending} className="rounded-md bg-pearl p-2.5 text-on-pearl transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-30" title="Send" aria-label="Send message">
        <Send size={18} />
      </button>
    </div>
    </div>
  );

  const historyControl = historyError || hasOlder ? <div className="py-2 text-center text-sm text-ink">{historyError ? <p role="alert">{historyError}</p> : null}<button type="button" disabled={loadingOlder || loadingMsgs} className="rounded-md bg-surface px-3 py-2" onClick={() => { if (historyError && historyErrorOperation.current === 'restore') restoreVisibleThread(); else if (historyCursor.current && (!historyError || historyErrorOperation.current === 'older')) void loadOlder(); else if (active) void openConv(active, false, true); }}>{loadingOlder ? "Loading older messages…" : historyError ? "Try again" : "Load older messages"}</button></div> : null;
  const threadRows = <div ref={threadContent} data-thread-window="true" aria-busy={threadWindow?.restoring || undefined}>
    {threadWindow ? threadWindow.items.map(item => item.type === 'gap'
      ? <div key={item.id} data-thread-gap="true" aria-hidden="true" style={{ height: item.height, overflowAnchor: 'none' }} />
      : <MeasuredThreadMessage key={item.id} id={item.id} height={item.height} measure={measureThreadMessage}>
        <BubbleView m={item.row} uid={uid} offer={offerProps} actions={messageActions} replySource={msgs.find(row => row.id === item.row.reply_to_id)} />
      </MeasuredThreadMessage>) : msgs.map(m => <MeasuredThreadMessage key={m.id} id={m.id} height={0} measure={measureThreadMessage}>
        <BubbleView m={m} uid={uid} offer={offerProps} actions={messageActions} replySource={msgs.find(row => row.id === m.reply_to_id)} />
      </MeasuredThreadMessage>)}
  </div>;
  const pinnedBanner = pinnedMessage ? <div className="mt-2 flex items-center gap-2 rounded-md bg-surface p-2 text-sm text-ink"><span className="min-w-0 flex-1 truncate">Pinned · {pinnedMessage.text || "Attachment"}</span><button type="button" disabled={!!busyMessage} onClick={() => messageActions.pin(pinnedMessage)}>Unpin</button></div> : null;
  const inboxError = conversationError ? <div role="alert" className="p-4 text-sm text-ink">{conversationError}<button type="button" className="ml-2 underline" onClick={() => void loadInbox()}>Try again</button></div> : null;

  const newConversation = async (id: string) => {
    const account = accountGeneration.current, owner = uidRef.current;
    if (!owner) throw new Error('Sign in to start a conversation.');
    const conversation = await resolveInboxConversation(id);
    if (!componentLive.current || account !== accountGeneration.current || uidRef.current !== owner) return;
    if (!conversation) throw new Error('The conversation is not available yet. Please try again.');
    await openConv(conversation);
  };
  const newMessageDialog = uid && context === 'personal' ? <NewMessageDialog open={newMessageOpen} ownerId={uid} onClose={() => setNewMessageOpen(false)} onOpen={newConversation} /> : null;
  const inboxHeader = <div className={workspace.inboxHeader}>
    <div className={workspace.title}><h1>{heading}</h1>{context === 'personal' && uid ? <button className={workspace.iconButton} onClick={() => setNewMessageOpen(true)} aria-label="New message"><SquarePen size={19} strokeWidth={1.75} aria-hidden /></button> : null}</div>
    {context === 'personal' ? <nav className={workspace.inboxLinks} aria-label="Message destinations"><Link href="/messages/requests"><Mail size={14} aria-hidden />Requests</Link><Link href="/calls"><Phone size={14} aria-hidden />Calls</Link></nav> : null}
    <div className={workspace.search}><Search size={16} aria-hidden /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="Search conversations" placeholder="Search messages" /></div>
    {context === 'personal' ? <div className={workspace.tabs} aria-label="Filter conversations">{(['chats','groups','unread'] as const).map(kind => <button type="button" key={kind} aria-pressed={tab === kind} onClick={() => setTab(kind)}>{kind === 'chats' ? 'Chats' : kind === 'groups' ? 'Groups' : 'Unread'}</button>)}</div> : null}
  </div>;
  const conversationRows = <div ref={inboxList} data-inbox-window="true">
    {inboxWindow?.before ? <div aria-hidden="true" style={{ height: inboxWindow.before, overflowAnchor: 'none' }} /> : null}
    {inboxWindow ? inboxWindow.pages.map(page => <MeasuredHistoryPage key={page.index} index={page.index} height={page.height} measure={measureInboxPage}>
      {page.rows.filter(row => shownConvs.some(shown => shown.id === row.id)).map(convButton)}
    </MeasuredHistoryPage>) : shownConvs.map(convButton)}
    {inboxWindow?.after ? <div aria-hidden="true" style={{ height: inboxWindow.after, overflowAnchor: 'none' }} /> : null}
  </div>;
  const sharedMedia = msgs.filter(message => !message.view_limit && !message.deleted_at && message.media_url && ['image','video','file','document','audio'].includes(message.media_type || '')).slice(-12);

  if (compact) {
    return (
      <div ref={surfaceRef} className={active ? workspace.compactConversation + " fixed left-0 top-0 z-[70] flex h-[100dvh] w-full touch-none flex-col overflow-hidden text-ink px-3 pt-[max(env(safe-area-inset-top),8px)] pb-[max(env(safe-area-inset-bottom),8px)]" : workspace.compactInbox}>
        {newMessageDialog}
        {!active ? (
          <>
            {inboxHeader}
            {inboxError}
            {loadingConvs ? (
              <p className="py-12 text-center text-sm text-muted">Loading</p>
            ) : shownConvs.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted">No conversations here yet.</p>
            ) : (
              conversationRows
            )}
            <div ref={inboxSentinel} aria-hidden className="h-px" />
          </>
        ) : (
          <>
            <header className="border-b border-ink/10 pb-3">
              <div className="flex items-center gap-3">
                <button onClick={() => closeConversation()} className="grid min-h-11 min-w-11 place-items-center rounded-md p-1.5 text-secondary transition-colors duration-[140ms] hover:bg-surface hover:text-ink" title="Back" aria-label="Back to conversations"><ArrowLeft size={20} aria-hidden /></button>
                <StoryAvatar userId={active.other_id} name={active.title} avatarUrl={active.avatar} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-[15px] font-semibold text-ink"><span className="truncate">{active.title}</span>{!active.is_group && active.other_id ? <VerifiedBadge userId={active.other_id} size={13} /> : null}</p>
                  {typingLine}
                  {active.is_group && active.group_type === "community" && active.group_ref_id ? <Link href={"/communities/" + active.group_ref_id} className="text-[12px] text-accent hover:underline">Community chat · open the community</Link> : null}
                </div>
                {!active.is_group ? <CallButtons otherId={active.other_id} conversationId={active.id} name={active.title} /> : null}
              </div>
              {active && active.is_group ? <GroupCallBar conversationId={active.id} /> : null}
              {refCard}
              {pinnedBanner}
            </header>
            <div ref={listRef} className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain py-4">
              {historyControl}
              {loadingMsgs ? <p className="py-12 text-center text-sm text-muted">Loading</p> : threadRows}
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
    <div className={workspace.workspace}>
      {newMessageDialog}
      <section className={workspace.inbox}>
        {inboxHeader}
        <div ref={inboxScroller} data-inbox-scroll="true" className="flex-1 overflow-y-auto">
          {inboxError}
            {loadingConvs ? (
            <p className="py-12 text-center text-sm text-muted">Loading</p>
          ) : shownConvs.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted">No conversations yet.</p>
          ) : (
            conversationRows
          )}
          <div ref={inboxSentinel} aria-hidden className="h-px" />
        </div>
      </section>

      <section className={workspace.conversation} aria-label="Conversation">
        {!active ? (
          <div className={workspace.empty}><Mail size={42} strokeWidth={1.4} aria-hidden /><h2>Your conversations, together</h2><p>Choose a conversation to catch up and share something. {context === 'personal' ? 'Or start with someone new.' : ''}</p>{context === 'personal' && uid ? <button className={workspace.newButton} onClick={() => setNewMessageOpen(true)}><SquarePen size={17} aria-hidden />Start a conversation</button> : null}</div>
        ) : (
          <>
            <header className={workspace.conversationHeader}>
              <div className={workspace.conversationIdentity}>
                <StoryAvatar userId={active.other_id} name={active.title} avatarUrl={active.avatar} size={38} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-[15px] font-semibold text-ink"><span className="truncate">{active.title}</span>{!active.is_group && active.other_id ? <VerifiedBadge userId={active.other_id} size={13} /> : null}</p>
                  {typingLine ?? (active.username ? <p className="text-[12px] text-muted">@{active.username}</p> : null)}
                  {active.is_group && active.group_type === "community" && active.group_ref_id ? <Link href={"/communities/" + active.group_ref_id} className="text-[12px] text-accent hover:underline">Community chat · open the community</Link> : null}
                </div>
              </div>
              {active && !active.is_group ? <CallButtons otherId={active.other_id} conversationId={active.id} name={active.title} /> : null}
              {active && active.is_group ? <GroupCallBar conversationId={active.id} /> : null}
              <button type="button" className={`${workspace.iconButton} ${workspace.detailButton}`} aria-label="Conversation details" aria-expanded={detailsOpen} aria-controls="conversation-details" onClick={() => setDetailsOpen(value => !value)}><Info size={19} aria-hidden /></button>
              <button type="button" className={workspace.iconButton} aria-label="Close conversation" onClick={() => closeConversation()}><X size={19} aria-hidden /></button>
              {refCard}
              {pinnedBanner}
            </header>
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {historyControl}
              {loadingMsgs ? (
                <p className="py-12 text-center text-sm text-muted">Loading</p>
              ) : (
                threadRows
              )}
              <div ref={bottomRef} />
            </div>
            <footer className="border-t border-ink/10 px-4 py-3">{composer}</footer>
          </>
        )}
      </section>
      {active && detailsOpen ? <aside id="conversation-details" className={workspace.details} aria-label="Conversation details"><div><h2>{active.title}</h2>{active.username ? <p>@{active.username}</p> : null}<p>{active.is_group ? active.group_type === 'community' ? 'Community conversation' : 'Group conversation' : 'Direct conversation'}</p></div>{active.is_group && active.group_ref_id ? <Link href={'/communities/' + active.group_ref_id}>Open community</Link> : active.other_id ? <Link href={profilePath(active.username,active.other_id)}><UserRound size={16} aria-hidden />View profile</Link> : null}<div><h2>Shared in this conversation</h2><p>Media from loaded messages. Choose an item to find it in the conversation.</p>{sharedMedia.length ? <div className={workspace.mediaGrid}>{sharedMedia.map(message => <button type="button" key={message.id} aria-label={`Find shared ${message.media_type}`} onClick={() => listRef.current?.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)?.scrollIntoView({block:'center',behavior:'instant'})}>{message.media_type === 'image' ? <NextImage unoptimized width={160} height={160} src={message.media_url!} alt="Shared photo" /> : message.media_type === 'video' ? <Video size={20} aria-hidden /> : <FileText size={20} aria-hidden />}</button>)}</div> : <p className="mt-4">No shared files in the loaded messages.</p>}</div><div><h2>Conversation history</h2><p>{loadingMsgs ? 'Loading conversation history…' : historyError ? 'Some messages could not be loaded. Use Try again in the conversation.' : hasOlder ? 'Earlier messages are available. Use Load older messages in the conversation to see more.' : 'You are viewing the available conversation history.'}</p></div></aside> : null}
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
      <div data-message-id={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
        <div className={"max-w-[70%] rounded-2xl px-3.5 py-2 " + (mine ? "bg-[#0B1E3D] text-white shadow-sm" : "bg-surface text-ink")}>
          {m.forwarded_from_id ? <p className="mb-1 text-xs opacity-80">Forwarded</p> : null}
          {m.reply_to_id ? <blockquote className="mb-2 border-l-2 border-current pl-2 text-xs opacity-80">{replySource?.deleted_at ? 'Message removed' : replySource?.text || (replySource ? 'Attachment' : 'Reply to an earlier message')}</blockquote> : null}
          {m.media_type === "payment" || m.payment_id ? (
            <span className={"flex items-center gap-1.5 text-[13px] " + (mine ? "text-white/75" : "text-secondary")}><Wallet size={14} /> Payment · open the Platinum Circles app</span>
          ) : null}
          {m.view_limit ? LIMITED_MEDIA_VIEWER_ENABLED ? <button type="button" disabled={mine || actions.viewedPrivateIds.has(m.id)} onClick={() => actions.openPrivate(m)} className="rounded-lg border border-current/30 p-3 text-sm disabled:opacity-60">{actions.viewedPrivateIds.has(m.id) ? "Viewed" : mine ? "Private attachment" : "Open private attachment"}</button> : <p className="text-sm">Limited-view attachment · Open in phone app</p> : null}
          {(() => { const card=m.view_limit?null:parseChatAttachmentCard(m.media_url); return card?<div className="my-2 rounded-lg border border-current/30 p-3"><strong>{attachmentCardText(card)}</strong>{attachmentCardLinks(card).map(link=><a key={link.url} href={link.url} target={card.kind==='location'?'_blank':undefined} rel="noopener noreferrer" className="block py-2 underline">{link.label}</a>)}</div>:null; })()}
          {m.shared_post_id ? <SharedPostCard postId={m.shared_post_id} /> : null}
          {!m.view_limit && parseStoryMessageReference(m.media_url) ? <Link href={'/story/' + parseStoryMessageReference(m.media_url)} className="mb-2 block rounded-lg border border-current/30 p-3 text-sm underline">View story</Link> : null}
          {m.media_type === "offer" && m.media_url ? <OfferCardView m={m} {...offer} /> : null}
          {!m.view_limit && (m.media_type === "image" || m.media_type === "gif" || m.media_type === "sticker") && m.media_url ? (

            <NextImage key={m.id + ':' + m.media_url} unoptimized width={768} height={768} src={m.media_url} onError={renewMedia} alt="Shared image" role="button" tabIndex={0} onClick={() => window.dispatchEvent(new CustomEvent("pc-view-media", { detail: { url: m.media_url } }))} onKeyDown={(e) => { if (e.key === "Enter") window.dispatchEvent(new CustomEvent("pc-view-media", { detail: { url: m.media_url } })); }} className="mb-1 max-h-72 cursor-zoom-in rounded-lg object-contain" />
          ) : null}
          {!m.view_limit && m.media_type === "video" && m.media_url ? (
            <ChatVideo key={m.id + ':' + m.media_url} messageId={m.id} userId={uid} source={m.media_url} poster={m.thumbnail_url || undefined} onError={renewMedia} />
          ) : null}
          {!m.view_limit && (m.media_type === "audio" || m.media_type === "voice") && m.media_url ? (
            <audio key={m.id + ':' + m.media_url} onError={renewMedia} controls preload="metadata" className="mb-1 w-[240px] max-w-full"><source src={m.media_url} type={/\.(m4a|mp4)(\?|$)/i.test(m.media_url) ? "audio/mp4" : /\.webm(\?|$)/i.test(m.media_url) ? "audio/webm" : undefined} /><a href={m.media_url} target="_blank" rel="noopener noreferrer" className="underline">Voice message</a></audio>
          ) : null}
          {!m.view_limit && m.media_type === "document" && m.media_url ? (
            <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-1.5 text-[13px] underline">
              <FileText size={14} /> {m.text?.replace("📄 ", "") || "Document"}
            </a>
          ) : null}
          {m.text && m.media_type !== "document" ? <p className={'whitespace-pre-wrap break-words text-[14px] leading-relaxed ' + (mine ? '[&_a]:text-white [&_a]:underline' : '')}><RichText text={m.text} /></p> : null}
          <p className={"mt-0.5 text-[10px] " + (mine ? "text-white/80" : "text-secondary")}><RelativeTime dateTime={m.created_at} />{m.edited_at ? ' · edited' : ''}{mine ? pending ? m._delivery === 'rejected' ? ' · Not sent' : m._delivery === 'conflict' ? ' · Delivery conflict' : ' · Waiting for confirmation'  : m.read_at ? ' · Read' : m.delivered_at ? ' · Delivered' : ' · Sent' : ''}</p>
          {pending && m._delivery !== 'conflict' ? <button type="button" onClick={() => actions.retry(m)} className="mt-1 text-xs underline">Retry delivery</button> : null}
          {!pending && !m.view_limit && m.media_type && ['image', 'gif', 'sticker', 'video', 'audio', 'voice', 'document'].includes(m.media_type) && !m.media_url ? m._mediaPending ? <p className="text-xs opacity-80">Loading attachment…</p> : <button type="button" onClick={() => actions.refreshMedia(m)} className="text-xs underline">Attachment unavailable · Retry</button> : null}
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
