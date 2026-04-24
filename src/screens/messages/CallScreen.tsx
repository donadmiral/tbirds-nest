/**
 * CallScreen.tsx
 *
 * Daily.co media backend. Supabase signaling via call_sessions.
 * Renders local + remote video via DailyMediaView.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  StatusBar, Alert, ScrollView, Platform, PermissionsAndroid, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import Daily, {
  DailyCall,
  DailyEvent,
  DailyEventObjectParticipant,
  DailyMediaView,
  DailyParticipant,
} from '@daily-co/react-native-daily-js';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { callService } from '../../services/callService';

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
  const [dailyReady, setDailyReady]   = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
  const [ending, setEnding]           = useState(false);
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);

  const [localParticipant, setLocalParticipant]   = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);

  const callObjRef       = useRef<DailyCall | null>(null);
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

  useEffect(() => {
    if (incomingCallId) {
      callIdRef.current = incomingCallId;
      return;
    }
    if (isIncoming) return;
    if (!profile?.id || !callerId || !channelId) return;

    const myId = profile.id;

    const setup = async (): Promise<string | null> => {
      const sinceIso = new Date(Date.now() - 15000).toISOString();

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

        if (error) break;
        if (data?.id) {
          callIdRef.current = data.id;
          return data.id;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      const rec = await callService.initiateCall({
        callerId: myId,
        receiverId: callerId,
        channelId,
        isVideo,
      });
      if (rec?.id) {
        callIdRef.current = rec.id;
        return rec.id;
      }
      return null;
    };

    setupPromiseRef.current = setup();
  }, [incomingCallId, isIncoming, profile?.id, callerId, channelId, isVideo]);

  useEffect(() => {
    let cancelled = false;

    const refreshParticipants = (call: DailyCall) => {
      try {
        const ps = call.participants();
        const local = ps.local ?? null;
        let remote: DailyParticipant | null = null;
        for (const key of Object.keys(ps)) {
          if (key !== 'local') { remote = (ps as any)[key]; break; }
        }
        setLocalParticipant(local);
        setRemoteParticipant(remote);
      } catch (e) {
        console.log('[PARTICIPANTS_ERR]', e);
      }
    };

    const joinDaily = async () => {
      try {
        console.log('[DAILY_FLOW] starting');

        if (Platform.OS === 'android') {
          const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
          if (isVideo) perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
          await PermissionsAndroid.requestMultiple(perms);
        }

        let callId = callIdRef.current;
        if (!callId && setupPromiseRef.current) {
          callId = await setupPromiseRef.current;
        }
        if (!callId) {
          setErrorMsg('Could not establish call');
          return;
        }
        if (cancelled) return;

        const { roomUrl, token } = await callService.getDailyToken({
          callSessionId: callId,
          isOwner: !isIncoming,
          kind: 'call',
        });
        if (cancelled) return;

        const call = Daily.createCallObject({
          audioSource: true,
          videoSource: isVideo,
          startVideoOff: false,
          startAudioOff: false,
        } as any);
        callObjRef.current = call;

        call.on('joined-meeting' as DailyEvent, () => {
          setDailyReady(true);
          console.log('[DAILY] joined meeting');

          if (isVideo) {
            try {
              call.setLocalVideo(true);
              console.log('[DAILY] force-enabled local video');
            } catch (e: any) {
              console.log('[DAILY] setLocalVideo err', e?.message);
            }
          }
          try {
            call.setLocalAudio(true);
          } catch {}

          refreshParticipants(call);
          if (isIncoming) {
            setConnected(true);
            startTimer();
          }
        });

        call.on('participant-joined' as DailyEvent, (ev: DailyEventObjectParticipant | any) => {
          console.log('[DAILY] participant-joined', ev?.participant?.user_name);
          refreshParticipants(call);
          if (ev?.participant?.local) return;
          setConnected(true);
          startTimer();
          if (callIdRef.current && !isIncoming) {
            callService.acceptCall(callIdRef.current);
          }
        });

        call.on('participant-updated' as DailyEvent, () => {
          refreshParticipants(call);
        });

        call.on('participant-left' as DailyEvent, (ev: DailyEventObjectParticipant | any) => {
          console.log('[DAILY] participant-left');
          refreshParticipants(call);
          if (ev?.participant?.local) return;
          endCall();
        });

        call.on('track-started' as DailyEvent, () => {
          refreshParticipants(call);
        });

        call.on('track-stopped' as DailyEvent, () => {
          refreshParticipants(call);
        });

        call.on('error' as DailyEvent, (ev: any) => {
          console.log('[DAILY_EVENT_ERROR]', JSON.stringify(ev));
          setErrorMsg(ev?.errorMsg || ev?.error?.message || 'Call error');
        });

        call.on('left-meeting' as DailyEvent, () => {
          console.log('[DAILY] left meeting');
        });

        await call.join({
          url: roomUrl,
          token,
          userName: profile?.full_name || 'User',
        });
        console.log('[DAILY_FLOW] join() returned');
      } catch (e: any) {
        console.log('[DAILY_JOIN_ERR]', e?.message || String(e));
        if (!cancelled) setErrorMsg(e?.message || String(e) || 'Could not connect');
      }
    };

    joinDaily();

    return () => {
      cancelled = true;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      const call = callObjRef.current;
      if (call) {
        try { call.leave(); } catch {}
        try { call.destroy(); } catch {}
      }
      callObjRef.current = null;
    };
  }, []);

  const startTimer = () => {
    if (timerRef.current) return;
    callStartMsRef.current = Date.now();
    elapsedRef.current = 0;
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
  };

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

  const endCall = async () => {
    if (endedRef.current) {
      navigation.goBack();
      return;
    }
    endedRef.current = true;
    setEnding(true);

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const call = callObjRef.current;
    if (call) {
      try { await call.leave(); } catch {}
      try { call.destroy(); } catch {}
    }
    callObjRef.current = null;

    if (!callIdRef.current && setupPromiseRef.current) {
      try { await setupPromiseRef.current; } catch {}
    }

    const wall = callStartMsRef.current
      ? Math.floor((Date.now() - callStartMsRef.current) / 1000)
      : 0;
    const duration = Math.max(elapsedRef.current, wall);

    try {
      if (callIdRef.current) {
        await callService.endCall(callIdRef.current, duration);
      }
    } catch (e: any) {
      console.log('[CALL_END_ERR]', e?.message);
    } finally {
      setEnding(false);
      navigation.goBack();
    }
  };

  const toggleMute = () => {
    const call = callObjRef.current; if (!call) return;
    const next = !muted;
    setMuted(next);
    call.setLocalAudio(!next);
  };

  const toggleSpeaker = () => {
    const next = !speaker;
    setSpeaker(next);
  };

  const toggleVideo = () => {
    const call = callObjRef.current; if (!call) return;
    if (!isVideo) {
      Alert.alert('Video', 'This is an audio call. Start a new video call to use video.');
      return;
    }
    const next = !videoOff;
    setVideoOff(next);
    call.setLocalVideo(!next);
  };

  const flipCamera = async () => {
    const call = callObjRef.current; if (!call) return;
    try { await call.cycleCamera(); } catch (e: any) { console.log('[FLIP_CAM_ERR]', e?.message); }
  };

  const viewProfile = () => {
    if (!callerId) return;
    navigation.navigate('UserProfile', { userId: callerId, user: params?.otherUser });
  };

  const onMinimise = () => { endCall(); };

  const remoteHasVideo = !!remoteParticipant?.videoTrack;
  const localHasVideo  = !!localParticipant?.videoTrack && !videoOff;

  if (isVideo) {
    return (
      <View style={s.videoRoot}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        <View style={s.remoteContainer}>
          {remoteHasVideo ? (
            <DailyMediaView
              videoTrack={remoteParticipant?.videoTrack as any}
              audioTrack={remoteParticipant?.audioTrack as any}
              mirror={false}
              zOrder={0}
              objectFit="cover"
              style={s.remoteVideo}
            />
          ) : (
            <View style={s.remoteFallback}>
              {callerAvatar ? (
                <Image source={{ uri: callerAvatar }} style={s.remoteAvatar} />
              ) : (
                <View style={[s.remoteAvatar, { backgroundColor: avatarBg(callerId) }]}>
                  <Text style={s.remoteAvatarTxt}>{initials(callerName)}</Text>
                </View>
              )}
              <Text style={s.videoCallerName}>{callerName}</Text>
              <View style={s.connectingRow}>
                {!errorMsg && !connected && <ActivityIndicator color="rgba(255,255,255,0.8)" />}
                <Text style={s.videoStatus}>
                  {errorMsg ? errorMsg : remoteParticipant ? 'Connecting video...' : connected ? 'Connecting...' : isIncoming ? 'Connecting...' : 'Calling...'}
                </Text>
              </View>
            </View>
          )}
        </View>

        <SafeAreaView style={s.videoTopBar} edges={['top']}>
          <TouchableOpacity onPress={onMinimise} style={s.videoTopBtn}>
            <Feather name="chevron-down" size={24} color="#FFF" />
          </TouchableOpacity>

          <View style={s.videoTopCenter}>
            {connected && (
              <>
                <Text style={s.videoTopName}>{callerName}</Text>
                <Text style={s.videoTopTimer}>{fmtTime(elapsed)}</Text>
              </>
            )}
          </View>

          <TouchableOpacity onPress={flipCamera} style={s.videoTopBtn} disabled={videoOff}>
            <Feather name="refresh-cw" size={22} color={videoOff ? 'rgba(255,255,255,0.3)' : '#FFF'} />
          </TouchableOpacity>
        </SafeAreaView>

        {localHasVideo && (
          <View style={[s.selfView, { top: insets.top + 60 }]}>
            <DailyMediaView
              videoTrack={localParticipant?.videoTrack as any}
              audioTrack={null as any}
              mirror={true}
              zOrder={1}
              objectFit="cover"
              style={s.selfViewInner}
            />
          </View>
        )}

        <SafeAreaView style={s.videoBottomBar} edges={['bottom']}>
          <TouchableOpacity style={[s.videoCtrl, muted && s.videoCtrlActive]} onPress={toggleMute}>
            <Feather name={muted ? 'mic-off' : 'mic'} size={24} color="#FFF" />
          </TouchableOpacity>

          <TouchableOpacity style={[s.videoCtrl, videoOff && s.videoCtrlActive]} onPress={toggleVideo}>
            <Feather name={videoOff ? 'video-off' : 'video'} size={24} color="#FFF" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.videoEndCircle, ending && { opacity: 0.5 }]}
            onPress={endCall}
            disabled={ending}
          >
            <Feather name="phone-off" size={26} color="#FFF" />
          </TouchableOpacity>

          <TouchableOpacity style={[s.videoCtrl, speaker && s.videoCtrlActive]} onPress={toggleSpeaker}>
            <Feather name={speaker ? 'volume-2' : 'volume-x'} size={24} color="#FFF" />
          </TouchableOpacity>

          <TouchableOpacity style={s.videoCtrl} onPress={() => Alert.alert('More', 'Coming soon.')}>
            <Feather name="more-horizontal" size={24} color="#FFF" />
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const controls = [
    { label: muted ? 'Unmute' : 'Mute',             icon: muted    ? 'mic-off'  : 'mic',      active: muted,    onPress: toggleMute },
    { label: speaker ? 'Speaker' : 'Earpiece',      icon: speaker  ? 'volume-2' : 'volume-x', active: speaker,  onPress: toggleSpeaker },
    { label: videoOff ? 'Camera on' : 'Camera off', icon: videoOff ? 'video-off' : 'video',   active: !videoOff && isVideo, onPress: toggleVideo },
    { label: 'Keypad', icon: 'hash', active: false, onPress: () => Alert.alert('Keypad', 'Coming soon.') },
  ] as const;

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
            Voice call
            {!connected ? (isIncoming ? '  -  Incoming' : '  -  Calling...') : ''}
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
            <View style={[s.statusDot, { backgroundColor: errorMsg ? '#EF4444' : connected ? '#22C55E' : '#FF9500' }]} />
            <Text style={[s.statusTxt, connected && s.statusConnected]}>
              {errorMsg ? errorMsg : connected ? 'Connected' : dailyReady ? 'Ringing...' : 'Connecting...'}
            </Text>
            {connected && (
              <View style={s.hdBadge}>
                <Text style={s.hdTxt}>LIVE</Text>
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
              onPress={() => Alert.alert('More', 'Coming soon.')}>
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

  videoRoot:       { flex: 1, backgroundColor: '#000' },
  remoteContainer: { flex: 1, backgroundColor: '#0B1E3D' },
  remoteVideo:     { flex: 1, width: '100%', height: '100%' },
  remoteFallback:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B1E3D' },
  remoteAvatar:    { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  remoteAvatarTxt: { fontSize: 44, fontWeight: '800', color: '#FFF' },
  videoCallerName: { fontSize: 24, fontWeight: '700', color: '#FFF', marginBottom: 14 },
  connectingRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  videoStatus:     { fontSize: 14, color: 'rgba(255,255,255,0.7)' },

  videoTopBar:     { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, backgroundColor: 'rgba(0,0,0,0.35)' },
  videoTopBtn:     { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  videoTopCenter:  { flex: 1, alignItems: 'center' },
  videoTopName:    { fontSize: 15, fontWeight: '700', color: '#FFF' },
  videoTopTimer:   { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },

  selfView:        { position: 'absolute', right: 16, width: 110, height: 160, borderRadius: 14, overflow: 'hidden', backgroundColor: '#222', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  selfViewInner:   { flex: 1, width: '100%', height: '100%' },

  videoBottomBar:  { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 18, paddingHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.55)' },
  videoCtrl:       { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  videoCtrlActive: { backgroundColor: 'rgba(255,255,255,0.4)' },
  videoEndCircle:  { width: 64, height: 64, borderRadius: 32, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
});