import { createStartupSnapshot } from './startupSnapshots';
import { snapshotBytes } from './startupSnapshotCore';
import type { Conversation } from './navigationInbox';
import type { CatchupMode, CatchupUser } from './storiesService';

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
const text = (value: unknown, length = 180) => typeof value === 'string' && !/(?:bearer\s|\/(?:functions\/v1\/media-content|storage\/v1\/object\/sign)\/|[?&](?:token|signature|x-amz-credential|x-amz-signature)=)/i.test(value) ? value.slice(0, length) : '';
const stamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
function boundedRows<T>(rows: T[], maximum = 22 * 1024): T[] {
  let size = 256;
  return rows.filter(row => { const bytes = snapshotBytes(JSON.stringify(row)) + 1; if (size + bytes > maximum) return false; size += bytes; return true; });
}
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100000000, Math.floor(value))) : 0;
function restricted(value: Record<string, any>) {
  return !!(value.view_limit || value.view_once || value.is_view_once || value.disappearing || value.disappearing_seconds || value.vanish
    || value.expires_at || value.private_expires_at || value.deleted_at || value.is_deleted || value.is_restricted || value.restricted
    || value._optimistic || value._queued || value.media_unavailable);
}
function avatar(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value), base = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL || '');
    if (url.origin !== base.origin || url.search || url.hash || url.username || url.password
      || !/^\/storage\/v1\/object\/public\/(?:avatars|profile-avatars)\/[^?]+$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
export type InboxStartup = { actorId: string; rows: Conversation[] };
export function sanitizeInboxStartup(value: unknown): InboxStartup | null {
  if (!record(value) || !id(value.actorId) || !Array.isArray(value.rows)) return null;
  const rows: Conversation[] = [];
  for (const item of value.rows.slice(0, 30)) {
    if (!record(item) || !id(item.id) || restricted(item) || item.is_archived || item.request_pending || item.group_type === 'community' || (item.context && item.context !== 'personal')) continue;
    rows.push({ id: item.id, other_user_id: id(item.other_user_id) || '', other_name: text(item.other_name, 100) || 'Member',
      other_username: text(item.other_username, 60) || null, other_avatar: avatar(item.other_avatar),
      last_message: text(item.last_message), last_message_time: stamp(item.last_message_time), unread_count: count(item.unread_count),
      is_group: item.is_group === true, group_emoji: text(item.group_emoji, 16) || null, group_avatar_url: null,
      group_type: text(item.group_type, 32) || null, group_ref_id: id(item.group_ref_id),
      request_pending: false, is_pinned: item.is_pinned === true, is_muted: item.is_muted === true, is_archived: false,
      context: 'personal', manually_unread: item.manually_unread === true, other_is_verified: item.other_is_verified === true,
      other_verified_tier: text(item.other_verified_tier, 32) || null, last_sender_id: id(item.last_sender_id), last_sender_name: text(item.last_sender_name, 60) || null });
  }
  return { actorId: value.actorId, rows: boundedRows(rows) };
}
export type StartupNotification = {
  notification_id: string; type: string; message: string | null; body_preview: string | null; data: Record<string, any>;
  read_at: string | null; created_at: string; actor_id: string | null; actor_name: string | null; actor_username: string | null;
  actor_avatar: string | null; others_count: number; other_avatars: string[] | null; post_id: string | null;
  post_thumb: null; post_text: string | null; viewer_follows: boolean; unread_in_group: number;
};
export function sanitizeNotificationStartup(value: unknown): StartupNotification[] | null {
  if (!Array.isArray(value)) return null;
  const rows: StartupNotification[] = [];
  for (const item of value.slice(0, 30)) {
    if (!record(item) || !id(item.notification_id) || !text(item.type, 64) || !stamp(item.created_at) || restricted(item) || (record(item.data) && restricted(item.data))) continue;
    const data: Record<string, any> = {};
    for (const key of ['post_id', 'comment_id', 'story_id', 'listing_id', 'conversation_id', 'job_id', 'community_id', 'business_id', 'request_id', 'session_id']) {
      if (id(item.data?.[key])) data[key] = item.data[key];
    }
    for (const key of ['community_name', 'job_title', 'status', 'emoji']) {
      if (text(item.data?.[key], 80)) data[key] = text(item.data[key], 80);
    }
    if (typeof item.data?.allow_reshare === 'boolean') data.allow_reshare = item.data.allow_reshare;
    rows.push({ notification_id: item.notification_id, type: text(item.type, 64), message: text(item.message) || null,
      body_preview: text(item.body_preview) || null, post_text: text(item.post_text) || null, data,
      read_at: stamp(item.read_at), created_at: item.created_at, actor_id: id(item.actor_id), actor_name: text(item.actor_name, 100) || null,
      actor_username: text(item.actor_username, 60) || null, actor_avatar: avatar(item.actor_avatar), others_count: count(item.others_count),
      other_avatars: Array.isArray(item.other_avatars) ? item.other_avatars.map(avatar).filter((url: string | null): url is string => !!url).slice(0, 3) : [],
      post_id: id(item.post_id), post_thumb: null, viewer_follows: item.viewer_follows === true, unread_in_group: count(item.unread_in_group) });
  }
  return boundedRows(rows);
}
export type StartupStory = CatchupUser & { latest_story_expires_at: string };
export type StoryStartup = { actorId: string; rows: StartupStory[] };
export function sanitizeStoryStartup(value: unknown): StoryStartup | null {
  if (!record(value) || !id(value.actorId) || !Array.isArray(value.rows)) return null;
  const rows: StartupStory[] = [];
  for (const item of value.rows.slice(0, 30)) {
    if (!record(item) || !id(item.user_id) || !id(item.latest_story_id) || !stamp(item.latest_story_at)
      || !stamp(item.latest_story_expires_at) || Date.parse(item.latest_story_expires_at) <= Date.now()) continue;
    rows.push({ user_id: item.user_id, full_name: text(item.full_name, 100) || null, username: text(item.username, 60) || null,
      avatar_url: avatar(item.avatar_url), story_count: count(item.story_count), unseen_count: count(item.unseen_count),
      latest_story_at: item.latest_story_at, latest_story_expires_at: item.latest_story_expires_at, latest_story_id: item.latest_story_id, has_unseen: item.has_unseen === true });
  }
  return { actorId: value.actorId, rows: boundedRows(rows, 10 * 1024) };
}
export const inboxStartup = createStartupSnapshot<InboxStartup>('inbox', { version: 1, ttlMs: 24 * 60 * 60000, maxBytes: 24 * 1024, storage: 'secure', sanitize: sanitizeInboxStartup });
export const notificationStartup = createStartupSnapshot<StartupNotification[]>('notifications', { version: 1, ttlMs: 24 * 60 * 60000, maxBytes: 24 * 1024, storage: 'secure', sanitize: sanitizeNotificationStartup });
export const storyStartup: Record<CatchupMode, ReturnType<typeof createStartupSnapshot<StoryStartup>>> = {
  all: createStartupSnapshot<StoryStartup>('stories-all', { version: 1, ttlMs: 24 * 60 * 60000, maxBytes: 12 * 1024, storage: 'secure', sanitize: sanitizeStoryStartup, expiresAt: value => value.rows.length ? Math.min(...value.rows.map(row => Date.parse(row.latest_story_expires_at))) : Number.MAX_SAFE_INTEGER }),
  primary: createStartupSnapshot<StoryStartup>('stories-primary', { version: 1, ttlMs: 24 * 60 * 60000, maxBytes: 12 * 1024, storage: 'secure', sanitize: sanitizeStoryStartup, expiresAt: value => value.rows.length ? Math.min(...value.rows.map(row => Date.parse(row.latest_story_expires_at))) : Number.MAX_SAFE_INTEGER }),
  global: createStartupSnapshot<StoryStartup>('stories-global', { version: 1, ttlMs: 24 * 60 * 60000, maxBytes: 12 * 1024, storage: 'secure', sanitize: sanitizeStoryStartup, expiresAt: value => value.rows.length ? Math.min(...value.rows.map(row => Date.parse(row.latest_story_expires_at))) : Number.MAX_SAFE_INTEGER }),
};
