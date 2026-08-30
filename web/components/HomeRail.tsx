"use client";

/**
 * The Home rail.
 *
 * Discovery panels (trending, suggestions) are shared across routes, so they
 * stay in DiscoveryRail. These two are Home's own: what is coming up, and how
 * your own week is going.
 *
 * Every number here is queried, never estimated. A panel with nothing to show
 * hides itself rather than displaying zeroes, because an empty rail reads as
 * calm and a rail of zeroes reads as broken.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Eye, Heart, PenLine, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DiscoveryRail } from "@/components/DiscoveryRail";
import { Panel } from "@/components/ui";

type EventRow = { id: string; title: string; event_date: string; location: string | null; attendees_count: number | null };
type Activity = { posts: number; views: number; engagement: number; followers: number };

function UpcomingEvents() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<EventRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("events")
        .select("id, title, event_date, location, attendees_count")
        .gte("event_date", new Date().toISOString())
        .order("event_date")
        .limit(3);
      setRows((data ?? []) as EventRow[]);
    })();
  }, [supabase]);

  if (rows.length === 0) return null;

  return (
    <Panel title="Upcoming events" icon={<CalendarDays size={15} />} action="View all" actionHref="/communities">
      <div className="flex flex-col gap-3">
        {rows.map((e) => {
          const d = new Date(e.event_date);
          return (
            <div key={e.id} className="flex gap-3">
              {/* A date block rather than a line of text: the day is the thing
                  people scan for. */}
              <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-surface">
                <span className="text-[9.5px] font-semibold uppercase tracking-wide text-ink/45">
                  {d.toLocaleDateString(undefined, { month: "short" })}
                </span>
                <span className="font-display text-[16px] leading-none text-pearl-muted">{d.getDate()}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-[13.5px] font-semibold leading-snug text-ink">{e.title}</span>
                <span className="mt-0.5 block truncate text-[12px] text-ink/45">
                  {d.toLocaleDateString(undefined, { weekday: "short" })} · {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  {e.location ? " · " + e.location : ""}
                </span>
              </span>
              {e.attendees_count ? (
                <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-ink/40">
                  <Users size={11} /> {e.attendees_count}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function YourActivity() {
  const supabase = useRef(createClient()).current;
  const [a, setA] = useState<Activity | null>(null);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      const since = new Date(Date.now() - 7 * 86400000).toISOString();

      // Counts only, no rows pulled back: head:true makes each of these a
      // count query rather than a fetch.
      const [posts, mine, followers] = await Promise.all([
        supabase.from("posts").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", since),
        supabase.from("posts").select("likes_count, comments_count, views_count").eq("user_id", uid).gte("created_at", since),
        supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", uid).gte("created_at", since),
      ]);

      const rows = (mine.data ?? []) as { likes_count: number | null; comments_count: number | null; views_count: number | null }[];
      setA({
        posts: posts.count ?? 0,
        views: rows.reduce((n, r) => n + (r.views_count ?? 0), 0),
        engagement: rows.reduce((n, r) => n + (r.likes_count ?? 0) + (r.comments_count ?? 0), 0),
        followers: followers.count ?? 0,
      });
    })();
  }, [supabase]);

  if (!a || (a.posts === 0 && a.views === 0 && a.engagement === 0 && a.followers === 0)) return null;

  const cells = [
    { label: "Posts", n: a.posts, icon: PenLine },
    { label: "Views", n: a.views, icon: Eye },
    { label: "Engagement", n: a.engagement, icon: Heart },
    { label: "New followers", n: a.followers, icon: Users },
  ];

  return (
    <Panel title="Your activity" action="This week" actionHref="/studio">
      <div className="grid grid-cols-2 gap-3">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl bg-surface px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink/45">
              <c.icon size={12} /> {c.label}
            </span>
            <span className="mt-0.5 block font-display text-[20px] leading-tight text-porcelain">{c.n.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function HomeRail() {
  return (
    <>
      <DiscoveryRail />
      <UpcomingEvents />
      <YourActivity />
    </>
  );
}

/** Discover leads with what is moving rather than with your own numbers. */
export function DiscoverRail() {
  return (
    <>
      <DiscoveryRail />
      <UpcomingEvents />
    </>
  );
}

export { UpcomingEvents, YourActivity };
