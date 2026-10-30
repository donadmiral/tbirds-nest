"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { conversationHref, notificationHref, notificationValue } from "@/lib/notificationRouting";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { Heart, Repeat2, MessageCircle, UserPlus, AtSign, Bell, Check, ShieldQuestion } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { SocialPageFooter } from "@/components/SocialPageFooter";
import { ErrorState } from "@/components/ErrorState";
import { hydratePostMedia, hydrateStoryMedia } from "@/lib/contentMedia";
import { withTimeout } from "@/lib/withTimeout";
import { UnreadSummary } from "@/components/NotificationsRail";
import { StoryViewer } from "@/components/StoryViewer";
import type { CatchupUser } from "@/lib/stories";

function iconFor(type: string) {
  if (type === "like") return <Heart size={15} className="text-danger" />;
  if (type === "repost" || type === "quote") return <Repeat2 size={15} className="text-success" />;
  if (type === "comment" || type === "reply") return <MessageCircle size={15} className="text-info" />;
  if (type === "follow") return <UserPlus size={15} className="text-accent" />;
  if (type === "follow_request") return <ShieldQuestion size={15} className="text-accent" />;
  if (type === "mention") return <AtSign size={15} className="text-accent" />;
  return <Bell size={15} className="text-muted" />;
}
import { RelativeTime } from "@/components/RelativeTime";

type Notif = {
  notification_id: string;
  group_key: string;
  type: string;
  message: string | null;
  body_preview: string | null;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_username: string | null;
  actor_avatar: string | null;
  others_count: number;
  other_avatars: string[] | null;
  post_id: string | null;
  post_thumb: string | null;
  post_text: string | null;
  viewer_follows: boolean;
  unread_in_group: number;
};

function quote(t: string): string {
  const c = t.trim();
  return c ? "\u201C" + (c.length > 64 ? c.slice(0, 64) + "\u2026" : c) + "\u201D" : "";
}

function lineFor(n: Notif): { lead: string; rest: string } {
  const name = n.actor_name || "Someone";
  const others = n.others_count || 0;
  const lead = !n.actor_name && others > 0 ? String(others + 1) + " people" : others > 0 ? name + " and " + others + (others === 1 ? " other" : " others") : name;
  const c = n.body_preview ? quote(n.body_preview) : "";
  const emoji = (n.body_preview || "").trim();
  switch (n.type) {
    case "market_order": return { lead: n.message || "Marketplace order updated", rest: "" };
    case "like": return { lead, rest: " liked your post" };
    case "market_alert": return { lead, rest: " listed a match for your alert" + (((n.data as { title?: string } | null)?.title) ? ": " + (n.data as { title?: string }).title : "") };
    case "comment_like": return { lead, rest: c ? " liked your comment " + c : " liked your comment" };
    case "comment": return { lead, rest: c ? " commented " + c : " commented on your post" };
    case "reply": return { lead, rest: c ? " replied " + c : " replied to you" };
    case "repost": return { lead, rest: " shared your post" };
    case "mention": return { lead, rest: c ? " mentioned you " + c : " mentioned you" };
    case "follow": return { lead, rest: " started following you" };
    case "follow_request": return { lead, rest: " asked to follow you" };
    case "follow_accepted": return { lead, rest: " accepted your follow request" };
    case "story_reaction": return { lead, rest: emoji ? " reacted " + emoji + " to your story" : " reacted to your story" };
    case "message_reaction": return { lead, rest: emoji ? " reacted " + emoji + " to your message" : " reacted to your message" };
    case "payment_received": {
      const msg = (n.message || "").trim();
      const stripped = msg.startsWith(name) ? msg.slice(name.length) : " sent you money";
      return { lead, rest: stripped + (n.body_preview ? " · " + n.body_preview : "") };
    }
    case "job_application": return { lead, rest: n.body_preview ? " applied for " + n.body_preview : " applied to your job" };
    case "job_referral": return { lead, rest: n.body_preview ? " referred you for " + n.body_preview : " referred you for a job" };
    case "story_mention": return { lead, rest: n.body_preview ? " mentioned you in their story " + quote(n.body_preview) : " mentioned you in their story" };
    case "business_member": return { lead: n.message || "You joined a business", rest: n.body_preview ? " · " + n.body_preview : "" };
    case "system": return { lead: "System", rest: " · " + (n.message || "System alert") };
    case "community_invite": return { lead, rest: " invited you to join " + (((n.data as { community_name?: string } | null)?.community_name) || "a community") };
    default: {
      const msg = (n.message || "").trim();
      const stripped = msg.toLowerCase().startsWith(name.toLowerCase()) ? msg.slice(name.length) : (msg ? " " + msg : "");
      return { lead, rest: stripped };
    }
  }
}

