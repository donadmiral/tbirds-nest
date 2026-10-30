import {createClient} from './supabase/client';
import {hydrateSoundMedia} from './contentMedia';
import {soundtrackRead} from '../../shared/soundtrackPicker';
import {originalAudioSupported} from '../../shared/originalAudioAvailability';
import type {SoundtrackTrack,SoundtrackUse} from '../../shared/soundtrack';
import {ORIGINAL_AUDIO_ENABLED,MUSIC_UNAVAILABLE_MESSAGE} from '../../shared/musicAvailability';
export async function listSoundtracks(use:SoundtrackUse,query='',client=createClient()):Promise<SoundtrackTrack[]> {
 if(!ORIGINAL_AUDIO_ENABLED)return [];
 if(!await originalAudioSupported(client))return [];
 const {data,error}=await soundtrackRead(client.rpc('list_playable_sounds',{p_use:use,p_query:query,p_limit:50}));
 if(error) throw new Error('Music could not load. Please retry.');
 return ((data || []) as SoundtrackTrack[]).filter(track=>track.source==='original');
}
export async function getSoundtrack(soundId:string,use:SoundtrackUse,client=createClient()):Promise<SoundtrackTrack> {
 if(!ORIGINAL_AUDIO_ENABLED)throw new Error(MUSIC_UNAVAILABLE_MESSAGE);
 if(!await originalAudioSupported(client))throw new Error('The original audio library is not available in this app environment yet.');
 const {data,error}=await soundtrackRead(client.rpc('get_playable_sound',{p_sound_id:soundId,p_use:use}));
 const track=data?.[0] as SoundtrackTrack | undefined;
 if(error || !track || track.source!=='original') throw new Error('This sound is no longer available.');
 const [safe]=await soundtrackRead(hydrateSoundMedia([track],client));
 if(!safe?.url) throw new Error('This sound is unavailable.');
 return safe;
}
