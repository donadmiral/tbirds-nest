import React,{useEffect,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import MemoryMovieExport from '../../src/components/memory/MemoryMovieExport';
import {useAuthStore} from '../../src/stores/authStore';
import type {MemoryBook} from '../../shared/memoryBookModels';
import {BOOK,OWNER,memoryBook} from './memory-fixture.cjs';
import {fixtureRuntime} from './fixture-runtime.cjs';
import {getStatus,subscribe} from './memory-capture-observer.cjs';

/** Registered only by the guarded disposable native UI preparation. The actual
 * AppNavigator supplies its real account, call and safe-area providers. */
export default function MemoryCaptureFixtureScreen(){
 const owner=useAuthStore(state=>state.session?.user.id);
 const [open,setOpen]=useState(false),[status,setStatus]=useState(getStatus);
 const [book]=useState(()=>memoryBook() as MemoryBook);
 useEffect(()=>subscribe(setStatus),[]);
 if(owner!==OWNER)throw new Error('The native capture fixture requires its signed-in synthetic owner.');
 const show=(memoryMode:'cancel'|'normal')=>{fixtureRuntime().configure({memoryMode});setOpen(true);};
 return <View style={s.root}><Text style={s.title}>Native capture acceptance</Text><Text style={s.status}>{status}</Text>
  <TouchableOpacity accessibilityRole="button" onPress={()=>show('cancel')} style={s.button}><Text>Open cancellation movie</Text></TouchableOpacity>
  <TouchableOpacity accessibilityRole="button" onPress={()=>show('normal')} style={s.button}><Text>Open complete movie</Text></TouchableOpacity>
  {open&&<MemoryMovieExport bookId={BOOK} expected={{title:book.title,pages:book.pages,filmSettings:book.film_settings,soundtrack:book.soundtrack,revision:book.presentation_revision}}
   originalAudio scoreVolume={.12} reduceMotion={false} onClose={()=>setOpen(false)}/>}
 </View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#142642',padding:30,justifyContent:'center',gap:20},title:{color:'#fff',fontSize:24},status:{color:'#fff',fontSize:16},button:{backgroundColor:'#e8d8b9',padding:18,borderRadius:12}});
