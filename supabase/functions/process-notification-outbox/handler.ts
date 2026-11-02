import { createCompatiblePushHandler } from '../send-push-notification/compatibility.ts';
import { boundedPushJson, PUSH_HEADERS, pushResponse, servicePushAuthorized, validUuid, waitForPush } from '../_shared/pushDelivery.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3';

type Lease = { id: string; notification_id: string; lease_id: string; attempts: number; lease_until: string };
type Outcome = { outcome: 'delivered' | 'skipped' | 'retry' | 'dead'; error: string | null;
  accepted: number; rejected: number; unknown: number };
type Dependencies = { service: Pick<SupabaseClient, 'from' | 'rpc'>; serviceKey: string; fetch: typeof fetch;
  authorizeLegacyService?: (request: Request, signal: AbortSignal) => Promise<boolean>;
  authorizeWorker?: (request: Request, signal: AbortSignal) => Promise<boolean>;
  now?: () => number; deadlineMs?: number; maxJobs?: number;
  deliver?: (request: Request) => Promise<Response> };

// HTTP success alone is not a provider receipt. Known partial acceptance must
// never resend all devices automatically. Its unresolved remainder is retained
// as a dead letter for operator reconciliation. A successful provider ticket is
// called "accepted", never "delivered to the phone" in the response or metrics.
export function notificationDispatchOutcome(status: number, body: Record<string, unknown>): Outcome {
  const empty = { accepted: 0, rejected: 0, unknown: 0 };
  if (status >= 200 && status < 300 && body.skipped) return { ...empty, outcome: 'skipped', error: null };
  const counts = ['accepted', 'rejected', 'unknown'].map(key => body[key]);
  const valid = counts.every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100_000);
  if (valid) {
    const [accepted, rejected, unknown] = counts as number[];
    if (unknown > 0) return { accepted, rejected, unknown, outcome: accepted > 0 ? 'dead' : 'retry',
      error: accepted > 0 ? 'PARTIAL_PROVIDER_UNKNOWN' : 'PROVIDER_OUTCOME_UNKNOWN' };
    if (status >= 200 && status < 300) return { accepted, rejected, unknown,
      outcome: accepted === 0 && rejected > 0 ? 'dead' : 'delivered',
      error: accepted === 0 && rejected > 0 ? 'PROVIDER_REJECTED' : null };
    if (accepted > 0) return { accepted, rejected, unknown, outcome: 'dead', error: 'PARTIAL_PROVIDER_FAILURE' };
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return { ...empty, outcome: 'dead', error: 'DISPATCH_CONTRACT_FAILURE' };
  }
  return { ...empty, outcome: 'retry', error: status >= 200 && status < 300 ? 'INVALID_PROVIDER_RECEIPT' : 'DISPATCH_UNAVAILABLE' };
}

export function createNotificationOutboxHandler(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PUSH_HEADERS });
    if (request.method !== 'POST') return pushResponse(405, { error: 'Method not allowed' });
    const started = now(), deadline = Math.min(30_000, Math.max(5_000, deps.deadlineMs ?? 25_000));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deadline)]);
    const limit = Math.min(100, Math.max(1, deps.maxJobs ?? 32));
    let processed = 0, accepted = 0, rejected = 0, unknown = 0, retried = 0, dead = 0, skipped = 0;
    try {
      if (!await servicePushAuthorized(request, deps.serviceKey)
        && await deps.authorizeLegacyService?.(request, signal) !== true
        && await deps.authorizeWorker?.(request, signal) !== true) return pushResponse(401, { error: 'Service authentication required' });
      const fanout = await waitForPush(deps.service.rpc('drain_notification_fanout_v1', { p_jobs: 16, p_page_size: 250 }).abortSignal(signal), signal);
      if (fanout.error) return pushResponse(503, { error: 'Notification fanout unavailable' });
      while (processed < limit && now() - started < deadline - 3_000 && !signal.aborted) {
        const claimed = await waitForPush(deps.service.rpc('claim_notification_dispatch_v1', { p_limit: 1, p_lease_seconds: 90 }).abortSignal(signal), signal);
        if (claimed.error || !Array.isArray(claimed.data)) return pushResponse(503, { error: 'Notification claim unavailable', processed });
        if (!claimed.data.length) break;
        const lease = claimed.data[0] as Lease;
        if (claimed.data.length !== 1 || !validUuid(lease.id) || !validUuid(lease.notification_id) || !validUuid(lease.lease_id)
          || !Number.isSafeInteger(lease.attempts) || lease.attempts < 1) return pushResponse(503, { error: 'Invalid notification lease', processed });
        let outcome: Outcome;
        try {
          const remaining = Math.min(20_000, deadline - (now() - started) - 1_500);
          const deliver = deps.deliver ?? createCompatiblePushHandler({ service: deps.service, serviceKey: deps.serviceKey,
            fetch: deps.fetch, now, deadlineMs: remaining });
          const response = await waitForPush(deliver(new Request('https://internal.invalid/notification', {
            method: 'POST', headers: { Authorization: 'Bearer ' + deps.serviceKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ record: { id: lease.notification_id } }),
            signal: AbortSignal.any([signal, AbortSignal.timeout(remaining)]),
          })), signal);
          const body = await boundedPushJson(response, signal, 16_384);
          outcome = notificationDispatchOutcome(response.status, body);
        } catch {
          outcome = { outcome: 'retry', error: 'DISPATCH_INTERRUPTED', accepted: 0, rejected: 0, unknown: 1 };
        }
        // A separate short deadline lets us persist an interrupted attempt even
        // after the request signal expires. No work continues after this await.
        const ackSignal = AbortSignal.timeout(1_500);
        const ack = await waitForPush(deps.service.rpc('complete_notification_dispatch_v1', {
          p_id: lease.id, p_lease_id: lease.lease_id, p_outcome: outcome.outcome, p_error_code: outcome.error,
          p_accepted: outcome.accepted, p_rejected: outcome.rejected, p_unknown: outcome.unknown,
        }).abortSignal(ackSignal), ackSignal);
        if (ack.error || ack.data !== true) return pushResponse(503, { error: 'Notification receipt not committed', processed });
        processed++; accepted += outcome.accepted; rejected += outcome.rejected; unknown += outcome.unknown;
        if (outcome.outcome === 'retry') retried++;
        if (outcome.outcome === 'dead') dead++;
        if (outcome.outcome === 'skipped') skipped++;
      }
      return pushResponse(200, { processed, accepted, rejected, unknown, retried, dead, skipped });
    } catch { return pushResponse(503, { error: 'Notification processing unavailable', processed }); }
  };
}
