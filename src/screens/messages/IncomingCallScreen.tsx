/**
 * IncomingCallScreen.tsx
 * Shows when someone calls you while app is open.
 * Accepts → joins Agora channel in CallScreen.
 * Requires react-native-agora (see callService.ts for setup).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
  StatusBar, Image, Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { callService } from '../../services/callService';

export default function IncomingCallScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  const callId: string = route.params?.callId || '';
  const channelId: string = route.params?.channelId || '';
  const callerName: string = route.params?.callerName || 'Unknown';
  const callerAvatar: string | null = route.params?.callerAvatar ?? null;
  const callerUsername: string | null = route.params?.callerUsername ?? null;
  const otherUser = route.params?.otherUser ?? null;

  const [declined, setDeclined] = useState(false);

  const ring1 = useRef(new Animated.Value(1)).current;
  const ring2 = useRef(new Animated.Value(1)).current;
  const ring3 = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0.6)).current;
  const ring2Opacity = useRef(new Animated.Value(0.4)).current;
  const ring3Opacity = useRef(new Animated.Value(0.2)).current;
  const slideUp = useRef(new Animated.Value(80)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entrance animation
    Animated.parallel([
      Animated.timing(slideUp, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();

    // Pulse rings
    const pulse = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(scale, { toValue: 2.2, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 1600, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.6, duration: 0, useNativeDriver: true }),
          ]),
        ])
      );

    const a1 = pulse(ring1, ring1Opacity, 0);
    const a2 = pulse(ring2, ring2Opacity, 500);
    const a3 = pulse(ring3, ring3Opacity, 1000);
    a1.start(); a2.start(); a3.start();

    // Auto-dismiss after 30 seconds (missed call)
    const timeout = setTimeout(async () => {
      if (callId) await callService.markMissed(callId);
      navigation.goBack();
    }, 30000);

    return () => {
      a1.stop(); a2.stop(); a3.stop();
      clearTimeout(timeout);
    };
  }, []);

  const initials = (name: string) => {
    const p = name.trim().split(' ').filter(Boolean);
    return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
  };

  const handleAccept = async () => {
    if (callId) await callService.acceptCall(callId);
    navigation.replace('Call', {
      callId,
      channelId,
      callerName,
      callerAvatar,
      otherUser,
      isIncoming: true,
    });
  };

  const handleDecline = async () => {
    setDeclined(true);
    if (callId) await callService.declineCall(callId);
    setTimeout(() => navigation.goBack(), 300);
  };

  return (
    <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#060A14" />
      <Animated.View style={[s.container, { paddingTop: insets.top + 20, opacity: fadeIn, transform: [{ translateY: slideUp }] }]}>

        {/* Top label */}
        <View style={s.topSection}>
          <View style={s.appPill}>
            <Text style={s.appPillTxt}>TBirds Nest</Text>
          </View>
          <Text style={s.incomingTxt}>Incoming Call</Text>
        </View>

        {/* Avatar with pulse rings */}
        <View style={s.avatarSection}>
          <View style={s.pulseContainer}>
            <Animated.View style={[s.ring, { transform: [{ scale: ring3 }], opacity: ring3Opacity, borderColor: '#38BDF820' }]} />
            <Animated.View style={[s.ring, { transform: [{ scale: ring2 }], opacity: ring2Opacity, borderColor: '#38BDF840' }]} />
            <Animated.View style={[s.ring, { transform: [{ scale: ring1 }], opacity: ring1Opacity, borderColor: '#38BDF860' }]} />
            <View style={s.avatarWrap}>
              {callerAvatar
                ? <Image source={{ uri: callerAvatar }} style={s.avatar} />
                : <View style={s.avatarFb}><Text style={s.avatarFbTxt}>{initials(callerName)}</Text></View>}
            </View>
          </View>
          <Text style={s.callerName}>{callerName}</Text>
          {callerUsername && <Text style={s.callerHandle}>@{callerUsername}</Text>}
          <View style={s.callTypePill}>
            <View style={s.callTypeDot} />
            <Text style={s.callTypeTxt}>Audio Call</Text>
          </View>
        </View>

        {/* Action buttons */}
        <View style={[s.actionSection, { paddingBottom: Math.max(insets.bottom + 20, 40) }]}>
          {/* Swipe hint */}
          <Text style={s.hint}>Tap to respond</Text>
          <View style={s.btnRow}>
            <TouchableOpacity style={s.declineBtn} activeOpacity={0.85} onPress={handleDecline}>
              <View style={s.btnInner}>
                <Text style={s.declineIcon}>✕</Text>
              </View>
              <Text style={s.declineLbl}>Decline</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.acceptBtn} activeOpacity={0.85} onPress={handleAccept}>
              <View style={[s.btnInner, s.acceptBtnInner]}>
                <Text style={s.acceptIcon}>✆</Text>
              </View>
              <Text style={s.acceptLbl}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const AVATAR_SIZE = 108;
const RING_SIZE = 160;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#060A14' },
  container: { flex: 1, backgroundColor: '#060A14', alignItems: 'center', justifyContent: 'space-between' },
  topSection: { alignItems: 'center', paddingTop: 8 },
  appPill: { backgroundColor: '#0E1825', borderRadius: 20, borderWidth: 1, borderColor: '#1F3050', paddingHorizontal: 14, paddingVertical: 5, marginBottom: 10 },
  appPillTxt: { fontSize: 12, fontWeight: '700', color: '#38BDF8', letterSpacing: 0.5 },
  incomingTxt: { fontSize: 15, fontWeight: '600', color: '#64748B', letterSpacing: 0.3 },
  avatarSection: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pulseContainer: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  ring: { position: 'absolute', width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2, borderWidth: 1.5 },
  avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, overflow: 'hidden', borderWidth: 2, borderColor: '#38BDF840' },
  avatar: { width: '100%', height: '100%' },
  avatarFb: { width: '100%', height: '100%', backgroundColor: '#0E2A4A', alignItems: 'center', justifyContent: 'center' },
  avatarFbTxt: { fontSize: 36, fontWeight: '800', color: '#38BDF8' },
  callerName: { fontSize: 32, fontWeight: '800', color: '#F1F5F9', textAlign: 'center', letterSpacing: -0.5 },
  callerHandle: { fontSize: 15, color: '#38BDF8', marginTop: 6, fontWeight: '500' },
  callTypePill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, backgroundColor: '#0E1825', borderRadius: 20, borderWidth: 1, borderColor: '#1F3050', paddingHorizontal: 14, paddingVertical: 7 },
  callTypeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80' },
  callTypeTxt: { fontSize: 13, color: '#94A3B8', fontWeight: '600' },
  actionSection: { width: '100%', alignItems: 'center', paddingHorizontal: 40 },
  hint: { fontSize: 12, color: '#334155', marginBottom: 20, letterSpacing: 0.5 },
  btnRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  btnInner: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#2D1A1A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#7F1D1D', marginBottom: 10 },
  acceptBtnInner: { backgroundColor: '#0D2B1A', borderColor: '#14532D' },
  declineBtn: { alignItems: 'center' },
  declineIcon: { fontSize: 28, color: '#F87171' },
  declineLbl: { fontSize: 13, fontWeight: '700', color: '#F87171' },
  acceptBtn: { alignItems: 'center' },
  acceptIcon: { fontSize: 28, color: '#4ADE80' },
  acceptLbl: { fontSize: 13, fontWeight: '700', color: '#4ADE80' },
});