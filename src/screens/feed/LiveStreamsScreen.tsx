import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from '../../components/SafeArea';
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import { profileRead } from '../../utils/profileRead';
import { LIVE_TOPICS, isLiveSetupMissing, liveStateLabel, parseLiveDirectory, type LiveFilter, type LiveSession, type LiveView } from '../../../shared/liveDirectory';
export default function LiveStreamsScreen({ navigation }: { navigation: { goBack(): void } }) {
  const { t } = useTheme();
  const owner = useAuthStore(state => state.profile?.id ?? null);
  const [filter,setFilter] = useState<LiveFilter>('for_you'), [view,setView] = useState<LiveView>('live'), [topic,setTopic] = useState('all');
  const [data,setData] = useState<{key:string;items:LiveSession[];setup:boolean;error:string|null}>({key:'',items:[],setup:false,error:null});
  const [loading,setLoading] = useState(false),[retry,setRetry] = useState(0);
  const scope = `${owner}:${filter}:${view}:${topic}`, current=useRef(scope);current.current=scope;
  useEffect(()=>{
    let active=true;setLoading(true);
    if(!owner){setLoading(false);return;}
    void profileRead(supabase.rpc('live_directory',{p_filter:filter,p_topic:topic==='all'?null:topic,p_state:view,p_cursor:null,p_limit:24})).then(result=>{
      if(!active||current.current!==scope)return;
      const {data:rows,error}=result as {data:unknown;error:unknown};
      if(error){if(isLiveSetupMissing(error)){setData({key:scope,items:[],setup:true,error:null});return;}throw error;}
      const page=parseLiveDirectory(rows);setData({key:scope,items:page.items,setup:!page.capabilities.broadcast,error:null});
    }).catch(()=>{if(active&&current.current===scope)setData({key:scope,items:[],setup:false,error:'Live streams could not load. Pull down to retry.'});}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[owner,filter,view,topic,scope,retry]);
  const visible=data.key===scope?data.items:[];
  const chips=(values:readonly (readonly [string,string])[],selected:string,choose:(value:string)=>void)=><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8,paddingVertical:8}}>{values.map(([id,label])=><TouchableOpacity key={id} accessibilityRole="button" accessibilityState={{selected:selected===id}} onPress={()=>choose(id)} style={{minHeight:44,paddingHorizontal:14,justifyContent:'center',borderRadius:22,backgroundColor:selected===id?t.ink.primary:t.surface.sunken}}><Text style={{color:selected===id?t.surface.raised:t.ink.secondary,fontSize:13,fontWeight:'600'}}>{label}</Text></TouchableOpacity>)}</ScrollView>;
  return <SafeAreaView style={{flex:1,backgroundColor:t.surface.raised}}><View style={{paddingHorizontal:16,flex:1}}>
    <View style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10}}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to feed" onPress={()=>navigation.goBack()} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Feather name="chevron-left" size={24} color={t.ink.primary}/></TouchableOpacity><Feather name="radio" size={23} color={t.ink.primary}/><Text style={{fontSize:24,fontWeight:'800',color:t.ink.primary}}>Live streams</Text></View>
    <Text style={{color:t.ink.secondary,fontSize:14,marginBottom:8}}>Creators, conversations and events.</Text>
    <View>{chips([['for_you','For you'],['following','Following'],['followers','Followers'],['mine','My streams']],filter,v=>setFilter(v as LiveFilter))}{chips(LIVE_TOPICS,topic,setTopic)}{chips([['live','Live now'],['scheduled','Upcoming'],['replay','Replays']],view,v=>setView(v as LiveView))}</View>
    {data.key===scope&&data.setup?<View style={{backgroundColor:t.surface.sunken,padding:14,borderRadius:12,marginVertical:12}}><Text style={{color:t.ink.primary,fontWeight:'700'}}>Broadcasting is not connected yet</Text><Text style={{color:t.ink.secondary,fontSize:13,marginTop:6}}>The Live page is available. The video service must be connected before broadcasting or viewing.</Text></View>:null}
    {data.key===scope&&data.error?<Text accessibilityRole="alert" style={{color:t.ink.primary,padding:14}}>{data.error}</Text>:null}
    <FlatList data={visible} keyExtractor={item=>item.id} refreshing={loading} onRefresh={()=>setRetry(v=>v+1)} contentContainerStyle={{paddingBottom:100,gap:12,flexGrow:1}} renderItem={({item})=><TouchableOpacity accessibilityRole="link" accessibilityLabel={`${item.title}, open stream details on the web`} onPress={()=>{void Linking.openURL(`https://platinumcircles.app/live/${item.id}`).catch(()=>setData(previous=>({...previous,error:'Could not open the stream page.'})));}} style={{padding:16,borderRadius:16,backgroundColor:t.surface.sunken}}><Text style={{fontSize:11,fontWeight:'800',color:t.ink.secondary}}>{liveStateLabel(item)}</Text><Text style={{fontSize:18,fontWeight:'700',color:t.ink.primary,marginTop:8}}>{item.title}</Text><Text style={{color:t.ink.secondary,marginTop:5}}>{item.host.full_name||item.host.username||'Creator'} · {item.topic}</Text><Text style={{color:t.ink.secondary,fontSize:12,marginTop:12}}>View details on the web</Text></TouchableOpacity>} ListEmptyComponent={<View style={{flex:1,minHeight:180,justifyContent:'center',alignItems:'center',padding:24}}>{loading?<ActivityIndicator color={t.ink.primary}/>:<><Feather name="radio" size={36} color={t.ink.muted}/><Text style={{color:t.ink.primary,fontWeight:'700',fontSize:17,marginTop:16}}>{owner?'No streams here yet':'Sign in to discover streams'}</Text><Text style={{color:t.ink.secondary,textAlign:'center',marginTop:8}}>Try another topic or check back for a live session.</Text></>}</View>}/>
  </View></SafeAreaView>;
}
