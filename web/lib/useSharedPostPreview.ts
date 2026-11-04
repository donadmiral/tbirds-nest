"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { sharedPostPreview } from "../../shared/sharedPostPreview";
import { hydratePostMedia, withoutPrivateMedia } from "./contentMedia";
import { createClient } from "./supabase/client";
import { withTimeout } from "./withTimeout";
import { getNavigationStore } from "./navigationCache";
import { isAccessDeniedError } from "./errors";
import { imageDisplayIdentity } from "../../shared/imageDisplayIdentity";

export type SharedPostPreview = ReturnType<typeof sharedPostPreview> & {
  content: string | null;
  body: string | null;
  created_at: string;
  author: { id: string; full_name: string | null; username: string | null } | null;
};

/** Source access and async ownership are the same for a quote and a chat share. */
export function useSharedPostPreview(postId: string): SharedPostPreview | null | undefined {
  const [supabase] = useState(createClient);
  const [navigation] = useState(getNavigationStore);
  const { scope, initialized } = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getServerSnapshot);
  const [snapshot, setSnapshot] = useState<{ postId: string; scope: string | null; value: SharedPostPreview | null } | null>(null);
  useEffect(() => {
    if (!initialized) return;
    let live = true, version = 0;
    let previous: { authorId: string; mediaIdentity: string; value: SharedPostPreview } | null = null;
    const load = async () => {
      const run = ++version;
      const isCurrent = () => live && run === version && navigation.getSnapshot().scope === scope;
      try {
        const { data, error } = await withTimeout(supabase.from("posts")
          .select("id, content, body, created_at, user_id, media_url, image_url, post_media(url, media_type, sort_order, edit)")
          .eq("id", postId).maybeSingle());
        if (error) throw error;
        if (!isCurrent()) return;
        if (data === null) { previous = null; setSnapshot({ postId, scope, value: null }); return; }
        if (!data || data.id !== postId || typeof data.user_id !== "string" || typeof data.created_at !== "string"
          || (data.content !== null && typeof data.content !== "string") || (data.body !== null && typeof data.body !== "string")
          || (data.post_media != null && !Array.isArray(data.post_media))) throw new Error("Incomplete source post response");
        const source = [{ ...data, post_id: postId }];
        const stripped = withoutPrivateMedia(source)[0];
        // A freshly authorized legacy row may have only media_url/image_url.
        // Stripping that private URL must not also remove its thumbnail slot.
        // Preserve only type/count, with no original URL or private poster.
        const mediaShape = (({ media, mediaCount }) => media
          ? { media: { url: "", media_type: media.media_type, thumbnail_url: null }, mediaCount }
          : null)(sharedPostPreview(data));
        const previewMedia = (row: Parameters<typeof sharedPostPreview>[0]) => {
          const safe = sharedPostPreview(row);
          return safe.media || !mediaShape ? safe : mediaShape;
        };
        // The source query authorized this post again. Keep its existing
        // thumbnail and author while independent replacement requests run.
        // Changed authors or media start from the stripped source instead.
        const sourcePreview = sharedPostPreview(data), sourceMedia = sourcePreview.media;
        const mediaIdentity = JSON.stringify([sourcePreview.mediaCount, sourceMedia?.media_type ?? null,
          sourceMedia ? imageDisplayIdentity(sourceMedia.url, process.env.NEXT_PUBLIC_SUPABASE_URL!) : null,
          sourceMedia?.thumbnail_url ? imageDisplayIdentity(sourceMedia.thumbnail_url, process.env.NEXT_PUBLIC_SUPABASE_URL!) : null]);
        const retained = previous?.authorId === data.user_id ? previous : null;
        let preview: SharedPostPreview = {
          content: stripped.content, body: stripped.body, created_at: stripped.created_at,
          author: retained?.value.author ?? null,
          ...(retained?.mediaIdentity === mediaIdentity
            ? { media: retained.value.media, mediaCount: retained.value.mediaCount }
            : previewMedia(stripped)),
        };
        const publish = (patch: Partial<SharedPostPreview>) => {
          if (!isCurrent()) return;
          preview = { ...preview, ...patch };
          previous = { authorId: data.user_id, mediaIdentity, value: preview };
          setSnapshot({ postId, scope, value: preview });
        };
        publish({});

        // Neither enrichment blocks the other. A late author response updates
        // only the author, preserving any image that has already been granted.
        const loadAuthor = async () => {
          try {
            const { data: author, error: authorError } = await withTimeout(supabase.from("profiles")
              .select("full_name, username").eq("id", data.user_id).maybeSingle());
            if (authorError) throw authorError;
            if (author === null) { publish({ author: null }); return; }
            if (!author || (author.full_name !== null && typeof author.full_name !== "string")
              || (author.username !== null && typeof author.username !== "string")) throw new Error("Incomplete source author response");
            publish({ author: { ...author, id: data.user_id } });
          } catch (reason) { if (isAccessDeniedError(reason)) publish({ author: null }); }
        };
        const loadMedia = async () => {
          try {
            const [granted] = await hydratePostMedia(source, supabase);
            publish(granted ? {
              content: granted.content, body: granted.body, created_at: granted.created_at,
              ...previewMedia(granted),
            } : previewMedia(stripped));
          } catch { publish(previewMedia(stripped)); }
        };
        void loadAuthor();
        void loadMedia();
      } catch (reason) { if (isCurrent() && (!previous || isAccessDeniedError(reason))) { previous = null; setSnapshot({ postId, scope, value: null }); } }
    };
    void load();
    const timer = setInterval(() => void load(), 240000);
    return () => { live = false; version++; clearInterval(timer); };
  }, [supabase, navigation, postId, scope, initialized]);
  return initialized && snapshot?.postId === postId && snapshot.scope === scope ? snapshot.value : undefined;
}
