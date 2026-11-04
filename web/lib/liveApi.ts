import { createClient } from './supabase/client';
import { withTimeout } from './withTimeout';
import { isLiveUuid, parseLiveSession, safeLiveImage, type LiveCursor, type LiveSession } from '../../shared/liveDirectory';

export type LiveClient = ReturnType<typeof createClient>;
export type LiveRole = 'host' | 'producer' | 'camera' | 'guest' | 'moderator' | 'viewer';
export type LiveMessage = { id: string; session_id: string; user_id: string; body: string; created_at: string; removed: boolean; role: string; author: { id: string; full_name: string | null; username: string | null } };
export type LiveMember = { user_id: string; role: LiveRole; status: string; profile: { full_name?: string; username?: string } };
export type LiveJoinRequest = { user_id: string; status: 'pending'; created_at: string; profile: { full_name?: string; username?: string; avatar_url?: string } };
export type LiveDetail = { session: LiveSession; role: LiveRole; capabilities: Record<string, unknown>; members: LiveMember[]; chat_topic: string; reminded: boolean; pinned_message: LiveMessage | null; invitation: { role: LiveRole; status: string } | null; join_requests: LiveJoinRequest[]; own_join_request: { status: 'pending'|'accepted'|'declined'|'cancelled'; created_at: string; updated_at: string } | null; stage: { limit: number; occupied: number; available: number }; can_request_join: boolean; guest_topic: string; stage_guest_identities: string[]; output_orientation: 'portrait'|'landscape'|null; };
export type LivePlayback = { url: string; expires_at: string; format: 'hls'; live: boolean; poster_url: string | null; tracks: { src: string; language: string; label: string }[] };
export type LiveStage = { roomUrl: string; token: string; expires_at: string; role: LiveRole; can_publish: boolean; can_screen_share: boolean; max_stage_members: number };
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const roles = ['host','producer','camera','guest','moderator','viewer'];
export const liveError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : record(error) ? String(error.message || error.error || '') : '';
  if (/AUTH_REQUIRED|JWT|401/.test(raw)) return 'Sign in again to continue.';
  if (/RATE_LIMIT|429/.test(raw)) return 'Please wait a moment before trying again.';
  if (/STAGE_FULL/.test(raw)) return 'The live stage is full. Remove a guest or invitation before accepting another.';
  if (/JOIN_REQUEST_QUEUE_FULL/.test(raw)) return 'The host has many requests. Please try again shortly.';
  if (/JOIN_REQUEST_NOT_AVAILABLE/.test(raw)) return 'This guest request is no longer available. Refresh the stream.';
  if (/PROVIDER_NOT_READY|DELIVERY_NOT_READY|503/.test(raw)) return 'The streaming service is not available yet. Please try again later.';
  if (/ACCESS_DENIED|LIVE_NOT_AVAILABLE|403/.test(raw)) return 'This stream is unavailable or your access has changed.';
  if (/PRIVATE_STREAM_EXPORT_RESTRICTED/.test(raw)) return 'This stream is private. Save the clip as a replay highlight.';
  if (/CLIP_NOT_AVAILABLE|CLIP_NOT_FOUND/.test(raw)) return 'This clip is unavailable or your access has changed.';
  if (/RECORDING_NOT_AVAILABLE/.test(raw)) return 'The recording is not available for clipping yet.';
  if (/CLIP_NOT_READY|CLIP_PROCESSING_CONFLICT/.test(raw)) return 'Wait for this clip to finish processing, then refresh.';
  if (/PUBLISHED_CLIP_IMMUTABLE/.test(raw)) return 'A published clip cannot be edited. Create a new clip from the original stream.';
  if (/INVALID_SCHEDULE/.test(raw)) return 'Choose a future posting time within the next year.';
  if (/CHAT_CLOSED/.test(raw)) return 'Chat is currently closed for this stream.';
  if (/STATE_CONFLICT/.test(raw)) return 'The stream changed. Refresh and try again.';
  return 'This action could not complete. Please try again.';
};
export function parseLiveMessage(value: unknown): LiveMessage | null {
  if (!record(value) || !isLiveUuid(value.id) || !isLiveUuid(value.session_id) || !isLiveUuid(value.user_id) || !record(value.author) || !isLiveUuid(value.author.id) || value.author.id !== value.user_id || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))) return null;
  return { id: value.id, session_id: value.session_id, user_id: value.user_id, body: value.removed === true ? '' : String(value.body || '').slice(0,500), created_at: value.created_at, removed: value.removed === true, role: String(value.role || 'viewer'), author: { id: value.author.id, full_name: typeof value.author.full_name === 'string' ? value.author.full_name.slice(0,150) : null, username: typeof value.author.username === 'string' ? value.author.username.slice(0,100) : null } };
}
export function mergeLiveMessages(previous: LiveMessage[], incoming: LiveMessage[], limit = 150): LiveMessage[] {
  const messages = new Map(previous.map(item => [item.id,item]));
  incoming.forEach(item => messages.set(item.id, messages.get(item.id)?.removed === true || item.removed
    ? { ...item, removed: true, body: '' } : item));
  return [...messages.values()].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(-Math.min(150,Math.max(1,limit)));
}
export function parseLiveDetail(value: unknown): LiveDetail {
  if (!record(value)) throw Error('INVALID_LIVE_DETAIL');
  const session = parseLiveSession(value.session);
  if (!session || !roles.includes(String(value.role))) throw Error('INVALID_LIVE_DETAIL');
  const topic = typeof value.chat_topic === 'string' && /^live:[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(value.chat_topic) && value.chat_topic.split(':')[1] === session.id ? value.chat_topic : '';
  const members = Array.isArray(value.members) ? value.members.slice(0,50).filter((v): v is LiveMember => record(v) && isLiveUuid(v.user_id) && roles.includes(String(v.role)) && record(v.profile)) : [];
  const join_requests = Array.isArray(value.join_requests) ? value.join_requests.slice(0,100).filter((v):v is LiveJoinRequest=>record(v)&&isLiveUuid(v.user_id)&&v.status==='pending'&&typeof v.created_at==='string'&&Number.isFinite(Date.parse(v.created_at))&&record(v.profile)) : [];
  const request=value.own_join_request;
  const own_join_request=record(request)&&['pending','accepted','declined','cancelled'].includes(String(request.status))&&typeof request.created_at==='string'&&typeof request.updated_at==='string' ? {status:request.status as NonNullable<LiveDetail['own_join_request']>['status'],created_at:request.created_at,updated_at:request.updated_at} : null;
  const rawStage=record(value.stage)?value.stage:{},limit=Math.min(12,Math.max(1,Number(rawStage.limit)||12)),occupied=Math.min(50,Math.max(1,Number(rawStage.occupied)||1));
  const stage_guest_identities=Array.isArray(value.stage_guest_identities)?value.stage_guest_identities.filter(isLiveUuid).slice(0,11):[];
  const output_orientation=value.output_orientation==='portrait'||value.output_orientation==='landscape'?value.output_orientation:null;
  const guest_topic=typeof value.guest_topic==='string'&&/^live-guests:[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(value.guest_topic)&&value.guest_topic.split(':')[1]===session.id?value.guest_topic:'';
  return { session, role: value.role as LiveRole, capabilities: record(value.capabilities) ? value.capabilities : {}, members, chat_topic: topic, reminded: value.reminded === true, pinned_message: parseLiveMessage(value.pinned_message), invitation: record(value.invitation) && roles.includes(String(value.invitation.role)) ? { role: value.invitation.role as LiveRole, status: String(value.invitation.status) } : null,join_requests,own_join_request,stage:{limit,occupied,available:Math.max(0,limit-occupied)},can_request_join:value.can_request_join===true,guest_topic,stage_guest_identities,output_orientation };
}
export async function liveRpc(client: LiveClient, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await withTimeout(client.rpc(name,args));
  if (error) throw error;
  if (!record(data)) throw Error('INVALID_SERVICE_RESPONSE');
  return data;
}
export async function liveInvoke(client: LiveClient, name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await withTimeout(client.functions.invoke(name,{body}),25000);
  if (error) {
    if (record(error) && error.context instanceof Response) {
      const detail = await error.context.clone().json().catch(() => null);
      if (record(detail) && typeof detail.error === 'string') throw Error(detail.error);
    }
    throw error;
  }
  if (!record(data) || data.error) throw Error(String(data?.error || 'INVALID_SERVICE_RESPONSE'));
  return data;
}
export async function getLiveDetail(client: LiveClient,id: string) { return parseLiveDetail(await liveRpc(client,'live_session',{p_session_id:id})); }
export async function getLiveMessages(client: LiveClient,id: string,before: LiveCursor | null = null) {
  const data = await liveRpc(client,'live_messages',{p_session_id:id,p_before:before,p_limit:50});
  const items = Array.isArray(data.items) ? data.items.slice(0,50).map(parseLiveMessage).filter((item): item is LiveMessage => !!item && item.session_id === id) : [];
  return { items, cursor: record(data.next_cursor) && isLiveUuid(data.next_cursor.id) && typeof data.next_cursor.created_at === 'string' && Number.isFinite(Date.parse(data.next_cursor.created_at)) ? data.next_cursor as LiveCursor : null };
}
export function liveCommand(client: LiveClient,id: string|null,action: string,payload: Record<string, unknown> = {},requestId=crypto.randomUUID()) { return liveRpc(client,'live_command',{p_action:action,p_session_id:id,p_payload:payload,p_request_id:requestId}); }
export async function getLivePlayback(client: LiveClient,id: string): Promise<LivePlayback> {
  const data = await liveInvoke(client,'live-playback',{sessionId:id});
  const url = safeLiveImage(data.url), expiry=Date.parse(String(data.expires_at));
  if (!url || !Number.isFinite(expiry) || expiry <= Date.now() || data.format !== 'hls') throw Error('INVALID_PLAYBACK');
  return { url, expires_at: String(data.expires_at), format:'hls', live:data.live === true,poster_url:safeLiveImage(data.poster_url),tracks:Array.isArray(data.tracks) ? data.tracks.slice(0,8).flatMap(item => record(item) && safeLiveImage(item.src) ? [{src:String(item.src),language:String(item.language||'en').slice(0,20),label:String(item.label||'Captions').slice(0,80)}] : []) : [] };
}
export async function getLiveStage(client: LiveClient,id: string): Promise<LiveStage> {
  const data=await liveInvoke(client,'live-stage',{sessionId:id});
  const url=safeLiveImage(data.roomUrl);
  if (!url || !new URL(url).hostname.endsWith('.daily.co') || typeof data.token !== 'string' || !roles.includes(String(data.role)) || (!Number.isFinite(Date.parse(String(data.expires_at))) || Date.parse(String(data.expires_at)) <= Date.now())) throw Error('INVALID_STAGE');
  return {roomUrl:url,token:data.token,expires_at:String(data.expires_at),role:data.role as LiveRole,can_publish:data.can_publish===true,can_screen_share:data.can_screen_share===true,max_stage_members:Math.min(12,Math.max(1,Number(data.max_stage_members)||1))};
}
