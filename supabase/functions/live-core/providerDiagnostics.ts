type Diagnostic = { event: string; action: string; status: number; code: string; reason: string } | {
  event: 'live_provider_eject_response'; action: 'eject'; status: number; code: string;
  body_kind: 'unreadable' | 'too_large' | 'non_json' | 'non_object' | 'object';
  no_current_call: boolean; ejected_ids_array: boolean; ejected_ids_count: number | null;
};
const CONTROL = /^\/v1\/rooms\/pc-live-[a-f0-9]{32}\/live-streaming\/(start|stop|update)$/;
const EJECT = /^\/v1\/rooms\/(pc-live-[a-f0-9]{32})\/eject$/;
const EJECT_CODES = new Set(['not-found', 'invalid-request-error', 'invalid-request', 'bad-request',
  'unauthorized', 'forbidden', 'rate-limit-error', 'rate-limit-exceeded', 'server-error']);

async function inspectEjectResponse(response: Response, room: string, write: (value: Diagnostic) => void) {
  const diagnostic: Extract<Diagnostic, { action: 'eject' }> = {
    event: 'live_provider_eject_response', action: 'eject', status: response.status, code: 'unclassified',
    body_kind: 'unreadable', no_current_call: false, ejected_ids_array: false, ejected_ids_count: null,
  };
  try {
    const reader = response.clone().body?.getReader();
    let size = 0, text = '';
    const decoder = new TextDecoder();
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8192) { diagnostic.body_kind = 'too_large'; void reader.cancel().catch(() => undefined); throw Error('BODY_TOO_LARGE'); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    diagnostic.body_kind = 'non_json';
    const value: unknown = JSON.parse(text);
    diagnostic.body_kind = 'non_object';
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const body = value as Record<string, unknown>;
      diagnostic.body_kind = 'object';
      diagnostic.code = typeof body.error === 'string' && EJECT_CODES.has(body.error) ? body.error : 'unclassified';
      diagnostic.no_current_call = body.error === 'not-found'
        && body.info === `room ${room} does not seem to be hosting a call currently`;
      diagnostic.ejected_ids_array = Array.isArray(body.ejectedIds);
      diagnostic.ejected_ids_count = Array.isArray(body.ejectedIds) ? Math.min(body.ejectedIds.length, 4096) : null;
    }
  } catch { /* Only fixed response classifications are observable. Never log provider text. */ }
  try { write(diagnostic); } catch { /* Diagnostics never change the original response. */ }
}

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
    try {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const eject = url.origin === 'https://api.daily.co' ? EJECT.exec(url.pathname) : null;
      if (eject) {
        // Observe the existing scheduled request, including an unrecognized 200.
        // The lease, provider request and acknowledgement rules remain unchanged.
        await inspectEjectResponse(response, eject[1], write);
        return response;
      }
      if (response.ok) return response;
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
