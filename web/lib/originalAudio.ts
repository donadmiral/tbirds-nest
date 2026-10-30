import { soundtrackRead } from '../../shared/soundtrackPicker';
import { originalAudioReady as readAudioReady } from '../../shared/originalAudioAvailability';
import { createClient } from './supabase/client';
import { uploadOriginalAudio } from '../../shared/musicUpload';
import { inspectOriginalAudio, ORIGINAL_AUDIO_MAX_BYTES } from '../../shared/originalAudio';
import { getSoundtrack } from './soundtrack';
import type { SoundtrackUse } from '../../shared/soundtrack';
const attempts = new Map<string, string>();
export async function addOriginalAudio(file: File, owner: string, options: { rightsAttested: boolean; reuseAllowed?: boolean; use?: SoundtrackUse }, client = createClient()) {
 if (!Number.isFinite(file.size) || file.size < 44 || file.size > ORIGINAL_AUDIO_MAX_BYTES) throw new Error('Choose an audio file under 50 MB.');
 const bytes = new Uint8Array(await file.arrayBuffer()); inspectOriginalAudio(bytes);
 const digest = await crypto.subtle.digest('SHA-256', bytes);
 const sha256 = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
 const identity = `${owner}:${sha256}:${!!options.reuseAllowed}`;
 let requestId = attempts.get(identity);
 if (!requestId) { requestId = crypto.randomUUID(); attempts.set(identity, requestId); }
 const base = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
 const request = async (path: string, token: string, body: BodyInit, contentType: string, allowDuplicate = false) => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  try {
   const response = await fetch(`${base}${path}`, { method: 'POST', body, signal: controller.signal,
    headers: { Authorization: `Bearer ${token}`, apikey: key, 'Content-Type': contentType, 'x-upsert': 'false' } });
   const result = await response.json().catch(() => ({}));
   // A lost upload response is recoverable. Finalization still checks size, owner,
   // object version and the complete hash before accepting an existing object.
   if (!response.ok && !(allowDuplicate && (response.status === 409 || result.error === 'Duplicate' || result.statusCode === '409')))
    throw new Error(typeof result.error === 'string' ? result.error : 'Audio upload could not finish. Please retry.');
   return result;
  } finally { clearTimeout(timer); }
 };
 const soundId = await uploadOriginalAudio(client, { requestId, owner, title: file.name.replace(/\.[^.]+$/, '') || 'Original audio',
  reuseAllowed: !!options.reuseAllowed, rightsAttested: options.rightsAttested, bytes, sha256 }, {
  upload: async (path, mime, token) => { await request(`/storage/v1/object/music-audio/${path}`, token, file, mime, true); },
  finalize: (id, token) => request('/functions/v1/music-asset-finalize', token, JSON.stringify({ requestId: id }), 'application/json'),
 });
 if (attempts.size > 50) attempts.delete(attempts.keys().next().value!);
 return getSoundtrack(soundId, options.use || 'story', client);
}
export async function soundFavorites(client = createClient()): Promise<string[]> {
 const { data, error } = await soundtrackRead(client.rpc('list_sound_favorites'));
 if (error) throw new Error('Saved audio could not load. Please retry.');
 return Array.isArray(data) ? data : [];
}
export async function saveSoundFavorite(id: string, saved: boolean, client = createClient()): Promise<void> {
 const { error } = await soundtrackRead(client.rpc('set_sound_favorite', { p_sound_id: id, p_saved: saved }));
 if (error) throw new Error('This sound could not be saved. Please retry.');
}

export const originalAudioReady = (client = createClient()) => readAudioReady(client);
