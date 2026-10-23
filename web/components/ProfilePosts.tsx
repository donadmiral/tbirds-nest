"use client";

import { useCallback } from "react";
import { useSocialPages } from "@/lib/useSocialPages";
import { SocialPageFooter } from "@/components/SocialPageFooter";
import type { FeedRow } from "@/lib/feed";
import { PostCard } from "@/components/PostCard";

type ProfilePostRow = {
  post_id: string;
  content: string | null;
  body: string | null;
  media_url: string | null;
  media: FeedRow["media"];
  products: FeedRow["products"];
  channel: string | null;
  article_title: string | null;
  read_minutes: number | null;
  created_at: string;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  bookmarks_count: number;
  views_count: number;
  viewer_liked: boolean;
  viewer_bookmarked: boolean;
  viewer_reposted: boolean;
};

export function ProfilePosts({ profileId, authorName, authorUsername, authorAvatar, authorVerified }: {
  profileId: string;
  authorName: string | null;
  authorUsername: string | null;
  authorAvatar: string | null;
  authorVerified: boolean;
}) {
  const page = useSocialPages<ProfilePostRow>("get_profile_posts_page", { p_profile_id: profileId }, { key: "post_id" });
  const posts = page.items;

  const toRow = useCallback(
    (r: ProfilePostRow): FeedRow => ({
      ...(r as unknown as Record<string, unknown>),
      post_id: r.post_id,
      author_id: profileId,
      content: r.content,
      body: r.body,
      media_url: r.media_url,
      media: r.media ?? [],
      products: r.products ?? [],
      link: null,
      channel: r.channel,
      article_title: r.article_title,
      read_minutes: r.read_minutes,
      quoted_post_id: null,
      thread_parent_id: null,
      created_at: r.created_at,
      likes_count: r.likes_count,
      comments_count: r.comments_count,
      reposts_count: r.reposts_count,
      bookmarks_count: r.bookmarks_count,
      views_count: r.views_count,
      is_trending: false,
      author_name: authorName,
      author_username: authorUsername,
      author_avatar: authorAvatar,
      author_verified: authorVerified,
      author_kind: null,
      author_verified_tier: null,
      viewer_liked: r.viewer_liked,
      viewer_bookmarked: r.viewer_bookmarked,
      viewer_reposted: r.viewer_reposted,
      viewer_follows: false,
      sort_key: 0,
      innovation_field: null,
      innovation_stage: null,
    }),
    [profileId, authorName, authorUsername, authorAvatar, authorVerified]
  );

  if (page.loading && posts.length === 0) {
    return <p className="py-12 text-center text-sm text-muted">Loading posts</p>;
  }
  return (
    <div>
      {!page.loading && !page.error && posts.length === 0 ? <p className="py-12 text-center text-sm text-muted">No posts yet.</p> : null}
      {posts.map((p) => <PostCard key={p.post_id} post={toRow(p)} />)}
      <SocialPageFooter {...page} />
    </div>
  );
}
