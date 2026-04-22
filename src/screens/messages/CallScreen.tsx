/**
 * CallScreen.tsx
 *
 * Writes to `call_sessions` via callService. No direct access to the old
 * `calls` table.
 *
 * Call row ownership: this screen is the source of truth for a call's
 * lifecycle. On mount:
 *   - If params.callId is provided (e.g. from incoming subscription or a
 *     ChatScreen that awaits initiateCall before navigating), use it.
 *   - Otherwise poll call_sessions for up to 5s to adopt a row ChatScreen
 *     may have created after navigating (current user code path).
 *   - If still nothing after 5s, create the row ourselves.
 *
 * endCall awaits the setup promise so hang-up pressed during setup cannot
 * lose the call id.
 *
 * AGORA: still gated by react-native-agora being present. In Expo Go the
 * timer never starts (no remote user joins), so duration_sec writes as 0.
 * That is expected until you prebuild. The DB path below lands regardless.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  StatusBar, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { AGORA_APP_ID, callService } from '../../services/callService';

// Agora: loaded only in native builds, not Expo Go.
const createAgoraRtcEngine: any = null;
const ChannelProfileType: any = {};
const ClientRoleType: any = {};

function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

function fmtTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const AVATAR_COLORS = ['#1D4ED8', '#065F46', '#7C2D12', '#1a3560', '#5856D6', '#C2410C'];
function avatarBg(id?: string) {
  if (!id) return '#1a3560';
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

type SuggestedUser = { id: string; full_name: string; avatar_url: string | null };

export default function CallScreen() {
  const navigation  = useNavigation<any>();
  const route       = useRoute<any>();
  const insets      = useSafeAreaInsets();
  const { profile } = useAuthStore();

  const params        = route.params as any;
  const callerName    = params?.callerName   || params?.otherUser?.full_name || 'User';
  const callerAvatar  = params?.callerAvatar || params?.otherUser?.avatar_url || null;
  const callerId      = params?.otherUser?.id || params?.userId || '';
  const channelId     = params?.channelId || '';
  const incomingCallId = params?.callId ?? null;
  const isIncoming    = params?.isIncoming === true;
  const isVideo       = params?.isVideo === true;

  const [elapsed, setElapsed]         = useState(0);
  const [connected, setConnected]     = useState(false);
  const [muted, setMuted]             = useState(false);
  const [speaker, setSpeaker]         = useState(true);
  const [videoOff, setVideoOff]       = useState(!isVideo);
  const [agoraReady, setAgoraReady]   = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
  const [ending, setEnding]           = useState(false);

  const engineRef        = useRef<any>(null);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartMsRef   = useRef<number | null>(null);
  const callIdRef        = useRef<string | null>(incomingCallId);
  const elapsedRef       = useRef(0);
  const endedRef         = useRef(false);
  const setupPromiseRef  = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    console.log('[CALL_SCREEN_MOUNT]', {
      incomingCallId, isIncoming, isVideo, channelId, callerId, myId: profile?.id,
    });
  }, []);

  // ── Setup: adopt or create the call_sessions row for outgoing calls ────────
  useEffect(() => {
    if (incomingCallId) {
      callIdRef.current = incomingCallId;
      console.log('[CALL_SCREEN_USE_PARAM_ID]', { id: incomingCallId });
      return;
    }
    if (isIncoming) {
      // Incoming calls always come with callId. If we got here without one,
      // something else is wrong. Log and do nothing.
      console.log('[CALL_SCREEN_INCOMING_NO_ID]');
      return;
    }
    if (!profile?.id || !callerId || !channelId) {
      console.log('[CALL_SCREEN_SETUP_SKIP]', {
        hasProfile: !!profile?.id, hasCallerId: !!callerId, hasChannel: !!channelId,
      });
      return;
    }

    const myId = profile.id;

    const setup = async (): Promise<string | null> => {
      const sinceIso = new Date(Date.now() - 15000).toISOString();

      // Poll for a ChatScreen-created row for up to ~4s before creating our
      // own. Network-dependent; typically resolves in <500ms.
      for (let attempt = 0; attempt < 8; attempt++) {
        const { data, error } = await supabase
          .from('call_sessions')
          .select('id')
          .eq('initiator_id', myId)
          .eq('agora_channel', channelId)
          .eq('receiver_id', callerId)
          .eq('status', 'ringing')
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.log('[CALL_SCREEN_ADOPT_ERR]', error.message);
          break;
        }
        if (data?.id) {
          callIdRef.current = data.id;
          console.log('[CALL_SCREEN_ADOPT_OK]', { attempt, id: data.id });
          return data.id;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // No row adopted, create one.
      console.log('[CALL_SCREEN_CREATE_NEW]');
      const rec = await callService.initiateCall({
        callerId: myId,
        receiverId: callerId,
        channelId,
        isVideo,
      });
      if (rec?.id) {
        callIdRef.current = rec.id;
        console.log('[CALL_SCREEN_CREATE_OK]', { id: rec.id });
        return rec.id;
      }
      console.log('[CALL_SCREEN_CREATE_FAIL]');
      return null;
    };

    setupPromiseRef.current = setup();
  }, [incomingCallId, isIncoming, profile?.id, callerId, channelId, isVideo]);

  // ── Agora init (native only) ────────────────────────────────────────────────
  useEffect(() => {
    if (!createAgoraRtcEngine || !AGORA_APP_ID || AGORA_APP_ID === 'YOUR_AGORA_APP_ID_HERE') {
      console.log('[CALL] Agora SDK not available — native build required. Ringing UI only.');
      return;
    }

    let engine: any;
    const init = async () => {
      try {
        engine = createAgoraRtcEngine();
        engineRef.current = engine;

        engine.initialize({
          appId: AGORA_APP_ID,
          channelProfile: ChannelProfileType.ChannelProfileCommunication,
        });

        engine.addListener('onUserJoined', () => { onRemoteUserJoined(); });
        engine.addListener('onUserOffline', () => { endCall(); });
        engine.addListener('onJoinChannelSuccess', () => {
          setAgoraReady(true);
          if (isIncoming) {
            setConnected(true);
            startTimer();
          }
        });
        engine.addListener('onError', (err: number) => { console.log('[AGORA_ERROR]', err); });

        engine.enableAudio();
        if (isVideo) engine.enableVideo();

        await engine.joinChannel('', channelId, 0, {
          clientRoleType: ClientRoleType.ClientRoleBroadcaster,
          publishMicrophoneTrack: true,
          publishCameraTrack: isVideo,
          autoSubscribeAudio: true,
          autoSubscribeVideo: isVideo,
        });

        setAgoraReady(true);
      } catch (e) {
        console.log('[AGORA_INIT_ERR]', e);
      }
    };

    init();

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      try { engineRef.current?.leaveChannel(); engineRef.current?.release(); } catch {}
      engineRef.current = null;
    };
  }, []);

  const onRemoteUserJoined = async () => {
    setConnected(true);
    startTimer();
    if (callIdRef.current) {
      await callService.acceptCall(callIdRef.current);
    }
  };

  const startTimer = () => {
    if (timerRef.current) return;
    callStartMsRef.current = Date.now();
    elapsedRef.current = 0;
    console.log('[CALL_TIMER_START]', { at: callStartMsRef.current, callId: callIdRef.current });
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
  };

  // Suggested contacts
  useEffect(() => {
    if (!profile?.id || !callerId) return;
    supabase
      .from('connections')
      .select('requester_id, recipient_id')
      .or(`requester_id.eq.${profile.id},recipient_id.eq.${profile.id}`)
      .eq('status', 'accepted')
      .then(async ({ data }) => {
        if (!data?.length) return;
        const ids = data
          .map((r: any) => r.requester_id === profile.id ? r.recipient_id : r.requester_id)
          .filter((id: string) => id !== callerId)
          .slice(0, 3);
        if (!ids.length) return;
        const { data: ps } = await supabase
          .from('profiles').select('id, full_name, avatar_url').in('id', ids);
        setSuggestions((ps || []) as SuggestedUser[]);
      })
      .catch(() => {});
  }, [profile?.id, callerId]);

  // ── End call ────────────────────────────────────────────────────────────────
  const endCall = async () => {
    if (endedRef.current) {
      console.log('[CALL_END_SKIP] already ended');
      navigation.goBack();
      return;
    }
    endedRef.current = true;
    setEnding(true);

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { engineRef.current?.leaveChannel(); engineRef.current?.release(); } catch {}
    engineRef.current = null;

    // CRITICAL: await the setup promise so hang-up during setup cannot
    // lose the call id.
    if (!callIdRef.current && setupPromiseRef.current) {
      console.log('[CALL_END_AWAIT_SETUP]');
      try { await setupPromiseRef.current; } catch {}
    }

    const wall = callStartMsRef.current
      ? Math.floor((Date.now() - callStartMsRef.current) / 1000)
      : 0;
    const duration = Math.max(elapsedRef.current, wall);

    console.log('[CALL_END_PRESS]', {
      callId: callIdRef.current,
      elapsedFromInterval: elapsedRef.current,
      elapsedFromWallClock: wall,
      durationUsed: duration,
      connected,
    });

    try {
      if (callIdRef.current) {
        const ok = await callService.endCall(callIdRef.current, duration);
        console.log('[CALL_END_WRITE_RESULT]', { ok });

        const fresh = await callService.getCall(callIdRef.current);
        console.log('[CALL_END_VERIFY]', {
          id: fresh?.id,
          status: fresh?.status,
          ended_at: fresh?.ended_at,
          duration_secs: fresh?.duration_secs,
        });
        if (!fresh || fresh.status !== 'ended') {
          console.log('[CALL_END_VERIFY_FAIL] row did not update as expected');
        }
      } else {
        console.log('[CALL_END_SKIP] no callId after awaiting setup');
      }
    } catch (e: any) {
      console.log('[CALL_END_CATCH]', e?.message);
    } finally {
      setEnding(false);
      navigation.goBack();
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    engineRef.current?.muteLocalAudioStream(next);
  };

  const toggleSpeaker = () => {
    const next = !speaker;
    setSpeaker(next);
    engineRef.current?.setEnableSpeakerphone(next);
  };

  const toggleVideo = () => {
    if (!isVideo) { Alert.alert('Video', 'This is an audio call. Start a new video call to use video.'); return; }
    const next = !videoOff;
    setVideoOff(next);
    engineRef.current?.muteLocalVideoStream(next);
  };

  const controls = [
    { label: muted ? 'Unmute' : 'Mute',             icon: muted    ? 'mic-off'  : 'mic',      active: muted,    onPress: toggleMute },
    { label: speaker ? 'Speaker' : 'Earpiece',      icon: speaker  ? 'volume-2' : 'volume-x', active: speaker,  onPress: toggleSpeaker },
    { label: videoOff ? 'Camera on' : 'Camera off', icon: videoOff ? 'video-off' : 'video',   active: !videoOff && isVideo, onPress: toggleVideo },
    { label: 'Keypad', icon: 'hash', active: false, onPress: () => Alert.alert('Keypad', 'Dial-tone keypad coming soon.') },
  ] as const;

  const viewProfile = () => {
    if (!callerId) return;
    navigation.navigate('UserProfile', { userId: callerId, user: params?.otherUser });
  };

  const onMinimise = () => { endCall(); };

  return (
    <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#0B1E3D" />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} scrollEnabled={false}>

        <View style={[s.hero, { paddingTop: insets.top + 16 }]}>
          <TouchableOpacity
            onPress={onMinimise}
            style={s.backBtn} activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Feather name="chevron-down" size={22} color="rgba(255,255,255,0.6)" />
            <Text style={s.backTxt}>End & close</Text>
          </TouchableOpacity>

          <Text style={s.callTypeLabel}>
            {isVideo ? '🎬  Video call' : '📞  Voice call'}
            {!connected ? (isIncoming ? '  ·  Incoming' : '  ·  Calling...') : ''}
          </Text>

          <TouchableOpacity onPress={viewProfile} style={s.avatarWrap} activeOpacity={0.85}>
            {callerAvatar
              ? <Image source={{ uri: callerAvatar }} style={s.avatar} />
              : <View style={[s.avatar, { backgroundColor: avatarBg(callerId) }]}>
                  <Text style={s.avatarTxt}>{initials(callerName)}</Text>
                </View>}
          </TouchableOpacity>

          <Text style={s.callerName}>{callerName}</Text>

          <View style={s.statusRow}>
            <View style={[s.statusDot, { backgroundColor: connected ? '#22C55E' : '#FF9500' }]} />
            <Text style={[s.statusTxt, connected && s.statusConnected]}>
              {connected ? 'Connected' : 'Ringing...'}
            </Text>
            {connected && (
              <View style={s.hdBadge}>
                <Text style={s.hdTxt}>{agoraReady ? 'LIVE' : 'HD'}</Text>
              </View>
            )}
          </View>

          <Text style={s.timer}>{fmtTime(elapsed)}</Text>
        </View>

        <View style={s.bottom}>
          <View style={s.controlsGrid}>
            {controls.map(ctrl => (
              <TouchableOpacity
                key={ctrl.label}
                style={s.ctrl}
                onPress={ctrl.onPress}
                activeOpacity={0.75}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <View style={[s.ctrlCircle, ctrl.active && s.ctrlCircleActive]}>
                  <Feather name={ctrl.icon as any} size={22} color={ctrl.active ? '#FFF' : '#1A1A1A'} />
                </View>
                <Text style={s.ctrlLabel}>{ctrl.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {suggestions.length > 0 && (
            <View style={s.addSection}>
              <Text style={s.addTitle}>Add to call</Text>
              {suggestions.map(user => (
                <TouchableOpacity key={user.id} style={s.addRow} activeOpacity={0.8}
                  onPress={() => Alert.alert('Add to call', `${user.full_name} will be notified.`)}>
                  {user.avatar_url
                    ? <Image source={{ uri: user.avatar_url }} style={s.addAvatar} />
                    : <View style={[s.addAvatar, { backgroundColor: avatarBg(user.id) }]}>
                        <Text style={s.addAvatarTxt}>{initials(user.full_name)}</Text>
                      </View>}
                  <View style={{ flex: 1 }}>
                    <Text style={s.addName}>{user.full_name}</Text>
                    <Text style={s.addSub}>Tap to add</Text>
                  </View>
                  <View style={s.addPlusBtn}>
                    <Feather name="user-plus" size={15} color="#FFF" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={[s.bottomRow, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <TouchableOpacity style={s.sideCircle} activeOpacity={0.8}
              onPress={() => navigation.navigate('CallLog')}>
              <Feather name="clock" size={22} color="#1A1A1A" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.endCircle, ending && { opacity: 0.5 }]}
              onPress={endCall}
              activeOpacity={0.85}
              disabled={ending}
            >
              <Feather name="phone-off" size={26} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity style={s.sideCircle} activeOpacity={0.8}
              onPress={() => Alert.alert('More', 'Hold, transfer, record — coming soon.')}>
              <Feather name="more-horizontal" size={22} color="#1A1A1A" />
            </TouchableOpacity>
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const NAVY = '#0B1E3D';

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: NAVY },
  hero:           { backgroundColor: NAVY, paddingHorizontal: 24, paddingBottom: 32, alignItems: 'center' },
  backBtn:        { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, paddingVertical: 4 },
  backTxt:        { fontSize: 14, color: 'rgba(255,255,255,0.45)', fontWeight: '500' },
  callTypeLabel:  { fontSize: 12, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(255,255,255,0.35)', marginBottom: 20, textTransform: 'uppercase' },
  avatarWrap:     { marginBottom: 16 },
  avatar:         { width: 88, height: 88, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarTxt:      { fontSize: 32, fontWeight: '800', color: '#FFF' },
  callerName:     { fontSize: 26, fontWeight: '800', color: '#FFF', letterSpacing: -0.5, marginBottom: 10, textAlign: 'center' },
  statusRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  statusDot:      { width: 8, height: 8, borderRadius: 4 },
  statusTxt:      { fontSize: 14, color: 'rgba(255,255,255,0.45)', fontWeight: '600' },
  statusConnected:{ color: '#22C55E' },
  hdBadge:        { backgroundColor: 'rgba(34,197,94,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)' },
  hdTxt:          { fontSize: 11, fontWeight: '700', color: '#22C55E' },
  timer:          { fontSize: 48, fontWeight: '200', color: '#FFF', letterSpacing: 4 },
  bottom:         { flex: 1, backgroundColor: '#FFF', paddingTop: 28 },
  controlsGrid:   { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, marginBottom: 16 },
  ctrl:           { alignItems: 'center', gap: 8, minWidth: 60 },
  ctrlCircle:     { width: 60, height: 60, borderRadius: 20, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  ctrlCircleActive: { backgroundColor: NAVY },
  ctrlLabel:      { fontSize: 11, fontWeight: '600', color: '#8E8E93', textAlign: 'center' },
  addSection:     { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0F0F0' },
  addTitle:       { fontSize: 11, fontWeight: '700', color: '#8E8E93', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  addRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F5F5F5' },
  addAvatar:      { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  addAvatarTxt:   { fontSize: 14, fontWeight: '800', color: '#FFF' },
  addName:        { fontSize: 14, fontWeight: '600', color: '#000' },
  addSub:         { fontSize: 12, color: '#8E8E93', marginTop: 1 },
  addPlusBtn:     { width: 38, height: 38, borderRadius: 12, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  bottomRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 36, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0F0F0' },
  sideCircle:     { width: 64, height: 64, borderRadius: 22, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  endCircle:      { width: 68, height: 68, borderRadius: 24, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', shadowColor: '#EF4444', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
});