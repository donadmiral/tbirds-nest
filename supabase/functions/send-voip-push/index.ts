// send-voip-push: rings locked phones on both platforms.
//
// iPhone goes through Apple's VoIP push service, which Expo push cannot send
// (it has no way to set apns-push-type=voip), so this speaks APNs directly.
// Android goes through Expo's push service, which relays to FCM as a high
// priority message on the calls channel, so the phone rings and vibrates even
// when locked. The two branches are independent: if the APNs secrets are
// missing, Android still rings, and the reverse holds too.
// BUILD DAY: set secrets APNS_KEY_P8 (the .p8 file contents), APNS_KEY_ID,
// APNS_TEAM_ID, then: npx supabase functions deploy send-voip-push
// Ring path: after a call session is created, invoke this with { callId }.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const APNS_TOPIC = 'app.platinumcircles.mobile.voip';
const APNS_HOST = 'https://api.push.apple.com'; // dev builds: api.sandbox.push.apple.com

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function apnsJwt(): Promise<string> {
  const p8 = Deno.env.get('APNS_KEY_P8') ?? '';
  const keyId = Deno.env.get('APNS_KEY_ID') ?? '';
  const teamId = Deno.env.get('APNS_TEAM_ID') ?? '';
  if (!p8 || !keyId || !teamId) throw new Error('APNs secrets not configured');
  const pem = p8.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64url(sig)}`;
}

Deno.serve(async (req) => {
  try {
    const { callId } = await req.json();
    if (!callId) return new Response('callId required', { status: 400 });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: call } = await admin.from('call_sessions').select('*').eq('id', callId).maybeSingle();
    if (!call || call.status !== 'ringing') return new Response('not ringing', { status: 200 });

    const { data: parts } = await admin.from('call_participants')
      .select('user_id').eq('call_session_id', callId).eq('status', 'invited');
    let receivers = (parts || []).map((p: any) => p.user_id);
    if (!call.is_group_call && call.receiver_id) receivers = [call.receiver_id];
    if (receivers.length === 0) return new Response('no receivers', { status: 200 });

    const { data: toks } = await admin.from('user_push_tokens')
      .select('user_id, platform, expo_push_token, voip_token').in('user_id', receivers);
    if (!toks || toks.length === 0) return new Response('no tokens', { status: 200 });

    const { data: caller } = await admin.from('profiles')
      .select('full_name').eq('id', call.initiator_id ?? call.caller_id).maybeSingle();
    const callerName = caller?.full_name || 'Platinum Circles';
    const isVideo = !!call.is_video;

    // ── iPhone: PushKit, which wakes the app even when it is not running ────
    const voipTokens = toks.filter((t: any) => t.voip_token);
    let apns: Array<number | string> = [];
    if (voipTokens.length > 0) {
      try {
        const jwt = await apnsJwt();
        const payload = JSON.stringify({ aps: {}, callId, callerName, isVideo });
        apns = await Promise.all(voipTokens.map((t: any) =>
          fetch(`${APNS_HOST}/3/device/${t.voip_token}`, {
            method: 'POST',
            headers: {
              authorization: `bearer ${jwt}`,
              'apns-topic': APNS_TOPIC,
              'apns-push-type': 'voip',
              'apns-priority': '10',
              'content-type': 'application/json',
            },
            body: payload,
          }).then((r) => r.status).catch((e) => String(e?.message ?? e))
        ));
      } catch (e) {
        apns = [String((e as any)?.message ?? e)];
      }
    }

    // ── Android: Expo push, high priority, on the calls channel ─────────────
    // ttl is short on purpose: a call push that arrives after the ring has
    // stopped is worse than no push, because it rings for a call that ended.
    const androidTokens = toks.filter((t: any) =>
      t.platform === 'android' && t.expo_push_token && !t.voip_token);
    let expo: unknown = null;
    if (androidTokens.length > 0) {
      const messages = androidTokens.map((t: any) => ({
        to: t.expo_push_token,
        title: callerName,
        body: isVideo ? 'Incoming video call' : 'Incoming call',
        data: { type: 'incoming_call', callId, callerName, isVideo },
        channelId: 'calls',
        priority: 'high',
        ttl: 45,
        sound: 'default',
      }));
      try {
        const r = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(messages),
        });
        expo = await r.json().catch(() => ({ status: r.status }));
      } catch (e) {
        expo = String((e as any)?.message ?? e);
      }
    }

    return new Response(JSON.stringify({ apns, expo }), { status: 200 });
  } catch (e) {
    return new Response(String((e as any)?.message ?? e), { status: 500 });
  }
});