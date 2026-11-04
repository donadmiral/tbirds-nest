type Diagnostic = { event: string; action: string; status: number; code: string; reason: string };
const CONTROL = /^\/v1\/rooms\/pc-live-[a-f0-9]{32}\/live-streaming\/(start|stop|update)$/;

// Operator logs must never contain authorization headers, signed URLs, rooms,
// account identifiers or opaque credentials. The response itself is unchanged.
export function redactProviderReason(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.slice(0,2048)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/Bearer\s+\S+/gi, '[credential]')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/gi, '[id]')
    .replace(/[a-zA-Z0-9_+=/.-]{24,}/g, '[opaque]')
    .replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').slice(0,180);
}

export function withProviderDiagnostics(fetcher: typeof fetch, write: (value: Diagnostic) => void): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (response.ok) return response;
    try {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const match = url.origin === 'https://api.daily.co' ? CONTROL.exec(url.pathname) : null;
      if (!match) return response;
      const copy = response.clone();
      const reader = copy.body?.getReader();
      let size = 0, text = '';
      const decoder = new TextDecoder();
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 8192) { void reader.cancel().catch(() => undefined); throw Error('BODY_TOO_LARGE'); }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        } finally { reader.releaseLock(); }
      }
      const value = JSON.parse(text);
      const code = typeof value?.error === 'string' && /^[a-z-]{1,64}$/.test(value.error) ? value.error : 'unclassified';
      write({ event: 'live_provider_control_rejected', action: match[1], status: response.status, code, reason: redactProviderReason(value?.info) });
    } catch { /* Diagnostics must not change request behavior or hide its failure. */ }
    return response;
  };
}
