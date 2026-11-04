import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Share, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { VideoView, useVideoPlayer } from 'expo-video';
import { isLiveUuid } from '../../shared/liveDirectory';
import { type LiveClip } from '../../shared/liveClips';
import { useTheme } from '../theme/useTheme';
import { useLivePlayback } from '../contexts/LivePlaybackContext';
import { clipAsset, downloadClip, nativeClipCommand } from '../services/liveClipService';
import { ensureMediaLibraryPermission } from '../services/devicePermissions';
import { liveObject, liveRequestId, liveRows, liveRpc, liveText, type LiveObject } from '../services/liveService';
import { supabase } from '../services/supabase';
import { profileRead } from '../utils/profileRead';
import { openLiveWebPage, type LiveWebPage } from '../services/liveWebHandoff';

function ClipPreview({clip,format}:{clip:LiveClip;format:string}) {
  const {t}=useTheme(),playback=useLivePlayback();
  const player=useVideoPlayer(null,p=>{p.loop=false;p.staysActiveInBackground=false;});
  const [error,setError]=useState('');
  useEffect(()=>{let alive=true,timer:ReturnType<typeof setTimeout>|undefined;playback.close();void clipAsset(clip.id,format).then(async asset=>{if(!alive)return;await player.replaceAsync({uri:asset.url,contentType:'progressive'});if(!alive)return;player.play();timer=setTimeout(()=>{player.pause();void player.replaceAsync(null);setError('Preview access expired. Close and reopen the preview.');},Math.max(1,asset.expiresAt-Date.now()));}).catch(reason=>{if(alive)setError(reason instanceof Error?reason.message:'The preview could not load.');});const app=AppState.addEventListener('change',state=>{if(state!=='active')player.pause();});return()=>{alive=false;if(timer)clearTimeout(timer);app.remove();player.pause();};},[clip.id,format,player]);
  return <View style={{gap:8}}><VideoView player={player} nativeControls contentFit="contain" style={{width:'100%',aspectRatio:format==='vertical'?9/16:16/9,backgroundColor:'#000',maxHeight:400}}/>{error?<Text accessibilityRole="alert" style={{color:t.ink.primary}}>{error}</Text>:null}</View>;
}

