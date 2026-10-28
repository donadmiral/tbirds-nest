import type { ReviewMedia } from '../components/MediaPreview';

type StoryKind = 'Photo' | 'Video' | 'Text' | 'Shared post';
type MediaReference = {
  url: string;
  video: boolean;
  entityKind: 'story' | 'post';
  entityId: string;
  width?: number;
  height?: number;
};
type StorySource = { id: string; kind: StoryKind; caption: string; references: MediaReference[] };
export type StoryPresentation = {
  id: string;
  kind: StoryKind;
  caption: string;
  mediaCount: number;
  hasVideo: boolean;
  gallery: ReviewMedia[];
};
export type ModerationMediaResolver = (
  values: (string | null | undefined)[], kind: 'story' | 'post', entityIds: string[],
) => Promise<Record<string, string>>;

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|hevc|avi|mkv|3gp)(?:[?#]|$)/i;
const IMAGE = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)(?:[?#]|$)/i;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const dimension = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
function sourceUrl(value: unknown): string | null {
  const url = text(value);
  // Storage location and ownership are checked by the existing resolver. Never
  // treat draft-local files, data URLs or arbitrary text as published media.
  return url && url.length <= 4096 && /^(?:https?:\/\/|(?:post-media|story-media|media)\/)/i.test(url) ? url : null;
}
function mediaType(value: unknown): 'image' | 'video' | null {
  const type = text(value).toLowerCase();
  if (type === 'video' || type.startsWith('video/')) return 'video';
  if (type === 'photo' || type === 'image' || type.startsWith('image/')) return 'image';
  return null;
}

/** Select only fields that the story canvas actually renders as content. */
export function storyPresentationSource(story: Record<string, unknown>): StorySource {
  const id = text(story.id), references: MediaReference[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, entityKind: 'story' | 'post', entityId: string, hint?: unknown, width?: unknown, height?: unknown) => {
    const url = sourceUrl(value);
    if (!url || !UUID.test(entityId)) return;
    const key = `${entityKind}:${entityId}:${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push({ url, entityKind, entityId, video: mediaType(hint) === 'video' || VIDEO.test(url), width: dimension(width), height: dimension(height) });
  };
  const primary = sourceUrl(story.media_url), primaryType = mediaType(story.media_type);
  // A text story may contain a shared-post sticker; that post is not its
  // primary story media. Thumbnail, author avatar, links and audio are metadata.
  if (primary && (primaryType || (!text(story.media_type) && (VIDEO.test(primary) || IMAGE.test(primary))))) {
    add(primary, 'story', id, primaryType, story.width, story.height);
  }
  add(story.dual_front_url, 'story', id, 'image');

  const stickers = Array.isArray(story.stickers_json) ? story.stickers_json : [];
  const storyText: string[] = [], postText: string[] = [];
  let sharedPost = false;
  for (const value of stickers) {
    const sticker = object(value);
    if (!sticker) continue;
    if (!sticker.kind || sticker.kind === 'text' || sticker.kind === 'emoji') {
      if (text(sticker.text)) storyText.push(text(sticker.text));
    } else if (sticker.kind === 'photo') {
      add(sticker.photoUrl || sticker.photoUri, 'story', id, 'image');
    } else if (sticker.kind === 'video') {
      add(sticker.videoUrl || sticker.videoUri || sticker.url, 'story', id, 'video');
    } else if (sticker.kind === 'gif') {
      add(sticker.gifUrl, 'story', id, 'image');
    } else if (sticker.kind === 'post' && UUID.test(text(sticker.postId))) {
      sharedPost = true;
      const postId = text(sticker.postId);
      add(sticker.postMediaUrl, 'post', postId, sticker.postMediaType, sticker.postMediaWidth, sticker.postMediaHeight);
      const caption = text(sticker.postText) || text(sticker.postArticleTitle);
      if (caption) postText.push(caption);
    }
  }
  return {
    id,
    kind: sharedPost ? 'Shared post' : references.some(item => item.video) ? 'Video' : references.length ? 'Photo' : 'Text',
    caption: text(story.caption) || storyText.join('\n') || postText.join('\n'),
    references,
  };
}

/** Embedded posts use their own content grants, never the containing story's. */
export async function resolveStoryPresentations(stories: Record<string, unknown>[], resolve: ModerationMediaResolver): Promise<StoryPresentation[]> {
  const sources = stories.map(storyPresentationSource);
  const refs = sources.flatMap(source => source.references);
  const own = refs.filter(ref => ref.entityKind === 'story'), posts = refs.filter(ref => ref.entityKind === 'post');
  const [storyUrls, postUrls] = await Promise.all([
    own.length ? resolve(own.map(ref => ref.url), 'story', [...new Set(own.map(ref => ref.entityId))]) : Promise.resolve({} as Record<string, string>),
    posts.length ? resolve(posts.map(ref => ref.url), 'post', [...new Set(posts.map(ref => ref.entityId))]) : Promise.resolve({} as Record<string, string>),
  ]);
  return sources.map(source => ({
    id: source.id, kind: source.kind, caption: source.caption,
    mediaCount: source.references.length,
    hasVideo: source.references.some(ref => ref.video),
    gallery: source.references.flatMap(ref => {
      const url = (ref.entityKind === 'post' ? postUrls : storyUrls)[ref.url];
      return url ? [{ url, video: ref.video, width: ref.width, height: ref.height }] : [];
    }),
  }));
}
