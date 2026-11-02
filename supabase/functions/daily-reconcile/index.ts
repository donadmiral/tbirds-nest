// Scheduled server-only consumer for durable call revocations. Retries preserve
// the same provider admission identity and are safe after a lost HTTP response.
import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const boundedInteger = (value: string | undefined, fallback: number, maximum: number) => {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, Math.floor(parsed))) : fallback;
};
const retryAfterMs = (value: string | null, now: number) => {
  if (!value || value.length > 128) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  // Keep a provider date representable without shortening normal Retry-After values.
  return Number.isFinite(delay) ? Math.max(0, Math.min(8_640_000_000_000_000 - now, delay)) : 0;
};
Deno.serve(async request => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token || token.length > 512) return json(401, { error: 'unauthorized' });
  const dailyKey = Deno.env.get('DAILY_API_KEY'), base = Deno.env.get('SUPABASE_URL');
  if (!serviceKey || !base) return json(503, { error: 'worker unavailable' });
  const deadline = Date.now() + 55000;
  const maxClaims = boundedInteger(Deno.env.get('CALL_REVOCATION_MAX_CLAIMS'), 3, 10);
  const maxJobs = boundedInteger(Deno.env.get('CALL_REVOCATION_MAX_JOBS'), 150, 500);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55000)]);
  const client = createClient(base, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: serviceRoleFetch(fetch, serviceKey, signal) },
  });
  try {
    // The database validates a scoped invocation capability and returns only a
    // boolean. A one-use tick may be visible in a scheduler transport queue, but
    // it can only advance already-authorized jobs and cannot choose a room.
    const verified = await client.rpc('validate_call_worker_token', { p_token: token });
    if (verified.error) return json(503, { error: 'worker authentication unavailable' });
    if (verified.data !== true) return json(401, { error: 'unauthorized' });
    if (!dailyKey) return json(503, { error: 'worker unavailable' });
    const sweep = await client.rpc('sweep_dead_calls');
    if (sweep.error) return json(503, { error: 'call cleanup unavailable' });
    let claimed = 0, processed = 0, completed = 0, claims = 0, throttled = false, backoffUntil = 0;
    const processJob = async (job: any) => {
      processed++;
      let ok = false, providerDelay = 0, providerPaused = false;
      try {
        const result = await fetch(`https://api.daily.co/v1/rooms/${encodeURIComponent(job.call_session_id)}/eject`, {
          method: 'POST', headers: { Authorization: `Bearer ${dailyKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_ids: [job.provider_user_id], ban: true }), signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        ok = result.ok || result.status === 404;
        if (!ok) {
          providerDelay = retryAfterMs(result.headers.get('Retry-After'), Date.now());
          if (result.status === 429 || providerDelay > 0) providerPaused = throttled = true;
        }
        await result.body?.cancel();
      } catch { /* Lease expiration makes an interrupted attempt retryable. */ }
      const retryDelay = Math.max(providerDelay, Math.min(300000, 1000 * 2 ** Math.min(job.attempts, 8)));
      const retryAt = Math.min(8_640_000_000_000_000, Date.now() + retryDelay);
      if (providerPaused) backoffUntil = Math.max(backoffUntil, retryAt);
      const { error: updateError } = await client.from('call_provider_revocations').update(ok
        ? { completed_at: new Date().toISOString(), last_error: null }
        : { available_at: new Date(retryAt).toISOString(), last_error: 'provider revocation failed' })
        .eq('id', job.id).eq('attempts', job.attempts);
      if (ok && !updateError) completed++;
    };
    while (claims < maxClaims && claimed < maxJobs && !throttled && !signal.aborted && Date.now() < deadline - 6000) {
      const limit = Math.min(50, maxJobs - claimed);
      const { data: jobs, error } = await client.rpc('claim_call_revocations', { p_limit: limit });
      if (error || (jobs != null && !Array.isArray(jobs))) return json(503, { error: 'queue unavailable' });
      claims++;
      if (!jobs?.length) break;
      claimed += jobs.length;
      for (let i = 0; i < jobs.length; i += 5) {
        if (throttled || signal.aborted || Date.now() >= deadline - 1000) break;
        // Claimed but unattempted jobs retain their two-minute retry lease.
        await Promise.allSettled(jobs.slice(i, i + 5).map(processJob));
        if (throttled && backoffUntil) {
          const paused = await client.rpc('defer_call_worker', { p_until: new Date(backoffUntil).toISOString() });
          if (paused.error || paused.data !== true) return json(503, { error: 'provider backoff persistence unavailable' });
        }
      }
    }
    return json(200, { claimed, processed, completed, claims, deferred: claimed - processed, throttled,
      ...(backoffUntil ? { backoffUntil: new Date(backoffUntil).toISOString() } : {}),
      deadlineReached: signal.aborted || Date.now() >= deadline - 6000 });
  } catch { return json(503, { error: 'worker unavailable' }); }
});
