"use client";

/**
 * The three browse rows Discover was missing: channels worth joining, topics
 * worth opening, and articles worth reading.
 *
 * Each one loads independently and hides itself when it has nothing, so a
 * young account sees a short honest page rather than three empty headings.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Hash, Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Panel } from "@/components/ui";
import { displayImageUrl } from "@/lib/media";
import type { FeedRow } from "@/lib/feed";

type Ch = { id: string; name: string; description: string | null; icon_url: string | null; member_count: number; is_member: boolean };
type Topic = { topic: string; post_count: number };

export function FeaturedChannels() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Ch[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("get_channels", { p_query: null, p_limit: 12 });
      setRows(((data ?? []) as Ch[]).slice(0, 8));
    })();
  }, [supabase]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4">
      <Panel title="Featured channels" icon={<Radio size={15} />} action="View all" actionHref="/channels">
        <div className="flex gap-3 overflow-x-auto pb-1">
          {rows.map((c) => (
            <Link
              key={c.id}
              href={"/channels/" + c.id}
              className="flex w-[168px] shrink-0 flex-col rounded-xl border border-ink/10 px-3.5 py-3.5 transition-colors duration-[140ms] hover:border-ink/20"
            >
              {c.icon_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayImageUrl(c.icon_url, 96) ?? c.icon_url} alt="" loading="lazy" decoding="async" className="h-10 w-10 rounded-xl object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pearl/15 text-pearl">
                  <Radio size={17} />
                </span>
              )}
              <span className="mt-2.5 truncate text-[13.5px] font-semibold text-ink">{c.name}</span>
              <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink/45">
                {c.description || (c.member_count.toLocaleString() + (c.member_count === 1 ? " member" : " members"))}
              </span>
              <span className={"mt-2.5 rounded-full py-1.5 text-center text-[12px] font-semibold " + (c.is_member ? "text-ink/40" : "bg-pearl/15 text-pearl-muted")}>
                {c.is_member ? "Joined" : "Join"}
              </span>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function ExploreTopics() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Topic[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("get_trending_topics", { p_days: 30, p_limit: 14 });
      setRows((data ?? []) as Topic[]);
    })();
  }, [supabase]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4">
      <Panel title="Explore by topic" icon={<Hash size={15} />}>
        <div className="flex flex-wrap gap-2">
          {rows.map((t) => {
            const tag = t.topic.startsWith("#") ? t.topic.slice(1) : t.topic;
            return (
              <Link
                key={t.topic}
                href={"/topic/" + encodeURIComponent(tag)}
                className="flex items-baseline gap-2 rounded-full border border-ink/10 px-3.5 py-2 transition-colors duration-[140ms] hover:bg-surface"
              >
                <span className="text-[13px] font-semibold text-ink">#{tag}</span>
                <span className="text-[11.5px] text-ink/40">{t.post_count.toLocaleString()}</span>
              </Link>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/** Long-form deserves its own row: an article buried in a grid of photos never
 *  gets read, because it cannot compete on thumbnail. */
export function TopArticles() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<FeedRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("get_feed", { p_mode: "trending", p_limit: 60 });
      const articles = ((data ?? []) as FeedRow[]).filter((r) => !!r.article_title).slice(0, 6);
      setRows(articles);
    })();
  }, [supabase]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4">
      <Panel title="Top articles" action="View all" actionHref="/search?q=article">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((a) => {
            const cover = (a.media ?? [])[0]?.url ?? null;
            const minutes = (a as unknown as { read_minutes?: number | null }).read_minutes ?? null;
            return (
              <Link
                key={a.post_id}
                href={"/post/" + a.post_id}
                className="flex gap-3 rounded-xl border border-ink/10 p-3 transition-colors duration-[140ms] hover:border-ink/20"
              >
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(cover, 200) ?? cover} alt="" loading="lazy" decoding="async" className="h-[76px] w-[76px] shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="h-[76px] w-[76px] shrink-0 rounded-lg bg-surface" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block font-display text-[15px] leading-snug text-porcelain">{a.article_title}</span>
                  <span className="mt-1 line-clamp-2 block text-[12px] leading-snug text-ink/45">{a.content ?? a.body ?? ""}</span>
                  <span className="mt-1.5 block truncate text-[11.5px] text-ink/35">
                    {a.author_name}
                    {minutes ? " · " + minutes + " min read" : ""}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
