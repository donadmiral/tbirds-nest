"use client";

import { useEffect, useState } from "react";
import { sharedPostPreview } from "../../shared/sharedPostPreview";
import { hydratePostMedia, withoutPrivateMedia } from "./contentMedia";
import { createClient } from "./supabase/client";
import { withTimeout } from "./withTimeout";

export type SharedPostPreview = ReturnType<typeof sharedPostPreview> & {
  content: string | null;
  body: string | null;
  created_at: string;
  author: { id: string; full_name: string | null; username: string | null } | null;
};

/** Source access and async ownership are the same for a quote and a chat share. */
export function useSharedPostPreview(postId: string): SharedPostPreview | null | undefined {
  const [supabase] = useState(createClient);
  const [snapshot, setSnapshot] = useState<{ postId: string; value: SharedPostPreview | null } | null>(null);
  useEffect(() => {
    let live = true, version = 0;
    const load = async () => {
      const run = ++version;
      const isCurrent = () => live && run === version;
      try {
        const { data, error } = await withTimeout(supabase.from("posts")
          .select("id, content, body, created_at, user_id, media_url, image_url, post_media(url, media_type, sort_order, edit)")
          .eq("id", postId).maybeSingle());
        if (error) throw error;
        if (!isCurrent()) return;
        if (!data) { setSnapshot({ postId, value: null }); return; }
        const source = [{ ...data, post_id: postId }];
        const stripped = withoutPrivateMedia(source)[0];
        // The source query already authorized this post. Its text and media
        // type can render now, with private URLs removed until granted.
        let preview: SharedPostPreview = {
          content: stripped.content, body: stripped.body, created_at: stripped.created_at,
          author: null, ...sharedPostPreview(stripped),
        };
        const publish = (patch: Partial<SharedPostPreview>) => {
          if (!isCurrent()) return;
          preview = { ...preview, ...patch };
          setSnapshot({ postId, value: preview });
        };
        publish({});

        // Neither enrichment blocks the other. A late author response updates
        // only the author, preserving any image that has already been granted.
        const loadAuthor = async () => {
          try {
            const { data: author, error: authorError } = await withTimeout(supabase.from("profiles")
              .select("full_name, username").eq("id", data.user_id).maybeSingle());
            if (!authorError) publish({ author: author ? { ...author, id: data.user_id } : null });
          } catch { /* The source preview remains usable without its label. */ }
        };
        const loadMedia = async () => {
          try {
            const [granted] = await hydratePostMedia(source, supabase);
            if (granted) publish({
              content: granted.content, body: granted.body, created_at: granted.created_at,
              ...sharedPostPreview(granted),
            });
          } catch { /* Keep the stripped source; never fall back to private originals. */ }
        };
        void loadAuthor();
        void loadMedia();
      } catch { if (isCurrent()) setSnapshot({ postId, value: null }); }
    };
    void load();
    const timer = setInterval(() => void load(), 240000);
    const { data } = supabase.auth.onAuthStateChange(() => {
      version++; setSnapshot(null);
      queueMicrotask(() => { if (live) void load(); });
    });
    return () => { live = false; version++; clearInterval(timer); data.subscription.unsubscribe(); };
  }, [supabase, postId]);
  return snapshot?.postId === postId ? snapshot.value : undefined;
}
