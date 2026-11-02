// Stream into exactly the admitted allocation; never buffer a Blob first.
export async function readAdmittedMedia(response: Response, options: {
  expectedBytes: number; maxBytes: number; signal: AbortSignal;
}): Promise<Uint8Array> {
  const { expectedBytes, maxBytes, signal } = options;
  const rejectBody = () => { try { void response.body?.cancel().catch(() => {}); } catch { /* Already closed. */ } };
  const length = response.headers.get('Content-Length');
  if (!response.ok || response.status !== 200 || response.redirected
    || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > maxBytes
    || (length !== null && (!/^\d{1,12}$/.test(length) || Number(length) !== expectedBytes))
    || !['', 'identity'].includes(response.headers.get('Content-Encoding')?.trim().toLowerCase() || '')
    || !response.body || signal.aborted) {
    rejectBody(); throw new Error('MEDIA_ADMISSION_REJECTED');
  }
  const reader = response.body.getReader(), result = new Uint8Array(expectedBytes);
  let read = 0;
  const abort = () => { try { void reader.cancel().catch(() => {}); } catch { /* Cancel without waiting for transport. */ } };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('MEDIA_READ_DEADLINE');
      const next = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const stop = () => reject(new Error('MEDIA_READ_DEADLINE'));
        signal.addEventListener('abort', stop, { once: true });
        reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
      });
      if (signal.aborted) throw new Error('MEDIA_READ_DEADLINE');
      if (next.done) {
        if (read !== expectedBytes) throw new Error('MEDIA_READ_TRUNCATED');
        return result;
      }
      if (!(next.value instanceof Uint8Array) || next.value.byteLength > expectedBytes - read) throw new Error('MEDIA_READ_EXCESS');
      result.set(next.value, read); read += next.value.byteLength;
    }
  } finally { signal.removeEventListener('abort', abort); abort(); }
}
