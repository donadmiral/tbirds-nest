"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Briefcase, CalendarClock, Megaphone, MessageCircle, Star, Tag } from "lucide-react";
import { pct, studioHome, type StudioHome } from "@/lib/studio";
import { useStudio } from "@/components/StudioShell";

const HOURS = (h: number) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? "am" : "pm");

export default function StudioHomePage() {
  const { me } = useStudio();
  const [h, setH] = useState<StudioHome | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => { setH(await studioHome()); setLoading(false); })(); }, []);

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

  const stats: { label: string; now: number; prev: number }[] = [
    { label: "Posts", now: h.now.posts, prev: h.prev.posts },
    { label: "Likes", now: h.now.likes, prev: h.prev.likes },
    { label: "Comments", now: h.now.comments, prev: h.prev.comments },
    { label: "Reposts", now: h.now.reposts, prev: h.prev.reposts },
    { label: "Post views", now: h.now.views, prev: h.prev.views },
    { label: "New followers", now: h.now.followers, prev: h.prev.followers },
    { label: "Messages received", now: h.now.messages, prev: h.prev.messages },
    { label: "Ad impressions", now: h.now.ad_impressions, prev: h.prev.ad_impressions },
    { label: "Ad clicks", now: h.now.ad_clicks, prev: h.prev.ad_clicks },
  ];

  return (
    <div className="max-w-[920px]">
      <h1 className="font-display text-2xl text-porcelain">Good day, {me?.business_name || me?.display_name || "team"}</h1>
      <p className="mt-1 text-[13px] text-ink/50">Last 7 days against the 7 before.</p>

      <section className="mt-6">
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Needs attention</h2>
        {todos.length === 0 ? (
          <p className="rounded-lg border border-ink/10 px-4 py-5 text-[13.5px] text-ink/50">Nothing waiting on you. Inbox, offers, applicants and ads are all clear.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {todos.map(t => (
              <Link key={t.label} href={t.href} className="flex items-center gap-3 rounded-lg border border-ink/10 px-4 py-3 transition-colors duration-[140ms] hover:bg-surface">
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pearl/12">
                  <t.icon size={15} className="text-pearl" />
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-pearl" aria-hidden />
                </span>
                <span className="text-[14px] text-ink"><span className="font-semibold">{t.n}</span> {t.label}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-7">
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Performance</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.map(s => {
            const p = pct(s.now, s.prev);
            const up = p > 0, flat = p === 0;
            return (
              <div key={s.label} className="rounded-lg border border-ink/10 px-4 py-3">
                <p className="text-[11.5px] text-ink/45">{s.label}</p>
                <p className="mt-0.5 font-display text-[24px] leading-tight text-porcelain">{s.now.toLocaleString()}</p>
                <p className={"mt-0.5 flex items-center gap-1 text-[11.5px] " + (flat ? "text-ink/35" : up ? "text-success" : "text-red-400")}>
                  {flat ? null : up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {flat ? "no change" : Math.abs(p) + "% vs prior week"}
                </p>
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

      <section className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
        <div>
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Recent posts</h2>
          {h.recent.length === 0 ? (
            <p className="rounded-lg border border-ink/10 px-4 py-5 text-[13.5px] text-ink/50">No posts yet. <Link href="/studio/planner" className="text-pearl">Plan the first one.</Link></p>
          ) : h.recent.map(p => (
            <Link key={p.post_id} href={"/post/" + p.post_id} className="mb-2 block rounded-lg border border-ink/10 px-4 py-3 transition-colors duration-[140ms] hover:bg-surface">
              <p className="line-clamp-2 text-[13.5px] text-ink">{p.content || p.body || "Media post"}</p>
              <p className="mt-1.5 text-[11.5px] text-ink/45">{new Date(p.created_at).toLocaleDateString()} · {p.views_count} views · {p.likes_count} likes · {p.comments_count} comments · {p.reposts_count} reposts</p>
            </Link>
          ))}
        </div>
        <div>
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Best times to post</h2>
          <div className="rounded-lg border border-ink/10 px-4 py-3">
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