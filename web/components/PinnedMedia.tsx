"use client";

import { useEffect, useState } from "react";
import { MediaGallery, type ViewerPost } from "@/components/MediaGallery";

type Media = Parameters<typeof MediaGallery>[0]["media"];

/**
 * The post page's pinned video: it sticks to the top of the screen on phones
 * and to the left column on desktop while the caption and comments scroll,
 * so the video and the thread stay in view together. The box keeps the feed
 * card's own frame, scaled to leave the comments their room.
 */
export function PinnedMedia({ media, postId, viewsCount, aspect, post, topOffset = 0 }: { media: Media; postId: string; viewsCount?: number | null; aspect: number; post?: ViewerPost; topOffset?: number }) {
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const calc = () => {
      const lg = window.innerWidth >= 1024;
      const cap = (lg ? 0.82 : 0.42) * window.innerHeight;
      setW(Math.max(160, Math.round(cap / aspect)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [aspect]);
  return (
    <div className="sticky z-20 -mx-4 bg-black lg:mx-0 lg:overflow-hidden lg:rounded-2xl" style={{ top: topOffset }}>
      <div className="mx-auto" style={{ width: w ? "min(100%, " + w + "px)" : "100%" }}>
        <MediaGallery media={media} postId={postId} viewsCount={viewsCount ?? null} post={post} />
      </div>
    </div>
  );
}