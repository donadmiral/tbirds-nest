
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bookmark, FileText, Heart, MessageCircle, Pin, Repeat2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge, getTierColor } from "@/components/VerifiedBadge";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";
import { PostMenu } from "@/components/PostMenu";
import { RichText } from "@/components/RichText";
import { PollCard } from "@/components/PollCard";
import { MediaGallery } from "@/components/MediaGallery";
import { ArticleBody } from "@/components/ArticleBody";
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
  const [q, setQ] = useState<{ content: string | null; body: string | null; created_at: string; author: { full_name: string | null; username: string | null } | null; first: { url: string; media_type: string; edit?: { coverUrl?: string | null } | null } | null } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("posts")
        .select("content, body, created_at, user_id, post_media(url, media_type, sort_order, edit)")
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
    <Link href={"/post/" + quotedId} onClick={(e) => e.stopPropagation()} className="mt-3 flex gap-3 rounded-xl border border-ink/10 p-3 transition-colors duration-[140ms] hover:bg-surface">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px]">
          <span className="truncate font-semibold text-ink">{q.author?.full_name ?? "Member"}</span>
          <span className="truncate text-ink/50">@{q.author?.username}</span>
          <span className="shrink-0 text-ink/40">· {timeAgo(q.created_at)}</span>
        </span>
        <span className="mt-0.5 line-clamp-3 block text-[13px] text-ink/75">{q.content ?? q.body ?? ""}</span>
      </span>
      {q.first && q.first.media_type === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={displayImageUrl(q.first.url, 160)!} onError={(e) => { if (q.first && e.currentTarget.src !== q.first.url) e.currentTarget.src = q.first.url; }} alt="" loading="lazy" decoding="async" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
      ) : null}
      {q.first && q.first.media_type === "video" ? (
        q.first.edit?.coverUrl ? (
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={q.first.edit.coverUrl} alt="" className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center text-white"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg></span>
          </span>
        ) : (
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black"><video src={q.first.url} preload="metadata" muted playsInline className="h-full w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center text-white"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg></span></span>
        )
      ) : null}
    </Link>
  );
}

