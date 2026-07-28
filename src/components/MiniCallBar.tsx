/**
 * MiniCallBar.tsx
 * Persistent green bar during active calls.
 * Tap returns to CallScreen. End button terminates.
 *
 * FIX: Uses navigation.navigate with correct params.
 * Passes fromMiniBar: true so CallScreen attaches to existing context.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useCallContext } from '../contexts/CallContext';

function focusedRouteName(state: any): string | null {
  if (!state) return null;
  const route = state.routes?.[state.index ?? 0];
  if (!route) return null;
  if (route.state) return focusedRouteName(route.state);
  return route.name ?? null;
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function MiniCallBar() {
  const { callState, activeCall, elapsed, connected, endCall } = useCallContext();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  let onCallScreen = false;
  try { onCallScreen = focusedRouteName(navigation.getState?.()) === 'Call'; } catch {}
  if (callState === 'idle' || callState === 'ending' || !activeCall || onCallScreen) return null;

  const statusText = connected
    ? fmtTime(elapsed)
    : callState === 'ringing' ? 'Ringing...' : 'Connecting...';

  const handleTap = () => {
    // Navigate to CallScreen with fromMiniBar flag.
    // This tells CallScreen to NOT start a new call, just attach to context.
    try {
      navigation.navigate('Call', {
        callId: activeCall.callId,
        channelId: activeCall.channelId,
        callerName: activeCall.otherUserName,
        callerAvatar: activeCall.otherUserAvatar,
        otherUser: {
          id: activeCall.otherUserId,
          full_name: activeCall.otherUserName,
          avatar_url: activeCall.otherUserAvatar,
        },
        isIncoming: activeCall.isIncoming,
        isVideo: activeCall.isVideo,
        fromMiniBar: true,
        fromContext: true,
      });
    } catch (e) {
      // Fallback: use dispatch if navigate fails
      console.log('[MINI_BAR] navigate failed, using dispatch', e);
      navigation.dispatch(
        CommonActions.navigate({
          name: 'Call',
          params: {
            callId: activeCall.callId,
            channelId: activeCall.channelId,
            callerName: activeCall.otherUserName,
            callerAvatar: activeCall.otherUserAvatar,
            otherUser: {
              id: activeCall.otherUserId,
              full_name: activeCall.otherUserName,
              avatar_url: activeCall.otherUserAvatar,
            },
            isIncoming: activeCall.isIncoming,
            isVideo: activeCall.isVideo,
            fromMiniBar: true,
            fromContext: true,
          },
        })
      );
    }
  };

  const handleEnd = () => {
    endCall();
  };

  return (
    <TouchableOpacity
      style={[st.bar, { paddingTop: Math.max(insets.top, 0) }]}
      onPress={handleTap}
      activeOpacity={0.9}
    >
      <View style={st.content}>
        <View style={st.left}>
          <View style={st.pulseDot} />
          <Feather name={activeCall.isVideo ? 'video' : 'phone'} size={14} color="#FFF" />
          <Text style={st.name} numberOfLines={1}>{activeCall.otherUserName}</Text>
        </View>
        <Text style={st.timer}>{statusText}</Text>
        <TouchableOpacity
          style={st.endBtn}
          onPress={handleEnd}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="phone-off" size={14} color="#FFF" />
        </TouchableOpacity>
        <View style={st.expandHint}>
          <Text style={st.expandTxt}>Tap to expand</Text>
          <Feather name="chevron-up" size={12} color="rgba(255,255,255,0.6)" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 9999,
    backgroundColor: '#059669',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' },
  name: { fontSize: 14, fontWeight: '600', color: '#FFF', flex: 1 },
  timer: { fontSize: 14, fontWeight: '700', color: '#FFF', fontVariant: ['tabular-nums'] },
  endBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
  },
  expandHint: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  expandTxt: { fontSize: 11, color: 'rgba(255,255,255,0.6)' },
});