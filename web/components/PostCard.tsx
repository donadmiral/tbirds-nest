
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Heart, MessageCircle, Repeat2, Bookmark } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { PostMenu } from "@/components/PostMenu";
import { RichText } from "@/components/RichText";
import { MediaGallery } from "@/components/MediaGallery";
import { LikesModal } from "@/components/LikesModal";
import { ShareMenu } from "@/components/ShareMenu";
import { displayImageUrl } from "@/lib/media";
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
  async function set(next: boolean) {
    if (busy || next === on) return;
    setBusy(true);
    setOn(next);
    setN((v) => Math.max(0, v + (next ? 1 : -1)));
    const ok = await action(postId, next);
    if (!ok) {
      setOn(!next);
      setN((v) => Math.max(0, v + (next ? -1 : 1)));
    }
    setBusy(false);
  }
  async function flip(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    set(!on);
  }
  return { on, n, flip, set };
}

function QuoteCard({ quotedId }: { quotedId: string }) {
  const supabase = useRef(createClient()).current;
  const [q, setQ] = useState<{ content: string | null; body: string | null; created_at: string; author: { full_name: string | null; username: string | null } | null; first: { url: string; media_type: string } | null } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("posts")
        .select("content, body, created_at, user_id, post_media(url, media_type, sort_order)")
        .eq("id", quotedId)
        .maybeSingle();
      if (!data) return;
      const { data: a } = await supabase.from("profiles").select("full_name, username").eq("id", data.user_id).maybeSingle();
      const media = (data.post_media ?? []).slice().sort((x: { sort_order: number }, y: { sort_order: number }) => x.sort_order - y.sort_order);
      setQ({ content: data.content, body: data.body, created_at: data.created_at, author: a ?? null, first: media[0] ?? null });
    })();
  }, [supabase, quotedId]);

  if (!q) return null;
  return (
    <Link href={"/post/" + quotedId} onClick={(e) => e.stopPropagation()} className="mt-3 flex gap-3 rounded-lg border border-white/10 p-3 transition-colors hover:bg-surface">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px]">
          <span className="truncate font-semibold text-white">{q.author?.full_name ?? "Member"}</span>
          <span className="truncate text-white/50">@{q.author?.username}</span>
          <span className="shrink-0 text-white/40">· {timeAgo(q.created_at)}</span>
        </span>
        <span className="mt-0.5 line-clamp-3 block text-[13px] text-white/75">{q.content ?? q.body ?? ""}</span>
      </span>
      {q.first && q.first.media_type === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={displayImageUrl(q.first.url)!} onError={(e) => { if (q.first && e.currentTarget.src !== q.first.url) e.currentTarget.src = q.first.url; }} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
      ) : null}
      {q.first && q.first.media_type === "video" ? (
        <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-black"><video src={q.first.url} preload="metadata" muted playsInline className="h-full w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center text-white"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg></span></span>
      ) : null}
    </Link>
  );
}

