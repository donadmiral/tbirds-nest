import { createClient } from './supabase/client';
import { hydrateSoundMedia, hydrateUploadMedia } from './contentMedia';

export type StoryAudioDraft = { kind: 'voiceover' | 'sound'; url?: string | null; soundId?: string | null; title: string; durationSec: number; rightsAttested?: boolean; addToSounds?: boolean };
export type StorySound = { id: string; title: string; url: string; duration_sec: number; source: string; rights_status: string };
export async function listStorySounds(client = createClient()) {
  const { data, error } = await client.rpc('list_playable_sounds', { p_use: 'story', p_query: '', p_limit: 100 });
  if (error) throw new Error('Sounds could not load. Please retry.');
  return (data ?? []) as StorySound[];
}
export async function storyAudioPreview(audio: StoryAudioDraft, client = createClient()): Promise<string | null> {
  if (audio.kind === 'voiceover') {
    const [row] = await hydrateUploadMedia([{ url: audio.url }], client); return row.url ?? null;
  }
  const { data: sounds, error } = await client.rpc('get_playable_sound', { p_sound_id: audio.soundId!, p_use: 'story' });
  const data = sounds?.[0];
  if (error || !data) throw new Error('This sound is no longer available. Choose another sound.');
  const [row] = await hydrateSoundMedia([data], client); return row.url;
}
export function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio'), url = URL.createObjectURL(file);
    const finish = (duration?: number) => { clearTimeout(timer); audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); duration ? resolve(duration) : reject(new Error('Choose an audio recording between 1 and 30 seconds.')); };
    const timer = setTimeout(() => finish(), 10000);
    audio.preload = 'metadata'; audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration >= 1 && audio.duration <= 30 ? Math.ceil(audio.duration) : undefined); audio.onerror = () => finish(); audio.src = url;
  });
}
export async function uploadStoryAudio(file: File, owner: string, client = createClient()): Promise<StoryAudioDraft> {
  const type = file.type.split(';')[0].toLowerCase();
  const formats: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/aac': 'aac' };
  if (!formats[type] || file.size > 15 * 1024 * 1024) throw new Error('Choose an MP3, M4A, AAC, Ogg or WebM recording under 15 MB.');
  const durationSec = await readAudioDuration(file);
  const { data } = await client.auth.getUser();
  if (data.user?.id !== owner) throw new Error('The account changed. Select this recording again.');
  const path = `${owner}/${crypto.randomUUID()}.${formats[type]}`;
  const { error } = await client.storage.from('story-media').upload(path, file, { contentType: type === 'audio/x-m4a' ? 'audio/mp4' : type, upsert: false });
  if (error) throw new Error('The recording could not upload. Please retry.');
  const { data: session } = await client.auth.getSession();
  if (session.session?.user.id !== owner) throw new Error('The account changed. Select this recording again.');
  return { kind: 'voiceover', url: client.storage.from('story-media').getPublicUrl(path).data.publicUrl, title: file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Original sound', durationSec, rightsAttested: true, addToSounds: false };
}
