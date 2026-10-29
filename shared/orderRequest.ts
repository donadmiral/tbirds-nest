/** Keep the exact request after an uncertain network outcome. A retry must not create another order. */
export function createOrderRequest<T extends object>() {
  let pending: (T & { p_request_key: string }) | null = null;
  return {
    get(input: T, key: () => string) { return pending ??= { ...input, p_request_key: key() }; },
    clear() { pending = null; },
    get pending() { return pending !== null; },
  };
}
export async function orderTimeout<T>(work: PromiseLike<T>, ms = 15000, message = 'ORDER_TIMEOUT'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
export function orderRejected(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error.code === 'P0001' || error.code === '22023' || error.code === '42501');
}
