import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Feather } from '@expo/vector-icons';
import { ORIGINAL_AUDIO_PREPARING } from '../../shared/originalAudioAvailability';
import { addOriginalAudio, originalAudioReady } from '../services/originalAudioService';
import type { SoundtrackTrack, SoundtrackUse } from '../../shared/soundtrack';
import { OriginalAudioLibrary } from './OriginalAudioLibrary';
type Props={owner:string;use?:SoundtrackUse;disabled?:boolean;onAdded(track:SoundtrackTrack):void};
export function OriginalAudioUpload(props:Props) { return <OriginalAudioUploadSession key={props.owner} {...props}/>; }
function OriginalAudioUploadSession({owner,use='post',disabled=false,onAdded}:Props) {
 const [available,setAvailable]=useState<boolean|null>(null),[availabilityError,setAvailabilityError]=useState(''),[availabilityAttempt,setAvailabilityAttempt]=useState(0);
 useEffect(()=>{let live=true;void originalAudioReady().then(ready=>{if(live){setAvailable(ready);setAvailabilityError('');}}).catch(failure=>{if(live){setAvailable(false);setAvailabilityError(failure instanceof Error?failure.message:'Audio availability could not be checked. Retry.');}});return()=>{live=false;};},[owner,availabilityAttempt]);
 const [rights,setRights]=useState(false),[reuse,setReuse]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [library,setLibrary]=useState(false);
 const generation=useRef(0),lock=useRef(false),pending=useRef<{uri:string;name:string}|null>(null);
 useEffect(()=>{generation.current += 1;return()=>{generation.current += 1;};},[owner]);
 async function upload(retry=false) {
  if(lock.current||!rights||!available||disabled)return;lock.current=true;setBusy(true);setError('');const current=generation.current;
  try {
   let asset=pending.current;
   if(!retry||!asset){const result=await DocumentPicker.getDocumentAsync({type:['audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/x-m4a'],copyToCacheDirectory:true,multiple:false});if(result.canceled)return;asset=result.assets[0];pending.current=asset;}
   if(current!==generation.current||!asset)return;
   const track=await addOriginalAudio(asset.uri,owner,{title:asset.name.replace(/\.[^.]+$/,''),rightsAttested:true,reuseAllowed:reuse,use});
   if(current===generation.current){pending.current=null;onAdded(track);}
  }catch(failure){if(current===generation.current)setError(failure instanceof Error?failure.message:'Audio could not upload. Retry.');}
  finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 const check=(label:string,checked:boolean,onPress:()=>void)=><TouchableOpacity accessibilityRole="checkbox" accessibilityState={{checked,disabled:busy||disabled||!available}} disabled={busy||disabled||!available} onPress={onPress} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:10}}><Feather name={checked?'check-square':'square'} size={20} color="#E6CFAB"/><Text style={{color:'#F6F4F0',flex:1,fontSize:13,lineHeight:19}}>{label}</Text></TouchableOpacity>;
 return <View style={{borderColor:'#343D4A',borderWidth:1,borderRadius:14,padding:14,gap:8,marginVertical:14}}>
  <Text style={{color:'#F6F4F0',fontWeight:'700'}}>Your original audio</Text><Text style={{color:'#AEB8C6',fontSize:12,lineHeight:18}}>WAV, MP3 or M4A, up to 10 minutes and 50 MB. Catalogue music is awaiting licensing.</Text>
  {available!==true?<View style={{gap:8}}><Text accessibilityRole="alert" style={{color:'#E6CFAB',fontSize:13,lineHeight:19}}>{available===null?'Checking audio availability…':availabilityError||ORIGINAL_AUDIO_PREPARING}</Text>{available===false?<TouchableOpacity accessibilityRole="button" style={{minHeight:44,justifyContent:'center'}} onPress={()=>setAvailabilityAttempt(value=>value+1)}><Text style={{color:'#E6CFAB'}}>Retry availability</Text></TouchableOpacity>:null}</View>:null}
  <TouchableOpacity accessibilityRole="button" disabled={busy||disabled||!available} onPress={()=>setLibrary(true)} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:'#E6CFAB'}}>Manage your audio library</Text></TouchableOpacity>
  {check('I own this audio and have permission to publish it.',rights,()=>setRights(value=>!value))}
  {check('Also let others find and reuse this original.',reuse,()=>setReuse(value=>!value))}
  <TouchableOpacity accessibilityRole="button" disabled={!rights||busy||disabled||!available} onPress={()=>void upload()} style={{minHeight:44,borderRadius:22,backgroundColor:'#E6CFAB',alignItems:'center',justifyContent:'center',opacity:rights?1:.45}}>{busy?<ActivityIndicator color="#0B1E3D"/>:<Text style={{color:'#0B1E3D',fontWeight:'700'}}>Choose original audio</Text>}</TouchableOpacity>
  {!!error&&<><Text accessibilityRole="alert" style={{color:'#FFACA4',fontSize:13}}>{error}</Text><TouchableOpacity accessibilityRole="button" disabled={busy||disabled||!available} onPress={()=>void upload(true)} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:'#E6CFAB'}}>Retry upload</Text></TouchableOpacity></>}
  {library?<OriginalAudioLibrary owner={owner} onClose={()=>setLibrary(false)}/>:null}
 </View>;
}
