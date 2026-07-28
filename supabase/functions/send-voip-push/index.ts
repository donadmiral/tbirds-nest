// send-voip-push: rings locked iPhones through Apple's VoIP push service.
// Expo push cannot send apns-push-type=voip, so this speaks APNs directly.
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
      .select('user_id, voip_token').in('user_id', receivers).not('voip_token', 'is', null);
    if (!toks || toks.length === 0) return new Response('no voip tokens', { status: 200 });

    const { data: caller } = await admin.from('profiles')
      .select('full_name').eq('id', call.initiator_id ?? call.caller_id).maybeSingle();

    const jwt = await apnsJwt();
    const payload = JSON.stringify({
      aps: {},
      callId,
      callerName: caller?.full_name || 'Platinum Circles',
      isVideo: !!call.is_video,
    });
    const results = await Promise.all(toks.map((t: any) =>
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
      }).then((r) => r.status)
    ));
    return new Response(JSON.stringify({ sent: results }), { status: 200 });
  } catch (e) {
    return new Response(String((e as any)?.message ?? e), { status: 500 });
  }
});