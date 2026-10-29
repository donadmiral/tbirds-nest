import React, { useEffect, useState } from 'react';
import { AppState, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import type { PostMediaEdit } from './PostMediaEditSheet';
import { AdjustLayer } from './stories/storyPanels';
import { FilterLayer } from './stories/StoryFilters';
import PostCaption from './PostCaption';
import PostSoundtrack from './PostSoundtrack';
import { useCallContext } from '../contexts/CallContext';
import type { SoundtrackSelection } from '../../shared/soundtrack';
import { postAspectRatio, postTimeLabel, postTrimWindow } from '../../shared/postMediaEditing';

type Props = {
  media:{uri:string;type:'image'|'video';width?:number;height?:number;thumbnail?:string;edit?:PostMediaEdit|null};
  active?:boolean; autoPlay?:boolean; soundtrack?:SoundtrackSelection|null;
};
export default function PostDraftPreview({ media, active=true, autoPlay=false, soundtrack }: Props) {
  const [width,setWidth]=useState(0),[clock,setClock]=useState(0),[playing,setPlaying]=useState(false),[duration,setDuration]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState('');
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const {callState}=useCallContext();
  const allowed=active&&foreground&&callState==='idle';
  const edit=media.edit;
  const ratio=postAspectRatio(edit,media.width,media.height),height=width/ratio;
  const player=useVideoPlayer(media.type==='video'?media.uri:null,p=>{p.loop=true;p.muted=edit?.muted??false;p.timeUpdateEventInterval=.1;});
  useEffect(()=>{setClock(edit?.trimStart??0);setDuration(0);setPlaying(false);setError('');},[media.uri]);
  // Mixing volumes must not seek back to the beginning or recreate the video.
  useEffect(()=>{if(media.type!=='video')return;try{player.muted=edit?.muted??false;player.volume=soundtrack?.originalVolume??1;player.playbackRate=edit?.speed??1;}catch{}},[player,media.type,edit?.muted,edit?.speed,soundtrack?.originalVolume]);
  useEffect(()=>{if(media.type==='video')try{player.currentTime=edit?.trimStart??0;setClock(edit?.trimStart??0);}catch{}},[player,media.type,edit?.trimStart]);
  useEffect(()=>{const subscription=AppState.addEventListener('change',state=>{setForeground(state==='active');if(state!=='active'){try{player.pause();}catch{}setPlaying(false);}});return()=>subscription.remove();},[player]);
  useEffect(()=>{if(media.type!=='video')return;try{if(!allowed){player.pause();setPlaying(false);}else if(autoPlay)player.play();}catch{setError('Video preview could not play. Tap play to retry.');}},[player,media.type,allowed,autoPlay]);
  useEffect(()=>{
    if(media.type!=='video')return;
    setReady(player.status==='readyToPlay');
    const time=player.addListener('timeUpdate',event=>{const range=postTrimWindow(player.duration,edit?.trimStart,edit?.trimEnd);setDuration(player.duration);if(range.duration&&(event.currentTime>=range.end||event.currentTime<range.start-.2)){player.currentTime=range.start;setClock(range.start);}else setClock(event.currentTime);});
    const state=player.addListener('playingChange',event=>{if(event.isPlaying&&!allowed){try{player.pause();}catch{}setPlaying(false);}else setPlaying(event.isPlaying);});
    const status=player.addListener('statusChange',event=>{setReady(event.status==='readyToPlay');if(event.status==='error'){setPlaying(false);setError('This video preview could not load. Try another supported video.');}});
    return()=>{time.remove();state.remove();status.remove();};
  },[player,media.type,edit?.trimStart,edit?.trimEnd,allowed]);
  const transform:any={transform:[{translateX:(edit?.translateNX??0)*width},{translateY:(edit?.translateNY??0)*height},{scale:edit?.scale??1},{rotate:`${edit?.rotation??0}deg`},{scaleX:edit?.flipX?-1:1}]};
  const poster=edit?.coverLocalUri||edit?.coverUrl||media.thumbnail;
  const toggle=()=>{if(!allowed)return;try{setError('');playing?player.pause():player.play();}catch{setError('Video preview could not play. Tap play to retry.');}};
  return <View onLayout={event=>setWidth(event.nativeEvent.layout.width)} style={{width:'100%',aspectRatio:ratio,overflow:'hidden',borderRadius:16,backgroundColor:'#101923'}}>
    {media.type==='video'?<VideoView player={player} nativeControls={false} contentFit={edit?.fit??'cover'} style={[StyleSheet.absoluteFill,transform]} surfaceType="textureView"/>:<Image source={{uri:media.uri}} resizeMode={edit?.fit==='contain'?'contain':'cover'} style={[StyleSheet.absoluteFill,transform]}/>}
    {media.type==='video'&&!playing&&poster?<View pointerEvents="none" style={StyleSheet.absoluteFill}><Image source={{uri:poster}} resizeMode={edit?.fit==='contain'?'contain':'cover'} style={[StyleSheet.absoluteFill,transform]}/></View>:null}
    <FilterLayer filterId={edit?.filterId??null} amt={edit?.filterAmt??100}/><AdjustLayer adjust={edit?.adjust}/><PostCaption captions={edit?.captions} time={clock}/>
    {soundtrack?<PostSoundtrack selection={soundtrack} active={allowed} controls={media.type!=='video'&&!autoPlay} clock={media.type==='video'?{time:Math.max(0,clock-(edit?.trimStart??0)),playing:playing&&ready&&allowed,rate:edit?.speed??1}:undefined}/>:null}
    {media.type==='video'?<TouchableOpacity disabled={!allowed} accessibilityRole="button" accessibilityLabel={playing?'Pause video preview':'Play video preview'} onPress={toggle} style={{position:'absolute',bottom:12,left:12,minHeight:44,paddingHorizontal:13,borderRadius:24,backgroundColor:'rgba(6,14,25,.75)',flexDirection:'row',alignItems:'center',gap:9,zIndex:5}}><Feather name={playing?'pause':'play'} size={19} color="#FFF"/><Text style={{fontSize:12,color:'#FFF',fontVariant:['tabular-nums']}}>{postTimeLabel(clock)} / {postTimeLabel(duration)}</Text></TouchableOpacity>:null}
    {error?<View style={{position:'absolute',left:10,right:10,top:10,padding:10,borderRadius:10,backgroundColor:'rgba(0,0,0,.8)'}}><Text accessibilityRole="alert" style={{color:'#FFF',fontSize:12,lineHeight:18}}>{error}</Text></View>:null}
  </View>;
}
