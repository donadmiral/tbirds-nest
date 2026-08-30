"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { DiscoverFeed } from "@/components/DiscoverFeed";
import { PageHeader, Panel } from "@/components/ui";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { VerifiedBadge, getTierColor } from "@/components/VerifiedBadge";
import { createClient } from "@/lib/supabase/client";

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
  const supabase = useRef(createClient()).current;
  const [people, setPeople] = useState<Creator[]>([]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      let q = supabase
        .from("profiles")
        .select("id, full_name, username, avatar_url, headline, connections_count, is_verified, verified_tier")
        .is("deactivated_at", null)
        .order("connections_count", { ascending: false, nullsFirst: false })
        .limit(10);
      if (uid) q = q.neq("id", uid);
      const { data } = await q;
      setPeople((data ?? []) as Creator[]);
    })();
  }, [supabase]);

  if (people.length === 0) return null;

  return (
    <div className="mt-4">
      <Panel title="Trending creators" action="View all" actionHref="/search">
        <div className="flex gap-3 overflow-x-auto pb-1">
          {people.map((p) => (
            <div key={p.id} className="flex w-[152px] shrink-0 flex-col items-center rounded-xl border border-ink/10 px-3 py-3.5 text-center">
              <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={54} href={p.username ? "/" + p.username : null} />
              <Link href={p.username ? "/" + p.username : "#"} className="mt-2 flex max-w-full items-center gap-[3px]">
                <span
                  className="truncate text-[13.5px] font-semibold text-ink"
                  style={p.is_verified ? { color: getTierColor(p.verified_tier) ?? undefined } : undefined}
                >
                  {p.full_name}
                </span>
                {p.is_verified ? <VerifiedBadge tier={p.verified_tier} size={12} /> : null}
              </Link>
              <span className="mt-0.5 line-clamp-1 text-[11.5px] text-ink/45">{p.headline || "@" + (p.username ?? "")}</span>
              {p.connections_count ? (
                <span className="mt-0.5 text-[11px] text-ink/35">{p.connections_count.toLocaleString()} connections</span>
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
        <Search size={17} className="shrink-0 text-ink/35" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people, topics, channels, articles and more"
          className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink/35"
        />
      </form>

      <TrendingCreators />
      <DiscoverFeed />
    </div>
  );
}
