// Scheduled server-only consumer for durable call revocations. Retries preserve
// the same provider admission identity and are safe after a lost HTTP response.
import { createClient } from 'jsr:@supabase/supabase-js@2';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
Deno.serve(async request => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const workerSecret = Deno.env.get('CALL_RECONCILE_SECRET');
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token || token.length > 512) return json(401, { error: 'unauthorized' });
  const dailyKey = Deno.env.get('DAILY_API_KEY'), base = Deno.env.get('SUPABASE_URL');
  if (!serviceKey || !base) return json(503, { error: 'worker unavailable' });
  const client = createClient(base, serviceKey);
  try {
    if (workerSecret) {
      if (token !== workerSecret) return json(401, { error: 'unauthorized' });
    } else {
      // No secret leaves Vault. This service-role RPC returns only a boolean;
      // ordinary user sessions have no EXECUTE grant or credential-table access.
      const verified = await client.rpc('validate_call_worker_token', { p_token: token });
      if (verified.error) return json(503, { error: 'worker authentication unavailable' });
      if (verified.data !== true) return json(401, { error: 'unauthorized' });
    }
    if (!dailyKey) return json(503, { error: 'worker unavailable' });
    const sweep = await client.rpc('sweep_dead_calls');
    if (sweep.error) return json(503, { error: 'call cleanup unavailable' });
    const { data: jobs, error } = await client.rpc('claim_call_revocations', { p_limit: 50 });
    if (error) return json(503, { error: 'queue unavailable' });
    let completed = 0;
    const processJob = async (job: any) => {
      let ok = false;
      try {
        const result = await fetch(`https://api.daily.co/v1/rooms/${encodeURIComponent(job.call_session_id)}/eject`, {
          method: 'POST', headers: { Authorization: `Bearer ${dailyKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_ids: [job.provider_user_id], ban: true }), signal: AbortSignal.timeout(5000),
        });
        ok = result.ok || result.status === 404;
      } catch { /* Lease expiration makes an interrupted attempt retryable. */ }
      const { error: updateError } = await client.from('call_provider_revocations').update(ok
        ? { completed_at: new Date().toISOString(), last_error: null }
        : { available_at: new Date(Date.now() + Math.min(300000, 1000 * 2 ** Math.min(job.attempts, 8))).toISOString(), last_error: 'provider revocation failed' })
        .eq('id', job.id).eq('attempts', job.attempts);
      if (ok && !updateError) completed++;
    };
    for (let i = 0; i < (jobs?.length || 0); i += 5) await Promise.all(jobs.slice(i, i + 5).map(processJob));
    return json(200, { processed: jobs?.length || 0, completed });
  } catch { return json(503, { error: 'worker unavailable' }); }
});
