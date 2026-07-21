/**
 * MeetingScreen.tsx
 * Multi-party Video Con. Zoom-style grid layout with Daily backend.
 *
 * Params:
 *   roomName (string, required) - Daily room name
 *   meetingId (string, optional) - Our DB id (for recording join/leave, host controls)
 *   isHost (boolean, optional) - Whether user is the host
 *   autoJoin (boolean, optional) - Skip preview, join immediately (default true)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, Alert, Share, ActivityIndicator, Image,
  Platform, Modal, Pressable, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import Daily, {
  DailyCall, DailyEvent, DailyEventObjectParticipant,
  DailyParticipant, DailyMediaView,
} from '@daily-co/react-native-daily-js';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { meetingService, Meeting } from '../../services/meetingService';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

type ParticipantMap = Record<string, DailyParticipant>;

function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

const AVATAR_COLORS = ['#1D4ED8', '#065F46', '#7C2D12', '#5856D6', '#C2410C', '#0F766E', '#7C3AED'];
function colorFor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export default function MeetingScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();

  const roomName: string = route.params?.roomName;
  const meetingIdParam: string | undefined = route.params?.meetingId;
  const isHostParam: boolean = route.params?.isHost === true;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [participants, setParticipants] = useState<ParticipantMap>({});
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showParticipants, setShowParticipants] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const callRef = useRef<DailyCall | null>(null);
  const participantRecordRef = useRef<string | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leftRef = useRef(false);

  // Load meeting details
  useEffect(() => {
    (async () => {
      if (!roomName) {
        setErrorMsg('No meeting room specified');
        setLoading(false);
        return;
      }
      const m = await meetingService.getByRoomName(roomName);
      if (!m) {
        setErrorMsg('Meeting not found or not accessible');
        setLoading(false);
        return;
      }
      if (m.is_ended) {
        setErrorMsg('This meeting has ended');
        setLoading(false);
        return;
      }
      setMeeting(m);
      setLoading(false);
    })();
  }, [roomName]);

  // Join Daily room
  useEffect(() => {
    if (!meeting || joined || joining || !profile?.id) return;
    setJoining(true);

    (async () => {
      try {
        const isHost = meeting.host_id === profile.id;
        const token = await meetingService.joinMeeting({
          roomName: meeting.room_name,
          isHost,
        });

        const call = Daily.createCallObject({
          audioSource: true,
          videoSource: true,
        });
        callRef.current = call;

        call.on('joined-meeting' as DailyEvent, () => {
          console.log('[MEETING] joined');
          setJoined(true);
          setJoining(false);
        });

        call.on('participant-joined' as DailyEvent, (ev: DailyEventObjectParticipant | any) => {
          const p = ev?.participant;
          if (!p) return;
          setParticipants(prev => ({ ...prev, [p.session_id]: p }));
        });

        call.on('participant-updated' as DailyEvent, (ev: DailyEventObjectParticipant | any) => {
          const p = ev?.participant;
          if (!p) return;
          setParticipants(prev => ({ ...prev, [p.session_id]: p }));
        });

        call.on('participant-left' as DailyEvent, (ev: DailyEventObjectParticipant | any) => {
          const p = ev?.participant;
          if (!p) return;
          setParticipants(prev => {
            const next = { ...prev };
            delete next[p.session_id];
            return next;
          });
          if (pinnedId === p.session_id) setPinnedId(null);
        });

        call.on('error' as DailyEvent, (ev: any) => {
          console.log('[MEETING] error', ev);
          setErrorMsg(ev?.errorMsg || 'Meeting error');
        });

        call.on('active-speaker-change' as DailyEvent, (ev: any) => {
          const peerId = ev?.activeSpeaker?.peerId;
          if (peerId && !pinnedId) {
            // Auto-focus is implicit via sorting, we just refresh participants
            setParticipants(prev => ({ ...prev }));
          }
        });

        await call.join({
          url: token.roomUrl,
          token: token.token,
          userName: profile?.full_name || 'User',
        });

        // Seed local participant
        const local = call.participants()?.local;
        if (local) setParticipants(prev => ({ ...prev, [local.session_id]: local }));

        // Record join in our DB
        if (meeting.id) {
          const pid = await meetingService.recordJoin(meeting.id);
          participantRecordRef.current = pid;
        }
      } catch (e: any) {
        console.log('[MEETING_JOIN_ERR]', e?.message);
        setErrorMsg(e?.message || 'Could not join meeting');
        setJoining(false);
      }
    })();

    return () => {
      const call = callRef.current;
      if (call) {
        try { call.leave(); } catch {}
        try { call.destroy(); } catch {}
      }
      callRef.current = null;
      if (participantRecordRef.current) {
        meetingService.recordLeave(participantRecordRef.current).catch(() => {});
      }
    };
  }, [meeting?.id, profile?.id]);

  // Auto-hide controls after 4s
  useEffect(() => {
    if (!showControls) return;
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => setShowControls(false), 4000);
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    };
  }, [showControls]);

  const toggleMute = () => {
    const call = callRef.current; if (!call) return;
    const next = !muted; setMuted(next);
    call.setLocalAudio(!next);
  };

  const toggleVideo = () => {
    const call = callRef.current; if (!call) return;
    const next = !videoOff; setVideoOff(next);
    call.setLocalVideo(!next);
  };

  const toggleScreenShare = async () => {
    const call = callRef.current; if (!call) return;
    try {
      if (screenSharing) {
        call.stopScreenShare();
        setScreenSharing(false);
      } else {
        await call.startScreenShare();
        setScreenSharing(true);
      }
    } catch (e: any) {
      Alert.alert('Screen share', e?.message || 'Could not start screen share.');
    }
  };

  const flipCamera = async () => {
    const call = callRef.current; if (!call) return;
    try { await call.cycleCamera(); } catch {}
  };

  const shareLink = async () => {
    if (!meeting) return;
    const link = meetingService.shareLink(meeting.room_name);
    try {
      await Share.share({
        message: `Join my meeting on PlatinumCircles: ${meeting.title}\n\n${link}`,
      });
    } catch {}
  };

  const copyLink = async () => {
    if (!meeting) return;
    const link = meetingService.shareLink(meeting.room_name);
    await Clipboard.setStringAsync(link);
    Alert.alert('Copied', 'Meeting link copied to clipboard.');
  };

  const leave = async () => {
    if (leftRef.current) return;
    leftRef.current = true;
    const call = callRef.current;
    if (call) {
      try { await call.leave(); } catch {}
      try { call.destroy(); } catch {}
    }
    callRef.current = null;
    if (participantRecordRef.current) {
      await meetingService.recordLeave(participantRecordRef.current).catch(() => {});
    }
    nav.goBack();
  };

  const endForAll = () => {
    if (!meeting) return;
    Alert.alert(
      'End meeting for everyone?',
      'This will disconnect all participants. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End meeting', style: 'destructive',
          onPress: async () => {
            setEnding(true);
            try {
              await meetingService.endForAll(meeting.id);
              await leave();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not end meeting');
              setEnding(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}><ActivityIndicator color="#FFF" size="large" /></View>
      </SafeAreaView>
    );
  }

  if (errorMsg || !meeting) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={s.center}>
          <Feather name="alert-circle" size={48} color="#FF3B30" />
          <Text style={s.errTitle}>Can't join meeting</Text>
          <Text style={s.errSub}>{errorMsg || 'Meeting unavailable'}</Text>
          <TouchableOpacity style={s.errBtn} onPress={() => nav.goBack()}>
            <Text style={s.errBtnTxt}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const participantList = Object.values(participants);
  const localParticipant = participantList.find(p => p.local);
  const remoteParticipants = participantList.filter(p => !p.local);
  const pinned = pinnedId ? participants[pinnedId] : null;
  const isHost = meeting.host_id === profile?.id;
  const totalCount = participantList.length;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <Pressable
        style={s.grid}
        onPress={() => setShowControls(p => !p)}
      >
        {joining && !joined ? (
          <View style={s.joiningOverlay}>
            <ActivityIndicator color="#FFF" size="large" />
            <Text style={s.joiningTxt}>Connecting...</Text>
          </View>
        ) : null}

        {pinned ? (
          <View style={s.pinnedTile}>
            <ParticipantTile participant={pinned} large />
            <TouchableOpacity
              style={s.unpinBtn}
              onPress={() => setPinnedId(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather name="minimize-2" size={16} color="#FFF" />
            </TouchableOpacity>
          </View>
        ) : (
          <GridLayout participants={participantList} onPin={setPinnedId} />
        )}
      </Pressable>

      {/* Top bar */}
      {showControls && (
        <View style={[s.topBar, { paddingTop: insets.top + 4 }]}>
          <TouchableOpacity onPress={leave} style={s.topBtn}>
            <Feather name="chevron-down" size={22} color="#FFF" />
          </TouchableOpacity>
          <View style={s.topCenter}>
            <Text style={s.topTitle} numberOfLines={1}>{meeting.title}</Text>
            <Text style={s.topSub}>{totalCount} participant{totalCount === 1 ? '' : 's'}</Text>
          </View>
          <TouchableOpacity onPress={flipCamera} style={s.topBtn}>
            <Feather name="refresh-cw" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom controls */}
      {showControls && (
        <View style={[s.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
          <View style={s.bottomRow}>
            <ControlBtn
              icon={muted ? 'mic-off' : 'mic'}
              label={muted ? 'Muted' : 'Mute'}
              active={muted}
              onPress={toggleMute}
            />
            <ControlBtn
              icon={videoOff ? 'video-off' : 'video'}
              label={videoOff ? 'Camera off' : 'Camera'}
              active={videoOff}
              onPress={toggleVideo}
            />
            <ControlBtn
              icon={screenSharing ? 'monitor' : 'monitor'}
              label="Share"
              active={screenSharing}
              onPress={toggleScreenShare}
            />
            <ControlBtn
              icon="users"
              label="People"
              active={false}
              onPress={() => setShowParticipants(true)}
              badge={totalCount > 1 ? totalCount : undefined}
            />
            <ControlBtn
              icon="share-2"
              label="Invite"
              active={false}
              onPress={shareLink}
            />
          </View>

          <View style={s.leaveRow}>
            {isHost && (
              <TouchableOpacity style={s.endForAllBtn} onPress={endForAll} disabled={ending}>
                {ending
                  ? <ActivityIndicator color="#FFF" size={14} />
                  : <Text style={s.endForAllTxt}>End for all</Text>}
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.leaveBtn} onPress={leave}>
              <Feather name="phone-off" size={18} color="#FFF" />
              <Text style={s.leaveTxt}>Leave</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Participants sheet */}
      <Modal
        visible={showParticipants}
        transparent
        animationType="slide"
        onRequestClose={() => setShowParticipants(false)}
      >
        <Pressable style={s.sheetBackdrop} onPress={() => setShowParticipants(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>Participants</Text>
              <Text style={s.sheetCount}>{totalCount}</Text>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {participantList.map(p => (
                <View key={p.session_id} style={s.pRow}>
                  <View style={[s.pAvatar, { backgroundColor: colorFor(p.session_id) }]}>
                    <Text style={s.pAvatarTxt}>{initials(p.user_name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.pName}>
                      {p.user_name || 'User'}
                      {p.local ? ' (you)' : ''}
                    </Text>
                    <Text style={s.pMeta}>
                      {p.audio ? 'Mic on' : 'Muted'} · {p.video ? 'Camera on' : 'Camera off'}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={s.sheetActions}>
              <TouchableOpacity style={s.sheetActionBtn} onPress={copyLink}>
                <Feather name="link-2" size={16} color="#007AFF" />
                <Text style={s.sheetActionTxt}>Copy link</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.sheetActionBtn} onPress={shareLink}>
                <Feather name="share" size={16} color="#007AFF" />
                <Text style={s.sheetActionTxt}>Share</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function ControlBtn({
  icon, label, active, onPress, badge,
}: { icon: string; label: string; active: boolean; onPress: () => void; badge?: number }) {
  return (
    <TouchableOpacity style={s.ctrl} onPress={onPress} activeOpacity={0.75}>
      <View style={[s.ctrlCircle, active && s.ctrlCircleActive]}>
        <Feather name={icon as any} size={20} color="#FFF" />
        {badge ? (
          <View style={s.ctrlBadge}>
            <Text style={s.ctrlBadgeTxt}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={s.ctrlLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function GridLayout({
  participants, onPin,
}: { participants: DailyParticipant[]; onPin: (id: string) => void }) {
  const count = participants.length;
  if (count === 0) {
    return (
      <View style={s.emptyGrid}>
        <Feather name="users" size={40} color="rgba(255,255,255,0.3)" />
        <Text style={s.emptyGridTxt}>Waiting for others to join...</Text>
      </View>
    );
  }

  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  const tileW = SCREEN_W / cols;
  const tileH = (SCREEN_H - 200) / rows;

  return (
    <View style={s.gridInner}>
      {participants.map(p => (
        <TouchableOpacity
          key={p.session_id}
          style={[s.gridTile, { width: tileW, height: tileH }]}
          onPress={() => onPin(p.session_id)}
          activeOpacity={0.9}
        >
          <ParticipantTile participant={p} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ParticipantTile({
  participant, large,
}: { participant: DailyParticipant; large?: boolean }) {
  const hasVideo = participant.video && !!participant.videoTrack;
  const name = participant.user_name || 'User';

  return (
    <View style={s.tileInner}>
      {hasVideo ? (
        <DailyMediaView
          videoTrack={participant.videoTrack || null}
          audioTrack={participant.local ? null : (participant.audioTrack || null)}
          mirror={participant.local}
          zOrder={0}
          objectFit="cover"
          style={s.tileVideo}
        />
      ) : (
        <View style={[s.tileNoVideo, { backgroundColor: colorFor(participant.session_id) }]}>
          <Text style={[s.tileInitials, large && { fontSize: 48 }]}>{initials(name)}</Text>
        </View>
      )}
      <View style={s.tileOverlay}>
        <View style={s.tileNameWrap}>
          <Text style={s.tileName} numberOfLines={1}>
            {name}{participant.local ? ' (you)' : ''}
          </Text>
          {!participant.audio && (
            <Feather name="mic-off" size={12} color="#FFF" style={{ marginLeft: 4 }} />
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },

  joiningOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 100,
  },
  joiningTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },

  grid: { flex: 1, backgroundColor: '#000' },
  gridInner: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  gridTile: { padding: 2 },

  emptyGrid: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyGridTxt: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },

  pinnedTile: { flex: 1, position: 'relative' },
  unpinBtn: {
    position: 'absolute', top: 80, right: 12,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },

  tileInner: { flex: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#1C1C1E' },
  tileVideo: { width: '100%', height: '100%' },
  tileNoVideo: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileInitials: { color: '#FFF', fontSize: 28, fontWeight: '800' },
  tileOverlay: {
    position: 'absolute', bottom: 6, left: 6, right: 6,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  tileNameWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    maxWidth: '90%',
  },
  tileName: { color: '#FFF', fontSize: 11, fontWeight: '700' },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: 12, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  topBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  topCenter: { flex: 1 },
  topTitle: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  topSub: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 },
  ctrl: { alignItems: 'center', gap: 6 },
  ctrlCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  ctrlCircleActive: { backgroundColor: '#EF4444' },
  ctrlBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: '#007AFF',
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  ctrlBadgeTxt: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  ctrlLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },

  leaveRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  endForAllBtn: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(239,68,68,0.2)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
  },
  endForAllTxt: { color: '#FCA5A5', fontSize: 14, fontWeight: '700' },
  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 22, paddingVertical: 12,
    borderRadius: 12, backgroundColor: '#EF4444',
  },
  leaveTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  errTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', marginTop: 8 },
  errSub: { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' },
  errBtn: {
    marginTop: 16, paddingHorizontal: 22, paddingVertical: 12,
    borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)',
  },
  errBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1C1C1E', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 30 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { flex: 1, color: '#FFF', fontSize: 18, fontWeight: '800' },
  sheetCount: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  pRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  pAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pAvatarTxt: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  pName: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  pMeta: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 16, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  sheetActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(0,122,255,0.15)' },
  sheetActionTxt: { color: '#007AFF', fontSize: 14, fontWeight: '700' },
});