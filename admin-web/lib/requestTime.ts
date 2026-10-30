import 'server-only';
import { cache } from 'react';
import { connection } from 'next/server';

/** One timestamp per server request keeps dashboard windows and overdue labels
 * consistent. Reading the clock is request-time I/O, never a build-time value. */
export const requestTime = cache(async () => {
  await connection();
  return Date.now();
});

export async function measureRead<T>(read: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const start = performance.now();
  const value = await read();
  return { value, elapsedMs: Math.max(0, performance.now() - start) };
}
