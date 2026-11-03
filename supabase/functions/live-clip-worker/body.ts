// Bound bytes before decoding JSON, including chunked bodies without Content-Length.
// Cancelling the reader also releases a stalled request when the deadline expires.
export async function readBoundedJson(message: Request | Response, maximum: number, parent?: AbortSignal): Promise<any> {
  if (Number(message.headers.get('content-length') || 0) > maximum) throw Error('REQUEST_TOO_LARGE');
  const reader = message.body?.getReader();
  if (!reader) throw Error('INVALID_JSON');
  const signal = AbortSignal.any([AbortSignal.timeout(8000), ...(parent ? [parent] : [])]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    if (signal.aborted) throw Error('REQUEST_TIMED_OUT');
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw Error('REQUEST_TIMED_OUT');
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw Error('REQUEST_TOO_LARGE');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw Error('INVALID_JSON'); }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel(); reader.releaseLock();
  }
}

export function bodyErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : '';
  return message === 'REQUEST_TOO_LARGE' ? 413 : message === 'REQUEST_TIMED_OUT' ? 408 : 400;
}
