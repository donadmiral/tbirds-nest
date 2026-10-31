export const PUSH_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' };
export const pushResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: PUSH_HEADERS });
export const validUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const validExpoToken = (value: unknown): value is string => typeof value === 'string'
  && /^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{1,200}\]$/.test(value);

export async function servicePushAuthorized(request: Request, key: string): Promise<boolean> {
  const supplied = /^Bearer ([^\s]+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
  if (!supplied || key.length < 32 || supplied.length > 4096) return false;
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(supplied), digest(key)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export function waitForPush<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const expired = () => reject(new Error('PUSH_DEADLINE'));
    if (signal.aborted) { void Promise.resolve(work).catch(() => {}); expired(); return; }
    signal.addEventListener('abort', expired, { once: true });
    Promise.resolve(work).then(value => { signal.removeEventListener('abort', expired); resolve(value); },
      error => { signal.removeEventListener('abort', expired); reject(error); });
  });
}

export async function boundedPushJson(input: Request | Response, signal: AbortSignal, maximum = 65_536): Promise<Record<string, unknown>> {
  const reader = input.body?.getReader();
  if (!reader) throw new Error('EMPTY_REQUEST');
  let bytes = 0, text = '';
  const decoder = new TextDecoder();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('PUSH_DEADLINE');
      const { done, value } = await waitForPush(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) throw new Error('REQUEST_TOO_LARGE');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST');
    return value;
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* A cancelled read already released the stream. */ } }
}

export type ExpoPushMessage = { to: string; [key: string]: unknown };
export type ExpoPushResult = { accepted: number; rejected: number; unknown: number;
  tickets: { token: string; id: string }[]; invalidTokens: string[] };

/** Expo acceptance is a queue ticket, never a claim of delivery to a phone. */
export async function sendExpoPushes(messages: ExpoPushMessage[], options: {
  fetch: typeof fetch; signal: AbortSignal; accessToken?: string;
  maySend?: () => Promise<boolean>;
}): Promise<ExpoPushResult> {
  const result: ExpoPushResult = { accepted: 0, rejected: 0, unknown: 0, tickets: [], invalidTokens: [] };
  for (let offset = 0; offset < messages.length; offset += 100) {
    if (options.signal.aborted || (options.maySend && !await options.maySend())) {
      result.rejected += messages.length - offset; break;
    }
    const batch = messages.slice(offset, offset + 100);
    try {
      const response = await waitForPush(options.fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json',
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}) },
        body: JSON.stringify(batch), redirect: 'error', signal: options.signal,
      }), options.signal);
      const body = await boundedPushJson(response, options.signal);
      if (!response.ok || !Array.isArray(body.data) || body.data.length !== batch.length) {
        result.unknown += batch.length; continue;
      }
      body.data.forEach((ticket: { status?: string; id?: string; details?: { error?: string } }, index: number) => {
        if (ticket?.status === 'ok' && typeof ticket.id === 'string' && ticket.id.length <= 200) {
          result.accepted++; result.tickets.push({ token: batch[index].to, id: ticket.id });
        } else if (ticket?.status === 'error') {
          result.rejected++;
          if (ticket.details?.error === 'DeviceNotRegistered') result.invalidTokens.push(batch[index].to);
        } else result.unknown++;
      });
    } catch { result.unknown += batch.length; }
  }
  return result;
}
