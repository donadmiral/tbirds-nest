type Cleanup = { kind?:'original'|'catalogue';id: string; ownerId?: string;providerId?:string;sha256?:string;path: string; leaseToken: string; objectId: string | null; version: string | null };
type Dependencies = {
  env(name: string): string | undefined;
  rpc(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  fetch: typeof fetch;
  uuid(): string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
function validJob(value: unknown, worker: string): value is Cleanup {
  const job = value as Cleanup;
  const pathValid=job?.kind==='catalogue'
    ? /^[a-z0-9_-]{1,60}$/.test(job.providerId||'')&&/^[a-f0-9]{64}$/.test(job.sha256||'')&&['wav','mp3','m4a'].some(ext=>job.path===`catalogue/${job.providerId}/${job.id}/${job.sha256}.${ext}`)
    : (job?.kind===undefined||job.kind==='original')&&UUID.test(job?.ownerId||'')&&['wav','mp3','m4a'].some(ext=>job.path===`${job.ownerId}/${job.id}.${ext}`);
  return !!job && UUID.test(job.id) && job.leaseToken === worker && pathValid
    && (job.objectId === null && job.version === null || UUID.test(job.objectId || '') && typeof job.version === 'string' && job.version.length > 0 && job.version.length <= 200);
}
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Music maintenance deadline'));
    if (signal.aborted) { reject(new Error('Music maintenance deadline')); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createMusicMaintenanceHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response(405, { error: 'Method not allowed' });
    const base = deps.env('SUPABASE_URL'), service = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(base) || !service) return response(503, { error: 'Music maintenance unavailable' });
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!/^pc_music_[0-9a-f]{64}$/.test(token) || token === service) return response(401, { error: 'Unauthorized' });
    const controller = new AbortController(), worker = deps.uuid();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, 45000);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    const rpc = (name: string, args: Record<string, unknown>) => bounded(deps.rpc(name, args, controller.signal), controller.signal);
    let active: Cleanup | null = null, processed = 0, reviewed = 0;
    try {
      if (await rpc('validate_music_maintenance_worker', { p_token: token }) !== true) return response(401, { error: 'Unauthorized' });
      for (let i = 0; i < 10; i++) {
        // Give each queue a share of every batch, including under a continuous
        // original-upload backlog. Fall back when the preferred queue is empty.
        const first=i%2===0?'claim_music_upload_cleanup':'claim_catalogue_upload_cleanup';
        const second=i%2===0?'claim_catalogue_upload_cleanup':'claim_music_upload_cleanup';
        const preferred=await rpc(first,{p_worker:worker});
        const job=preferred===null?await rpc(second,{p_worker:worker}):preferred;
        if (job === null) break;
        if ((job as { review?: boolean }).review === true) { reviewed++; continue; }
        if (!validJob(job, worker)) return response(503, { error: 'Music cleanup response invalid' });
        active = job;
        const args = job.kind==='catalogue'?{p_track:job.id,p_worker:worker}:{ p_upload: job.id, p_worker: worker };
        const prefix=job.kind==='catalogue'?'catalogue':'music';
        const check = await rpc(`check_${prefix}_upload_cleanup`, args);
        if (check === 'review') { active = null; reviewed++; continue; }
        if (check !== 'delete' && check !== 'absent') return response(503, { error: 'Music cleanup lease unavailable' });
        if (check === 'delete') {
          if (controller.signal.aborted) throw new Error('Music maintenance deadline');
          const storage = new AbortController();
          const cancelStorage = () => storage.abort();
          controller.signal.addEventListener('abort', cancelStorage, { once: true });
          if (controller.signal.aborted) cancelStorage();
          const storageTimer = setTimeout(cancelStorage, 10000);
          try {
            if (storage.signal.aborted) throw new Error('Music maintenance deadline');
            const result = await bounded(deps.fetch(`${base.replace(/\/$/, '')}/storage/v1/object/music-audio`, {
              method: 'DELETE', headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' },
              body: JSON.stringify({ prefixes: [job.path] }), redirect: 'error', signal: storage.signal,
            }), storage.signal);
            // Do not let an uncooperative response body hold the lease.
            void result.body?.cancel().catch(() => {});
            if (!result.ok && result.status !== 404) throw new Error('Storage unavailable');
          } finally {
            clearTimeout(storageTimer);
            controller.signal.removeEventListener('abort', cancelStorage);
          }
        }
        if (await rpc(`ack_${prefix}_upload_cleanup`, args) !== true) throw new Error('Storage absence not verified');
        active = null;
        processed++;
      }
      return response(200, { processed, reviewed });
    } catch {
      if (active && !controller.signal.aborted) {
        try { await rpc(active.kind==='catalogue'?'fail_catalogue_upload_cleanup':'fail_music_upload_cleanup', active.kind==='catalogue'?{p_track:active.id,p_worker:worker}:{ p_upload: active.id, p_worker: worker }); } catch { /* Lease expiry retries a lost response. */ }
      }
      return response(503, { error: 'Music maintenance temporarily unavailable', processed, reviewed, retry: true });
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      controller.abort();
    }
  };
}
