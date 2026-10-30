import { soundtrackRead } from '../../shared/soundtrackPicker';
import { originalAudioReady as readAudioReady } from '../../shared/originalAudioAvailability';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import { uploadOriginalAudio } from '../../shared/musicUpload';
import { inspectOriginalAudio, ORIGINAL_AUDIO_MAX_BYTES } from '../../shared/originalAudio';
import { getSoundtrack } from './soundtrackService';
import type { SoundtrackUse } from '../../shared/soundtrack';
const attempts = new Map<string, string>();
export async function addOriginalAudio(uri: string, owner: string, options: { title?: string; rightsAttested: boolean; reuseAllowed?: boolean; use?: SoundtrackUse }) {
 const stat = await FileSystem.getInfoAsync(uri);
 if (!stat.exists || stat.isDirectory || stat.size > ORIGINAL_AUDIO_MAX_BYTES) throw new Error('Choose an audio file under 50 MB.');
 const bytes = new Uint8Array(decode(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })));
 const info = inspectOriginalAudio(bytes), digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
 const sha256 = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
 const identity = `${owner}:${sha256}:${!!options.reuseAllowed}`;
 let requestId = attempts.get(identity); if (!requestId) { requestId = Crypto.randomUUID(); attempts.set(identity, requestId); }
 const base = process.env.EXPO_PUBLIC_SUPABASE_URL!, key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
 const request = async (path: string, token: string, body: BodyInit, type?: string, allowDuplicate = false) => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  try {
   const response = await fetch(`${base}${path}`, { method: 'POST', body, signal: controller.signal,
    headers: { Authorization: `Bearer ${token}`, apikey: key, 'x-upsert': 'false', ...(type ? { 'Content-Type': type } : {}) } });
   const result = await response.json().catch(() => ({}));
   if (!response.ok && !(allowDuplicate && (response.status === 409 || result.error === 'Duplicate' || result.statusCode === '409')))
    throw new Error(typeof result.error === 'string' ? result.error : 'Audio upload could not finish. Please retry.');
   return result;
  } finally { clearTimeout(timer); }
 };
 const soundId = await uploadOriginalAudio(supabase, { requestId, owner, title: options.title || 'Original audio', bytes, sha256,
  reuseAllowed: !!options.reuseAllowed, rightsAttested: options.rightsAttested }, {
  upload: async (path, mime, token) => {
   const form = new FormData(); form.append('file', { uri, type: mime, name: `original.${info.extension}` } as unknown as Blob);
   await request(`/storage/v1/object/music-audio/${path}`, token, form, undefined, true);
  },
  finalize: (id, token) => request('/functions/v1/music-asset-finalize', token, JSON.stringify({ requestId: id }), 'application/json'),
 });
 if (attempts.size > 50) attempts.delete(attempts.keys().next().value!);
 return getSoundtrack(soundId, options.use || 'story');
}
export async function soundFavorites(): Promise<string[]> {
 const { data, error } = await soundtrackRead(supabase.rpc('list_sound_favorites'));
 if (error) throw new Error('Saved audio could not load. Please retry.');
 return Array.isArray(data) ? data : [];
}
export async function saveSoundFavorite(id: string, saved: boolean): Promise<void> {
 const { error } = await soundtrackRead(supabase.rpc('set_sound_favorite', { p_sound_id: id, p_saved: saved }));
 if (error) throw new Error('This sound could not be saved. Please retry.');
}

export const originalAudioReady = () => readAudioReady(supabase);
