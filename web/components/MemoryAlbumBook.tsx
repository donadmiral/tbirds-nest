"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, Plus } from "lucide-react";
import { COVER_COLORS, getMemoryBooks, type MemoryBookInfo } from "@/lib/memoryAlbum";

export function MemoryAlbumBook({ profileId }: { profileId: string }) {
  const [books, setBooks] = useState<MemoryBookInfo[]>([]);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    let on = true;
    getMemoryBooks(profileId).then((shelf) => {
      if (!on) return;
      setIsOwner(shelf.is_owner);
      setBooks(shelf.is_owner ? shelf.books : shelf.books.filter(b => (b.count ?? 0) > 0));
    });
    return () => { on = false; };
  }, [profileId]);

  if (books.length === 0) return null;

  return (
    <div className="px-1 pb-5">
      <p className="mb-2 text-[13px] font-semibold text-ink">Memory books</p>
      <div className="flex gap-4 overflow-x-auto pb-1">
        {books.map(b => {
          const c = COVER_COLORS[b.cover_color] ?? COVER_COLORS.blush;
          return (
            <Link key={b.id} href={"/album/" + b.id} className="group shrink-0 text-center">
              <span className="relative block h-[92px] w-[74px]">
                <span className="absolute left-[4px] top-[4px] block h-[84px] w-[66px] rounded-r-[10px] rounded-l-[6px]" style={{ background: c.spine, opacity: 0.55 }} />
                <span className="absolute left-0 top-0 flex h-[84px] w-[66px] overflow-hidden rounded-r-[10px] rounded-l-[6px] border border-ink/10 transition-transform group-hover:-translate-y-0.5" style={{ background: c.cover }}>
                  <span className="block h-full w-[12px]" style={{ background: c.spine }} />
                  <span className="flex flex-1 flex-col items-center justify-center gap-1 px-1">
                    <Heart size={13} style={{ color: c.text }} />
                    <span className="line-clamp-2 text-center font-display text-[10.5px] leading-tight" style={{ color: c.text }}>{b.title}</span>
                  </span>
                </span>
              </span>
              <span className="mt-1 block w-[74px] truncate text-[11px] text-ink/50">{b.count === 1 ? "1 memory" : String(b.count ?? 0) + " memories"}</span>
            </Link>
          );
        })}
        {isOwner ? (
          <span className="flex h-[92px] w-[74px] shrink-0 items-center justify-center rounded-[10px] border border-dashed border-ink/20 text-ink/30" title="Create books in the app"><Plus size={18} /></span>
        ) : null}
      </div>
    </div>
  );
}