export function LiveClipActions({clip,onChanged,onClose}:{clip:LiveClip;onChanged():void;onClose():void}) {
  const {t}=useTheme();
  const [destination,setDestination]=useState('feed'),[target,setTarget]=useState(''),[search,setSearch]=useState(''),[targets,setTargets]=useState<LiveObject[]>([]),[schedule,setSchedule]=useState('');
  const [format,setFormat]=useState(clip.formats.includes('vertical')?'vertical':clip.formats[0]||'horizontal'),[preview,setPreview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [detail,setDetail]=useState<LiveObject|null>(null),[reviewReason,setReviewReason]=useState(''),[history,setHistory]=useState<LiveObject>({items:[]});
  const alive=useRef(true),lock=useRef(false),request=useRef<{signature:string;id:string}|null>(null),scope=useRef<AbortController|null>(null),searchVersion=useRef(0),handingOff=useRef(false);
  useEffect(()=>{alive.current=true;const app=AppState.addEventListener('change',state=>{if(state==='background'&&!handingOff.current)scope.current?.abort();});return()=>{alive.current=false;scope.current?.abort();searchVersion.current++;app.remove();};},[]);
  const loadDetail=useCallback(async()=>{try{const value=await liveRpc('live_clip_get',{p_clip_id:clip.id});if(alive.current){setDetail(value);setHistory(liveObject(value.publication_history)?value.publication_history:{items:[]});}}catch(reason){if(alive.current){setDetail(null);setError(reason instanceof Error?reason.message:'Clip controls could not load.');}}},[clip.id]);
  useEffect(()=>{void loadDetail();},[loadDetail,clip.state]);
  useEffect(()=>{searchVersion.current++;setTargets([]);setTarget('');},[destination]);
  const button=(label:string,onPress:()=>void,disabled=busy,selected=false)=><TouchableOpacity key={label} accessibilityRole="button" accessibilityState={{disabled,selected}} disabled={disabled} onPress={onPress} style={{minHeight:44,minWidth:44,paddingHorizontal:14,paddingVertical:10,borderRadius:22,backgroundColor:selected?t.ink.primary:t.surface.sunken,justifyContent:'center',alignItems:'center',opacity:disabled?.5:1}}><Text style={{color:selected?t.surface.raised:t.ink.primary,fontWeight:'600',fontSize:13}}>{label}</Text></TouchableOpacity>;
  const input=(label:string,value:string,change:(s:string)=>void,max=100)=><View style={{gap:6}}><Text style={{color:t.ink.secondary,fontSize:12}}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={change} maxLength={max} style={{minHeight:46,borderRadius:12,padding:12,color:t.ink.primary,backgroundColor:t.surface.sunken}}/></View>;
  const perform=async(action:string,payload:LiveObject)=>{
    if(lock.current)return false;lock.current=true;setBusy(true);setError('');setNotice('');const signature=JSON.stringify([clip.id,action,payload]);if(request.current?.signature!==signature)request.current={signature,id:liveRequestId()};
    try{const result=await nativeClipCommand(clip.session_id,clip.id,action,payload,request.current.id);if(!alive.current)return false;request.current=null;setNotice(result.post_id||result.story_id?'Clip published.':result.state==='scheduled'?'Your post is scheduled.':result.state==='export_required'?'Export recorded. Complete posting in your chosen app.':'Your clip request is saved.');await loadDetail();onChanged();return true;}
    catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'The clip action was not confirmed.');return false;}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  };
  const exportVideo=async(save:boolean)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');const controller=new AbortController();scope.current=controller;let prepared:Awaited<ReturnType<typeof downloadClip>>|null=null;
    try{
      if(!save&&!await Sharing.isAvailableAsync())throw new Error('Video sharing is unavailable on this device. Save the clip and upload it in your app.');
      prepared=await downloadClip(clip.id,format,controller.signal);if(!alive.current||controller.signal.aborted)return;
      handingOff.current=true;
      if(save){const permission=await ensureMediaLibraryPermission({writeOnly:true,granularPermissions:['video']});if(!permission.granted)throw new Error('Allow Photos access to save your clip.');}
      await clipAsset(clip.id,format);if(!alive.current||controller.signal.aborted)return;
      if(save){await MediaLibrary.saveToLibraryAsync(prepared.uri);if(alive.current)setNotice('Video saved to your photo library.');}
      else{await Sharing.shareAsync(prepared.uri,{mimeType:'video/mp4',UTI:'public.mpeg-4',dialogTitle:clip.title});if(alive.current)setNotice('Video handed to the device share menu. Confirm posting in the app you choose.');}
    }catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'The video could not be exported.');}
    finally{prepared?.dispose();scope.current=null;handingOff.current=false;lock.current=false;if(alive.current)setBusy(false);}
  };
  const permissions=liveObject(detail?.permissions)?detail.permissions:{},rawClip=liveObject(detail?.clip)?detail.clip:{};
  const link=`https://platinumcircles.app/live/clips/${clip.id}`,ready=['ready','published'].includes(clip.state)&&permissions.can_publish===true,shareLink=permissions.can_share_link===true;
  const openWeb=async(page:LiveWebPage)=>{
    if(lock.current||permissions.can_manage!==true)return;lock.current=true;setBusy(true);setError('');setPreview(false);
    try{await openLiveWebPage(page,page==='connections'?undefined:clip.id);if(alive.current)setNotice('Continue in your browser. You may need to sign in again.');}
    catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'Your browser could not open.');}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  };
  return <View style={{gap:16}}><Text style={{color:t.ink.primary,fontWeight:'700',fontSize:21}}>{clip.title}</Text><Text style={{color:t.ink.secondary}}>{clip.state.replace(/_/g,' ')} · {Math.round((clip.end_ms-clip.start_ms)/1000)} seconds</Text>{clip.caption?<Text style={{color:t.ink.primary}}>{clip.caption}</Text>:null}
    {error?<Text accessibilityRole="alert" style={{color:t.ink.primary}}>{error}</Text>:null}{notice?<Text accessibilityLiveRegion="polite" style={{color:t.ink.secondary}}>{notice}</Text>:null}
    {permissions.can_manage===true?<View style={{gap:10}}><Text style={{color:t.ink.primary,fontSize:17,fontWeight:'700'}}>Connected publishing</Text><Text style={{color:t.ink.secondary,lineHeight:20}}>Open your browser to connect accounts, review captions or choose a platform and confirm each post. You may need to sign in again.</Text><View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{button('Publish on web',()=>void openWeb('publish'))}{button('Connected accounts',()=>void openWeb('connections'))}{button('Review captions on web',()=>void openWeb('captions'))}</View></View>:null}
    {ready?<>
      <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{clip.formats.map(value=>button(value==='vertical'?'Vertical · 9:16':'Horizontal · 16:9',()=>{setFormat(value);setPreview(false);},busy,format===value))}{button(preview?'Close preview':'Preview video',()=>setPreview(v=>!v))}</View>
      {preview?<ClipPreview key={format} clip={clip} format={format}/>:null}
      <Text style={{color:t.ink.primary,fontSize:17,fontWeight:'700'}}>Post on Platinum Circles</Text>
      <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{[['feed','Feed'],['story','Story'],['channel','Channel'],['community','Community'],['highlight','Replay highlight']].map(([value,label])=>button(label,()=>setDestination(value),busy,destination===value))}</View>
      {['channel','community'].includes(destination)?<View style={{gap:10}}>{input('Search '+destination+' name',search,setSearch)}{button('Search destinations',()=>{const version=++searchVersion.current;setError('');void profileRead(supabase.rpc(destination==='channel'?'get_channels_page':'get_communities_page',{p_query:search.trim(),p_offset:0,p_limit:20,p_as_of:new Date().toISOString()})).then(({data,error})=>{if(version!==searchVersion.current)return;if(error)throw error;setTargets(liveRows(data,20).filter(item=>isLiveUuid(item.id)&&(destination==='channel'?['owner','collaborator'].includes(String(item.my_role)):item.is_member===true)));}).catch(()=>{if(alive.current&&version===searchVersion.current)setError('Destinations could not load. Try again.');});},busy||!search.trim())}{targets.map(item=>button(liveText(item.name,100),()=>setTarget(String(item.id)),busy,target===item.id))}</View>:null}
      {input('Schedule, optional · include date, time and time zone',schedule,setSchedule)}
      {button(schedule.trim()?'Schedule clip':'Publish clip',()=>{const at=schedule.trim()?Date.parse(schedule):null;if(at!==null&&(!Number.isFinite(at)||at<=Date.now())){setError('Enter a future date and time with your time zone.');return;}void perform('publish',{destination,target_id:target||null,format,scheduled_at:at===null?null:new Date(at).toISOString()});},busy||(['channel','community'].includes(destination)&&!target))}
      <Text style={{color:t.ink.primary,fontSize:17,fontWeight:'700'}}>Share and export</Text>
      {shareLink?<View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{button('Copy link',()=>void Clipboard.setStringAsync(link).then(()=>setNotice('Clip link copied.')).catch(()=>setError('The link could not be copied.')))}{button('Share link',()=>void Share.share({message:`${clip.title}\n${link}`,url:link}).catch(()=>setError('The share menu could not open.')))}{button('X',()=>void perform('share',{destination:'x',format}).then(ok=>ok?Linking.openURL('https://twitter.com/intent/tweet?text='+encodeURIComponent(clip.title)+'&url='+encodeURIComponent(link)):undefined).catch(()=>setError('X could not open. Copy the link instead.')))}{button('Facebook',()=>void perform('share',{destination:'facebook',format}).then(ok=>ok?Linking.openURL('https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(link)):undefined).catch(()=>setError('Facebook could not open. Copy the link instead.')))}</View>:<Text style={{color:t.ink.secondary,fontSize:12}}>Link sharing is available after a public clip is published. Authorized video export is available below.</Text>}
      <Text style={{color:t.ink.secondary,lineHeight:20}}>For Instagram, YouTube Shorts or TikTok, share the exported video to an installed app or save it and upload from your library.</Text>
      <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{button(busy?'Working…':'Share video',()=>void exportVideo(false))}{button('Save video to Photos',()=>void exportVideo(true))}</View>
      <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{[['instagram','Instagram'],['youtube','YouTube Shorts'],['tiktok','TikTok']].map(([destination,label])=>button(label,()=>void perform('share',{destination,format}).then(ok=>{if(ok)return exportVideo(false);})) )}</View>
    </>:<><Text style={{color:t.ink.secondary}}>{!detail?'Loading clip permissions…':clip.state==='blocked'?'Copyright controls currently block this clip.':'This clip is processing or waiting for review. The library refreshes while processing is active.'}</Text>{button('Refresh clip controls',()=>void loadDetail(),busy)}{clip.state==='failed'&&permissions.can_manage===true?button('Retry rendering',()=>void perform('retry',{})):null}</>}
    {permissions.can_review===true?<View style={{gap:10}}><Text style={{color:t.ink.primary,fontSize:17,fontWeight:'700'}}>Review and copyright controls</Text>{clip.state==='review'?button(preview?'Close review preview':'Preview for review',()=>setPreview(value=>!value)):null}{preview&&clip.state==='review'?<ClipPreview key={format} clip={clip} format={format}/>:null}{liveRows(rawClip.subtitles,500).map((cue,index)=><Text key={index} style={{color:t.ink.secondary,fontSize:12}}>{(Number(cue.start_ms)||0)/1000}s–{(Number(cue.end_ms)||0)/1000}s · {liveText(cue.text,500)}</Text>)}{input('Review reason',reviewReason,setReviewReason,1000)}<View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{button('Approve',()=>void perform('review',{decision:'approved',reason:reviewReason.trim()}),busy||!reviewReason.trim())}{button('Reject',()=>void perform('review',{decision:'rejected',reason:reviewReason.trim()}),busy||!reviewReason.trim())}{button('Clear copyright',()=>void perform('copyright',{status:'cleared',reason:reviewReason.trim()}),busy||!reviewReason.trim())}{button('Block copyright',()=>void perform('copyright',{status:'blocked',reason:reviewReason.trim()}),busy||!reviewReason.trim())}</View></View>:null}
    {permissions.can_manage===true?<View style={{gap:10}}><Text style={{color:t.ink.primary,fontSize:17,fontWeight:'700'}}>Posting and export history</Text>{liveRows(history.items,25).map(post=><View key={String(post.id)} style={{gap:6}}><Text style={{color:t.ink.primary,fontSize:13}}>{liveText(post.destination,30)} · {liveText(post.state,30).replace(/_/g,' ')} · {liveText(post.created_at,50)}</Text>{post.state==='export_required'?<Text style={{color:t.ink.secondary,fontSize:12}}>Device export requested. Posting is completed in the destination app.</Text>:null}{post.state==='failed'?button('Retry post',()=>void perform('retry_post',{post_id:post.id})):null}</View>)}{history.next_cursor?button('Earlier posting history',()=>{void liveRpc('live_clip_history',{p_clip_id:clip.id,p_cursor:history.next_cursor}).then(value=>{if(alive.current)setHistory(value);}).catch(reason=>{if(alive.current)setError(reason instanceof Error?reason.message:'Posting history could not load.');});}):null}{button('Remove clip',()=>Alert.alert('Remove this clip?','Its playback links will be revoked.',[{text:'Keep clip',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void perform('delete',{}).then(done=>{if(done)onClose();})}]))}</View>:null}
  </View>;
}
