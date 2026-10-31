import React,{useEffect,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import MemoryMovieExport from '../../src/components/memory/MemoryMovieExport';
import {useAuthStore} from '../../src/stores/authStore';
import {useAccountsStore} from '../../src/stores/accountsStore';
import type {MemoryBook} from '../../shared/memoryBookModels';
import {BOOK,OWNER,memoryBook} from './memory-fixture.cjs';
import {fixtureRuntime} from './fixture-runtime.cjs';
import {getStatus,subscribe} from './memory-capture-observer.cjs';
import {readSavedAccount} from './account-readback.cjs';

/** Registered only by the guarded disposable native UI preparation. The actual
 * AppNavigator supplies its real account, call and safe-area providers. */
export default function MemoryCaptureFixtureScreen(){
 const owner=useAuthStore(state=>state.session?.user.id);
 const [open,setOpen]=useState(false),[status,setStatus]=useState(getStatus);
 const [book]=useState(()=>memoryBook() as MemoryBook);
 const [accountReadback,setAccountReadback]=useState<boolean|null>(null);
 useEffect(()=>subscribe(setStatus),[]);
 useEffect(()=>{
  let alive=true;
  void readSavedAccount({authStore:useAuthStore,accountsStore:useAccountsStore})
   .then((result:{passed:boolean;reloaded:boolean;accountCount:number})=>{
    fixtureRuntime().recordAccountReadback(result);
    if(alive)setAccountReadback(result.passed);
   }).catch(()=>{
    fixtureRuntime().recordAccountReadback({passed:false,reloaded:false,accountCount:0});
    if(alive)setAccountReadback(false);
   });
  return()=>{alive=false;};
 },[]);
 if(owner!==OWNER)throw new Error('The native capture fixture requires its signed-in synthetic owner.');
 const show=(memoryMode:'cancel'|'normal')=>{fixtureRuntime().configure({memoryMode});setOpen(true);};
 return <View style={s.root}><Text style={s.title}>Native capture acceptance</Text><Text style={s.status}>{status}</Text>
  <Text style={s.status}>{accountReadback===null?'Checking saved account storage…':accountReadback?'Saved account readback passed':'Saved account readback failed'}</Text>
  <TouchableOpacity accessibilityRole="button" onPress={()=>show('cancel')} style={s.button}><Text>Open cancellation movie</Text></TouchableOpacity>
  <TouchableOpacity accessibilityRole="button" onPress={()=>show('normal')} style={s.button}><Text>Open complete movie</Text></TouchableOpacity>
  {open&&<MemoryMovieExport bookId={BOOK} expected={{title:book.title,pages:book.pages,filmSettings:book.film_settings,soundtrack:book.soundtrack,revision:book.presentation_revision}}
   originalAudio scoreVolume={.12} reduceMotion={false} onClose={()=>setOpen(false)}/>}
 </View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#142642',padding:30,justifyContent:'center',gap:20},title:{color:'#fff',fontSize:24},status:{color:'#fff',fontSize:16},button:{backgroundColor:'#e8d8b9',padding:18,borderRadius:12}});
