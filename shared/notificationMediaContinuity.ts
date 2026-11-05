import { canonicalContentMedia, replaceContentMedia } from './contentMedia';
import { reuseFeedMediaGrants } from './feedMediaReuse';

export type NotificationMediaSource = { id: string; _mediaExpiresAt?: number; [key: string]: any };
export type NotificationMediaSnapshot = { scope: string | null; posts: NotificationMediaSource[]; stories: NotificationMediaSource[] };

export function retainNotificationSources(previous: NotificationMediaSource[], incoming: NotificationMediaSource[], base: string, previousScope: string | null, scope: string | null) {
  return reuseFeedMediaGrants(previous, incoming, base, previousScope, scope).map((row, index) =>
    row === incoming[index] ? replaceContentMedia(row, base, new Map()) : row);
}

export function notificationMediaKeys(rows: Array<{ post_id?: string | null; data?: any }>) {
  return {
    posts: new Set<string>(rows.map(row => row.post_id || row.data?.post_id).filter(Boolean)),
    stories: new Set<string>(rows.map(row => row.data?.story_id).filter(Boolean)),
  };
}

export function retainNotificationSnapshot(previous: NotificationMediaSnapshot, rows: Array<{ post_id?: string | null; data?: any }>, base: string, scope: string | null): NotificationMediaSnapshot {
  const keys = notificationMediaKeys(rows);
  return { scope,
    posts: retainNotificationSources(previous.posts, canonicalContentMedia(previous.posts.filter(row => keys.posts.has(row.id)), base), base, previous.scope, scope),
    stories: retainNotificationSources(previous.stories, canonicalContentMedia(previous.stories.filter(row => keys.stories.has(row.id)), base), base, previous.scope, scope),
  };
}

export function notificationThumbnails(snapshot: NotificationMediaSnapshot): Record<string, string> {
  const result: Record<string, string> = {};
  for (const post of snapshot.posts) {
    const media = [...(post.post_media || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const url = media.find(item => item.media_type === 'image')?.url
      || (post.media_url && !/\.(mp4|mov|m4v)($|\?)/i.test(post.media_url) ? post.media_url : null);
    if (url) result['p:' + post.id] = url;
  }
  for (const story of snapshot.stories) {
    const url = story.thumbnail_url || (story.media_type !== 'video' ? story.media_url : null);
    if (url) result['s:' + story.id] = url;
  }
  return result;
}

export function retainNotificationRows<T extends { notification_id: string; actor_id?: string | null }>(previous: T[], incoming: T[], base: string, previousScope: string | null, scope: string | null): T[] {
  const wrap = (rows: T[]) => rows.map(row => ({ ...row, id: row.notification_id, user_id: row.actor_id || undefined }));
  return retainNotificationSources(wrap(previous), wrap(incoming), base, previousScope, scope)
    .map(({ id: _id, user_id: _user, ...row }) => row as T);
}
