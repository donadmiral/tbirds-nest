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
type AudioClient = ReturnType<typeof createClient>;
// Keep the previous client argument position available to callers and fixtures.
const favoriteClient = (ownerOrClient?: string | AudioClient, client?: AudioClient) =>
 typeof ownerOrClient === 'object' ? ownerOrClient : client || createClient();
async function withFavoriteSession<T>(client: AudioClient, expectedOwner: string | undefined, work: (token: string) => PromiseLike<T>): Promise<T> {
 let changed = false, observedOwner = expectedOwner, token: string | undefined;
 const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id;
  if (event === 'SIGNED_OUT' || !next || (observedOwner !== undefined && next !== observedOwner) || (token && event === 'SIGNED_IN' && session.access_token !== token)) changed = true;
  observedOwner = next;
 });
 try {
  const { data, error } = await soundtrackRead(client.auth.getSession());
  const session = data.session;
  if (changed || error || !session || (expectedOwner && session.user.id !== expectedOwner) || (observedOwner && session.user.id !== observedOwner)) throw new Error('Return to the account that owns this saved selection.');
  observedOwner = session.user.id; token = session.access_token;
  const result = await soundtrackRead(work(token));
  if (changed) throw new Error('The account changed. Check your saved selection again.');
  return result;
 } finally { subscription.unsubscribe(); }
}
export async function soundFavorites(ownerOrClient?: string | AudioClient, client?: AudioClient): Promise<string[]> {
 const current = favoriteClient(ownerOrClient, client), owner = typeof ownerOrClient === 'string' ? ownerOrClient : undefined;
 const { data, error } = await withFavoriteSession(current, owner, token => current.rpc('list_sound_favorites').setHeader('Authorization', `Bearer ${token}`));
 if (error || !Array.isArray(data) || data.length > 200 || data.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) throw new Error('Saved audio could not load. Please retry.');
 return [...new Set(data as string[])];
}
export async function saveSoundFavorite(id: string, saved: boolean, ownerOrClient?: string | AudioClient, client?: AudioClient): Promise<void> {
 const current = favoriteClient(ownerOrClient, client), owner = typeof ownerOrClient === 'string' ? ownerOrClient : undefined;
 const { data, error } = await withFavoriteSession(current, owner, token => current.rpc('set_sound_favorite', { p_sound_id: id, p_saved: saved }).setHeader('Authorization', `Bearer ${token}`));
 if (error || data !== saved) throw new Error('The saved selection could not be confirmed. Check its status before trying again.');
}

export const originalAudioReady = (client = createClient()) => readAudioReady(client);
