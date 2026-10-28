import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Modal, PanResponder, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from '../SafeArea';
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import CommentsSheet from './CommentsSheet';
import { FilterLayer } from '../stories/StoryFilters';
import { AdjustLayer } from '../stories/storyPanels';
import { supabase } from '../../services/supabase';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { useCallContext } from '../../contexts/CallContext';
import { useSoundtrackPlayer } from '../../hooks/useSoundtrackPlayer';
import { readSoundtrack, type SoundtrackSelection } from '../../../shared/soundtrack';
import { discoverFrame, discoverIndex, discoverNeedsMore } from '../../../shared/discover';

type Media = { id?: string; url: string; media_type: string; width?: number | null; height?: number | null; is_sensitive?: boolean; alt_text?: string | null; edit?: any };
export type DiscoverPost = { id: string; user_id: string; content?: string; article_title?: string | null; media?: Media[]; likes_count?: number; comments_count?: number };
type Props = { posts: DiscoverPost[]; initialId: string; profiles: Record<string, any>; liked: Record<string, boolean>; saved: Record<string, boolean>; hasMore: boolean; loading: boolean; error?: string | null; loadMore: () => Promise<void>; onClose: () => void; onLike: (id: string) => void; onSave: (id: string) => void; onOpenPost: (id: string) => void; onRefreshMedia: () => void; onShare: (id: string) => void };

