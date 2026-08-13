"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TrendingUp } from "lucide-react";
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
      setTopics(((t ?? []) as Topic[]).slice(0, 6));
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
    <aside className="sticky top-4 flex w-full flex-col gap-4">
      {topics.length > 0 ? (
        <section className="rounded-xl border border-white/10 p-4">
          <h2 className="flex items-center gap-1.5 pb-2 text-[14px] font-semibold text-white">
            <TrendingUp size={15} className="text-pearl" /> Hot topics
          </h2>
          {topics.map((t) => (
            <Link key={t.topic}
              href={"/topic/" + encodeURIComponent(t.topic.replace(/^#/, ""))}
              className="block rounded-md px-2 py-2 transition-colors hover:bg-surface"
            >
              <span className="block text-[14px] font-semibold text-white">{t.topic.startsWith("#") ? t.topic : "#" + t.topic}</span>
              <span className="block text-[12px] text-white/40">{t.post_count} {t.post_count === 1 ? "post" : "posts"}</span>
            </Link>
          ))}
        </section>
      ) : null}

      {people.length > 0 ? (
        <section className="rounded-xl border border-white/10 p-4">
          <h2 className="pb-2 text-[14px] font-semibold text-white">Who to follow</h2>
          {people.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 py-2">
              <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={38} href={p.username ? "/" + p.username : null} />
              <Link href={p.username ? "/" + p.username : "#"} className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[13px] font-semibold text-white">
                  <span className="truncate">{p.full_name}</span>
                  {p.is_verified ? <VerifiedBadge size={13} /> : null}
                </span>
                <span className="block truncate text-[12px] text-white/45">{p.headline || "@" + (p.username ?? "")}</span>
              </Link>
              <FollowButton authorId={p.id} />
            </div>
          ))}
        </section>
      ) : null}
    </aside>
  );
}