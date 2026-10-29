import type { SoundtrackTrack, SoundtrackUse } from './soundtrack';

export type SoundtrackSection = 'Available' | 'Originals' | 'Saved';
export const savedSoundtrackKey = (ownerId: string) => `platinum:saved-sounds:v1:${ownerId}`;
export function savedSoundtrackIds(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))].slice(0, 40) : [];
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
  list: (use: SoundtrackUse, query: string) => Promise<SoundtrackTrack[]>, get: (id: string, use: SoundtrackUse) => Promise<SoundtrackTrack>): Promise<SoundtrackTrack[]> {
  let rows: SoundtrackTrack[];
  if (section === 'Saved') {
    // Saved IDs are only preferences. Every row is re-authorized for this use;
    // a saved item never supplies a cached playback URL or bypasses rights.
    const checked = await soundtrackRead(Promise.allSettled(saved.map(id => get(id, use))));
    if (checked.length && checked.every(result => result.status === 'rejected')) throw new Error('Saved sounds could not be checked. Please retry.');
    rows = checked.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  } else rows = await soundtrackRead(list(use, query));
  const needle = query.trim().toLowerCase();
  return rows.filter(row => row && row.duration_sec >= 1 && row.max_excerpt_sec >= 1
    && (section !== 'Originals' || row.source === 'original')
    && (!needle || `${row.title} ${row.artist || ''}`.toLowerCase().includes(needle)));
}
