// supabase/functions/send-push-notification/index.ts
// @ts-ignore
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    // @ts-ignore
    const SB_URL = Deno.env.get("SUPABASE_URL");
    // @ts-ignore
    const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SB_URL || !SB_SERVICE) {
      console.error("Missing env vars");
      return json(500, { error: "Server not configured" });
    }

    const body = await req.json();
    console.log("=== send-push-notification invoked ===");

    // Database Webhook sends: { type: "INSERT", table: "notifications", record: {...}, ... }
    const record = body.record || body;
    const recipientId = record.recipient_id || null;
    const actorId = record.actor_id || null;
    const type = record.type || "notification";
    const message = record.message || "";
    const bodyPreview = record.body_preview || "";
    const data = record.data || {};

    if (!recipientId) {
      console.log("No recipient_id, skipping");
      return json(200, { skipped: true, reason: "no recipient" });
    }

    const admin = createClient(SB_URL, SB_SERVICE);

    // Get recipient's push tokens
    const { data: tokens, error: tokenErr } = await admin
      .from("user_push_tokens")
      .select("expo_push_token")
      .eq("user_id", recipientId);

    if (tokenErr) {
      console.error("Token lookup error:", tokenErr.message);
      return json(500, { error: "Token lookup failed" });
    }

    if (!tokens || tokens.length === 0) {
      console.log("No push tokens for user:", recipientId);
      return json(200, { skipped: true, reason: "no tokens" });
    }

    // Check user's notification preferences
    const { data: profile } = await admin
      .from("profiles")
      .select("notif_messages, notif_connections, notif_jobs, notif_prefs, full_name")
      .eq("id", recipientId)
      .single();

    // Respect user preferences
    if (profile) {
      // ONE rule for every type: an explicit false in notif_prefs silences it;
      // a missing key means enabled. Legacy booleans below remain as fallback.
      const prefs = (profile as any).notif_prefs || {};
      if (prefs[type] === false) {
        return json(200, { skipped: "preference" });
      }
      const msgTypes = ["message"];
      const connTypes = ["connection_request", "connection_accepted", "follow"];
      const jobTypes = ["job", "job_application"];

      if (msgTypes.includes(type) && profile.notif_messages === false) {
        console.log("User disabled message notifications");
        return json(200, { skipped: true, reason: "user_pref_messages" });
      }
      if (connTypes.includes(type) && profile.notif_connections === false) {
        console.log("User disabled connection notifications");
        return json(200, { skipped: true, reason: "user_pref_connections" });
      }
      if (jobTypes.includes(type) && profile.notif_jobs === false) {
        console.log("User disabled job notifications");
        return json(200, { skipped: true, reason: "user_pref_jobs" });
      }
    }

    // Get actor name for the notification title
    let actorName = "PlatinumCircles";
    if (actorId) {
      const { data: actor } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", actorId)
        .single();
      if (actor?.full_name) actorName = actor.full_name;
    }

    // Build notification title based on type
    const title = buildTitle(type, actorName, data);
    const notifBody = bodyPreview || message || "";

    // Build push messages for all tokens
    const pushMessages = tokens.map((t) => ({
      to: t.expo_push_token,
      title,
      body: notifBody,
      sound: "default",
      badge: 1,
      data: {
        type,
        notificationId: record.id || null,
        ...data,
      },
    }));

    console.log("Sending " + pushMessages.length + " push(es) for type: " + type);

    // Send to Expo Push API
    const pushRes = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pushMessages),
    });

    const pushResult = await pushRes.json();
    console.log("Expo push response:", JSON.stringify(pushResult));

    return json(200, { sent: pushMessages.length, result: pushResult });
  } catch (e) {
    console.error("send-push-notification error:", e);
    return json(500, { error: String(e?.message || e) });
  }
});

function buildTitle(type, actorName, data) {
  switch (type) {
    case "message":
      if (data?.is_group && data?.group_name) {
        return data.group_name;
      }
      return actorName;
    case "like":
      return actorName + " liked your post";
    case "comment":
      return actorName + " commented";
    case "reply":
      return actorName + " replied";
    case "repost":
      return actorName + " reposted your post";
    case "mention":
      return actorName + " mentioned you";
    case "follow":
      return "New follower";
    case "connection_request":
      return "Connection request";
    case "connection_accepted":
      return "Connection accepted";
    case "missed_call":
      return "Missed call";
    case "mentorship_request":
      return "Mentorship request";
    case "mentorship_accepted":
      return "Mentorship accepted";
    default:
      return "PlatinumCircles";
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
