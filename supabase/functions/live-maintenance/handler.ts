import { dailyCommandAccepted } from '../_shared/dailyCommandAcknowledgement.ts';
type Result = { data: unknown; error: unknown };
export type Dependencies = {
  rpc(name: string, args: Record<string, unknown>, signal: AbortSignal): PromiseLike<Result>;
  removeCover(path: string, signal: AbortSignal): PromiseLike<{ error: unknown }>;
  fetch: typeof fetch;
  dailyKey: string;
  configuration: Record<string, boolean>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^pc_live_[a-f0-9]{64}$/;
const COVER = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store' },
});
async function providerBody(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PROVIDER_INVALID_RESPONSE');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 32768) { await reader.cancel(); throw new Error('PROVIDER_INVALID_RESPONSE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!record(parsed)) throw new Error('PROVIDER_INVALID_RESPONSE');
  return parsed;
}
async function pairs<T>(items: T[], action: (item: T) => Promise<void>) {
  // Promise.allSettled prevents a failure receipt while sibling work is running.
  for (let i = 0; i < items.length; i += 2) {
    const settled = await Promise.allSettled(items.slice(i, i + 2).map(action));
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
}
async function inspectProvider(deps: Dependencies, signal: AbortSignal) {
  try {
    if (!deps.dailyKey) throw new Error('PROVIDER_NOT_CONFIGURED');
    const response = await deps.fetch('https://api.daily.co/v1/', {
      method: 'GET', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      headers: { Authorization: `Bearer ${deps.dailyKey}` },
    });
    if (!response.ok || response.redirected) {
      await response.body?.cancel();
      throw new Error('PROVIDER_REQUEST_FAILED');
    }
    const body = await providerBody(response);
    if (typeof body.domain_name !== 'string' || !DOMAIN_LABEL.test(body.domain_name) || !uuid(body.domain_id)) {
      throw new Error('PROVIDER_INVALID_RESPONSE');
    }
    return { ok: true, domain_name: body.domain_name, domain_id: body.domain_id.toLowerCase() };
  } catch {
    // Provider payloads and errors can contain credentials or private settings.
    return { ok: false, error: 'PROVIDER_INSPECTION_UNAVAILABLE' };
  }
}

export function createMaintenanceHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    // No static worker secret, app JWT, publishable key or service key is accepted.
    if (!TOKEN.test(token)) return reply(401, { error: 'AUTH_REQUIRED' });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)]);
    const rpc = async (name: string, args: Record<string, unknown>, deadline = signal) => {
      const result = await deps.rpc(name, args, deadline);
      if (result.error) throw new Error('DATABASE_UNAVAILABLE');
      return result.data;
    };
    const objectRpc = async (name: string, args: Record<string, unknown>) => {
      const value = await rpc(name, args);
      if (!record(value)) throw new Error('DATABASE_INVALID_RESPONSE');
      return value;
    };
    const jobsRpc = async (name: string) => {
      const value = await objectRpc(name, { p_limit: 4 });
      if (!Array.isArray(value.items) || value.items.length > 4 || !value.items.every(record)) throw new Error('DATABASE_INVALID_RESPONSE');
      return value.items as Record<string, unknown>[];
    };
    const finish = (succeeded: boolean) => rpc('finish_live_worker_tick_v1',
      { p_token: token, p_succeeded: succeeded }, AbortSignal.timeout(4000));
    let validated = false;
    try {
      if (await rpc('validate_live_worker_tick_v1', { p_token: token }) !== true) return reply(401, { error: 'AUTH_REQUIRED' });
      validated = true;
      const database = await objectRpc('live_maintenance', { p_limit: 1000 });
      let providerCompleted = 0, providerFailed = 0, providerRecovered = 0, coversErased = 0, coversFailed = 0;
      let recoveryAttempted = false;
      // Claims are bounded and database-leased. A crashed run is recoverable.
      const jobs = await jobsRpc('live_claim_outbox');
      await pairs(jobs, async job => {
        if (!uuid(job.id) || !uuid(job.lease_id)) throw new Error('INVALID_JOB');
        let ok = false, recovered = false, error: string | null = null;
        try {
          if (typeof job.room_name !== 'string' || !/^pc-live-[0-9a-f]{32}$/.test(job.room_name)) throw new Error('INVALID_JOB');
          if (!deps.dailyKey) throw new Error('PROVIDER_NOT_CONFIGURED');
          let path: string, payload: Record<string, unknown>;
          if (job.action === 'eject' && uuid(job.provider_identity)) {
            path = `/rooms/${job.room_name}/eject`; payload = { user_ids: [job.provider_identity], ban: true };
          } else if (job.action === 'stop' && uuid(job.instance_id)) {
            path = `/rooms/${job.room_name}/live-streaming/stop`; payload = { instanceId: job.instance_id };
          } else throw new Error('INVALID_JOB');
          const response = await deps.fetch(`https://api.daily.co/v1${path}`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
            headers: { Authorization: `Bearer ${deps.dailyKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          });
          if (!response.ok && response.status !== 404) { await response.body?.cancel(); throw new Error('PROVIDER_REQUEST_FAILED'); }
          const body = await providerBody(response);
          if (response.status === 404 && job.action === 'stop' && !recoveryAttempted && body.error === 'not-found') {
            // At most one recovery per tick. A 404 alone never ends a stream.
            // Only a stale, never-confirmed start can retire its unique room.
            recoveryAttempted = true;
            const checked = await objectRpc('live_failed_start_recovery_context', { p_id: job.id, p_lease: job.lease_id });
            if (checked.eligible !== true || !uuid(checked.session_id) || checked.session_id !== job.session_id
              || checked.room_name !== job.room_name || checked.instance_id !== job.instance_id
              || checked.room_name !== 'pc-live-' + checked.session_id.replaceAll('-', '')) throw new Error('RECOVERY_NOT_AVAILABLE');
            if (checked.recovery_started !== true) {
              if (body.info !== `room ${job.room_name} does not seem to be hosting a call currently`) throw new Error('RECOVERY_NOT_AVAILABLE');
              const started = await objectRpc('live_begin_failed_start_recovery', { p_id: job.id, p_lease: job.lease_id,
                p_instance: job.instance_id, p_room: job.room_name, p_observed_at: new Date().toISOString() });
              if (started.ok !== true || started.recovery_started !== true || started.session_id !== job.session_id
                || started.room_name !== job.room_name || started.instance_id !== job.instance_id) throw new Error('RECOVERY_NOT_AVAILABLE');
            }
            const roomUrl = `https://api.daily.co/v1/rooms/${job.room_name}`;
            const removed = await deps.fetch(roomUrl, { method: 'DELETE', redirect: 'error',
              signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]), headers: { Authorization: `Bearer ${deps.dailyKey}` } });
            if (removed.status === 200) {
              const deleted = await providerBody(removed);
              if (deleted.deleted !== true || deleted.name !== job.room_name) throw new Error('RECOVERY_NOT_CONFIRMED');
            } else {
              await removed.body?.cancel();
              // A persisted no-current-call receipt authorizes resuming an
              // interrupted retirement. Initial arbitrary 404s never reach here.
              if (removed.status !== 404) throw new Error('RECOVERY_NOT_CONFIRMED');
            }
            const absent = await deps.fetch(roomUrl, { method: 'GET', redirect: 'error',
              signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]), headers: { Authorization: `Bearer ${deps.dailyKey}` } });
            await absent.body?.cancel();
            if (absent.status !== 404) throw new Error('RECOVERY_NOT_CONFIRMED');
            const receipt = await objectRpc('live_finish_failed_start_recovery', { p_id: job.id, p_lease: job.lease_id,
              p_instance: job.instance_id, p_room: job.room_name, p_confirmed_at: new Date().toISOString() });
            if (receipt.ok !== true || receipt.state !== 'cancelled' || receipt.session_id !== job.session_id) throw new Error('RECOVERY_NOT_CONFIRMED');
            recovered = true; providerRecovered++;
          } else if (!response.ok || (job.action === 'stop' ? !dailyCommandAccepted(body) : !Array.isArray(body.ejectedIds))) {
            throw new Error('PROVIDER_UNCONFIRMED');
          }
          ok = true; providerCompleted++;
        } catch { error = 'provider_operation_unconfirmed'; providerFailed++; }
        // Recovery atomically completes the stop lease with its cancellation receipt.
        if (!recovered) await objectRpc('live_finish_outbox', { p_id: job.id, p_lease: job.lease_id, p_ok: ok, p_error: error });
      });
      const covers = await jobsRpc('live_claim_cover_cleanup');
      await pairs(covers, async job => {
        if (!uuid(job.id) || !uuid(job.lease_id)) throw new Error('INVALID_JOB');
        let ok = false, error: string | null = null;
        try {
          const checked = await objectRpc('live_check_cover_cleanup', { p_id: job.id, p_lease: job.lease_id });
          if (typeof checked.absent !== 'boolean' || typeof checked.object_path !== 'string'
            || !COVER.test(checked.object_path) || checked.object_path !== job.object_path
            || checked.object_path.split('/')[0] !== job.user_id) throw new Error('INVALID_COVER');
          if (!checked.absent) {
            const removed = await deps.removeCover(checked.object_path, signal);
            if (removed.error) throw new Error('COVER_STORAGE_UNAVAILABLE');
          }
          ok = true;
        } catch { error = 'cover_cleanup_unconfirmed'; coversFailed++; }
        // The database independently verifies actual object absence before ack.
        await objectRpc('live_finish_cover_cleanup', { p_id: job.id, p_lease: job.lease_id, p_ok: ok, p_error: error });
        if (ok) coversErased++;
      });
      const succeeded = providerFailed === 0 && coversFailed === 0;
      if (await finish(succeeded) !== true) throw new Error('COMPLETION_NOT_CONFIRMED');
      // Explicit one-use diagnostics run only after successful maintenance is acknowledged.
      // Their result never changes cleanup or tick-completion semantics.
      const inspection = succeeded && request.headers.get('X-Platinum-Live-Inspect-Provider') === '1'
        ? { provider_inspection: await inspectProvider(deps, signal) } : {};
      return reply(succeeded ? 200 : 503, { ok: succeeded, worker_auth: 'single_use_tick_v1', ...database,
        provider_jobs_completed: providerCompleted, provider_jobs_failed: providerFailed, provider_jobs_recovered: providerRecovered,
        covers_erased: coversErased, covers_failed: coversFailed,
        provider_configuration: deps.configuration, ...inspection });
    } catch {
      if (validated) { try { await finish(false); } catch { /* Expiry recovers interrupted runs. */ } }
      return reply(503, { error: 'LIVE_MAINTENANCE_UNAVAILABLE' });
    }
  };
}
