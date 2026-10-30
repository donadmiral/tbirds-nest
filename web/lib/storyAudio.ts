import { createClient } from './supabase/client';
import { hydrateSoundMedia } from './contentMedia';
import { addOriginalAudio } from './originalAudio';
import { inspectOriginalAudio } from '../../shared/originalAudio';
import { audioLibraryCapabilities, librarySourceAvailable } from '../../shared/originalAudioAvailability';
import { soundtrackRead } from '../../shared/soundtrackPicker';

export type StoryAudioDraft = { kind: 'voiceover' | 'sound'; url?: string | null; soundId?: string | null; title: string; durationSec: number; startSec?: number; rightsAttested?: boolean; addToSounds?: boolean };
export type StorySound = { id: string; title: string; url: string; duration_sec: number; source: string; rights_status: string; max_excerpt_sec?: number };
export async function listStorySounds(client = createClient()) {
 const capabilities=await audioLibraryCapabilities(client);
 if(!capabilities)return [];
 const { data, error } = await soundtrackRead(client.rpc('list_playable_sounds', { p_use: 'story', p_query: '', p_limit: 100 }));
 if (error) throw new Error('Sounds could not load. Please retry.');
 return ((data ?? []) as StorySound[]).filter(sound=>librarySourceAvailable(sound.source,capabilities));
}
export async function storyAudioPreview(audio: StoryAudioDraft, client = createClient()): Promise<string | null> {
 if (!audio.soundId) throw new Error('This older recording needs verification. Upload the original file again.');
 const capabilities=await audioLibraryCapabilities(client);
 if(!capabilities)throw new Error('The audio library is not available in this app environment yet.');
 const { data: sounds, error } = await soundtrackRead(client.rpc('get_playable_sound', { p_sound_id: audio.soundId, p_use: 'story' }));
 const data = sounds?.[0];
 if (error || !data || data.id!==audio.soundId || !librarySourceAvailable(data.source,capabilities)) throw new Error('This sound is no longer available. Choose another sound.');
 const [row] = await soundtrackRead(hydrateSoundMedia([data], client)); return row.url;
}
export async function readAudioDuration(file: File): Promise<number> {
 return inspectOriginalAudio(new Uint8Array(await file.arrayBuffer())).durationSec;
}
export async function uploadStoryAudio(file: File, owner: string, client = createClient(), reuseAllowed = false): Promise<StoryAudioDraft> {
 const sound = await addOriginalAudio(file, owner, { rightsAttested: true, reuseAllowed, use: 'story' }, client);
 return { kind: 'sound', soundId: sound.id, title: sound.title, durationSec: Math.min(30, sound.duration_sec), startSec: 0, rightsAttested: true, addToSounds: reuseAllowed };
}
