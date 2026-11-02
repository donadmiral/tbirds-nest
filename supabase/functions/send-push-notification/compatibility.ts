// Compatibility entry point for installations with the existing notification schema.
// Preserve title, preference, grouping and badge behavior while authenticating the
// caller, reading canonical events and reporting provider outcomes accurately.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3';
import { boundedPushJson, PUSH_HEADERS, pushResponse as json, sendExpoPushes, servicePushAuthorized, validExpoToken, validUuid } from '../_shared/pushDelivery.ts';
type Dependencies = { service: Pick<SupabaseClient, 'from' | 'rpc'>; serviceKey: string; fetch: typeof fetch; deadlineMs?: number; now?: () => number; expoAccessToken?: string;
  authorizeLegacyService?: (request: Request, signal: AbortSignal) => Promise<boolean> };

export function createCompatiblePushHandler(deps: Dependencies) {
 return async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: PUSH_HEADERS });
  }

  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(deps.deadlineMs ?? 20_000)]);
    const authorized = await servicePushAuthorized(req, deps.serviceKey)
      || await deps.authorizeLegacyService?.(req, signal) === true;
    if (!authorized) return json(401, { error: "Service authentication required" });
    const body = await boundedPushJson(req, signal);
    const supplied = body.record && typeof body.record === "object" ? body.record as Record<string, unknown> : body;
    if (!validUuid(supplied.id)) return json(400, { error: "A stored notification ID is required" });
    const admin = deps.service;
    const { data: stored, error: lookupError } = await admin.from("notifications")
      .select("id,recipient_id,actor_id,type,message,body_preview,data,created_at")
      .eq("id", supplied.id).abortSignal(signal).maybeSingle();
    if (lookupError) return json(503, { error: "Notification lookup unavailable" });
    if (!stored) return json(200, { skipped: true, reason: "notification unavailable" });

    // Database Webhook sends: { type: "INSERT", table: "notifications", record: {...}, ... }
    const record = stored;
    const recipientId = record.recipient_id || null;
    const actorId = record.actor_id || null;
    const type = record.type || "notification";
    if (!recipientId) return json(200, { skipped: true, reason: "no recipient" });
    // Instagram's categories: what happened decides the category; the category decides the Android channel and the person's preference.
    const CATEGORY: Record<string, string> = {
      like: "likes", comment_like: "likes", story_reaction: "likes", repost: "likes",
      comment: "comments", reply: "comments",
      mention: "mentions", story_mention: "mentions",
      message: "messages", message_request: "messages",
      message_reaction: "message_reactions",
      follow: "followers", follow_request: "followers", follow_accepted: "followers", connection_request: "followers", connection_accepted: "followers",
      incoming_call: "calls", missed_call: "calls",
      community_invite: "updates", collab_invite: "updates", business_member: "updates", channel_post: "updates",
      job_application: "jobs", job_referral: "jobs",
      payment_received: "payments",
      system: "account", login_alert: "account", verification: "account",
    };
    const category = CATEGORY[type] || "updates";
    // Ringing is send-voip-push's job on both platforms (CallKit on iPhone, the
    // call channel on Android). A second push here only doubles the ring.
    if (type === "incoming_call") return json(200, { skipped: true, reason: "rung by send-voip-push" });

    // Quiet mode: nothing pushes during the person's chosen hours, in their own time zone.
    {
      const { data: prof, error: quietError } = await admin.from("profiles").select("quiet_from, quiet_to, quiet_tz_offset_min").eq("id", recipientId).abortSignal(signal).maybeSingle();
      if (quietError) return json(503, { error: "Notification preferences unavailable" });
      const qf = (prof as any)?.quiet_from, qt = (prof as any)?.quiet_to;
      if (qf != null && qt != null) {
        const off = Number((prof as any)?.quiet_tz_offset_min || 0);
        const hour = ((new Date((deps.now ?? Date.now)() + off * 60000).getUTCHours()) + 24) % 24;
        const inWindow = qf <= qt ? (hour >= qf && hour < qt) : (hour >= qf || hour < qt);
        if (inWindow) return json(200, { skipped: true, reason: "quiet mode" });
      }
    }
    // Collapse: a burst of likes, reposts or follows on one thing becomes one push at milestones, never a push per tap.
    let rollupOthers = 0;
    if (recipientId && ["like", "comment_like", "repost", "story_reaction", "follow", "follow_accepted"].includes(type)) {
      const d = record.data || {};
      const key = d.post_id ? "post_id" : d.story_id ? "story_id" : d.comment_id ? "comment_id" : null;
      const since = new Date((deps.now ?? Date.now)() - 10 * 60 * 1000).toISOString();
      let q = admin.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", recipientId).eq("type", type).gte("created_at", since);
      if (key) q = q.filter("data->>" + key, "eq", String(d[key]));
      const { count } = await q.abortSignal(signal);
      const n = Number(count || 0);
      if (n > 1 && ![5, 10, 25, 50, 100, 250, 500, 1000].includes(n)) return json(200, { skipped: true, reason: "collapsed", n });
      if (n > 1) rollupOthers = n - 1;
    }
    const message = record.message || "";
    const bodyPreview = record.body_preview || "";
    const data = record.data || {};

    // Get recipient's push tokens
    const { data: tokens, error: tokenErr } = await admin
      .from("user_push_tokens")
      .select("expo_push_token")
      .eq("user_id", recipientId)
      .limit(1001).abortSignal(signal);

    if (tokenErr || (tokens?.length ?? 0) > 1000) {

      return json(500, { error: "Token lookup failed" });
    }

    if (!tokens || tokens.length === 0) {
      return json(200, { skipped: true, reason: "no tokens" });
    }

    // Check user's notification preferences
    const { data: profile, error: preferenceError } = await admin
      .from("profiles")
      .select("notif_messages, notif_connections, notif_jobs, notif_prefs, full_name")
      .eq("id", recipientId)
      .abortSignal(signal).single();
    if (preferenceError) return json(503, { error: "Notification preferences unavailable" });

    // Respect user preferences
    if (profile) {
      // ONE rule for every type: an explicit false in notif_prefs silences it;
      // a missing key means enabled. Legacy booleans below remain as fallback.
      const prefs = (profile as any).notif_prefs || {};
      if (prefs[type] === false || prefs[category] === false) {
        return json(200, { skipped: "preference", category });
      }
      const msgTypes = ["message"];
      const connTypes = ["connection_request", "connection_accepted", "follow"];
      const jobTypes = ["job", "job_application"];

      if (msgTypes.includes(type) && profile.notif_messages === false) {
        return json(200, { skipped: true, reason: "user_pref_messages" });
      }
      if (connTypes.includes(type) && profile.notif_connections === false) {
        return json(200, { skipped: true, reason: "user_pref_connections" });
      }
      if (jobTypes.includes(type) && profile.notif_jobs === false) {
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
        .abortSignal(signal).single();
      if (actor?.full_name) actorName = actor.full_name;
    }

    // Build notification title based on type
    const title = rollupOthers > 0
      ? (type === "follow" ? String(rollupOthers + 1) + " new followers" : buildTitle(type, actorName + " and " + rollupOthers + " others", data))
      : buildTitle(type, actorName, data);
    const notifBody = bodyPreview || message || "";

    // Icon badge policy (2026-07-28): the number means unread MESSAGES only.
    // Non-message pushes still deliver, carrying the same message count; zero clears it.
    let unreadCount: number | undefined;
    try {
      const { data: badge, error } = await admin.rpc('get_push_message_badge_v1', { p_recipient: recipientId }).abortSignal(signal);
      const count = typeof badge === 'number' || typeof badge === 'string' ? Number(badge) : NaN;
      if (!error && Number.isSafeInteger(count) && count >= 0) unreadCount = count;
    } catch { /* Unknown counts leave the device's existing badge intact. */ }

    // Build push messages for all tokens
    const uniqueTokens = [...new Set<string>(tokens.map((t: {expo_push_token: string}) => t.expo_push_token).filter(validExpoToken))];
    const pushMessages = uniqueTokens.map(to => ({
      to,
      title,
      body: notifBody,
      sound: "default",
      badge: unreadCount,
      channelId: category,
      priority: (category === "messages" || category === "calls") ? "high" : "default",
      data: {
        ...data,
        type,
        category,
        notificationId: record.id,
      },
    }));

    const result = await sendExpoPushes(pushMessages, { fetch: deps.fetch, signal, accessToken: deps.expoAccessToken });
    return json(result.unknown ? 502 : 200, {
      sent: result.accepted, accepted: result.accepted, rejected: result.rejected, unknown: result.unknown,
    });
  } catch {
    return json(503, { error: "Notification delivery is temporarily unavailable" });
  }
 };
}

function buildTitle(type: string, actorName: string, data: Record<string, any>) {
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
    case "system":
      return (data && data.title) || "System alert";
    case "mentorship_accepted":
      return "Mentorship accepted";
    case "comment_like":
      return actorName + " liked your comment";
    case "story_reaction":
      return actorName + " reacted to your story";
    case "follow_request":
      return actorName + " requested to follow you";
    case "follow_accepted":
      return actorName + " accepted your follow request";
    case "community_invite":
      return actorName + " invited you to a community";
    default:
      return "PlatinumCircles";
  }
}
