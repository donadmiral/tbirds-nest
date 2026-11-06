import { isLiveUuid, safeLiveImage } from '../../shared/liveDirectory';
import { liveRpc, liveInvoke, record, type LiveClient } from './liveApi';
import { parseLiveClip, type ClipContext, type ClipSettings, type ClipSpec, type ClipSubtitle, type LiveClip } from '../../shared/liveClips';
export * from '../../shared/liveClips';

export type ClipPublication = { id: string; clip_id: string | null; platform: string; destination: string; state: string; error: string | null; created_at: string; retryable: boolean };
export type PlatformConnection = { platform: string; state: string; account_name: string; can_publish: boolean; connected_at: string | null };
export type ClipDetail = { clip: LiveClip; can_manage: boolean; can_publish: boolean; can_review: boolean; can_share_link: boolean; subtitles: ClipSubtitle[]; moderation_state: string; copyright_state: string; history: ClipPublication[]; cursor: unknown };
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';

export function parseClipSettings(input: unknown): ClipSettings {
  const value = record(input) ? input : {};
  return { viewer_clipping: value.viewer_clipping === true, review_required: value.review_required === true, watermark_required: value.watermark_required === true || value.watermark === true, brand_text: text(value.brand_text, 80), copyright_policy: ['owner_only', 'disabled'].includes(String(value.copyright_policy)) ? value.copyright_policy as ClipSettings['copyright_policy'] : 'standard', approved_user_ids: Array.isArray(value.approved_user_ids) ? value.approved_user_ids.filter(isLiveUuid).slice(0, 100) : [], can_manage: value.can_manage === true };
}
function parsePublications(input: unknown): ClipPublication[] {
  return (Array.isArray(input) ? input.slice(0, 25) : []).flatMap(value => record(value) && isLiveUuid(value.id) ? [{ id: value.id, clip_id: isLiveUuid(value.clip_id) ? value.clip_id : null, platform: text(value.platform || value.destination, 30), destination: text(value.destination, 30), state: text(value.state, 40), error: text(value.error, 250) || null, created_at: text(value.created_at, 40), retryable: value.retryable === true }] : []);
}

