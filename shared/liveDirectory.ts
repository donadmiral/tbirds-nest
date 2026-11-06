/** Bounded UI contracts. A visible Live destination does not enable broadcasting. */
export const LIVE_TOPICS = [
  ['all','All'], ['irl','IRL'], ['gaming','Gaming'], ['news','News'], ['politics','Politics'],
  ['business','Business'], ['music','Music'], ['concerts','Concerts'], ['education','Education'],
  ['sports','Sports'], ['events','Events'], ['communities','Communities'], ['other','Other'],
] as const;
export type LiveFilter = 'for_you' | 'following' | 'followers' | 'celebrities' | 'mine';
export type LiveView = 'live' | 'scheduled' | 'replay';
export type LiveSession = {
  id: string; title: string; description: string; topic: string; state: string;
  audience: string; language: string; chat_mode: string; slow_mode_seconds: number; recording_enabled: boolean; started_at: string | null; ended_at: string | null; thumbnail_url: string | null; has_cover: boolean;
  viewer_count: number | null; scheduled_at: string | null; replay_available: boolean;
  host: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean };
};
export type LiveCursor = { created_at: string; id: string };
export type LiveCapabilities = { create: boolean; broadcast: boolean; view: boolean; reminders: boolean };
export type LiveDirectory = { items: LiveSession[]; next_cursor: LiveCursor | null; capabilities: LiveCapabilities };
export const NO_LIVE_CAPABILITIES: LiveCapabilities = { create: false, broadcast: false, view: false, reminders: false };
export function isLiveUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
const obj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
export function safeLiveImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function parseLiveSession(value: unknown): LiveSession | null {
  if (!obj(value) || !isLiveUuid(value.id) || !obj(value.host) || !isLiveUuid(value.host.id)) return null;
  const state = text(value.state, 24);
  if (!['draft','scheduled','backstage','starting','live','reconnecting','ending','ended','cancelled'].includes(state)) return null;
  return { id: value.id, title: text(value.title, 120), description: text(value.description, 2000),
    topic: text(value.topic, 30), state, audience: text(value.audience, 20), language: text(value.language, 20),
    chat_mode: ['open','followers','closed'].includes(String(value.chat_mode)) ? String(value.chat_mode) : 'open', slow_mode_seconds: Math.min(120,Math.max(0,Number(value.slow_mode_seconds)||0)), recording_enabled:value.recording_enabled===true, started_at:date(value.started_at), ended_at:date(value.ended_at),
    thumbnail_url: safeLiveImage(value.thumbnail_url), has_cover: value.has_cover === true,
    viewer_count: typeof value.viewer_count === 'number' && Number.isSafeInteger(value.viewer_count) && value.viewer_count >= 0 ? value.viewer_count : null,
    scheduled_at: date(value.scheduled_at), replay_available: value.replay_available === true,
    host: { id: value.host.id, full_name: text(value.host.full_name, 150) || null, username: text(value.host.username, 100) || null,
      avatar_url: safeLiveImage(value.host.avatar_url), is_verified: value.host.is_verified === true },
  };
}
export function parseLiveCapabilities(value: unknown): LiveCapabilities {
  return obj(value) ? { create: value.create === true, broadcast: value.broadcast === true, view: value.view === true, reminders: value.reminders === true } : NO_LIVE_CAPABILITIES;
}
export function parseLiveDirectory(value: unknown): LiveDirectory {
  if (!obj(value) || !Array.isArray(value.items) || value.items.length > 24) throw new Error('Invalid live directory response');
  const cursor = value.next_cursor;
  if (cursor != null && (!obj(cursor) || !isLiveUuid(cursor.id) || !date(cursor.created_at))) throw new Error('Invalid live cursor');
  const items = value.items.map(parseLiveSession);
  if (items.some(item => item === null)) throw new Error('Invalid live session');
  return { items: items as LiveSession[], next_cursor: cursor == null ? null : cursor as LiveCursor, capabilities: parseLiveCapabilities(value.capabilities) };
}
export function liveStateLabel(session: Pick<LiveSession, 'state' | 'replay_available'>): string {
  if (session.state === 'live') return 'LIVE';
  if (session.state === 'ended' && session.replay_available) return 'REPLAY';
  return ({ reconnecting: 'RECONNECTING', scheduled: 'SCHEDULED', starting: 'STARTING', ending: 'ENDING', ended: 'ENDED', cancelled: 'CANCELLED', backstage: 'PREVIEW', draft: 'DRAFT' } as Record<string,string>)[session.state] || 'UNAVAILABLE';
}
export function isLiveSetupMissing(error: unknown): boolean {
  return obj(error) && ['PGRST202','PGRST205','42883'].includes(String(error.code));
}
