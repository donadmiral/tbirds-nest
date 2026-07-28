/**
 * CallScreen.tsx
 *
 * Audio call: bottom controls pinned to bottom using flex layout.
 * Video call: unchanged from working version.
 * All call logic driven by CallContext state machine.
 *
 * CHANGE: Removed local ringback/Audio.Sound code.
 * Ringback is now managed by CallContext via audioService.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  StatusBar, Alert, ScrollView, ActivityIndicator, Modal, Vibration,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { DailyMediaView } from '@daily-co/react-native-daily-js';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { useCallContext } from '../../contexts/CallContext';

function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}
function fmtTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
const AVATAR_COLORS = ['#1D4ED8', '#065F46', '#7C2D12', '#1a3560', '#5856D6', '#C2410C'];
function avatarBg(id?: string) {
  if (!id) return '#1a3560';
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
const KEYPAD_ROWS = [['1','2','3'],['4','5','6'],['7','8','9'],['*','0','#']];
type SuggestedUser = { id: string; full_name: string; avatar_url: string | null };

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

export default function CallScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const ctx = useCallContext();
  const {
    callState, activeCall, elapsed, muted, videoOff, held, speakerOn,
    networkQuality, connected, dailyReady, errorMsg, localParticipant,
    remoteParticipant, remoteParticipants, wasEverActive,
    startCall, endCall, clearCallState,
    toggleMute, toggleVideo, toggleHold, toggleSpeaker, flipCamera,
  } = ctx;

  const params = route.params as any;
  const callerName = activeCall?.otherUserName || params?.callerName || params?.otherUser?.full_name || 'User';
  const callerAvatar = activeCall?.otherUserAvatar || params?.callerAvatar || params?.otherUser?.avatar_url || null;
  const callerId = activeCall?.otherUserId || params?.otherUser?.id || params?.userId || '';
  const channelId = activeCall?.channelId || params?.channelId || params?.callId || '';
  const isVideo = activeCall?.isVideo ?? params?.isVideo ?? false;
  const isIncoming = activeCall?.isIncoming ?? params?.isIncoming ?? false;
  const isGroupCall = activeCall?.isGroupCall ?? params?.isGroupCall ?? false;
  const groupCallName = params?.groupName || params?.callerName || 'Group Call';
  const fromContext = params?.fromContext === true || params?.fromMiniBar === true;

  const [showKeypad, setShowKeypad] = useState(false);
  const [dtmfDigits, setDtmfDigits] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (fromContext) return;
    if (startedRef.current) return;
    if (callState !== 'idle') return;
    if (!channelId) return;
    if (!callerId && !isGroupCall) return;
    startedRef.current = true;
    startCall({
      callId: params?.callId ?? null, channelId,
      otherUserId: callerId, otherUserName: isGroupCall ? groupCallName : callerName,
      otherUserAvatar: isGroupCall ? null : callerAvatar, isVideo, isIncoming,
      isGroupCall, conversationId: params?.conversationId ?? null,
    });
  }, [fromContext, callState, callerId, channelId, isGroupCall]);

  useEffect(() => {
    if (!isGroupCall || !params?.callId) return;
    supabase.rpc('join_group_call', { p_session_id: params.callId }).then(() => {}, (e: any) => console.log('[JOIN] join_group_call failed:', e?.message));
    // leave_group_call moved to CallContext.endCall teardown: leaving the SCREEN
    // must not leave the CALL (the mini bar keeps it alive).
  }, []);

  useEffect(() => {
    if (callState === 'idle' && wasEverActive) {
      const t = setTimeout(() => {
        if (navigation.canGoBack()) navigation.goBack();
        setTimeout(() => { clearCallState(); }, 200);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [callState, wasEverActive]);

  useEffect(() => {
    if (!profile?.id || !callerId) return;
    supabase.from('follows').select('following_id')
      .eq('follower_id', profile.id)
      .then(async ({ data }) => {
        if (!data?.length) return;
        const ids = data.map((r: any) => r.following_id)
          .filter((id: string) => id !== callerId).slice(0, 3);
        if (!ids.length) return;
        const { data: ps } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', ids);
        setSuggestions((ps || []) as SuggestedUser[]);
      })// @ts-ignore
.then(() => {}).catch(() => {});
  }, [profile?.id, callerId]);

  const pressKeypadDigit = (digit: string) => { setDtmfDigits(prev => prev + digit); Vibration.vibrate(30); };
  const onMinimise = () => { if (navigation.canGoBack()) navigation.goBack(); };
  const viewProfile = () => { if (callerId) navigation.navigate('UserProfile', { userId: callerId }); };

  const remoteHasVideo = !!remoteParticipant?.videoTrack;
  const localHasVideo = !!localParticipant?.videoTrack && !videoOff;
  const ending = callState === 'ending';

  // Derive status text from callState
  const statusText = errorMsg
    || (callState === 'active' ? 'Connected'
    : callState === 'degraded' ? 'Poor connection'
    : callState === 'reconnecting' ? 'Reconnecting...'
    : callState === 'connecting' ? 'Connecting...'
    : callState === 'ringing' ? 'Ringing...'
    : callState === 'initiating' ? 'Connecting...'
    : callState === 'ending' ? 'Ending...'
    : callState === 'failed' ? (errorMsg || 'Call failed')
    : '');

  const statusDotColor = errorMsg ? '#EF4444'
    : callState === 'active' ? '#22C55E'
    : callState === 'degraded' ? '#FF9500'
    : callState === 'reconnecting' ? '#EF4444'
    : '#FF9500';

  // VIDEO CALL UI
  if (isVideo) {
    return (
      <View style={s.videoRoot}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        <View style={s.remoteContainer}>
          {isGroupCall && remoteParticipants.length > 0 ? (
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap' }}>
              {remoteParticipants.map((p: any, i: number) => (
                <View key={p.session_id || i} style={{ width: remoteParticipants.length === 1 ? '100%' : '50%', height: remoteParticipants.length <= 2 ? '100%' : '50%', backgroundColor: '#111' }}>
                  <DailyMediaView videoTrack={p.videoTrack as any} audioTrack={p.audioTrack as any} mirror={false} zOrder={0} objectFit="cover" style={{ flex: 1 }} />
                </View>
              ))}
            </View>
          ) : remoteHasVideo ? (
            <DailyMediaView videoTrack={remoteParticipant?.videoTrack as any}
              audioTrack={remoteParticipant?.audioTrack as any}
              mirror={false} zOrder={0} objectFit="cover" style={s.remoteVideo} />
          ) : (
            <View style={s.remoteFallback}>
              {callerAvatar ? <Image source={{ uri: callerAvatar }} style={s.remoteAvatar} />
                : <View style={[s.remoteAvatar, { backgroundColor: avatarBg(callerId) }]}>
                    <Text style={s.remoteAvatarTxt}>{initials(callerName)}</Text></View>}
              <Text style={s.videoCallerName}>{callerName}</Text>
              <View style={s.connectingRow}>
                {!errorMsg && !connected && <ActivityIndicator color="rgba(255,255,255,0.8)" />}
                <Text style={s.videoStatus}>{statusText}</Text>
              </View>
            </View>
          )}
        </View>

        {localHasVideo && (
          <View style={[s.selfView, { top: insets.top + 56 }]} pointerEvents="none">
            <DailyMediaView videoTrack={localParticipant?.videoTrack as any} audioTrack={null as any}
              mirror={true} zOrder={1} objectFit="cover" style={s.selfViewInner} />
          </View>
        )}

        <LinearGradient
          pointerEvents='none'
          colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0)']}
          style={[s.callScrimTop, { height: insets.top + 96 }]}
        />
        <View style={[s.videoTopBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={onMinimise} style={s.videoTopBtn} hitSlop={HIT} activeOpacity={0.7}>
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
          <TouchableOpacity onPress={flipCamera} style={s.videoTopBtn} disabled={videoOff} hitSlop={HIT} activeOpacity={0.7}>
            <Ionicons name="camera-reverse" size={22} color={videoOff ? 'rgba(255,255,255,0.3)' : '#FFF'} />
          </TouchableOpacity>
        </View>

        <LinearGradient
          pointerEvents='none'
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']}
          style={[s.callScrimBottom, { height: Math.max(insets.bottom, 16) + 150 }]}
        />
        <View style={[s.videoBottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <TouchableOpacity style={[s.videoCtrl, muted && s.videoCtrlActive]} onPress={toggleMute} hitSlop={HIT} activeOpacity={0.7}>
            <Ionicons name={muted ? 'mic-off' : 'mic'} size={24} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity style={[s.videoCtrl, videoOff && s.videoCtrlActive]} onPress={toggleVideo} hitSlop={HIT} activeOpacity={0.7}>
            <Ionicons name={videoOff ? 'videocam-off' : 'videocam'} size={24} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity style={[s.videoEndCircle, ending && { opacity: 0.5 }]} onPress={endCall} disabled={ending} hitSlop={HIT} activeOpacity={0.7}>
            <Ionicons name="call" size={27} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>
          <TouchableOpacity style={s.videoCtrl} onPress={flipCamera} disabled={videoOff} hitSlop={HIT} activeOpacity={0.7}>
            <Ionicons name="camera-reverse" size={22} color={videoOff ? 'rgba(255,255,255,0.3)' : '#FFF'} />
          </TouchableOpacity>
          <TouchableOpacity style={s.videoCtrl} onPress={() => setShowMore(true)} hitSlop={HIT} activeOpacity={0.7}>
            <Ionicons name="ellipsis-horizontal" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>

        <MoreMenu visible={showMore} onClose={() => setShowMore(false)} muted={muted} held={held} isVideo={isVideo}
          speakerOn={speakerOn} onMute={toggleMute} onFlip={flipCamera} onHold={toggleHold} onSpeaker={toggleSpeaker} />
      </View>
    );
  }

  // AUDIO CALL UI
  const controls = [
    { label: muted ? 'Unmute' : 'Mute', icon: muted ? 'mic-off' : 'mic', active: muted, onPress: toggleMute },
    // icon names below are Ionicons
    { label: 'Speaker', icon: 'volume-high', active: speakerOn, onPress: toggleSpeaker },
    { label: held ? 'Resume' : 'Hold', icon: held ? 'play' : 'pause', active: held, onPress: toggleHold },
    { label: 'More', icon: 'ellipsis-horizontal', active: false, onPress: () => setShowMore(true) },
  ] as const;

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0B1E3D" />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} bounces={false}>
        <View style={[s.hero, { paddingTop: insets.top + 16 }]}>
          <TouchableOpacity onPress={onMinimise} style={s.backBtn} activeOpacity={0.7} hitSlop={HIT}>
            <Feather name="chevron-down" size={22} color="rgba(255,255,255,0.6)" /><Text style={s.backTxt}>Minimize</Text></TouchableOpacity>
          <Text style={s.callTypeLabel}>{isGroupCall ? 'Group' : 'Voice'} call{!connected ? (isIncoming ? '  -  Incoming' : '  -  Calling...') : ''}</Text>
          <TouchableOpacity onPress={isGroupCall ? undefined : viewProfile} style={s.avatarWrap} activeOpacity={0.85} disabled={isGroupCall}>
            {isGroupCall
              ? <View style={[s.avatar, { backgroundColor: '#1a3560' }]}><Feather name="users" size={36} color="#FFF" /></View>
              : callerAvatar ? <Image source={{ uri: callerAvatar }} style={s.avatar} />
              : <View style={[s.avatar, { backgroundColor: avatarBg(callerId) }]}><Text style={s.avatarTxt}>{initials(callerName)}</Text></View>}
          </TouchableOpacity>
          <Text style={s.callerName}>{isGroupCall ? groupCallName : callerName}</Text>
          {isGroupCall && remoteParticipants.length > 0 && (
            <Text style={s.groupParticipantCount}>{remoteParticipants.length + 1} in call</Text>
          ) || null}
          {isGroupCall && remoteParticipants.length > 0 && (
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, textAlign: 'center', marginTop: 2 }} numberOfLines={2}>
              You{remoteParticipants.map((p: any) => p.user_name ? ', ' + String(p.user_name).split(' ')[0] : '').join('')}
            </Text>
          )}
          
          <View style={s.statusRow}>
            <View style={[s.statusDot, { backgroundColor: statusDotColor }]} />
            <Text style={[s.statusTxt, connected && s.statusConnected]}>{statusText}</Text>
            {connected && <View style={s.hdBadge}><Text style={s.hdTxt}>LIVE</Text></View>}
            {connected && networkQuality && (
              <View style={s.qualityBadge}>
                <Feather name="wifi" size={12} color={
                  networkQuality === 'excellent' || networkQuality === 'good' ? '#22C55E'
                  : networkQuality === 'low' ? '#FF9500' : '#EF4444'
                } />
              </View>
            )}
          </View>
          {(callState === 'degraded' || callState === 'reconnecting') && (
            <View style={[s.networkBanner, callState === 'reconnecting' && s.networkBannerRed]}>
              <Feather name={callState === 'reconnecting' ? 'wifi-off' : 'alert-triangle'} size={14}
                color={callState === 'reconnecting' ? '#FEE2E2' : '#FEF3C7'} />
              <Text style={[s.networkBannerTxt, callState === 'reconnecting' && s.networkBannerTxtRed]}>
                {callState === 'reconnecting' ? 'Reconnecting...' : 'Poor connection'}
              </Text>
            </View>
          )}
          <Text style={s.timer}>{fmtTime(elapsed)}</Text>
        </View>
        <View style={s.middle}>
          <View style={s.controlsGrid}>
            {controls.map(ctrl => (
              <TouchableOpacity key={ctrl.label} style={s.ctrl} onPress={ctrl.onPress} activeOpacity={0.75} hitSlop={HIT}>
                <View style={[s.ctrlCircle, ctrl.active && s.ctrlCircleActive]}>
                  <Ionicons name={ctrl.icon as any} size={23} color={ctrl.active ? '#FFF' : '#1A1A1A'} /></View>
                <Text style={s.ctrlLabel}>{ctrl.label}</Text></TouchableOpacity>))}
          </View>
          {suggestions.length > 0 && (
            <View style={s.addSection}><Text style={s.addTitle}>Add to call</Text>
              {suggestions.map(user => (
                <TouchableOpacity key={user.id} style={s.addRow} activeOpacity={0.8}
                  onPress={() => Alert.alert('Add to call', `${user.full_name} will be notified.`)}>
                  {user.avatar_url ? <Image source={{ uri: user.avatar_url }} style={s.addAvatar} />
                    : <View style={[s.addAvatar, { backgroundColor: avatarBg(user.id) }]}><Text style={s.addAvatarTxt}>{initials(user.full_name)}</Text></View>}
                  <View style={{ flex: 1 }}><Text style={s.addName}>{user.full_name}</Text><Text style={s.addSub}>Tap to add</Text></View>
                  <View style={s.addPlusBtn}><Feather name="user-plus" size={15} color="#FFF" /></View></TouchableOpacity>))}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[s.pinnedBottom, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <TouchableOpacity style={s.sideCircle} activeOpacity={0.8} onPress={() => navigation.navigate('CallLog')} hitSlop={HIT}>
          <Feather name="clock" size={22} color="#1A1A1A" /></TouchableOpacity>
        <TouchableOpacity style={[s.endCircle, ending && { opacity: 0.5 }]} onPress={endCall} activeOpacity={0.85} disabled={ending} hitSlop={HIT}>
          <Ionicons name="call" size={27} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} /></TouchableOpacity>
        <TouchableOpacity style={s.sideCircle} activeOpacity={0.8} onPress={onMinimise} hitSlop={HIT}>
          <Feather name="minimize-2" size={22} color="#1A1A1A" /></TouchableOpacity>
      </View>

      <Modal visible={showKeypad} transparent animationType="slide" onRequestClose={() => setShowKeypad(false)}>
        <TouchableOpacity style={s.sheetOverlay} activeOpacity={1} onPress={() => setShowKeypad(false)}>
          <View style={s.keypadSheet}><View style={s.sheetHandle} />
            <Text style={s.keypadTitle}>Dial Pad (local only)</Text>
            <Text style={s.keypadDisplay}>{dtmfDigits || '\u00A0'}</Text>
            {KEYPAD_ROWS.map((row, ri) => (<View key={ri} style={s.keypadRow}>{row.map(digit => (
              <TouchableOpacity key={digit} style={s.keypadBtn} onPress={() => pressKeypadDigit(digit)} activeOpacity={0.6}>
                <Text style={s.keypadDigit}>{digit}</Text></TouchableOpacity>))}</View>))}
            <TouchableOpacity style={s.keypadDone} onPress={() => setShowKeypad(false)}><Text style={s.keypadDoneTxt}>Done</Text></TouchableOpacity>
          </View></TouchableOpacity>
      </Modal>
      <MoreMenu visible={showMore} onClose={() => setShowMore(false)} muted={muted} held={held} isVideo={isVideo}
        speakerOn={speakerOn} onMute={toggleMute} onFlip={flipCamera} onHold={toggleHold} onSpeaker={toggleSpeaker} />
    </View>
  );
}

function MoreMenu({ visible, onClose, muted, held, isVideo, speakerOn, onMute, onFlip, onHold, onSpeaker }: {
  visible: boolean; onClose: () => void; muted: boolean; held: boolean;
  isVideo: boolean; speakerOn: boolean;
  onMute: () => void; onFlip: () => void; onHold: () => void; onSpeaker: () => void;
}) {
  if (!visible) return null;
  const actions = [
    { icon: muted ? 'mic-off' : 'mic', label: muted ? 'Unmute' : 'Mute', active: muted, onPress: () => { onMute(); onClose(); } },
    { icon: 'volume-2', label: 'Speaker', active: speakerOn, onPress: () => { onSpeaker(); onClose(); } },
    ...(isVideo ? [{ icon: 'refresh-cw', label: 'Flip Camera', active: false, onPress: () => { onFlip(); onClose(); } }] : []),
    { icon: held ? 'play' : 'pause', label: held ? 'Resume Call' : 'Hold Call', active: held, onPress: () => { onHold(); onClose(); } },
  ];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.sheetOverlay} activeOpacity={1} onPress={onClose}>
        <View style={s.moreSheet}><View style={s.sheetHandle} />
          <Text style={s.moreTitle}>Call Options</Text>
          {actions.map((a, i) => (
            <TouchableOpacity key={i} style={s.moreRow} onPress={a.onPress} activeOpacity={0.7}>
              <View style={[s.moreIcon, a.active && { backgroundColor: '#0B1E3D' }]}>
                <Feather name={a.icon as any} size={20} color={a.active ? '#FFF' : '#1A1A1A'} /></View>
              <Text style={s.moreLabel}>{a.label}</Text>
              {a.active && <View style={s.moreCheck}><Feather name="check" size={16} color="#22C55E" /></View>}
            </TouchableOpacity>))}
        </View></TouchableOpacity>
    </Modal>
  );
}

const NAVY = '#0B1E3D';
const s = StyleSheet.create({
  callScrimTop:{position:'absolute',top:0,left:0,right:0},
  callScrimBottom:{position:'absolute',bottom:0,left:0,right:0},
  safe:{flex:1,backgroundColor:'#FFF'},
  hero:{backgroundColor:NAVY,paddingHorizontal:24,paddingBottom:32,alignItems:'center'},
  backBtn:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:6,marginBottom:16,paddingVertical:4},backTxt:{fontSize:14,color:'rgba(255,255,255,0.45)',fontWeight:'500'},
  callTypeLabel:{fontSize:12,fontWeight:'700',letterSpacing:1.5,color:'rgba(255,255,255,0.35)',marginBottom:20,textTransform:'uppercase'},
  avatarWrap:{marginBottom:16},avatar:{width:88,height:88,borderRadius:28,alignItems:'center',justifyContent:'center'},avatarTxt:{fontSize:32,fontWeight:'800',color:'#FFF'},
  callerName:{fontSize:26,fontWeight:'800',color:'#FFF',letterSpacing:-0.5,marginBottom:10,textAlign:'center'},
  groupParticipantCount:{fontSize:13,fontWeight:'600',color:'rgba(255,255,255,0.5)',marginBottom:4},
  statusRow:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:16},statusDot:{width:8,height:8,borderRadius:4},
  statusTxt:{fontSize:14,color:'rgba(255,255,255,0.45)',fontWeight:'600'},statusConnected:{color:'#22C55E'},
  hdBadge:{backgroundColor:'rgba(34,197,94,0.15)',borderRadius:6,paddingHorizontal:8,paddingVertical:3,borderWidth:1,borderColor:'rgba(34,197,94,0.25)'},
  hdTxt:{fontSize:11,fontWeight:'700',color:'#22C55E'},
  qualityBadge:{marginLeft:4},
  networkBanner:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:'rgba(245,158,11,0.15)',borderRadius:10,paddingHorizontal:14,paddingVertical:8,marginBottom:12,borderWidth:1,borderColor:'rgba(245,158,11,0.25)'},
  networkBannerRed:{backgroundColor:'rgba(239,68,68,0.15)',borderColor:'rgba(239,68,68,0.25)'},
  networkBannerTxt:{fontSize:13,fontWeight:'600',color:'#FEF3C7'},
  networkBannerTxtRed:{color:'#FEE2E2'},
  timer:{fontSize:48,fontWeight:'200',color:'#FFF',letterSpacing:4},
  middle:{flex:1,backgroundColor:'#FFF',paddingTop:28},
  controlsGrid:{flexDirection:'row',justifyContent:'space-around',paddingHorizontal:12,marginBottom:16},
  ctrl:{alignItems:'center',gap:8,minWidth:60},ctrlCircle:{width:62,height:62,borderRadius:31,backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  ctrlCircleActive:{backgroundColor:NAVY},ctrlLabel:{fontSize:11,fontWeight:'600',color:'#8E8E93',textAlign:'center'},
  addSection:{paddingHorizontal:20,paddingTop:12,paddingBottom:8,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#F0F0F0'},
  addTitle:{fontSize:11,fontWeight:'700',color:'#8E8E93',letterSpacing:1,textTransform:'uppercase',marginBottom:10},
  addRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:9,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#F5F5F5'},
  addAvatar:{width:40,height:40,borderRadius:13,alignItems:'center',justifyContent:'center'},addAvatarTxt:{fontSize:14,fontWeight:'800',color:'#FFF'},
  addName:{fontSize:14,fontWeight:'600',color:'#000'},addSub:{fontSize:12,color:'#8E8E93',marginTop:1},
  addPlusBtn:{width:38,height:38,borderRadius:12,backgroundColor:NAVY,alignItems:'center',justifyContent:'center'},
  pinnedBottom:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:36,paddingTop:20,backgroundColor:'#FFF',borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#F0F0F0'},
  sideCircle:{width:64,height:64,borderRadius:22,backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  endCircle:{width:68,height:68,borderRadius:24,backgroundColor:'#EF4444',alignItems:'center',justifyContent:'center',shadowColor:'#EF4444',shadowOpacity:0.35,shadowRadius:14,shadowOffset:{width:0,height:5},elevation:8},

  videoRoot:{flex:1,backgroundColor:'#000'},
  remoteContainer:{...StyleSheet.absoluteFillObject,backgroundColor:NAVY},
  remoteVideo:{flex:1,width:'100%',height:'100%'},
  remoteFallback:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:NAVY},
  remoteAvatar:{width:120,height:120,borderRadius:60,alignItems:'center',justifyContent:'center',marginBottom:20},
  remoteAvatarTxt:{fontSize:44,fontWeight:'800',color:'#FFF'},
  videoCallerName:{fontSize:24,fontWeight:'700',color:'#FFF',marginBottom:14},
  connectingRow:{flexDirection:'row',alignItems:'center',gap:10},
  videoStatus:{fontSize:14,color:'rgba(255,255,255,0.7)'},

  videoTopBar:{
    position:'absolute',top:0,left:0,right:0,
    flexDirection:'row',alignItems:'center',justifyContent:'space-between',
    paddingHorizontal:16,paddingBottom:10,
    backgroundColor:'rgba(0,0,0,0.35)',
    zIndex:10,
  },
  videoTopBtn:{
    width:44,height:44,borderRadius:22,
    backgroundColor:'rgba(255,255,255,0.18)',
    alignItems:'center',justifyContent:'center',
  },
  videoTopCenter:{flex:1,alignItems:'center'},
  videoTopName:{fontSize:15,fontWeight:'700',color:'#FFF'},
  videoTopTimer:{fontSize:12,color:'rgba(255,255,255,0.7)',marginTop:2},

  selfView:{
    position:'absolute',right:16,width:110,height:160,borderRadius:14,
    overflow:'hidden',backgroundColor:'#111',borderWidth:1,borderColor:'rgba(255,255,255,0.22)',shadowColor:'#000',shadowOpacity:0.45,shadowRadius:16,shadowOffset:{width:0,height:8},elevation:10,
    zIndex:5,
  },
  selfViewInner:{flex:1,width:'100%',height:'100%'},

  videoBottomBar:{
    position:'absolute',bottom:0,left:0,right:0,
    flexDirection:'row',alignItems:'center',justifyContent:'space-around',
    paddingTop:18,paddingHorizontal:16,
    backgroundColor:'rgba(0,0,0,0.55)',
    zIndex:10,
  },
  videoCtrl:{width:54,height:54,borderRadius:27,backgroundColor:'rgba(18,22,30,0.55)',borderWidth:StyleSheet.hairlineWidth,borderColor:'rgba(255,255,255,0.28)',alignItems:'center',justifyContent:'center'},
  videoCtrlActive:{backgroundColor:'#FFFFFF',borderColor:'#FFFFFF'},
  videoEndCircle:{width:64,height:64,borderRadius:32,backgroundColor:'#EF4444',alignItems:'center',justifyContent:'center',shadowColor:'#EF4444',shadowOpacity:0.5,shadowRadius:14,shadowOffset:{width:0,height:5},elevation:8},

  sheetOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.5)',justifyContent:'flex-end'},
  sheetHandle:{width:36,height:4,borderRadius:2,backgroundColor:'#E0E0E0',alignSelf:'center',marginBottom:16},
  keypadSheet:{backgroundColor:'#FFF',borderTopLeftRadius:22,borderTopRightRadius:22,paddingHorizontal:24,paddingBottom:40,paddingTop:12},
  keypadTitle:{fontSize:12,fontWeight:'600',color:'#8E8E93',textAlign:'center',marginBottom:8,textTransform:'uppercase',letterSpacing:0.5},
  keypadDisplay:{fontSize:28,fontWeight:'300',color:'#000',textAlign:'center',marginBottom:20,letterSpacing:4,minHeight:36},
  keypadRow:{flexDirection:'row',justifyContent:'space-around',marginBottom:12},
  keypadBtn:{width:72,height:72,borderRadius:36,backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  keypadDigit:{fontSize:28,fontWeight:'400',color:'#000'},
  keypadDone:{alignSelf:'center',marginTop:8,paddingHorizontal:32,paddingVertical:12,borderRadius:14,backgroundColor:NAVY},
  keypadDoneTxt:{fontSize:15,fontWeight:'600',color:'#FFF'},
  moreSheet:{backgroundColor:'#FFF',borderTopLeftRadius:22,borderTopRightRadius:22,paddingHorizontal:20,paddingBottom:40,paddingTop:12},
  moreTitle:{fontSize:17,fontWeight:'700',color:'#000',textAlign:'center',marginBottom:16},
  moreRow:{flexDirection:'row',alignItems:'center',gap:14,paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#F0F0F0'},
  moreIcon:{width:44,height:44,borderRadius:14,backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  moreLabel:{fontSize:16,fontWeight:'500',color:'#000',flex:1},
  moreCheck:{width:28,height:28,borderRadius:14,backgroundColor:'#F0FDF4',alignItems:'center',justifyContent:'center'},
});