// This adapter is the only mapping between the editor and the database contracts.
// All writes retain the request identity supplied by the caller across retries.
export async function clipContext(client: LiveClient, sessionId: string): Promise<ClipContext> {
  const data = await liveRpc(client, 'live_clip_context', { p_session_id: sessionId });
  const value = record(data.context) ? data.context : data;
  return { session_id: sessionId, can_clip: value.can_clip === true, available_start_ms: Math.max(0, Number(value.available_start_ms) || 0), available_end_ms: Math.max(0, Number(value.available_end_ms) || 0), max_duration_ms: Math.min(600000, Number(value.max_duration_ms) || 600000), viewer_clipping: value.viewer_clipping === true, recording_available: value.recording_available === true, can_manage: value.can_manage === true, ...(record(value.settings) ? { settings: parseClipSettings({ ...value.settings, can_manage: value.can_manage }) } : {}) };
}
export function createLiveClip(client: LiveClient, sessionId: string, spec: ClipSpec, requestId: string) {
  return liveRpc(client, 'live_clip_command', { p_session_id: sessionId, p_clip_id: null, p_action: 'create', p_payload: spec, p_request_id: requestId });
}
export async function clipLibrary(client: LiveClient, sessionId: string | null, cursor: unknown = null, sort = 'newest') {
  const data = await liveRpc(client, 'live_clip_library', { p_session_id: sessionId, p_cursor: cursor, p_limit: 24, p_sort: sort });
  return { items: Array.isArray(data.items) ? data.items.slice(0, 24).map(parseLiveClip).filter((value): value is LiveClip => !!value) : [], cursor: record(data.next_cursor) ? data.next_cursor : null };
}
export function clipCommand(client: LiveClient, clip: LiveClip, action: string, payload: Record<string, unknown>, requestId: string) {
  return liveRpc(client, 'live_clip_command', { p_session_id: clip.session_id, p_clip_id: clip.id, p_action: action, p_payload: payload, p_request_id: requestId });
}
export async function clipDownload(client: LiveClient, clipId: string, format: string) {
  const data = await liveInvoke(client, 'live-clip-media', { clipId, format });
  const url = safeLiveImage(data.url), expiry = typeof data.expires_at === 'string' ? Date.parse(data.expires_at) : NaN;
  if (!url || !Number.isFinite(expiry) || expiry <= Date.now()) throw Error('INVALID_CLIP_ASSET');
  return { url, filename: text(data.filename, 150) || 'platinum-live-clip.mp4', expires_at: new Date(expiry).toISOString() };
}
export async function getLiveClip(client: LiveClient, clipId: string): Promise<ClipDetail> {
  const data = await liveRpc(client, 'live_clip_get', { p_clip_id: clipId });
  const clip = parseLiveClip(data.clip), permissions = record(data.permissions) ? data.permissions : data;
  if (!clip) throw Error('CLIP_NOT_FOUND');
  const history = record(data.publication_history) ? data.publication_history : {};
  const source = record(data.clip) ? data.clip : {};
  const subtitles: ClipSubtitle[] = (Array.isArray(source.subtitles) ? source.subtitles.slice(0, 500) : []).flatMap(cue => record(cue) && Number.isSafeInteger(cue.start_ms) && Number.isSafeInteger(cue.end_ms) && Number(cue.start_ms) >= 0 && Number(cue.end_ms) > Number(cue.start_ms) ? [{ start_ms: Number(cue.start_ms), end_ms: Number(cue.end_ms), text: text(cue.text, 500) }] : []);
  return { clip, can_manage: permissions.can_manage === true, can_publish: permissions.can_publish === true, can_review: permissions.can_review === true, can_share_link: permissions.can_share_link === true, subtitles, moderation_state: text(source.moderation_state, 30), copyright_state: text(source.copyright_state, 30), history: parsePublications(history.items), cursor: record(history.next_cursor) ? history.next_cursor : null };
}
export async function getClipHistory(client: LiveClient, clipId: string, cursor: unknown = null) {
  const data = await liveRpc(client, 'live_clip_history', { p_clip_id: clipId, p_cursor: cursor });
  return { items: parsePublications(data.items), cursor: record(data.next_cursor) ? data.next_cursor : null };
}
export async function getClipSettings(client: LiveClient, sessionId: string): Promise<ClipSettings> {
  const data = await liveRpc(client, 'live_clip_settings', { p_session_id: sessionId });
  return parseClipSettings(record(data.settings) ? { ...data.settings, can_manage: data.can_manage ?? data.settings.can_manage } : data);
}
export function saveClipSettings(client: LiveClient, sessionId: string, settings: ClipSettings, requestId: string) {
  const { can_manage: _permission, ...payload } = settings;
  return liveRpc(client, 'live_clip_command', { p_session_id: sessionId, p_clip_id: null, p_action: 'settings', p_payload: payload, p_request_id: requestId });
}
export async function getPlatformConnections(client: LiveClient, cursor: unknown = null) {
  const data = await liveRpc(client, 'live_platform_connections', { p_cursor: cursor });
  const items: PlatformConnection[] = (Array.isArray(data.items) ? data.items.slice(0, 10) : []).flatMap(value => record(value) && ['x', 'facebook', 'instagram', 'youtube', 'tiktok'].includes(String(value.platform)) ? [{ platform: String(value.platform), state: text(value.state, 30), account_name: text(value.account_name, 120), can_publish: value.can_publish === true, connected_at: typeof value.connected_at === 'string' ? value.connected_at : null }] : []);
  return { items, history: parsePublications(data.history), cursor: record(data.next_cursor) ? data.next_cursor : null };
}
