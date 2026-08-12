"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Heart, MessageCircle, Repeat2, Bookmark } from "lucide-react";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import type { FeedRow } from "@/lib/feed";
import { timeAgo } from "@/lib/feed";
import { toggleLike, toggleBookmark, toggleRepost } from "@/lib/interactions";

function count(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return n > 0 ? String(n) : "";
}

function useToggle(initialOn: boolean, initialCount: number, action: (id: string, on: boolean) => Promise<boolean>, postId: string) {
  const [on, setOn] = useState(initialOn);
  const [n, setN] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  async function flip(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const next = !on;
    setOn(next);
    setN((v) => Math.max(0, v + (next ? 1 : -1)));
    const ok = await action(postId, next);
    if (!ok) {
      setOn(!next);
      setN((v) => Math.max(0, v + (next ? -1 : 1)));
    }
    setBusy(false);
  }
  return { on, n, flip };
}

export function PostCard({ post }: { post: FeedRow }) {
  const router = useRouter();
  const text = post.content ?? post.body ?? "";
  const media = post.media ?? [];
  const products = post.products ?? [];
  const like = useToggle(post.viewer_liked, post.likes_count, toggleLike, post.post_id);
  const repost = useToggle(post.viewer_reposted, post.reposts_count, toggleRepost, post.post_id);
  const mark = useToggle(post.viewer_bookmarked, post.bookmarks_count, toggleBookmark, post.post_id);
  const profileHref = post.author_username ? "/" + post.author_username : "#";
  const postHref = "/post/" + post.post_id;

  return (
    <article className="border-b border-white/10 px-1 py-5">
      <div className="flex gap-3">
        <Link href={profileHref} className="shrink-0">
          {post.author_avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.author_avatar} alt="" className="h-11 w-11 rounded-full object-cover" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-sm font-semibold text-porcelain">
              {(post.author_name ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={profileHref} className="flex min-w-0 items-center gap-1.5 hover:underline">
              <span className="truncate text-[15px] font-semibold text-white">{post.author_name}</span>
              {post.author_verified ? <VerifiedBadge tier={post.author_verified_tier} size={15} /> : null}
              <span className="truncate text-[13px] text-white/50">@{post.author_username}</span>
            </Link>
            <span className="text-[13px] text-white/30">·</span>
            <Link href={postHref} className="shrink-0 text-[13px] text-white/50 hover:underline">
              {timeAgo(post.created_at)}
            </Link>
          </div>

          {post.article_title ? (
            <h3 className="mt-1 font-display text-lg text-porcelain">{post.article_title}</h3>
          ) : null}

          {text ? (
            <p onClick={() => router.push(postHref)}
              className="mt-1 cursor-pointer whitespace-pre-wrap text-[15px] leading-relaxed text-white/90"
            >
              {text}
            </p>
          ) : null}

          {media.length > 0 ? (
            <div className={`mt-3 grid gap-1 overflow-hidden rounded-lg ${media.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {media.slice(0, 4).map((m) =>
                m.media_type === "video" ? (
                  <video key={m.id} src={m.url} controls preload="metadata" className="max-h-[480px] w-full bg-black object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={m.id} src={m.url} alt="" loading="lazy" className="max-h-[480px] w-full bg-surface object-cover" />
                )
              )}
            </div>
          ) : null}

          {post.link && media.length === 0 ? (
            <a href={post.link.url} target="_blank" rel="noopener noreferrer"
              className="mt-3 block overflow-hidden rounded-lg border border-white/10 transition-colors hover:bg-surface"
            >
              {post.link.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.link.image_url} alt="" loading="lazy" className="max-h-60 w-full object-cover" />
              ) : null}
              <span className="block px-3 py-2">
                <span className="block text-[11px] uppercase tracking-wide text-white/40">{post.link.domain}</span>
                <span className="block truncate text-[14px] text-white/90">{post.link.title ?? post.link.url}</span>
              </span>
            </a>
          ) : null}

          {products.length > 0 ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {products.map((p) => (
                <div key={p.id} className="relative w-52 shrink-0 overflow-hidden rounded-lg border border-white/10">
                  {p.listing_status && p.listing_status !== "available" ? (
                    <span className="absolute inset-0 z-10 flex items-center justify-center bg-ink/60 text-[12px] font-bold uppercase tracking-widest text-white">{p.listing_status === "sold" ? "Sold" : "Unavailable"}</span>
                  ) : null}
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" loading="lazy" className="h-28 w-full bg-surface object-cover" />
                  ) : null}
                  <div className="px-3 py-2">
                    <p className="truncate text-[13px] font-medium text-white">{p.title}</p>
                    {p.price != null ? <p className="text-[13px] text-pearl">{p.currency ?? ""} {p.price}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-7">
            <Link href={postHref} className="flex items-center gap-1.5 text-[13px] text-white/50 transition-colors hover:text-white">
              <MessageCircle size={17} strokeWidth={1.8} />
              {count(post.comments_count)}
            </Link>
            <button onClick={repost.flip} className={`flex items-center gap-1.5 text-[13px] transition-colors ${repost.on ? "text-success" : "text-white/50 hover:text-success"}`}>
              <Repeat2 size={17} strokeWidth={1.8} />
              {count(repost.n)}
            </button>
            <button onClick={like.flip} className={`flex items-center gap-1.5 text-[13px] transition-colors ${like.on ? "text-danger" : "text-white/50 hover:text-danger"}`}>
              <Heart size={17} strokeWidth={1.8} fill={like.on ? "currentColor" : "none"} />
              {count(like.n)}
            </button>
            <button onClick={mark.flip} className={`flex items-center gap-1.5 text-[13px] transition-colors ${mark.on ? "text-pearl" : "text-white/50 hover:text-pearl"}`}>
              <Bookmark size={17} strokeWidth={1.8} fill={mark.on ? "currentColor" : "none"} />
              {count(mark.n)}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}