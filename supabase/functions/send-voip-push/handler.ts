import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3';
import { notificationAllowed } from '../../../shared/notificationPreferences.ts';
import { boundedPushJson, PUSH_HEADERS, pushResponse, sendExpoPushes, servicePushAuthorized, validExpoToken, validUuid, waitForPush } from '../_shared/pushDelivery.ts';

type Call = { id: string; initiator_id: string; receiver_id: string | null; conversation_id: string | null;
  is_group_call: boolean; is_video: boolean; status: string; created_at: string; expires_at: string | null; agora_channel: string | null };
type Dependencies = { service: Pick<SupabaseClient, 'from' | 'rpc'>; serviceKey: string;
  caller: (request: Request, signal: AbortSignal) => Pick<SupabaseClient, 'auth' | 'rpc'>;
  fetch: typeof fetch; apnsToken: () => Promise<string>; apnsTopic: string; apnsEnvironment?: 'production' | 'sandbox';
  expoAccessToken?: string; androidDataOnly?: boolean; now?: () => number; deadlineMs?: number };
const PREF_COLUMNS = 'id,notif_messages,notif_connections,notif_jobs,notif_prefs,quiet_from,quiet_to,quiet_tz_offset_min,deactivated_at';
const validVoipToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64,512}$/i.test(value) && value.length % 2 === 0;
function ringing(call: Call | null, now: number): call is Call {
  if (!call || call.status !== 'ringing' || !validUuid(call.id) || !validUuid(call.initiator_id)) return false;
  const created = Date.parse(call.created_at), expires = call.expires_at ? Date.parse(call.expires_at) : created + 90_000;
  return Number.isFinite(created) && created <= now + 60_000 && Math.min(expires, created + 90_000) > now;
}

