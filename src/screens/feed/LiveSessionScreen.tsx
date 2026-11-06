import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Share, Alert, Modal, Keyboard, KeyboardAvoidingView, Platform, StatusBar, BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { VideoView } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../stores/authStore';
import { useLivePlayback } from '../../contexts/LivePlaybackContext';
import { LiveStudio } from '../../components/LiveStudio';
import { LiveIcon } from '../../components/LiveUi';
import { LiveHostFollow } from '../../components/LiveHostFollow';
import { LiveChat } from '../../components/LiveChat';
import { LiveInteractions, LiveAnalytics } from '../../components/LiveInteractions';
import { liveCommand, liveObject, liveRequestId, liveRows, liveText, loadLiveSession, type LiveObject, type NativeLiveDetail } from '../../services/liveService';
import { liveStateLabel, isLiveUuid, parseLiveSession } from '../../../shared/liveDirectory';
import { supabase } from '../../services/supabase';
import { profileRead } from '../../utils/profileRead';

type Props = { route: { params?: { sessionId?: string; openStudio?: boolean; previewCamera?: boolean } }; navigation: { goBack(): void; navigate(name: string, params?: object): void } };
export default function LiveSessionScreen({ route, navigation }: Props) {
  const id = route.params?.sessionId || '', { t } = useTheme(), playback = useLivePlayback(), insets = useSafeAreaInsets();
  const owner = useAuthStore(s => s.profile?.id ?? null);
  const [detail, setDetail] = useState<NativeLiveDetail | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState('Tools');
  const [memberSearch, setMemberSearch] = useState(''), [people, setPeople] = useState<LiveObject[]>([]), [memberRole, setMemberRole] = useState('guest');
  const [report, setReport] = useState(''), [notice, setNotice] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false), [viewerMuted, setViewerMuted] = useState(false);
  const [headerHeight,setHeaderHeight]=useState(0), [keyboardVisible,setKeyboardVisible]=useState(()=>Keyboard.isVisible());
  useEffect(()=>{
    const shown=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow',()=>setKeyboardVisible(true));
    const hidden=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillHide':'keyboardDidHide',()=>setKeyboardVisible(false));
    return()=>{shown.remove();hidden.remove();};
  },[]);
  const afterToolsClose = useRef<(() => void) | null>(null);
  const autoWatch = useRef('');
  const [stageParticipantCount,setStageParticipantCount]=useState(1),[stageHeight,setStageHeight]=useState(0);
  const [studioOpened,setStudioOpened]=useState(route.params?.openStudio===true);
  const [previewRequested,setPreviewRequested]=useState(route.params?.previewCamera===true);
  const commandGeneration = useRef(0);
  const generation = useRef(0), pinRevision = useRef(0), removedMessages = useRef(new Set<string>()), lock = useRef(false), request = useRef<{ signature: string; id: string } | null>(null), searchVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++generation.current, pinVersion = pinRevision.current;
    try { const next = await loadLiveSession(id); if (version === generation.current) { setDetail(previous => {
      const pin = pinVersion !== pinRevision.current && previous ? previous.raw.pinned_message : next.raw.pinned_message;
      return { ...next, raw: { ...next.raw, pinned_message: liveObject(pin) && (pin.removed === true || removedMessages.current.has(String(pin.id))) ? null : pin } };
    }); setError(''); } }
    catch (reason) { if (version === generation.current) { const message=reason instanceof Error?reason.message:'The stream could not load.';setError(message);if (/^Sign in again|^This stream is unavailable|^This stream link/.test(message)) {setDetail(null);if(playback.session?.id===id)playback.close();} } }
  }, [id, owner]);
  useEffect(() => { removedMessages.current.clear();afterToolsClose.current=null;commandGeneration.current++;lock.current=false;request.current=null;setBusy(false);setDetail(null); setTab('Tools');setToolsOpen(false);autoWatch.current=''; setStudioOpened(route.params?.openStudio===true); setPreviewRequested(route.params?.previewCamera===true); setPeople([]); setNotice(''); void refresh(); return () => { afterToolsClose.current=null;commandGeneration.current++;generation.current++; searchVersion.current++; }; }, [refresh]);
  useFocusEffect(useCallback(() => {
    if (playback.session?.id === id) playback.expand();
    return () => { if (playback.session?.id === id) playback.minimize(); };
  }, [id, playback.session?.id]));
  const send = async (action: string, payload: LiveObject) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    const version = commandGeneration.current;
    const signature = JSON.stringify([id,action,payload]); if (request.current?.signature !== signature) request.current = { signature, id: liveRequestId() };
    try { await liveCommand(action,id,payload,request.current.id); if(version!==commandGeneration.current)return; request.current = null; setNotice('Saved.'); await refresh(); }
    catch (reason) { if(version===commandGeneration.current)setError(reason instanceof Error ? reason.message : 'The action was not confirmed.'); }
    finally { if(version===commandGeneration.current){lock.current = false; setBusy(false);} }
  };
  const button = (label: string, onPress: () => void, disabled = busy, selected?: boolean) => <TouchableOpacity key={label} accessibilityRole="button" accessibilityState={{disabled,selected}} disabled={disabled} onPress={onPress} style={[s.button,{backgroundColor:selected?t.ink.primary:t.surface.sunken,opacity:disabled?.5:1}]}><Text style={{color:selected?t.surface.raised:t.ink.primary,fontSize:13,fontWeight:'600'}}>{label}</Text></TouchableOpacity>;
  const raw = detail?.raw, caps = liveObject(raw?.capabilities) ? raw.capabilities : {}, role = liveText(raw?.role,30);
  const manages = ['host','producer'].includes(role), moderate = manages || role === 'moderator', stage = ['host','producer','camera','guest'].includes(role);
  const session = detail?.session;
  const ownPlayer = playback.session?.id === id;
  useEffect(()=>{if(ownPlayer){try{setViewerMuted(!!playback.player.muted);}catch{}}},[ownPlayer]);
  const live = !!session && ['live','starting','reconnecting','ending'].includes(session.state);
  const studioVisible = !!session && stage && (studioOpened || (role==='host' && live));
  const invitation = liveObject(raw?.invitation) ? raw.invitation : null;
  const ownJoinRequest = liveObject(raw?.own_join_request) ? raw.own_join_request : null;
  const stageCapacity = liveObject(raw?.stage) ? raw.stage : null;
  const joinRequests = liveRows(raw?.join_requests,100).filter(item=>item.status==='pending');
  const automaticGuestIds = Array.isArray(raw?.stage_guest_identities) ? raw.stage_guest_identities.filter((value):value is string=>isLiveUuid(value)).slice(0,12) : [];
  const guestTopic = liveText(raw?.guest_topic,120);
  const openTools = (name = 'Tools') => { Keyboard.dismiss(); setTab(name); setToolsOpen(true); };
  const closeToolsThen = (action: () => void) => {
    if (Platform.OS === 'ios') afterToolsClose.current = action;
    setToolsOpen(false);
    if (Platform.OS !== 'ios') action();
  };
  const patchDetail = (value: LiveObject) => {
    if(Object.prototype.hasOwnProperty.call(value,'pinned_message'))pinRevision.current++;
    const removed=isLiveUuid(value.removed_message_id)?value.removed_message_id:null;
    if(removed){removedMessages.current.add(removed);if(removedMessages.current.size>300)removedMessages.current.delete(removedMessages.current.values().next().value!);}
    setDetail(previous=>{
      if(!previous)return previous;
      const incoming=liveObject(value.session)?value.session:null;
      const next=incoming?parseLiveSession({...previous.session,...incoming}):previous.session;
      const nextRaw:LiveObject={...previous.raw,...value,session:next||previous.session},pin=nextRaw.pinned_message;
      if(liveObject(pin)&&removedMessages.current.has(String(pin.id)))nextRaw.pinned_message=null;
      return {session:next||previous.session,raw:nextRaw};
    });
  };
  useEffect(()=>{
    if(!guestTopic||!owner||guestTopic!==`live-guests:${id}:${owner}`)return;
    let alive=true;
    const channel=supabase.channel(guestTopic,{config:{private:true}}).on('broadcast',{event:'guest_requests_changed'},()=>{if(alive)void refresh();}).subscribe();
    return()=>{alive=false;void supabase.removeChannel(channel);};
  },[guestTopic,id,owner,refresh]);
  useEffect(()=>{
    if(studioVisible){autoWatch.current='';return;}
    if(!session||caps.view!==true||!['live','reconnecting'].includes(session.state))return;
    const key=`${owner}:${id}`;
    if(autoWatch.current===key)return;
    autoWatch.current=key;void playback.open(session);
  },[id,owner,session?.state,caps.view,studioVisible]);
  const leave = () => { if(ownPlayer)playback.close();navigation.goBack(); };
  const requestClose = () => {
    if(studioVisible&&live)Alert.alert('Leave this live?', 'Leaving disconnects your camera and microphone. Use End live to end the broadcast for everyone.',[{text:'Keep streaming',style:'cancel'},{text:'Leave camera',style:'destructive',onPress:()=>{if(role==='guest')void liveCommand('leave_stage',id,{},liveRequestId()).catch(()=>undefined);leave();}}]);
    else leave();
  };
  useFocusEffect(useCallback(()=>{
    const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{if(toolsOpen)setToolsOpen(false);else requestClose();return true;});
    return()=>subscription.remove();
  },[studioVisible,live,toolsOpen,ownPlayer]));
  const share = () => { if(session)void Share.share({message:`${session.title}\nhttps://platinumcircles.app/live/${id}`,url:`https://platinumcircles.app/live/${id}`}).catch(()=>setError('Sharing could not open. Try again.')); };
  const overlayIcon = (label:string,icon:React.ComponentProps<typeof Feather>['name'],action:()=>void) => <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={label} onPress={action} style={s.overlayIcon}><Feather name={icon} size={23} color="#fff"/></TouchableOpacity>;
  const chat = session ? <LiveChat overlay compact={studioVisible&&stageParticipantCount>1} collapseHistory={studioVisible&&stageParticipantCount>1&&stageHeight>0&&stageHeight<640} id={id} topic={liveText(raw?.chat_topic,100)} enabled={caps.chat===true&&(session.chat_mode!=='closed'||moderate)&&['live','reconnecting'].includes(session.state)} reactionsEnabled={session.state==='live'} canModerate={moderate} pinned={raw?.pinned_message} onChanged={()=>void refresh()} onUpdate={patchDetail} /> : null;
  return <View testID="immersive-live-screen" style={s.screen} onLayout={event=>setStageHeight(event.nativeEvent.layout.height)}>
    <StatusBar barStyle="light-content" backgroundColor="#080a10" />
    {session?studioVisible?<LiveStudio key={`${owner}:${id}`} immersive headerHeight={headerHeight} keyboardVisible={keyboardVisible} autoDirect={role==='host'} automaticGuestIds={automaticGuestIds} onParticipantCount={setStageParticipantCount} onLeaveStage={role==='guest'?()=>void send('leave_stage',{}):undefined} sessionId={id} autoPreview={previewRequested||live} canControl={manages} streamState={session.state} onChanged={()=>void refresh()} onGuests={()=>openTools('Guests')} onMore={()=>openTools()}>{chat}</LiveStudio>:<>
      <View testID="live-viewer-media" style={StyleSheet.absoluteFill}>
        {ownPlayer&&playback.expanded?<VideoView player={playback.player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={session.state==='ended'&&session.replay_available} allowsPictureInPicture startsPictureInPictureAutomatically onPictureInPictureStart={()=>playback.setPictureInPicture(true)} onPictureInPictureStop={()=>playback.setPictureInPicture(false)} fullscreenOptions={{enable:true}}/>:<View style={[s.screen,s.center]}><LiveIcon size={48} color="#fff"/><Text style={s.emptyTitle}>{session.state==='scheduled'?'This live starts soon':session.state==='ended'?'This live has ended':'Waiting for live video'}</Text>{caps.view===true&&(['live','reconnecting'].includes(session.state)||session.replay_available)?<TouchableOpacity accessibilityRole="button" onPress={()=>void playback.open(session)} style={s.pill}><Text style={s.white}>{session.replay_available?'Play replay':'Watch live'}</Text></TouchableOpacity>:null}{session.scheduled_at?<Text style={s.white}>{new Date(session.scheduled_at).toLocaleString()}</Text>:null}</View>}
        {ownPlayer&&playback.loading?<View pointerEvents="none" style={[StyleSheet.absoluteFill,s.center]}><ActivityIndicator color="#fff"/></View>:null}
      </View>
      <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS==='ios'?'padding':'height'} style={StyleSheet.absoluteFill}><View testID="live-viewer-footer-space" pointerEvents="box-none" style={{flex:1,paddingTop:headerHeight}}><View pointerEvents="box-none" style={{flex:1}}/><LinearGradient colors={['transparent','rgba(0,0,0,0.8)']} style={[s.viewerFooter,{paddingTop:keyboardVisible?8:35,paddingBottom:keyboardVisible?12:Math.max(insets.bottom,12),paddingLeft:Math.max(insets.left,14),paddingRight:Math.max(insets.right,14)}]}>
        {ownPlayer&&playback.error?<View style={s.errorBox}><Text style={s.white}>{playback.error}</Text><TouchableOpacity accessibilityRole="button" onPress={()=>void playback.retry()} style={s.pill}><Text style={s.white}>Retry playback</Text></TouchableOpacity></View>:null}
        {invitation?.status==='invited'?<TouchableOpacity accessibilityRole="button" disabled={busy} onPress={()=>void send('accept_invite',{})} style={s.pill}><Text style={s.white}>Accept invitation</Text></TouchableOpacity>:null}
        {stage&&!studioVisible&&!['ended','cancelled'].includes(session.state)?<TouchableOpacity accessibilityRole="button" onPress={()=>{playback.close();setStudioOpened(true);setPreviewRequested(true);}} style={s.pill}><Text style={s.white}>Join live camera</Text></TouchableOpacity>:null}
        {chat}
        <View style={s.viewerActions}>
          {overlayIcon('Guests','users',()=>openTools('Guests'))}
          {!stage&&['live','reconnecting'].includes(session.state)&&(ownJoinRequest?.status==='pending'||raw?.can_request_join===true)?<TouchableOpacity accessibilityRole="button" disabled={busy} onPress={()=>openTools('Guests')} style={[s.pill,{flex:1}]}><Text style={s.white}>{ownJoinRequest?.status==='pending'?'Request pending':'Request to join'}</Text></TouchableOpacity>:null}
          {overlayIcon('Share stream','send',share)}
          {overlayIcon('More live tools','more-horizontal',()=>openTools())}
        </View>
      </LinearGradient></View></KeyboardAvoidingView>
    </>:<View style={[s.screen,s.center]}>{error?<Text style={[s.white,{padding:24,textAlign:'center'}]}>{error}</Text>:<ActivityIndicator color="#fff"/>}{error?<TouchableOpacity accessibilityRole="button" style={s.pill} onPress={()=>void refresh()}><Text style={s.white}>Retry</Text></TouchableOpacity>:null}</View>}
    <LinearGradient pointerEvents="box-none" onLayout={event=>setHeaderHeight(event.nativeEvent.layout.height)} colors={['rgba(0,0,0,.7)','transparent']} style={[s.header,{paddingTop:insets.top+8,paddingLeft:Math.max(insets.left,12),paddingRight:Math.max(insets.right,12)}]}>
      <View style={s.headerRow}><View style={s.avatar}><Text style={{color:'#fff',fontWeight:'800',fontSize:19}}>{(session?.host.full_name||session?.host.username||'L').charAt(0).toUpperCase()}</Text></View><View style={{flex:1}}><Text numberOfLines={1} style={[s.white,{fontWeight:'800',fontSize:15}]}>{session?.host.full_name||session?.host.username||'Live stream'}</Text><Text numberOfLines={1} style={[s.white,{fontSize:12,opacity:.85}]}>{session?.title||'Connecting…'}</Text></View>{owner&&session&&owner!==session.host.id?<LiveHostFollow key={owner+session.host.id} owner={owner} host={session.host.id} sessionId={session.id} onChange={()=>void refresh()}/>:null}<View style={[s.liveBadge,{backgroundColor:session?.state==='live'?'#d3274f':'rgba(0,0,0,.35)'}]}><Text style={{color:'#fff',fontSize:11,fontWeight:'800'}}>{session?liveStateLabel(session):'LIVE'}</Text></View>{overlayIcon('Back to live streams','x',requestClose)}</View>
      {session?<View style={s.headerMeta}>{session.viewer_count!==null?<Text style={s.viewerCount}>{session.viewer_count.toLocaleString()} watching</Text>:null}{manages&&joinRequests.length?<TouchableOpacity accessibilityRole="button" accessibilityLabel={`${joinRequests.length} guest requests`} onPress={()=>openTools('Guests')} style={s.requestBadge}><Text style={s.white}>{joinRequests.length} guest requests</Text></TouchableOpacity>:null}{ownPlayer&&!studioVisible?overlayIcon(viewerMuted?'Unmute live':'Mute live',viewerMuted?'volume-x':'volume-2',()=>{try{playback.player.muted=!viewerMuted;setViewerMuted(!viewerMuted);}catch{setError('Playback sound could not change. Try again.');}}):null}{ownPlayer&&!studioVisible?overlayIcon('Minimize live','minimize-2',()=>{playback.minimize();navigation.goBack();}):null}</View>:null}
    </LinearGradient>
    {error&&session?<View style={[s.floatingError,{top:insets.top+108}]}><Text accessibilityRole="alert" style={s.white}>{error}</Text></View>:null}
    <Modal visible={toolsOpen} transparent animationType="slide" onRequestClose={()=>setToolsOpen(false)} onDismiss={()=>{const next=afterToolsClose.current;afterToolsClose.current=null;next?.();}}>
      <KeyboardAvoidingView style={s.modalBackdrop} behavior={Platform.OS==='ios'?'padding':'height'}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close live tools" style={{flex:1}} onPress={()=>setToolsOpen(false)}/>
        <View style={[s.sheet,{backgroundColor:t.surface.raised,paddingBottom:Math.max(insets.bottom,16)}]}>
          <View style={s.sheetHeader}>{tab!=='Tools'?<TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to live tools" onPress={()=>setTab('Tools')} style={s.icon}><Feather name="chevron-left" color={t.ink.primary} size={23}/></TouchableOpacity>:null}<Text accessibilityRole="header" style={{flex:1,color:t.ink.primary,fontSize:20,fontWeight:'700'}}>{tab==='Tools'?'Live tools':tab}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close live tools" onPress={()=>setToolsOpen(false)} style={s.icon}><Feather name="x" size={24} color={t.ink.primary}/></TouchableOpacity></View>
          <ScrollView contentContainerStyle={{gap:14,paddingBottom:16}} keyboardShouldPersistTaps="handled">
            {tab==='Tools'?<View style={{gap:10}}>{['Guests','Polls & Q&A','Clips','Details',...(moderate?['Chat settings']:[])].map(name=>button(name,()=>setTab(name),false))}{button('Share stream',share,false)}{button('Refresh live',()=>void refresh(),false)}{session?.state==='scheduled'&&caps.reminders===true?button(raw?.reminded===true?'Remove reminder':'Remind me',()=>void send('reminder',{enabled:raw?.reminded!==true})):null}</View>:null}
            {tab==='Guests'?<View style={{gap:12}}>
              {stageCapacity?<Text style={{color:t.ink.secondary}}>{String(stageCapacity.occupied??0)} places taken · {String(stageCapacity.available??0)} available</Text>:null}
              {!stage&&session&&['live','reconnecting'].includes(session.state)?ownJoinRequest?.status==='declined'&&raw?.can_request_join!==true?<Text style={{color:t.ink.primary,lineHeight:21}}>The host declined your request for this live.</Text>:ownJoinRequest?.status==='pending'||raw?.can_request_join===true?<><Text style={{color:t.ink.primary,lineHeight:21}}>{ownJoinRequest?.status==='pending'?'Your request is with the host. Your camera stays off until you join.':'Ask the host to join this live with your camera and microphone.'}</Text>{button(ownJoinRequest?.status==='pending'?'Cancel join request':'Request to join',()=>void send(ownJoinRequest?.status==='pending'?'cancel_join_request':'request_join',{}))}</>:null:null}
              {stage&&!studioVisible&&session&&!['ended','cancelled'].includes(session.state)?button('Join live camera',()=>{setToolsOpen(false);playback.close();setStudioOpened(true);setPreviewRequested(true);},false):null}
              {stage&&role==='guest'&&!studioVisible&&session&&!['ended','cancelled'].includes(session.state)?button('Leave the live',()=>void send('leave_stage',{})):null}
              {manages?<><Text style={{color:t.ink.primary,fontSize:16,fontWeight:'700'}}>Guest requests</Text>{joinRequests.length?joinRequests.map(item=>{const profile=liveObject(item.profile)?item.profile:{};const name=liveText(profile.full_name||profile.username,100)||'Viewer';return <View key={String(item.user_id)} style={{gap:8,paddingVertical:8}}><Text style={{color:t.ink.primary,fontWeight:'600'}}>{name}</Text><View style={s.row}><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Accept request from ${name}`} disabled={busy||Number(stageCapacity?.available??1)<1} onPress={()=>void send('accept_join_request',{user_id:item.user_id})} style={[s.button,{backgroundColor:t.ink.primary}]}><Text style={{color:t.surface.raised}}>Accept</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Decline request from ${name}`} disabled={busy} onPress={()=>void send('decline_join_request',{user_id:item.user_id})} style={[s.button,{backgroundColor:t.surface.sunken}]}><Text style={{color:t.ink.primary}}>Decline</Text></TouchableOpacity></View></View>;}):<Text style={{color:t.ink.secondary}}>No pending requests.</Text>}</>:null}
            </View>:null}
            {tab==='Chat settings'&&moderate?<View style={{gap:10}}>
              <Text style={{color:t.ink.primary,fontWeight:'700'}}>Who can chat</Text>
              {([['open','Open chat'],['followers','Followers only'],['closed','Close chat']] as const).map(([mode,label])=>button(label,()=>void send('chat_settings',{chat_mode:mode}),busy,session?.chat_mode===mode))}
              <Text style={{color:t.ink.primary,fontWeight:'700'}}>Slow mode</Text>
              {[0,5,10,15,30].map(value=>button(value?value+' second slow mode':'Normal chat',()=>void send('chat_settings',{slow_mode_seconds:value}),busy,session?.slow_mode_seconds===value))}
            </View>:null}
            {session?<>
          {tab==='Polls & Q&A'?<LiveInteractions key={`${owner}:${id}`} id={id} topic={liveText(raw?.chat_topic,100)} live={['live','reconnecting'].includes(session.state)} replay={session.replay_available} onAccessChanged={()=>void refresh()} onTopic={value=>setDetail(previous=>previous?{...previous,raw:{...previous.raw,chat_topic:value}}:previous)} onSeek={position=>{void playback.open(session).then(()=>{try{playback.player.currentTime=position/1000;}catch{setError('Open the replay before jumping to a chapter.');}});}}/>:null}
          {tab==='Clips'?<View style={{gap:12}}><Text style={{color:t.ink.primary,fontSize:20,fontWeight:'700'}}>Clips and highlights</Text><Text style={{color:t.ink.secondary}}>Create clips from this live recording, choose a cover and share finished exports.</Text>{button('Open clips',()=>closeToolsThen(()=>navigation.navigate('LiveClips',{sessionId:id})),false)}</View>:null}
          {tab==='Guests'&&manages?<View style={{gap:12}}>
            <Text style={{color:t.ink.primary,fontSize:20,fontWeight:'700'}}>Invite guests</Text><Text style={{color:t.ink.secondary}}>Invite people to join your live. Each guest accepts before sharing their camera.</Text>
            <View style={s.row}><TextInput value={memberSearch} onChangeText={setMemberSearch} maxLength={100} placeholder="Search a name or username" placeholderTextColor={t.ink.muted} accessibilityLabel="Search team member" style={[s.input,{flex:1,color:t.ink.primary,backgroundColor:t.surface.sunken}]}/>{button('Search',()=>{const version=++searchVersion.current;void profileRead(supabase.rpc('search_people',{p_q:memberSearch.trim(),p_limit:10})).then(({data,error})=>{if(version!==searchVersion.current)return;if(error)throw error;setPeople(liveRows(data,10));}).catch(()=>setError('People could not load. Try again.'));},busy||memberSearch.trim().length<2)}</View>
            <ScrollView horizontal contentContainerStyle={{gap:8}}>{[['guest','Co-host'],['camera','Camera'],['moderator','Moderator'],['producer','Producer'],['viewer','Viewer']].filter(([v])=>role==='host'||v!=='producer').map(([v,label])=><TouchableOpacity key={v} accessibilityRole="button" accessibilityState={{selected:memberRole===v}} style={[s.button,{backgroundColor:memberRole===v?t.ink.primary:t.surface.sunken}]} onPress={()=>setMemberRole(v)}><Text style={{color:memberRole===v?t.surface.raised:t.ink.primary}}>{label}</Text></TouchableOpacity>)}</ScrollView>
            {people.map(person=>isLiveUuid(person.id)?<View key={String(person.id)} style={s.row}><Text style={{flex:1,color:t.ink.primary}}>{liveText(person.full_name||person.username,100)}</Text>{button('Invite',()=>void send('invite',{user_id:person.id,role:memberRole}))}</View>:null)}
            {liveRows(raw?.members,50).map(member=><View key={String(member.user_id)} style={[s.row,{paddingVertical:8}]}><View style={{flex:1}}><Text style={{color:t.ink.primary,fontWeight:'600'}}>{liveObject(member.profile)?liveText(member.profile.full_name||member.profile.username,100):'Member'}</Text><Text style={{color:t.ink.secondary,fontSize:12}}>{liveText(member.role,30)} · {liveText(member.status,30)}</Text></View>{button('Remove',()=>void send('remove_member',{user_id:member.user_id}))}</View>)}
          </View>:null}
          {tab==='Details'?<View style={{gap:14}}><Text style={{color:t.ink.primary,lineHeight:22}}>{session.description||'No description added.'}</Text>{session.scheduled_at?<Text style={{color:t.ink.secondary}}>{new Date(session.scheduled_at).toLocaleString()}</Text>:null}<Text style={{color:t.ink.secondary}}>Audience: {session.audience}. Topic: {session.topic}.</Text><TextInput value={report} onChangeText={setReport} maxLength={1000} multiline placeholder="Describe a problem with this stream" placeholderTextColor={t.ink.muted} accessibilityLabel="Report reason" style={[s.input,{color:t.ink.primary,backgroundColor:t.surface.sunken}]}/>{button('Report stream',()=>void send('report',{reason:report.trim()}),busy||!report.trim())}{manages&&['draft','scheduled','backstage'].includes(session.state)?button('Cancel stream',()=>Alert.alert('Cancel this stream?', 'This stream will no longer be available.',[{text:'Keep stream',style:'cancel'},{text:'Cancel stream',style:'destructive',onPress:()=>void send('cancel',{})}])):null}</View>:null}
          {tab==='Details'&&moderate?<LiveAnalytics key={`${owner}:${id}`} id={id}/>:null}

            </>:null}
            {notice?<Text accessibilityLiveRegion="polite" style={{color:t.ink.secondary}}>{notice}</Text>:null}
            {error?<Text accessibilityRole="alert" style={{color:t.ink.primary}}>{error}</Text>:null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:'#080a10'},header:{position:'absolute',top:0,left:0,right:0,paddingBottom:22},headerRow:{flexDirection:'row',alignItems:'center',gap:8},avatar:{height:38,width:38,borderRadius:19,backgroundColor:'rgba(255,255,255,.18)',alignItems:'center',justifyContent:'center'},white:{color:'#fff'},liveBadge:{paddingHorizontal:8,paddingVertical:6,borderRadius:7,maxWidth:100},headerMeta:{flexDirection:'row',alignItems:'center',gap:8,marginTop:4,paddingLeft:46},viewerCount:{color:'#fff',fontSize:12,backgroundColor:'rgba(0,0,0,.3)',paddingHorizontal:8,paddingVertical:5,borderRadius:12},requestBadge:{padding:8,borderRadius:16,backgroundColor:'#ba2050'},overlayIcon:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(0,0,0,.2)'},viewerFooter:{flexShrink:1,minHeight:0,paddingTop:35,paddingHorizontal:14,gap:10},viewerActions:{flexDirection:'row',alignItems:'center',gap:8},pill:{minHeight:44,backgroundColor:'rgba(255,255,255,.17)',borderRadius:24,paddingHorizontal:16,alignItems:'center',justifyContent:'center'},emptyTitle:{color:'#fff',fontWeight:'700',fontSize:21,textAlign:'center',marginTop:14},center:{alignItems:'center',justifyContent:'center',gap:12},errorBox:{backgroundColor:'rgba(0,0,0,.5)',padding:10,borderRadius:12,gap:8},floatingError:{position:'absolute',left:14,right:14,backgroundColor:'rgba(120,24,42,.92)',padding:12,borderRadius:12},modalBackdrop:{flex:1,backgroundColor:'rgba(0,0,0,.45)'},sheet:{maxHeight:'80%',borderTopLeftRadius:24,borderTopRightRadius:24,paddingHorizontal:18,paddingTop:10},sheetHeader:{flexDirection:'row',alignItems:'center',gap:8,minHeight:54,marginBottom:8},icon:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},pad:{paddingHorizontal:16},row:{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},button:{minHeight:44,minWidth:44,paddingHorizontal:14,borderRadius:22,justifyContent:'center',alignItems:'center'},input:{minHeight:46,maxHeight:150,borderRadius:12,padding:12}});