export function PostCard({ post }: { post: FeedRow }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [heart, setHeart] = useState(false);
  const [repostMenu, setRepostMenu] = useState(false);
  const [likesOpen, setLikesOpen] = useState(false);
  const text = post.content ?? post.body ?? "";
  const media = post.media ?? [];
  const products = post.products ?? [];
  const like = useToggle(post.viewer_liked, post.likes_count, toggleLike, post.post_id);
  const repost = useToggle(post.viewer_reposted, post.reposts_count, toggleRepost, post.post_id);
  const mark = useToggle(post.viewer_bookmarked, post.bookmarks_count, toggleBookmark, post.post_id);
  const profileHref = post.author_username ? "/" + post.author_username : "#";
  const postHref = "/post/" + post.post_id;
  const quotedId = (post as unknown as { quoted_post_id?: string | null }).quoted_post_id ?? null;

  if (hidden) return null;

  function doubleLike(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!like.on) like.set(true);
    setHeart(true);
    setTimeout(() => setHeart(false), 700);
  }

  return (
    <article className="relative border-b border-white/10 px-1 py-5">
      {likesOpen ? <LikesModal postId={post.post_id} onClose={() => setLikesOpen(false)} /> : null}
      {heart ? (
        <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Heart size={84} className="animate-ping text-danger" fill="currentColor" />
        </span>
      ) : null}
      <div className="flex gap-3">
        <StoryAvatar userId={post.author_id}
          name={post.author_name}
          avatarUrl={post.author_avatar}
          size={44}
          href={profileHref}
        />
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
            <FollowButton authorId={post.author_id} />
            <PostMenu postId={post.post_id} authorId={post.author_id} text={text} onHidden={() => setHidden(true)} />
          </div>

          {post.article_title ? (
            <h3 className="mt-1 font-display text-lg text-porcelain">{post.article_title}</h3>
          ) : null}

          {text ? (
            <p onClick={() => router.push(postHref)}
              onDoubleClick={doubleLike}
              className="mt-1 cursor-pointer whitespace-pre-wrap text-[15px] leading-relaxed text-white/90"
            >
              <RichText text={text} />
            </p>
          ) : null}

          {media.length > 0 ? (
            <MediaGallery media={media}
              postId={post.post_id}
              viewsCount={(post as unknown as { views_count?: number | null }).views_count ?? null}
              onDoubleClick={doubleLike}
            />
          ) : null}

          {quotedId ? <QuoteCard quotedId={quotedId} /> : null}

          {post.link && media.length === 0 ? (
            <a href={post.link.url} target="_blank" rel="noopener noreferrer"
              className="mt-3 block overflow-hidden rounded-lg border border-white/10 transition-colors hover:bg-surface"
            >
              {post.link.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayImageUrl(post.link.image_url)!} onError={(e) => { if (post.link?.image_url && e.currentTarget.src !== post.link.image_url) e.currentTarget.src = post.link.image_url; }} alt="" loading="lazy" className="max-h-60 w-full object-cover" />
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
                    <img src={displayImageUrl(p.image_url)!} onError={(e) => { if (p.image_url && e.currentTarget.src !== p.image_url) e.currentTarget.src = p.image_url; }} alt="" loading="lazy" className="h-28 w-full bg-surface object-cover" />
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
            <span className="relative">
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (repost.on) { repost.set(false); } else { setRepostMenu((v) => !v); } }} className={"flex items-center gap-1.5 text-[13px] transition-colors " + (repost.on ? "text-success" : "text-white/50 hover:text-success")}>
                <Repeat2 size={17} strokeWidth={1.8} />
                {count(repost.n)}
              </button>
              {repostMenu ? (
                <span className="absolute bottom-7 left-0 z-20 w-36 overflow-hidden rounded-lg border border-white/10 bg-navy shadow-2xl">
                  <button onClick={(e) => { e.stopPropagation(); setRepostMenu(false); repost.set(true); }} className="block w-full px-3.5 py-2.5 text-left text-[13px] text-white/85 hover:bg-surface-elevated">Repost</button>
                  <button onClick={(e) => { e.stopPropagation(); setRepostMenu(false); window.dispatchEvent(new CustomEvent("pc-quote-post", { detail: { id: post.post_id, author: post.author_name, text: text.slice(0, 140) } })); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="block w-full px-3.5 py-2.5 text-left text-[13px] text-white/85 hover:bg-surface-elevated">Quote</button>
                </span>
              ) : null}
            </span>
            <span className="flex items-center gap-1">
              <button onClick={like.flip} title={like.on ? "Unlike" : "Like"} className={"transition-colors " + (like.on ? "text-danger" : "text-white/50 hover:text-danger")}>
                <Heart size={17} strokeWidth={1.8} fill={like.on ? "currentColor" : "none"} />
              </button>
              {like.n > 0 ? (
                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLikesOpen(true); }} title="See who liked this" className={"text-[13px] transition-colors hover:underline " + (like.on ? "text-danger" : "text-white/50")}>
                  {count(like.n)}
                </button>
              ) : null}
            </span>
            <button onClick={mark.flip} className={"flex items-center gap-1.5 text-[13px] transition-colors " + (mark.on ? "text-pearl" : "text-white/50 hover:text-pearl")}>
              <Bookmark size={17} strokeWidth={1.8} fill={mark.on ? "currentColor" : "none"} />
              {count(mark.n)}
            </button>
            <ShareMenu postId={post.post_id} sharesCount={(post as unknown as { shares_count?: number }).shares_count ?? 0} />
          </div>
        </div>
      </div>
    </article>
  );
}