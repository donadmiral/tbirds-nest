"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { getMemoryAlbum, COVER_COLORS, type MemoryAlbum } from "@/lib/memoryAlbum";

export function MemoryAlbumBook({ profileId }: { profileId: string }) {
  const [album, setAlbum] = useState<MemoryAlbum | null>(null);

  useEffect(() => {
    let on = true;
    getMemoryAlbum(profileId).then((a) => { if (on) setAlbum(a); });
    return () => { on = false; };
  }, [profileId]);

  if (!album) return null;
  if (!album.is_owner && (!album.can_view || album.count === 0)) return null;

  const c = COVER_COLORS[album.cover_color] ?? COVER_COLORS.blush;

  return (
    <div className="px-1 pb-5">
      <Link href={"/album/" + profileId} className="group inline-flex items-center gap-3">
        <span className="relative block h-[92px] w-[74px]">
          <span className="absolute left-[4px] top-[4px] block h-[84px] w-[66px] rounded-r-[10px] rounded-l-[6px]" style={{ background: c.spine, opacity: 0.55 }} />
          <span className="absolute left-0 top-0 flex h-[84px] w-[66px] overflow-hidden rounded-r-[10px] rounded-l-[6px] border border-ink/10 transition-transform group-hover:-translate-y-0.5" style={{ background: c.cover }}>
            <span className="block h-full w-[12px]" style={{ background: c.spine }} />
            <span className="flex flex-1 flex-col items-center justify-center gap-1 px-1">
              <Heart size={14} style={{ color: c.text }} />
              <span className="text-center font-display text-[11px] leading-tight" style={{ color: c.text }}>{album.title}</span>
            </span>
          </span>
        </span>
        <span>
          <span className="block text-[13px] font-semibold text-ink">Memory album</span>
          <span className="block text-[12px] text-ink/50">
            {album.count === 0 ? "Add your first memory" : album.count + (album.count === 1 ? " memory" : " memories") + " · tap to open"}
          </span>
        </span>
      </Link>
    </div>
  );
}