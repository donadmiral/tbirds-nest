"use client";

/**
 * Discover.
 *
 * Categories are exact. A post appears under Comedy because its author filed
 * it under Comedy in the composer, never because the text contained "lol".
 * The keyword guessing that used to live here is gone; it put finance posts
 * under Comedy and confused everyone.
 *
 * For you is the ranked feed. Videos is every video post, laid out as a grid
 * with its caption, the way a video surface should be.
 */
import { useEffect, useRef, useState } from "react";
import { useSocialPages } from "@/lib/useSocialPages";
import { SocialPageFooter } from "@/components/SocialPageFooter";
import type { FeedRow } from "@/lib/feed";
import { CATEGORIES } from "@/lib/categories";
import { DiscoverViewer } from "@/components/DiscoverViewer";
import { DiscoverTile } from "@/components/DiscoverTile";
import { EmptyState } from "@/components/ui";
import { ErrorState } from "@/components/ErrorState";

type Chip = { key: string; label: string };
const CHIPS: Chip[] = [
  { key: "for_you", label: "All" },
  { key: "videos", label: "Videos" },
  ...CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
];

export function DiscoverFeed() {
  const [chip, setChip] = useState("for_you");
  const [viewing,setViewing]=useState<string|null>(null);
  const sentinel=useRef<HTMLDivElement>(null);
  const page = useSocialPages<FeedRow>("get_discover_page", {
    p_category: chip === "for_you" || chip === "videos" ? null : chip,
    p_video: chip === "videos",
  }, { key: "post_id", size: 24 });
  const { items: rows, loading, error: failed } = page;
  const hidePost = (id: string) => page.setItems((cur) => cur.filter((r) => r.post_id !== id));
  useEffect(()=>{
    const node=sentinel.current;if(!node||!page.hasMore||page.loading||page.error)return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void page.loadMore();},{rootMargin:'700px'});
    observer.observe(node);return()=>observer.disconnect();
  },[page.hasMore,page.loading,page.error,page.loadMore,rows.length]);
  const active = CHIPS.find((c) => c.key === chip) ?? CHIPS[0];
  const heroIdx = chip === "videos" ? -1 : rows.findIndex((r) => (r.media ?? []).length > 0);
  const hero = heroIdx >= 0 ? rows[heroIdx] : null;
  const rest = hero ? rows.filter((_, i) => i !== heroIdx) : rows;

  return (
    <div>
      <div className="sticky top-[72px] z-10 flex gap-1.5 overflow-x-auto overflow-y-hidden rounded-2xl border border-ink/10 bg-white/95 px-3 py-2.5 backdrop-blur">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            aria-pressed={c.key === chip}
            onClick={() => {setViewing(null);setChip(c.key);}}
            className={"shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (c.key === chip ? "bg-pearl text-on-pearl" : "text-muted hover:bg-surface hover:text-ink")}
          >
            {c.label}
          </button>
        ))}
      </div>

      {failed && rows.length === 0 ? (
        <div className="mt-4"><ErrorState title="Could not load Discover" onRetry={() => void page.loadMore()} /></div>
      ) : loading && rows.length === 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-4 animate-pulse" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="aspect-square rounded-2xl border border-ink/10 bg-white" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={chip === "videos" ? "No videos yet" : "Nothing in " + active.label + " yet"}
            line={chip === "for_you" || chip === "videos" ? "Follow a few people and this fills up." : "Posts filed under " + active.label + " in the composer appear here."}
            action="Write a post"
            actionHref="/write"
          />
        </div>
      ) : (
        <>
          {hero ? <div className="mt-4"><DiscoverTile post={hero} onHide={hidePost} onOpen={setViewing} /></div> : null}
          {/* Videos sit three across, square, like every video surface people
              already know. Everything else is two across so text has room. */}
          <div className={"mt-4 grid gap-4 " + (chip === "videos" ? "grid-cols-3" : "grid-cols-2")}>
            {rest.map((r) => <DiscoverTile key={r.post_id} post={r} onHide={hidePost} onOpen={setViewing} />)}
          </div>
          <div ref={sentinel} aria-hidden="true"/>
          <SocialPageFooter {...page} />
        </>
      )}
      {viewing?<DiscoverViewer posts={rows} initialId={viewing} hasMore={page.hasMore} loading={page.loading} error={page.error} loadMore={page.loadMore} onClose={()=>setViewing(null)}/>:null}
    </div>
  );
}
