/** Diagnostic payloads contain enum values only. Never send messages, stacks, URLs or user content. */
export const DIAGNOSTIC_CATEGORIES = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AbortError', 'TimeoutError', 'NetworkError', 'AuthError', 'PostgrestError', 'StorageError', 'UnknownError'] as const;
export const DIAGNOSTIC_SOURCES = ['render', 'global', 'promise', 'feed', 'unknown'] as const;
export const DIAGNOSTIC_PLATFORMS = ['ios', 'android', 'web', 'admin', 'unknown'] as const;
export type ClientDiagnostic = { version: 1; category: typeof DIAGNOSTIC_CATEGORIES[number]; source: typeof DIAGNOSTIC_SOURCES[number]; platform: typeof DIAGNOSTIC_PLATFORMS[number]; fatal: boolean; appVersion: string | null };
const member = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
export function sanitizeDiagnostic(error: unknown, options: Record<string, unknown> = {}): ClientDiagnostic {
  let name: unknown;
  try { name = error && typeof error === 'object' ? (error as { name?: unknown }).name : null; } catch { /* Hostile getters cannot break recovery. */ }
  return { version: 1, category: member(name, DIAGNOSTIC_CATEGORIES, 'UnknownError'),
    source: member(options.source, DIAGNOSTIC_SOURCES, 'unknown'), platform: member(options.platform, DIAGNOSTIC_PLATFORMS, 'unknown'),
    fatal: options.fatal === true,
    appVersion: typeof options.appVersion === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-z0-9.]{1,16})?$/.test(options.appVersion) ? options.appVersion : null };
}

/** Bound both requests and memory; never retry recursively when the reporter is offline. */
export function createDiagnosticReporter(send: (payload: ClientDiagnostic) => unknown, now = Date.now) {
  let started = now(), count = 0;
  const seen = new Set<string>();
  return (error: unknown, options: Record<string, unknown> = {}) => {
    try {
      const time = now();
      if (time - started >= 60_000 || time < started) { started = time; count = 0; seen.clear(); }
      const payload = sanitizeDiagnostic(error, options), key = JSON.stringify(payload);
      if (count >= 5 || seen.has(key)) return false;
      count++; seen.add(key);
      void Promise.resolve(send(payload)).catch(() => {});
      return true;
    } catch { return false; }
  };
}
