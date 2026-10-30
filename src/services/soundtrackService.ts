import {supabase} from './supabase';
import {hydrateSoundMedia} from './contentMedia';
import {soundtrackRead} from '../../shared/soundtrackPicker';
import {originalAudioSupported} from '../../shared/originalAudioAvailability';
import type {SoundtrackTrack,SoundtrackUse} from '../../shared/soundtrack';
import {ORIGINAL_AUDIO_ENABLED,MUSIC_UNAVAILABLE_MESSAGE} from '../../shared/musicAvailability';
export async function listSoundtracks(use: SoundtrackUse, query = ''): Promise<SoundtrackTrack[]> {
 if(!ORIGINAL_AUDIO_ENABLED)return [];
 if(!await originalAudioSupported(supabase))return [];
 const {data,error} = await soundtrackRead(supabase.rpc('list_playable_sounds',{p_use:use,p_query:query,p_limit:50}));
 if(error) throw new Error('Music could not load. Please retry.');
 return ((data || []) as SoundtrackTrack[]).filter(track=>track.source==='original');
}
export async function getSoundtrack(soundId:string,use:SoundtrackUse): Promise<SoundtrackTrack> {
 if(!ORIGINAL_AUDIO_ENABLED)throw new Error(MUSIC_UNAVAILABLE_MESSAGE);
 if(!await originalAudioSupported(supabase))throw new Error('The original audio library is not available in this app environment yet.');
 const {data,error} = await soundtrackRead(supabase.rpc('get_playable_sound',{p_sound_id:soundId,p_use:use}));
 const track = data?.[0] as SoundtrackTrack | undefined;
 if(error || !track || track.source!=='original') throw new Error('This sound is no longer available.');
 const [safe] = await soundtrackRead(hydrateSoundMedia([track]));
 if(!safe?.url) throw new Error('This sound is unavailable.');
 return safe;
}
