import {createClient} from './supabase/client';
import {hydrateSoundMedia} from './contentMedia';
import {soundtrackRead} from '../../shared/soundtrackPicker';
import {audioLibraryCapabilities,librarySourceAvailable} from '../../shared/originalAudioAvailability';
import type {SoundtrackTrack,SoundtrackUse} from '../../shared/soundtrack';
import {ORIGINAL_AUDIO_ENABLED,MUSIC_UNAVAILABLE_MESSAGE} from '../../shared/musicAvailability';
export async function listSoundtracks(use:SoundtrackUse,query='',client=createClient()):Promise<SoundtrackTrack[]> {
 if(!ORIGINAL_AUDIO_ENABLED)return [];
 const capabilities=await audioLibraryCapabilities(client);
 if(!capabilities)return [];
 const {data,error}=await soundtrackRead(client.rpc('list_playable_sounds',{p_use:use,p_query:query,p_limit:50}));
 if(error) throw new Error('Music could not load. Please retry.');
 return ((data || []) as SoundtrackTrack[]).filter(track=>librarySourceAvailable(track.source,capabilities));
}
export async function getSoundtrack(soundId:string,use:SoundtrackUse,client=createClient()):Promise<SoundtrackTrack> {
 if(!ORIGINAL_AUDIO_ENABLED)throw new Error(MUSIC_UNAVAILABLE_MESSAGE);
 const capabilities=await audioLibraryCapabilities(client);
 if(!capabilities)throw new Error('The audio library is not available in this app environment yet.');
 const {data,error}=await soundtrackRead(client.rpc('get_playable_sound',{p_sound_id:soundId,p_use:use}));
 const track=data?.[0] as SoundtrackTrack | undefined;
 if(error || !track || track.id!==soundId || !librarySourceAvailable(track.source,capabilities)) throw new Error('This sound is no longer available.');
 const [safe]=await soundtrackRead(hydrateSoundMedia([track],client));
 if(!safe?.url) throw new Error('This sound is unavailable.');
 return safe;
}
