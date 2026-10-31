/** Browser preferences are untrusted input, including values from older releases. */
const memoryPreferences = new Map<string, string>();
const temporaryWrites = new Map<string, { value: string; storedBefore: string | null | undefined }>();

export function preferenceValue(key: string): string {
  if (!memoryPreferences.has(key)) memoryPreferences.set(key, '');
  try {
    const stored = window.localStorage.getItem(key);
    const temporary = temporaryWrites.get(key);
    // A rejected write can leave getItem working with the previous value.
    // Keep the user's current-tab choice until persistence or an external change.
    if (temporary && (temporary.storedBefore === undefined || temporary.storedBefore === stored)) return temporary.value;
    temporaryWrites.delete(key);
    const value = stored || '';
    memoryPreferences.set(key, value);
    return value;
  }
  catch { return memoryPreferences.get(key) || ''; }
}

/** A cross-tab write/clear supersedes local fallback state. Only retain values
 * for preferences already read here, never unrelated browser storage entries. */
export function syncPreferenceStorage(key: string | null, newValue: string | null): void {
  if (key === null) {
    temporaryWrites.clear(); memoryPreferences.clear();
  } else if (memoryPreferences.has(key)) {
    temporaryWrites.delete(key);
    memoryPreferences.set(key, newValue || '');
  }
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
  let storedBefore: string | null | undefined;
  try { storedBefore = window.localStorage.getItem(key); }
  catch { /* The storage getter can be unavailable as well as the write. */ }
  memoryPreferences.set(key, serialized);
  try {
    window.localStorage.setItem(key, serialized);
    temporaryWrites.delete(key);
  }
  catch {
    temporaryWrites.set(key, { value: serialized, storedBefore });
  }
  if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('platinum:preference'));
}
