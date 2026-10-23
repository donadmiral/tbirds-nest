"use client";

import { hydratePostMedia } from "@/lib/contentMedia";
import { withTimeout } from "@/lib/withTimeout";
import { productDestination } from "../../shared/productDestination";

import { profilePath } from "@/lib/profileLookup";
import { usePollFlag } from "@/lib/pollCheck";
import { PersonName } from "@/components/PersonName";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bookmark, ExternalLink, FileText, Heart, MessageCircle, Pin, Repeat2, ShieldCheck } from "lucide-react";

// Same figure the phone prints on its product cards: $28, $18.50, ZWG 40.
function money(price: number | string | null | undefined, currency?: string | null) {
  if (price === null || price === undefined || price === "") return null;
  const n = typeof price === "string" ? Number(price) : price;
  if (Number.isNaN(n)) return null;
  const body = n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
  return (currency || "USD") === "USD" ? "$" + body : "ZWG " + body;
}
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
import { Comments } from "@/components/Comments";
import { COMMENT_COUNT_UPDATED, refreshCommentCount, type CommentCountUpdate } from "@/lib/commentCounts";
import { displayImageUrl } from "@/lib/media";
import type { FeedRow } from "@/lib/feed";
import { timeAgo } from "@/lib/feed";
import { toggleRepost } from "@/lib/interactions";
import { usePostInteractions } from "@/lib/usePostInteractions";

function count(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return n > 0 ? String(n) : "";
}

function useToggle(initialOn: boolean, initialCount: number, action: (id: string, on: boolean) => Promise<boolean>, postId: string) {
  const [on, setOn] = useState(initialOn);
  const [n, setN] = useState(initialCount);
  const busy = useRef(false);
  async function set(next: boolean) {
    if (busy.current || next === on) return;
    busy.current = true;
    setOn(next);
    setN((v) => Math.max(0, v + (next ? 1 : -1)));
    try {
      if (!await action(postId, next)) throw new Error("Interaction was not saved");
    } catch {
      setOn(!next);
      setN(n);
    } finally {
      busy.current = false;
    }
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
    let live = true, version = 0;
    const load = async () => {
      const run = ++version;
      try {
        const {data,error} = await withTimeout(supabase.from("posts").select("content, body, created_at, user_id, post_media(url, media_type, sort_order, edit)").eq("id",quotedId).maybeSingle());
        if(error)throw error;
        if(!data){if(live&&run===version)setQ(null);return;}
        const [{data:author,error:authorError},safe] = await Promise.all([
          withTimeout(supabase.from("profiles").select("full_name, username").eq("id",data.user_id).maybeSingle()),
          hydratePostMedia([{...data,post_id:quotedId}],supabase),
        ]);
        if(authorError)throw authorError;
        if(!live||run!==version)return;
        const media=(safe[0].post_media||[]).slice().sort((x:{sort_order:number},y:{sort_order:number})=>x.sort_order-y.sort_order);
        setQ({content:data.content,body:data.body,created_at:data.created_at,author:author??null,first:media[0]??null});
      }catch{if(live&&run===version)setQ(null);}
    };
    setQ(null);void load();
    const timer=setInterval(()=>void load(),240000);
    const {data}=supabase.auth.onAuthStateChange(()=>{version++;setQ(null);queueMicrotask(()=>{if(live)void load();});});
    return()=>{live=false;version++;clearInterval(timer);data.subscription.unsubscribe();};
  }, [supabase, quotedId]);

  if (!q) return null;
  return (
    <Link href={"/post/" + quotedId} onClick={(e) => e.stopPropagation()} className="mt-3 flex gap-3 rounded-xl border border-ink/10 p-3 transition-colors duration-[140ms] hover:bg-surface">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px]">
          <span className="truncate font-semibold text-ink">{q.author?.full_name ?? "Member"}</span>
          {q.author?.username ? <span className="truncate text-muted">@{q.author.username}</span> : null}
          <span className="shrink-0 text-muted">· {timeAgo(q.created_at)}</span>
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

