// src/screens/stories/StoryFunCameraScreen.tsx
// The "FUN" mode from the story camera's mode row. Same capture pipeline as
// the main camera (tap for photo, hold for video, same ensureUploadSafe gate,
// same StoryComposer handoff) plus a lens strip across the top.
//
// applyLens() below is the ONE integration seam for the actual Camera Kit AR
// session. It is intentionally a no-op stub right now — everything else on
// this screen is real and works today without it. Wiring a real lens engine
// here later does not touch anything else on this screen.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ensureUploadSafe } from '../../utils/uploadSafe';

const MAX_VIDEO_SEC = 60;
const CAPTURE_SIZE = 72;

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

/**
 * Placeholder lens catalog. Swap these ids for the real ones once lenses are
 * published to your Group ID in Lens Studio (or a Snap demo group while
 * testing) — nothing else on this screen needs to change when you do.
 */
type FunLens = { id: string | null; label: string; thumb?: string | null };
const FUN_LENSES: FunLens[] = [
  { id: null, label: 'None' },
  { id: 'lens-placeholder-1', label: 'Warm' },
  { id: 'lens-placeholder-2', label: 'Comic' },
  { id: 'lens-placeholder-3', label: 'Dreamy' },
  { id: 'lens-placeholder-4', label: 'Big Eyes' },
  { id: 'lens-placeholder-5', label: 'Glow' },
];

/** The one integration seam. Everything above and below this function is real. */
async function applyLens(lensId: string | null): Promise<void> {
  // TODO: real Camera Kit session hookup goes here.
  console.log('[FunCamera] applyLens (stub):', lensId);
}

