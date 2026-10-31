import type { SoundtrackTrack, SoundtrackUse } from './soundtrack';

export type SoundtrackSection = 'Available' | 'Originals' | 'Saved';
export const savedSoundtrackKey = (ownerId: string) => `platinum:saved-sounds:v1:${ownerId}`;
export function savedSoundtrackIds(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))] : [];
  } catch { return []; }
}
export function soundtrackLabel(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
export async function soundtrackRead<T>(work: PromiseLike<T>, timeoutMs = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Music took too long to load. Please retry.')), timeoutMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
export async function loadSoundtrackChoices(use: SoundtrackUse, query: string, section: SoundtrackSection, saved: string[],
  list: (use: SoundtrackUse, query: string) => Promise<SoundtrackTrack[]>, get: (id: string, use: SoundtrackUse) => Promise<SoundtrackTrack>, onUnavailable?: (count: number) => void): Promise<SoundtrackTrack[]> {
  let rows: SoundtrackTrack[];
  if (section === 'Saved') {
    // Saved IDs are only preferences. Every row is re-authorized for this use;
    // a saved item never supplies a cached playback URL or bypasses rights.
    const checked: PromiseSettledResult<SoundtrackTrack>[] = new Array(saved.length);
    const deadline = Date.now() + 20000;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, saved.length) }, async () => {
      while (cursor < saved.length) {
        const index = cursor++, remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Saved sounds could not be checked. Please retry.');
        try { checked[index] = { status: 'fulfilled', value: await soundtrackRead(get(saved[index], use), remaining) }; }
        catch (reason) { checked[index] = { status: 'rejected', reason }; }
      }
    }));
    if (checked.length && checked.every(result => result.status === 'rejected')) throw new Error('Saved sounds could not be checked. Please retry.');
    const unavailable = checked.filter(result => result.status === 'rejected').length;
    if (unavailable) onUnavailable?.(unavailable);
    rows = checked.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  } else rows = await soundtrackRead(list(use, query));
  const needle = query.trim().toLowerCase();
  return rows.filter(row => row && row.duration_sec >= 1 && row.max_excerpt_sec >= 1
    && (section !== 'Originals' || row.source === 'original')
    && (!needle || `${row.title} ${row.artist || ''}`.toLowerCase().includes(needle)));
}
