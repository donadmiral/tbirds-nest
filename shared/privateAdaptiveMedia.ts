export type PrivateAdaptiveSource = {
  uri: string;
  headers: Record<string, string>;
  sourceVersion: string;
  expiresAt: number;
};

/** One in-memory playback grant. It never opens or consumes a limited view. */
export function createPrivateAdaptiveSession(options: {
  endpoint: string;
  token: string;
  apiKey?: string;
  messageId: string;
  requestId: string;
  fetch?: typeof fetch;
  current: () => boolean;
}) {
  const transport = options.fetch ?? fetch;
  const headers: Record<string, string> = { Authorization: `Bearer ${options.token}` };
  if (options.apiKey) headers.apikey = options.apiKey;
  let closed = false;
  let source: PrivateAdaptiveSource | null = null;
  let leaseId: string | null = null;
  let pending: Promise<PrivateAdaptiveSource | null> | null = null;
  let revoke: Promise<void> | null = null;
  let opening: AbortController | null = null;
  const endpoint = (() => {
    try {
      const value = new URL(options.endpoint);
      if (value.protocol !== 'https:' || value.username || value.password || value.search || value.hash) return null;
      return value;
    } catch { return null; }
  })();
  const body = (action: 'open' | 'close') => JSON.stringify({
    action, messageId: options.messageId, requestId: options.requestId,
  });
  const validUrl = (uri: string, version: string, lease: string) => {
    if (!endpoint) return false;
    try {
      const url = new URL(uri);
      if (url.origin !== endpoint.origin || url.pathname !== endpoint.pathname || url.username || url.password || url.hash) return false;
      const names = ['messageId', 'requestId', 'sourceVersion', 'leaseId', 'asset'];
      if ([...url.searchParams.keys()].some(key => !names.includes(key)) || names.some(key => url.searchParams.getAll(key).length !== 1)) return false;
      if (url.searchParams.get('messageId') !== options.messageId || url.searchParams.get('requestId') !== options.requestId
        || url.searchParams.get('sourceVersion') !== version || url.searchParams.get('leaseId') !== lease) return false;
      return /^(?:master\.m3u8|r\d{1,2}\/(?:index\.m3u8|seg\d{5,8}\.ts))$/.test(url.searchParams.get('asset') ?? '');
    } catch { return false; }
  };
  const close = () => {
    closed = true;
    source = null;
    leaseId = null;
    opening?.abort();
    if (!revoke) {
      revoke = (async () => {
        if (!endpoint || !options.token) return;
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 5_000);
        try {
          await transport(endpoint.href, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
            body: body('close'), signal: abort.signal, cache: 'no-store', credentials: 'omit',
            redirect: 'error', referrerPolicy: 'no-referrer', keepalive: true,
          });
        } catch { /* Expiry bounds failed network revocation. The local session stays closed. */ }
        finally { clearTimeout(timer); }
      })();
    }
    return revoke;
  };
  const active = () => !closed && options.current();
  return {
    get closed() { return closed; },
    close,
    /** Also used by the web loader before every child request, never by URL alone. */
    authorize(uri: string): Record<string, string> | null {
      if (!active() || !source || !leaseId || Date.now() >= source.expiresAt
        || !validUrl(uri, source.sourceVersion, leaseId)) return null;
      return { ...headers };
    },
    open(): Promise<PrivateAdaptiveSource | null> {
      if (!active() || !endpoint || !options.token) return Promise.resolve(null);
      if (source && Date.now() >= source.expiresAt) { void close(); return Promise.resolve(null); }
      if (pending) return pending;
      pending = (async () => {
        const abort = new AbortController();
        opening = abort;
        const timer = setTimeout(() => abort.abort(), 2_000);
        try {
          const response = await transport(endpoint.href, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
            body: body('open'), signal: abort.signal, cache: 'no-store', credentials: 'omit',
            redirect: 'error', referrerPolicy: 'no-referrer',
          });
          if (!response.ok) { void close(); return null; }
          const value = await response.json();
          if (!active() || abort.signal.aborted) { void close(); return null; }
          const expiresAt = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
          const version = value.sourceVersion;
          const uri = value.hlsUrl;
          const lease = typeof uri === 'string' ? (() => { try { return new URL(uri).searchParams.get('leaseId'); } catch { return null; } })() : null;
          if (value.ready !== true || typeof version !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(version)
            || typeof uri !== 'string' || !lease || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lease)
            || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 905_000
            || !validUrl(uri, version, lease) || new URL(uri).searchParams.get('asset') !== 'master.m3u8') {
            void close(); return null;
          }
          leaseId = lease;
          source = { uri, headers: { ...headers }, sourceVersion: version, expiresAt };
          return source;
        } catch { void close(); return null; }
        finally { clearTimeout(timer); if (opening === abort) opening = null; }
      })();
      return pending;
    },
  };
}
