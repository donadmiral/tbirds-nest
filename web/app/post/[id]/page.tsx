import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CommentComposer } from "@/components/CommentComposer";
import { PostCard } from "@/components/PostCard";
import { timeAgo, type FeedRow } from "@/lib/feed";

type Params = { params: Promise<{ id: string }> };

async function loadPost(id: string) {
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_view_post", { p_post_id: id });
  if (!allowed) return null;
  const { data: post } = await supabase
    .from("posts")
    .select("id, user_id, content, body, media_url, article_title, read_minutes, channel, quoted_post_id, thread_parent_id, created_at, likes_count, comments_count, reposts_count, bookmarks_count, views_count")
    .eq("id", id)
    .maybeSingle();
  if (!post) return null;
  const { data: author } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url, is_verified, verified_tier")
    .eq("id", post.user_id)
    .maybeSingle();
  const { data: media } = await supabase
    .from("post_media")
    .select("id, url, media_type, width, height, sort_order")
    .eq("post_id", id)
    .order("sort_order", { ascending: true });
  const { data: products } = await supabase
    .from("post_products")
    .select("id, title, subtitle, price, currency, image_url, listing_id, link_url, cta_label, sort_order")
    .eq("post_id", id)
    .order("sort_order", { ascending: true });
  return { post, author, media: media ?? [], products: products ?? [] };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const data = await loadPost(id);
  if (!data || !data.author) {
    return { title: "Platinum Circles", description: "Work, market and community in one place." };
  }
  const text = (data.post.content ?? data.post.body ?? "").slice(0, 140);
  return {
    title: `${data.author.full_name ?? "Post"} on Platinum Circles`,
    description: text || "View this post on Platinum Circles.",
    openGraph: {
      title: `${data.author.full_name ?? "Post"} on Platinum Circles`,
      description: text || "View this post on Platinum Circles.",
      images: data.media[0]?.media_type !== "video" && data.media[0]?.url ? [data.media[0].url] : [],
    },
  };
}

export default async function PostPage({ params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const viewerId = userData.user?.id ?? null;
  const data = await loadPost(id);

  if (!data || !data.author) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-display text-2xl text-porcelain">This post is not available</h1>
        <p className="text-sm text-white/50">It may be private, deleted, or you may need to sign in.</p>
        <Link href="/" className="mt-2 rounded-md bg-pearl px-5 py-2.5 text-sm font-semibold text-ink">
          Open Platinum Circles
        </Link>
      </main>
    );
  }

  let viewer = { liked: false, bookmarked: false, reposted: false };
  if (viewerId) {
    const [l, b, r] = await Promise.all([
      supabase.from("post_likes").select("post_id").eq("post_id", id).eq("user_id", viewerId).maybeSingle(),
      supabase.from("post_bookmarks").select("post_id").eq("post_id", id).eq("user_id", viewerId).maybeSingle(),
      supabase.from("post_reposts").select("post_id").eq("post_id", id).eq("user_id", viewerId).maybeSingle(),
    ]);
    viewer = { liked: !!l.data, bookmarked: !!b.data, reposted: !!r.data };
  }

  const row: FeedRow = {
    post_id: data.post.id,
    author_id: data.post.user_id,
    content: data.post.content,
    body: data.post.body,
    media_url: data.post.media_url,
    media: data.media as FeedRow["media"],
    products: data.products as FeedRow["products"],
    link: null,
    channel: data.post.channel,
    article_title: data.post.article_title,
    read_minutes: data.post.read_minutes,
    quoted_post_id: data.post.quoted_post_id,
    thread_parent_id: data.post.thread_parent_id,
    created_at: data.post.created_at,
    likes_count: data.post.likes_count ?? 0,
    comments_count: data.post.comments_count ?? 0,
    reposts_count: data.post.reposts_count ?? 0,
    bookmarks_count: data.post.bookmarks_count ?? 0,
    views_count: data.post.views_count ?? 0,
    is_trending: false,
    author_name: data.author.full_name,
    author_username: data.author.username,
    author_avatar: data.author.avatar_url,
    author_verified: !!data.author.is_verified,
    author_kind: null,
    author_verified_tier: data.author.verified_tier,
    viewer_liked: viewer.liked,
    viewer_bookmarked: viewer.bookmarked,
    viewer_reposted: viewer.reposted,
    viewer_follows: false,
    sort_key: 0,
    innovation_field: null,
    innovation_stage: null,
  };

  const { data: commentRows } = await supabase
    .from("post_comments")
    .select("id, post_id, user_id, body, content, parent_comment_id, likes_count, created_at")
    .eq("post_id", id)
    .order("created_at", { ascending: true })
    .limit(100);
  const comments = commentRows ?? [];
  const commenterIds = Array.from(new Set(comments.map((c) => c.user_id)));
  const { data: commenterRows } = commenterIds.length
    ? await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", commenterIds)
    : { data: [] };
  const commenters = new Map((commenterRows ?? []).map((p) => [p.id, p]));

  return (
    <main className="mx-auto min-h-screen w-full max-w-[640px] px-4 py-6">
      <Link href={viewerId ? "/home" : "/"} className="mb-4 inline-block text-sm text-white/50 hover:text-white">
        ← Platinum Circles
      </Link>
      <PostCard post={row} />
      <section className="mt-2">
        <h2 className="px-1 py-3 text-[15px] font-semibold text-white">
          {comments.length > 0 ? `Comments` : `No comments yet`}
        </h2>
        <CommentComposer postId={id} />
        {comments.map((c) => {
          const p = commenters.get(c.user_id);
          return (
            <div key={c.id} className="flex gap-3 border-t border-white/10 px-1 py-4">
              {p?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-semibold text-porcelain">
                  {(p?.full_name ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px]">
                  <span className="font-semibold text-white">{p?.full_name ?? "Member"}</span>
                  <span className="text-white/50">@{p?.username}</span>
                  <span className="text-white/30">·</span>
                  <span className="text-white/50">{timeAgo(c.created_at)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[14px] text-white/90">{c.body || c.content || ""}</p>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}