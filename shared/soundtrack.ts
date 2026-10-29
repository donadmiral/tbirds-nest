export type SoundtrackUse = 'story' | 'post' | 'memory_album';
export type SoundtrackSelection = { soundId: string; startSec: number; durationSec: number; volume: number; originalVolume: number };
export type SoundtrackTrack = { id: string; title: string; artist?: string | null; url: string; duration_sec: number; source: string; max_excerpt_sec: number };
export type SoundtrackClock = { time: number; playing: boolean; rate?: number };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function readSoundtrack(value: unknown): SoundtrackSelection | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.soundId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.soundId)) return null;
  if (!['startSec','durationSec','volume','originalVolume'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k]))) return null;
  if ((v.startSec as number)<0 || (v.durationSec as number)<1 || (v.durationSec as number)>600 || (v.volume as number)<0 || (v.volume as number)>1 || (v.originalVolume as number)<0 || (v.originalVolume as number)>1) return null;
  return { soundId:v.soundId, startSec:v.startSec as number, durationSec:v.durationSec as number, volume:v.volume as number, originalVolume:v.originalVolume as number };
}
export function selectSoundtrack(track: SoundtrackTrack): SoundtrackSelection {
  return {soundId:track.id,startSec:0,durationSec:Math.min(track.duration_sec,track.max_excerpt_sec),volume:0.7,originalVolume:1};
}
export function soundtrackTime(selection: SoundtrackSelection, elapsed: number) {
  return selection.startSec + ((Math.max(0, elapsed) % selection.durationSec) + selection.durationSec) % selection.durationSec;
}
export function constrainSoundtrack(selection: SoundtrackSelection, track: SoundtrackTrack): SoundtrackSelection {
  const durationSec = clamp(selection.durationSec,1,Math.min(track.max_excerpt_sec,track.duration_sec));
  return {...selection,durationSec,startSec:clamp(selection.startSec,0,Math.max(0,track.duration_sec-durationSec)),volume:clamp(selection.volume,0,1),originalVolume:clamp(selection.originalVolume,0,1)};
}
