// supabase/functions/daily-get-token/index.ts
// @ts-ignore - Deno imports only run in Supabase Edge runtime
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const DAILY_API = "https://api.daily.co/v1";
const DAILY_SUBDOMAIN = "platinumcircles";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    // @ts-ignore
    const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY");
    // @ts-ignore
    const SB_URL = Deno.env.get("SUPABASE_URL");
    // @ts-ignore
    const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY");
    // @ts-ignore
    const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!DAILY_API_KEY || !SB_URL || !SB_ANON || !SB_SERVICE) {
      return j(500, { error: "Server not configured" });
    }

    const auth = req.headers.get("Authorization");
    if (!auth) return j(401, { error: "Missing auth" });

    const userClient = createClient(SB_URL, SB_ANON, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return j(401, { error: "Invalid auth" });
    const userId = userRes.user.id;

    const body = await req.json();
    const callSessionId: string | undefined = body?.callSessionId;
    const roomNameIn: string | undefined = body?.roomName;
    const isOwner: boolean = body?.isOwner === true;
    const kind: "call" | "meeting" = body?.kind === "meeting" ? "meeting" : "call";

    if (!callSessionId && !roomNameIn) {
      return j(400, { error: "callSessionId or roomName required" });
    }

    const admin = createClient(SB_URL, SB_SERVICE);

    let roomName: string;
    let expSeconds = 60 * 60;

    if (kind === "call" && callSessionId) {
      const { data: call, error } = await admin
        .from("call_sessions")
        .select("id, initiator_id, receiver_id, agora_channel, status")
        .eq("id", callSessionId)
        .single();
      if (error || !call) return j(404, { error: "Call not found" });

      if (call.initiator_id !== userId && call.receiver_id !== userId) {
        return j(403, { error: "Not a participant" });
      }
      if (call.status === "ended" || call.status === "declined" || call.status === "missed") {
        return j(400, { error: "Call is no longer active" });
      }

      roomName = call.agora_channel;
    } else {
      roomName = roomNameIn!;
      expSeconds = 60 * 60 * 24;
    }

    const roomRes = await fetch(`${DAILY_API}/rooms/${roomName}`, {
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    });

    if (roomRes.status === 404) {
      const createRes = await fetch(`${DAILY_API}/rooms`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DAILY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: roomName,
          privacy: "private",
          properties: {
            max_participants: kind === "meeting" ? 50 : 2,
            enable_chat: kind === "meeting",
            enable_screenshare: true,
            start_audio_off: false,
            start_video_off: kind === "call",
            exp: Math.floor(Date.now() / 1000) + expSeconds,
            eject_at_room_exp: true,
          },
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        console.error("Daily room create failed:", err);
        return j(500, { error: "Could not create room" });
      }
    } else if (!roomRes.ok) {
      return j(500, { error: "Daily room check failed" });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, username")
      .eq("id", userId)
      .single();
    const displayName = profile?.full_name || profile?.username || "User";

    const tokenRes = await fetch(`${DAILY_API}/meeting-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DAILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          user_id: userId,
          user_name: displayName,
          is_owner: isOwner,
          exp: Math.floor(Date.now() / 1000) + expSeconds,
        },
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Daily token create failed:", err);
      return j(500, { error: "Could not create token" });
    }

    const tokenJson = await tokenRes.json();

    return j(200, {
      roomName,
      roomUrl: `https://${DAILY_SUBDOMAIN}.daily.co/${roomName}`,
      token: tokenJson.token,
    });
  } catch (e) {
    console.error("daily-get-token error:", e);
    return j(500, { error: String((e as Error)?.message || e) });
  }
});

function j(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}