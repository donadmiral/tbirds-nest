import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, AppState, StyleSheet, Alert } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../theme/useTheme';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../services/supabase';
import { isLiveUuid } from '../../shared/liveDirectory';
import { liveCommand, liveObject, liveRequestId, liveRows, liveRpc, liveText, type LiveObject } from '../services/liveService';
import { subscribeLiveControl } from '../services/liveControlEvents';

type Props = { id: string; topic: string; enabled: boolean; canModerate: boolean; pinned: unknown; onChanged(): void; onUpdate(value:LiveObject):void; overlay?: boolean; compact?: boolean; collapseHistory?: boolean; footer?: React.ReactNode };
export function LiveChat({ id, topic, enabled, canModerate, pinned, onChanged, onUpdate, overlay = false, compact = false, collapseHistory = false, footer }: Props) {
  const { t } = useTheme(), focused = useIsFocused(), owner = useAuthStore(s => s.profile?.id ?? null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [rows, setRows] = useState<LiveObject[]>([]), [cursor, setCursor] = useState<LiveObject | null>(null), [body, setBody] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('Connecting chat…'), [revision, setRevision] = useState(0);
  const [showLatest, setShowLatest] = useState(false), [historyOpen,setHistoryOpen] = useState(!collapseHistory);
  useEffect(()=>setHistoryOpen(!collapseHistory),[compact,collapseHistory]);
  const input = useRef<TextInput>(null);
  const list = useRef<FlatList<LiveObject>>(null), followLatest = useRef(true), removedIds = useRef(new Set<string>());
  const [subscriptionTopic,setSubscriptionTopic]=useState(topic);const update=useRef(onUpdate);update.current=onUpdate;
  // Pin events can arrive before the parent renders its new pinned prop.
  const currentPin = useRef(pinned); currentPin.current = pinned;
  const request = useRef<{ signature: string; id: string } | null>(null), lock = useRef(false), generation = useRef(0), historyGeneration = useRef(0), commandGeneration = useRef(0), hasConnected = useRef(false), refresh = useRef(onChanged); refresh.current = onChanged;
  useEffect(() => { const sub = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => sub.remove(); }, []);
  useEffect(() => {
    commandGeneration.current++; request.current = null; lock.current = false; setBusy(false); setBody('');
    removedIds.current.clear(); followLatest.current = true; setShowLatest(false); hasConnected.current = false;
    return () => { commandGeneration.current++; };
  }, [id, owner]);
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
  const rememberRemoval = (messageId: string) => {
    removedIds.current.add(messageId);
    if (removedIds.current.size > 300) removedIds.current.delete(removedIds.current.values().next().value!);
  };
  const mergeRows = (previous: LiveObject[], incoming: LiveObject[], before = false) => {
    const merged = new Map<string, LiveObject>();
    for (const row of [...incoming, ...previous]) {
      if (!isLiveUuid(row.id) || row.session_id !== id) continue;
      const removed = row.removed === true || merged.get(row.id)?.removed === true || removedIds.current.has(row.id);
      merged.set(row.id, removed ? { ...row, removed: true, body: '' } : row);
    }
    return [...merged.values()].sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id))).slice(before ? 0 : -150, before ? 150 : undefined);
  };
  const load = async (before: LiveObject | null = null) => {
    const version = generation.current, historyVersion = historyGeneration.current;
    try {
      const result = await liveRpc('live_messages', { p_session_id: id, p_before: before, p_limit: 50 });
      if (version !== generation.current || historyVersion !== historyGeneration.current) return;
      const page = liveRows(result.items, 50);
      for (const row of page) if (isLiveUuid(row.id) && row.session_id === id && row.removed === true) rememberRemoval(row.id);
      setRows(previous => mergeRows(previous, page, !!before));
      setCursor(liveObject(result.next_cursor) ? result.next_cursor : null); setError('');
    } catch (reason) { if (version === generation.current && historyVersion === historyGeneration.current) setError(reason instanceof Error ? reason.message : 'Chat could not load. Retry when connected.'); }
  };
  useEffect(() => {
    generation.current++; setRows([]); setCursor(null); setError('');
    if (!owner || !focused || !foreground || !/^live:[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(subscriptionTopic)) return;
    const version = generation.current;
    const channel = supabase.channel(subscriptionTopic, { config: { private: true } });
    channel.on('broadcast', { event: 'message' }, event => {
      const row: unknown = event.payload;
      if (version !== generation.current || !liveObject(row) || !isLiveUuid(row.id) || row.session_id !== id) return;
      if (row.removed === true) rememberRemoval(row.id);
      setRows(previous => mergeRows(previous, [row]));
    }).on('broadcast', { event: 'message_removed' }, event => {
      if (version !== generation.current || !liveObject(event.payload) || !isLiveUuid(event.payload.id)) return;
      rememberRemoval(event.payload.id);
      setRows(previous => previous.map(row => row.id === event.payload.id ? { ...row, body: '', removed: true } : row));
      const pinnedMessage = currentPin.current;
      if (liveObject(pinnedMessage) && pinnedMessage.id === event.payload.id) {
        currentPin.current = null;
      }
      update.current({ removed_message_id: event.payload.id });
    }).on('broadcast', { event: 'pin' }, event => {
      if (version !== generation.current || !liveObject(event.payload)) return;
      const message = event.payload.message;
      const nextPin = liveObject(message) && (message.removed === true || removedIds.current.has(String(message.id))) ? null : message;
      currentPin.current = nextPin; update.current({ pinned_message: nextPin });
    })
      .on('broadcast', { event: 'session' }, event => { if (version === generation.current&&liveObject(event.payload)) update.current(event.payload); });
    channel.subscribe(state => {
      if (version !== generation.current) return;
      if (state === 'SUBSCRIBED') {
        const reconnecting = hasConnected.current; hasConnected.current = true;
        historyGeneration.current++; setRows([]); setCursor(null); setError('');
        setStatus('Connected'); void load();
        if (reconnecting) refresh.current();
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
        historyGeneration.current++; setRows([]); setCursor(null);
        setStatus('Chat disconnected. Tap reconnect.');
      }
    });
    return () => { generation.current++; void supabase.removeChannel(channel); };
  }, [owner, id, subscriptionTopic, focused, foreground, revision]);
  const send = async (action: string, payload: LiveObject) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    const version = commandGeneration.current;
    const signature = JSON.stringify([id,action,payload]); if (request.current?.signature !== signature) request.current = { signature, id: liveRequestId() };
    try { await liveCommand(action,id,payload,request.current.id); if (version !== commandGeneration.current) return; request.current = null; if (action === 'chat') setBody(''); if (action === 'remove_message' && isLiveUuid(payload.message_id)) { rememberRemoval(payload.message_id); setRows(previous => previous.map(row => row.id === payload.message_id ? { ...row, body: '', removed: true } : row)); } if (['pin','chat_settings','remove_message'].includes(action)) onChanged(); }
    catch (reason) { if (version === commandGeneration.current) setError(reason instanceof Error ? reason.message : 'The message was not sent. Retry when connected.'); }
    finally { if (version === commandGeneration.current) { lock.current = false; setBusy(false); } }
  };
  const button = (label: string, action: () => void, disabled = busy) => <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={action} style={[s.button,{ backgroundColor:t.surface.sunken, opacity:disabled?.5:1 }]}><Text style={{color:t.ink.primary,fontSize:13,fontWeight:'600'}}>{label}</Text></TouchableOpacity>;
  const messageActions = (item: LiveObject) => {
    if (item.removed === true) return;
    const author = liveObject(item.author) ? liveText(item.author.username || item.author.full_name, 100) : 'Member';
    Alert.alert(author, liveText(item.body,500), [
      { text:'Reply', onPress:()=>{setBody(`@${author} `);input.current?.focus();} },
      ...(canModerate?[{text:'Pin',onPress:()=>void send('pin',{message_id:item.id})},{text:'Remove',style:'destructive' as const,onPress:()=>void send('remove_message',{message_id:item.id})}]:[]),
      { text:'Cancel', style:'cancel' },
    ]);
  };
  if (overlay) return <View testID="live-overlay-chat" style={{gap:8,flexShrink:1,minHeight:0}}>
    {!compact&&historyOpen&&liveObject(pinned)&&pinned.removed!==true&&!removedIds.current.has(String(pinned.id))&&liveText(pinned.body)?<View style={s.overlayPinned}><Text numberOfLines={2} style={s.overlayText}><Text style={{fontWeight:'800'}}>Pinned  </Text>{liveText(pinned.body,500)}</Text></View>:null}
    {historyOpen?<FlatList ref={list} style={{height:compact?64:166,flexGrow:0,flexShrink:1,minHeight:0}} data={rows} keyExtractor={item=>String(item.id)} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      ListHeaderComponent={compact&&liveObject(pinned)&&pinned.removed!==true&&!removedIds.current.has(String(pinned.id))&&liveText(pinned.body)?<Text numberOfLines={1} style={[s.overlayText,{fontWeight:'700'}]}>Pinned: {liveText(pinned.body,500)}</Text>:null}
      contentContainerStyle={{gap:4,paddingVertical:4}} maintainVisibleContentPosition={{minIndexForVisible:0}}
      onContentSizeChange={()=>{if(followLatest.current)list.current?.scrollToEnd({animated:false});}}
      onLayout={()=>{if(followLatest.current)list.current?.scrollToEnd({animated:false});}}
      onScroll={({nativeEvent})=>{followLatest.current=nativeEvent.contentSize.height-nativeEvent.contentOffset.y-nativeEvent.layoutMeasurement.height<48;setShowLatest(!followLatest.current);}} scrollEventThrottle={32}
      renderItem={({item})=><TouchableOpacity accessibilityRole="button" accessibilityLabel={`${liveObject(item.author)?liveText(item.author.full_name||item.author.username,100):'Member'}: ${item.removed===true?'Message removed':liveText(item.body,500)}`} activeOpacity={.8} onPress={()=>messageActions(item)} style={{paddingVertical:3,paddingRight:32}}><Text style={s.overlayText}><Text style={{fontWeight:'800'}}>{liveObject(item.author)?liveText(item.author.full_name||item.author.username,100):'Member'} </Text>{item.removed===true?'Message removed':liveText(item.body,500)}</Text></TouchableOpacity>}
      ListEmptyComponent={<Text style={[s.overlayText,{opacity:.8,paddingTop:20}]}>{enabled?'Say hello. Comments appear here.':'Comments will appear here when the live starts.'}</Text>}/>:null}
    {compact?<TouchableOpacity accessibilityRole="button" accessibilityLabel={historyOpen?'Hide comments':'Show comments'} onPress={()=>setHistoryOpen(value=>!value)} style={{minHeight:32,justifyContent:'center',alignSelf:'flex-start'}}><Text style={{color:'#fff',fontSize:12,fontWeight:'700'}}>{historyOpen?'Hide comments':'Show comments'}</Text></TouchableOpacity>:null}
    {historyOpen&&showLatest?<TouchableOpacity accessibilityRole="button" onPress={()=>{followLatest.current=true;setShowLatest(false);list.current?.scrollToEnd({animated:false});}} style={s.overlayPill}><Text style={s.overlayText}>Latest comments ↓</Text></TouchableOpacity>:null}
    {status!=='Connected'?<TouchableOpacity accessibilityRole="button" accessibilityLabel="Reconnect chat" onPress={()=>setRevision(v=>v+1)} style={{alignSelf:'flex-start',minHeight:32,justifyContent:'center'}}><Text style={{color:'#fff',fontSize:11}}>{status}</Text></TouchableOpacity>:null}
    <View style={{flexDirection:'row',alignItems:'center',gap:8,flexShrink:0}}>
      <TextInput ref={input} value={body} onChangeText={setBody} maxLength={500} editable={enabled&&!busy} placeholder={enabled?'Add a comment…':'Comments are closed'} placeholderTextColor="rgba(255,255,255,0.8)" accessibilityLabel="Live chat message" style={s.overlayInput} multiline/>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Send comment" disabled={!enabled||busy||!body.trim()} onPress={()=>void send('chat',{body:body.trim()})} style={[s.overlayAction,{opacity:!enabled||busy||!body.trim()?.4:1}]}><Text style={{color:'#fff',fontWeight:'800'}}>Send</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Heart" disabled={!enabled||busy} onPress={()=>void send('reaction',{reaction:'heart'})} style={[s.overlayAction,{opacity:!enabled||busy?.4:1}]}><Text style={{color:'#fff',fontSize:32}}>♡</Text></TouchableOpacity>
    </View>
    {footer}
    {error?<Text accessibilityRole="alert" style={{color:'#fff',fontSize:12,backgroundColor:'rgba(0,0,0,.45)',padding:6,borderRadius:6}}>{error}</Text>:null}
  </View>;
  return <View style={{gap:10}}>
    <View style={s.row}><Text style={{color:t.ink.primary,fontSize:19,fontWeight:'700',flex:1}}>Live chat</Text>{button(status === 'Connected' ? 'Refresh' : 'Reconnect',()=>setRevision(v=>v+1),false)}</View>
    <Text accessibilityLiveRegion="polite" style={{color:t.ink.secondary,fontSize:12}}>{status}</Text>
    {liveObject(pinned) && pinned.removed !== true && !removedIds.current.has(String(pinned.id)) && liveText(pinned.body) ? <View style={[s.pinned,{backgroundColor:t.surface.sunken}]}><Text style={{color:t.ink.secondary,fontSize:11,fontWeight:'700'}}>PINNED MESSAGE</Text><Text style={{color:t.ink.primary,marginTop:4}}>{liveText(pinned.body,500)}</Text></View> : null}
    {cursor ? button('Earlier messages',()=>{ followLatest.current = false; setShowLatest(true); void load(cursor); }) : null}
    <FlatList ref={list} style={{height:340}} nestedScrollEnabled data={rows} keyExtractor={item=>String(item.id)} contentContainerStyle={{gap:10,paddingVertical:8}}
      maintainVisibleContentPosition={{minIndexForVisible:0}}
      onContentSizeChange={() => { if (followLatest.current) list.current?.scrollToEnd({ animated: false }); }}
      onScroll={({nativeEvent}) => { followLatest.current = nativeEvent.contentSize.height - nativeEvent.contentOffset.y - nativeEvent.layoutMeasurement.height < 48; setShowLatest(!followLatest.current); }} scrollEventThrottle={32}
      renderItem={({item})=><View style={{paddingVertical:3}}><Text style={{color:t.ink.primary,lineHeight:20}}><Text style={{fontWeight:'700'}}>{liveObject(item.author)?liveText(item.author.full_name||item.author.username,100):'Member'} </Text>{item.removed===true?'Message removed':liveText(item.body,500)}</Text>{canModerate && item.removed!==true?<View style={s.row}>{button('Pin',()=>void send('pin',{message_id:item.id}))}{button('Remove',()=>void send('remove_message',{message_id:item.id}))}</View>:null}</View>} ListEmptyComponent={<Text style={{color:t.ink.secondary,textAlign:'center',padding:24}}>Messages will appear here.</Text>}/>
    {showLatest ? button('Latest messages', () => { followLatest.current = true; setShowLatest(false); list.current?.scrollToEnd({ animated: false }); }, false) : null}
    <View style={s.row}><TextInput value={body} onChangeText={setBody} maxLength={500} editable={enabled&&!busy} placeholder={enabled?'Send a message':'Chat is currently closed'} placeholderTextColor={t.ink.muted} accessibilityLabel="Live chat message" style={[s.input,{color:t.ink.primary,backgroundColor:t.surface.sunken,flex:1}]} multiline/>{button('Send',()=>void send('chat',{body:body.trim()}),!enabled||busy||!body.trim())}</View>
    <View style={s.row}>{[['heart','Heart'],['applause','Applause'],['fire','Fire']].map(([reaction,label])=><React.Fragment key={reaction}>{button(label,()=>void send('reaction',{reaction}),busy||!enabled)}</React.Fragment>)}</View>
    {canModerate?<View style={s.row}>{button('Slow mode',()=>void send('chat_settings',{slow_mode_seconds:10}))}{button('Open chat',()=>void send('chat_settings',{chat_mode:'open',slow_mode_seconds:0}))}{button('Close chat',()=>void send('chat_settings',{chat_mode:'closed'}))}</View>:null}
    {error?<Text accessibilityRole="alert" style={{color:t.ink.primary}}>{error}</Text>:null}
  </View>;
}
const s=StyleSheet.create({overlayText:{color:'#fff',fontSize:14,lineHeight:20,textShadowColor:'rgba(0,0,0,.8)',textShadowOffset:{width:0,height:1},textShadowRadius:3},overlayInput:{flex:1,minHeight:44,maxHeight:88,borderWidth:1,borderColor:'rgba(255,255,255,.55)',backgroundColor:'rgba(0,0,0,.22)',borderRadius:24,paddingHorizontal:15,paddingVertical:10,color:'#fff',fontSize:14},overlayAction:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},overlayPinned:{backgroundColor:'rgba(0,0,0,.45)',borderRadius:12,padding:10,borderLeftWidth:3,borderLeftColor:'#fff'},overlayPill:{alignSelf:'flex-start',backgroundColor:'rgba(0,0,0,.5)',paddingHorizontal:12,minHeight:36,justifyContent:'center',borderRadius:18},row:{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},button:{minHeight:44,minWidth:44,borderRadius:20,paddingHorizontal:12,justifyContent:'center',alignItems:'center'},input:{minHeight:44,maxHeight:110,borderRadius:12,paddingHorizontal:12,paddingVertical:10},pinned:{borderRadius:12,padding:12}});
