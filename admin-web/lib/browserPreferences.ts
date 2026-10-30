/** Browser preferences are untrusted input, including values from older releases. */
export function readPreferenceList(key: string, allowed?: ReadonlySet<string>): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) || '[]');
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is string => typeof item === 'string' && (!allowed || allowed.has(item))))].slice(0, 30);
  } catch { return []; }
}

export function readPreferenceFlag(key: string): boolean {
  try { return JSON.parse(window.localStorage.getItem(key) || 'false') === true; }
  catch { return false; }
}

export function savePreference(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* Navigation remains usable when browser storage is unavailable. */ }
}
