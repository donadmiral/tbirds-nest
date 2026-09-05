// src/screens/stories/StoryBoomerangScreen.tsx
// BOOM capture. One tap captures a short clip automatically, the way Instagram's
// Boomerang does, then hands it to StoryComposer as a normal video with an
// accurate duration. Recording starts the way StoryCameraScreen starts it: the
// CameraView remounts in video mode and recordAsync fires from onCameraReady,
// with a not-ready retry behind it, so a cold camera never swallows the tap.
// Bounce playback (forward, back, forward) is the next slice.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';

const BOOM_SEC = 2;
const CAPTURE_SIZE = 78;
const RING_R = 36;
const RING_C = 2 * Math.PI * (RING_R + 5);

let CameraView: any = null;
let useCameraPermissions: any = null;
let useMicrophonePermissions: any = null;
let cameraAvailable = false;
try {
  const mod = require('expo-camera');
  CameraView = mod.CameraView;
  useCameraPermissions = mod.useCameraPermissions;
  useMicrophonePermissions = mod.useMicrophonePermissions;
  cameraAvailable = !!CameraView;
} catch {
  cameraAvailable = false;
}

let ExpoAVAudio: any = null;
try { ExpoAVAudio = require('expo-av').Audio; } catch {}
function resetAudioMode() {
  try { if (ExpoAVAudio) ExpoAVAudio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
}

export default function StoryBoomerangScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();

  if (!cameraAvailable) {
    return (
      <View style={s.fallback}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={s.fallbackInner} edges={['top', 'bottom']}>
          <Feather name="camera-off" size={48} color="rgba(255,255,255,0.4)" />
          <Text style={s.fallbackTitle}>Camera not available</Text>
          <Text style={s.fallbackSub}>This feature requires a new app build.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return <BoomerangInner navigation={navigation} insets={insets} />;
}

function BoomerangInner({ navigation, insets }: { navigation: any; insets: any }) {
  const [permission, requestPermission] = useCameraPermissions();
  const micPair = useMicrophonePermissions ? useMicrophonePermissions() : [null, null];
  const micPerm = micPair[0];
  const requestMicPerm = micPair[1];
  useEffect(() => {
    if (micPerm && !micPerm.granted && micPerm.canAskAgain && requestMicPerm) requestMicPerm();
  }, [micPerm, requestMicPerm]);

  const cameraRef = useRef<any>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [camMode, setCamMode] = useState<'picture' | 'video'>('picture');
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const pendingRef = useRef(false);
  const recordingRef = useRef(false);
  const recordStartRef = useRef(0);
  const progressTimerRef = useRef<any>(null);
  const stopTimerRef = useRef<any>(null);
  const mountedRef = useRef(true);

  const clearTimers = () => {
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
  };

  useEffect(() => () => {
    mountedRef.current = false;
    clearTimers();
    if (recordingRef.current) { try { cameraRef.current?.stopRecording(); } catch {} }
  }, []);

  const doRecord = useCallback(async (attempt: number) => {
    if (!cameraRef.current || recordingRef.current || !pendingRef.current) return;
    recordingRef.current = true;
    setRecording(true);
    setProgress(0);
    recordStartRef.current = Date.now();
    clearTimers();
    progressTimerRef.current = setInterval(() => {
      if (mountedRef.current) setProgress(Math.min(1, (Date.now() - recordStartRef.current) / (BOOM_SEC * 1000)));
    }, 50);
    // Backstop in case maxDuration does not stop the recorder on its own.
    stopTimerRef.current = setTimeout(() => { try { cameraRef.current?.stopRecording(); } catch {} }, BOOM_SEC * 1000 + 300);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: BOOM_SEC, codec: 'avc1' });
      const durationSec = Math.max(1, Math.min(BOOM_SEC, Math.round((Date.now() - recordStartRef.current) / 1000)));
      clearTimers();
      recordingRef.current = false;
      pendingRef.current = false;
      resetAudioMode();
      if (!mountedRef.current) return;
      setRecording(false);
      setProgress(0);
      setCamMode('picture');
      if (!video?.uri) return;
      navigation.navigate('StoryComposer', {
        assets: [{ uri: video.uri, localUri: video.uri, type: 'video', mediaType: 'video', durationSec }],
        mode: 'video',
      });
    } catch (e: any) {
      const msg = String(e?.message || '').toLowerCase();
      clearTimers();
      recordingRef.current = false;
      if (mountedRef.current) { setRecording(false); setProgress(0); }
      if (msg.includes('not ready') && pendingRef.current && attempt < 20) {
        setTimeout(() => doRecord(attempt + 1), 150);
        return;
      }
      pendingRef.current = false;
      resetAudioMode();
      if (mountedRef.current) setCamMode('picture');
      Alert.alert('Could not capture', msg.includes('not ready') ? 'The camera did not become ready. Try again.' : (e?.message || 'Please try again.'));
    }
  }, [navigation]);

  const onShutter = useCallback(() => {
    if (recordingRef.current || pendingRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    pendingRef.current = true;
    if (camMode === 'video') doRecord(0);
    else setCamMode('video');
  }, [camMode, doRecord]);

  if (!permission) return <View style={s.fallback} />;
  if (!permission.granted) {
    return (
      <View style={s.fallback}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={s.fallbackInner} edges={['top', 'bottom']}>
          <Feather name="camera-off" size={48} color="rgba(255,255,255,0.4)" />
          <Text style={s.fallbackTitle}>Camera access needed</Text>
          <TouchableOpacity style={s.permBtn} onPress={requestPermission} activeOpacity={0.8}>
            <Text style={s.permBtnTxt}>Allow camera</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const ringSize = CAPTURE_SIZE + 12;
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />
      <CameraView
        key={camMode}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode={camMode}
        videoQuality="720p"
        onCameraReady={() => { if (pendingRef.current && camMode === 'video') doRecord(0); }}
      />
      <View style={[s.topBar, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity style={s.topBtn} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={s.title}>BOOM</Text>
        <TouchableOpacity style={s.topBtn} onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))} activeOpacity={0.7} disabled={recording} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="refresh-cw" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>
      <View style={[s.bottomControls, { paddingBottom: Math.max(insets.bottom + 18, 32) }]}>
        <Text style={s.hintTxt}>{recording ? 'Capturing' : 'Tap to capture a Boomerang'}</Text>
        <TouchableOpacity activeOpacity={0.9} onPress={onShutter} disabled={recording} style={[s.captureWrap, { transform: [{ scale: recording ? 1.08 : 1 }] }]}>
          <Svg width={ringSize} height={ringSize} style={StyleSheet.absoluteFill as any}>
            <Circle cx={ringSize / 2} cy={ringSize / 2} r={RING_R + 5} stroke={recording ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.9)'} strokeWidth={4} fill="none" />
            {recording && (
              <Circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={RING_R + 5}
                stroke="#FF3B30"
                strokeWidth={4}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - progress)}
                transform={'rotate(-90 ' + (ringSize / 2) + ' ' + (ringSize / 2) + ')'}
              />
            )}
          </Svg>
          <View style={[s.captureInner, recording && s.captureInnerRecording]} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fallback: { flex: 1, backgroundColor: '#000' },
  fallbackInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  fallbackTitle: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  fallbackSub: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center' },
  permBtn: { marginTop: 8, backgroundColor: '#FFF', borderRadius: 999, paddingHorizontal: 24, paddingVertical: 11 },
  permBtnTxt: { color: '#000', fontSize: 14, fontWeight: '700' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, zIndex: 10 },
  topBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  title: { color: '#FFF', fontSize: 14, fontWeight: '800', letterSpacing: 1.5 },
  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: 14 },
  hintTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '600' },
  captureWrap: { width: CAPTURE_SIZE + 12, height: CAPTURE_SIZE + 12, alignItems: 'center', justifyContent: 'center' },
  captureInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFF' },
  captureInnerRecording: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#FF3B30' },
});