export function createVoipPushHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PUSH_HEADERS });
    if (request.method !== 'POST') return pushResponse(405, { error: 'Method not allowed' });
    if (!/^Bearer [^\s]+$/i.test(request.headers.get('Authorization') || '')) return pushResponse(401, { error: 'Sign in to call' });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deps.deadlineMs ?? 25_000)]), now = deps.now ?? Date.now;
    try {
      const trusted = await servicePushAuthorized(request, deps.serviceKey);
      let caller: ReturnType<Dependencies['caller']> | null = null, callerId: string | null = null;
      if (!trusted) {
        caller = deps.caller(request, signal);
        const { data, error } = await waitForPush(caller.auth.getUser(), signal);
        if (error || !data.user || data.user.is_anonymous) return pushResponse(401, { error: 'Sign in to call' });
        callerId = data.user.id;
      }
      let body: Record<string, unknown>;
      try { body = await boundedPushJson(request, signal, 2048); }
      catch { return pushResponse(400, { error: 'A valid call ID is required' }); }
      if (!validUuid(body.callId)) return pushResponse(400, { error: 'A valid call ID is required' });
      const callId = body.callId.toLowerCase();
      const authorized = async () => {
        if (!caller) return trusted;
        const { data, error } = await caller.rpc('authorize_call_push', { p_call_id: callId }).abortSignal(signal);
        return !error && data === true;
      };
      if (!await authorized()) return pushResponse(403, { error: 'This call is unavailable' });
      const db = deps.service;
      const readCall = async (): Promise<Call | null> => {
        const { data, error } = await db.from('call_sessions').select('id,initiator_id,receiver_id,conversation_id,is_group_call,is_video,status,created_at,expires_at,agora_channel')
          .eq('id', callId).abortSignal(signal).maybeSingle();
        if (error) throw error;
        return data;
      };
      const call = await readCall();
      if (!ringing(call, now()) || (callerId && call.initiator_id !== callerId)) return pushResponse(200, { skipped: true, reason: 'call no longer ringing' });
      let recipients: string[] = call.receiver_id ? [call.receiver_id] : [];
      if (call.is_group_call) {
        const { data, error } = await db.from('call_participants').select('user_id').eq('call_session_id', callId).eq('status', 'invited').limit(201).abortSignal(signal);
        if (error || !data || data.length > 200) return pushResponse(503, { error: 'Call recipients unavailable' });
        recipients = data.map(row => row.user_id);
      }
      recipients = Array.from(new Set(recipients.filter(id => validUuid(id) && id !== call.initiator_id)));
      if (!recipients.length) return pushResponse(200, { skipped: true, reason: 'no recipients' });
      const [{ data: profiles, error: profileError }, { data: tokens, error: tokenError }, { data: actor }] = await Promise.all([
        db.from('profiles').select(PREF_COLUMNS).in('id', recipients).abortSignal(signal),
        db.from('user_push_tokens').select('id,user_id,platform,expo_push_token,voip_token,updated_at').in('user_id', recipients).limit(1001).abortSignal(signal),
        db.from('profiles').select('full_name').eq('id', call.initiator_id).abortSignal(signal).maybeSingle(),
      ]);
      if (profileError || tokenError || !profiles || !tokens || tokens.length > 1000) return pushResponse(503, { error: 'Call devices unavailable' });
      const callerName = String(actor?.full_name || 'Platinum Circles').slice(0, 120);
      let accepted = 0, rejected = 0, unknown = 0, skipped = 0;
      let jwt: string | null = null;
      if (tokens.some(token => token.platform === 'ios' && validVoipToken(token.voip_token))
        && /^app\.platinumcircles\.mobile(?:\.qa)?\.voip$/.test(deps.apnsTopic)) {
        try { jwt = await waitForPush(deps.apnsToken(), signal); } catch { /* Android delivery remains independent. */ }
      }
      for (const recipient of recipients) {
        const profile = profiles.find(value => value.id === recipient);
        if (!notificationAllowed(profile ?? null, 'incoming_call', now())) { skipped++; continue; }
        const own = tokens.filter(token => token.user_id === recipient);
        const ios = Array.from(new Map(own.filter(token => token.platform === 'ios' && validVoipToken(token.voip_token)).map(token => [token.voip_token, token])).values());
        const android = Array.from(new Set<string>(own.filter(token => token.platform === 'android').map(token => token.expo_push_token).filter(validExpoToken)));
        if (!android.length && !(ios.length && jwt)) { if (ios.length) unknown += ios.length; else skipped++; continue; }
        if (!await authorized() || !ringing(await readCall(), now())) { skipped++; continue; }
        const { data: claimed, error: claimError } = await db.rpc('claim_call_push_dispatch', { p_call_id: callId, p_recipient: recipient }).abortSignal(signal);
        if (claimError) return pushResponse(503, { error: 'Call dispatch unavailable' });
        if (claimed !== true) { skipped++; continue; }
        const maySend = async () => {
          if (!await authorized() || !ringing(await readCall(), now())) return false;
          // Membership, blocks and the initiating Auth session may change
          // after the one-time claim. Reauthorize every provider batch.
          const { data: eligible, error: eligibilityError } = await db.rpc('call_push_dispatch_allowed', {
            p_call_id: callId, p_recipient: recipient,
          }).abortSignal(signal);
          if (eligibilityError) throw eligibilityError;
          if (eligible !== true) return false;
          const { data, error } = await db.from('profiles').select(PREF_COLUMNS).eq('id', recipient).abortSignal(signal).maybeSingle();
          if (error) throw error;
          return notificationAllowed(data, 'incoming_call', now());
        };
        if (jwt) for (const token of ios) {
          if (!await maySend()) { skipped++; continue; }
          try {
            const host = deps.apnsEnvironment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
            const response = await waitForPush(deps.fetch(`${host}/3/device/${token.voip_token}`, {
              method: 'POST', redirect: 'error', signal,
              headers: { authorization: `bearer ${jwt}`, 'apns-topic': deps.apnsTopic, 'apns-push-type': 'voip',
                'apns-priority': '10', 'apns-expiration': '0', 'apns-collapse-id': callId, 'content-type': 'application/json' },
              body: JSON.stringify({ aps: {}, uuid: callId, callerName, handle: 'PlatinumCircles', hasVideo: call.is_video,
                callId, isVideo: call.is_video }),
            }), signal);
            if (response.status === 200) accepted++;
            else if (response.status >= 500 || response.status === 429) unknown++;
            else rejected++;
            void response.body?.cancel().catch(() => {});
            if (response.status === 410) {
              await db.from('user_push_tokens').update({ voip_token: null }).eq('id', token.id).eq('user_id', recipient)
                .eq('voip_token', token.voip_token).eq('updated_at', token.updated_at).abortSignal(signal);
            }
          } catch { unknown++; }
        }
        if (ios.length && !jwt) unknown += ios.length;
        if (android.length) {
          const ttl = Math.max(1, Math.min(45, Math.floor((Math.min(Date.parse(call.created_at) + 90_000, call.expires_at ? Date.parse(call.expires_at) : Infinity) - now()) / 1000)));
          const result = await sendExpoPushes(android.map(to => ({ to,
            ...(deps.androidDataOnly ? {} : { title: callerName, body: call.is_video ? 'Incoming video call' : 'Incoming call', sound: 'default' }),
            data: { type: 'incoming_call', call_id: callId, callId, caller_name: callerName, channel_id: call.agora_channel ?? call.id, is_video: call.is_video },
            channelId: 'calls', categoryId: 'incoming_call', priority: 'high', ttl,
          })), { fetch: deps.fetch, signal, accessToken: deps.expoAccessToken, maySend });
          accepted += result.accepted; rejected += result.rejected; unknown += result.unknown;
          for (const invalid of result.invalidTokens) for (const token of own.filter(value => value.expo_push_token === invalid)) {
            await db.from('user_push_tokens').delete().eq('id', token.id).eq('user_id', recipient).eq('expo_push_token', invalid).eq('updated_at', token.updated_at).abortSignal(signal);
          }
        }
      }
      return pushResponse(unknown ? 502 : 200, { accepted, rejected, unknown, skipped });
    } catch { return pushResponse(503, { error: 'Call delivery is temporarily unavailable' }); }
  };
}