function DiscoverVideo({ item, postId, active, soundtrack, width, height, onRetry }: { item: Media; postId: string; active: boolean; soundtrack: SoundtrackSelection | null; width: number; height: number; onRetry: () => void }) {
  const autoplay = useSettingsStore(s => s.autoplayVideos);
  const player = useVideoPlayer(item.url, p => { p.loop = true; p.muted = true; p.timeUpdateEventInterval = 0.25; });
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [muted, setMuted] = useState(true), [failed, setFailed] = useState(false);
  const [requested, setRequested] = useState(autoplay);
  const start = Math.max(0, Number(item.edit?.trimStart) || 0);
  const rate = Math.min(2, Math.max(0.25, Number(item.edit?.speed) || 1));
  const watch = useRef(0), last = useRef<number | null>(null);
  const uid = useAuthStore(s => s.profile?.id);
  const owner = useRef(uid);
  useSoundtrackPlayer({ selection: soundtrack, use: 'post', active: active && !muted && playing, clock: { time: Math.max(0, time-start), playing, rate } });
  useEffect(() => {
    player.muted = muted;
    player.volume = item.edit?.muted ? 0 : (soundtrack?.originalVolume ?? 1);
    player.playbackRate = rate;
  }, [player, muted, rate, soundtrack?.originalVolume, item.edit?.muted]);
  useEffect(() => {
    if (active && requested && !failed) player.play(); else player.pause();
    return () => { try { player.pause(); } catch {} };
  }, [active, requested, failed, player]);
  useEffect(() => {
    const accumulate = () => { if (last.current !== null) watch.current += Math.max(0, Date.now()-last.current); last.current = null; };
    const a = player.addListener('playingChange', e => { accumulate(); setPlaying(e.isPlaying); if(e.isPlaying && active) last.current=Date.now(); });
    const mute = player.addListener('mutedChange', e => setMuted(e.muted));
    const b = player.addListener('statusChange', e => { setFailed(e.status==='error'); if(e.status!=='readyToPlay') accumulate(); });
    const c = player.addListener('timeUpdate', e => {
      const end = Number(item.edit?.trimEnd) || player.duration;
      if(e.currentTime < start || (end>start && e.currentTime>=end)) player.currentTime=start;
      setTime(e.currentTime);
    });
    const timer = setTimeout(() => { if(player.status==='loading') setFailed(true); }, 15000);
    return () => {
      clearTimeout(timer); accumulate(); a.remove(); b.remove(); c.remove(); mute.remove();
      const seconds = Math.min(60,Math.floor(watch.current/1000)); watch.current=0;
      if(seconds>0 && owner.current && useAuthStore.getState().profile?.id===owner.current) void supabase.rpc('record_video_view',{p_post_id:postId,p_viewer_id:owner.current,p_session:postId+':discover:'+Date.now(),p_duration:seconds});
    };
  }, [active, player, postId, start, item.edit?.trimEnd]);
  const rotation=Number(item.edit?.rotation)||0;
  const frame=discoverFrame(width,height,item.width,item.height,rotation);
  return <View style={{width,height,alignItems:'center',justifyContent:'center',backgroundColor:'#000',overflow:'hidden'}}>
    <VideoView player={player} contentFit="contain" nativeControls fullscreenOptions={{enable:false}} style={{...frame,transform:[{translateX:(item.edit?.translateNX||0)*width},{translateY:(item.edit?.translateNY||0)*height},{rotate:`${rotation}deg`},{scaleX:(item.edit?.flipX?-1:1)*(item.edit?.scale||1)},{scaleY:(item.edit?.flipV?-1:1)*(item.edit?.scale||1)}]}} />
    {item.edit?.filterId ? <FilterLayer filterId={item.edit.filterId} amt={item.edit.filterAmt??100}/> : null}
    {item.edit?.adjust ? <AdjustLayer adjust={item.edit.adjust}/> : null}
    <TouchableOpacity accessibilityLabel={muted?'Unmute video':'Mute video'} style={s.sound} onPress={()=>setMuted(v=>!v)}><Feather name={muted?'volume-x':'volume-2'} size={22} color="#fff"/></TouchableOpacity>
    {!requested && !failed ? <TouchableOpacity accessibilityLabel="Play video" style={s.play} onPress={()=>setRequested(true)}><Feather name="play" size={32} color="#fff"/></TouchableOpacity> : null}
    {failed ? <View style={s.failure}><Text style={s.white}>Video could not play</Text><TouchableOpacity onPress={()=>{setFailed(false);onRetry();void player.replaceAsync(item.url).then(()=>{if(active)player.play();}).catch(()=>setFailed(true));}}><Text style={s.white}>Try again</Text></TouchableOpacity></View>:null}
  </View>;
}
function DiscoverCell({ post, active, width, height, onRetry }: { post: DiscoverPost; active:boolean; width:number; height:number; onRetry:()=>void }) {
  const [slide,setSlide]=useState(0), [failed,setFailed]=useState(false), [revealed,setRevealed]=useState(false);
  const media=post.media??[]; const item=media[slide]; const soundtrack=readSoundtrack(media[0]?.edit?.soundtrack);
  const sensitive=media.some(m=>m.is_sensitive || m.edit?.sensitive);
  const hidden=sensitive&&!revealed;
  useSoundtrackPlayer({selection:soundtrack,use:'post',active:active && !hidden && item?.media_type!=='video'});
  useEffect(()=>{setFailed(false);},[item?.url]);
  const swipe=useMemo(()=>PanResponder.create({onMoveShouldSetPanResponder:(_,g)=>media.length>1&&Math.abs(g.dx)>15&&Math.abs(g.dx)>Math.abs(g.dy)*1.5,onPanResponderRelease:(_,g)=>{if(Math.abs(g.dx)>40)setSlide(n=>Math.max(0,Math.min(media.length-1,n+(g.dx<0?1:-1))));}}),[media.length]);
  const rotation=Number(item?.edit?.rotation)||0;
  const frame=discoverFrame(width,height,item?.width,item?.height,rotation);
  return <View {...swipe.panHandlers} style={{width,height,alignItems:'center',justifyContent:'center',backgroundColor:'#000',overflow:'hidden'}}>
    {hidden ? <TouchableOpacity accessibilityLabel="Show sensitive content" style={s.failure} onPress={()=>setRevealed(true)}><Text style={s.white}>Sensitive content</Text><Text style={s.white}>Tap to view</Text></TouchableOpacity> : item?.media_type==='video' ? <DiscoverVideo key={item.url} item={item} postId={post.id} active={active} soundtrack={soundtrack} width={width} height={height} onRetry={onRetry}/>
    : item ? <><Image source={{uri:item.url}} accessibilityLabel={item.alt_text||undefined} contentFit="contain" onError={()=>setFailed(true)} style={{...frame,transform:[{translateX:(item.edit?.translateNX||0)*width},{translateY:(item.edit?.translateNY||0)*height},{rotate:`${rotation}deg`},{scaleX:(item.edit?.flipX?-1:1)*(item.edit?.scale||1)},{scaleY:(item.edit?.flipV?-1:1)*(item.edit?.scale||1)}]}}/>{item.edit?.filterId?<FilterLayer filterId={item.edit.filterId} amt={item.edit.filterAmt??100}/>:null}{item.edit?.adjust?<AdjustLayer adjust={item.edit.adjust}/>:null}</>
    : <Text style={[s.white,{padding:28,fontSize:22}]}>{post.article_title||post.content}</Text>}
    {failed?<TouchableOpacity style={s.failure} onPress={onRetry}><Text style={s.white}>Could not load image. Try again.</Text></TouchableOpacity>:null}
    {media.length>1 ? <View style={s.pages}><TouchableOpacity accessibilityLabel="Previous photo" disabled={slide===0} onPress={()=>setSlide(v=>v-1)}><Feather name="chevron-left" size={25} color={slide?'#fff':'#666'}/></TouchableOpacity><Text style={s.white}>{slide+1}/{media.length}</Text><TouchableOpacity accessibilityLabel="Next photo" disabled={slide===media.length-1} onPress={()=>setSlide(v=>v+1)}><Feather name="chevron-right" size={25} color={slide<media.length-1?'#fff':'#666'}/></TouchableOpacity></View>:null}
  </View>;
}
export default function DiscoverViewer(props: Props) {
  const {posts,initialId,profiles,liked,saved,hasMore,loading,error,loadMore,onClose,onLike,onSave,onOpenPost,onRefreshMedia,onShare}=props;
  useTheme();
  const {width,height}=useWindowDimensions();const insets=useSafeAreaInsets();
  const {callState}=useCallContext();
  const [activeId,setActiveId]=useState(initialId),[comments,setComments]=useState<string|null>(null),[expanded,setExpanded]=useState(false),[foreground,setForeground]=useState(AppState.currentState==='active');
  const list=useRef<FlatList<DiscoverPost>>(null);const owner=useRef(useAuthStore.getState().profile?.id);
  const index=discoverIndex(posts.map(p=>p.id),activeId);const post=posts[index];
  const viewport=Math.max(220,height-insets.top-insets.bottom-(expanded?50:160));
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>setForeground(state==='active'));const auth=useAuthStore.subscribe(state=>{if(state.profile?.id!==owner.current)onClose();});return()=>{sub.remove();auth();};},[onClose]);
  useEffect(()=>{if(discoverNeedsMore(index,posts.length,hasMore,loading,error))void loadMore();},[index,posts.length,hasMore,loading,error,loadMore]);
  const viewability=useRef({itemVisiblePercentThreshold:60}).current;
  const onViewable=useRef(({viewableItems}:any)=>{if(viewableItems[0]?.item?.id)setActiveId(viewableItems[0].item.id);}).current;
  return <Modal visible animationType="slide" presentationStyle="fullScreen" supportedOrientations={['portrait','landscape']} onRequestClose={()=>comments?setComments(null):onClose()}>
    <View style={[s.container,{paddingTop:insets.top,paddingBottom:insets.bottom}]}>
      <View style={s.header}><TouchableOpacity accessibilityLabel="Close Discover" onPress={onClose}><Feather name="x" size={25} color={getTheme().ink.primary}/></TouchableOpacity><Text style={s.title}>Discover</Text><TouchableOpacity accessibilityLabel={expanded?'Show details':'Expand media'} onPress={()=>setExpanded(v=>!v)}><Feather name={expanded?'minimize':'maximize'} size={22} color={getTheme().ink.primary}/></TouchableOpacity></View>
      <FlatList ref={list} style={{height:viewport,flexGrow:0}} data={posts} key={String(viewport)} keyExtractor={p=>p.id} initialScrollIndex={posts.length?index:undefined} getItemLayout={(_,i)=>({length:viewport,offset:viewport*i,index:i})} pagingEnabled windowSize={3} initialNumToRender={2} maxToRenderPerBatch={2} showsVerticalScrollIndicator={false} onViewableItemsChanged={onViewable} viewabilityConfig={viewability} onEndReached={()=>{if(hasMore&&!loading&&!error)void loadMore();}} onEndReachedThreshold={1} renderItem={({item})=><DiscoverCell post={item} active={item.id===post?.id&&foreground&&!comments&&callState==='idle'} width={width} height={viewport} onRetry={onRefreshMedia}/>} />
      {!expanded&&post?<View style={s.details}><TouchableOpacity onPress={()=>onOpenPost(post.id)}><Text numberOfLines={1} style={s.title}>{profiles[post.user_id]?.full_name||profiles[post.user_id]?.username||'Member'}</Text><Text style={s.caption} numberOfLines={2}>{post.content||post.article_title}</Text></TouchableOpacity><View style={s.actions}><TouchableOpacity accessibilityLabel={liked[post.id]?'Unlike post':'Like post'} onPress={()=>onLike(post.id)}><Text style={s.action}>{liked[post.id]?'♥':'♡'} {post.likes_count??0}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel="Open comments" onPress={()=>setComments(post.id)}><Text style={s.action}>Comments {post.comments_count??0}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel={saved[post.id]?'Unsave post':'Save post'} onPress={()=>onSave(post.id)}><Feather name="bookmark" color={saved[post.id]?getTheme().brand.base:getTheme().ink.primary} size={22}/></TouchableOpacity><TouchableOpacity accessibilityLabel="Share post" onPress={()=>onShare(post.id)}><Feather name="share" size={22} color={getTheme().ink.primary}/></TouchableOpacity></View></View>:null}
      {loading?<ActivityIndicator color={getTheme().brand.base}/>:error?<TouchableOpacity accessibilityLabel="Retry more posts" onPress={()=>void loadMore()}><Text style={s.caption}>Could not load more. Tap to retry.</Text></TouchableOpacity>:null}
      {comments?<CommentsSheet visible inline postId={comments} postAuthorId={posts.find(p=>p.id===comments)?.user_id} onClose={()=>setComments(null)}/>:null}
    </View>
  </Modal>;
}
const s=themedSheet(t=>({container:{flex:1,backgroundColor:t.surface.canvas},header:{height:50,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{fontSize:16,fontWeight:'700',color:t.ink.primary},caption:{fontSize:13,color:t.ink.secondary,marginTop:4},details:{height:110,paddingHorizontal:16,paddingTop:8},actions:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:12},action:{fontSize:15,color:t.ink.primary},white:{color:'#fff',fontSize:15,fontWeight:'600'},sound:{position:'absolute',top:12,right:12,padding:10,borderRadius:22,backgroundColor:'#0009'},play:{position:'absolute',padding:18,borderRadius:40,backgroundColor:'#0009'},failure:{position:'absolute',padding:18,gap:10,backgroundColor:'#000c',borderRadius:14},pages:{position:'absolute',bottom:12,flexDirection:'row',gap:20,alignItems:'center',backgroundColor:'#000a',borderRadius:20,padding:8}}));
