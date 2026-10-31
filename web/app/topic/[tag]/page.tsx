"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StoryAvatar } from "@/components/StoryAvatar";
import { RichText } from "@/components/RichText";
import { RelativeTime } from "@/components/RelativeTime";
import { withTimeout } from "@/lib/withTimeout";

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
  const [supabase] = useState(createClient);
  const [posts, setPosts] = useState<TopicPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error: readError } = await withTimeout(supabase
        .from("posts")
        .select("id, user_id, content, body, created_at, likes_count, comments_count")
        .ilike("content", "%#" + clean + "%")
        .order("created_at", { ascending: false })
        .limit(40));
      if (readError) throw readError;
      const rows = (data ?? []) as TopicPost[];
      const ids = Array.from(new Set(rows.map((p) => p.user_id)));
      if (ids.length > 0) {
        const { data: authors, error: authorError } = await withTimeout(supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids));
        if (authorError) throw authorError;
        const map = new Map((authors ?? []).map((a) => [a.id, a]));
        rows.forEach((p) => { p.author = map.get(p.user_id) ?? null; });
      }
      if (active) { setPosts(rows); setError(null); }
    })().catch(() => { if (active) setError("Could not load this topic. Please try again."); });
    return () => { active = false; };
  }, [supabase, clean, attempt]);

  return (
    <div className="px-1">
      <h1 className="pb-3 font-display text-xl text-porcelain">#{clean}</h1>
      {error ? <div role="alert" className="py-8 text-sm text-danger"><p>{error}</p><button type="button" className="mt-3 underline" onClick={() => { setError(null); setAttempt(value => value + 1); }}>Try again</button></div> : posts === null ? (
        <p className="py-16 text-center text-sm text-muted">Loading</p>
      ) : posts.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">No posts with this topic yet.</p>
      ) : (
        posts.map((p) => (
          <Link key={p.id} href={"/post/" + p.id} className="flex gap-3 border-b border-ink/10 px-1 py-4 transition-colors hover:bg-surface">
            <StoryAvatar userId={p.user_id} name={p.author?.full_name} avatarUrl={p.author?.avatar_url} size={44} href={p.author?.username ? "/" + p.author.username : null} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[14px]">
                <span className="truncate font-semibold text-ink">{p.author?.full_name ?? "Member"} <VerifiedBadge userId={p.user_id} size={13} /></span>
                <span className="truncate text-muted">@{p.author?.username}</span>
                <span className="text-muted">·</span>
                <span className="shrink-0 text-muted"><RelativeTime dateTime={p.created_at} /></span>
              </span>
              <span className="mt-0.5 block whitespace-pre-wrap text-[14px] text-ink/85">
                <RichText text={(p.content ?? p.body ?? "").slice(0, 400)} />
              </span>
              <span className="mt-1 block text-[12px] text-muted">{(p.likes_count ?? 0) + " likes · " + (p.comments_count ?? 0) + " comments"}</span>
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
