"use client";

/**
 * A Discover tile.
 *
 * Discover used to render the same PostCard as the feed, so browsing meant
 * scrolling one full-width post at a time. A discovery surface wants density:
 * many things visible at once, media leading, text only where it is the point.
 *
 * One tile handles all four kinds a post can be, because the alternative is
 * four components that drift apart. Photo and video lead with the frame, an
 * article leads with its title, and a text post becomes a quote card so a
 * grid of them still has rhythm.
 */
import Link from "next/link";
import { Play, FileText, Link2 } from "lucide-react";
import type { FeedRow } from "@/lib/feed";
import { displayImageUrl } from "@/lib/media";
import { VerifiedBadge, getTierColor } from "@/components/VerifiedBadge";

export function DiscoverTile({ post }: { post: FeedRow }) {
  const href = "/post/" + post.post_id;
  const media = (post.media ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const first = media[0] ?? null;
  const isVideo = first?.media_type === "video";
  const text = post.content ?? post.body ?? "";
  const verified = (post as unknown as { author_verified?: boolean }).author_verified;
  const tier = (post as unknown as { author_verified_tier?: string | null }).author_verified_tier;
  const link = (post as unknown as { link?: { url: string; domain: string | null; title: string | null; image_url: string | null } | null }).link;

  const byline = (
    <span className="flex min-w-0 items-center gap-2 px-3 pb-3 pt-2.5">
      {post.author_avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.author_avatar} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="h-6 w-6 shrink-0 rounded-full bg-surface" />
      )}
      <span className="flex min-w-0 items-center gap-[3px]">
        <span
          className="truncate text-[12.5px] font-semibold text-ink"
          style={verified ? { color: getTierColor(tier) ?? undefined } : undefined}
        >
          {post.author_name}
        </span>
        {verified ? <VerifiedBadge tier={tier} size={12} /> : null}
      </span>
    </span>
  );

  // Media leads. The frame is the reason to click, so it gets the whole tile
  // and the caption only appears if there is room for one line of it.
  if (first) {
    return (
      <Link
        href={href}
        className="group flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white transition-colors duration-[140ms] hover:border-ink/20"
      >
        <span className="relative block aspect-square w-full overflow-hidden bg-surface">
          {isVideo ? (
            <>
              <video src={first.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
                <Play size={13} fill="currentColor" />
              </span>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayImageUrl(first.url, 640) ?? first.url}
              onError={(e) => { if (e.currentTarget.src !== first.url) e.currentTarget.src = first.url; }}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-[220ms] group-hover:scale-[1.03]"
            />
          )}
          {media.length > 1 ? (
            <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-semibold text-white">
              1/{media.length}
            </span>
          ) : null}
        </span>
        {text ? <span className="line-clamp-2 px-3 pt-2.5 text-[13px] leading-snug text-ink/80">{text}</span> : null}
        {byline}
      </Link>
    );
  }

  // An article's title is its thumbnail.
  if (post.article_title) {
    return (
      <Link
        href={href}
        className="flex flex-col justify-between overflow-hidden rounded-2xl border border-ink/10 bg-white transition-colors duration-[140ms] hover:border-ink/20"
      >
        <span className="block px-4 pt-4">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-pearl-muted">
            <FileText size={12} /> Article
          </span>
          <span className="mt-2 block font-display text-[19px] leading-snug text-porcelain">{post.article_title}</span>
          {text ? <span className="mt-1.5 line-clamp-3 block text-[13px] leading-snug text-ink/55">{text}</span> : null}
        </span>
        {byline}
      </Link>
    );
  }

  // A shared link keeps its preview, which is usually more useful than the
  // sentence wrapped around it.
  if (link?.image_url) {
    return (
      <Link href={href} className="flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white transition-colors duration-[140ms] hover:border-ink/20">
        <span className="relative block aspect-[16/10] w-full overflow-hidden bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={displayImageUrl(link.image_url, 640) ?? link.image_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        </span>
        <span className="block px-3.5 pt-3">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink/40">
            <Link2 size={11} /> {link.domain}
          </span>
          <span className="mt-1 line-clamp-2 block text-[13.5px] font-medium leading-snug text-ink">{link.title ?? text}</span>
        </span>
        {byline}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="flex flex-col justify-between overflow-hidden rounded-2xl border border-ink/10 bg-white transition-colors duration-[140ms] hover:border-ink/20"
    >
      <span className="block px-4 pt-4">
        <span className="line-clamp-6 block text-[15px] leading-relaxed text-ink/90">{text}</span>
      </span>
      {byline}
    </Link>
  );
}
