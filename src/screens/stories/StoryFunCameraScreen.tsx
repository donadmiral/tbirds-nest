// src/screens/stories/StoryFunCameraScreen.tsx
// FUN mode. Two tabs now: Filters (2D looks, live via FilterLayer, unchanged
// from before) and Lenses (real AR via CameraKitLensView, backed by a real
// Camera Kit session and a real lens group). Capture routes through whichever
// pipeline is active into the same StoryComposer handoff either way.
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
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ensureUploadSafe } from '../../utils/uploadSafe';
import { FilterLayer, FilterPickerSheet } from '../../components/stories/StoryFilters';
import { CameraKitLensView, CKLens, CameraKitLensViewHandle, webViewAvailable } from './CameraKitLensView';

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

export default function StoryFunCameraScreen({ navigation, route }: any) {
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

  return <FunCameraInner navigation={navigation} insets={insets} route={route} />;
}

function FunCameraInner({ navigation, insets, route }: { navigation: any; insets: any; route: any }) {
  // Where the captured photo/video goes. Any screen can open this camera by
  // navigating here with { returnTo: 'chat' | 'feed', chatParams / feedParams }.
  // Default (no params, or opened from the story mode row) behaves exactly as
  // before: straight into the story composer.
  const returnTo: 'story' | 'chat' | 'feed' = route?.params?.returnTo || 'story';
  const [permission, requestPermission] = useCameraPermissions();
  const micPair = useMicrophonePermissions ? useMicrophonePermissions() : [null, null];
  const micPerm = micPair[0];
  const requestMicPerm = micPair[1];
  useEffect(() => {
    if (micPerm && !micPerm.granted && micPerm.canAskAgain && requestMicPerm) requestMicPerm();
  }, [micPerm, requestMicPerm]);

  const [tab, setTab] = useState<'filters' | 'lenses'>('filters');
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [camMode, setCamMode] = useState<'picture' | 'video'>('picture');

  // Filters tab (unchanged) ---------------------------------------------
  const [filterId, setFilterId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState(false);

  // Lenses tab (new, real) ------------------------------------------------
  const ckRef = useRef<CameraKitLensViewHandle>(null);
  const [ckReady, setCkReady] = useState(false);
  const [ckLenses, setCkLenses] = useState<CKLens[]>([]);
  const [ckSelectedLens, setCkSelectedLens] = useState<string | null>(null);
  const apiToken = (process.env.EXPO_PUBLIC_CAMERAKIT_API_TOKEN as string) || '';
  const lensGroupId = (process.env.EXPO_PUBLIC_CAMERAKIT_LENS_GROUP_ID as string) || '';

  const cameraRef = useRef<any>(null);
  const recordingRef = useRef(false);
  const pendingRecordRef = useRef(false);
  const holdTimerRef = useRef<any>(null);
  const pressStartRef = useRef(0);
  const recordStartRef = useRef(0);

  const goToComposer = useCallback((uri: string, type: 'image' | 'video', width?: number, height?: number) => {
    const fid = tab === 'filters' ? filterId : null;
    if (returnTo === 'chat') {
      const chatParams = route?.params?.chatParams || {};
      navigation.navigate('Chat', { ...chatParams, capturedMedia: { uri, type, width, height, filterId: fid } });
      return;
    }
    if (returnTo === 'feed') {
      const feedParams = route?.params?.feedParams || {};
      navigation.navigate('Feed', { ...feedParams, capturedMedia: { uri, type, width, height, filterId: fid } });
      return;
    }
    navigation.navigate('StoryComposer', {
      assets: [{ uri, localUri: uri, type, mediaType: type, width, height, filterId: fid }],
      mode: type,
    });
  }, [navigation, filterId, tab, returnTo, route]);

  // ── Filters tab: preview snapshot + picker (same as before) ──
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

  // ── Filters tab capture (expo-camera, unchanged) ──
  const takePhotoFilters = useCallback(async () => {
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

  const doRecordFilters = useCallback(async (attempt: number = 0) => {
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
        setTimeout(() => doRecordFilters(attempt + 1), 150);
        return;
      }
      pendingRecordRef.current = false;
      setCamMode('picture');
      resetAudioMode();
      if (!msg.toLowerCase().includes('not ready')) Alert.alert('Recording failed', msg || 'Unknown error');
    }
  }, [processing, goToComposer]);

  const requestRecordFilters = useCallback(async () => {
    if (recordingRef.current || processing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (micPerm && !micPerm.granted && requestMicPerm) requestMicPerm();
    try { if (ExpoAVAudio) await ExpoAVAudio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }); } catch {}
    pendingRecordRef.current = true;
    setCamMode('video');
    setTimeout(() => { if (pendingRecordRef.current) doRecordFilters(0); }, 300);
  }, [processing, micPerm, requestMicPerm, doRecordFilters]);

  const stopRecordFilters = useCallback(() => {
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

  // ── Lenses tab capture (Camera Kit, real) ──
  const takePhotoLenses = useCallback(async () => {
    if (!ckReady || processing) return;
    setProcessing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const uri = await ckRef.current?.capturePhoto();
      if (uri) goToComposer(uri, 'image');
      else Alert.alert('Error', 'Could not take photo.');
    } catch (e) {
      console.error('[FunCamera] lens photo error:', e);
      Alert.alert('Error', 'Could not take photo.');
    } finally {
      setProcessing(false);
    }
  }, [ckReady, processing, goToComposer]);

  const startRecordLenses = useCallback(() => {
    if (!ckReady || recordingRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    recordingRef.current = true;
    setRecording(true);
    ckRef.current?.startVideo();
  }, [ckReady]);

  const stopRecordLenses = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setProcessing(true);
    try {
      const uri = await ckRef.current?.stopVideo();
      if (uri) {
        let safeUri = uri;
        try { safeUri = (await ensureUploadSafe(uri, 'video')).uri; }
        catch (e: any) { console.log('[FunCamera] uploadSafe unavailable, using raw file:', e?.message || e); }
        goToComposer(safeUri, 'video');
      } else {
        Alert.alert('Recording failed', 'No video was captured. Try again.');
      }
    } finally {
      setProcessing(false);
    }
  }, [goToComposer]);

  // ── Unified capture button: tap = photo, hold = video, routed by tab ──
  const onPressIn = useCallback(() => {
    pressStartRef.current = Date.now();
    holdTimerRef.current = setTimeout(() => {
      if (tab === 'filters') requestRecordFilters();
      else startRecordLenses();
    }, 250);
  }, [tab, requestRecordFilters, startRecordLenses]);

  const onPressOut = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    const held = Date.now() - pressStartRef.current;
    if (held < 250 && !recordingRef.current) {
      if (tab === 'filters') takePhotoFilters(); else takePhotoLenses();
      return;
    }
    if (tab === 'filters') stopRecordFilters(); else stopRecordLenses();
  }, [tab, takePhotoFilters, takePhotoLenses, stopRecordFilters, stopRecordLenses]);

  const pickLens = useCallback((lens: CKLens | null) => {
    Haptics.selectionAsync();
    setCkSelectedLens(lens?.id || null);
    ckRef.current?.applyLens(lens?.id || null, lensGroupId);
  }, [lensGroupId]);

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

      {tab === 'filters' ? (
        <>
          <CameraView key={camMode} ref={cameraRef} style={s.camera} facing="front" mode={camMode} videoQuality="720p"
            onCameraReady={() => { if (pendingRecordRef.current && camMode === 'video') doRecordFilters(0); }} />
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <FilterLayer filterId={filterId} amt={100} />
          </View>
        </>
      ) : (
        !webViewAvailable ? (
          <View style={[s.fallback, { flex: 1 }]}>
            <Text style={[s.fallbackSub, { paddingHorizontal: 40 }]}>Lenses need a new app build.</Text>
          </View>
        ) : !apiToken || !lensGroupId ? (
          <View style={[s.fallback, { flex: 1 }]}>
            <Text style={[s.fallbackSub, { paddingHorizontal: 40 }]}>{!apiToken ? 'No Camera Kit token set. Add EXPO_PUBLIC_CAMERAKIT_API_TOKEN to .env.' : 'No Lens Group set. Add EXPO_PUBLIC_CAMERAKIT_LENS_GROUP_ID to .env, copy it from My Lenses -> Camera Kit -> your app.'}</Text>
          </View>
        ) : (
          <CameraKitLensView
            ref={ckRef}
            apiToken={apiToken}
            lensGroupId={lensGroupId}
            onReady={() => setCkReady(true)}
            onLenses={(l) => setCkLenses(l)}
            onError={(m) => console.log('[FunCamera] CameraKit error:', m)}
          />
        )
      )}

      <SafeAreaView style={s.topControls} edges={['top']}>
        <View style={s.cornerRow}>
          <TouchableOpacity style={s.topBtn} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={24} color="#FFF" />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={s.topBtn} onPress={() => ckRef.current?.flip()} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={recording}>
            <Feather name="refresh-cw" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
        <View style={s.tabSwitch}>
          <TouchableOpacity style={[s.tabBtn, tab === 'filters' && s.tabBtnOn]} onPress={() => setTab('filters')} disabled={recording}>
            <Text style={[s.tabTxt, tab === 'filters' && s.tabTxtOn]}>Filters</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tabBtn, tab === 'lenses' && s.tabBtnOn]} onPress={() => setTab('lenses')} disabled={recording}>
            <Text style={[s.tabTxt, tab === 'lenses' && s.tabTxtOn]}>Lenses</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {tab === 'filters' ? (
        <View style={[s.filterBarWrap, { bottom: Math.max(insets.bottom + 150, 176) }]} pointerEvents={recording ? 'none' : 'auto'}>
          <TouchableOpacity onPress={openFilters} activeOpacity={0.85} style={s.filterBtn} disabled={snapshotting}>
            {snapshotting ? <ActivityIndicator color="#FFF" size="small" /> : <Feather name="sliders" size={18} color="#FFF" />}
            <Text style={s.filterBtnTxt}>{filterId ? filterId.charAt(0).toUpperCase() + filterId.slice(1) : 'Filters'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[s.lensStripWrap, { bottom: Math.max(insets.bottom + 150, 176) }]} pointerEvents={recording ? 'none' : 'auto'}>
          {!ckReady ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.lensStrip}>
              <TouchableOpacity onPress={() => pickLens(null)} activeOpacity={0.85} style={s.lensItem}>
                <View style={[s.lensCircle, !ckSelectedLens && s.lensCircleOn]}><Feather name="slash" size={18} color="#FFF" /></View>
                <Text style={[s.lensLabel, !ckSelectedLens && s.lensLabelOn]}>None</Text>
              </TouchableOpacity>
              {ckLenses.map((lens) => {
                const on = ckSelectedLens === lens.id;
                return (
                  <TouchableOpacity key={lens.id} onPress={() => pickLens(lens)} activeOpacity={0.85} style={s.lensItem}>
                    <View style={[s.lensCircle, on && s.lensCircleOn]}>
                      {lens.iconUrl ? <Image source={{ uri: lens.iconUrl }} style={s.lensThumbImg} /> : <Feather name="zap" size={18} color="#FFF" />}
                    </View>
                    <Text style={[s.lensLabel, on && s.lensLabelOn]} numberOfLines={1}>{lens.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

      <View style={[s.bottomControls, { paddingBottom: Math.max(insets.bottom + 18, 32) }]}>
        <View style={s.captureRow}>
          <View style={{ width: 44 }} />
          <TouchableOpacity onPressIn={onPressIn} onPressOut={onPressOut} activeOpacity={1}
            style={[s.captureWrap, { transform: [{ scale: recording ? 1.08 : 1 }] }]}>
            <View style={[s.captureRing, recording && s.captureRingRecording]} />
            <View style={[s.captureInner, recording && s.captureInnerRecording]}>
              {processing && <ActivityIndicator color="#000" size="small" />}
            </View>
          </TouchableOpacity>
          <View style={{ width: 44 }} />
        </View>
        <Text style={s.hintTxt}>{recording ? 'Release to stop' : 'Tap for photo, hold for video'}</Text>
      </View>

      {tab === 'filters' && (
        <FilterPickerSheet
          visible={filterOpen}
          onClose={() => setFilterOpen(false)}
          selected={filterId}
          onSelect={(fid: string | null) => setFilterId(fid)}
          previewUri={previewSnapshot}
        />
      )}
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

  topControls: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 8, zIndex: 10 },
  cornerRow: { flexDirection: 'row', alignItems: 'center' },
  topBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },

  tabSwitch: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)' },
  tabBtnOn: { backgroundColor: 'rgba(255,255,255,0.9)' },
  tabTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
  tabTxtOn: { color: '#000' },

  filterBarWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  filterBtnTxt: { color: '#FFF', fontSize: 13.5, fontWeight: '700' },

  lensStripWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center', minHeight: 70 },
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
