import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Image } from 'expo-image';
import { LiveDirectoryHeader, LiveIcon } from '../../components/LiveUi';
import { SafeAreaView } from '../../components/SafeArea';
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import { profileRead } from '../../utils/profileRead';
import { isLiveSetupMissing, liveStateLabel, parseLiveDirectory, safeLiveImage, type LiveCursor, type LiveFilter, type LiveSession, type LiveView } from '../../../shared/liveDirectory';

type State={key:string;items:LiveSession[];cursor:LiveCursor|null;error:string|null;setup:boolean};
export default function LiveStreamsScreen({navigation}:{navigation:{goBack():void;navigate(name:string,params?:object):void}}){
  const {t}=useTheme(),owner=useAuthStore(s=>s.profile?.id??null),focused=useIsFocused();
  const [filter,setFilter]=useState<LiveFilter>('for_you'),[view,setView]=useState<LiveView>('live'),[topic,setTopic]=useState('all'),[query,setQuery]=useState('');
  const [data,setData]=useState<State>({key:'',items:[],cursor:null,error:null,setup:false}),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  const scope=`${owner}:${filter}:${view}:${topic}`,current=useRef(scope),request=useRef(0),lock=useRef(false);current.current=scope;
  const load=useCallback(async(cursor:LiveCursor|null=null)=>{
    if(!owner||(cursor&&lock.current))return;const version=++request.current;lock.current=true;setLoading(true);
    if(!cursor)setData({key:scope,items:[],cursor:null,error:null,setup:false});
    try{
      const {data:rows,error}=await profileRead(supabase.rpc('live_directory',{p_filter:filter,p_topic:topic==='all'?null:topic,p_state:view,p_cursor:cursor,p_limit:24}));
      if(error)throw error;const page=parseLiveDirectory(rows);
      const ids=page.items.filter(item=>item.has_cover).map(item=>item.id);
      if(ids.length){try{const response=await profileRead(supabase.functions.invoke('live-cover',{body:{action:'read',sessionIds:ids}}),4000);if(!response.error&&Array.isArray(response.data?.items)){const covers=new Map(response.data.items.slice(0,24).map((row:{session_id:string;thumbnail_url:string})=>[row.session_id,safeLiveImage(row.thumbnail_url)]));page.items.forEach(item=>{if(covers.has(item.id))item.thumbnail_url=covers.get(item.id) as string|null;});}}catch{}}
      if(version!==request.current||current.current!==scope)return;
      setData(previous=>{const prior=cursor&&previous.key===scope?previous.items:[],known=new Set(prior.map(item=>item.id));return{key:scope,items:[...prior,...page.items.filter(item=>!known.has(item.id))].slice(-96),cursor:page.next_cursor,error:null,setup:false};});
    }catch(error){if(version===request.current&&current.current===scope)setData(previous=>({...previous,key:scope,cursor,error:isLiveSetupMissing(error)?null:'Live streams could not load. Pull down to retry.',setup:isLiveSetupMissing(error)}));}
    finally{if(version===request.current){lock.current=false;setLoading(false);}}
  },[owner,filter,view,topic,scope]);
  useEffect(()=>{void load();return()=>{request.current++;lock.current=false;};},[load,revision]);
  // A live card's count and state are a minute old at most: while 'Live now' is on screen, re-read the first page every sixty seconds and update the cards in place, keeping their signed covers and the reader's position.
  const refreshCards=useCallback(async()=>{
    if(!owner||view!=='live'||lock.current)return;
    try{
      const {data:rows,error}=await profileRead(supabase.rpc('live_directory',{p_filter:filter,p_topic:topic==='all'?null:topic,p_state:view,p_cursor:null,p_limit:24}));
      if(error||current.current!==scope)return;const fresh=new Map(parseLiveDirectory(rows).items.map(item=>[item.id,item]));
      setData(previous=>previous.key!==scope?previous:{...previous,items:previous.items.map(item=>{const next=fresh.get(item.id);return next?{...next,thumbnail_url:item.thumbnail_url}:item;})});
    }catch{/* The next tick tries again; the cards keep what they show. */}
  },[owner,filter,view,topic,scope]);
  useEffect(()=>{if(view!=='live'||!focused)return;const timer=setInterval(()=>{if(AppState.currentState==='active')void refreshCards();},60000);return()=>clearInterval(timer);},[view,focused,refreshCards]);
  const visible=data.key===scope?data.items.filter(item=>`${item.title} ${item.host.full_name||''} ${item.host.username||''}`.toLowerCase().includes(query.trim().toLowerCase())):[];
  return <SafeAreaView style={{flex:1,backgroundColor:t.surface.raised}}><FlatList data={visible} keyExtractor={item=>item.id} refreshing={loading} onRefresh={()=>setRevision(v=>v+1)} initialNumToRender={6} maxToRenderPerBatch={6} windowSize={5} maintainVisibleContentPosition={{minIndexForVisible:1}} contentContainerStyle={{paddingHorizontal:16,paddingBottom:100,gap:16,flexGrow:1}} ListHeaderComponent={<>
    <LiveDirectoryHeader filter={filter} view={view} topic={topic} query={query} onFilter={setFilter} onView={setView} onTopic={setTopic} onQuery={setQuery} onBack={()=>navigation.goBack()} onCreate={()=>navigation.navigate('NewLive')} onSchedule={()=>navigation.navigate('NewLive',{schedule:true})} onClips={()=>navigation.navigate('LiveClips')}/>
    {data.key===scope&&data.setup?<Text style={{color:t.ink.secondary,marginTop:14}}>Live services are being prepared. Try again later.</Text>:null}{data.key===scope&&data.error?<Text accessibilityRole="alert" style={{color:t.ink.primary,marginTop:14}}>{data.error}</Text>:null}
  </>} renderItem={({item})=><TouchableOpacity accessibilityRole="button" accessibilityLabel={`${item.title}, ${liveStateLabel(item)}`} onPress={()=>navigation.navigate('LiveSession',{sessionId:item.id})} style={{gap:8}}><View style={{aspectRatio:16/9,borderRadius:16,overflow:'hidden',backgroundColor:t.surface.sunken,alignItems:'center',justifyContent:'center'}}>{item.thumbnail_url?<Image source={{uri:item.thumbnail_url}} style={{width:'100%',height:'100%'}} contentFit="cover"/>:<LiveIcon size={44} color={t.ink.muted}/>}<View style={{position:'absolute',top:12,left:12,borderRadius:6,paddingHorizontal:9,paddingVertical:5,backgroundColor:item.state==='live'?'#B92536':'#252525'}}><Text style={{fontSize:10,fontWeight:'800',color:'#fff'}}>{liveStateLabel(item)}</Text></View>{item.viewer_count!==null&&['live','reconnecting'].includes(item.state)?<Text style={{position:'absolute',bottom:10,right:10,backgroundColor:'#000B',padding:5,borderRadius:6,color:'#fff',fontSize:12}}>{item.viewer_count.toLocaleString()} watching</Text>:null}</View><Text numberOfLines={2} style={{fontSize:18,fontWeight:'700',color:t.ink.primary}}>{item.title}</Text><Text style={{color:t.ink.secondary,fontSize:13}}>{item.host.full_name||item.host.username||'Creator'}{item.host.is_verified?' ✓':''} · {item.topic}</Text>{item.scheduled_at?<Text style={{color:t.ink.secondary,fontSize:12}}>{new Date(item.scheduled_at).toLocaleString()}</Text>:null}</TouchableOpacity>} ListEmptyComponent={<View style={{minHeight:180,justifyContent:'center',alignItems:'center',padding:24}}>{loading?<ActivityIndicator color={t.ink.primary}/>:<><LiveIcon size={36} color={t.ink.muted}/><Text style={{color:t.ink.primary,fontWeight:'700',fontSize:17,marginTop:16}}>{data.error?'Streams could not load':data.setup?'Live is being prepared':query?'No matching streams':owner?'No streams right now':'Sign in to discover streams'}</Text><Text style={{color:t.ink.secondary,textAlign:'center',marginTop:8}}>{data.error?'Pull down to retry.':'Start your own live, or explore Upcoming and Replays.'}</Text>{owner&&!data.error&&!data.setup?<View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:12,marginTop:16}}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Start your first live" onPress={()=>navigation.navigate('NewLive')} style={{minHeight:44,paddingHorizontal:16,borderRadius:12,justifyContent:'center',backgroundColor:t.ink.primary}}><Text style={{color:t.surface.raised,fontWeight:'700'}}>Start live</Text></TouchableOpacity>{view!=='scheduled'?<TouchableOpacity accessibilityRole="button" accessibilityLabel="Browse upcoming streams" onPress={()=>{setFilter('for_you');setView('scheduled');}} style={{minHeight:44,paddingHorizontal:12,justifyContent:'center'}}><Text style={{color:t.ink.primary,fontWeight:'600'}}>See upcoming</Text></TouchableOpacity>:null}</View>:null}</>}</View>} ListFooterComponent={data.key===scope&&data.cursor?<TouchableOpacity accessibilityRole="button" disabled={loading} onPress={()=>void load(data.cursor)} style={{minHeight:46,alignItems:'center',justifyContent:'center'}}><Text style={{color:t.ink.primary,fontWeight:'600'}}>{loading?'Loading…':'Load more streams'}</Text></TouchableOpacity>:null}/></SafeAreaView>;
}