export function PostCard({ post, hideMedia, inlineComments = true }: { post: FeedRow; hideMedia?: boolean; inlineComments?: boolean }) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [hidden, setHidden] = useState(false);
  const [galleryImages, setGalleryImages] = useState<{ url: string; width?: number; height?: number }[]>([]);
  const [heart, setHeart] = useState(false);
  const [repostMenu, setRepostMenu] = useState(false);
  const [likesOpen, setLikesOpen] = useState(false);
  const [collabNames, setCollabNames] = useState<{ name: string; username: string; verified: boolean; tier: string | null }[]>([]);
  const [collabsOpen, setCollabsOpen] = useState(false);
  useEffect(() => {
    let dead = false;
    supabase.from("post_collaborators").select("status, profile:profiles!post_collaborators_user_id_fkey(username, full_name, is_verified, verified_tier)").eq("post_id", post.post_id).eq("status", "accepted").then(({ data }) => {
      if (dead) return;
      type Pr = { username?: string | null; full_name?: string | null; is_verified?: boolean | null; verified_tier?: string | null }; const names = ((data ?? []) as { profile?: Pr | Pr[] }[]).map((r) => { const pr = Array.isArray(r.profile) ? r.profile[0] : r.profile; return pr ? { name: pr.full_name || pr.username || "", username: pr.username || "", verified: !!pr.is_verified, tier: pr.verified_tier ?? null } : null; }).filter((x): x is { name: string; username: string; verified: boolean; tier: string | null } => !!x && !!x.name);
      setCollabNames(names);
    });
    return () => { dead = true; };
  }, [supabase, post.post_id]);
  const [listKind, setListKind] = useState<"likes" | "reposts" | "bookmarks">("likes");
  const [expanded, setExpanded] = useState(false);
  // Comments open right under the card, so the post and its video stay in view while you read and reply.
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentUpdate, setCommentUpdate] = useState<CommentCountUpdate | null>(null);
  const latestCommentUpdate = useRef<CommentCountUpdate | null>(null);
  const commentsCount = commentUpdate?.postId === post.post_id ? commentUpdate.count : post.comments_count;
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<CommentCountUpdate>).detail;
      if (detail?.postId !== post.post_id || !Number.isSafeInteger(detail.count) || detail.count < 0) return;
      latestCommentUpdate.current = detail;
      setCommentUpdate(detail);
    };
    window.addEventListener(COMMENT_COUNT_UPDATED, update);
    return () => window.removeEventListener(COMMENT_COUNT_UPDATED, update);
  }, [post.post_id]);
  useEffect(() => {
    // A late feed response may predate a confirmed mutation. Reconcile changed
    // seed props instead of overwriting the live total with an older value.
    if (latestCommentUpdate.current?.postId === post.post_id) void refreshCommentCount(supabase, post.post_id);
  }, [post.post_id, post.comments_count, supabase]);
  const text = post.content ?? post.body ?? "";
  const rbw = post as unknown as { reposted_by_name?: string | null };
  const whyReason = rbw.reposted_by_name ? rbw.reposted_by_name + " reposted this"
    : post.viewer_follows ? "You follow " + post.author_name
    : post.is_trending ? "Trending on Platinum Circles"
    : "Suggested for you";
  const rb = post as unknown as { reposted_by_id?: string | null; reposted_by_name?: string | null; reposted_by_username?: string | null; has_poll?: boolean; edited_at?: string | null };
  const hasPoll = usePollFlag(post.post_id, rb.has_poll);
  const legacyUrl = (post as unknown as { media_url?: string | null }).media_url || null;
  const media = (post.media && post.media.length) ? post.media : (legacyUrl ? [{ id: "legacy", url: legacyUrl, media_type: /\.(mp4|mov|m4v|webm)(\?|$)/i.test(legacyUrl) ? "video" : "image", width: null, height: null, sort_order: 0 } as unknown as NonNullable<typeof post.media>[number]] : []);
  const products = post.products ?? [];
  const readMinutes = (post as unknown as { read_minutes?: number | null }).read_minutes ?? null;
  // Only the writer's own gallery block is fetched here - articles are a
  // small extra lookup, not part of get_feed's normal columns.
  useEffect(() => {
    setGalleryImages([]);
    if (!post.article_title) return;
    let live=true,version=0;
    const load=async()=>{
      const run=++version;
      try{
        const {data:article,error}=await withTimeout(supabase.from("articles").select("current_revision_id").eq("linked_post_id",post.post_id).maybeSingle());
        if(error)throw error;
        if(!article?.current_revision_id){if(live&&run===version)setGalleryImages([]);return;}
        const {data:block,error:blockError}=await withTimeout(supabase.from("article_blocks").select("content").eq("revision_id",article.current_revision_id).eq("block_type","gallery").maybeSingle());
        if(blockError)throw blockError;
        const [safe]=await hydratePostMedia([{post_id:post.post_id,blocks:block}],supabase);
        const images=(safe.blocks?.content as {images?:unknown})?.images;
        if(live&&run===version)setGalleryImages(Array.isArray(images)?images.filter((image):image is {url:string;width?:number;height?:number}=>!!image&&typeof image.url==='string'):[]);
      }catch{if(live&&run===version)setGalleryImages([]);}
    };
    void load();const timer=setInterval(()=>void load(),240000);
    const {data}=supabase.auth.onAuthStateChange(()=>{version++;setGalleryImages([]);queueMicrotask(()=>{if(live)void load();});});
    return()=>{live=false;version++;clearInterval(timer);data.subscription.unsubscribe();};
  }, [post.article_title, post.post_id, supabase]);
  // Long enough that it would crowd out the next post in the feed.
  const isLong = text.length > 600 || text.split("\n").length > 12;
  const social = usePostInteractions(post.post_id, { liked: post.viewer_liked, bookmarked: post.viewer_bookmarked,
    likesCount: post.likes_count, bookmarksCount: post.bookmarks_count });
  const like = { on: social.liked, n: social.likesCount, set: social.setLike,
    flip: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); void social.setLike(!social.liked); } };
  const repost = useToggle(post.viewer_reposted, post.reposts_count, toggleRepost, post.post_id);
  const mark = { on: social.bookmarked, n: social.bookmarksCount,
    flip: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); void social.setBookmark(!social.bookmarked); } };
  const profileHref = profilePath(post.author_username, post.author_id);
  const postHref = "/post/" + post.post_id;
  const quotedId = (post as unknown as { quoted_post_id?: string | null }).quoted_post_id ?? null;

  if (hidden) return null;

  function doubleLike(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (social.pending || social.uncertain) return;
    if (!like.on) like.set(true);
    setHeart(true);
    setTimeout(() => setHeart(false), 700);
  }

  return (
    <article className="relative mb-4 rounded-2xl border border-ink/10 bg-white px-5 py-4 transition-colors duration-[140ms] hover:border-ink/20">
      {(post as unknown as { is_pinned?: boolean }).is_pinned ? (
        <span className="mb-1.5 flex items-center gap-1.5 pl-10 text-[12px] font-semibold text-muted"><Pin size={13} /> Pinned</span>
      ) : null}
      {rb.reposted_by_id ? (
        <Link href={profilePath(rb.reposted_by_username, rb.reposted_by_id)} onClick={(e) => e.stopPropagation()} className="mb-1.5 flex items-center gap-1.5 pl-10 text-[12px] font-semibold text-muted hover:underline">
          <Repeat2 size={13} /> {rb.reposted_by_name} reposted
        </Link>
      ) : null}
      {likesOpen ? <LikesModal postId={post.post_id} kind={listKind} onClose={() => setLikesOpen(false)} /> : null}
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
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            <Link href={profileHref} className="flex min-w-0 items-center gap-1.5 hover:underline">
              <span className="flex min-w-0 items-center gap-[3px]">
                <PersonName name={post.author_name ?? ""} verified={post.author_verified} tier={post.author_verified_tier ?? undefined} userId={post.author_id} className="text-[15.5px] font-semibold text-ink" badgeSize={15} />
              </span>
            </Link>
            {collabNames.length === 1 ? <span className="ml-1 inline-flex items-center gap-1 font-semibold text-ink">× <Link href={"/" + collabNames[0].username} onClick={(e) => e.stopPropagation()} className="hover:underline"><PersonName name={collabNames[0].name} verified={collabNames[0].verified} tier={collabNames[0].tier} badgeSize={14} /></Link></span> : collabNames.length > 1 ? <span className="relative ml-1 font-semibold text-ink"><button type="button" onClick={(e) => { e.stopPropagation(); setCollabsOpen((v) => !v); }} className="hover:underline">× {collabNames.length} others</button>{collabsOpen ? <span className="absolute left-0 top-full z-20 mt-1 flex w-56 flex-col rounded-xl border border-ink/10 bg-white p-2 shadow-lg">{collabNames.map((x) => <Link key={x.username} href={"/" + x.username} onClick={(e) => e.stopPropagation()} className="rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface"><PersonName name={x.name} verified={x.verified} tier={x.tier} badgeSize={13} /><span className="ml-1 text-muted">@{x.username}</span></Link>)}</span> : null}</span> : null}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
              {post.author_username ? <Link href={profileHref} className="truncate hover:underline">@{post.author_username}</Link> : null}
              {post.author_username ? <span className="text-muted">·</span> : null}
              <Link href={postHref} className="shrink-0 hover:underline">{timeAgo(post.created_at)}</Link>
              {rb.edited_at ? <span className="shrink-0 text-[12px] text-muted">· Edited</span> : null}
              {(post as unknown as { promo_label?: string; promo_id?: string }).promo_id ? <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{(post as unknown as { promo_label?: string }).promo_label || "Sponsored"}</span> : null}
            </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <FollowButton authorId={post.author_id} />
              <PostMenu postId={post.post_id} authorId={post.author_id} text={text} reason={whyReason} onHidden={() => { setHidden(true); window.dispatchEvent(new CustomEvent("pc-feed-hidden", { detail: { postId: post.post_id } })); }} />
            </div>
          </div>

          {post.article_title ? (
            <Link href={postHref} className="mt-2 block">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-pearl-muted">
                <FileText size={12} /> Article
                {readMinutes ? <span className="text-muted">· {readMinutes} min read</span> : null}
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
                  className="mt-1 text-[13.5px] font-semibold text-accent transition-opacity duration-[140ms] hover:opacity-70"
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

          {media.length > 0 && !post.article_title && !hideMedia ? (
            <MediaGallery media={media}
              postId={post.post_id}
              viewsCount={(post as unknown as { views_count?: number | null }).views_count ?? null}
              onDoubleClick={doubleLike} post={{ post_id: post.post_id, author_id: post.author_id, author_name: post.author_name, author_username: post.author_username, author_avatar: post.author_avatar, author_verified: post.author_verified, author_verified_tier: post.author_verified_tier, content: post.content ?? post.body, likes_count: post.likes_count, bookmarks_count: post.bookmarks_count, comments_count: commentsCount, reposts_count: repost.n, viewer_liked: post.viewer_liked, viewer_bookmarked: post.viewer_bookmarked }} />
          ) : null}

          {(post as unknown as { thread_parent_id?: string | null }).thread_parent_id ? (
        <Link href={"/post/" + (post as unknown as { thread_parent_id?: string | null }).thread_parent_id} onClick={(e) => e.stopPropagation()} className="mb-1 inline-block text-[12px] text-accent hover:underline">Part of a thread · view previous</Link>
      ) : null}
      {(post as unknown as { has_fact_check?: boolean }).has_fact_check ? (
        <Link href={"/post/" + post.post_id} onClick={(e) => e.stopPropagation()} className="mb-1 flex w-fit items-center gap-1 rounded-full bg-pearl/10 px-2.5 py-1 text-[11px] font-semibold text-accent transition-colors duration-[140ms] hover:bg-pearl/15">
          <ShieldCheck size={12} /> Fact check added
        </Link>
      ) : null}
      {hasPoll ? <PollCard postId={post.post_id} /> : null}
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
                <span className="block text-[11px] uppercase tracking-wide text-muted">{post.link.domain}</span>
                <span className="block truncate text-[14px] text-ink/90">{post.link.title ?? post.link.url}</span>
              </span>
            </a>
          ) : null}

          {products.length > 0 ? (
            <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1" data-product-cards>
              {products.map((p) => {
                const price = money(p.price, p.currency);
                const destination = productDestination(p.listing_id, p.link_url);
                const internal = !!destination && destination.kind !== "external";
                const href = destination?.href || "";
                const cls = "relative block w-44 shrink-0 overflow-hidden rounded-xl border border-ink/10 bg-white text-left transition-colors duration-[140ms] hover:border-ink/25";
                const body = (
                  <>
                    {p.listing_status && p.listing_status !== "available" ? (
                      <span className="absolute inset-0 z-10 flex items-center justify-center bg-ink/60 text-[12px] font-bold uppercase tracking-widest text-white">{p.listing_status === "sold" ? "Sold" : "Unavailable"}</span>
                    ) : null}
                    <span className="relative block aspect-square w-full bg-surface">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={displayImageUrl(p.image_url, 420)!} onError={(e) => { if (p.image_url && e.currentTarget.src !== p.image_url) e.currentTarget.src = p.image_url; }} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      ) : null}
                      {!internal ? <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-ink/55 text-white"><ExternalLink size={11} /></span> : null}
                    </span>
                    <span className="block px-3 pb-3 pt-2.5">
                      <span className="line-clamp-2 text-[13px] font-semibold leading-4 text-ink">{p.title}</span>
                      {p.subtitle ? <span className="mt-0.5 block truncate text-[11px] text-muted">{p.subtitle}</span> : null}
                      <span className="mt-1.5 flex items-center justify-between gap-2">
                        {price ? <span className="text-[14px] font-bold text-ink">{price}</span> : <span />}
                        <span className="shrink-0 text-[12px] font-bold text-pearl-muted">{p.cta_label || (internal ? "View" : "Shop")}</span>
                      </span>
                    </span>
                  </>
                );
                if (!href) return <div key={p.id} className={cls}>{body}</div>;
                return internal ? (
                  <Link key={p.id} href={href} onClick={(e) => e.stopPropagation()} className={cls} aria-label={p.title ?? "Product"}>{body}</Link>
                ) : (
                  <a key={p.id} href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={cls} aria-label={p.title ?? "Product"}>{body}</a>
                );
              })}
            </div>
          ) : null}

          <div className="-ml-2.5 mt-3 flex items-center gap-1">
            {inlineComments ? (
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCommentsOpen((v) => !v); }} aria-expanded={commentsOpen} aria-label={commentsOpen ? "Hide comments" : "Show comments"} className={"flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] transition-colors duration-[140ms] hover:bg-ink/[0.06] hover:text-ink " + (commentsOpen ? "text-ink" : "text-muted")}>
                <MessageCircle size={18} strokeWidth={1.8} fill={commentsOpen ? "currentColor" : "none"} />
                {count(commentsCount)}
              </button>
            ) : (
              <Link href={postHref} className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] text-muted transition-colors duration-[140ms] hover:bg-ink/[0.06] hover:text-ink">
                <MessageCircle size={18} strokeWidth={1.8} />
                {count(commentsCount)}
              </Link>
            )}
            <span className="relative">
              <button aria-label={repost.on ? "Undo repost" : "Repost or quote"} aria-expanded={repost.on ? undefined : repostMenu} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (repost.on) { repost.set(false); } else { setRepostMenu((v) => !v); } }} className={"flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] transition-colors duration-[140ms] " + (repost.on ? "text-success" : "text-muted hover:bg-success/10 hover:text-success")}>
                <Repeat2 size={18} strokeWidth={1.8} />
                {repost.n > 0 ? <span role="button" title="See who reposted" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setListKind("reposts"); setLikesOpen(true); }} className="hover:underline">{count(repost.n)}</span> : null}
              </button>
              {repostMenu ? (
                <span className="absolute bottom-9 left-0 z-20 w-36 overflow-hidden rounded-xl border border-ink/10 bg-navy shadow-2xl">
                  <button onClick={(e) => { e.stopPropagation(); setRepostMenu(false); repost.set(true); }} className="block w-full px-3.5 py-2.5 text-left text-[13px] text-white/90 transition-colors duration-[140ms] hover:bg-surface-elevated">Repost</button>
                  <button onClick={(e) => { e.stopPropagation(); setRepostMenu(false); window.dispatchEvent(new CustomEvent("pc-quote-post", { detail: { id: post.post_id, author: post.author_name, text: text.slice(0, 140) } })); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="block w-full px-3.5 py-2.5 text-left text-[13px] text-white/90 transition-colors duration-[140ms] hover:bg-surface-elevated">Quote</button>
                </span>
              ) : null}
            </span>
            <span className="flex items-center">
              <button onClick={like.flip} title={like.on ? "Unlike" : "Like"} aria-label={like.on ? "Unlike" : "Like"} aria-pressed={like.on} disabled={social.pending || social.uncertain} aria-busy={social.pending} className={"rounded-full p-2 transition-colors duration-[140ms] " + (like.on ? "text-danger" : "text-muted hover:bg-danger/10 hover:text-danger")}>
                <Heart size={18} strokeWidth={1.8} fill={like.on ? "currentColor" : "none"} />
              </button>
              {like.n > 0 ? (
                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setListKind("likes"); setLikesOpen(true); }} title="See who liked this" className={"-ml-1 text-[13px] transition-colors duration-[140ms] hover:underline " + (like.on ? "text-danger" : "text-muted")}>
                  {count(like.n)}
                </button>
              ) : null}
            </span>
            <button aria-label={mark.on ? "Unsave post" : "Save post"} aria-pressed={mark.on} onClick={mark.flip} disabled={social.pending || social.uncertain} aria-busy={social.pending} className={"flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] transition-colors duration-[140ms] " + (mark.on ? "text-accent" : "text-muted hover:bg-pearl/10 hover:text-accent")}>
              <Bookmark size={18} strokeWidth={1.8} fill={mark.on ? "currentColor" : "none"} />
              {count(mark.n)}
            </button>
            <span className="ml-auto">
              <ShareMenu postId={post.post_id} sharesCount={(post as unknown as { shares_count?: number }).shares_count ?? 0} />
            </span>
          </div>
          {social.pending ? <span role="status" className="sr-only">Updating post interactions</span> : null}
          {social.error ? <p role="alert" className="mt-2 text-sm text-ink">{social.error} <button type="button" disabled={social.pending} onClick={(e) => { e.stopPropagation(); void social.retry(); }} className="underline">Check status</button></p> : null}
          {commentsOpen && inlineComments ? (
            <div onClick={(e) => e.stopPropagation()} className="mt-2 border-t border-ink/10 pt-3">
              <Comments postId={post.post_id} autoFocus />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
