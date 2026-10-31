const QA_ORIGIN = 'https://uaulhuelcfkjwojtymmw.supabase.co';
type Result = { data: unknown; error: unknown };
type Options = {
  projectUrl: string; serviceKey: string; nonceHash: string; armedAt: number; expiresAt: number;
  install: (nonceHash: string, serviceKey: string, signal: AbortSignal) => PromiseLike<Result>;
  now?: () => number;
};
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
});

/** One QA credential install only. No caller-provided key, target, SQL, account,
 * request body or general privileged operation is accepted. */
export function createQaNotificationCredentialInstaller(options: Options) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response(405, { error: 'Method not allowed' });
    const now = options.now?.() ?? Date.now();
    if (options.projectUrl !== QA_ORIGIN || options.serviceKey.length < 32 || options.serviceKey.length > 4096
      || !/^[0-9a-f]{64}$/.test(options.nonceHash) || !Number.isFinite(options.armedAt)
      || !Number.isFinite(options.expiresAt) || options.expiresAt <= options.armedAt
      || options.expiresAt - options.armedAt > 600_000 || now < options.armedAt || now >= options.expiresAt) {
      return response(410, { error: 'Setup unavailable' });
    }
    const nonce = /^Bearer ([0-9a-f]{64})$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!nonce) return response(401, { error: 'Setup authentication required' });
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce))), byte => byte.toString(16).padStart(2, '0')).join('');
    let difference = 0;
    for (let index = 0; index < hash.length; index++) difference |= hash.charCodeAt(index) ^ options.nonceHash.charCodeAt(index);
    if (difference) return response(401, { error: 'Setup authentication required' });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]);
    let abort: (() => void) | undefined;
    try {
      if (signal.aborted) return response(503, { error: 'Setup not confirmed; inspect its database status' });
      const stopped = new Promise<never>((_, reject) => { abort = () => reject(new Error('SETUP_INTERRUPTED')); signal.addEventListener('abort', abort, { once: true }); });
      if (signal.aborted) { void stopped.catch(() => {}); abort?.(); return response(503, { error: 'Setup not confirmed; inspect its database status' }); }
      // Incoming HTTP POST requests may expose an empty stream even with no
      // payload. Accept zero bytes only, using the same bounded deadline.
      if (request.body) {
        const reader = request.body.getReader();
        try {
          const first = await Promise.race([reader.read(), stopped]);
          if (!first.done) return response(400, { error: 'No request body is accepted' });
        } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Interrupted read. */ } }
      }
      if (signal.aborted) throw new Error('SETUP_INTERRUPTED');
      const { data, error } = await Promise.race([Promise.resolve(options.install(hash, options.serviceKey, signal)), stopped]);
      if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('SETUP_UNCONFIRMED');
      const value = data as Record<string, unknown>;
      if (value.installed !== true || value.project_ref !== 'uaulhuelcfkjwojtymmw' || value.ordinary !== true || value.calls !== true) throw new Error('SETUP_UNCONFIRMED');
      return response(200, { installed: true, ordinary: true, calls: true });
    } catch {
      return response(503, { error: 'Setup not confirmed; inspect its database status' });
    } finally { if (abort) signal.removeEventListener('abort', abort); }
  };
}
