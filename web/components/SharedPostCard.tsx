"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/feed";

export function SharedPostCard({ postId }: { postId: string }) {
  const supabase = useRef(createClient()).current;
  const [p, setP] = useState<{ content: string | null; body: string | null; created_at: string; author: { full_name: string | null; username: string | null } | null; thumb: string | null; isVideo: boolean } | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("posts")
        .select("content, body, created_at, user_id, post_media(url, media_type, sort_order, edit)")
        .eq("id", postId)
        .maybeSingle();
      if (!data) { setP(null); return; }
      const { data: a } = await supabase.from("profiles").select("full_name, username").eq("id", data.user_id).maybeSingle();
      const media = (data.post_media ?? []).slice().sort((x: { sort_order: number }, y: { sort_order: number }) => x.sort_order - y.sort_order);
      const top = media[0] as { url: string; media_type?: string; edit?: { coverUrl?: string | null } | null } | undefined;
      const isVideo = top?.media_type === "video";
      setP({ content: data.content, body: data.body, created_at: data.created_at, author: a ?? null, thumb: (isVideo ? top?.edit?.coverUrl : top?.url) ?? null, isVideo });
    })();
  }, [supabase, postId]);

  if (p === undefined) return <span className="block text-[12px] text-ink/40">Loading post</span>;
  if (p === null) return <span className="block text-[12px] text-ink/40">This post is no longer available</span>;

  return (
    <Link href={"/post/" + postId} className="flex w-60 gap-2.5 rounded-lg border border-ink/15 p-2.5 transition-colors hover:bg-surface-elevated">
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5 text-[12px]">
          <span className="truncate font-semibold text-ink">{p.author?.full_name ?? "Member"}</span>
          <span className="shrink-0 text-ink/40">{timeAgo(p.created_at)}</span>
        </span>
        <span className="mt-0.5 line-clamp-3 block text-[13px] text-ink/80">{p.content ?? p.body ?? ""}</span>
      </span>
      {p.thumb ? (
        <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.thumb} alt="" className="h-full w-full object-cover" />
          {p.isVideo ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            </span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}