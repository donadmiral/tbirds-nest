"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Briefcase, CalendarClock, Megaphone, MessageCircle, Star, Tag } from "lucide-react";
import { pct, studioHome, type StudioHome } from "@/lib/studio";
import { useStudio } from "@/components/StudioShell";
import { createClient } from "@/lib/supabase/client";
import { ContentThumb, Sparkline } from "@/components/Charts";

// The daily series behind the headline numbers. studio_home returns totals
// only, so the shape of a week lives in studio_insights; one extra call buys a
// sparkline on every card that has a matching daily key.
type Day = Record<string, number | string>;

const HOURS = (h: number) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? "am" : "pm");

export default function StudioHomePage() {
  const { me } = useStudio();
  const [h, setH] = useState<StudioHome | null>(null);
  const [series, setSeries] = useState<Day[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, { url: string; media_type: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const [home, ins] = await Promise.all([
        studioHome(),
        supabase.rpc("studio_insights", { p_days: 30 }),
      ]);
      setH(home);
      setSeries(((ins.data as { series?: Day[] } | null)?.series) ?? []);
      setLoading(false);

      // Thumbnails are a second pass on purpose: the page is readable before
      // they land, and a slow image query never holds up the numbers.
      const ids = (home?.recent ?? []).map((r) => r.post_id);
      if (ids.length === 0) return;
      const { data: media } = await supabase
        .from("post_media")
        .select("post_id, url, media_type, sort_order")
        .in("post_id", ids)
        .order("sort_order");
      const first: Record<string, { url: string; media_type: string }> = {};
      for (const m of (media ?? []) as { post_id: string; url: string; media_type: string }[]) {
        if (!first[m.post_id]) first[m.post_id] = { url: m.url, media_type: m.media_type };
      }
      setThumbs(first);
    })();
  }, []);

  if (loading) return <p className="py-16 text-center text-sm text-ink/40">Loading</p>;
  if (!h) return <p className="py-16 text-center text-sm text-ink/40">Could not load the overview.</p>;

  const todos = [
    { n: h.todos.unanswered, label: "unanswered messages", href: "/messages", icon: MessageCircle },
    { n: h.todos.offers, label: "offers waiting on you", href: "/messages", icon: Tag },
    { n: h.todos.applicants, label: "applicants to review", href: "/jobs", icon: Briefcase },
    { n: h.todos.ads_ending, label: "ads ending or near cap", href: "/ads", icon: Megaphone },
    { n: h.todos.reviews, label: "new reviews this month", href: me?.username ? "/" + me.username : "/studio", icon: Star },
    { n: h.todos.scheduled_today, label: "posts scheduled today", href: "/studio/planner", icon: CalendarClock },
    { n: h.todos.failed_posts, label: "posts failed to publish", href: "/studio/planner", icon: AlertTriangle },
  ].filter(t => t.n > 0);

  // Only cards whose daily key means the same thing as the total get a line.
  // Likes, comments and reposts roll up into one engagements series, so a line
  // under each of them would be the same shape three times, which is a lie.
  const stats: { label: string; now: number; prev: number; key?: string }[] = [
    { label: "Posts", now: h.now.posts, prev: h.prev.posts, key: "posts" },
    { label: "Likes", now: h.now.likes, prev: h.prev.likes },
    { label: "Comments", now: h.now.comments, prev: h.prev.comments },
    { label: "Reposts", now: h.now.reposts, prev: h.prev.reposts },
    { label: "Post views", now: h.now.views, prev: h.prev.views, key: "impressions" },
    { label: "New followers", now: h.now.followers, prev: h.prev.followers, key: "followers" },
    { label: "Messages received", now: h.now.messages, prev: h.prev.messages, key: "messages" },
    { label: "Ad impressions", now: h.now.ad_impressions, prev: h.prev.ad_impressions, key: "ad_impressions" },
    { label: "Ad clicks", now: h.now.ad_clicks, prev: h.prev.ad_clicks, key: "ad_clicks" },
  ];
  const lineFor = (key?: string) => (key ? series.map((d) => Number(d[key] ?? 0)) : []);

  return (
    <div>
      {/* The greeting lives in the Studio header now, so the page opens on the
          work rather than repeating the name. */}
      {!loading && series.length < 2 ? (
        <div className="mb-5 rounded-2xl border border-pearl/40 bg-pearl/8 px-4 py-3.5">
          <p className="text-[13.5px] font-semibold text-ink">Charts need the nightly rollup</p>
          <p className="mt-1 text-[13px] leading-6 text-ink/60">
            Totals below are live, but the trend lines read from a nightly job that has not recorded a day for this
            business yet. It runs at 22:20 and needs two days before a line can be drawn. To fill history from posts
            that already exist, run <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[12px]">select studio_rollup(95);</code> once
            in the SQL editor while signed in as this business.
          </p>
        </div>
      ) : null}

      <section>
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Needs attention</h2>
        {todos.length === 0 ? (
          <p className="rounded-2xl border border-ink/10 bg-white px-4 py-5 text-[13.5px] text-ink/50">Nothing waiting on you. Inbox, offers, applicants and ads are all clear.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {todos.map(t => (
              <Link key={t.label} href={t.href} className="flex items-center gap-3.5 rounded-2xl border border-ink/10 bg-white px-4 py-3.5 transition-colors duration-[140ms] hover:bg-surface">
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pearl/12">
                  <t.icon size={16} className="text-pearl" />
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-pearl" aria-hidden />
                </span>
                <span className="text-[14.5px] text-ink"><span className="font-semibold">{t.n}</span> {t.label}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-7">
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Performance</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {stats.map(s => {
            const p = pct(s.now, s.prev);
            const up = p > 0, flat = p === 0;
            const line = lineFor(s.key);
            return (
              <div key={s.label} className="flex flex-col rounded-2xl border border-ink/10 bg-white px-4 py-3.5">
                <p className="text-[11.5px] text-ink/45">{s.label}</p>
                <p className="mt-0.5 font-display text-[26px] leading-tight text-porcelain">{s.now.toLocaleString()}</p>
                <p className={"mt-0.5 flex items-center gap-1 text-[11.5px] " + (flat ? "text-ink/35" : up ? "text-success" : "text-red-400")}>
                  {flat ? null : up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {flat ? "no change" : Math.abs(p) + "% vs prior week"}
                </p>
                {line.length > 1 ? (
                  <div className="mt-2.5 -mb-1">
                    <Sparkline points={line} tone={flat ? "pearl" : up ? "up" : "down"} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {h.payments.length > 0 ? (
          <p className="mt-3 text-[13px] text-ink/60">
            Received this week: {h.payments.map(p => p.currency + " " + p.total.toLocaleString() + " (" + p.count + ")").join(" · ")}
          </p>
        ) : null}
      </section>

      <section className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Recent posts</h2>
          {h.recent.length === 0 ? (
            <p className="rounded-2xl border border-ink/10 bg-white px-4 py-5 text-[13.5px] text-ink/50">No posts yet. <Link href="/studio/planner" className="text-pearl">Plan the first one.</Link></p>
          ) : h.recent.map(p => (
            <Link key={p.post_id} href={"/post/" + p.post_id} className="mb-2 flex items-start gap-3.5 rounded-2xl border border-ink/10 bg-white px-4 py-3.5 transition-colors duration-[140ms] hover:bg-surface">
              <ContentThumb url={thumbs[p.post_id]?.url} kind={thumbs[p.post_id]?.media_type} label={p.content || p.body} size={44} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-[13.5px] text-ink">{p.content || p.body || "Media post"}</span>
                <span className="mt-1.5 block text-[11.5px] text-ink/45">{new Date(p.created_at).toLocaleDateString()} · {p.views_count} views · {p.likes_count} likes · {p.comments_count} comments · {p.reposts_count} reposts</span>
              </span>
            </Link>
          ))}
        </div>
        <div>
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Best times to post</h2>
          <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3.5">
            {h.best_hours.length === 0 ? (
              <p className="text-[13px] text-ink/50">Appears after your posts collect engagement.</p>
            ) : h.best_hours.map(b => (
              <div key={b.hour} className="flex items-center justify-between py-1 text-[13.5px] text-ink">
                <span>{HOURS(b.hour)}</span><span className="text-ink/45">{b.score} engagements</span>
              </div>
            ))}
            <p className="mt-2 text-[11.5px] text-ink/35">From when people engaged with your posts, last 90 days.</p>
          </div>
        </div>
      </section>
    </div>
  );
}