import React,{useState} from 'react';
import {Text,TouchableOpacity} from 'react-native';
import {useSoundtrackPlayer} from '../hooks/useSoundtrackPlayer';
import type {SoundtrackSelection,SoundtrackUse,SoundtrackClock} from '../../shared/soundtrack';
import {ORIGINAL_AUDIO_ENABLED} from '../../shared/musicAvailability';
export default function PostSoundtrack({selection,active,use='post',clock,controls=false}:{selection:SoundtrackSelection|null|undefined;active:boolean;use?:SoundtrackUse;clock?:SoundtrackClock;controls?:boolean}) {
 const [enabled,setEnabled]=useState(false);
 const {error,retry}=useSoundtrackPlayer({selection,active:active&&(!controls||enabled),use,clock});
 if(!ORIGINAL_AUDIO_ENABLED)return null;
 return !selection?null:controls?<TouchableOpacity onPress={()=>{if(error)retry();setEnabled(v=>!v);}} accessibilityLabel={enabled?'Pause music':'Play music'} style={{position:'absolute',left:8,bottom:8,padding:9,borderRadius:15,backgroundColor:'rgba(0,0,0,.75)'}}><Text style={{color:'#fff',fontSize:12}}>{error|| (enabled?'Pause music':'Play music')}</Text></TouchableOpacity>:error?<TouchableOpacity onPress={retry} accessibilityLabel="Retry music" style={{position:'absolute',left:8,top:8,right:8,padding:8,borderRadius:10,backgroundColor:'rgba(0,0,0,.78)'}}><Text style={{color:'#fff',fontSize:12}}>{error}</Text></TouchableOpacity>:null;
}
