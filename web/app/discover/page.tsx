"use client";

import { profilePath } from "@/lib/profileLookup";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { DiscoverFeed } from "@/components/DiscoverFeed";
import { PageHeader, Panel } from "@/components/ui";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { ErrorState } from "@/components/ErrorState";
import { getTierColor } from "@/lib/tier";
import { createClient } from "@/lib/supabase/client";
import { ExploreTopics, FeaturedChannels, TopArticles } from "@/components/DiscoverSections";

type Creator = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  headline: string | null;
  connections_count: number | null;
  is_verified: boolean | null;
  verified_tier: string | null;
};

/** People worth following, ranked by reach. Their own row, not a rail panel,
 *  because on Discover finding people is the point rather than a footnote. */
function TrendingCreators() {
  const [supabase] = useState(createClient);
  const [people, setPeople] = useState<Creator[]>([]);

  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    supabase.rpc("get_trending_creators", { p_limit: 10 }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setFailed(true);
      else setPeople((data ?? []) as Creator[]);
      setLoading(false);
    }, () => { if (alive) { setFailed(true); setLoading(false); } });
    return () => { alive = false; };
  }, [supabase, retry]);

  if (failed) return <ErrorState title="Could not load trending creators" onRetry={() => {setLoading(true);setFailed(false);setRetry((n) => n + 1);}} />;
  if (loading) return <p className="py-4 text-sm text-muted">Loading creators…</p>;
  if (people.length === 0) return null;

  return (
    <div className="mt-4">
      <Panel title="Trending creators" action="View all" actionHref="/search">
        <div className="flex gap-3 overflow-x-auto pb-1">
          {people.map((p) => (
            <div key={p.id} className="flex w-[152px] shrink-0 flex-col items-center rounded-xl border border-ink/10 px-3 py-3.5 text-center">
              <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={54} href={profilePath(p.username, p.id)} />
              <Link href={profilePath(p.username, p.id)} className="mt-2 flex max-w-full items-center gap-[3px]">
                <span
                  className="truncate text-[13.5px] font-semibold text-ink"
                  style={p.is_verified ? { color: getTierColor(p.verified_tier) ?? undefined } : undefined}
                >
                  {p.full_name}
                </span>
                {p.is_verified ? <VerifiedBadge tier={p.verified_tier} size={12} /> : null}
              </Link>
              <span className="mt-0.5 line-clamp-1 text-[11.5px] text-muted">{p.headline || (p.username ? "@" + p.username : "Member")}</span>
              {p.connections_count ? (
                <span className="mt-0.5 text-[11px] text-muted">{p.connections_count.toLocaleString()} connections</span>
              ) : null}
              <span className="mt-2.5">
                <FollowButton authorId={p.id} />
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export default function DiscoverPage() {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <div>
      <PageHeader title="Discover" subtitle="Explore ideas, people and opportunities that move the world forward." />

      <form
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push("/search?q=" + encodeURIComponent(q.trim())); }}
        className="mb-4 flex items-center gap-2.5 rounded-2xl border border-ink/10 bg-white px-4 py-3"
      >
        <Search size={17} className="shrink-0 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people, topics, channels, articles and more"
          aria-label="Search Discover"
          className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-muted"
        />
      </form>

      <TrendingCreators />
      <FeaturedChannels />
      <ExploreTopics />
      <TopArticles />
      <div className="mt-4">
        <DiscoverFeed />
      </div>
    </div>
  );
}
