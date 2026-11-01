import type { ReactExport } from './reactVideoComposition';

type DraftMedia = { uri: string; reactSource?: ReactExport['source'] };

/** The preview and persisted quote share the original carried by the media. */
export function reactDraftAttribution(media: readonly DraftMedia[], quotedPostId?: string | null) {
  const source = media.find(item => item.reactSource?.postId)?.reactSource ?? null;
  const postId = source?.postId || quotedPostId || null;
  const conflict = !!postId && (
    !!quotedPostId && quotedPostId !== postId
    || media.some(item => !!item.reactSource?.postId && item.reactSource.postId !== postId)
  );
  return { postId, source, conflict };
}

export function reactCaptureAppendStatus(
  media: readonly DraftMedia[], capture: ReactExport, quotedPostId: string | null | undefined, publicationBusy: boolean,
): 'ready' | 'added' | 'busy' | 'full' | 'source' {
  if (media.some(item => item.uri === capture.uri && item.reactSource)) return 'added';
  if (publicationBusy) return 'busy';
  if (media.length >= 10) return 'full';
  if (reactDraftAttribution([...media, { uri: capture.uri, reactSource: capture.source }], quotedPostId).conflict) return 'source';
  return 'ready';
}

export function reactCapturePendingMessage(status: ReturnType<typeof reactCaptureAppendStatus>) {
  if (status === 'busy') return 'Your React video is kept here. Finish this post to add it to your next draft.';
  if (status === 'full') return 'Your React video is kept here. Remove one item or finish this post to add it.';
  if (status === 'source') return 'Your React video is kept here for your next post. This draft already credits a different original.';
  return 'Your React video is ready. Adding it to this draft…';
}