export function PostCard({ post }: { post: FeedRow }) {
  const router = useRouter();
  const supabase = useRef(createClient()).current;
  const [hidden, setHidden] = useState(false);
  const [galleryImages, setGalleryImages] = useState<{ url: string; width?: number; height?: number }[]>([]);
  const [heart, setHeart] = useState(false);
  const [repostMenu, setRepostMenu] = useState(false);
  const [likesOpen, setLikesOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const text = post.content ?? post.body ?? "";
  const rbw = post as unknown as { reposted_by_name?: string | null };
  const whyReason = rbw.reposted_by_name ? rbw.reposted_by_name + " reposted this"
    : post.viewer_follows ? "You follow " + post.author_name
    : post.is_trending ? "Trending on Platinum Circles"
    : "Suggested for you";
  const rb = post as unknown as { reposted_by_id?: string | null; reposted_by_name?: string | null; reposted_by_username?: string | null; has_poll?: boolean; edited_at?: string | null };
  const media = post.media ?? [];
  const products = post.products ?? [];
  const readMinutes = (post as unknown as { read_minutes?: number | null }).read_minutes ?? null;
  // Only the writer's own gallery block is fetched here - articles are a
  // small extra lookup, not part of get_feed's normal columns.
  useEffect(() => {
    if (!post.article_title) return;
    let dead = false;
    supabase.from("articles").select("current_revision_id").eq("linked_post_id", post.post_id).maybeSingle()
      .then(({ data: art }: { data: { current_revision_id: string } | null }) => {
        if (dead || !art?.current_revision_id) return;
        supabase.from("article_blocks").select("content").eq("revision_id", art.current_revision_id).eq("block_type", "gallery").maybeSingle()
          .then(({ data: blk }: { data: { content: unknown } | null }) => {
            if (dead) return;
            const imgs = (blk?.content as { images?: unknown })?.images;
            if (Array.isArray(imgs)) setGalleryImages(imgs as { url: string; width?: number; height?: number }[]);
          });
      });
    return () => { dead = true; };
  }, [post.article_title, post.post_id, supabase]);
  // Long enough that it would crowd out the next post in the feed.
  const isLong = text.length > 600 || text.split("\n").length > 12;
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
    <article className="relative mb-4 rounded-2xl border border-ink/10 bg-white px-5 py-4 transition-colors duration-[140ms] hover:border-ink/20">
      {(post as unknown as { is_pinned?: boolean }).is_pinned ? (
        <span className="mb-1.5 flex items-center gap-1.5 pl-10 text-[12px] font-semibold text-ink/45"><Pin size={13} /> Pinned</span>
      ) : null}
      {rb.reposted_by_id ? (
        <Link href={"/" + rb.reposted_by_username} onClick={(e) => e.stopPropagation()} className="mb-1.5 flex items-center gap-1.5 pl-10 text-[12px] font-semibold text-ink/45 hover:underline">
          <Repeat2 size={13} /> {rb.reposted_by_name} reposted
        </Link>
      ) : null}
      {likesOpen ? <LikesModal postId={post.post_id} onClose={() => setLikesOpen(false)} /> : null}
      {heart ? (
        <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Heart size={84} className="animate-ping text-danger" fill="currentColor" />
        </span>
      ) : null}
      <div className="flex gap-3.5">
        <StoryAvatar userId={post.author_id}
          name={post.author_name}
          avatarUrl={post.author_avatar}
          size={46}
          href={profileHref}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={profileHref} className="flex min-w-0 items-center gap-1.5 hover:underline">
              <span className="flex min-w-0 items-center gap-[3px]">
                <span
                  className="truncate text-[15.5px] font-semibold text-ink"
                  style={post.author_verified ? { color: getTierColor(post.author_verified_tier) ?? undefined } : undefined}
                >
                  {post.author_name}
                </span>
                {post.author_verified ? <VerifiedBadge tier={post.author_verified_tier} size={15} /> : null}
              </span>
              <span className="truncate text-[13px] text-ink/50">@{post.author_username}</span>
            </Link>
            <span className="text-[13px] text-ink/30">·</span>
            <Link href={postHref} className="shrink-0 text-[13px] text-ink/50 hover:underline">
              {timeAgo(post.created_at)}
            </Link>
            {rb.edited_at ? <span className="shrink-0 text-[12px] text-ink/35">· Edited</span> : null}
            <FollowButton authorId={post.author_id} />
            <PostMenu postId={post.post_id} authorId={post.author_id} text={text} reason={whyReason} onHidden={() => setHidden(true)} />
          </div>

          {post.article_title ? (
            <Link href={postHref} className="mt-2 block">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-pearl-muted">
                <FileText size={12} /> Article
                {readMinutes ? <span className="text-ink/35">· {readMinutes} min read</span> : null}
              </span>
              <h3 className="mt-1 font-display text-[22px] leading-snug text-porcelain hover:underline">{post.article_title}</h3>
            </Link>
          ) : null}

          {text ? (
            <>
              <div onClick={() => router.push(postHref)}
                onDoubleClick={doubleLike}
                className={
                  "mt-1.5 cursor-pointer whitespace-pre-wrap text-[16px] leading-relaxed text-ink/90 " +
                  (isLong && !expanded ? "line-clamp-[10]" : "")
                }
              >
                <ArticleBody text={text} />
              </div>
              {isLong ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                  className="mt-1 text-[13.5px] font-semibold text-pearl transition-opacity duration-[140ms] hover:opacity-70"
                >
                  {expanded ? "Show less" : "Read more"}
                </button>
              ) : null}
            </>
          ) : null}

          {post.article_title && galleryImages.length > 0 ? (
            <div className={"mt-3 grid gap-2 " + (galleryImages.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
              {galleryImages.map((img: { url: string; width?: number; height?: number }, i: number) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.url + i}
                  src={img.url}
                  alt=""
                  loading="lazy"
                  className={"w-full rounded-xl bg-surface object-cover " + (galleryImages.length === 1 ? "h-72" : "h-40")}
                />
              ))}
            </div>
          ) : null}

          {media.length > 0 ? (
            <MediaGallery media={media}
              postId={post.post_id}
              viewsCount={(post as unknown as { views_count?: number | null }).views_count ?? null}
              onDoubleClick={doubleLike} post={{ post_id: post.post_id, author_name: post.author_name, author_username: post.author_username, author_avatar: post.author_avatar, author_verified: post.author_verified, author_verified_tier: post.author_verified_tier, content: post.content ?? post.body, likes_count: post.likes_count, comments_count: post.comments_count, reposts_count: post.reposts_count, viewer_liked: post.viewer_liked, viewer_bookmarked: post.viewer_bookmarked }} />
          ) : null}

          {(post as unknown as { thread_parent_id?: string | null }).thread_parent_id ? (
        <Link href={"/post/" + (post as unknown as { thread_parent_id?: string | null }).thread_parent_id} onClick={(e) => e.stopPropagation()} className="mb-1 inline-block text-[12px] text-pearl hover:underline">Part of a thread · view previous</Link>
      ) : null}
      {(post as unknown as { has_fact_check?: boolean }).has_fact_check ? (
        <Link href={"/post/" + post.post_id} onClick={(e) => e.stopPropagation()} className="mb-1 flex w-fit items-center gap-1 rounded-full bg-pearl/10 px-2.5 py-1 text-[11px] font-semibold text-pearl transition-colors duration-[140ms] hover:bg-pearl/15">
          <ShieldCheck size={12} /> Fact check added
        </Link>
      ) : null}
      {rb.has_poll ? <PollCard postId={post.post_id} /> : null}
      {quotedId ? <QuoteCard quotedId={quotedId} /> : null}

          {post.link && media.length === 0 ? (
            <a href={post.link.url} target="_blank" rel="noopener noreferrer"
              className="mt-3 block overflow-hidden rounded-xl border border-ink/10 transition-colors duration-[140ms] hover:bg-surface"
            >
              {post.link.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayImageUrl(post.link.image_url, 720)!} onError={(e) => { if (post.link?.image_url && e.currentTarget.src !== post.link.image_url) e.currentTarget.src = post.link.image_url; }} alt="" loading="lazy" decoding="async" className="max-h-72 w-full object-cover" />
              ) : null}
              <span className="block px-3.5 py-2.5">
                <span className="block text-[11px] uppercase tracking-wide text-ink/40">{post.link.domain}</span>
                <span className="block truncate text-[14px] text-ink/90">{post.link.title ?? post.link.url}</span>
              </span>
            </a>
          ) : null}

          {products.length > 0 ? (
            <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
              {products.map((p) => (
                <div key={p.id} className="relative w-52 shrink-0 overflow-hidden rounded-xl border border-ink/10">
                  {p.listing_status && p.listing_status !== "available" ? (
                    <span className="absolute inset-0 z-10 flex items-center justify-center bg-ink/60 text-[12px] font-bold uppercase tracking-widest text-white">{p.listing_status === "sold" ? "Sold" : "Unavailable"}</span>
                  ) : null}
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={displayImageUrl(p.image_url, 320)!} onError={(e) => { if (p.image_url && e.currentTarget.src !== p.image_url) e.currentTarget.src = p.image_url; }} alt="" loading="lazy" decoding="async" className="h-28 w-full bg-surface object-cover" />
                  ) : null}
                  <div className="px-3 py-2.5">
                    <p className="truncate text-[13px] font-medium text-ink">{p.title}</p>
                    {p.price != null ? <p className="text-[13px] font-semibold text-pearl">{p.currency ?? ""} {p.price}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="-ml-2.5 mt-3 flex items-center gap-1">
            <Link href={postHref} className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] text-ink/50 transition-colors duration-[140ms] hover:bg-ink/[0.06] hover:text-ink">
              <MessageCircle size={18} strokeWidth={1.8} />
              {count(post.comments_count)}
            </Link>
            <span className="relative">
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (repost.on) { repost.set(false); } else { setRepostMenu((v) => !v); } }} className={"flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] transition-colors duration-[140ms] " + (repost.on ? "text-success" : "text-ink/50 hover:bg-success/10 hover:text-success")}>
                <Repeat2 size={18} strokeWidth={1.8} />
                {count(repost.n)}
              </button>
              {repostMenu ? (
                <span className="absolute bottom-9 left-0 z-20 w-36 overflow-hidden rounded-xl border border-ink/10 bg-navy shadow-2xl">
                  <button onClick={(e) => { e.stopPropagation(); setRepostMenu(false); repost.set(true); }} className="block w-full px-3.5 py-2.5 text-left text-[13px] text-white/90 transition-colors duration-[140ms] hover:bg-surface-elevated">Repost</button>
                  <button onClick={(e) => { e.stopPropagation(); setRepostMenu(false); window.dispatchEvent(new CustomEvent("pc-quote-post", { detail: { id: post.post_id, author: post.author_name, text: text.slice(0, 140) } })); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="block w-full px-3.5 py-2.5 text-left text-[13px] text-white/90 transition-colors duration-[140ms] hover:bg-surface-elevated">Quote</button>
                </span>
              ) : null}
            </span>
            <span className="flex items-center">
              <button onClick={like.flip} title={like.on ? "Unlike" : "Like"} className={"rounded-full p-2 transition-colors duration-[140ms] " + (like.on ? "text-danger" : "text-ink/50 hover:bg-danger/10 hover:text-danger")}>
                <Heart size={18} strokeWidth={1.8} fill={like.on ? "currentColor" : "none"} />
              </button>
              {like.n > 0 ? (
                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLikesOpen(true); }} title="See who liked this" className={"-ml-1 text-[13px] transition-colors duration-[140ms] hover:underline " + (like.on ? "text-danger" : "text-ink/50")}>
                  {count(like.n)}
                </button>
              ) : null}
            </span>
            <button onClick={mark.flip} className={"flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] transition-colors duration-[140ms] " + (mark.on ? "text-pearl" : "text-ink/50 hover:bg-pearl/10 hover:text-pearl")}>
              <Bookmark size={18} strokeWidth={1.8} fill={mark.on ? "currentColor" : "none"} />
              {count(mark.n)}
            </button>
            <span className="ml-auto">
              <ShareMenu postId={post.post_id} sharesCount={(post as unknown as { shares_count?: number }).shares_count ?? 0} />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}