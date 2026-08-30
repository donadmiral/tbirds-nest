"use client";

/**
 * The Studio rail, shared by every desk.
 *
 * Two rules kept it honest. Everything shown is either an action that always
 * exists or a number read from the database; nothing is a placeholder waiting
 * for a table that has not been built. And a panel with nothing to say hides
 * itself, so a quiet week produces a short rail rather than a column of zeroes.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Briefcase,
  CalendarClock,
  Inbox,
  PenSquare,
  ShoppingBag,
  Star,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { studioHome, type StudioHome } from "@/lib/studio";
import { Panel } from "@/components/ui";

const ACTIONS = [
  { label: "Write a post", href: "/studio/planner", icon: PenSquare },
  { label: "Schedule content", href: "/studio/planner", icon: CalendarClock },
  { label: "Review applicants", href: "/studio/recruiter", icon: Briefcase },
  { label: "Check the inbox", href: "/studio/inbox", icon: Inbox },
  { label: "See insights", href: "/studio/insights", icon: BarChart3 },
  { label: "Add a listing", href: "/studio/commerce", icon: ShoppingBag },
];

export function StudioSideRail({ role, username }: { role: string | null; username: string | null }) {
  const supabase = useRef(createClient()).current;
  const [home, setHome] = useState<StudioHome | null>(null);
  const [reviews, setReviews] = useState<{ n: number; avg: number } | null>(null);

  useEffect(() => {
    (async () => {
      setHome(await studioHome());
      // studio_reviews returns a summary object, not a list of rows.
      const { data } = await supabase.rpc("studio_reviews");
      const d = data as { average?: number; count?: number } | null;
      if (d && (d.count ?? 0) > 0) setReviews({ n: d.count ?? 0, avg: d.average ?? 0 });
    })();
  }, [supabase]);

  const todos = home
    ? [
        { n: home.todos.unanswered, label: "unanswered messages", href: "/studio/inbox" },
        { n: home.todos.offers, label: "offers waiting", href: "/studio/inbox" },
        { n: home.todos.applicants, label: "applicants to review", href: "/studio/recruiter" },
        { n: home.todos.ads_ending, label: "ads ending soon", href: "/studio/ads" },
        { n: home.todos.scheduled_today, label: "posts scheduled today", href: "/studio/planner" },
        { n: home.todos.failed_posts, label: "posts failed to publish", href: "/studio/planner" },
      ].filter((t) => t.n > 0)
    : [];

  return (
    <>
      {todos.length > 0 ? (
        <Panel title="Needs you">
          <div className="flex flex-col gap-2">
            {todos.map((t) => (
              <Link
                key={t.label}
                href={t.href}
                className="-mx-2 flex items-baseline gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-[140ms] hover:bg-surface"
              >
                <span className="font-display text-[17px] leading-none text-pearl-muted">{t.n}</span>
                <span className="min-w-0 flex-1 text-[13px] text-ink/70">{t.label}</span>
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="Quick actions">
        <div className="flex flex-col">
          {ACTIONS.map((a) => (
            <Link
              key={a.label}
              href={a.href}
              className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-[13.5px] text-ink transition-colors duration-[140ms] hover:bg-surface"
            >
              <a.icon size={15} className="shrink-0 text-ink/45" />
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
            </Link>
          ))}
        </div>
      </Panel>

      {reviews ? (
        <Panel title="Reviews" action="View all" actionHref="/studio/reviews">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[26px] leading-none text-porcelain">{reviews.avg.toFixed(1)}</span>
            <span className="flex items-center gap-1 text-[12.5px] text-ink/45">
              <Star size={12} className="text-pearl" /> from {reviews.n} {reviews.n === 1 ? "review" : "reviews"}
            </span>
          </div>
        </Panel>
      ) : null}

      <Panel title="This workspace">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-ink/55">Your role</span>
          <span className="font-semibold capitalize text-ink">{role ?? "member"}</span>
        </div>
        {username ? (
          <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
            <span className="shrink-0 text-ink/55">Public page</span>
            <Link href={"/" + username} className="min-w-0 truncate text-pearl transition-opacity duration-[140ms] hover:opacity-70">
              @{username}
            </Link>
          </div>
        ) : null}
      </Panel>
    </>
  );
}
