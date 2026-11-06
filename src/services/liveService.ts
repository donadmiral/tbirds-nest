import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { profileRead } from '../utils/profileRead';
import { isLiveUuid, parseLiveSession, type LiveSession } from '../../shared/liveDirectory';

export type LiveObject = Record<string, unknown>;
export const liveObject = (value: unknown): value is LiveObject => !!value && typeof value === 'object' && !Array.isArray(value);
export const liveRequestId = () => Crypto.randomUUID();
export const liveText = (value: unknown, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
export const liveRows = (value: unknown, max = 100): LiveObject[] => Array.isArray(value) ? value.filter(liveObject).slice(0, max) : [];

/** Use a small public error vocabulary. Never render provider responses or secrets. */
export function liveError(value: unknown): string {
  const code = liveObject(value) ? liveText(value.message || value.error, 200) : '';
  if (/AUTH_REQUIRED|ACTIVE_SESSION|JWT/.test(code)) return 'Sign in again to use Live.';
  if (/STAGE_FULL/.test(code)) return 'The live stage is full. Remove a guest or invitation before accepting another.';
  if (/JOIN_REQUEST_QUEUE_FULL/.test(code)) return 'The host has many requests. Please try again shortly.';
  if (/JOIN_REQUEST_NOT_AVAILABLE/.test(code)) return 'This guest request is no longer available. Refresh the stream.';
  if (/FOLLOWERS_ONLY/.test(code)) return 'Follow the host to join this chat.';
  if (/CHAT_CLOSED/.test(code)) return 'Chat is currently closed for this stream.';
  if (/INVALID_MESSAGE/.test(code)) return 'Write a message of up to 500 characters.';
  if (/INVALID_REACTION/.test(code)) return 'Reactions are available while the stream is live.';
  if (/ACCESS_DENIED|NOT_AVAILABLE/.test(code)) return 'This stream is unavailable or your access has changed.';
  if (/RATE_LIMIT/.test(code)) return 'Please wait a moment before trying again.';
  if (/CAPACITY_REACHED/.test(code)) return 'Live is busy. Wait a moment and try again.';
  if (/NOT_READY|PGRST202|42883/.test(code)) return 'This Live service is not available yet.';
  if (/STATE_CONFLICT|IDEMPOTENCY/.test(code)) return 'The stream changed. Refresh before trying again.';
  if (/CLIP|RECORDING_UNAVAILABLE|RECORDING_NOT_READY/.test(code)) return 'This clip or recording is not available for that action yet. Refresh and check your access.';
  return 'The action could not be confirmed. Your details are still here. Retry when connected.';
}

export async function liveRpc(name: string, args: LiveObject): Promise<LiveObject> {
  const { data, error } = await profileRead(supabase.rpc(name, args));
  if (error) throw new Error(liveError(error));
  if (!liveObject(data)) throw new Error('The Live response could not be verified. Please retry.');
  return data;
}

export async function liveFunction(name: string, body: LiveObject): Promise<LiveObject> {
  const { data, error } = await profileRead(supabase.functions.invoke(name, { body }), 25000);
  if (error) {
    // Only this pre-dispatch refusal is safe to retry as a new operation.
    if (name === 'live-control' && liveObject(error) && error.context instanceof Response && error.context.status === 409) {
      const detail = await error.context.clone().json().catch(() => null);
      if (liveObject(detail) && detail.error === 'STAGE_CONNECTION_CHANGED') throw new Error('STAGE_CONNECTION_CHANGED');
    }
    throw new Error(liveError(error));
  }
  if (!liveObject(data) || data.error) throw new Error(liveError(data));
  return data;
}

export type NativeLiveDetail = { session: LiveSession; raw: LiveObject };
export async function loadLiveSession(id: string): Promise<NativeLiveDetail> {
  if (!isLiveUuid(id)) throw new Error('This stream link is not valid.');
  const raw = await liveRpc('live_session', { p_session_id: id });
  const session = parseLiveSession(raw.session);
  if (!session) throw new Error('This stream is unavailable or your access has changed.');
  return { session, raw };
}

export async function liveCommand(action: string, sessionId: string | null, payload: LiveObject, requestId: string) {
  const result = await liveRpc('live_command', { p_action: action, p_session_id: sessionId, p_payload: payload, p_request_id: requestId });
  if (result.ok !== true) throw new Error('The Live action was not confirmed. Retry with the same details.');
  return result;
}

export type LivePlaybackTicket = { url: string; expiresAt: number; live: boolean };
export function parseLivePlayback(value: unknown, now = Date.now()): LivePlaybackTicket {
  if (!liveObject(value) || value.format !== 'hls' || typeof value.url !== 'string' || typeof value.expires_at !== 'string') throw new Error('Live playback is not available.');
  const url = new URL(value.url), expiresAt = Date.parse(value.expires_at);
  if (url.protocol !== 'https:' || url.username || url.password || !Number.isFinite(expiresAt) || expiresAt <= now + 1000 || expiresAt > now + 15 * 60 * 1000) throw new Error('Live playback access could not be verified.');
  return { url: url.href, expiresAt, live: value.live === true };
}

export async function livePlayback(id: string) {
  return parseLivePlayback(await liveFunction('live-playback', { sessionId: id }));
}

export type LiveStageTicket = { roomUrl: string; token: string; role: string; canScreenShare: boolean; maxMembers: number };
export async function liveStage(id: string): Promise<LiveStageTicket> {
  const data = await liveFunction('live-stage', { sessionId: id });
  const room = new URL(String(data.roomUrl));
  const expiresAt=Date.parse(String(data.expires_at));
  if (room.protocol !== 'https:' || room.username || room.password || !room.hostname.endsWith('.daily.co') || typeof data.token !== 'string' || !data.token || data.can_publish !== true || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now()+15*60*1000 || !['host','producer','camera','guest'].includes(String(data.role))) throw new Error('Studio access could not be verified.');
  return { roomUrl: room.href, token: data.token, role: liveText(data.role, 30), canScreenShare: data.can_screen_share === true, maxMembers: Math.min(12, Math.max(1, Number(data.max_stage_members) || 1)) };
}

export async function liveControl(id: string, action: 'start' | 'stop' | 'scene', requestId: string, scene?: LiveObject) {
  const result = await liveFunction('live-control', { sessionId: id, action, requestId, ...(scene ? { scene } : {}) });
  if (result.ok !== true) throw new Error('The broadcast control was not confirmed. Refresh the stream and retry.');
  return result;
}
