import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3';
import { notificationAllowed, notificationCategory } from '../../../shared/notificationPreferences.ts';
import { boundedPushJson, PUSH_HEADERS, pushResponse, sendExpoPushes, servicePushAuthorized, validExpoToken, validUuid, waitForPush } from '../_shared/pushDelivery.ts';

type Dependencies = { service: Pick<SupabaseClient, 'from' | 'rpc'>; serviceKey: string; fetch: typeof fetch;
  expoAccessToken?: string; now?: () => number; deadlineMs?: number };
const PREF_COLUMNS = 'notif_messages,notif_connections,notif_jobs,notif_prefs,quiet_from,quiet_to,quiet_tz_offset_min,deactivated_at';

function titleFor(type: string, actor: string, data: Record<string, unknown>): string {
  if (type === 'message') return data.is_group && typeof data.group_name === 'string' ? data.group_name : actor;
  const titles: Record<string, string> = {
    like: `${actor} liked your post`, comment_like: `${actor} liked your comment`, story_reaction: `${actor} reacted to your story`,
    comment: `${actor} commented`, reply: `${actor} replied`, repost: `${actor} reposted your post`, mention: `${actor} mentioned you`,
    follow: 'New follower', connection_request: 'Connection request', connection_accepted: 'Connection accepted',
    missed_call: 'Missed call', mentorship_request: 'Mentorship request', mentorship_accepted: 'Mentorship accepted',
    follow_request: `${actor} requested to follow you`, follow_accepted: `${actor} accepted your follow request`,
    community_invite: `${actor} invited you to a community`, collab_invite: `${actor} invited you to collaborate`,
    job_application: 'New job application', job_referral: 'New job referral', payment_received: 'Payment received',
  };
  return type === 'system' && typeof data.title === 'string' ? data.title : titles[type] || 'Platinum Circles';
}

