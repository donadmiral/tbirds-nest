import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput, ActivityIndicator, useWindowDimensions, Platform, AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { hydrateMemoryAlbumMedia, withoutPrivateMedia } from '../services/contentMedia';
import { useAuthStore } from '../stores/authStore';
import { profileRead } from '../utils/profileRead';
import { useTheme } from '../theme/useTheme';
import { SafeAreaView } from './SafeArea';
import MemoryBookCover from './memory/MemoryBookCover';
import MemoryBookDesigner from './memory/MemoryBookDesigner';
import { MEMORY_COVER_COLORS, memoryCoverMedia, memoryAudienceLabel } from '../../shared/memoryBookDesign';
import type {MemoryBookshelf,MemoryBookSummary,MemoryBookNavigation} from '../../shared/memoryBookModels';
export const COVER_COLORS = MEMORY_COVER_COLORS;

export default function MemoryAlbumCard({ownerId,navigation}:{ownerId?:string|null;navigation:Pick<MemoryBookNavigation,'navigate'>}) {
 const {t,isDark}=useTheme(),{width}=useWindowDimensions();
 const [data,setData]=useState<MemoryBookshelf|null>(null),[error,setError]=useState(''),[creating,setCreating]=useState(false),[collection,setCollection]=useState(false),[query,setQuery]=useState(''),[filter,setFilter]=useState('All');
 const pendingCreate=useRef(false),pendingDestination=useRef<{ownerId:string;albumId:string}|null>(null);
 const viewerId=useAuthStore(state=>state.session?.user.id??null);
 const scope=useRef({ownerId,viewerId});
 if(scope.current.ownerId!==ownerId||scope.current.viewerId!==viewerId)scope.current={ownerId,viewerId};
 const epoch=useRef(0),loadedOwner=useRef<string|null>(null),loadedScope=useRef<typeof scope.current|null>(null);
 const pendingRead=useRef<{scope:typeof scope.current;promise:Promise<void>}|null>(null);
 const [loading,setLoading]=useState(true);
 const refresh=useCallback(()=>{
  const owner=scope.current;
  // Focus, foreground and a just-created book can all ask for the same read.
  // Share it instead of invalidating a successful response with another load.
  if(pendingRead.current?.scope===owner)return pendingRead.current.promise;
  const id=++epoch.current;
  const current=()=>scope.current===owner&&id===epoch.current;
  if(loadedScope.current!==owner){loadedOwner.current=ownerId??null;loadedScope.current=owner;setData(null);}
  setLoading(true);setError('');
  if(!ownerId||!viewerId){setLoading(false);return Promise.resolve();}
  const pending={scope:owner,promise:Promise.resolve()};
  pendingRead.current=pending;
  pending.promise=(async()=>{
   try{
    const {data:result,error:e}=await profileRead(supabase.rpc('get_memory_albums',{p_owner:ownerId}));
    if(!current())return;
    if(e||!result||!Array.isArray(result.books))throw e||Error('Memory books could not load. Tap to retry.');
    // Titles, counts and create/open controls are already server-authorized.
    // Never hold the entire shelf hostage to its separate cover signing step.
    setData({...result,books:withoutPrivateMedia(result.books)});
    setLoading(false);
    try{
     const books=await profileRead(hydrateMemoryAlbumMedia(result.books),25000);
     if(current())setData({...result,books});
    }catch{if(current())setError('Book covers could not load. Your books can still open. Tap to retry.');}
   }catch{if(current())setError('Memory books could not load. Tap to retry.');}
   finally{if(current())setLoading(false);if(pendingRead.current===pending)pendingRead.current=null;}
  })();
  return pending.promise;
 },[ownerId,viewerId]);
 useFocusEffect(useCallback(()=>{void refresh();const timer=setInterval(()=>{if(AppState.currentState==='active')void refresh();},240000);const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});return()=>{epoch.current++;pendingRead.current=null;clearInterval(timer);sub.remove();};},[refresh]));
 useEffect(()=>{pendingCreate.current=false;pendingDestination.current=null;setCreating(false);setCollection(false);},[ownerId,viewerId]);
 if(!ownerId)return null;
 const shelf=loadedScope.current===scope.current&&loadedOwner.current===ownerId?data:null;
 const books=(shelf?.books??[]).filter((b:MemoryBookSummary)=>shelf?.is_owner||b.count>0);
 if(shelf&&!error&&!shelf.is_owner&&!books.length)return null;
 const coverW=Math.min(280,(width-48)/2),coverH=coverW*1.31,serif=Platform.OS==='ios'?'Georgia':'serif';
 const finishNavigation=()=>{const target=pendingDestination.current;pendingDestination.current=null;if(target&&target.ownerId===ownerId)navigation.navigate('MemoryAlbum',target);};
 const open=(b:MemoryBookSummary)=>{if(collection&&Platform.OS==='ios'){pendingDestination.current={ownerId,albumId:b.id};setCollection(false);}else{setCollection(false);navigation.navigate('MemoryAlbum',{ownerId,albumId:b.id});}};
 const card=(b:MemoryBookSummary,audience=false)=><TouchableOpacity key={b.id} accessibilityRole="button" accessibilityLabel={`${b.title}, ${b.count} memories`} onPress={()=>open(b)} style={{width:coverW,marginBottom:12}}><MemoryBookCover artwork={b.cover_artwork} title={b.title} subtitle={b.subtitle} color={b.cover_color} design={b.cover_design} {...memoryCoverMedia(b.cover_page)} width={coverW} height={coverH}/><Text numberOfLines={1} style={{fontFamily:serif,fontSize:17,color:t.ink.primary,marginTop:10}}>{b.title}</Text><Text style={{fontSize:12,color:t.ink.secondary,marginTop:4}}>{audience?memoryAudienceLabel(b.audience):b.count+' '+(b.count===1?'memory':'memories')}</Text></TouchableOpacity>;
 const filtered=books.filter((b:MemoryBookSummary)=>(b.title+' '+(b.subtitle??'')).toLowerCase().includes(query.toLowerCase())&&(filter==='All'||(filter==='Public'?b.audience==='profile':b.audience!=='profile')));
 return <View style={{paddingTop:18,paddingBottom:14}}>
  <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,marginBottom:12}}><Text style={{fontSize:19,fontWeight:'700',color:t.ink.primary}}>Memory books</Text>{!!books.length&&<TouchableOpacity onPress={()=>setCollection(true)} accessibilityLabel="View all memory books" style={{minHeight:44,justifyContent:'center'}}><Text style={{fontSize:13,color:t.ink.secondary}}>View all</Text></TouchableOpacity>}</View>
  {!!error&&!creating&&<TouchableOpacity onPress={()=>void refresh()}><Text style={{color:t.ink.secondary,padding:16}}>{error}</Text></TouchableOpacity>}
  <View style={{flexDirection:'row',gap:16,paddingHorizontal:16,minHeight:!shelf&&loading?coverH+48:undefined}}>
   {!shelf&&loading&&<View accessibilityLabel="Loading memory books" style={{width:coverW,height:coverH,backgroundColor:t.surface.hairline,borderRadius:4,alignItems:'center',justifyContent:'center'}}><ActivityIndicator color={t.ink.secondary}/></View>}
   {books.slice(0,2).map((b:MemoryBookSummary)=>card(b))}
  </View>
  {shelf?.is_owner&&<TouchableOpacity onPress={()=>{setCreating(true);setError('');}} accessibilityLabel="Create memory book" style={{marginHorizontal:16,marginTop:4,minHeight:48,borderRadius:13,borderWidth:1,borderStyle:'dashed',borderColor:t.surface.hairline,flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center'}}><Feather name="plus" size={20} color={t.ink.primary}/><Text style={{color:t.ink.primary,fontSize:14}}>New book</Text></TouchableOpacity>}
  <Modal visible={collection} animationType="slide" onRequestClose={()=>setCollection(false)} onDismiss={()=>{if(pendingCreate.current){pendingCreate.current=false;setCreating(true);}else finishNavigation();}}><SafeAreaView style={{flex:1,backgroundColor:isDark?t.surface.canvas:'#FCFAF5'}}><View style={{flexDirection:'row',paddingHorizontal:16,alignItems:'center',justifyContent:'space-between',height:58}}><TouchableOpacity accessibilityLabel="Back to profile" onPress={()=>setCollection(false)} style={{padding:10}}><Feather name="chevron-left" size={24} color={t.ink.primary}/></TouchableOpacity><Text style={{fontFamily:serif,fontSize:24,color:t.ink.primary}}>Memory books</Text>{shelf?.is_owner?<TouchableOpacity accessibilityLabel="New memory book" onPress={()=>{if(Platform.OS==='ios')pendingCreate.current=true;setCollection(false);if(Platform.OS!=='ios')setCreating(true);}} style={{padding:10}}><Feather name="plus" size={24} color={t.ink.primary}/></TouchableOpacity>:<View style={{width:44}}/>}</View>
   <TextInput accessibilityLabel="Search memory books" value={query} onChangeText={setQuery} placeholder="Search your books" placeholderTextColor={t.ink.secondary} style={{marginHorizontal:18,marginBottom:16,borderRadius:24,paddingHorizontal:18,paddingVertical:12,backgroundColor:t.surface.hairline,color:t.ink.primary}}/>
   <View style={{marginHorizontal:18,marginBottom:20,flexDirection:'row',backgroundColor:t.surface.hairline,borderRadius:22}}>{['All','Public','Private'].map(f=><TouchableOpacity key={f} onPress={()=>setFilter(f)} accessibilityRole="tab" accessibilityState={{selected:filter===f}} style={{flex:1,alignItems:'center',padding:11,borderRadius:22,backgroundColor:filter===f?(isDark?t.brand.base:'#E7DDC7'):'transparent'}}><Text style={{color:filter===f&&isDark?'#FFF':t.ink.primary,fontWeight:filter===f?'700':'400'}}>{f}</Text></TouchableOpacity>)}</View>
   <ScrollView contentContainerStyle={{paddingHorizontal:16,paddingBottom:30}}><View style={{flexDirection:'row',flexWrap:'wrap',gap:16}}>{filtered.map((b:MemoryBookSummary)=>card(b,true))}</View>{!filtered.length&&<Text style={{textAlign:'center',color:t.ink.secondary,padding:30}}>No books match your search.</Text>}</ScrollView>
  </SafeAreaView></Modal>
  <MemoryBookDesigner visible={creating} ownerId={ownerId} onClose={()=>setCreating(false)} onDismiss={finishNavigation} onCreated={id=>{if(Platform.OS==='ios')pendingDestination.current={ownerId,albumId:id};setCreating(false);void refresh();if(Platform.OS!=='ios')navigation.navigate('MemoryAlbum',{ownerId,albumId:id});}}/>
 </View>;
}
