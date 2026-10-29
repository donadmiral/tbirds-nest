import type { PrivateCloseReason, PrivateGrant } from './privateMedia';

/** Explicit legacy protocol for installed production clients; never an error fallback. */
export function createLegacyLimitedViewSession(options: {
  endpoint: string; token: string; apiKey: string; messageId: string; requestId: string;
  fetch: typeof fetch; current: () => boolean; hide: () => void;
}) {
  let closed = false, mediaUrl = '';
  const controller = new AbortController();
  const origin = new URL(options.endpoint).origin;
  return {
    get closed() { return closed; },
    get mediaUrl() { return mediaUrl; },
    // Storage already received a bounded capability. Do not forward the user's
    // bearer token to its media decoder, or persist the capability in a cache.
    headers: {} as Record<string, string>,
    async open(): Promise<PrivateGrant | null> {
      if (closed || !options.current()) return null;
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await options.fetch(options.endpoint, {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${options.token}`, apikey: options.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageIds: [options.messageId], consume: true, requestId: options.requestId }),
        });
        if (!response.ok) throw Error(response.status === 410 ? 'This attachment is no longer available.' : 'Could not open this attachment.');
        const value = await response.json();
        let url: URL;
        try { url = new URL(value.urls?.[options.messageId]); } catch { throw Error('This viewing grant is invalid.'); }
        const path = decodeURIComponent(url.pathname);
        const expiry = Date.parse(value.expiresAt);
        if (url.origin !== origin || url.username || url.password || url.hash || !url.searchParams.get('token')
          || !/^\/storage\/v1\/object\/sign\/(chat-media|chat-files)\/[0-9a-f-]{36}\/.+$/i.test(path)
          || path.includes('\\') || path.includes('%') || path.split('/').some(part => part === '.' || part === '..')
          || value.requestId !== options.requestId || !['image', 'video'].includes(value.mediaType)
          || !Number.isInteger(value.remaining) || value.remaining < 0 || value.remaining > 1
          || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 125000) throw Error('This viewing grant has ended.');
        if (closed || !options.current()) { closed = true; options.hide(); return null; }
        mediaUrl = url.href;
        return { requestId: value.requestId, expiresAt: value.expiresAt, remaining: value.remaining, mediaType: value.mediaType, watermark: 'Limited view' };
      } finally { clearTimeout(timer); }
    },
    async close(_reason: PrivateCloseReason = 'closed') {
      closed = true; controller.abort(); mediaUrl = ''; options.hide();
    },
  };
}
