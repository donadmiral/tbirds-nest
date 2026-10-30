/** Browser preferences are untrusted input, including values from older releases. */
const memoryPreferences = new Map<string, string>();

export function preferenceValue(key: string): string {
  try { return window.localStorage.getItem(key) || ''; }
  catch { return memoryPreferences.get(key) || ''; }
}

export function readPreferenceList(key: string, allowed?: ReadonlySet<string>): string[] {
  try {
    const value: unknown = JSON.parse(preferenceValue(key) || '[]');
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is string => typeof item === 'string' && (!allowed || allowed.has(item))))].slice(0, 30);
  } catch { return []; }
}

export function readPreferenceFlag(key: string): boolean {
  try { return JSON.parse(preferenceValue(key) || 'false') === true; }
  catch { return false; }
}

export function savePreference(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  memoryPreferences.set(key, serialized);
  try {
    window.localStorage.setItem(key, serialized);
  }
  catch { /* Navigation remains usable when browser storage is unavailable. */ }
  if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('platinum:preference'));
}