export default function StoryFunCameraScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();

  if (!cameraAvailable) {
    return (
      <View style={s.fallback}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={s.fallbackInner} edges={['top', 'bottom']}>
          <Feather name="camera-off" size={48} color="rgba(255,255,255,0.4)" />
          <Text style={s.fallbackTitle}>Camera not available</Text>
          <Text style={s.fallbackSub}>This feature requires a new app build.</Text>
          <TouchableOpacity style={s.fallbackBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={s.fallbackBtnTxt}>Go back</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return <FunCameraInner navigation={navigation} insets={insets} />;
}

function FunCameraInner({ navigation, insets }: { navigation: any; insets: any }) {
  const [permission, requestPermission] = useCameraPermissions();
  const micPair = useMicrophonePermissions ? useMicrophonePermissions() : [null, null];
  const micPerm = micPair[0];
  const requestMicPerm = micPair[1];
  useEffect(() => {
    if (micPerm && !micPerm.granted && micPerm.canAskAgain && requestMicPerm) requestMicPerm();
  }, [micPerm, requestMicPerm]);

  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [camMode, setCamMode] = useState<'picture' | 'video'>('picture');
  const [selectedLens, setSelectedLens] = useState<string | null>(null);
  const [lensBusy, setLensBusy] = useState(false);

  const cameraRef = useRef<any>(null);
  const recordingRef = useRef(false);
  const pendingRecordRef = useRef(false);
  const holdTimerRef = useRef<any>(null);
  const pressStartRef = useRef(0);
  const recordStartRef = useRef(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

  const goToComposer = useCallback((uri: string, type: 'image' | 'video', width?: number, height?: number) => {
    navigation.navigate('StoryComposer', {
      assets: [{ uri, localUri: uri, type, mediaType: type, width, height }],
      mode: type,
    });
  }, [navigation]);

  const pickLens = useCallback(async (lens: FunLens) => {
    if (lensBusy) return;
    Haptics.selectionAsync();
    setLensBusy(true);
    setSelectedLens(lens.id);
    try { await applyLens(lens.id); } finally { setLensBusy(false); }
  }, [lensBusy]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || processing || recordingRef.current) return;
    setProcessing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1, skipProcessing: Platform.OS === 'android' });
      goToComposer(photo.uri, 'image', photo.width, photo.height);
    } catch (e) {
      console.error('[FunCamera] photo error:', e);
      Alert.alert('Error', 'Could not take photo.');
    } finally {
      setProcessing(false);
    }
  }, [processing, goToComposer]);

  const doRecord = useCallback(async (attempt: number = 0) => {
    if (!cameraRef.current || recordingRef.current || processing || !pendingRecordRef.current) return;
    recordingRef.current = true;
    setRecording(true);
    progressAnim.setValue(0);
    Animated.timing(progressAnim, { toValue: 1, duration: MAX_VIDEO_SEC * 1000, useNativeDriver: false }).start();
    try {
      recordStartRef.current = Date.now();
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_SEC, codec: 'avc1' });
      pendingRecordRef.current = false;
      recordingRef.current = false;
      setRecording(false);
      progressAnim.stopAnimation();
      progressAnim.setValue(0);
      setCamMode('picture');
      resetAudioMode();
      if (video?.uri) {
        setProcessing(true);
        try {
          let safeUri = video.uri;
          try { safeUri = (await ensureUploadSafe(video.uri, 'video')).uri; }
          catch (e: any) { console.log('[FunCamera] uploadSafe unavailable, using raw file:', e?.message || e); }
          goToComposer(safeUri, 'video');
        } finally { setProcessing(false); }
        return;
      }
      Alert.alert('Recording failed', 'No video was captured. Try again.');
    } catch (e: any) {
      const msg = e?.message || '';
      recordingRef.current = false;
      setRecording(false);
      progressAnim.stopAnimation();
      progressAnim.setValue(0);
      if (msg.toLowerCase().includes('not ready') && pendingRecordRef.current && attempt < 12) {
        setTimeout(() => doRecord(attempt + 1), 150);
        return;
      }
      pendingRecordRef.current = false;
      setCamMode('picture');
      resetAudioMode();
      if (!msg.toLowerCase().includes('not ready')) Alert.alert('Recording failed', msg || 'Unknown error');
    }
  }, [processing, goToComposer, progressAnim]);

  const requestRecord = useCallback(async () => {
    if (recordingRef.current || processing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (micPerm && !micPerm.granted && requestMicPerm) requestMicPerm();
    try { if (ExpoAVAudio) await ExpoAVAudio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }); } catch {}
    pendingRecordRef.current = true;
    setCamMode('video');
    setTimeout(() => { if (pendingRecordRef.current) doRecord(0); }, 300);
  }, [processing, micPerm, requestMicPerm, doRecord]);

  const stopRecording = useCallback(() => {
    pendingRecordRef.current = false;
    if (!recordingRef.current) { setCamMode('picture'); return; }
    const elapsed = Date.now() - recordStartRef.current;
    const wait = Math.max(0, 800 - elapsed);
    setTimeout(() => {
      try { cameraRef.current?.stopRecording(); } catch {}
      setTimeout(() => { if (recordingRef.current) { try { cameraRef.current?.stopRecording(); } catch {} } }, 700);
      setTimeout(() => {
        if (recordingRef.current) {
          recordingRef.current = false;
          setRecording(false);
          progressAnim.stopAnimation();
          progressAnim.setValue(0);
          pendingRecordRef.current = false;
          setCamMode('picture');
          resetAudioMode();
        }
      }, 2600);
    }, wait);
  }, [progressAnim]);

  const onPressIn = useCallback(() => {
    pressStartRef.current = Date.now();
    holdTimerRef.current = setTimeout(() => { requestRecord(); }, 250);
  }, [requestRecord]);
  const onPressOut = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    const held = Date.now() - pressStartRef.current;
    if (held < 250 && !recordingRef.current) { takePhoto(); return; }
    stopRecording();
  }, [takePhoto, stopRecording]);

  if (!permission) {
    return <View style={s.fallback}><StatusBar barStyle="light-content" /><ActivityIndicator color="#FFF" size="large" /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={s.fallback}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={s.fallbackInner} edges={['top', 'bottom']}>
          <Feather name="camera-off" size={48} color="rgba(255,255,255,0.4)" />
          <Text style={s.fallbackTitle}>Camera access needed</Text>
          <TouchableOpacity style={s.fallbackBtn} onPress={requestPermission} activeOpacity={0.8}>
            <Text style={s.fallbackBtnTxt}>Allow camera</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar hidden />
      <CameraView key={camMode} ref={cameraRef} style={s.camera} facing={facing} mode={camMode} videoQuality="720p"
        onCameraReady={() => { if (pendingRecordRef.current && camMode === 'video') doRecord(0); }} />

      <SafeAreaView style={s.topControls} edges={['top']}>
        <TouchableOpacity style={s.topBtn} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={s.topBtn} onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={recording}>
          <Feather name="refresh-cw" size={20} color="#FFF" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* Lens strip: circular thumbnails, selected one lifted and ringed, Snapchat's own layout */}
      <View style={[s.lensStripWrap, { bottom: Math.max(insets.bottom + 150, 176) }]} pointerEvents={recording ? 'none' : 'auto'}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.lensStrip}>
          {FUN_LENSES.map(lens => {
            const on = selectedLens === lens.id;
            return (
              <TouchableOpacity key={lens.id ?? 'none'} onPress={() => pickLens(lens)} activeOpacity={0.85} style={s.lensItem}>
                <View style={[s.lensCircle, on && s.lensCircleOn]}>
                  {lens.thumb ? <Image source={{ uri: lens.thumb }} style={s.lensThumbImg} /> : (
                    <Feather name={lens.id ? 'zap' : 'slash'} size={18} color="#FFF" />
                  )}
                  {on && lensBusy ? <ActivityIndicator color="#FFF" size="small" style={StyleSheet.absoluteFill as any} /> : null}
                </View>
                <Text style={[s.lensLabel, on && s.lensLabelOn]} numberOfLines={1}>{lens.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={[s.bottomControls, { paddingBottom: Math.max(insets.bottom + 18, 32) }]}>
        <View style={s.captureRow}>
          <View style={{ width: 44 }} />
          <TouchableOpacity
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            activeOpacity={1}
            style={[s.captureWrap, { transform: [{ scale: recording ? 1.08 : 1 }] }]}
          >
            <View style={[s.captureRing, recording && s.captureRingRecording]} />
            <View style={[s.captureInner, recording && s.captureInnerRecording]}>
              {processing && <ActivityIndicator color="#000" size="small" />}
            </View>
          </TouchableOpacity>
          <View style={{ width: 44 }} />
        </View>
        <Text style={s.hintTxt}>{recording ? 'Release to stop' : 'Tap for photo, hold for video'}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },

  fallback: { flex: 1, backgroundColor: '#000' },
  fallbackInner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  fallbackTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', marginTop: 16 },
  fallbackSub: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  fallbackBtn: { marginTop: 20, backgroundColor: '#FFF', borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14, alignItems: 'center', width: '100%' },
  fallbackBtnTxt: { color: '#000', fontSize: 15, fontWeight: '700' },

  topControls: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, zIndex: 10 },
  topBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },

  lensStripWrap: { position: 'absolute', left: 0, right: 0 },
  lensStrip: { paddingHorizontal: 16, gap: 14, alignItems: 'flex-end' },
  lensItem: { alignItems: 'center', width: 58 },
  lensCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  lensCircleOn: { borderColor: '#FFD60A', backgroundColor: 'rgba(0,0,0,0.3)' },
  lensThumbImg: { width: '100%', height: '100%' },
  lensLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10.5, fontWeight: '600', marginTop: 4 },
  lensLabelOn: { color: '#FFD60A', fontWeight: '800' },

  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 16 },
  captureRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 },
  captureWrap: { width: CAPTURE_SIZE + 12, height: CAPTURE_SIZE + 12, alignItems: 'center', justifyContent: 'center' },
  captureRing: { position: 'absolute', width: CAPTURE_SIZE + 12, height: CAPTURE_SIZE + 12, borderRadius: (CAPTURE_SIZE + 12) / 2, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)' },
  captureRingRecording: { borderColor: '#FF3B30' },
  captureInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  captureInnerRecording: { width: 28, height: 28, borderRadius: 7, backgroundColor: '#FF3B30' },
  hintTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '500', marginTop: 12 },
});
