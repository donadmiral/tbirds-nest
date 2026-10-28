import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/useTheme';
import MemoryBookCover from './memory/MemoryBookCover';
import { MEMORY_COVER_COLORS, MEMORY_DESIGNS } from '../../shared/memoryBookDesign';
export const COVER_COLORS = MEMORY_COVER_COLORS;

export default function MemoryAlbumCard({ownerId,navigation}:{ownerId?:string|null;navigation:any}) {
 const {t}=useTheme();
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[creating,setCreating]=useState(false),[title,setTitle]=useState(''),[color,setColor]=useState('blush'),[design,setDesign]=useState('keepsake'),[busy,setBusy]=useState(false);
 const epoch=useRef(0),saving=useRef(false),viewer=useRef<string|null|undefined>(undefined);
 const refresh=useCallback(async()=>{const id=++epoch.current;setData(null);setError('');if(!ownerId)return;try{const {data:result,error:e}=await supabase.rpc('get_memory_albums',{p_owner:ownerId});if(e)throw e;if(id===epoch.current)setData(result);}catch{if(id===epoch.current)setError('Memory books could not load. Tap to retry.');}},[ownerId]);
 useFocusEffect(useCallback(()=>{void refresh();return()=>{epoch.current++;};},[refresh]));
 useEffect(()=>{const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{const next=session?.user.id??null;if(viewer.current===next)return;viewer.current=next;epoch.current++;setData(null);setCreating(false);void refresh();});return()=>subscription.unsubscribe();},[refresh]);
 const create=async()=>{if(!title.trim()||saving.current)return;saving.current=true;setBusy(true);setError('');const id=epoch.current;try{const {data:session}=await supabase.auth.getSession();if(session.session?.user.id!==ownerId)throw Error();const {data:book,error:e}=await supabase.rpc('create_memory_book_design',{p_title:title.trim(),p_cover_color:color,p_cover_design:design});if(e||!book)throw e||Error();if(id!==epoch.current)return;setCreating(false);setTitle('');void refresh();navigation.navigate('MemoryAlbum',{ownerId,albumId:book});}catch{if(id===epoch.current)setError('Could not create the book. Your choices are kept.');}finally{saving.current=false;setBusy(false);}};
 if(!ownerId)return null;
 const books=(data?.books??[]).filter((b:any)=>data.is_owner||b.count>0);
 if(!data&&!error)return null;
 return <View style={{paddingVertical:10}}>
  <Text style={{fontSize:13.5,fontWeight:'800',color:t.ink.primary,paddingHorizontal:16,marginBottom:8}}>Memory books</Text>
  {!!error&&!creating&&<TouchableOpacity onPress={()=>void refresh()}><Text style={{color:t.ink.secondary,padding:16}}>{error}</Text></TouchableOpacity>}
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal:16,gap:16,alignItems:'flex-start'}}>
   {books.map((b:any)=><TouchableOpacity key={b.id} accessibilityRole="button" accessibilityLabel={`${b.title}, ${b.count} memories`} onPress={()=>navigation.navigate('MemoryAlbum',{ownerId,albumId:b.id})} style={{alignItems:'center',width:70}}><MemoryBookCover title={b.title} color={b.cover_color} design={b.cover_design}/><Text numberOfLines={1} style={{fontSize:10.5,fontWeight:'700',color:t.ink.primary,marginTop:6,maxWidth:70}}>{b.title}</Text><Text style={{fontSize:9.5,color:t.ink.secondary,marginTop:1}}>{b.count} {b.count===1?'memory':'memories'}</Text></TouchableOpacity>)}
   {data?.is_owner&&<TouchableOpacity onPress={()=>{setCreating(true);setError('');}} accessibilityLabel="Create memory book" style={{width:70,alignItems:'center'}}><View style={{width:62,height:78,borderRadius:8,borderWidth:1.5,borderStyle:'dashed',borderColor:t.surface.hairline,alignItems:'center',justifyContent:'center'}}><Feather name="plus" size={18} color={t.ink.secondary}/></View><Text style={{fontSize:10.5,color:t.ink.secondary,marginTop:6}}>New book</Text></TouchableOpacity>}
  </ScrollView>
  <Modal visible={creating} transparent animationType="fade" onRequestClose={()=>{if(!busy)setCreating(false);}}><View style={{flex:1,backgroundColor:'rgba(0,0,0,.5)',justifyContent:'center',padding:24}}><View style={{backgroundColor:t.surface.canvas,borderRadius:20,padding:18,maxHeight:'85%'}}><ScrollView keyboardShouldPersistTaps="handled"><Text style={{fontSize:18,fontWeight:'800',color:t.ink.primary}}>New memory book</Text><TextInput value={title} onChangeText={setTitle} maxLength={40} placeholder="Happy moments" placeholderTextColor={t.ink.secondary} style={{color:t.ink.primary,borderWidth:1,borderColor:t.surface.hairline,borderRadius:10,padding:12,marginVertical:14}}/>
   <ScrollView horizontal contentContainerStyle={{gap:14,padding:7}}>{MEMORY_DESIGNS.map(d=><TouchableOpacity key={d.id} onPress={()=>setDesign(d.id)} accessibilityLabel={`${d.label}${design===d.id?', selected':''}`} style={{opacity:design===d.id?1:.55}}><MemoryBookCover title={title||'Memories'} color={color} design={d.id}/><Text style={{fontSize:10,color:t.ink.primary,marginTop:6}}>{d.label}</Text></TouchableOpacity>)}</ScrollView>
   <View style={{flexDirection:'row',flexWrap:'wrap',gap:12,marginVertical:18}}>{Object.entries(COVER_COLORS).map(([k,c])=><TouchableOpacity key={k} onPress={()=>setColor(k)} accessibilityLabel={`${k} cover`} style={{width:28,height:28,borderRadius:14,backgroundColor:c.cover,borderWidth:color===k?3:1,borderColor:color===k?t.ink.primary:t.surface.hairline}}/>)}</View>
   {!!error&&<Text style={{color:t.ink.secondary,marginBottom:12}}>{error}</Text>}
   <View style={{flexDirection:'row',justifyContent:'flex-end',gap:24}}><TouchableOpacity disabled={busy} onPress={()=>setCreating(false)}><Text style={{color:t.ink.secondary}}>Cancel</Text></TouchableOpacity><TouchableOpacity disabled={busy||!title.trim()} onPress={()=>void create()}>{busy?<ActivityIndicator/>:<Text style={{fontWeight:'800',color:t.ink.primary}}>Create</Text>}</TouchableOpacity></View>
  </ScrollView></View></View></Modal>
 </View>;
}
