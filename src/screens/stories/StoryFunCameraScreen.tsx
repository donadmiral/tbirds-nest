// src/screens/stories/StoryFunCameraScreen.tsx
// The "FUN" mode from the story camera's mode row. Same capture pipeline as
// the main camera (tap for photo, hold for video, same ensureUploadSafe gate,
// same StoryComposer handoff), now showing a real, live filter preview using
// the same 44-filter system already proven everywhere else in the app
// (FilterLayer/FilterPickerSheet from components/stories/StoryFilters) —
// not a placeholder AR carousel. Filters here are the "swipe-through 2D
// look" kind; true face-tracking AR Lenses are a separate, later system
// that needs a real Camera Kit session — see the note by applyLens below.
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ensureUploadSafe } from '../../utils/uploadSafe';
import { FilterLayer, FilterPickerSheet } from '../../components/stories/StoryFilters';

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
 * Real AR face/body/world Lenses (Snap's "Lens" tier, not "Filter") need a
 * live Camera Kit session — a different SDK, still not wired. This function
 * is the one seam for that later. Nothing on this screen depends on it
 * anymore: the working feature right now is the live filter preview below,
 * built on the same StoryFilters system already used everywhere else.
 */
async function applyLens(lensId: string | null): Promise<void> {
  console.log('[FunCamera] applyLens (stub, AR tier not wired):', lensId);
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

  // Live filter: the real, working part of this screen.
  const [filterId, setFilterId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState(false);

  const cameraRef = useRef<any>(null);
  const recordingRef = useRef(false);
  const pendingRecordRef = useRef(false);
  const holdTimerRef = useRef<any>(null);
  const pressStartRef = useRef(0);
  const recordStartRef = useRef(0);

  const goToComposer = useCallback((uri: string, type: 'image' | 'video', width?: number, height?: number) => {
    navigation.navigate('StoryComposer', {
      assets: [{ uri, localUri: uri, type, mediaType: type, width, height, filterId }],
      mode: type,
    });
  }, [navigation, filterId]);

  // The filter picker shows the filter applied to a real frame, not a
  // generic icon — grab a lightweight still the first time it's opened.
  const openFilters = useCallback(async () => {
    Haptics.selectionAsync();
    if (!previewSnapshot && cameraRef.current && !recording) {
      setSnapshotting(true);
      try {
        const still = await cameraRef.current.takePictureAsync({ quality: 0.4, skipProcessing: true });
        if (still?.uri) setPreviewSnapshot(still.uri);
      } catch (e) {
        console.log('[FunCamera] filter preview snapshot failed:', e);
      } finally {
        setSnapshotting(false);
      }
    }
    setFilterOpen(true);
  }, [previewSnapshot, recording]);

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
    try {
      recordStartRef.current = Date.now();
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_SEC, codec: 'avc1' });
      pendingRecordRef.current = false;
      recordingRef.current = false;
      setRecording(false);
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
      if (msg.toLowerCase().includes('not ready') && pendingRecordRef.current && attempt < 12) {
        setTimeout(() => doRecord(attempt + 1), 150);
        return;
      }
      pendingRecordRef.current = false;
      setCamMode('picture');
      resetAudioMode();
      if (!msg.toLowerCase().includes('not ready')) Alert.alert('Recording failed', msg || 'Unknown error');
    }
  }, [processing, goToComposer]);

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
          pendingRecordRef.current = false;
          setCamMode('picture');
          resetAudioMode();
        }
      }, 2600);
    }, wait);
  }, []);

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
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <FilterLayer filterId={filterId} amt={100} />
      </View>

      <SafeAreaView style={s.topControls} edges={['top']}>
        <TouchableOpacity style={s.topBtn} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={s.topBtn} onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={recording}>
          <Feather name="refresh-cw" size={20} color="#FFF" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* Filters: the real, working feature — 44 presets, live on the preview above */}
      <View style={[s.filterBarWrap, { bottom: Math.max(insets.bottom + 150, 176) }]} pointerEvents={recording ? 'none' : 'auto'}>
        <TouchableOpacity onPress={openFilters} activeOpacity={0.85} style={s.filterBtn} disabled={snapshotting}>
          {snapshotting ? <ActivityIndicator color="#FFF" size="small" /> : <Feather name="sliders" size={18} color="#FFF" />}
          <Text style={s.filterBtnTxt}>{filterId ? filterId.charAt(0).toUpperCase() + filterId.slice(1) : 'Filters'}</Text>
        </TouchableOpacity>
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

      <FilterPickerSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        selected={filterId}
        onSelect={(fid: string | null) => setFilterId(fid)}
        previewUri={previewSnapshot}
      />
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

  filterBarWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  filterBtnTxt: { color: '#FFF', fontSize: 13.5, fontWeight: '700' },

  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 16 },
  captureRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 },
  captureWrap: { width: CAPTURE_SIZE + 12, height: CAPTURE_SIZE + 12, alignItems: 'center', justifyContent: 'center' },
  captureRing: { position: 'absolute', width: CAPTURE_SIZE + 12, height: CAPTURE_SIZE + 12, borderRadius: (CAPTURE_SIZE + 12) / 2, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)' },
  captureRingRecording: { borderColor: '#FF3B30' },
  captureInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  captureInnerRecording: { width: 28, height: 28, borderRadius: 7, backgroundColor: '#FF3B30' },
  hintTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '500', marginTop: 12 },
});
