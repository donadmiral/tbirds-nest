import React,{useEffect,useRef,useState} from 'react';
import { Text,TextInput,TouchableOpacity,View } from 'react-native';
import 'react-native-get-random-values';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { themedSheet,useTheme } from '../theme/useTheme';
import { requestCreatorPayout } from '../../shared/monetization/client';
import { formatMinor,payoutBlockReason,usdToMinor,validMinor,type CreatorSnapshot } from '../../shared/monetization/domain';
type Intent={key:string;amount:string};
function key(){const b=new Uint8Array(16);globalThis.crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export default function CreatorPayoutForm({snapshot,onChanged}:{snapshot:CreatorSnapshot;onChanged:()=>Promise<void>}) {
  useTheme();const owner=snapshot.user_id;const current=useRef(owner);current.current=owner;
  const generation=useRef(0),lock=useRef(false);const [amount,setAmount]=useState(''),[review,setReview]=useState<string|null>(null),[intent,setIntent]=useState<Intent|null>(null);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const storageKey='creator_payout_intent_'+owner;
  useEffect(()=>{const run=++generation.current;setReady(false);setIntent(null);setReview(null);setAmount('');setError('');setNotice('');setBusy(false);lock.current=false;
    void SecureStore.getItemAsync(storageKey).then(raw=>{if(run!==generation.current)return;if(raw){const p=JSON.parse(raw) as Intent;if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.key)||!validMinor(p.amount,true))throw Error('invalid');setIntent(p);}setReady(true);}).catch(()=>{if(run===generation.current)setError('Your saved payout request could not be checked. Reopen this page or contact support.');});
    return()=>{generation.current++;};
  },[storageKey]);
  const blocked=payoutBlockReason(snapshot);const available=snapshot.balances.find(b=>b.currency==='USD'&&b.bucket==='available')?.amount_minor||'0';
  function prepare(){try{const n=usdToMinor(amount);if(BigInt(n)>BigInt(available))throw Error('Enter an amount within your available earnings.');setReview(n);setError('');}catch(e){setError(e instanceof Error?e.message:'Check the payout amount.');}}
  async function submit(){if(lock.current||!ready||(blocked&&!intent)||(!intent&&!review))return;const actor=owner,run=generation.current;const valid=()=>current.current===actor&&run===generation.current;
    const pending=intent||{key:key(),amount:review!};lock.current=true;setBusy(true);setError('');setNotice('');
    try{
      if(useAuthStore.getState().session?.user.id!==actor)throw Error('Your account changed. Reopen monetization.');
      await SecureStore.setItemAsync(storageKey,JSON.stringify(pending));if(!valid())return;setIntent(pending);
      await requestCreatorPayout(supabase,actor,pending.amount,pending.key);
      await SecureStore.deleteItemAsync(storageKey);if(!valid())return;setIntent(null);setReview(null);setAmount('');setNotice('Your payout request is recorded. It is paid only after IntoBank confirms the credit.');await onChanged();
    }catch(e){if(!valid())return;if((e as {confirmedRejected?:boolean})?.confirmedRejected){await SecureStore.deleteItemAsync(storageKey).catch(()=>{});setIntent(null);setReview(null);}setError(e instanceof Error?e.message:'Your payout request was not confirmed. Retry the saved request.');}
    finally{if(valid()){setBusy(false);lock.current=false;}}
  }
  if(blocked&&!intent)return null;
  return <View style={s.container}>
    {snapshot.environment==='test'&&<Text style={s.note}>Sandbox payout. No real money will be transferred.</Text>}
    <Text style={s.note}>Available: {formatMinor(available,'USD')}</Text>
    {intent?<Text style={s.text}>Check saved request for {formatMinor(intent.amount,'USD')}. Retrying uses the same request and cannot create a second reservation.</Text>:review?<Text style={s.text}>Request {formatMinor(review,'USD')} to your verified IntoBank payout account?</Text>:<TextInput accessibilityLabel="Payout amount in USD" placeholder="Amount in USD" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" editable={ready&&!busy} style={s.input}/>}
    {error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}{notice&&<Text accessibilityRole="alert" style={s.text}>{notice}</Text>}
    <TouchableOpacity accessibilityRole="button" disabled={!ready||busy} style={s.button} onPress={()=>intent||review?void submit():prepare()}><Text style={s.buttonText}>{busy?'Checking…':intent?'Retry saved request':review?'Confirm payout':'Review payout'}</Text></TouchableOpacity>
    {review&&!intent&&!busy&&<TouchableOpacity accessibilityRole="button" style={s.cancel} onPress={()=>setReview(null)}><Text style={s.text}>Edit amount</Text></TouchableOpacity>}
  </View>;
}
const s=themedSheet(t=>({container:{gap:10},text:{color:t.ink.primary,fontSize:14,lineHeight:20},note:{color:t.ink.muted,fontSize:13,lineHeight:20},input:{minHeight:48,borderWidth:1,borderColor:t.surface.hairline,borderRadius:12,padding:12,color:t.ink.primary},error:{color:t.status.danger,fontSize:14},button:{minHeight:48,padding:12,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:t.brand.base},buttonText:{color:t.ink.inverse,fontWeight:'700'},cancel:{minHeight:44,justifyContent:'center'}}));
