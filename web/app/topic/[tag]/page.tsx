"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { StoryAvatar } from "@/components/StoryAvatar";
import { RichText } from "@/components/RichText";
import { timeAgo } from "@/lib/feed";

type TopicPost = {
  id: string;
  user_id: string;
  content: string | null;
  body: string | null;
  created_at: string;
  likes_count: number | null;
  comments_count: number | null;
  author?: { full_name: string | null; username: string | null; avatar_url: string | null } | null;
};

export default function TopicPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = use(params);
  const clean = decodeURIComponent(tag);
  const supabase = useRef(createClient()).current;
  const [posts, setPosts] = useState<TopicPost[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("posts")
        .select("id, user_id, content, body, created_at, likes_count, comments_count")
        .ilike("content", "%#" + clean + "%")
        .order("created_at", { ascending: false })
        .limit(40);
      const rows = (data ?? []) as TopicPost[];
      const ids = Array.from(new Set(rows.map((p) => p.user_id)));
      if (ids.length > 0) {
        const { data: authors } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
        const map = new Map((authors ?? []).map((a) => [a.id, a]));
        rows.forEach((p) => { p.author = map.get(p.user_id) ?? null; });
      }
      setPosts(rows);
    })();
  }, [supabase, clean]);

  return (
    <div className="px-1">
      <h1 className="pb-3 font-display text-xl text-porcelain">#{clean}</h1>
      {posts === null ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading</p>
      ) : posts.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink/40">No posts with this topic yet.</p>
      ) : (
        posts.map((p) => (
          <Link key={p.id} href={"/post/" + p.id} className="flex gap-3 border-b border-ink/10 px-1 py-4 transition-colors hover:bg-surface">
            <StoryAvatar userId={p.user_id} name={p.author?.full_name} avatarUrl={p.author?.avatar_url} size={44} href={p.author?.username ? "/" + p.author.username : null} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[14px]">
                <span className="truncate font-semibold text-ink">{p.author?.full_name ?? "Member"}</span>
                <span className="truncate text-ink/50">@{p.author?.username}</span>
                <span className="text-ink/30">·</span>
                <span className="shrink-0 text-ink/50">{timeAgo(p.created_at)}</span>
              </span>
              <span className="mt-0.5 block whitespace-pre-wrap text-[14px] text-ink/85">
                <RichText text={(p.content ?? p.body ?? "").slice(0, 400)} />
              </span>
              <span className="mt-1 block text-[12px] text-ink/40">{(p.likes_count ?? 0) + " likes · " + (p.comments_count ?? 0) + " comments"}</span>
            </span>
          </Link>
        ))
      )}
    </div>
  );
}