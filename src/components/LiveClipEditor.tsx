import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { parseWebVtt, validateClipSpec, type ClipContext, type ClipSpec } from '../../shared/liveClips';
import { useTheme } from '../theme/useTheme';
import { loadClipContext, nativeClipCommand } from '../services/liveClipService';
import { liveRequestId } from '../services/liveService';

export function LiveClipEditor({ sessionId, onCreated }: { sessionId: string; onCreated(): void }) {
  const { t } = useTheme();
  const [context,setContext] = useState<ClipContext|null>(null), [error,setError] = useState(''), [busy,setBusy] = useState(false), [refresh,setRefresh] = useState(0);
  const [title,setTitle] = useState(''), [caption,setCaption] = useState(''), [tags,setTags] = useState(''), [start,setStart] = useState('0'), [end,setEnd] = useState('30'), [cover,setCover] = useState('0');
  const [vertical,setVertical] = useState(true), [horizontal,setHorizontal] = useState(true), [watermark,setWatermark] = useState(true), [brand,setBrand] = useState(''), [subtitles,setSubtitles] = useState(''), [burn,setBurn] = useState(true);
  const generation = useRef(0), lock = useRef(false), request = useRef<{ signature: string; id: string }|null>(null), initialized = useRef(false);
  useEffect(() => { const scope=++generation.current; setError(''); void loadClipContext(sessionId).then(value=>{if(scope!==generation.current)return;setContext(value);if(value.settings?.watermark_required){setWatermark(true);setBrand(value.settings.brand_text);}if(!initialized.current&&value.available_end_ms>value.available_start_ms){initialized.current=true;setStart(String(Math.max(value.available_start_ms,value.available_end_ms-30000)/1000));setEnd(String(value.available_end_ms/1000));if(value.settings)setBrand(value.settings.brand_text);}}).catch(reason=>{if(scope===generation.current){setContext(null);setError(reason instanceof Error?reason.message:'Clip tools could not load.');}});return()=>{generation.current++;}; },[sessionId,refresh]);
  const field = (label:string,value:string,change:(v:string)=>void,max:number,decimal=false,multiline=false) => <View style={{gap:6}}><Text style={{color:t.ink.secondary,fontSize:12,fontWeight:'600'}}>{label}</Text><TextInput value={value} onChangeText={change} maxLength={max} multiline={multiline} accessibilityLabel={label} keyboardType={decimal?'decimal-pad':'default'} style={{minHeight:46,maxHeight:180,borderRadius:12,padding:12,color:t.ink.primary,backgroundColor:t.surface.sunken,textAlignVertical:'top'}}/></View>;
  const button=(label:string,onPress:()=>void,disabled=false)=><TouchableOpacity key={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={{minHeight:44,paddingHorizontal:16,justifyContent:'center',alignItems:'center',backgroundColor:t.surface.sunken,borderRadius:22,opacity:disabled?.5:1}}><Text style={{color:t.ink.primary,fontWeight:'600',fontSize:13}}>{label}</Text></TouchableOpacity>;
  const toggle=(label:string,value:boolean,change:(v:boolean)=>void,disabled=false)=><View style={{flexDirection:'row',alignItems:'center',gap:12}}><Text style={{flex:1,color:t.ink.primary,fontSize:14}}>{label}</Text><Switch value={value} disabled={disabled} onValueChange={change} accessibilityLabel={label}/></View>;
  const create=async()=>{
    if(lock.current||!context?.can_clip)return;let spec:ClipSpec;
    try { spec={title:title.trim(),caption,tags:[...new Set(tags.split(',').map(s=>s.trim()).filter(Boolean))],start_ms:Math.round(Number(start)*1000),end_ms:Math.round(Number(end)*1000),cover_ms:Math.round(Number(cover)*1000),formats:[...(vertical?['vertical' as const]:[]),...(horizontal?['horizontal' as const]:[])],watermark,brand_text:brand.trim(),burn_captions:burn,subtitles:subtitles.trim()?parseWebVtt(subtitles):[]};const invalid=validateClipSpec(spec,context);if(invalid)throw new Error(invalid); } catch(reason) {setError(reason instanceof Error?reason.message:'Check the clip settings.');return;}
    const signature=JSON.stringify(spec);if(request.current?.signature!==signature)request.current={signature,id:liveRequestId()};lock.current=true;setBusy(true);setError('');const scope=generation.current;
    try {await nativeClipCommand(sessionId,null,'create',spec,request.current.id);if(scope!==generation.current)return;request.current=null;onCreated();}
    catch(reason){if(scope===generation.current)setError(reason instanceof Error?reason.message:'The clip could not be queued. Your settings are kept.');}
    finally{lock.current=false;if(scope===generation.current)setBusy(false);}
  };
  return <View style={{gap:16}}>
    <Text style={{color:t.ink.primary,fontSize:21,fontWeight:'700'}}>Create a clip</Text>
    {error?<Text accessibilityRole="alert" style={{color:t.ink.primary}}>{error}</Text>:null}
    {!context&&!error?<ActivityIndicator color={t.ink.primary}/>:null}
    {context?<><Text style={{color:t.ink.secondary,lineHeight:20}}>{context.recording_available?`Recording available from ${(context.available_start_ms/1000).toFixed(1)}s to ${(context.available_end_ms/1000).toFixed(1)}s. Clips can be up to ${Math.min(600,context.max_duration_ms/1000)} seconds.`:'The recording is not ready for clipping yet.'}</Text>{button('Refresh available recording',()=>setRefresh(v=>v+1),busy)}
      {!context.can_clip?<Text style={{color:t.ink.secondary}}>The creator has not enabled clipping for your role, or the recording is unavailable.</Text>:<>
        {field('Clip title',title,setTitle,120)}{field('Caption',caption,setCaption,2200,false,true)}
        <Text style={{color:t.ink.primary,fontWeight:'600'}}>Range in seconds from the start of the recording</Text>
        <ScrollView horizontal contentContainerStyle={{gap:8}}>{[15,30,60,90].map(seconds=>button(`${seconds}s`,()=>{const point=Math.max(context.available_start_ms/1000,Number(start)||0);setEnd(String(Math.min(context.available_end_ms/1000,point+seconds)));setCover('0');}))}</ScrollView>
        <View style={{flexDirection:'row',gap:12}}><View style={{flex:1}}>{field('Start (seconds)',start,setStart,12,true)}</View><View style={{flex:1}}>{field('End (seconds)',end,setEnd,12,true)}</View></View>
        <Text style={{color:t.ink.secondary,fontSize:12}}>For longer highlights, enter an end point up to 10 minutes after the start.</Text>
        {field('Cover frame (seconds into this clip)',cover,setCover,12,true)}{field('Tags, separated by commas',tags,setTags,1019)}
        {toggle('Vertical export · 9:16',vertical,setVertical)}{toggle('Horizontal export · 16:9',horizontal,setHorizontal)}{toggle(context.settings?.watermark_required?'Watermark required by creator':'Platinum Circles watermark',watermark,setWatermark,context.settings?.watermark_required)}{context.settings?.watermark_required?<Text style={{color:t.ink.secondary}}>Creator brand: {context.settings.brand_text||'Platinum Circles'}</Text>:field('Brand text',brand,setBrand,80)}
        {field('Subtitles · paste WebVTT or SRT, timed from the clip start',subtitles,setSubtitles,300000,false,true)}{toggle('Burn subtitles into the video',burn,setBurn)}
        <Text style={{color:t.ink.secondary,fontSize:12,lineHeight:18}}>Review subtitle text before rendering. The cover frame and both formats are generated from the selected range.</Text>
        {button(busy?'Creating clip…':'Create clip',()=>void create(),busy||!context.recording_available)}
      </>}
    </>:button('Retry clip tools',()=>setRefresh(v=>v+1))}
  </View>;
}
