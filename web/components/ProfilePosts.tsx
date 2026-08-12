"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  const supabase = useRef(createClient()).current;
  const [posts, setPosts] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<string | null>(null);

  const toRow = useCallback(
    (r: ProfilePostRow): FeedRow => ({
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

  const load = useCallback(
    async (more: boolean) => {
      if (!more) {
        setLoading(true);
        cursor.current = null;
      }
      const { data } = await supabase.rpc("get_profile_posts", {
        p_profile_id: profileId,
        p_cursor: more ? cursor.current : null,
        p_limit: 20,
      });
      const rows = (data ?? []) as ProfilePostRow[];
      setPosts((prev) => (more ? [...prev, ...rows.map(toRow)] : rows.map(toRow)));
      if (rows.length > 0) cursor.current = rows[rows.length - 1].created_at;
      setHasMore(rows.length >= 20);
      setLoading(false);
    },
    [profileId, supabase, toRow]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  if (loading) {
    return <p className="py-12 text-center text-sm text-white/40">Loading posts</p>;
  }
  if (posts.length === 0) {
    return <p className="py-12 text-center text-sm text-white/40">No posts yet.</p>;
  }
  return (
    <div>
      {posts.map((p) => (
        <PostCard key={p.post_id} post={p} />
      ))}
      {hasMore ? (
        <div className="flex justify-center py-6">
          <button onClick={() => load(true)} className="rounded-md bg-surface px-5 py-2.5 text-sm text-white hover:bg-surface-elevated">
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}