/** Auth JSON is small; cap buffering while retaining the original Response. */
export const AUTH_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
export const AUTH_FETCH_DEADLINE_MS = 15_000;
export const AUTH_REFRESH_DEADLINE_MS = 60_000;

function requestError(timedOut: boolean): Error {
  const error = new Error(timedOut ? 'Authentication request timed out.' : 'The authentication request was cancelled.');
  error.name = timedOut ? 'TimeoutError' : 'AbortError';
  return error;
}

/**
 * Bound the Auth transport, not setSession. Auth must receive no response after
 * a deadline, so a late network completion cannot later install that session.
 * Other services keep their existing streaming and deadline behavior.
 */
export function createAuthDeadlineFetch(backendUrl: string, transport: typeof fetch, timeoutMs = AUTH_FETCH_DEADLINE_MS): typeof fetch {
  const authBase = new URL(backendUrl.replace(/\/+$/, '') + '/auth/v1/');
  return async (input, init) => {
    let isAuth = false, isRefresh = false;
    try {
      const url = new URL(typeof input === 'string' ? input : 'url' in input ? input.url : String(input));
      isAuth = url.origin === authBase.origin && (url.pathname === authBase.pathname.slice(0, -1) || url.pathname.startsWith(authBase.pathname));
      isRefresh = isAuth && url.pathname === authBase.pathname + 'token' && url.searchParams.get('grant_type') === 'refresh_token';
    } catch { /* The original transport reports malformed non-Auth URLs. */ }
    if (!isAuth) return transport(input, init);

    const callerSignal = init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined);
    if (callerSignal?.aborted) throw requestError(false);
    const controller = new AbortController();
    let timedOut = false, complete = false, response: Response | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let copyBody: ReadableStream<Uint8Array> | null = null;
    let rejectAbort: ((error: Error) => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const cancelBody = () => {
      try { void Promise.resolve(reader ? reader.cancel() : copyBody?.cancel()).catch(() => {}); } catch { /* Cleanup is best-effort. */ }
      try { void Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { /* It may already be closed. */ }
    };
    const stop = () => { controller.abort(); cancelBody(); rejectAbort?.(requestError(timedOut)); };
    // Preserve the existing native refresh allowance: a slow rotated-token
    // response deserves its full budget. Session validation/login stays short.
    const timer = setTimeout(() => { timedOut = true; stop(); }, isRefresh ? Math.max(timeoutMs, AUTH_REFRESH_DEADLINE_MS) : timeoutMs);
    callerSignal?.addEventListener('abort', stop, { once: true });
    // Close the race between the initial check and listener registration.
    if (callerSignal?.aborted) stop();
    try {
      const work = (async () => {
        if (controller.signal.aborted) throw requestError(timedOut);
        response = await transport(input, { ...init, signal: controller.signal });
        if (controller.signal.aborted) { cancelBody(); throw requestError(timedOut); }
        const advertisedSize = Number(response.headers.get('content-length'));
        if (advertisedSize > AUTH_RESPONSE_MAX_BYTES) throw new Error('Authentication response exceeds the supported size.');
        // Reading a clone keeps status, headers, URL, cookies and the original
        // body intact. Do not return headers while its JSON body can still stall.
        const copy = response.clone();
        copyBody = copy.body;
        if (copy.body && typeof copy.body.getReader === 'function') {
          reader = copy.body.getReader();
          let bytes = 0;
          try {
            for (;;) {
              const part = await reader.read();
              if (controller.signal.aborted) throw requestError(timedOut);
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > AUTH_RESPONSE_MAX_BYTES) throw new Error('Authentication response exceeds the supported size.');
            }
          } finally {
            try { reader.releaseLock(); } catch { /* Aborted reads may already release the lock. */ }
            reader = null;
          }
        } else {
          // React Native's buffered fetch polyfill has no readable body stream.
          const body = await copy.arrayBuffer();
          if (body.byteLength > AUTH_RESPONSE_MAX_BYTES) throw new Error('Authentication response exceeds the supported size.');
        }
        if (controller.signal.aborted) throw requestError(timedOut);
        return response;
      })();
      const result = await Promise.race([work, interrupted]);
      complete = true;
      return result;
    } finally {
      clearTimeout(timer); callerSignal?.removeEventListener('abort', stop);
      if (!complete) { controller.abort(); cancelBody(); }
    }
  };
}
