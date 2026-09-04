"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StoryAvatar } from "@/components/StoryAvatar";
import { FollowButton } from "@/components/FollowButton";

type Liker = { id: string; full_name: string | null; username: string | null; avatar_url: string | null };

export function LikesModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const supabase = useRef(createClient()).current;
  const [likers, setLikers] = useState<Liker[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase.from("post_likes").select("user_id").eq("post_id", postId).limit(100);
      const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id as string)));
      if (ids.length === 0) { setLikers([]); return; }
      const { data: profs } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
      setLikers((profs ?? []) as Liker[]);
    })();
  }, [supabase, postId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[70vh] w-full max-w-sm overflow-y-auto rounded-xl border border-ink/10 bg-navy p-4">
        <div className="flex items-center justify-between pb-2">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink"><Heart size={15} className="text-danger" fill="currentColor" /> Likes</h2>
          <button onClick={onClose} title="Close" className="rounded-full p-1 text-ink/50 hover:bg-surface hover:text-ink"><X size={16} /></button>
        </div>
        {likers === null ? (
          <p className="py-8 text-center text-sm text-ink/40">Loading</p>
        ) : likers.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/40">No likes yet.</p>
        ) : (
          likers.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 py-2">
              <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={38} href={p.username ? "/" + p.username : null} />
              <Link href={p.username ? "/" + p.username : "#"} className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{p.full_name} <VerifiedBadge userId={p.id} size={13} /></span>
                <span className="block truncate text-[12px] text-ink/45">@{p.username}</span>
              </Link>
              <FollowButton authorId={p.id} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}