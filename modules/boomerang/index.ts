// modules/boomerang/index.ts
// A real boomerang: the clip written forward then backward into one file, so
// it bounces everywhere it plays with no player tricks. Optional on purpose:
// a client built without the module gets a clean error and the caller keeps
// the straight clip.
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as FileSystem from 'expo-file-system/legacy';

const Native: any = requireOptionalNativeModule('Boomerang');

export const boomerangAvailable = !!Native;

const cancellationError = () => Object.assign(new Error('Boomerang encoding was cancelled.'), { name: 'AbortError' });

export async function makeBoomerang(inputUri: string, outputUri: string, loops = 1, signal?: AbortSignal): Promise<string> {
  if (!Native) throw new Error('Boomerang is not in this build');
  if (signal?.aborted) throw cancellationError();
  const cancellable = typeof Native.createBoomerangJob === 'function'
    && typeof Native.makeCancellable === 'function' && typeof Native.cancelBoomerang === 'function';
  const id: string | undefined = cancellable ? Native.createBoomerangJob() : undefined;
  let stopped = false, nativeCancelled = false, completed = false;
  const cancelNative = () => {
    if (!id || nativeCancelled) return;
    nativeCancelled = true;
    try { void Promise.resolve(Native.cancelBoomerang(id)).catch(() => {}); } catch {}
  };
  let rejectCancelled: (error: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const abort = () => { stopped = true; cancelNative(); rejectCancelled(cancellationError()); };
  const discard = async () => { try { await FileSystem.deleteAsync(outputUri, { idempotent: true }); } catch {} };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const work: Promise<string> = Promise.resolve(cancellable
      ? Native.makeCancellable(id, inputUri, outputUri, loops)
      : Native.make(inputUri, outputUri, loops)).then(async uri => {
      // Older installed modules cannot stop an encode. Wait for their promise
      // to settle before deleting its abandoned result, never an active file.
      if (stopped || signal?.aborted) { await discard(); throw cancellationError(); }
      return uri;
    });
    if (signal?.aborted) abort();
    const result = await Promise.race([work, cancelled]);
    if (stopped || signal?.aborted) { await discard(); throw cancellationError(); }
    completed = true;
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!completed) cancelNative();
  }
}
