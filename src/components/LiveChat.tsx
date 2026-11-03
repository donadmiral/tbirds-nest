import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, AppState, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../theme/useTheme';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../services/supabase';
import { isLiveUuid } from '../../shared/liveDirectory';
import { liveCommand, liveObject, liveRequestId, liveRows, liveRpc, liveText, type LiveObject } from '../services/liveService';
import { subscribeLiveControl } from '../services/liveControlEvents';

type Props = { id: string; topic: string; enabled: boolean; canModerate: boolean; pinned: unknown; onChanged(): void; onUpdate(value:LiveObject):void };
export function LiveChat({ id, topic, enabled, canModerate, pinned, onChanged, onUpdate }: Props) {
  const { t } = useTheme(), focused = useIsFocused(), owner = useAuthStore(s => s.profile?.id ?? null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [rows, setRows] = useState<LiveObject[]>([]), [cursor, setCursor] = useState<LiveObject | null>(null), [body, setBody] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('Connecting chat…'), [revision, setRevision] = useState(0);
  const [subscriptionTopic,setSubscriptionTopic]=useState(topic);const update=useRef(onUpdate);update.current=onUpdate;
  const request = useRef<{ signature: string; id: string } | null>(null), lock = useRef(false), generation = useRef(0), refresh = useRef(onChanged); refresh.current = onChanged;
  useEffect(() => { const sub = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => sub.remove(); }, []);
  useEffect(()=>setSubscriptionTopic(topic),[topic]);
  useEffect(()=>{
    if(!owner||!focused||!foreground)return;
    return subscribeLiveControl(id,owner,(event,payload)=>{
      if(event==='access_changed') {
        if(typeof payload.chat_topic==='string'&&/^live:[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(payload.chat_topic)){setSubscriptionTopic(payload.chat_topic);update.current({chat_topic:payload.chat_topic});}
        if(payload.user_id===owner||!payload.chat_topic)refresh.current();
      }
      if(event==='session'&&liveObject(payload.session))update.current({session:payload.session});
    });
  },[id,owner,focused,foreground]);
  const load = async (before: LiveObject | null = null) => {
    const version = generation.current;
    try {
      const result = await liveRpc('live_messages', { p_session_id: id, p_before: before, p_limit: 50 });
      if (version !== generation.current) return;
      const page = liveRows(result.items, 50);
      setRows(previous => {
        const values = before ? [...page, ...previous] : [...page, ...previous];
        return [...new Map(values.filter(row => isLiveUuid(row.id) && row.session_id === id).map(row => [row.id, row])).values()].sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id))).slice(before ? 0 : -150, before ? 150 : undefined);
      });
      setCursor(liveObject(result.next_cursor) ? result.next_cursor : null); setError('');
    } catch (reason) { if (version === generation.current) setError(reason instanceof Error ? reason.message : 'Chat could not load. Retry when connected.'); }
  };
  useEffect(() => {
    generation.current++; setRows([]); setCursor(null); setError('');
    if (!owner || !focused || !foreground || !/^live:[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(subscriptionTopic)) return;
    const version = generation.current;
    const channel = supabase.channel(subscriptionTopic, { config: { private: true } });
    channel.on('broadcast', { event: 'message' }, event => {
      const row: unknown = event.payload;
      if (version !== generation.current || !liveObject(row) || !isLiveUuid(row.id) || row.session_id !== id) return;
      setRows(previous => [...previous.filter(value => value.id !== row.id), row].slice(-150));
    }).on('broadcast', { event: 'message_removed' }, event => {
      if (version === generation.current && liveObject(event.payload)) setRows(previous => previous.map(row => row.id === event.payload.id ? { ...row, body: '', removed: true } : row));
    }).on('broadcast', { event: 'pin' }, event => { if (version === generation.current && liveObject(event.payload)) update.current({pinned_message:event.payload.message}); })
      .on('broadcast', { event: 'session' }, event => { if (version === generation.current&&liveObject(event.payload)) update.current(event.payload); });
    channel.subscribe(state => {
      if (version !== generation.current) return;
      if (state === 'SUBSCRIBED') { setStatus('Connected'); void load(); }
      else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') setStatus('Chat disconnected. Tap reconnect.');
    });
    return () => { generation.current++; void supabase.removeChannel(channel); };
  }, [owner, id, subscriptionTopic, focused, foreground, revision]);
  const send = async (action: string, payload: LiveObject) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    const signature = JSON.stringify([id,action,payload]); if (request.current?.signature !== signature) request.current = { signature, id: liveRequestId() };
    try { await liveCommand(action,id,payload,request.current.id); request.current = null; if (action === 'chat') setBody(''); if (['pin','chat_settings','remove_message'].includes(action)) onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The message was not sent. Retry when connected.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const button = (label: string, action: () => void, disabled = busy) => <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={action} style={[s.button,{ backgroundColor:t.surface.sunken, opacity:disabled?.5:1 }]}><Text style={{color:t.ink.primary,fontSize:13,fontWeight:'600'}}>{label}</Text></TouchableOpacity>;
  return <View style={{gap:10}}>
    <View style={s.row}><Text style={{color:t.ink.primary,fontSize:19,fontWeight:'700',flex:1}}>Live chat</Text>{button(status === 'Connected' ? 'Refresh' : 'Reconnect',()=>setRevision(v=>v+1),false)}</View>
    <Text accessibilityLiveRegion="polite" style={{color:t.ink.secondary,fontSize:12}}>{status}</Text>
    {liveObject(pinned) && liveText(pinned.body) ? <View style={[s.pinned,{backgroundColor:t.surface.sunken}]}><Text style={{color:t.ink.secondary,fontSize:11,fontWeight:'700'}}>PINNED MESSAGE</Text><Text style={{color:t.ink.primary,marginTop:4}}>{liveText(pinned.body,500)}</Text></View> : null}
    {cursor ? button('Earlier messages',()=>void load(cursor)) : null}
    <FlatList style={{height:340}} nestedScrollEnabled data={rows} keyExtractor={item=>String(item.id)} contentContainerStyle={{gap:10,paddingVertical:8}} renderItem={({item})=><View style={{paddingVertical:3}}><Text style={{color:t.ink.primary,lineHeight:20}}><Text style={{fontWeight:'700'}}>{liveObject(item.author)?liveText(item.author.full_name||item.author.username,100):'Member'} </Text>{item.removed===true?'Message removed':liveText(item.body,500)}</Text>{canModerate && item.removed!==true?<View style={s.row}>{button('Pin',()=>void send('pin',{message_id:item.id}))}{button('Remove',()=>void send('remove_message',{message_id:item.id}))}</View>:null}</View>} ListEmptyComponent={<Text style={{color:t.ink.secondary,textAlign:'center',padding:24}}>Messages will appear here.</Text>}/>
    <View style={s.row}><TextInput value={body} onChangeText={setBody} maxLength={500} editable={enabled&&!busy} placeholder={enabled?'Send a message':'Chat is currently closed'} placeholderTextColor={t.ink.muted} accessibilityLabel="Live chat message" style={[s.input,{color:t.ink.primary,backgroundColor:t.surface.sunken,flex:1}]} multiline/>{button('Send',()=>void send('chat',{body:body.trim()}),!enabled||busy||!body.trim())}</View>
    <View style={s.row}>{[['heart','Heart'],['applause','Applause'],['fire','Fire']].map(([reaction,label])=><React.Fragment key={reaction}>{button(label,()=>void send('reaction',{reaction}),busy||!enabled)}</React.Fragment>)}</View>
    {canModerate?<View style={s.row}>{button('Slow mode',()=>void send('chat_settings',{slow_mode_seconds:10}))}{button('Open chat',()=>void send('chat_settings',{chat_mode:'open',slow_mode_seconds:0}))}{button('Close chat',()=>void send('chat_settings',{chat_mode:'closed'}))}</View>:null}
    {error?<Text accessibilityRole="alert" style={{color:t.ink.primary}}>{error}</Text>:null}
  </View>;
}
const s=StyleSheet.create({row:{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},button:{minHeight:44,minWidth:44,borderRadius:20,paddingHorizontal:12,justifyContent:'center',alignItems:'center'},input:{minHeight:44,maxHeight:110,borderRadius:12,paddingHorizontal:12,paddingVertical:10},pinned:{borderRadius:12,padding:12}});
