/**
 * A deadline for any promise.
 *
 * The audit found no timeouts anywhere in the app. Supabase queries inherit the
 * browser's default, which on a stalled mobile connection can mean a spinner
 * that never resolves and a screen the person cannot leave except by reloading.
 *
 * This does not cancel the underlying request, since supabase-js does not expose
 * an abort signal on its query builder. It bounds how long the UI waits, which
 * is the part that matters: a rejected promise reaches a catch and can render a
 * retry, where a pending one renders nothing forever.
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super("Timed out after " + ms + "ms");
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(work: Promise<T> | PromiseLike<T>, ms = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The same bound, but for loads that should degrade rather than fail: returns
 * the fallback instead of throwing, so a slow optional panel does not take the
 * whole page down with it.
 */
export async function withTimeoutOr<T>(work: Promise<T> | PromiseLike<T>, fallback: T, ms = 8000): Promise<T> {
  try {
    return await withTimeout(work, ms);
  } catch {
    return fallback;
  }
}
