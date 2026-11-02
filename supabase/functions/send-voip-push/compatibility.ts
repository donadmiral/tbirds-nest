// Call notification adapter for the existing call schema and native payloads.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3';
import { boundedPushJson, PUSH_HEADERS, pushResponse, sendExpoPushes, servicePushAuthorized, validExpoToken, validUuid, waitForPush } from '../_shared/pushDelivery.ts';

type Dependencies = {
  service: Pick<SupabaseClient, 'from'>;
  serviceKey: string;
  caller: (request: Request, signal: AbortSignal) => Pick<SupabaseClient, 'auth'>;
  authorizeLegacyService: (request: Request, signal: AbortSignal) => Promise<boolean>;
  fetch: typeof fetch;
  apnsToken: () => Promise<string>;
  apnsTopic?: string;
  expoAccessToken?: string;
  androidDataOnly?: boolean;
  deadlineMs?: number;
  now?: () => number;
};

export function createCompatibleVoipHandler(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: PUSH_HEADERS });
    if (request.method !== 'POST') return pushResponse(405, { error: 'method not allowed' });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deps.deadlineMs ?? 20000)]);
    try {
      const serviceCaller = await servicePushAuthorized(request, deps.serviceKey)
        || await deps.authorizeLegacyService(request, signal) === true;
      let callerId: string | null = null;
      if (!serviceCaller) {
        if (!/^Bearer [^\s]+$/i.test(request.headers.get('Authorization') || '')) return pushResponse(401, { error: 'unauthorized' });
        const { data, error } = await deps.caller(request, signal).auth.getUser();
        if (error || !data?.user || data.user.is_anonymous) return pushResponse(401, { error: 'unauthorized' });
        callerId = data.user.id;
      }
      const body = await boundedPushJson(request, signal);
      if (!validUuid(body.callId)) return pushResponse(400, { error: 'valid callId required' });
      const callId = body.callId.toLowerCase();
      const db = deps.service;
      const readCall = () => db.from('call_sessions').select('*').eq('id', callId).abortSignal(signal).maybeSingle();
      const { data: call, error: callError } = await readCall();
      if (callError) return pushResponse(503, { error: 'call unavailable' });
      if (!call) return pushResponse(200, { skipped: 'not ringing' });
      const owner = call.initiator_id ?? call.caller_id;
      if (!serviceCaller && callerId !== owner) return pushResponse(403, { error: 'not the call initiator' });
      const ringing = (value: typeof call | null) => {
        if (!value || value.status !== 'ringing') return false;
        const expires = value.expires_at ? Date.parse(value.expires_at) : Date.parse(value.created_at) + 90000;
        return Number.isFinite(expires) && expires > now();
      };
      if (!ringing(call)) return pushResponse(200, { skipped: 'not ringing' });
      const eligibleRecipients = async (current: typeof call) => {
        let ids: string[];
        if (current.receiver_id) ids = [current.receiver_id];
        else {
          const { data: participants, error } = await db.from('call_participants').select('user_id')
            .eq('call_session_id', callId).eq('status', 'invited').limit(1000).abortSignal(signal);
          if (error) throw new Error('RECIPIENTS_UNAVAILABLE');
          ids = (participants || []).map(row => String(row.user_id));
        }
        if (current.is_group_call) {
          const { data: members, error } = await db.from('conversation_members').select('user_id')
            .eq('conversation_id', current.conversation_id).in('user_id', [...new Set([...ids, owner])]).limit(1000).abortSignal(signal);
          if (error) throw new Error('RECIPIENTS_UNAVAILABLE');
          const currentMembers = new Set((members || []).map(row => String(row.user_id)));
          if (!currentMembers.has(owner)) return new Set<string>();
          ids = ids.filter(id => currentMembers.has(id));
        }
        return new Set(ids.filter(validUuid));
      };
      const receivers = await eligibleRecipients(call);
      if (!receivers.size) return pushResponse(200, { skipped: 'no receivers' });
      const freshRecipients = async () => {
        const { data: fresh, error } = await readCall();
        if (error) throw new Error('CALL_UNAVAILABLE');
        if (!fresh || !ringing(fresh) || (fresh.initiator_id ?? fresh.caller_id) !== owner
          || fresh.conversation_id !== call.conversation_id || fresh.is_group_call !== call.is_group_call) return new Set<string>();
        const current = await eligibleRecipients(fresh);
        return new Set([...current].filter(id => receivers.has(id)));
      };
      const { data: tokens, error: tokenError } = await db.from('user_push_tokens')
        .select('user_id,platform,expo_push_token,voip_token').in('user_id', [...receivers]).limit(1000).abortSignal(signal);
      if (tokenError) return pushResponse(503, { error: 'tokens unavailable' });
      if (!tokens?.length) return pushResponse(200, { skipped: 'no tokens' });
      const { data: profile } = await db.from('profiles').select('full_name').eq('id', owner).abortSignal(signal).maybeSingle();
      const callerName = profile?.full_name || 'Platinum Circles';
      const isVideo = !!call.is_video;
      const voip = [...new Map(tokens.filter(token => typeof token.voip_token === 'string' && /^[a-f0-9]{32,512}$/i.test(token.voip_token))
        .map(token => [String(token.voip_token), token])).values()];
      const apns: Array<number | string> = [];
      if (voip.length) {
        let apnsCredential: string | undefined;
        try { apnsCredential = await waitForPush(deps.apnsToken(), signal); }
        catch { apns.push('provider unavailable'); }
        if (apnsCredential) {
          const payload = JSON.stringify({ aps: {}, uuid: callId, callerName, handle: 'PlatinumCircles', hasVideo: isVideo, callId, isVideo });
          const post = (host: string, token: string) => waitForPush(deps.fetch(`${host}/3/device/${token}`, {
            method: 'POST', headers: { authorization: `bearer ${apnsCredential}`, 'apns-topic': deps.apnsTopic || 'app.platinumcircles.mobile.voip',
              'apns-push-type': 'voip', 'apns-priority': '10', 'content-type': 'application/json' },
            body: payload, redirect: 'error', signal,
          }), signal);
          for (let offset = 0; offset < voip.length && !signal.aborted; offset += 5) {
            const current = await freshRecipients();
            const results = await Promise.all(voip.slice(offset, offset + 5).filter(token => current.has(String(token.user_id))).map(async token => {
              try {
                const first = await post('https://api.push.apple.com', String(token.voip_token));
                const status = first.status; await first.body?.cancel();
                if (status === 200) return 200;
                if (status !== 400) return 'provider status ' + status;
                // Preserve the existing production/development device fallback.
                const remaining = await freshRecipients();
                if (!remaining.has(String(token.user_id))) return 'call no longer eligible';
                const retry = await post('https://api.sandbox.push.apple.com', String(token.voip_token));
                const retryStatus = retry.status; await retry.body?.cancel();
                return retryStatus === 200 ? 'sandbox200' : 'provider status ' + retryStatus;
              } catch { return 'provider unavailable'; }
            }));
            apns.push(...results);
          }
        }
      }
      const android = [...new Map(tokens.filter(token => token.platform === 'android' && !token.voip_token && validExpoToken(token.expo_push_token))
        .map(token => [String(token.expo_push_token), token])).values()];
      let expo: { accepted: number; rejected: number; unknown: number } | null = null;
      if (android.length) {
        expo = { accepted: 0, rejected: 0, unknown: 0 };
        for (let offset = 0; offset < android.length && !signal.aborted; offset += 100) {
          const current = await freshRecipients();
          const batch = android.slice(offset, offset + 100).filter(token => current.has(String(token.user_id))).map(token => ({
            to: String(token.expo_push_token), title: deps.androidDataOnly ? undefined : callerName,
            body: deps.androidDataOnly ? undefined : isVideo ? 'Incoming video call' : 'Incoming call',
            data: { type: 'incoming_call', call_id: callId, callId, caller_name: callerName, channel_id: call.channel_id ?? null, is_video: isVideo },
            channelId: 'calls', categoryId: 'incoming_call', priority: 'high', ttl: 45, sound: deps.androidDataOnly ? undefined : 'default',
          }));
          const sent = await sendExpoPushes(batch, { fetch: deps.fetch, signal, accessToken: deps.expoAccessToken });
          expo.accepted += sent.accepted; expo.rejected += sent.rejected; expo.unknown += sent.unknown;
        }
      }
      return pushResponse(expo?.unknown ? 502 : 200, { apns, expo });
    } catch { return pushResponse(503, { error: 'call notifications temporarily unavailable' }); }
  };
}
