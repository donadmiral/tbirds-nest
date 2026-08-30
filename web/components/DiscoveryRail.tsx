"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Flame, UserPlus } from "lucide-react";
import { Panel, RankRow } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { VerifiedBadge } from "@/components/VerifiedBadge";

type Topic = { topic: string; post_count: number };
type Suggestion = { id: string; full_name: string | null; username: string | null; avatar_url: string | null; headline: string | null; is_verified?: boolean };

export function DiscoveryRail() {
  const supabase = useRef(createClient()).current;
  const [topics, setTopics] = useState<Topic[]>([]);
  const [people, setPeople] = useState<Suggestion[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      const [{ data: t }, sug] = await Promise.all([
        supabase.rpc("get_trending_topics", { p_days: 7, p_limit: 15 }),
        uid
          ? supabase
              .from("profiles")
              .select("id, full_name, username, avatar_url, headline, connections_count, is_verified")
              .neq("id", uid)
              .is("deactivated_at", null)
              .order("connections_count", { ascending: false, nullsFirst: false })
              .limit(15)
          : Promise.resolve({ data: [] as Suggestion[] }),
      ]);
      setTopics(((t ?? []) as Topic[]).slice(0, 5));
      let candidates = ((sug.data ?? []) as Suggestion[]);
      if (uid && candidates.length > 0) {
        const { data: fRows } = await supabase.from("follows").select("following_id").eq("follower_id", uid);
        const followed = new Set((fRows ?? []).map((r) => r.following_id as string));
        candidates = candidates.filter((c) => !followed.has(c.id));
      }
      setPeople(candidates.slice(0, 8));
    })();
  }, [supabase]);

  return (
    <>
      {topics.length > 0 ? (
        <Panel title="Trending now" icon={<Flame size={15} />} action="View all" actionHref="/discover">
          <div className="flex flex-col gap-0.5">
            {topics.map((t, i) => {
              const tag = t.topic.startsWith("#") ? t.topic : "#" + t.topic;
              return (
                <RankRow
                  key={t.topic}
                  rank={i + 1}
                  label={tag}
                  meta={t.post_count.toLocaleString() + (t.post_count === 1 ? " post" : " posts")}
                  href={"/topic/" + encodeURIComponent(tag.slice(1))}
                />
              );
            })}
          </div>
        </Panel>
      ) : null}

      {people.length > 0 ? (
        <Panel title="Suggested for you" icon={<UserPlus size={15} />} action={people.length > 4 ? (showAll ? "Show less" : "View all") : undefined} actionHref={people.length > 4 ? "#" : undefined}>
          <div className="flex flex-col gap-3">
            {(showAll ? people : people.slice(0, 4)).map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={40} href={p.username ? "/" + p.username : null} />
                <Link href={p.username ? "/" + p.username : "#"} className="min-w-0 flex-1">
                  <span className="flex items-center gap-[3px] text-[14px] font-semibold leading-tight text-ink">
                    <span className="truncate">{p.full_name}</span>
                    {p.is_verified ? <VerifiedBadge size={13} /> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] leading-tight text-ink/45">
                    {p.headline || "@" + (p.username ?? "")}
                  </span>
                </Link>
                <FollowButton authorId={p.id} />
              </div>
            ))}
          </div>
          {people.length > 4 ? (
            <button onClick={() => setShowAll((v) => !v)} className="mt-3 w-full rounded-full border border-ink/10 py-2 text-[12.5px] font-semibold text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">
              {showAll ? "Show less" : "Show more"}
            </button>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}