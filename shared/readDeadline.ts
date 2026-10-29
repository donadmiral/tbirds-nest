type Read<T> = PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> };

/** Bounds a read and cancels supported query builders. Never use this helper
 * as evidence that a timed-out mutation did not reach the server. */
export async function readWithDeadline<T>(read: Read<T>, milliseconds = 12_000): Promise<T> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const work = controller && read.abortSignal ? read.abortSignal(controller.signal) : read;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          reject(new Error('Loading took too long. Please retry.'));
        }, milliseconds);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
