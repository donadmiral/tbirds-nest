import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
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

export function LiveStudio({ sessionId, canControl, streamState, onChanged }: { sessionId: string; canControl: boolean; streamState: string; onChanged(): void }) {
  const { t } = useTheme(), { callState } = useCallContext(), playback = useLivePlayback();
  const owner = useAuthStore(s => s.profile?.id ?? null);
  const [participants, setParticipants] = useState<DailyParticipant[]>([]), [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [sharing, setSharing] = useState(false), [canShare, setCanShare] = useState(false);
  const [preset, setPreset] = useState('host'), [selected, setSelected] = useState<string[]>([]);
  const call = useRef<DailyCall | null>(null), generation = useRef(0), mutation = useRef(false), request = useRef<{ signature: string; id: string } | null>(null);
  const stopping=useRef<Promise<void>|null>(null),unregister=useRef<(()=>void)|null>(null);
  const stop = useCallback(():Promise<void> => {
    if(stopping.current)return stopping.current;
    generation.current++; const previous = call.current; call.current = null;
    setJoined(false); setParticipants([]); setSharing(false); setCanShare(false);
    if(!previous)return Promise.resolve();
    const release=unregister.current;unregister.current=null;
    const work=(async()=>{try{previous.stopScreenShare();await settleCallOperation(previous.leave(),2500);}catch{}finally{try{await settleCallOperation(Promise.resolve(previous.destroy()),2500);}catch{}release?.();}})();
    stopping.current=work;void work.finally(()=>{if(stopping.current===work)stopping.current=null;});return work;
  }, []);
  useEffect(() => () => { void stop(); }, [owner, sessionId, stop]);
  useEffect(() => { if (callState !== 'idle' && callState !== 'failed') void stop(); }, [callState, stop]);
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The studio could not connect.'); await stop(); }
    finally { mutation.current = false; setBusy(false); }
  };
  const sendControl = async (action: 'start' | 'stop' | 'scene') => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    const scene: LiveObject = { preset, ...(preset === 'grid' ? { participant_ids: selected } : selected[0] ? { participant_id: selected[0] } : {}) };
    const signature = JSON.stringify([sessionId, action, scene]);
    if (request.current?.signature !== signature) request.current = { signature, id: liveRequestId() };
    try { await liveControl(sessionId, action, request.current.id, action === 'stop' ? undefined : scene); request.current = null; onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The broadcast control was not confirmed.'); }
    finally { mutation.current = false; setBusy(false); }
  };
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
  const live = ['live', 'starting', 'reconnecting'].includes(streamState);
  const local = participants.find(p => p.local);
  return <View style={{ gap: 12 }}>
    <Text style={{ color: t.ink.primary, fontWeight: '800', fontSize: 20 }}>Production studio</Text>
    <Text style={{ color: t.ink.secondary, lineHeight: 20 }}>Your preview stays backstage until the host selects it for the broadcast. Choose cameras or a shared screen before going live.</Text>
    {joined ? <View style={s.preview}><RemoteCallMedia participants={participants} /></View> : <View style={[s.preview, s.empty, { backgroundColor: t.surface.sunken }]}><Text style={{ color: t.ink.secondary }}>Camera and microphone are off</Text>{button(busy ? 'Connecting…' : 'Enter backstage', () => void preview(), busy || (callState !== 'idle' && callState !== 'failed'))}</View>}
    {joined ? <View style={s.controls}>
      {button(local?.audio ? 'Mute microphone' : 'Enable microphone', () => void media('audio'))}
      {button(local?.video ? 'Turn camera off' : 'Turn camera on', () => void media('video'))}
      {button('Switch camera', () => void media('flip'))}
      {canShare ? button(sharing ? 'Stop sharing' : 'Share screen or game', () => void media('share')) : <Text style={{ color: t.ink.secondary, fontSize: 12 }}>Screen capture is unavailable on this device build. Cameras and incoming screen shares remain available.</Text>}
      {button('Leave backstage', () => void stop())}
    </View> : null}
    {canControl && joined ? <>
      <Text style={{ color: t.ink.primary, fontWeight: '700' }}>Broadcast layout</Text>
      <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>{['host','grid','interview','game','screen'].map(value => <TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{ selected: preset === value }} onPress={() => setPreset(value)} style={[s.button, { borderWidth: 1, borderColor: preset === value ? t.ink.primary : t.surface.sunken }]}><Text style={{ color: t.ink.primary, textTransform: 'capitalize' }}>{value}</Text></TouchableOpacity>)}</ScrollView>
      <Text style={{ color: t.ink.secondary, fontSize: 13 }}>{preset === 'grid' ? 'Select each source to put on air.' : 'Select the featured source.'}</Text>
      <View style={s.controls}>{participants.map(p => <TouchableOpacity key={p.session_id} accessibilityRole="button" accessibilityState={{ selected: selected.includes(p.user_id || '') }} onPress={() => { if (!p.user_id) return; setSelected(current => preset === 'grid' ? current.includes(p.user_id!) ? current.filter(id => id !== p.user_id) : [...current, p.user_id!].slice(0,12) : [p.user_id!]); }} style={[s.button, { backgroundColor: selected.includes(p.user_id || '') ? t.ink.primary : t.surface.sunken }]}><Text style={{ color: selected.includes(p.user_id || '') ? t.surface.raised : t.ink.primary }}>{p.local ? 'Your camera' : p.user_name || 'Guest camera'}</Text></TouchableOpacity>)}</View>
      <View style={s.controls}>{button(live ? 'Apply layout' : 'Go live', () => void sendControl(live ? 'scene' : 'start'), busy || !selected.length)}{live ? button('End broadcast', () => Alert.alert('End this broadcast?', 'Viewers will stop receiving live video. Replay availability follows your recording settings.', [{ text: 'Keep streaming', style: 'cancel' }, { text: 'End broadcast', style: 'destructive', onPress: () => void sendControl('stop') }])) : null}</View>
    </> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: t.ink.primary, lineHeight: 20 }}>{error}</Text> : null}
  </View>;
}
const s = StyleSheet.create({ preview: { height: 245, borderRadius: 16, overflow: 'hidden' }, empty: { alignItems: 'center', justifyContent: 'center', gap: 14 }, controls: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center' } });
