"use client";

import { useEffect, useState } from "react";
import { BookHeart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { addMemoryPage } from "@/lib/memoryAlbum";
import type { StoryRow } from "@/lib/stories";

export function SaveToMemory({ story }: { story: StoryRow }) {
  const [uid, setUid] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null));
  }, []);
  useEffect(() => { setState("idle"); }, [story.id]);

  if (!uid || uid !== story.user_id) return null;

  return (
    <button
      onClick={async () => {
        if (state !== "idle") return;
        setState("saving");
        const ok = await addMemoryPage(story.id);
        setState(ok ? "saved" : "idle");
      }}
      className="absolute bottom-16 right-3 z-20 flex items-center gap-1.5 rounded-full bg-white/90 px-3.5 py-2 text-[12px] font-semibold text-ink backdrop-blur transition-opacity hover:opacity-90"
    >
      <BookHeart size={14} />
      {state === "saved" ? "In your album" : state === "saving" ? "Saving" : "Save to memory album"}
    </button>
  );
}