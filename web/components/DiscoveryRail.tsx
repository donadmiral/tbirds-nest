"use client";

import { profilePath } from "@/lib/profileLookup";
import { PersonName } from "@/components/PersonName";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Flame, UserPlus } from "lucide-react";
import { Panel, RankRow } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { useViewerIdentity } from "@/lib/useViewerIdentity";
import { withTimeout } from "@/lib/withTimeout";

type Topic = { topic: string; post_count: number };
type Suggestion = { id: string; full_name: string | null; username: string | null; avatar_url: string | null; headline: string | null; is_verified?: boolean };

export function DiscoveryRail() {
  const supabase = useRef(createClient()).current;
  const { viewer, loading, error: identityError, retry: retryIdentity } = useViewerIdentity();
  const uid = viewer?.id ?? null;
  const [result, setResult] = useState<{ owner: string | null; topics: Topic[]; people: Suggestion[] } | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let active = true;
    setResult(null); setError(''); setShowAll(false);
    if (loading || identityError) return;
    void (async () => {
      const [trending, suggestions, following] = await withTimeout(Promise.all([
        supabase.rpc("get_trending_topics", { p_days: 7, p_limit: 15 }),
        uid ? supabase.from("profiles").select("id, full_name, username, avatar_url, headline, connections_count, is_verified").neq("id", uid).is("deactivated_at", null).order("connections_count", { ascending: false, nullsFirst: false }).limit(15) : Promise.resolve({ data: [], error: null }),
        uid ? supabase.from("follows").select("following_id").eq("follower_id", uid) : Promise.resolve({ data: [], error: null }),
      ]));
      if (trending.error || suggestions.error || following.error) throw new Error('Discovery unavailable');
      const followed = new Set((following.data ?? []).map((row: { following_id: string }) => row.following_id));
      if (active) setResult({ owner: uid, topics: ((trending.data ?? []) as Topic[]).slice(0, 5), people: ((suggestions.data ?? []) as Suggestion[]).filter(person => !followed.has(person.id)).slice(0, 8) });
    })().catch(() => { if (active) setError('Suggestions could not load. Please try again.'); });
    return () => { active = false; };
  }, [supabase, uid, loading, identityError, attempt]);
  if (identityError || error) return <Panel title="Discover your circles"><p className="text-sm text-muted" role="status">{identityError || error}</p><button type="button" className="mt-2 min-h-11 text-sm font-semibold text-ink" onClick={() => { if (identityError) retryIdentity(); else setAttempt(value => value + 1); }}>Try again</button></Panel>;
  const topics = result?.owner === uid ? result?.topics ?? [] : [], people = result?.owner === uid ? result?.people ?? [] : [];

  return (
    <>
      {topics.length > 0 ? (
        <Panel title="Trending in your circles" icon={<Flame size={15} />} action="View all" actionHref="/discover">
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
        <Panel title="People to follow" icon={<UserPlus size={15} />} action="Find people" actionHref="/search">
          <div className="flex flex-col gap-3">
            {(showAll ? people : people.slice(0, 4)).map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={40} href={profilePath(p.username, p.id)} />
                <Link href={profilePath(p.username, p.id)} className="min-w-0 flex-1">
                  <PersonName name={p.full_name ?? ""} userId={p.id} className="text-[14px] font-semibold leading-tight text-ink" badgeSize={13} />
                  <span className="mt-0.5 block truncate text-[12px] leading-tight text-muted">
                    {p.headline || (p.username ? "@" + p.username : "Member")}
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
