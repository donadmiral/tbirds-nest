import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from './SafeArea';
import { Feather } from '@expo/vector-icons';
import { LiveIcon } from './LiveUi';
import Daily, { type DailyCall, type DailyParticipant } from '@daily-co/react-native-daily-js';
import { useTheme } from '../theme/useTheme';
import { ensureCameraPermission, ensureMicrophonePermission } from '../services/devicePermissions';
import { liveControl, liveRequestId, liveStage, type LiveObject } from '../services/liveService';
import { RemoteCallMedia } from './RemoteCallMedia';
import { useCallContext } from '../contexts/CallContext';
import { useLivePlayback } from '../contexts/LivePlaybackContext';
import { useAuthStore } from '../stores/authStore';
import { registerLiveStageRelease, releaseLiveStageMedia } from '../services/liveMediaSession';
import { settleCallOperation } from '../services/nativeCallRecovery';
import { useLiveStudioEvents } from '../hooks/useLiveStudioEvents';
import { automaticLiveStageScene, stableLiveStageSceneKey, LIVE_STAGE_SCENE_SETTLE_MS } from '../../shared/liveStageScene';
import { liveStudioPresentation, type PendingLiveControl } from '../../shared/liveSetup';

export function LiveStudio({ sessionId, canControl, streamState, onChanged, autoPreview = false, immersive = false, autoDirect = false, automaticGuestIds = [], children, onGuests, onMore, onParticipantCount }: { sessionId: string; autoPreview?: boolean; canControl: boolean; streamState: string; onChanged(): void; immersive?: boolean; autoDirect?: boolean; automaticGuestIds?: readonly string[]; children?: React.ReactNode; onGuests?(): void; onMore?(): void; onParticipantCount?(count: number): void }) {
  const insets = useSafeAreaInsets();
  const { t } = useTheme(), { callState } = useCallContext(), playback = useLivePlayback();
  const owner = useAuthStore(s => s.profile?.id ?? null);
  useLiveStudioEvents(sessionId, owner, onChanged);
  const rosterKey = useRef('');
  const [participants, setParticipants] = useState<DailyParticipant[]>([]), [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [sharing, setSharing] = useState(false), [canShare, setCanShare] = useState(false);
  const [automatic, setAutomatic] = useState(true), [sceneSyncFailed, setSceneSyncFailed] = useState(false), [sceneRevision, setSceneRevision] = useState(0);
  const appliedScene = useRef(''), blockedScene = useRef(''), sceneRequest = useRef<{key:string;id:string}|null>(null);
  const [preset, setPreset] = useState('host'), [selected, setSelected] = useState<string[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false), autoPreviewUsed = useRef(false);
  const afterToolsClose = useRef<(() => void) | null>(null);
  const closeToolsThen = (action: () => void) => {
    if (Platform.OS === 'ios') afterToolsClose.current = action;
    setToolsOpen(false);
    if (Platform.OS !== 'ios') action();
  };
  const [pendingControl, setPendingControl] = useState<PendingLiveControl>(null);
  const presentation = liveStudioPresentation(streamState, pendingControl);
  const call = useRef<DailyCall | null>(null), generation = useRef(0), mutation = useRef(false), request = useRef<{ signature: string; id: string } | null>(null);
  const stopping=useRef<Promise<void>|null>(null),unregister=useRef<(()=>void)|null>(null);
  const stop = useCallback(():Promise<void> => {
    if(stopping.current)return stopping.current;
    generation.current++;rosterKey.current='';appliedScene.current='';blockedScene.current='';sceneRequest.current=null;setSceneSyncFailed(false);const previous = call.current; call.current = null;
    setJoined(false); setParticipants([]);onParticipantCount?.(0); setSharing(false); setCanShare(false);
    if(!previous)return Promise.resolve();
    const release=unregister.current;unregister.current=null;
    const work=(async()=>{try{previous.stopScreenShare();await settleCallOperation(previous.leave(),2500);}catch{}finally{try{await settleCallOperation(Promise.resolve(previous.destroy()),2500);}catch{}release?.();}})();
    stopping.current=work;void work.finally(()=>{if(stopping.current===work)stopping.current=null;});return work;
  }, []);
  useEffect(() => () => { void stop(); }, [owner, sessionId, stop]);
  useEffect(() => { if (callState !== 'idle' && callState !== 'failed') void stop(); }, [callState, stop]);
  useEffect(() => { if (streamState === 'ended' || streamState === 'cancelled') void stop(); }, [streamState, stop]);
  const preview = async () => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    try {
      if (callState !== 'idle' && callState !== 'failed') throw new Error('Finish your current call before entering the studio.');
      if (!owner) throw new Error('Sign in to enter the studio.');
      await stop(); const version = ++generation.current;
      const grant = await liveStage(sessionId);
      if (version !== generation.current) return;
      // Resolve permission through the shared broker. Existing grants never prompt again.
      const [camera, microphone] = await Promise.all([ensureCameraPermission(), ensureMicrophonePermission()]);
      if (version !== generation.current) return;
      if (!camera.granted || !microphone.granted) throw new Error('Enable camera and microphone in device settings to enter the studio.');
      playback.close();await releaseLiveStageMedia();if(version!==generation.current)return;
      const instance = Daily.createCallObject({ audioSource: true, videoSource: true, startAudioOff: true, startVideoOff: true });
      call.current = instance;
      unregister.current=registerLiveStageRelease(stop);
      const update = () => {
        if (version !== generation.current || call.current !== instance) return;
        const rows = Object.values(instance.participants()).slice(0, grant.maxMembers);
        setParticipants(rows);
        const nextRoster=rows.map(p=>p.user_id||p.session_id).sort().join(':');
        if(nextRoster!==rosterKey.current){rosterKey.current=nextRoster;onParticipantCount?.(rows.length);onChanged();}
        const local = rows.find(p => p.local);
        if (local?.user_id) setSelected(current => current.length ? current : [local.user_id!]);
      };
      instance.on('participant-joined', update).on('participant-updated', update).on('participant-left', update);
      instance.on('joined-meeting', () => { if (version === generation.current) { setJoined(true); update(); } });
      instance.on('left-meeting', () => { if (version === generation.current) { setJoined(false); setParticipants([]); } });
      instance.on('error', () => { if (version === generation.current) { setError('The studio connection was interrupted. Leave and reconnect.'); void stop(); } });
      instance.on('local-screen-share-started', () => { if (version === generation.current) setSharing(true); });
      instance.on('local-screen-share-stopped', () => { if (version === generation.current) setSharing(false); });
      instance.on('local-screen-share-canceled', () => { if (version === generation.current) setSharing(false); });
      instance.on('nonfatal-error', () => { if (version === generation.current) setError('The device could not start the selected media. Check permissions or reconnect.'); });
      setCanShare(grant.canScreenShare && Daily.supportedBrowser().supportsScreenShare);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([instance.join({ url: grant.roomUrl, token: grant.token }), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('The studio connection timed out. Reconnect to retry.')), 25000); })]); }
      finally { if (timeout) clearTimeout(timeout); }
      if (version !== generation.current) { try { await instance.leave(); await instance.destroy(); } catch {} }
      else { await instance.setLocalVideo(true); update(); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The studio could not connect.'); await stop(); }
    finally { mutation.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (autoPreview && !autoPreviewUsed.current) { autoPreviewUsed.current = true; void preview(); }
  }, [autoPreview]);
  const automaticScene = autoDirect ? automaticLiveStageScene({participants:participants.filter(p=>p.local||automaticGuestIds.includes(p.user_id||'')),allowedGuestIds:automaticGuestIds,hostUserId:participants.find(p=>p.local)?.user_id || '',maxMembers:12,manualPreset:automatic?null:preset}) : null;
  const automaticKey = automaticScene ? stableLiveStageSceneKey(automaticScene) + (immersive?':portrait':':landscape') : '';
  const automaticPlan = useRef({key:automaticKey,enabled:automatic&&autoDirect&&joined&&streamState==='live'});
  automaticPlan.current={key:automaticKey,enabled:automatic&&autoDirect&&joined&&streamState==='live'};
  const selectPreset = (value: string) => { automaticPlan.current.enabled=false;setAutomatic(false);setPreset(value); };
  const sendControl = async (action: 'start' | 'stop' | 'scene') => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    const scene: LiveObject = { ...(automaticScene || {preset,...(preset === 'grid' ? {participant_ids:selected} : selected[0] ? {participant_id:selected[0]} : {})}), ...(immersive ? {orientation:'portrait'} : {}) };
    const signature = JSON.stringify([sessionId, action, scene]);
    if (request.current?.signature !== signature) request.current = { signature, id: liveRequestId() };
    try { await liveControl(sessionId, action, request.current.id, action === 'stop' ? undefined : scene); request.current = null; if (action !== 'scene') setPendingControl(action); if(action==='start'||action==='scene'){appliedScene.current=automaticKey;blockedScene.current='';setSceneSyncFailed(false);} onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The broadcast control was not confirmed.'); }
    finally { mutation.current = false; setBusy(false); }
  };
  // The active host publishes the same cameras to viewers that appear in the
  // studio. Coalesce participant bursts and keep failed retries explicit.
  useEffect(() => {
    if (!autoDirect || !automatic || !automaticScene || !joined || streamState !== 'live' || pendingControl === 'stop' || busy || !automaticKey || appliedScene.current === automaticKey || blockedScene.current === automaticKey) return;
    const version = generation.current;
    const scene: LiveObject = {...automaticScene,...(immersive?{orientation:'portrait'}:{})};
    const key = automaticKey;
    const timer = setTimeout(() => {
      if (version !== generation.current || mutation.current || !automaticPlan.current.enabled || automaticPlan.current.key!==key) return;
      mutation.current=true;setBusy(true);setSceneSyncFailed(false);
      if(sceneRequest.current?.key!==key)sceneRequest.current={key,id:liveRequestId()};
      void liveControl(sessionId,'scene',sceneRequest.current.id,scene).then(()=>{
        if(version!==generation.current)return;
        appliedScene.current=key;blockedScene.current='';sceneRequest.current=null;setError('');onChanged();
      }).catch(reason=>{
        if(version!==generation.current)return;
        blockedScene.current=key;setSceneSyncFailed(true);setError(reason instanceof Error?reason.message:'The guest layout could not update. Retry the layout.');
      }).finally(()=>{mutation.current=false;setBusy(false);});
    },LIVE_STAGE_SCENE_SETTLE_MS);
    return()=>clearTimeout(timer);
  },[automaticKey,automatic,autoDirect,joined,streamState,pendingControl,busy,sceneRevision,sessionId,immersive]);
  const media = async (action: 'audio' | 'video' | 'flip' | 'share') => {
    const instance = call.current; if (!instance || !joined) return;
    setError('');
    try {
      if (action === 'audio') instance.setLocalAudio(!instance.localAudio());
      if (action === 'video') instance.setLocalVideo(!instance.localVideo());
      if (action === 'flip') await instance.cycleCamera();
      if (action === 'share') sharing ? instance.stopScreenShare() : instance.startScreenShare();
    } catch { setError('This media control is unavailable on your current device or build.'); }
  };
  const button = (title: string, action: () => void, disabled = busy) => <TouchableOpacity key={title} accessibilityRole="button" disabled={disabled} onPress={action} style={[s.button, { backgroundColor: t.surface.sunken, opacity: disabled ? 0.5 : 1 }]}><Text style={{ color: t.ink.primary, fontWeight: '600', fontSize: 13 }}>{title}</Text></TouchableOpacity>;
  const live = ['live', 'starting', 'reconnecting', 'ending'].includes(streamState);
  const local = participants.find(p => p.local);
  const blocked = busy || !selected.length || (!local?.audio && !local?.video && !sharing) || ['starting','ending','ended','cancelled'].includes(streamState);
  const endBroadcast = () => Alert.alert('End this live?', 'Viewers will stop receiving live video.', [{ text: 'Keep streaming', style: 'cancel' }, { text: 'End live', style: 'destructive', onPress: () => void sendControl('stop') }]);
  const mediaButton = (label: string, icon: React.ComponentProps<typeof Feather>['name'], action: () => void) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={action} style={[s.mediaButton, { backgroundColor: t.surface.sunken, opacity: busy ? 0.5 : 1 }]}><Feather name={icon} size={21} color={t.ink.primary}/><Text style={{color:t.ink.secondary,fontSize:11,textAlign:'center'}}>{label}</Text></TouchableOpacity>;
  const overlayButton = (label: string, icon: React.ComponentProps<typeof Feather>['name'], action: () => void) => <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={action} style={[s.overlayButton, { opacity: busy ? .5 : 1 }]}><Feather name={icon} size={23} color="#fff" /></TouchableOpacity>;
  if (immersive) return <View testID="immersive-live-stage" style={s.immersive}>
    <View testID="live-stage-media" style={StyleSheet.absoluteFill}>
      {joined ? <RemoteCallMedia participants={participants} presentation="immersive" contentInsets={{top:insets.top+72,bottom:insets.bottom+300}} /> : <View style={[s.immersive,s.empty]}><LiveIcon size={48} color="#fff"/><Text style={s.overlayTitle}>{['ended','cancelled'].includes(streamState)?'This live has ended.':'Your camera preview'}</Text><Text style={s.overlayHint}>{['ended','cancelled'].includes(streamState)?'Thanks for being here.':'Check your camera before going live.'}</Text>{!['ended','cancelled'].includes(streamState)?<TouchableOpacity accessibilityRole="button" accessibilityLabel="Preview camera" disabled={busy} onPress={()=>void preview()} style={s.previewButton}><Text style={s.overlayTitle}>{busy?'Connecting…':'Preview camera'}</Text></TouchableOpacity>:null}</View>}
    </View>
    <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS==='ios'?'padding':undefined} style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={{flex:1}} />
      <LinearGradient colors={['transparent','rgba(0,0,0,0.72)']} style={{paddingTop:30,paddingLeft:Math.max(insets.left,14),paddingRight:Math.max(insets.right,14),paddingBottom:Math.max(insets.bottom,12),gap:10}}>
        {error?<Text accessibilityRole="alert" style={s.overlayError}>{error}</Text>:null}{sceneSyncFailed?<TouchableOpacity accessibilityRole="button" onPress={()=>{blockedScene.current='';setSceneRevision(v=>v+1);}} style={s.previewButton}><Text style={s.overlayTitle}>Retry guest layout</Text></TouchableOpacity>:null}
        {!joined&&canControl&&live?<TouchableOpacity accessibilityRole="button" accessibilityLabel="End live" disabled={busy||['starting','ending'].includes(streamState)} onPress={endBroadcast} style={s.broadcastButton}><Text style={s.overlayTitle}>End live</Text></TouchableOpacity>:null}
        {!live&&joined?<Text accessibilityLiveRegion="polite" style={s.overlayHint}>{presentation.description}</Text>:null}
        {children}
        {joined?<View style={s.overlayControls}>
          {overlayButton(local?.audio?'Mute':'Unmute',local?.audio?'mic':'mic-off',()=>void media('audio'))}
          {overlayButton('Flip','refresh-cw',()=>void media('flip'))}
          {onGuests?overlayButton('Guests','users',onGuests):null}
          {overlayButton('More live tools','more-horizontal',()=>setToolsOpen(true))}
          {canControl?<TouchableOpacity testID="live-start-button" accessibilityRole="button" accessibilityLabel={live?'End live':'Go live'} disabled={live?busy||['starting','ending'].includes(streamState):blocked} onPress={live?endBroadcast:()=>void sendControl('start')} style={[s.broadcastButton,{opacity:(live?busy||['starting','ending'].includes(streamState):blocked)?.5:1}]}><Text style={{color:'#fff',fontWeight:'800',fontSize:14}}>{streamState==='starting'?'Starting…':streamState==='ending'?'Ending…':live?'End':'Go live'}</Text></TouchableOpacity>:null}
        </View>:null}
      </LinearGradient>
    </KeyboardAvoidingView>
    <Modal visible={toolsOpen} transparent animationType="slide" onRequestClose={()=>setToolsOpen(false)} onDismiss={()=>{const next=afterToolsClose.current;afterToolsClose.current=null;next?.();}}>
      <View style={s.modalBackdrop}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close stream tools" style={{flex:1}} onPress={()=>setToolsOpen(false)} />
        <View style={[s.sheet,{backgroundColor:t.surface.raised,paddingBottom:Math.max(insets.bottom,16)}]}>
          <View style={{flexDirection:'row',alignItems:'center'}}><Text style={{flex:1,color:t.ink.primary,fontSize:20,fontWeight:'700'}}>Stream tools</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close stream tools" onPress={()=>setToolsOpen(false)} style={s.overlayButton}><Feather name="x" size={24} color={t.ink.primary}/></TouchableOpacity></View>
          <ScrollView contentContainerStyle={{gap:14,paddingBottom:12}} keyboardShouldPersistTaps="handled">
            {button(local?.video?'Camera off':'Camera on',()=>void media('video'))}
            {onGuests?button('Invite and manage guests',()=>closeToolsThen(onGuests),false):null}
            {onMore?button('Polls, clips and details',()=>closeToolsThen(onMore),false):null}
            {canShare?button(sharing?'Stop sharing':'Share screen or game',()=>void media('share')):<Text style={{color:t.ink.secondary}}>Screen sharing is unavailable on this device build.</Text>}
            {canControl?<>{autoDirect?<>{button('Automatic guests',()=>{setAutomatic(true);blockedScene.current='';setSceneRevision(v=>v+1);},false)}<Text style={{color:t.ink.secondary,fontSize:12,lineHeight:18}}>{automatic?'You and accepted guests go on air automatically. Other cameras stay backstage until selected.':'A manual layout is active. Choose Automatic guests to follow guest arrivals.'}</Text></>:null}<Text style={{color:t.ink.primary,fontWeight:'700'}}>Broadcast layout</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>{['host','grid','interview','game','screen'].map(value=><TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{selected:(!autoDirect||!automatic)&&preset===value}} onPress={()=>selectPreset(value)} style={[s.button,{backgroundColor:(!autoDirect||!automatic)&&preset===value?t.ink.primary:t.surface.sunken}]}><Text style={{color:(!autoDirect||!automatic)&&preset===value?t.surface.raised:t.ink.primary,textTransform:'capitalize'}}>{value}</Text></TouchableOpacity>)}</ScrollView><Text style={{color:t.ink.secondary}}>{preset==='grid'?'Choose the guests to put on air.':'Choose the featured camera.'}</Text><View style={s.controls}>{participants.map(p=><TouchableOpacity key={p.session_id} accessibilityRole="button" accessibilityState={{selected:selected.includes(p.user_id||'')}} onPress={()=>{if(!p.user_id)return;automaticPlan.current.enabled=false;setAutomatic(false);setSelected(current=>preset==='grid'?current.includes(p.user_id!)?current.filter(id=>id!==p.user_id):[...current,p.user_id!].slice(0,12):[p.user_id!]);}} style={[s.button,{backgroundColor:selected.includes(p.user_id||'')?t.ink.primary:t.surface.sunken}]}><Text style={{color:selected.includes(p.user_id||'')?t.surface.raised:t.ink.primary}}>{p.local?'Your camera':p.user_name||'Guest camera'}</Text></TouchableOpacity>)}</View>{live?button('Apply layout',()=>void sendControl('scene'),busy||!selected.length):null}</>:null}
            {button('Leave camera',()=>Alert.alert('Leave your camera?', 'Your camera and microphone will disconnect. Use End live to end the broadcast for everyone.',[{text:'Stay',style:'cancel'},{text:'Leave camera',style:'destructive',onPress:()=>{setToolsOpen(false);void stop();}}]),false)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
  return <View style={{ gap: 14 }}>
    <View style={{flexDirection:'row',alignItems:'center',gap:8}}><LiveIcon color={t.ink.primary}/><Text accessibilityRole="header" style={{ color: t.ink.primary, fontWeight: '700', fontSize: 20 }}>{presentation.title}</Text><Text style={{marginLeft:'auto',color:live?'#C43146':t.ink.secondary,fontSize:12,fontWeight:'600'}}>{streamState==='starting'?'Starting…':streamState==='reconnecting'?'Reconnecting…':streamState==='live'?'LIVE':streamState==='ending'?'Ending…':streamState==='ended'?'Ended':streamState==='cancelled'?'Cancelled':'Not live'}</Text></View>
    {joined ? <View style={s.preview}><RemoteCallMedia participants={participants} /></View> : <View style={[s.preview, s.empty, { backgroundColor: t.surface.sunken }]}><LiveIcon size={42} color={t.ink.muted}/><Text style={{ color: t.ink.secondary, textAlign:'center' }}>{['ended','cancelled'].includes(streamState)?'This live has ended.':'Preview your camera and microphone'}</Text>{!['ended','cancelled'].includes(streamState)?button(busy ? 'Connecting…' : 'Preview camera', () => void preview(), busy || (callState !== 'idle' && callState !== 'failed')):null}</View>}
    {joined ? <View style={s.mediaRow}>
      {mediaButton(local?.audio ? 'Mute' : 'Unmute',local?.audio?'mic':'mic-off',()=>void media('audio'))}
      {mediaButton(local?.video ? 'Camera off' : 'Camera on',local?.video?'video':'video-off',()=>void media('video'))}
      {mediaButton('Flip','refresh-cw',()=>void media('flip'))}
      {mediaButton('Leave','log-out',()=>void stop())}
    </View> : null}
    {canControl && joined ? <>
      <TouchableOpacity testID="live-start-button" accessibilityRole="button" accessibilityLabel={live?'End live':'Go live'} disabled={live ? busy || ['starting','ending'].includes(streamState) : blocked} onPress={live ? endBroadcast : ()=>void sendControl('start')} style={[s.primary,{backgroundColor:live?'#B92536':t.ink.primary,opacity:(live?busy||['starting','ending'].includes(streamState):blocked)?0.5:1}]}><LiveIcon color={t.surface.raised}/><Text style={{color:t.surface.raised,fontSize:17,fontWeight:'700'}}>{streamState==='starting'?'Starting…':streamState==='ending'?'Ending…':busy?'Please wait…':live?'End live':'Go live'}</Text></TouchableOpacity>
      <Text accessibilityLiveRegion="polite" style={{color:t.ink.secondary,textAlign:'center',fontSize:12,lineHeight:18}}>{presentation.description}</Text>
    </> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: t.ink.primary, lineHeight: 20 }}>{error}</Text> : null}
    {joined ? <TouchableOpacity accessibilityRole="button" accessibilityState={{expanded:toolsOpen}} onPress={()=>setToolsOpen(!toolsOpen)} style={s.tools}><Feather name="sliders" size={18} color={t.ink.primary}/><Text style={{color:t.ink.primary,flex:1}}>Stream tools</Text><Feather name={toolsOpen?'chevron-up':'chevron-down'} size={18} color={t.ink.secondary}/></TouchableOpacity>:null}
    {joined && toolsOpen ? <View style={{gap:12}}>
      {canShare ? button(sharing ? 'Stop sharing' : 'Share screen or game', () => void media('share')) : <Text style={{ color: t.ink.secondary, fontSize: 12 }}>Screen sharing is unavailable on this device build.</Text>}
      {canControl ? <>
        <Text style={{ color: t.ink.primary, fontWeight: '700' }}>Layout</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{['host','grid','interview','game','screen'].map(value => <TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{ selected: preset === value }} onPress={() => selectPreset(value)} style={[s.button, { borderWidth: 1, borderColor: preset === value ? t.ink.primary : t.surface.sunken }]}><Text style={{ color: t.ink.primary, textTransform: 'capitalize' }}>{value}</Text></TouchableOpacity>)}</ScrollView>
        <Text style={{ color: t.ink.secondary, fontSize: 13 }}>{preset === 'grid' ? 'Select the cameras to put on air.' : 'Choose your featured camera.'}</Text>
        <View style={s.controls}>{participants.map(p => <TouchableOpacity key={p.session_id} accessibilityRole="button" accessibilityState={{ selected: selected.includes(p.user_id || '') }} onPress={() => { if (!p.user_id) return; automaticPlan.current.enabled=false;setAutomatic(false);setSelected(current => preset === 'grid' ? current.includes(p.user_id!) ? current.filter(id => id !== p.user_id) : [...current, p.user_id!].slice(0,12) : [p.user_id!]); }} style={[s.button, { backgroundColor: selected.includes(p.user_id || '') ? t.ink.primary : t.surface.sunken }]}><Text style={{ color: selected.includes(p.user_id || '') ? t.surface.raised : t.ink.primary }}>{p.local ? 'Your camera' : p.user_name || 'Guest camera'}</Text></TouchableOpacity>)}</View>
        {live?button('Apply layout',()=>void sendControl('scene'),busy||!selected.length):null}
      </>:null}
    </View> : null}
  </View>;
}
const s = StyleSheet.create({ immersive:{flex:1,backgroundColor:'#080a10'},overlayButton:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(0,0,0,0.3)'},overlayControls:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:6},broadcastButton:{minHeight:44,paddingHorizontal:16,borderRadius:24,backgroundColor:'#d3274f',alignItems:'center',justifyContent:'center',marginLeft:'auto'},overlayTitle:{color:'#fff',fontSize:18,fontWeight:'700',textAlign:'center'},overlayHint:{color:'#fff',fontSize:12,lineHeight:18,textAlign:'center'},overlayError:{color:'#fff',fontSize:13,lineHeight:19,backgroundColor:'rgba(132,24,44,0.85)',padding:10,borderRadius:12},previewButton:{backgroundColor:'#d3274f',borderRadius:24,paddingHorizontal:24,paddingVertical:13},modalBackdrop:{flex:1,backgroundColor:'rgba(0,0,0,0.4)'},sheet:{maxHeight:'78%',borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,gap:14},preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: 18, overflow: 'hidden', backgroundColor:'#000' }, empty: { alignItems: 'center', justifyContent: 'center', gap: 14, padding:20 }, controls: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, mediaRow:{flexDirection:'row',gap:8},mediaButton:{flex:1,minHeight:62,alignItems:'center',justifyContent:'center',gap:5,borderRadius:12,paddingVertical:8},primary:{minHeight:54,borderRadius:14,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:10,padding:14},tools:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10} });
