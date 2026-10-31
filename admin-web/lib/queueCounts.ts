import 'server-only';
import { allowedDesks, canPerform } from './permissions';
import { serviceClient } from './supabaseAdmin';
import type { QueueCounts } from './queueCountState';

/** Request-local, permission-shaped reads. Queue badges never hold up a desk. */
export async function loadQueueCounts(role: string): Promise<QueueCounts> {
  try {
  const allow = allowedDesks(role);
  const svc = serviceClient();
  const signal = AbortSignal.timeout(5_000);
  const none = { count: 0, error: null };
  const results = await Promise.allSettled([
    allow.has('/queue') ? svc.from('verification_applications').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'under_review']).abortSignal(signal) : none,
    canPerform(role, 'report_post') ? svc.from('post_reports').select('id', { count: 'exact', head: true }).eq('status', 'open').abortSignal(signal) : none,
    canPerform(role, 'report_listing') ? svc.from('listing_reports').select('id', { count: 'exact', head: true }).eq('status', 'open').abortSignal(signal) : none,
    canPerform(role, 'report_user') ? svc.from('user_reports').select('id', { count: 'exact', head: true }).eq('status', 'open').abortSignal(signal) : none,
    allow.has('/support') ? svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open').abortSignal(signal) : none,
  ]);
  const values = results.map(result => result.status === 'fulfilled' && !result.value.error
    && Number.isSafeInteger(result.value.count) && (result.value.count ?? -1) >= 0 ? result.value.count : null);
  const [queue, post, listing, user, support] = values;
  const reports = post === null || listing === null || user === null ? null : post + listing + user;
  const unavailable = values.some(value => value === null);
  return {
    counts: { '/queue': queue, '/reports': reports, '/support': support },
    alerts: unavailable ? null : (queue ?? 0) + (reports ?? 0) + (support ?? 0),
    unavailable,
  };
  } catch {
    // Construction failures (for example a missing provider configuration)
    // must not reject the promise consumed by the entire navigation shell.
    return { counts: { '/queue': null, '/reports': null, '/support': null }, alerts: null, unavailable: true };
  }
}
