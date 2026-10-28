import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import type { PostMediaEdit } from './PostMediaEditSheet';
import { AdjustLayer } from './stories/storyPanels';
import { FilterLayer } from './stories/StoryFilters';
import PostCaption from './PostCaption';
import { postAspectRatio, postTimeLabel, postTrimWindow } from '../../shared/postMediaEditing';

export default function PostDraftPreview({ media, active = true }: { media: {uri:string;type:'image'|'video';width?:number;height?:number;thumbnail?:string;edit?:PostMediaEdit|null}; active?:boolean }) {
  const [width,setWidth]=useState(0),[clock,setClock]=useState(0),[playing,setPlaying]=useState(false),[duration,setDuration]=useState(0);
  const edit=media.edit;
  const ratio=postAspectRatio(edit,media.width,media.height),height=width/ratio;
  const player=useVideoPlayer(media.type==='video'?media.uri:null,p=>{p.loop=true;p.muted=edit?.muted??false;p.timeUpdateEventInterval=.1;});
  useEffect(()=>{if(media.type!=='video')return;try{player.muted=edit?.muted??false;player.playbackRate=edit?.speed??1;player.currentTime=edit?.trimStart??0;}catch{}},[player,media.type,edit?.muted,edit?.speed,edit?.trimStart]);
  useEffect(()=>{if(!active){try{player.pause();}catch{}}},[player,active]);
  useEffect(()=>{if(media.type!=='video')return;const time=player.addListener('timeUpdate',event=>{const range=postTrimWindow(player.duration,edit?.trimStart,edit?.trimEnd);setClock(event.currentTime);setDuration(player.duration);if(range.duration&&(event.currentTime>=range.end||event.currentTime<range.start-.2))player.currentTime=range.start;});const state=player.addListener('playingChange',event=>setPlaying(event.isPlaying));return()=>{time.remove();state.remove();};},[player,media.type,edit?.trimStart,edit?.trimEnd]);
  const transform:any={transform:[{translateX:(edit?.translateNX??0)*width},{translateY:(edit?.translateNY??0)*height},{scale:edit?.scale??1},{rotate:`${edit?.rotation??0}deg`},{scaleX:edit?.flipX?-1:1}]};
  const poster=edit?.coverLocalUri||edit?.coverUrl||media.thumbnail;
  return <View onLayout={event=>setWidth(event.nativeEvent.layout.width)} style={{width:'100%',aspectRatio:ratio,overflow:'hidden',borderRadius:16,backgroundColor:'#101923'}}>
    {media.type==='video'?<VideoView player={player} nativeControls={false} contentFit={edit?.fit??'cover'} style={[StyleSheet.absoluteFill,transform]} surfaceType="textureView"/>:<Image source={{uri:media.uri}} resizeMode={edit?.fit==='contain'?'contain':'cover'} style={[StyleSheet.absoluteFill,transform]}/>}
    {media.type==='video'&&!playing&&poster?<View pointerEvents="none" style={StyleSheet.absoluteFill}><Image source={{uri:poster}} resizeMode={edit?.fit==='contain'?'contain':'cover'} style={[StyleSheet.absoluteFill,transform]}/></View>:null}
    <FilterLayer filterId={edit?.filterId??null} amt={edit?.filterAmt??100}/><AdjustLayer adjust={edit?.adjust}/><PostCaption captions={edit?.captions} time={clock}/>
    {media.type==='video'?<TouchableOpacity accessibilityRole="button" accessibilityLabel={playing?'Pause video preview':'Play video preview'} onPress={()=>{try{playing?player.pause():player.play();}catch{}}} style={{position:'absolute',bottom:12,left:12,minHeight:44,paddingHorizontal:13,borderRadius:24,backgroundColor:'rgba(6,14,25,.75)',flexDirection:'row',alignItems:'center',gap:9,zIndex:5}}><Feather name={playing?'pause':'play'} size={19} color="#FFF"/><Text style={{fontSize:12,color:'#FFF',fontVariant:['tabular-nums']}}>{postTimeLabel(clock)} / {postTimeLabel(duration)}</Text></TouchableOpacity>:null}
  </View>;
}