export function createPushNotificationHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PUSH_HEADERS });
    if (request.method !== 'POST') return pushResponse(405, { error: 'Method not allowed' });
    // The database trigger uses its Vault-held service credential. A public
    // API key or ordinary user's JWT never authorizes another person's push.
    if (!await servicePushAuthorized(request, deps.serviceKey)) return pushResponse(401, { error: 'Service authentication required' });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deps.deadlineMs ?? 20_000)]);
    const db = deps.service, now = deps.now ?? Date.now;
    try {
      let body: Record<string, unknown>;
      try { body = await boundedPushJson(request, signal); }
      catch { return pushResponse(400, { error: 'A stored notification ID is required' }); }
      const provided = body.record && typeof body.record === 'object' ? body.record as Record<string, unknown> : body;
      if (!validUuid(provided.id)) return pushResponse(400, { error: 'A stored notification ID is required' });
      const { data: record, error: readError } = await db.from('notifications')
        .select('id,recipient_id,actor_id,type,message,body_preview,data,created_at').eq('id', provided.id).abortSignal(signal).maybeSingle();
      if (readError) return pushResponse(503, { error: 'Notification lookup unavailable' });
      if (!record) return pushResponse(200, { skipped: true, reason: 'notification unavailable' });
      const recipient = record.recipient_id, type = String(record.type ?? ''), category = notificationCategory(type);
      if (!validUuid(recipient)) return pushResponse(200, { skipped: true, reason: 'recipient unavailable' });
      if (type === 'incoming_call') return pushResponse(200, { skipped: true, reason: 'call ring handled separately' });
      const created = Date.parse(record.created_at);
      if (!Number.isFinite(created) || created > now() + 60_000 || created < now() - 24 * 3600_000) return pushResponse(200, { skipped: true, reason: 'expired notification' });
      const allowed = async () => {
        const { data, error } = await db.from('profiles').select(PREF_COLUMNS).eq('id', recipient).abortSignal(signal).maybeSingle();
        if (error) throw error;
        return notificationAllowed(data, type, now());
      };
      if (!await allowed()) return pushResponse(200, { skipped: true, reason: 'recipient preferences or quiet hours', category });
      const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data as Record<string, unknown> : {};
      let rollupOthers = 0;
      if (['like', 'comment_like', 'repost', 'story_reaction', 'follow', 'follow_accepted'].includes(type)) {
        const key = validUuid(data.post_id) ? 'post_id' : validUuid(data.story_id) ? 'story_id' : validUuid(data.comment_id) ? 'comment_id' : null;
        let query = db.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', recipient).eq('type', type)
          .gte('created_at', new Date(now() - 10 * 60_000).toISOString()).abortSignal(signal);
        if (key) query = query.filter(`data->>${key}`, 'eq', data[key]);
        const { count, error } = await query;
        if (error) return pushResponse(503, { error: 'Notification grouping unavailable' });
        const n = Number(count ?? 0);
        if (n > 1 && ![5, 10, 25, 50, 100, 250, 500, 1000].includes(n)) return pushResponse(200, { skipped: true, reason: 'grouped activity' });
        rollupOthers = Math.max(0, n - 1);
      }
      const { data: rows, error: tokensError } = await db.from('user_push_tokens').select('id,expo_push_token,updated_at')
        .eq('user_id', recipient).limit(1001).abortSignal(signal);
      if (tokensError || !rows || rows.length > 1000) return pushResponse(503, { error: 'Device lookup unavailable' });
      const tokens = Array.from(new Set<string>(rows.map(row => row.expo_push_token).filter(validExpoToken)));
      if (!tokens.length) return pushResponse(200, { skipped: true, reason: 'no registered devices' });
      let actor = 'Platinum Circles';
      if (validUuid(record.actor_id)) {
        const { data: profile } = await db.from('profiles').select('full_name').eq('id', record.actor_id).abortSignal(signal).maybeSingle();
        if (profile?.full_name) actor = String(profile.full_name).slice(0, 120);
      }
      const title = (rollupOthers ? type === 'follow' ? `${rollupOthers + 1} new followers`
        : titleFor(type, `${actor} and ${rollupOthers} others`, data) : titleFor(type, actor, data)).slice(0, 200);
      const text = String(record.body_preview || record.message || '').slice(0, 500);
      // Stored user text cannot replace authoritative routing metadata. Keep
      // navigation identifiers within the provider's payload size limit.
      const route: Record<string, unknown> = {};
      for (const key of ['post_id', 'story_id', 'comment_id', 'conversation_id', 'call_id', 'job_id', 'listing_id', 'community_id', 'business_id', 'channel_id']) {
        if (validUuid(data[key])) route[key] = data[key];
      }
      const payload = { ...route, type, category, notificationId: record.id };
      const { data: badge, error: badgeError } = await db.rpc('get_notification_badge_count', { p_recipient: recipient }).abortSignal(signal);
      // An unavailable badge must not clear an existing valid icon count.
      const badgeValue = !badgeError && Number.isSafeInteger(badge) && badge >= 0 ? Math.min(badge, 9999) : undefined;
      const result = await sendExpoPushes(tokens.map(to => ({ to, title, body: text, sound: 'default',
        ...(badgeValue === undefined ? {} : { badge: badgeValue }), channelId: category, priority: category === 'messages' || category === 'calls' ? 'high' : 'default',
        data: payload })), { fetch: deps.fetch, signal, accessToken: deps.expoAccessToken, maySend: allowed });
      for (const token of result.invalidTokens) {
        for (const row of rows.filter(row => row.expo_push_token === token)) {
          // Only remove the exact registration rejected by the provider.
          await waitForPush(db.from('user_push_tokens').delete().eq('id', row.id).eq('user_id', recipient)
            .eq('expo_push_token', token).eq('updated_at', row.updated_at).abortSignal(signal), signal);
        }
      }
      return pushResponse(result.unknown ? 502 : 200, { accepted: result.accepted, rejected: result.rejected, unknown: result.unknown, category });
    } catch { return pushResponse(503, { error: 'Notification delivery is temporarily unavailable' }); }
  };
}
