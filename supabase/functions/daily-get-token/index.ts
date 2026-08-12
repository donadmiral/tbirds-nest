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
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
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
    const sessionId: string | null = body.callSessionId || null;
    const roomName: string = String(sessionId || body.roomName || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!roomName) return json(400, { error: 'no room' });
    if (!sessionId) return json(400, { error: 'callSessionId required' });
    let isOwner = false; // derived from call_sessions below, never from the client

    // The caller must belong to the session: initiator, receiver, or a
    // participant row (groups). Rooms are private; this is the gate.
    if (sessionId) {
      const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: sess } = await svc.from('call_sessions')
        .select('id, initiator_id, receiver_id').eq('id', sessionId).maybeSingle();
      if (!sess) return json(404, { error: 'call not found' });
      isOwner = sess.initiator_id === uid;
      let allowed = sess.initiator_id === uid || sess.receiver_id === uid;
      if (!allowed) {
        const { data: part } = await svc.from('call_participants')
          .select('user_id').eq('call_session_id', sessionId).eq('user_id', uid).maybeSingle();
        allowed = !!part;
      }
      if (!allowed) return json(403, { error: 'not a participant' });
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
    const getRes = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, { headers: dailyHeaders });
    if (getRes.ok) {
      room = await getRes.json();
    } else if (getRes.status === 404) {
      const createRes = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST', headers: dailyHeaders,
        body: JSON.stringify({
          name: roomName,
          privacy: 'private',
          properties: {
            exp: Math.floor(Date.now() / 1000) + 6 * 3600,
            eject_at_room_exp: true,
            enable_screenshare: false,
            start_video_off: false,
          },
        }),
      });
      if (!createRes.ok) return json(502, { error: 'room create failed: ' + await createRes.text() });
      room = await createRes.json();
    } else {
      return json(502, { error: 'room lookup failed: ' + await getRes.text() });
    }

    const tokenRes = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST', headers: dailyHeaders,
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          is_owner: isOwner,
          user_name: displayName || undefined,
          exp: Math.floor(Date.now() / 1000) + 6 * 3600,
        },
      }),
    });
    if (!tokenRes.ok) return json(502, { error: 'token failed: ' + await tokenRes.text() });
    const tokenData = await tokenRes.json();

    return json(200, { roomUrl: room.url, token: tokenData.token });
  } catch (e) {
    return json(500, { error: String((e as any)?.message || e) });
  }
});