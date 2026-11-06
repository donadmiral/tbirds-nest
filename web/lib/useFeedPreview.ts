'use client';

import { useSyncExternalStore } from 'react';
import { getFeedPreviewStore } from './feedPreviews';
import { previewObject, type FeedPreview } from './feedPreviewCache';
import { getNavigationStore } from './navigationCache';
const EMPTY = { owner: null, previews: [] as FeedPreview[] };
const empty = () => EMPTY;
const noop = () => () => {};

export function useFeedPreview(postId: string, media?: { id: string; url: string; _startupPreview?: boolean; _previewObject?: string; is_sensitive?: boolean | null; edit?: object | null }) {
  const store = getFeedPreviewStore(), navigation = getNavigationStore();
  const snapshot = useSyncExternalStore(store?.subscribe ?? noop, store?.getSnapshot ?? empty, empty);
  const session = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getServerSnapshot);
  if (!media || !session.owner || session.owner !== snapshot.owner || media.is_sensitive || (media.edit as { sensitive?: boolean } | null)?.sensitive) return null;
  const object = media._startupPreview ? media._previewObject : previewObject(media.url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  return snapshot.previews.find(item => item.postId === postId && item.mediaId === media.id && item.object === object) ?? null;
}
