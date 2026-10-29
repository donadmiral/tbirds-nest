type CancellableRead<T> = PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> };

/** Bound the whole read, including time spent waiting for the SDK session lock. */
export async function profileRead<T>(request: CancellableRead<T>, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = request.abortSignal ? request.abortSignal(controller.signal) : request;
    return await Promise.race([
      Promise.resolve(pending),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Profile content took too long to load. Please retry.'));
        }, timeoutMs);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
