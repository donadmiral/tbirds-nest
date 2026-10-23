// daily-get-token: create-or-get the Daily room for a call session and mint
// a meeting token. Room name IS the call session id, so every participant
// of a session lands in the same room — 1:1 and group alike.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const providerFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  try {
    const DAILY_KEY = Deno.env.get('DAILY_API_KEY');
    if (!DAILY_KEY) return json(500, { error: 'DAILY_API_KEY not configured' });

    const authHeader = req.headers.get('Authorization') ?? '';
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authErr } = await anon.auth.getUser();
    if (authErr || !userData?.user) return json(401, { error: 'unauthorized' });
    const uid = userData.user.id;

    const body = await req.json();
    const sessionId = typeof body?.callSessionId === 'string' ? body.callSessionId.toLowerCase() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
      return json(400, { error: 'valid callSessionId required' });
    }
    const roomName = sessionId;
    let isOwner = false; // derived from call_sessions below, never from the client
    let isVideo = false;
    let providerUserId = uid;
    let finalAccessCheck: (() => Promise<boolean>) | undefined;

    // The caller must belong to the session: initiator, receiver, or a
    // participant row (groups). Rooms are private; this is the gate.
    if (sessionId) {
      const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: sess, error: sessionError } = await svc.from('call_sessions')
        .select('id, initiator_id, receiver_id, conversation_id, is_group_call, is_video, status, expires_at, created_at')
        .eq('id', sessionId).maybeSingle();
      if (sessionError) return json(503, { error: 'call access unavailable' });
      if (!sess) return json(404, { error: 'call not found' });
      const ringingDeadline = sess.expires_at ? Date.parse(sess.expires_at) : Date.parse(sess.created_at) + 90000;
      if (!['ringing', 'active'].includes(sess.status)
        || (sess.status === 'ringing' && (!Number.isFinite(ringingDeadline) || ringingDeadline <= Date.now()))) {
        return json(409, { error: 'call is no longer available' });
      }
      isOwner = sess.initiator_id === uid;
      isVideo = sess.is_video === true;
      let allowed = isOwner || sess.receiver_id === uid;
      if (sess.is_group_call) {
        // A historic invitation alone must not mint fresh room credentials.
        // Both clients join through join_group_call before requesting a token.
        const { data: part, error: partError } = await svc.from('call_participants')
          .select('user_id, status, provider_identity').eq('call_session_id', sessionId).eq('user_id', uid).maybeSingle();
        const { data: member, error: memberError } = await svc.from('conversation_members')
          .select('user_id').eq('conversation_id', sess.conversation_id).eq('user_id', uid).maybeSingle();
        if (partError || memberError) return json(503, { error: 'call access unavailable' });
        allowed = part?.status === 'joined' && !!member && !!part.provider_identity;
        if (allowed) providerUserId = part.provider_identity;
      }
      if (!allowed) return json(403, { error: 'not a participant' });
      finalAccessCheck = async () => {
        const { data: fresh, error } = await svc.from('call_sessions').select('status, expires_at, created_at').eq('id', sessionId).maybeSingle();
        const deadline = fresh?.expires_at ? Date.parse(fresh.expires_at) : Date.parse(fresh?.created_at) + 90000;
        if (error || !fresh || !['ringing', 'active'].includes(fresh.status) || (fresh.status === 'ringing' && !(deadline > Date.now()))) return false;
        if (!sess.is_group_call) return true;
        const { data: part, error: partError } = await svc.from('call_participants').select('status, provider_identity').eq('call_session_id', sessionId).eq('user_id', uid).maybeSingle();
        const { data: member, error: memberError } = await svc.from('conversation_members').select('user_id').eq('conversation_id', sess.conversation_id).eq('user_id', uid).maybeSingle();
        return !partError && !memberError && !!member && part?.status === 'joined' && providerUserId === part.provider_identity;
      };
    }

    let displayName = '';
    try {
      const svc2 = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: prof } = await svc2.from('profiles').select('full_name').eq('id', uid).maybeSingle();
      displayName = String(prof?.full_name || '');
    } catch { /* name is a nicety, never a blocker */ }

    const dailyHeaders = { Authorization: `Bearer ${DAILY_KEY}`, 'Content-Type': 'application/json' };

    // create-or-get the room
    let room: any = null;
    const getRes = await providerFetch(`https://api.daily.co/v1/rooms/${roomName}`, { headers: dailyHeaders });
    if (getRes.ok) {
      room = await getRes.json();
    } else if (getRes.status === 404) {
      const createRes = await providerFetch('https://api.daily.co/v1/rooms', {
        method: 'POST', headers: dailyHeaders,
        body: JSON.stringify({
          name: roomName,
          privacy: 'private',
          properties: {
            exp: Math.floor(Date.now() / 1000) + 6 * 3600,
            eject_at_room_exp: true,
            enable_screenshare: true,
            start_video_off: !isVideo,
          },
        }),
      });
      if (createRes.ok) {
        room = await createRes.json();
      } else if (createRes.status === 400 || createRes.status === 409) {
        // Simultaneous authorized joins may both see 404. Reuse the private
        // room created by the other request instead of failing the second call.
        const retry = await providerFetch(`https://api.daily.co/v1/rooms/${roomName}`, { headers: dailyHeaders });
        if (!retry.ok) return json(502, { error: 'room create failed' });
        room = await retry.json();
      } else return json(502, { error: 'room create failed' });
    } else {
      return json(502, { error: 'room lookup failed' });
    }
    if (room?.privacy !== 'private' || typeof room?.url !== 'string' || !room.url.startsWith('https://')) {
      return json(502, { error: 'invalid call room' });
    }

    if (!await finalAccessCheck?.()) return json(409, { error: 'call access changed' });
    const tokenRes = await providerFetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST', headers: dailyHeaders,
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          is_owner: isOwner,
          user_id: providerUserId,
          user_name: displayName || undefined,
          exp: Math.floor(Date.now() / 1000) + 120,
          eject_at_token_exp: false,
        },
      }),
    });
    if (!tokenRes.ok) return json(502, { error: 'token failed' });
    const tokenData = await tokenRes.json();
    if (typeof tokenData?.token !== 'string' || !tokenData.token) return json(502, { error: 'invalid call token' });

    if (!await finalAccessCheck?.()) return json(409, { error: 'call access changed' });
    return json(200, { roomUrl: room.url, token: tokenData.token });
  } catch {
    return json(503, { error: 'call service unavailable' });
  }
});
