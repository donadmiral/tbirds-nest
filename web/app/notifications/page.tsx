"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { Heart, Repeat2, MessageCircle, UserPlus, AtSign, Bell, Check, ShieldQuestion } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { ErrorState } from "@/components/ErrorState";
import { withTimeout } from "@/lib/withTimeout";
import { UnreadSummary } from "@/components/NotificationsRail";
import { StoryViewer } from "@/components/StoryViewer";
import type { CatchupUser } from "@/lib/stories";

function iconFor(type: string) {
  if (type === "like") return <Heart size={15} className="text-danger" />;
  if (type === "repost" || type === "quote") return <Repeat2 size={15} className="text-success" />;
  if (type === "comment" || type === "reply") return <MessageCircle size={15} className="text-info" />;
  if (type === "follow") return <UserPlus size={15} className="text-pearl" />;
  if (type === "follow_request") return <ShieldQuestion size={15} className="text-pearl" />;
  if (type === "mention") return <AtSign size={15} className="text-pearl" />;
  return <Bell size={15} className="text-ink/45" />;
}
import { timeAgo } from "@/lib/feed";

type Notif = {
  notification_id: string;
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

function hrefFor(n: Notif): string {
  if (n.type === "market_alert" && (n.data as { listing_id?: string } | null)?.listing_id) return "/market/" + (n.data as { listing_id?: string }).listing_id;
  if (n.post_id) return "/post/" + n.post_id;
  if (n.actor_username) return "/" + n.actor_username;
  return "/notifications";
}

export default function NotificationsPage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [filt, setFilt] = useState("all");
  const [failed, setFailed] = useState(false);
  const [sThumbs, setSThumbs] = useState<Record<string, string>>({});
  const [storyView, setStoryView] = useState<CatchupUser | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    let data: unknown = null;
    try {
      const res = await withTimeout(supabase.rpc("get_notifications", { p_limit: 60, p_cursor: null }));
      if (res.error) throw res.error;
      data = res.data;
    } catch {
      // An empty inbox and an unreachable server looked identical before this.
      setFailed(true);
      setLoading(false);
      return;
    }
    setRows(((data ?? []) as Notif[]));
    const storyIds = Array.from(new Set(((data ?? []) as Notif[]).map((r) => (r.data as { story_id?: string } | null)?.story_id).filter(Boolean))) as string[];
    if (storyIds.length) {
      const { data: ss } = await supabase.from("stories").select("id, thumbnail_url, media_url, media_type").in("id", storyIds);
      const add: Record<string, string> = {};
      ((ss ?? []) as { id: string; thumbnail_url: string | null; media_url: string | null; media_type: string }[]).forEach((st) => {
        const u = st.thumbnail_url || (st.media_type !== "video" ? st.media_url : null);
        if (u) add[st.id] = u;
      });
      setSThumbs((prev) => ({ ...prev, ...add }));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
    // A unique name per mount: React runs this effect twice in development,
    // and two runs in the same millisecond used to get the same channel back
    // already subscribed. The cancelled flag stops the first run's async
    // setup from subscribing after its cleanup has already happened.
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    const name = "web_notifications_" + Math.random().toString(36).slice(2);
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id;
      if (!uid || cancelled) return;
      ch = supabase
        .channel(name)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "recipient_id=eq." + uid }, () => load())
        .subscribe();
    });
    return () => { cancelled = true; if (ch) supabase.removeChannel(ch); };
  }, [supabase, load]);

  async function markAllRead() {
    await supabase.rpc("mark_notifications_read", { p_ids: null });
    setRows((l) => l.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString(), unread_in_group: 0 })));
  }

  const hasUnread = rows.some((r) => !r.read_at || r.unread_in_group > 0);
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
    all: rows.filter(isUnread).length,
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
          <button onClick={markAllRead} className="flex items-center gap-1.5 rounded-full border border-ink/15 px-3.5 py-2 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">
            <Check size={14} /> Mark all read
          </button>
        ) : null}
      </PageHeader>

      {/* Each pill carries its own unread count, so the filter row doubles as a
          summary: you can see where the noise is before choosing. */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto rounded-2xl border border-ink/10 bg-white px-3 py-2.5">
        {([["all", "All"], ["likes", "Likes"], ["comments", "Comments"], ["follows", "Follows"], ["mentions", "Mentions"]] as const).map(([k, lbl]) => {
          const n = unreadBy[k] ?? 0;
          return (
            <button key={k} onClick={() => setFilt(k)}
              className={"flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (filt === k ? "bg-pearl text-ink" : "text-ink/55 hover:bg-surface hover:text-ink")}>
              {lbl}
              {n > 0 ? (
                <span className={"rounded-full px-1.5 text-[10.5px] tabular-nums " + (filt === k ? "bg-ink/15 text-ink" : "bg-pearl/20 text-pearl-muted")}>{n}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {!loading && rows.length > 0 ? (
        <div className="mb-4">
          <UnreadSummary total={unreadBy.all} rows={summaryRows} />
        </div>
      ) : null}

      {failed ? (
        <ErrorState title="Could not load notifications" onRetry={() => void load()} />
      ) : loading ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading</p>
      ) : visibleRows.length === 0 ? (
        <EmptyState
          icon={<Bell size={19} />}
          title={filt === "all" ? "Nothing here yet" : "Nothing in this filter"}
          line={filt === "all" ? "Likes, comments, follows and mentions on your posts land here." : "Try All to see everything that has come in."}
        />
      ) : (
        sections.map((s) => (
          <section key={s.title} className="mb-4 overflow-hidden rounded-2xl border border-ink/10 bg-white">
            <h2 className="border-b border-ink/8 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/35">{s.title}</h2>
            {s.items.map((n) => {
              const { lead, rest } = lineFor(n);
              const unread = !n.read_at || n.unread_in_group > 0;
              return (
                <Link key={n.notification_id}
                  href={hrefFor(n)}
                  onClick={(e) => { if (n.type === "story_mention" && n.actor_id) { e.preventDefault(); setStoryView({ user_id: n.actor_id, full_name: n.actor_name, username: n.actor_username, avatar_url: n.actor_avatar, story_count: 1, unseen_count: 0, latest_story_at: n.created_at, latest_story_id: String((n.data as { story_id?: string } | null)?.story_id ?? ""), has_unseen: false }); } }}
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
                    <span className="mt-0.5 flex items-center gap-2 text-[12px] text-ink/40">
                      {timeAgo(n.created_at)}
                      {n.unread_in_group > 0 ? <span className="rounded-full bg-pearl px-1.5 py-px text-[10px] font-bold text-ink">{n.unread_in_group} new</span> : null}
                    </span>
                  </span>
                  {n.type === "follow_request" && (n.data as { request_id?: string } | null)?.request_id ? (
                    <span className="flex shrink-0 gap-1.5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      <button onClick={async () => {
                        const reqId = (n.data as { request_id?: string }).request_id!;
                        const { error } = await supabase.rpc("respond_follow_request", { p_request_id: reqId, p_action: "accept" });
                        if (!error) setRows((prev) => prev.filter((r) => r.notification_id !== n.notification_id));
                      }} className="rounded-md bg-pearl px-3 py-1.5 text-[12px] font-semibold text-ink transition-opacity duration-[140ms] hover:opacity-90">Confirm</button>
                      <button onClick={async () => {
                        const reqId = (n.data as { request_id?: string }).request_id!;
                        const { error } = await supabase.rpc("respond_follow_request", { p_request_id: reqId, p_action: "reject" });
                        if (!error) setRows((prev) => prev.filter((r) => r.notification_id !== n.notification_id));
                      }} className="rounded-md bg-surface px-3 py-1.5 text-[12px] text-ink transition-colors duration-[140ms] hover:bg-surface-elevated">Delete</button>
                    </span>
                  ) : null}
                  {n.type === "follow" && n.actor_id && !n.viewer_follows ? (
                    <span className="shrink-0" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      <FollowButton authorId={n.actor_id} />
                    </span>
                  ) : null}
                  {(n.post_thumb || sThumbs[String((n.data as { story_id?: string } | null)?.story_id ?? "")]) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={n.post_thumb || sThumbs[String((n.data as { story_id?: string } | null)?.story_id ?? "")]} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
                  ) : null}
                </Link>
              );
            })}
          </section>
        ))
      )}
      {storyView ? <StoryViewer users={[storyView]} startIndex={0} onClose={() => setStoryView(null)} /> : null}
    </div>
  );
}