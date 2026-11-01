"use client";

import Link from "next/link";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { RelativeTime } from "@/components/RelativeTime";
import { SharedPostThumbnail } from "@/components/SharedPostThumbnail";
import { useSharedPostPreview } from "@/lib/useSharedPostPreview";
import { sharedPostMediaLabel } from "../../shared/sharedPostPreview";

export function SharedPostCard({ postId }: { postId: string }) {
  const p = useSharedPostPreview(postId);

  if (p === undefined) return <span className="block text-[12px] text-muted">Loading post</span>;
  if (p === null) return <span className="block text-[12px] text-muted">This post is no longer available</span>;

  return (
    <Link href={"/post/" + postId} className="flex w-60 gap-2.5 rounded-lg border border-ink/15 bg-white p-2.5 text-ink transition-colors hover:bg-surface-elevated">
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5 text-[12px]">
          <span className="truncate font-semibold text-ink">{p.author?.full_name ?? "Member"}</span>{p.author?.id ? <VerifiedBadge userId={p.author.id} size={12} /> : null}
          <span className="shrink-0 text-muted"><RelativeTime dateTime={p.created_at} /></span>
        </span>
        <span className="mt-0.5 line-clamp-3 block text-[13px] text-ink/80">{p.content?.trim() || p.body?.trim() || (p.media ? sharedPostMediaLabel(p.media, p.mediaCount) : "Open post")}</span>
      </span>
      {p.media ? <SharedPostThumbnail postId={postId} media={p.media} mediaCount={p.mediaCount} /> : null}
    </Link>
  );
}
