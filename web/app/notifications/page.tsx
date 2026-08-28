"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { Heart, Repeat2, MessageCircle, UserPlus, AtSign, Bell, ShieldQuestion } from "lucide-react";

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
  const [sThumbs, setSThumbs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("get_notifications", { p_limit: 60, p_cursor: null });
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
    let ch: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id;
      if (!uid) return;
      ch = supabase
        .channel("web_notifications_" + Date.now())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "recipient_id=eq." + uid }, () => load())
        .subscribe();
    });
    return () => { if (ch) supabase.removeChannel(ch); };
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
  for (const r of visibleRows) {
    const t = sectionOf(r.created_at);
    const last = sections[sections.length - 1];
    if (last && last.title === t) last.items.push(r);
    else sections.push({ title: t, items: [r] });
  }

  return (
    <div className="px-1">
      <div className="flex items-center justify-between pb-3">
        <h1 className="font-display text-xl text-porcelain">Notifications</h1>
        {hasUnread ? (
          <button onClick={markAllRead} className="text-[13px] font-semibold text-pearl transition-opacity duration-[140ms] hover:opacity-80">Mark all read</button>
        ) : null}
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-3">
        {([["all", "All"], ["likes", "Likes"], ["comments", "Comments"], ["follows", "Follows"], ["mentions", "Mentions"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setFilt(k)}
            className={"shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (filt === k ? "bg-pearl text-ink" : "bg-surface text-ink/60 hover:bg-surface-elevated")}>
            {lbl}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading</p>
      ) : visibleRows.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink/40">Nothing here yet. Engagement on your posts and profile lands here.</p>
      ) : (
        sections.map((s) => (
          <section key={s.title}>
            <h2 className="pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/30">{s.title}</h2>
            {s.items.map((n) => {
              const { lead, rest } = lineFor(n);
              const unread = !n.read_at || n.unread_in_group > 0;
              return (
                <Link key={n.notification_id}
                  href={hrefFor(n)}
                  className={"relative flex items-center gap-3 border-b border-ink/5 py-3.5 pl-5 pr-2 transition-colors duration-[140ms] hover:bg-surface/60 " + (unread ? "" : "opacity-90")}
                >
                  {unread ? <span aria-hidden className="absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-pearl" /> : null}
                  <span className="w-5 shrink-0" aria-hidden>{iconFor(n.type)}</span>
                  <StoryAvatar userId={n.actor_id} name={n.actor_name || ((n.others_count || 0) > 0 ? String((n.others_count || 0) + 1) : " ")} avatarUrl={n.actor_avatar || n.other_avatars?.[0] || null} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-snug text-ink/90">
                      <span className="font-semibold text-ink">{lead}</span>
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
    </div>
  );
}