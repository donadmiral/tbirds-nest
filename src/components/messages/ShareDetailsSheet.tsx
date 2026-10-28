import React, {useEffect, useRef, useState} from 'react';
import {Modal, View, Text, TextInput, TouchableOpacity, ActivityIndicator} from 'react-native';
import * as Location from 'expo-location';
import {useTheme} from '../../theme/useTheme';
import {ChatAttachmentCard, parseChatAttachmentCard} from '../../../shared/chatAttachmentCards';

export function ShareDetailsSheet({kind,onClose,onSend}: {kind:'contact'|'location';onClose:()=>void;onSend:(card:ChatAttachmentCard)=>Promise<boolean>}) {
  const {t}=useTheme(); const [name,setName]=useState(''),[phone,setPhone]=useState(''),[email,setEmail]=useState('');
  const [location,setLocation]=useState<ChatAttachmentCard|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const live=useRef(true),pending=useRef(false); useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const locate=async()=>{ if(pending.current)return;pending.current=true;setBusy(true);setError('');try {
    const permission=await Location.requestForegroundPermissionsAsync(); if(!live.current)return;
    if(!permission.granted)throw Error('Allow location access to select your current location.');
    const position=await Promise.race([Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced}), new Promise<never>((_,reject)=>setTimeout(()=>reject(Error("Location took too long. Please retry.")),15000))]); if(!live.current)return;
    setLocation({pcAttachment:1,kind:'location',latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy??undefined,capturedAt:new Date(position.timestamp).toISOString()});
  }catch(e){if(live.current)setError(e instanceof Error?e.message:'Could not locate you.');}finally{pending.current=false;if(live.current)setBusy(false);}};
  const send=async()=>{if(pending.current)return;const candidate=kind==='location'?location:{pcAttachment:1,kind:'contact',name,...(phone.trim()?{phone:phone.trim()}:{}),...(email.trim()?{email:email.trim()}:{})};
    const card=parseChatAttachmentCard(JSON.stringify(candidate));if(!card){setError(kind==='contact'?'Enter a name and a valid phone number or email.':'Select your location first.');return;}
    pending.current=true;setBusy(true);setError('');try{if(await onSend(card)){if(live.current)onClose();}else if(live.current)setError('Could not send. Your details are kept here.');}catch{if(live.current)setError('Could not send. Please retry.');}finally{pending.current=false;if(live.current)setBusy(false);}};
  const input={color:t.ink.primary,backgroundColor:t.surface.sunken,borderRadius:12,padding:14,marginTop:10};
  return <Modal transparent animationType="fade" onRequestClose={onClose}><View style={{flex:1,backgroundColor:t.surface.scrim,justifyContent:'center',padding:24}}><View style={{backgroundColor:t.surface.canvas,borderRadius:20,padding:20}}>
    <Text style={{color:t.ink.primary,fontSize:20,fontWeight:'700'}}>{kind==='contact'?'Share a contact':'Share a location'}</Text>
    {kind==='contact'?<><TextInput accessibilityLabel="Contact name" placeholder="Name" placeholderTextColor={t.ink.muted} value={name} onChangeText={setName} maxLength={100} style={input}/><TextInput accessibilityLabel="Contact phone" placeholder="Phone" placeholderTextColor={t.ink.muted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={30} style={input}/><TextInput accessibilityLabel="Contact email" placeholder="Email" placeholderTextColor={t.ink.muted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={254} style={input}/></>:<>
      <Text style={{color:t.ink.secondary,marginVertical:14}}>Only the location shown here will be sent. This does not share live movement.</Text>
      {location?.kind==='location'&&<Text style={{color:t.ink.primary}}>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}{location.accuracy!=null?` · about ${Math.round(location.accuracy)} m accuracy`:''}</Text>}
      <TouchableOpacity disabled={busy} onPress={locate} accessibilityRole="button" style={{paddingVertical:14}}><Text style={{color:t.status.link}}>Use my current location</Text></TouchableOpacity></>}
    {!!error&&<Text accessibilityRole="alert" style={{color:t.status.danger,marginTop:12}}>{error}</Text>}
    <View style={{flexDirection:'row',justifyContent:'flex-end',gap:20,marginTop:20}}><TouchableOpacity onPress={onClose} accessibilityRole="button" style={{padding:10}}><Text style={{color:t.ink.secondary}}>Cancel</Text></TouchableOpacity><TouchableOpacity disabled={busy} onPress={send} accessibilityRole="button" style={{padding:10}}>{busy?<ActivityIndicator color={t.ink.primary}/>:<Text style={{color:t.ink.primary,fontWeight:'700'}}>Send</Text>}</TouchableOpacity></View>
  </View></View></Modal>;
}
