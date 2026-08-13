"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { StoryAvatar } from "@/components/StoryAvatar";
import { timeAgo } from "@/lib/feed";

type SavedPost = {
  id: string;
  user_id: string;
  content: string | null;
  body: string | null;
  media_url: string | null;
  likes_count: number | null;
  comments_count: number | null;
  created_at: string;
  post_media: { id: string; url: string; media_type: string; sort_order: number }[] | null;
  author?: { full_name: string | null; username: string | null; avatar_url: string | null } | null;
  saved_at?: string;
};

export default function SavedPage() {
  const supabase = useRef(createClient()).current;
  const [posts, setPosts] = useState<SavedPost[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) { setPosts([]); return; }
      const { data: bookmarks } = await supabase
        .from("post_bookmarks")
        .select("post_id, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!bookmarks || bookmarks.length === 0) { setPosts([]); return; }
      const postIds = bookmarks.map((b) => b.post_id);
      const savedAt: Record<string, string> = {};
      bookmarks.forEach((b) => { savedAt[b.post_id] = b.created_at; });

      const { data: postsData } = await supabase
        .from("posts")
        .select("id, user_id, content, body, media_url, likes_count, comments_count, created_at, post_media(id, url, media_type, width, height, sort_order)")
        .in("id", postIds);
      if (!postsData || postsData.length === 0) { setPosts([]); return; }

      const authorIds = Array.from(new Set(postsData.map((p) => p.user_id)));
      const { data: authors } = await supabase
        .from("profiles")
        .select("id, full_name, username, avatar_url")
        .in("id", authorIds);
      const authorMap = new Map((authors ?? []).map((a) => [a.id, a]));

      const rows = (postsData as SavedPost[])
        .map((p) => ({ ...p, author: authorMap.get(p.user_id) ?? null, saved_at: savedAt[p.id] }))
        .sort((a, b) => new Date(b.saved_at ?? 0).getTime() - new Date(a.saved_at ?? 0).getTime());
      setPosts(rows);
    })();
  }, [supabase]);

  return (
    <div className="px-1">
      <h1 className="pb-3 font-display text-xl text-porcelain">Saved</h1>
      {posts === null ? (
        <p className="py-16 text-center text-sm text-white/40">Loading</p>
      ) : posts.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/40">Bookmark posts and they collect here.</p>
      ) : (
        posts.map((p) => {
          const text = p.content ?? p.body ?? "";
          const media = (p.post_media ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
          const first = media[0]?.url ?? p.media_url;
          return (
            <Link key={p.id} href={"/post/" + p.id} className="flex gap-3 border-b border-white/10 px-1 py-4 transition-colors hover:bg-surface">
              <StoryAvatar userId={p.user_id}
                name={p.author?.full_name}
                avatarUrl={p.author?.avatar_url}
                size={44}
                href={p.author?.username ? "/" + p.author.username : null}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[14px]">
                  <span className="truncate font-semibold text-white">{p.author?.full_name ?? "Member"}</span>
                  <span className="truncate text-white/50">@{p.author?.username}</span>
                  <span className="text-white/30">·</span>
                  <span className="shrink-0 text-white/50">{timeAgo(p.created_at)}</span>
                </span>
                {text ? <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap text-[14px] text-white/85">{text}</span> : null}
                <span className="mt-1 block text-[12px] text-white/40">
                  {(p.likes_count ?? 0) + " likes · " + (p.comments_count ?? 0) + " comments"}
                </span>
              </span>
              {first ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={first} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" />
              ) : null}
            </Link>
          );
        })
      )}
    </div>
  );
}