import React,{useEffect,useMemo,useSyncExternalStore} from 'react';
import {Text,TouchableOpacity,View} from 'react-native';
import {supabase} from '../services/supabase';
import {createHostFollow,emptyHostFollow,followHostAction,followHostLabel} from '../../shared/liveHostFollow';
export function LiveHostFollow({owner,host,sessionId,onChange}:{owner:string;host:string;sessionId:string;onChange():void}) {
  const model=useMemo(()=>createHostFollow(owner,host,sessionId,(fn,args)=>supabase.rpc(fn,args),async()=>(await supabase.auth.getSession()).data.session?.user.id??null),[owner,host,sessionId]);
  const s=useSyncExternalStore(model.subscribe,model.snapshot,()=>emptyHostFollow);
  useEffect(()=>model.mount(),[model]);
  if(s.status==='hidden'||s.status==='loading')return null;
  return <View style={{flexShrink:1}}><TouchableOpacity accessibilityRole="button" accessibilityLabel={followHostAction(s.status)} accessibilityState={{busy:s.busy,disabled:s.busy}} disabled={s.busy} style={{minHeight:44,justifyContent:'center',paddingHorizontal:10}} onPress={async()=>{if(await model.toggle())onChange();}}><Text style={{color:'#fff',fontWeight:'700'}}>{followHostLabel(s.status)}</Text></TouchableOpacity>{s.error?<Text accessibilityLiveRegion="polite" style={{color:'#fff',fontSize:11}}>Could not confirm follow status.</Text>:null}</View>;
}
