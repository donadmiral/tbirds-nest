// No account identifier or object path comes from the HTTP caller. The queue is
// authoritative, and every destructive step revalidates its current lease.
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type ObjectEntry = { id: string; bucket: string; path: string; version: string };
type Job = { id: string; userId: string; leaseToken: string; state: 'erasing' | 'identity_pending'; objects: ObjectEntry[] };
type Dependencies = {
  env(name: string): string | undefined;
  client(url: string, key: string): RpcClient;
  fetch: typeof fetch;
  uuid(): string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKETS = new Set(['post-media', 'story-media', 'media', 'chat-media', 'chat-files', 'avatars', 'market-media', 'mingle-images', 'mingle-media', 'business-media', 'startup-media', 'identity-training-photos', 'application-cvs', 'channel-media']);
const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
function validObject(value: ObjectEntry): boolean {
  return !!value && UUID.test(value.id) && BUCKETS.has(value.bucket)
    && typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 1024
    && !/[\\%\u0000-\u001f]/.test(value.path)
    && !value.path.split('/').some(part => !part || part === '.' || part === '..')
    && typeof value.version === 'string' && value.version.length > 0 && value.version.length <= 200;
}
function validJob(value: unknown, worker: string): value is Job {
  const job = value as Job;
  return !!job && UUID.test(job.id) && UUID.test(job.userId) && job.leaseToken === worker
    && ['erasing', 'identity_pending'].includes(job.state)
    && Array.isArray(job.objects) && job.objects.length <= 25 && job.objects.every(validObject);
}

export function createAccountStorageErasure(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    const base = deps.env('SUPABASE_URL'), service = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !service) return reply(503, { error: 'Erasure unavailable' });
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    // A service key or app JWT is never accepted as this worker's credential.
    if (!/^pc_erase_[0-9a-f]{64}$/.test(token) || token === service) return reply(401, { error: 'Unauthorized' });
    const client = deps.client(base, service), worker = deps.uuid();
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const result = await client.rpc(name, args);
      if (result.error) throw new Error('Database operation unavailable');
      return result.data;
    };
    let job: Job | undefined;
    const args = () => ({ p_job: job!.id, p_worker: worker });
    const finish = async (error: string | null) => rpc('finish_account_erasure', { ...args(), p_error: error });
    const api = async (path: string, method: 'DELETE', body?: unknown) => {
      const response = await deps.fetch(`${base.replace(/\/$/, '')}${path}`, {
        method, headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      const status = response.status;
      await response.body?.cancel();
      return status >= 200 && status < 300 || status === 404;
    };
    try {
      if (await rpc('validate_account_erasure_worker', { p_token: token }) !== true) return reply(401, { error: 'Unauthorized' });
      const claim = await rpc('claim_account_erasure', { p_worker: worker });
      if (claim === null) return reply(200, { processed: 0, completed: false });
      if (!validJob(claim, worker)) return reply(503, { error: 'Queue response invalid' });
      job = claim;
      let erased = 0, failed = false;
      // Five bounded Storage requests at a time; one invocation handles at most
      // 25 files. A crash after API success resumes by checking object absence.
      for (let at = 0; at < job.objects.length && !failed; at += 5) {
        await Promise.all(job.objects.slice(at, at + 5).map(async object => {
          try {
            const objectArgs = { ...args(), p_object: object.id };
            const check = await rpc('check_account_erasure_object', objectArgs);
            if (check !== 'delete' && check !== 'absent') { failed = true; return; }
            if (check === 'delete' && !await api(`/storage/v1/object/${encodeURIComponent(object.bucket)}`, 'DELETE', { prefixes: [object.path] })) {
              failed = true; return;
            }
            if (await rpc('ack_account_erasure_object', objectArgs) !== true) { failed = true; return; }
            erased++;
          } catch { failed = true; }
        }));
      }
      if (failed) {
        await finish('storage_unavailable');
        return reply(200, { processed: erased, completed: false, retry: true });
      }
      // This step checks all queued files, actual Storage ownership, retention
      // rules, and database cleanup. Auth must survive any failed file erasure.
      const ready = await rpc('prepare_account_erasure_identity', args());
      if (ready === 'more' || ready === 'cache_wait') {
        await finish(null);
        return reply(200, { processed: erased, completed: false, more: true });
      }
      if (ready !== 'ready') return reply(200, { processed: erased, completed: false, review: ready === 'review' });
      // Supabase Auth Admin DELETE is the final irreversible identity action.
      // A prior successful call with a lost response is safe to retry (404).
      if (!await api(`/auth/v1/admin/users/${encodeURIComponent(job.userId)}`, 'DELETE')) {
        await finish('identity_unavailable');
        return reply(200, { processed: erased, completed: false, retry: true });
      }
      const completed = await finish(null) === true;
      return reply(completed ? 200 : 503, { processed: erased, completed });
    } catch {
      if (job) {
        try { await finish(job.state === 'identity_pending' ? 'identity_unavailable' : 'storage_unavailable'); } catch { /* Lease expiry makes a crashed invocation recoverable. */ }
      }
      return reply(503, { error: 'Erasure temporarily unavailable' });
    }
  };
}