function sectionOf(created: string): string {
  const d = new Date(created);
  const now = new Date();
  const days = (now.getTime() - d.getTime()) / 86400000;
  if (d.toDateString() === now.toDateString()) return "Today";
  if (days < 7) return "This week";
  if (days < 31) return "This month";
  return "Earlier";
}

export default function NotificationsPage() {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const request = useRef(0);
  const identity = useRef(0);
  const cursor = useRef({ offset: 0, asOf: new Date().toISOString() });
  const loadingRef = useRef(false);
  const refreshPending = useRef(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const markingRef = useRef(false);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const actionsRef = useRef(new Set<string>());
  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [filt, setFilt] = useState("all");
  const [failed, setFailed] = useState(false);
  const [sThumbs, setSThumbs] = useState<Record<string, { url: string; expiresAt: number }>>({});
  const [storyView, setStoryView] = useState<CatchupUser | null>(null);

  const load = useCallback(async function loadNotifications(more = false) {
    if (loadingRef.current) { if (!more) refreshPending.current = true; return; }
    loadingRef.current = true;
    if (more) setLoadingMore(true);
    setPageError(null);
    const asOf = more ? cursor.current.asOf : new Date().toISOString();
    const version = request.current += 1;
    setFailed(false);
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const uid = session.session?.user.id;
      if (!uid) {
        if (version === request.current) { setRows([]); setUnreadTotal(0); setLoading(false); }
        return;
      }
      const [res, count] = await Promise.all([
        withTimeout(supabase.rpc("get_notifications_page", { p_limit: 40, p_offset: more ? cursor.current.offset : 0, p_as_of: asOf })),
        withTimeout(supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", uid).is("read_at", null)),
      ]);
      if (res.error || count.error) throw res.error || count.error;
      if (version !== request.current) return;
      let data = (res.data ?? []) as Notif[];
      const rawSize = data.length;
      data = await withTimeout(hydratePostMedia(data, supabase));
      if (version !== request.current) return;
      const requestIds = data.filter((row) => row.type === "follow_request").map((row) => notificationValue(row, "request_id")).filter((id): id is string => !!id);
      if (requestIds.length) {
        const { data: requests, error } = await supabase.from("follow_requests").select("id, status").in("id", requestIds);
        if (error) throw error;
        if (version !== request.current) return;
        const pending = new Set((requests ?? []).filter((row) => row.status === "pending").map((row) => row.id));
        data = data.filter((row) => row.type !== "follow_request" || pending.has(notificationValue(row, "request_id")));
      }
      setRows((previous) => {
        const ordered = more ? [...previous, ...data] : [...data, ...previous];
        const seen = new Set<string>();
        return ordered.filter((item) => { const key = item.group_key || item.notification_id; if (seen.has(key)) return false; seen.add(key); return true; })
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.notification_id.localeCompare(a.notification_id));
      });
      if (more || cursor.current.offset === 0) {
        cursor.current = { offset: (more ? cursor.current.offset : 0) + rawSize, asOf };
        setHasMore(rawSize === 40);
      }
      setUnreadTotal(count.count);
      setLoading(false);
      const storyIds = Array.from(new Set(data.map((row) => notificationValue(row, "story_id")).filter((id): id is string => !!id)));
      if (storyIds.length) {
        const { data: stories } = await supabase.from("stories").select("id, thumbnail_url, media_url, media_type").in("id", storyIds);
        if (version !== request.current) return;
        const thumbnails: Record<string, { url: string; expiresAt: number }> = {};
        const safeStories = await withTimeout(hydrateStoryMedia(stories ?? [], supabase));
        if (version !== request.current) return;
        for (const story of safeStories) {
          const url = story.thumbnail_url || (story.media_type !== "video" ? story.media_url : null);
          if (url) thumbnails[story.id] = { url, expiresAt: (story as typeof story & { _mediaExpiresAt?: number })._mediaExpiresAt ?? Date.now() + 240000 };
        }
        setSThumbs((previous) => ({ ...previous, ...thumbnails }));
      }
    } catch {
      if (version === request.current) {
        if (more) setPageError("Could not load older notifications. Please try again.");
        else setFailed(true);
        setLoading(false);
      }
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
      if (refreshPending.current) { refreshPending.current = false; void loadNotifications(); }
    }
  }, [supabase]);

  useEffect(() => {
    let alive = true;
    let uid: string | null | undefined;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { if (alive) void load(); }, 150); };
    const bind = (next: string | null) => {
      if (!alive || next === uid) return;
      uid = next;
      request.current += 1; identity.current += 1;
      cursor.current = { offset: 0, asOf: new Date().toISOString() }; setHasMore(true);
      setRows([]); setUnreadTotal(null); setSThumbs({}); setLoading(true); setActionError(null);
      if (channel) { void supabase.removeChannel(channel); channel = null; }
      if (next) channel = supabase.channel("web-notifications-" + next + "-" + Math.random().toString(36).slice(2))
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: "recipient_id=eq." + next }, refresh).subscribe();
      refresh();
    };
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => bind(session?.user.id ?? null));
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive || uid !== undefined) return;
      if (error) { setFailed(true); setLoading(false); return; }
      bind(data.session?.user.id ?? null);
    }, () => { if (alive) { setFailed(true); setLoading(false); } });
    return () => { alive = false; refreshPending.current = false; request.current += 1; identity.current += 1; auth.subscription.unsubscribe(); if (timer) clearTimeout(timer); if (channel) void supabase.removeChannel(channel); };
  }, [supabase, load]);

  useEffect(() => {
    let alive = true, pending = false;
    const version = identity.current;
    const renew = async () => {
      if (pending || document.visibilityState !== "visible") return;
      const expiring = rows.filter((row) => {
        const expiry = (row as Notif & { _mediaExpiresAt?: number })._mediaExpiresAt;
        return typeof expiry === "number" && expiry <= Date.now() + 60000;
      });
      const stories = Object.entries(sThumbs).filter(([, entry]) => entry.expiresAt <= Date.now() + 60000).map(([id, entry]) => ({ id, thumbnail_url: entry.url }));
      if (!expiring.length && !stories.length) return;
      pending = true;
      try {
        const [posts, storyRows] = await Promise.all([
          withTimeout(hydratePostMedia(expiring, supabase)), withTimeout(hydrateStoryMedia(stories, supabase)),
        ]);
        if (!alive || version !== identity.current) return;
        if (posts.length) {
          const byId = new Map(posts.map((row) => [row.notification_id, row]));
          setRows((previous) => previous.map((row) => byId.get(row.notification_id) ?? row));
        }
        if (storyRows.length) setSThumbs((previous) => ({ ...previous, ...Object.fromEntries(storyRows.map((row) => [row.id, { url: row.thumbnail_url, expiresAt: (row as typeof row & { _mediaExpiresAt?: number })._mediaExpiresAt ?? Date.now() + 240000 }])) }));
      } catch { /* Expired capabilities remain inaccessible; retry after reconnection. */ }
      finally { pending = false; }
    };
    void renew();
    const timer = setInterval(() => { void renew(); }, 60000);
    window.addEventListener("online", renew); document.addEventListener("visibilitychange", renew);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("online", renew); document.removeEventListener("visibilitychange", renew); };
  }, [rows, sThumbs, supabase]);

  async function markAllRead() {
    if (markingRef.current) return;
    markingRef.current = true; setMarkingRead(true); setActionError(null);
    const version = identity.current;
    try {
      const { error } = await supabase.rpc("mark_notifications_read", { p_ids: null });
      if (error) throw error;
      // Refresh after success so a notification arriving during the write remains unread.
      if (version === identity.current) { setRows((previous) => previous.map((row) => ({ ...row, read_at: new Date().toISOString(), unread_in_group: 0 }))); window.dispatchEvent(new Event("pc:notifications-changed")); await load(); }
    } catch { if (version === identity.current) setActionError("Could not mark notifications as read. Please try again."); }
    finally { markingRef.current = false; setMarkingRead(false); }
  }

  const respond = useCallback(async (n: Notif, accept: boolean) => {
    if (actionsRef.current.has(n.notification_id)) return;
    actionsRef.current.add(n.notification_id); setPendingActions(new Set(actionsRef.current)); setActionError(null);
    const version = identity.current;
    try {
      const result = n.type === "follow_request"
        ? await supabase.rpc("respond_follow_request", { p_request_id: notificationValue(n, "request_id"), p_action: accept ? "accept" : "reject" })
        : await supabase.rpc("respond_community_invite", { p_community: notificationValue(n, "community_id"), p_accept: accept });
      if (result.error) throw result.error;
      if (version !== identity.current) return;
      window.dispatchEvent(new Event("pc:notifications-changed"));
      setRows((previous) => previous.filter((row) => row.notification_id !== n.notification_id));
      if (n.type === "community_invite" && result.data === "joined") router.push(notificationHref(n));
      await load();
    } catch { if (version === identity.current) setActionError("Could not respond to this invitation. Please try again."); }
    finally { actionsRef.current.delete(n.notification_id); setPendingActions(new Set(actionsRef.current)); }
  }, [supabase, router, load]);

  const openConversation = useCallback(async (n: Notif) => {
    const conversation = notificationValue(n, "conversation_id");
    if (!conversation) return;
    const version = identity.current;
    try {
      const { data, error } = await supabase.from("conversations").select("context").eq("id", conversation).maybeSingle();
      if (error || !data) throw error || new Error("Conversation unavailable");
      if (version === identity.current) router.push(conversationHref(conversation, data.context));
    } catch { if (version === identity.current) setActionError("This conversation could not be opened. Please try again."); }
  }, [supabase, router]);

  const openStory = useCallback(async (notification: Notif) => {
    const storyId = notificationValue(notification, "story_id");
    if (!storyId) return;
    const version = identity.current;
    try {
      // The actor can be a poll voter or respondent; the story itself owns its destination.
      const { data: story, error } = await supabase.from("stories").select("user_id, created_at").eq("id", storyId).maybeSingle();
      if (error || !story) throw error || new Error("Story unavailable");
      const { data: owner, error: ownerError } = await supabase.from("profiles").select("full_name, username, avatar_url").eq("id", story.user_id).maybeSingle();
      if (ownerError) throw ownerError;
      if (version === identity.current) setStoryView({ user_id: story.user_id, full_name: owner?.full_name ?? null, username: owner?.username ?? null, avatar_url: owner?.avatar_url ?? null, story_count: 1, unseen_count: 0, latest_story_at: story.created_at, latest_story_id: storyId, has_unseen: false });
    } catch { if (version === identity.current) setActionError("This story could not be opened. It may have expired."); }
  }, [supabase]);

  const hasUnread = (unreadTotal ?? 0) > 0;
  const sections: { title: string; items: Notif[] }[] = [];
  const FILTS: Record<string, string[]> = {
    likes: ["like", "comment_like", "story_reaction", "message_reaction"],
    comments: ["comment", "reply"],
    follows: ["follow", "follow_request", "follow_accepted"],
    mentions: ["mention", "story_mention"],
  };
  const visibleRows = filt === "all" ? rows : rows.filter((r) => (FILTS[filt] || []).includes(r.type));
  const isUnread = (r: Notif) => !r.read_at || r.unread_in_group > 0;
  const unreadByType = (k: string) => rows.filter((r) => isUnread(r) && (FILTS[k] || []).includes(r.type)).length;
  const unreadBy: Record<string, number> = {
    all: unreadTotal ?? 0,
    ...Object.fromEntries(Object.entries(FILTS).map(([k, types]) => [k, rows.filter((r) => isUnread(r) && types.includes(r.type)).length])),
  };
  for (const r of visibleRows) {
    const t = sectionOf(r.created_at);
    const last = sections[sections.length - 1];
    if (last && last.title === t) last.items.push(r);
    else sections.push({ title: t, items: [r] });
  }

  const summaryRows = [
    { label: "Likes", n: unreadByType("likes") },
    { label: "Comments", n: unreadByType("comments") },
    { label: "Follows", n: unreadByType("follows") },
    { label: "Mentions", n: unreadByType("mentions") },
  ];

  return (
    <div>
      <PageHeader title="Notifications" subtitle="Everything that happened while you were away.">
        {hasUnread ? (
          <button onClick={markAllRead} disabled={markingRead} aria-busy={markingRead} className="flex items-center gap-1.5 rounded-full border border-ink/15 px-3.5 py-2 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">
            <Check size={14} /> Mark all read
          </button>
        ) : null}
      </PageHeader>

      {/* All uses the exact account-wide count; category counts describe the loaded recent groups. */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto rounded-2xl border border-ink/10 bg-white px-3 py-2.5">
        {([["all", "All"], ["likes", "Likes"], ["comments", "Comments"], ["follows", "Follows"], ["mentions", "Mentions"]] as const).map(([k, lbl]) => {
          const n = unreadBy[k] ?? 0;
          return (
            <button key={k} onClick={() => setFilt(k)} title={k === "all" ? "Unread notifications across all activity" : "Unread groups in the recent activity below"}
              className={"flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (filt === k ? "bg-pearl text-on-pearl" : "text-muted hover:bg-surface hover:text-ink")}>
              {lbl}
              {n > 0 ? (
                <span className={"rounded-full px-1.5 text-[10.5px] tabular-nums " + (filt === k ? "bg-on-pearl/15 text-on-pearl" : "bg-pearl/20 text-accent")}>{n}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {!loading && rows.length > 0 ? (
        <div className="mb-4">
          <UnreadSummary total={unreadTotal} rows={summaryRows} />
        </div>
      ) : null}

      {actionError ? <p role="alert" className="mb-3 text-sm text-danger">{actionError}</p> : null}
      {failed && rows.length === 0 ? (
        <ErrorState title="Could not load notifications" onRetry={() => void load()} />
      ) : loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading</p>
      ) : visibleRows.length === 0 ? (
        <EmptyState
          icon={<Bell size={19} />}
          title={filt === "all" ? "Nothing here yet" : "Nothing in this filter"}
          line={filt === "all" ? "Likes, comments, follows and mentions on your posts land here." : "Try All to see everything that has come in."}
        />
      ) : (
        sections.map((s) => (
          <section key={s.title} className="mb-4 overflow-hidden rounded-2xl border border-ink/10 bg-white">
            <h2 className="border-b border-ink/8 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{s.title}</h2>
            {s.items.map((n) => {
              const { lead, rest } = lineFor(n);
              const unread = !n.read_at || n.unread_in_group > 0;
              const onOpen: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
                // eslint-disable-next-line react-hooks/refs -- These callbacks read request guards only when a user acts, never during render.
                if (notificationValue(n, "conversation_id")) { event.preventDefault(); void openConversation(n); }
                // eslint-disable-next-line react-hooks/refs -- These callbacks read request guards only when a user acts, never during render.
                else if (notificationValue(n, "story_id")) { event.preventDefault(); void openStory(n); }
              };
              // eslint-disable-next-line react-hooks/refs -- These callbacks read request guards only when a user acts, never during render.
              const onAccept = () => { void respond(n, true); };
              const onDecline = () => { void respond(n, false); };
              return (
                <Link key={n.notification_id}
                  href={notificationHref(n)}
                  onClick={onOpen}
                  className={"relative flex items-center gap-3 border-b border-ink/5 py-3.5 pl-5 pr-2 transition-colors duration-[140ms] hover:bg-surface/60 " + (unread ? "" : "opacity-90")}
                >
                  {unread ? <span aria-hidden className="absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-pearl" /> : null}
                  <span className="w-5 shrink-0" aria-hidden>{iconFor(n.type)}</span>
                  <StoryAvatar userId={n.actor_id} name={n.actor_name || ((n.others_count || 0) > 0 ? String((n.others_count || 0) + 1) : " ")} avatarUrl={n.actor_avatar || n.other_avatars?.[0] || null} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-snug text-ink/90">
                      <span className="font-semibold text-ink">{lead}</span>{n.actor_id && n.actor_name && !(n.others_count || 0) ? <VerifiedBadge userId={n.actor_id} size={12} /> : null}
                      {rest}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
                      <RelativeTime dateTime={n.created_at} />
                      {n.unread_in_group > 0 ? <span className="rounded-full bg-pearl px-1.5 py-px text-[10px] font-bold text-on-pearl">{n.unread_in_group} new</span> : null}
                    </span>
                  </span>
                  {n.type === "follow_request" && (n.data as { request_id?: string } | null)?.request_id ? (
                    <span className="flex shrink-0 gap-1.5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      <button disabled={pendingActions.has(n.notification_id)} onClick={onAccept} className="rounded-md bg-pearl px-3 py-1.5 text-[12px] font-semibold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90">Confirm</button>
                      <button disabled={pendingActions.has(n.notification_id)} onClick={onDecline} className="rounded-md bg-surface px-3 py-1.5 text-[12px] text-ink transition-colors duration-[140ms] hover:bg-surface-elevated">Delete</button>
                    </span>
                  ) : null}
                  {n.type === "community_invite" && notificationValue(n, "community_id") ? (
                    <span className="flex shrink-0 gap-1.5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      <button disabled={pendingActions.has(n.notification_id)} onClick={onAccept} className="rounded-md bg-pearl px-3 py-1.5 text-[12px] font-semibold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90">Accept</button>
                      <button disabled={pendingActions.has(n.notification_id)} onClick={onDecline} className="rounded-md bg-surface px-3 py-1.5 text-[12px] text-ink transition-colors duration-[140ms] hover:bg-surface-elevated">Decline</button>
                    </span>
                  ) : null}
                  {n.type === "follow" && n.actor_id && !n.viewer_follows ? (
                    <span className="shrink-0" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      <FollowButton authorId={n.actor_id} />
                    </span>
                  ) : null}
                  {(n.post_thumb || sThumbs[String((n.data as { story_id?: string } | null)?.story_id ?? "")]?.url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={n.post_thumb || sThumbs[String((n.data as { story_id?: string } | null)?.story_id ?? "")]?.url} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
                  ) : null}
                </Link>
              );
            })}
          </section>
        ))
      )}
      {failed && rows.length > 0 ? <ErrorState title="Could not refresh notifications" onRetry={() => void load()} /> : null}
      {!loading ? <SocialPageFooter loading={loadingMore} error={pageError} hasMore={hasMore} loadMore={() => load(true)} /> : null}
      {storyView ? <StoryViewer key={storyView.latest_story_id} users={[storyView]} startIndex={0} initialStoryId={storyView.latest_story_id} onClose={() => setStoryView(null)} /> : null}
    </div>
  );
}