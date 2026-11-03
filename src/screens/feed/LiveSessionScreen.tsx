import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Share, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { VideoView } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from '../../components/SafeArea';
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../stores/authStore';
import { useLivePlayback } from '../../contexts/LivePlaybackContext';
import { LiveStudio } from '../../components/LiveStudio';
import { LiveIcon } from '../../components/LiveUi';
import { LiveChat } from '../../components/LiveChat';
import { LiveInteractions, LiveAnalytics } from '../../components/LiveInteractions';
import { liveCommand, liveObject, liveRequestId, liveRows, liveText, loadLiveSession, type LiveObject, type NativeLiveDetail } from '../../services/liveService';
import { liveStateLabel, isLiveUuid, parseLiveSession } from '../../../shared/liveDirectory';
import { supabase } from '../../services/supabase';
import { profileRead } from '../../utils/profileRead';

type Props = { route: { params?: { sessionId?: string; openStudio?: boolean; previewCamera?: boolean } }; navigation: { goBack(): void; navigate(name: string, params?: object): void } };
export default function LiveSessionScreen({ route, navigation }: Props) {
  const id = route.params?.sessionId || '', { t } = useTheme(), playback = useLivePlayback();
  const owner = useAuthStore(s => s.profile?.id ?? null);
  const [detail, setDetail] = useState<NativeLiveDetail | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState(route.params?.openStudio ? 'Studio' : 'Chat');
  const [memberSearch, setMemberSearch] = useState(''), [people, setPeople] = useState<LiveObject[]>([]), [memberRole, setMemberRole] = useState('guest');
  const [report, setReport] = useState(''), [notice, setNotice] = useState('');
  const [studioOpened,setStudioOpened]=useState(route.params?.openStudio===true);
  const [previewRequested,setPreviewRequested]=useState(route.params?.previewCamera===true);
  const generation = useRef(0), lock = useRef(false), request = useRef<{ signature: string; id: string } | null>(null), searchVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    try { const next = await loadLiveSession(id); if (version === generation.current) { setDetail(next); setError(''); } }
    catch (reason) { if (version === generation.current) { setDetail(null); setError(reason instanceof Error ? reason.message : 'The stream could not load.'); if (playback.session?.id === id) playback.close(); } }
  }, [id, owner]);
  useEffect(() => { setDetail(null); setTab(route.params?.openStudio ? 'Studio' : 'Chat'); setStudioOpened(route.params?.openStudio===true); setPreviewRequested(route.params?.previewCamera===true); setPeople([]); setNotice(''); void refresh(); return () => { generation.current++; searchVersion.current++; }; }, [refresh]);
  useFocusEffect(useCallback(() => {
    if (playback.session?.id === id) playback.expand();
    return () => { if (playback.session?.id === id) playback.minimize(); };
  }, [id, playback.session?.id]));
  const send = async (action: string, payload: LiveObject) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    const signature = JSON.stringify([id,action,payload]); if (request.current?.signature !== signature) request.current = { signature, id: liveRequestId() };
    try { await liveCommand(action,id,payload,request.current.id); request.current = null; setNotice('Saved.'); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The action was not confirmed.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const button = (label: string, onPress: () => void, disabled = busy) => <TouchableOpacity key={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button,{backgroundColor:t.surface.sunken,opacity:disabled?.5:1}]}><Text style={{color:t.ink.primary,fontSize:13,fontWeight:'600'}}>{label}</Text></TouchableOpacity>;
  const raw = detail?.raw, caps = liveObject(raw?.capabilities) ? raw.capabilities : {}, role = liveText(raw?.role,30);
  const manages = ['host','producer'].includes(role), moderate = manages || role === 'moderator', stage = ['host','producer','camera','guest'].includes(role);
  const session = detail?.session, tabs = [...(stage?['Studio']:[]),'Chat','Polls & Q&A','Clips',...(manages?['Team']:[]),'Details'];
  const ownPlayer = playback.session?.id === id;
  return <SafeAreaView style={{flex:1,backgroundColor:t.surface.raised}}>
    <View style={s.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to live streams" onPress={()=>{if(ownPlayer)playback.minimize();navigation.goBack();}} style={s.icon}><Feather name="chevron-left" size={24} color={t.ink.primary}/></TouchableOpacity><Text numberOfLines={1} style={{flex:1,color:t.ink.primary,fontSize:17,fontWeight:'700'}}>{session?.title||'Live stream'}</Text>{button('Refresh',()=>void refresh(),false)}</View>
    <ScrollView contentContainerStyle={{paddingBottom:100,gap:14}} keyboardShouldPersistTaps="handled">
      {error?<Text accessibilityRole="alert" style={[s.pad,{color:t.ink.primary}]}>{error}</Text>:null}
      {!session&&!error?<ActivityIndicator color={t.ink.primary} style={{margin:40}}/>:session?<>
        {tab!=='Studio'?<View style={[s.pad,{gap:5}]}><Text style={{color:session.state==='live'?'#C33D41':t.ink.secondary,fontSize:12,fontWeight:'800'}}>{liveStateLabel(session)}</Text><Text style={{color:t.ink.primary,fontWeight:'700',fontSize:23}}>{session.title}</Text><Text style={{color:t.ink.secondary}}>{session.host.full_name||session.host.username||'Creator'}{session.viewer_count===null?'':` · ${session.viewer_count.toLocaleString()} watching`}</Text></View>:null}
        {tab==='Studio'&&stage?null:ownPlayer&&playback.expanded?<View style={s.player}><VideoView player={playback.player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls allowsPictureInPicture startsPictureInPictureAutomatically fullscreenOptions={{enable:true}}/>{playback.loading?<View pointerEvents="none" style={[StyleSheet.absoluteFill,s.center]}><ActivityIndicator color="#fff"/></View>:null}</View>:<View style={[s.player,s.center,{backgroundColor:t.surface.sunken}]}><LiveIcon size={42} color={t.ink.muted}/>{caps.view===true&&(['live','reconnecting'].includes(session.state)||session.replay_available)?button(session.replay_available?'Play replay':'Watch live',()=>void playback.open(session),false):<Text style={{color:t.ink.secondary,textAlign:'center',padding:20}}>{session.state==='scheduled'?'This session has not started.':stage?'Your stream is not live yet. Open the camera preview to get started.':'Playback is not available for this session yet.'}</Text>}{stage&&['draft','scheduled','backstage'].includes(session.state)?button('Open camera preview',()=>{playback.close();setPreviewRequested(true);setTab('Studio');setStudioOpened(true);},false):null}</View>}
        {ownPlayer&&playback.error?<View style={s.pad}><Text style={{color:t.ink.primary}}>{playback.error}</Text>{button('Retry playback',()=>void playback.retry(),false)}</View>:null}
        {tab!=='Studio'?<View style={[s.row,s.pad]}>{ownPlayer?button('Minimize',()=>{playback.minimize();navigation.goBack();},false):null}{button('Share stream',()=>void Share.share({message:`${session.title}\nhttps://platinumcircles.app/live/${id}`,url:`https://platinumcircles.app/live/${id}`}).catch(()=>setError('Sharing could not open. Try again.')),false)}{session.state==='scheduled'&&caps.reminders===true?button(raw?.reminded===true?'Remove reminder':'Remind me',()=>void send('reminder',{enabled:raw?.reminded!==true})):null}</View>:null}
        {liveObject(raw?.invitation)&&raw.invitation.status==='invited'?<View style={s.pad}><Text style={{color:t.ink.primary}}>You have been invited to join this stream.</Text>{button('Accept invitation',()=>void send('accept_invite',{}))}</View>:null}
        <ScrollView horizontal contentContainerStyle={{paddingHorizontal:16,gap:8}}>{tabs.map(name=><TouchableOpacity key={name} accessibilityRole="button" accessibilityState={{selected:tab===name}} onPress={()=>{setTab(name);if(name==='Studio')setStudioOpened(true);}} style={[s.button,{borderRadius:0,borderBottomWidth:2,borderBottomColor:tab===name?t.ink.primary:'transparent'}]}><Text style={{color:tab===name?t.ink.primary:t.ink.secondary,fontWeight:'600'}}>{name}</Text></TouchableOpacity>)}</ScrollView>
        <View style={s.pad}>
          {tab==='Chat'?<LiveChat id={id} topic={liveText(raw?.chat_topic,100)} enabled={caps.chat===true&&session.chat_mode!=='closed'&&['live','reconnecting'].includes(session.state)} canModerate={moderate} pinned={raw?.pinned_message} onChanged={()=>void refresh()} onUpdate={value=>setDetail(previous=>{if(!previous)return previous;const incoming=liveObject(value.session)?value.session:null;const next=incoming?parseLiveSession({...previous.session,...incoming}):previous.session;return{session:next||previous.session,raw:{...previous.raw,...value,session:next||previous.session}};})}/>:null}
          {studioOpened&&stage?<View style={{display:tab==='Studio'?'flex':'none'}}><LiveStudio key={`${owner}:${id}`} sessionId={id} autoPreview={previewRequested} canControl={manages} streamState={session.state} onChanged={()=>void refresh()}/></View>:null}
          {tab==='Polls & Q&A'?<LiveInteractions key={`${owner}:${id}`} id={id} topic={liveText(raw?.chat_topic,100)} live={['live','reconnecting'].includes(session.state)} replay={session.replay_available} onAccessChanged={()=>void refresh()} onTopic={value=>setDetail(previous=>previous?{...previous,raw:{...previous.raw,chat_topic:value}}:previous)} onSeek={position=>{void playback.open(session).then(()=>{try{playback.player.currentTime=position/1000;}catch{setError('Open the replay before jumping to a chapter.');}});}}/>:null}
          {tab==='Clips'?<View style={{gap:12}}><Text style={{color:t.ink.primary,fontSize:20,fontWeight:'700'}}>Clips and highlights</Text><Text style={{color:t.ink.secondary}}>Create clips from this live recording, choose a cover and share finished exports.</Text>{button('Open clips',()=>navigation.navigate('LiveClips',{sessionId:id}),false)}</View>:null}
          {tab==='Team'&&manages?<View style={{gap:12}}>
            <Text style={{color:t.ink.primary,fontSize:20,fontWeight:'700'}}>Production team</Text><Text style={{color:t.ink.secondary}}>Invite a co-host, camera operator, moderator or viewer. Every invited member must accept before entering backstage.</Text>
            <View style={s.row}><TextInput value={memberSearch} onChangeText={setMemberSearch} maxLength={100} placeholder="Search a name or username" placeholderTextColor={t.ink.muted} accessibilityLabel="Search team member" style={[s.input,{flex:1,color:t.ink.primary,backgroundColor:t.surface.sunken}]}/>{button('Search',()=>{const version=++searchVersion.current;void profileRead(supabase.rpc('search_people',{p_q:memberSearch.trim(),p_limit:10})).then(({data,error})=>{if(version!==searchVersion.current)return;if(error)throw error;setPeople(liveRows(data,10));}).catch(()=>setError('People could not load. Try again.'));},busy||memberSearch.trim().length<2)}</View>
            <ScrollView horizontal contentContainerStyle={{gap:8}}>{[['guest','Co-host'],['camera','Camera'],['moderator','Moderator'],['producer','Producer'],['viewer','Viewer']].filter(([v])=>role==='host'||v!=='producer').map(([v,label])=><TouchableOpacity key={v} accessibilityRole="button" accessibilityState={{selected:memberRole===v}} style={[s.button,{backgroundColor:memberRole===v?t.ink.primary:t.surface.sunken}]} onPress={()=>setMemberRole(v)}><Text style={{color:memberRole===v?t.surface.raised:t.ink.primary}}>{label}</Text></TouchableOpacity>)}</ScrollView>
            {people.map(person=>isLiveUuid(person.id)?<View key={String(person.id)} style={s.row}><Text style={{flex:1,color:t.ink.primary}}>{liveText(person.full_name||person.username,100)}</Text>{button('Invite',()=>void send('invite',{user_id:person.id,role:memberRole}))}</View>:null)}
            {liveRows(raw?.members,50).map(member=><View key={String(member.user_id)} style={[s.row,{paddingVertical:8}]}><View style={{flex:1}}><Text style={{color:t.ink.primary,fontWeight:'600'}}>{liveObject(member.profile)?liveText(member.profile.full_name||member.profile.username,100):'Member'}</Text><Text style={{color:t.ink.secondary,fontSize:12}}>{liveText(member.role,30)} · {liveText(member.status,30)}</Text></View>{button('Remove',()=>void send('remove_member',{user_id:member.user_id}))}</View>)}
          </View>:null}
          {tab==='Details'?<View style={{gap:14}}><Text style={{color:t.ink.primary,lineHeight:22}}>{session.description||'No description added.'}</Text>{session.scheduled_at?<Text style={{color:t.ink.secondary}}>{new Date(session.scheduled_at).toLocaleString()}</Text>:null}<Text style={{color:t.ink.secondary}}>Audience: {session.audience}. Topic: {session.topic}.</Text><TextInput value={report} onChangeText={setReport} maxLength={1000} multiline placeholder="Describe a problem with this stream" placeholderTextColor={t.ink.muted} accessibilityLabel="Report reason" style={[s.input,{color:t.ink.primary,backgroundColor:t.surface.sunken}]}/>{button('Report stream',()=>void send('report',{reason:report.trim()}),busy||!report.trim())}{manages&&['draft','scheduled','backstage'].includes(session.state)?button('Cancel stream',()=>Alert.alert('Cancel this stream?', 'This stream will no longer be available.',[{text:'Keep stream',style:'cancel'},{text:'Cancel stream',style:'destructive',onPress:()=>void send('cancel',{})}])):null}</View>:null}
          {tab==='Details'&&moderate?<LiveAnalytics key={`${owner}:${id}`} id={id}/>:null}
          {notice?<Text accessibilityLiveRegion="polite" style={{color:t.ink.secondary,marginTop:12}}>{notice}</Text>:null}
        </View>
      </>:null}
    </ScrollView>
  </SafeAreaView>;
}
const s=StyleSheet.create({header:{minHeight:56,flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:8},icon:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},pad:{paddingHorizontal:16},row:{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},button:{minHeight:44,minWidth:44,paddingHorizontal:14,borderRadius:22,justifyContent:'center',alignItems:'center'},player:{width:'100%',aspectRatio:16/9,backgroundColor:'#000'},center:{alignItems:'center',justifyContent:'center'},input:{minHeight:46,maxHeight:150,borderRadius:12,padding:12}});
