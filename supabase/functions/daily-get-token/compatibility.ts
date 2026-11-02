// Compatibility handler for the existing call schema and six-hour client grant.
// Group provider identities are the durable admission identities used by cleanup.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3';
import { boundedPushJson as boundedJson, validUuid, waitForPush } from '../_shared/pushDelivery.ts';

type Dependencies = {
  service: Pick<SupabaseClient, 'from'>;
  caller: (request: Request, signal: AbortSignal) => Pick<SupabaseClient, 'auth'>;
  dailyKey: string;
  fetch: typeof fetch;
  now?: () => number;
  deadlineMs?: number;
};
const headers = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });

export function createCompatibleDailyTokenHandler(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers });
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deps.deadlineMs ?? 30000)]);
    try {
      const { data, error: authError } = await deps.caller(request, signal).auth.getUser();
      if (authError || !data?.user || data.user.is_anonymous) return json(401, { error: 'unauthorized' });
      if (!deps.dailyKey) return json(503, { error: 'call service unavailable' });
      const uid = data.user.id;
      const body = await boundedJson(request, signal);
      if (!validUuid(body.callSessionId)) return json(400, { error: 'valid callSessionId required' });
      if (body.expectedProviderIdentity !== undefined && !validUuid(body.expectedProviderIdentity)) {
        return json(400, { error: 'valid expectedProviderIdentity required' });
      }
      const sessionId = body.callSessionId.toLowerCase();
      const expectedIdentity = typeof body.expectedProviderIdentity === 'string' ? body.expectedProviderIdentity.toLowerCase() : undefined;
      const svc = deps.service;
      const readSession = () => svc.from('call_sessions')
        .select('id,initiator_id,receiver_id,conversation_id,is_group_call,status,expires_at,created_at')
        .eq('id', sessionId).abortSignal(signal).maybeSingle();
      const { data: session, error: sessionError } = await readSession();
      if (sessionError) return json(503, { error: 'call access unavailable' });
      if (!session) return json(404, { error: 'call not found' });
      const live = (value: typeof session | null) => {
        if (!value || !['ringing', 'active'].includes(value.status)) return false;
        if (value.status === 'active') return true;
        const deadline = value.expires_at ? Date.parse(value.expires_at) : Date.parse(value.created_at) + 90000;
        return Number.isFinite(deadline) && deadline > now();
      };
      if (!live(session)) return json(409, { error: 'call is no longer available' });
      const isOwner = session.initiator_id === uid;
      let providerIdentity = uid;
      const groupAccess = async () => {
        const [{ data: participant, error: participantError }, { data: member, error: memberError }] = await Promise.all([
          svc.from('call_participants').select('status,provider_identity').eq('call_session_id', sessionId)
            .eq('user_id', uid).abortSignal(signal).maybeSingle(),
          svc.from('conversation_members').select('user_id').eq('conversation_id', session.conversation_id)
            .eq('user_id', uid).abortSignal(signal).maybeSingle(),
        ]);
        return { error: participantError || memberError,
          identity: !participantError && !memberError && member && participant?.status === 'joined' && validUuid(participant.provider_identity)
            ? String(participant.provider_identity).toLowerCase() : null };
      };
      if (session.is_group_call) {
        const access = await groupAccess();
        if (access.error) return json(503, { error: 'call access unavailable' });
        if (!access.identity) return json(403, { error: 'not a participant' });
        if (expectedIdentity && access.identity !== expectedIdentity) return json(409, { error: 'call membership changed' });
        providerIdentity = access.identity;
      } else if (!isOwner && session.receiver_id !== uid) return json(403, { error: 'not a participant' });

      const stillAllowed = async () => {
        const { data: fresh, error } = await readSession();
        if (error || !fresh || !live(fresh) || fresh.initiator_id !== session.initiator_id || fresh.receiver_id !== session.receiver_id
          || fresh.is_group_call !== session.is_group_call || fresh.conversation_id !== session.conversation_id) return false;
        if (!session.is_group_call) return true;
        const access = await groupAccess();
        return !access.error && access.identity === providerIdentity;
      };
      const { data: profile } = await svc.from('profiles').select('full_name').eq('id', uid).abortSignal(signal).maybeSingle();
      const providerHeaders = { Authorization: `Bearer ${deps.dailyKey}`, 'Content-Type': 'application/json' };
      const provider = (url: string, init: RequestInit = {}) => {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
        return waitForPush(deps.fetch(url, { ...init, headers: providerHeaders, redirect: 'error', signal: deadline }), deadline);
      };
      const roomUrl = 'https://api.daily.co/v1/rooms/' + sessionId;
      let response = await provider(roomUrl);
      let room: Record<string, unknown>;
      if (response.ok) room = await boundedJson(response, signal);
      else if (response.status === 404) {
        await response.body?.cancel();
        response = await provider('https://api.daily.co/v1/rooms', { method: 'POST', body: JSON.stringify({
          name: sessionId, privacy: 'private', properties: {
            exp: Math.floor(now() / 1000) + 6 * 3600, eject_at_room_exp: true,
            enable_screenshare: false, start_video_off: false,
          },
        }) });
        if (response.status === 400 || response.status === 409) {
          await response.body?.cancel();
          response = await provider(roomUrl);
        }
        if (!response.ok) { await response.body?.cancel(); return json(502, { error: 'room create failed' }); }
        room = await boundedJson(response, signal);
      } else { await response.body?.cancel(); return json(502, { error: 'room lookup failed' }); }
      if (room.privacy !== 'private' || typeof room.url !== 'string' || !room.url.startsWith('https://')) {
        return json(502, { error: 'invalid call room' });
      }
      if (!await stillAllowed()) return json(409, { error: 'call access changed' });
      response = await provider('https://api.daily.co/v1/meeting-tokens', { method: 'POST', body: JSON.stringify({ properties: {
        room_name: sessionId, is_owner: isOwner, user_id: providerIdentity,
        user_name: profile?.full_name || undefined,
        // Keep legacy connection/reconnect lifetime and inherit existing room ejection rules.
        exp: Math.floor(now() / 1000) + 6 * 3600,
      } }) });
      if (!response.ok) { await response.body?.cancel(); return json(502, { error: 'token failed' }); }
      const token = await boundedJson(response, signal);
      if (typeof token.token !== 'string' || !token.token) return json(502, { error: 'invalid call token' });
      if (!await stillAllowed()) return json(409, { error: 'call access changed' });
      return json(200, { roomUrl: room.url, token: token.token });
    } catch { return json(503, { error: 'call service unavailable' }); }
  };
}
