/** A failed request is not an empty result. Access failures must still clear data. */
export function isReadAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; context?: { status?: unknown } };
  if ([value.status, value.statusCode, value.context?.status].some(status => Number(status) === 401 || Number(status) === 403)) return true;
  if (/^(42501|PGRST30[123]|AUTH_REQUIRED|ACCESS_DENIED|UNAUTHORIZED|FORBIDDEN)$/i.test(String(value.code ?? ''))) return true;
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  return /^(AUTH_REQUIRED|ACCESS_DENIED|UNAUTHORIZED|FORBIDDEN)$/i.test(message)
    || /\b(?:permission denied|access denied|not authorized|not authenticated|unauthorized|forbidden|sign in again|account changed|JWT (?:expired|invalid))\b/i.test(message);
}

export function requireReadRows<T>(data: unknown): T[] {
  if (!Array.isArray(data)) throw new Error('The response was incomplete. Please try again.');
  return data as T[];
}

/** Fence a screen read against newer reads, account changes, and blur/unmount. */
export function createScreenReadGuard(initialScope: string | null) {
  let scope = initialScope;
  let generation = 0;
  let lifetime = 0;
  return {
    setScope(next: string | null) {
      if (next !== scope) { scope = next; generation++; lifetime++; }
    },
    invalidate() { generation++; lifetime++; },
    capture(expectedScope = scope) {
      const expectedLifetime = lifetime;
      return () => expectedScope !== null && scope === expectedScope && lifetime === expectedLifetime;
    },
    begin(expectedScope = scope) {
      if (expectedScope === null || expectedScope !== scope) return () => false;
      const expectedGeneration = ++generation;
      return () => expectedScope !== null && scope === expectedScope && generation === expectedGeneration;
    },
  };
}
