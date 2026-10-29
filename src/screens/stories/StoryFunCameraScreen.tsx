// src/screens/stories/StoryFunCameraScreen.tsx
// FUN mode. Two tabs now: Filters (2D looks, live via FilterLayer, unchanged
// from before) and Lenses (real AR via CameraKitLensView, backed by a real
// Camera Kit session and a real lens group). Capture routes through whichever
// pipeline is active into the same StoryComposer handoff either way.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraLife } from '../../hooks/useCameraLife';
import { PinchGestureHandler, State as GHState } from 'react-native-gesture-handler';
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
  TextInput,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ensureUploadSafe } from '../../utils/uploadSafe';
import { FilterLayer, FilterPickerSheet, STORY_FILTERS } from '../../components/stories/StoryFilters';
import { CameraKitLensView, CKLens, CameraKitLensViewHandle, webViewAvailable } from './CameraKitLensView';
import { setPendingCapture } from '../../utils/captureBridge';
import { STORY_CAPTURE_VIDEO_QUALITY, STORY_CAPTURE_VIDEO_BITRATE } from '../../../shared/storyCapture';

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

// A hook is always called, whichever module the binary has: the fallback
// hook returns the same shape and keeps hook order constant.
const useMicFallback = (): any[] => [null, null];
const useMic: () => any[] = useMicrophonePermissions || useMicFallback;

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
  const micPair = useMic();
  const micPerm = micPair[0];
  const requestMicPerm = micPair[1];
  const [tab, setTab] = useState<'filters' | 'lenses'>('filters');
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>('photo');
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', event => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [camMode, setCamMode] = useState<'picture' | 'video'>('picture');
  // Pinch zoom, same feel as the story camera. zoom is the CameraView's 0..1 value.
  const [zoom, setZoom] = useState(0);
  const zoomBaseRef = useRef(0);
  const onPinch = useCallback((e: any) => {
    const scale = e.nativeEvent.scale;
    setZoom(Math.max(0, Math.min(1, zoomBaseRef.current + (scale - 1) * 0.35)));
  }, []);
  const onPinchState = useCallback((e: any) => {
    if (e.nativeEvent.state === GHState.END || e.nativeEvent.state === GHState.CANCELLED) {
      zoomBaseRef.current = Math.max(0, Math.min(1, zoomBaseRef.current + (e.nativeEvent.scale - 1) * 0.35));
    }
  }, []);

  // Filters tab (unchanged) ---------------------------------------------
  const [filterId, setFilterId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState(false);

  // Lenses tab (new, real) ------------------------------------------------
  const ckRef = useRef<CameraKitLensViewHandle>(null);
  const [ckReady, setCkReady] = useState(false);
  const ckReadyRef = useRef(false);
  const [ckLenses, setCkLenses] = useState<CKLens[]>([]);
  const [ckSelectedLens, setCkSelectedLens] = useState<string | null>(null);
  const [lensQuery, setLensQuery] = useState('');
  const [ckError, setCkError] = useState('');
  const [ckAttempt, setCkAttempt] = useState(0);
  const apiToken = (process.env.EXPO_PUBLIC_CAMERAKIT_API_TOKEN as string) || '';
  const lensGroupId = (process.env.EXPO_PUBLIC_CAMERAKIT_LENS_GROUP_ID as string) || '';

  const cameraRef = useRef<any>(null);
  const cam = useCameraLife();
  const recordingRef = useRef(false);
  const pendingRecordRef = useRef(false);
  const holdTimerRef = useRef<any>(null);
  const pressStartRef = useRef(0);
  const pressActiveRef = useRef(false);
  const recordStartRef = useRef(0);
  const activeRef = useRef(cam.active);
  activeRef.current = cam.active;
  const videoStopRef = useRef<() => void>(() => {});
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (tab !== 'lenses' || !cam.active) return;
    ckReadyRef.current = false; setCkReady(false); setCkError(''); setCkSelectedLens(null);
    const timer = setTimeout(() => { if (!ckReadyRef.current) setCkError('Lenses are taking longer to load. Retry or use a Platinum effect.'); }, 25_000);
    return () => clearTimeout(timer);
  }, [tab, cam.active, cam.epoch, ckAttempt]);
  useEffect(() => {
    if (ckReady) setCkError('');
  }, [ckReady]);
  useEffect(() => {
    activeRef.current = cam.active;
    if (!cam.active) {
      pendingRecordRef.current = false;
      clearTimeout(holdTimerRef.current);
      if (recordingRef.current) videoStopRef.current();
    }
    return () => {
      activeRef.current = false;
      clearTimeout(holdTimerRef.current);
      if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
      pendingRecordRef.current = false;
    };
  }, [cam.active]);

  const goToComposer = useCallback((uri: string, type: 'image' | 'video', width?: number, height?: number) => {
    if (!activeRef.current) return;
    const fid = tab === 'filters' ? filterId : null;
    if (returnTo === 'chat') {
      const chatParams = route?.params?.chatParams || {};
      navigation.navigate('Chat', { ...chatParams, capturedMedia: { uri, type, width, height, filterId: fid } });
      return;
    }
    if (returnTo === 'feed') {
      // FeedMain sits inside the Feed tab inside Main, unreachable by name from
      // this stack, so hand the capture over the bridge and pop back to it.
      setPendingCapture('feed', { uri, type, width, height, filterId: fid });
      if (navigation.canGoBack()) navigation.goBack();
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
      if (msg.toLowerCase().includes('not ready') && pendingRecordRef.current && attempt < 20) {
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
    if (!micPerm?.granted && requestMicPerm) {
      const permission = await requestMicPerm();
      if (!permission?.granted) { Alert.alert('Microphone access needed', 'Allow microphone access to record a video with sound.'); return; }
    }
    if (!activeRef.current || (captureMode === 'photo' && !pressActiveRef.current)) return;
    try { if (ExpoAVAudio) await ExpoAVAudio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true }); } catch {}
    if (!activeRef.current || (captureMode === 'photo' && !pressActiveRef.current)) return;
    pendingRecordRef.current = true;
    setCamMode('video');
    setTimeout(() => { if (pendingRecordRef.current) doRecordFilters(0); }, 300);
  }, [processing, micPerm, requestMicPerm, doRecordFilters, captureMode]);

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

  const startRecordLenses = useCallback(async () => {
    if (!ckReady || recordingRef.current || processing) return;
    if (!micPerm?.granted && requestMicPerm) {
      const permission = await requestMicPerm();
      if (!permission?.granted) { Alert.alert('Microphone access needed', 'Allow microphone access to record a video with sound.'); return; }
    }
    if (!activeRef.current || (captureMode === 'photo' && !pressActiveRef.current)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    recordingRef.current = true;
    setRecording(true);
    ckRef.current?.startVideo();
    recordTimerRef.current = setTimeout(() => videoStopRef.current(), MAX_VIDEO_SEC * 1000);
  }, [ckReady, processing, micPerm, requestMicPerm, captureMode]);

  const stopRecordLenses = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
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
    } catch {
      if (activeRef.current) Alert.alert('Recording unavailable', 'The lens could not finish that video. Try again or choose a Platinum effect.');
    } finally {
      setProcessing(false);
    }
  }, [goToComposer]);
  videoStopRef.current = tab === 'filters' ? stopRecordFilters : () => { void stopRecordLenses(); };

  // ── Unified capture button: tap = photo, hold = video, routed by tab ──
  const onPressIn = useCallback(() => {
    if (processing || (tab === 'lenses' && !ckReady) || captureMode === 'video') return;
    pressActiveRef.current = true;
    pressStartRef.current = Date.now();
    holdTimerRef.current = setTimeout(() => {
      if (tab === 'filters') requestRecordFilters();
      else startRecordLenses();
    }, 250);
  }, [tab, requestRecordFilters, startRecordLenses, processing, ckReady, captureMode]);

  const onPressOut = useCallback(() => {
    pressActiveRef.current = false;
    if (processing || (tab === 'lenses' && !ckReady)) return;
    if (captureMode === 'video') {
      if (recordingRef.current || pendingRecordRef.current) videoStopRef.current();
      else if (tab === 'filters') void requestRecordFilters();
      else void startRecordLenses();
      return;
    }
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    const held = Date.now() - pressStartRef.current;
    if (held < 250 && !recordingRef.current) {
      if (tab === 'filters') takePhotoFilters(); else takePhotoLenses();
      return;
    }
    if (tab === 'filters') stopRecordFilters(); else stopRecordLenses();
  }, [tab, takePhotoFilters, takePhotoLenses, stopRecordFilters, stopRecordLenses, processing, ckReady, captureMode, requestRecordFilters, startRecordLenses]);

  const pickLens = useCallback((lens: CKLens | null) => {
    Keyboard.dismiss();
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
          <PinchGestureHandler onGestureEvent={onPinch} onHandlerStateChange={onPinchState}>
            <View style={{ flex: 1 }}>
              <CameraView key={camMode + ':' + cam.epoch} active={cam.active} ref={cameraRef} style={s.camera} facing={facing} zoom={zoom} mode={camMode} videoQuality={STORY_CAPTURE_VIDEO_QUALITY} videoBitrate={STORY_CAPTURE_VIDEO_BITRATE}
                onCameraReady={() => { if (pendingRecordRef.current && camMode === 'video') doRecordFilters(0); }} />
            </View>
          </PinchGestureHandler>
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
            <Text style={[s.fallbackSub, { paddingHorizontal: 40 }]}>Snapchat lenses are not available in this build. Choose a Platinum effect to keep creating.</Text>
          </View>
        ) : cam.active ? (
          <CameraKitLensView
            key={`lenses:${cam.epoch}:${ckAttempt}`}
            ref={ckRef}
            apiToken={apiToken}
            lensGroupId={lensGroupId}
            onReady={() => { ckReadyRef.current = true; setCkReady(true); }}
            onLenses={(l) => setCkLenses(l)}
            onError={() => { ckReadyRef.current = false; setCkError('This lens could not load. Retry or choose another effect.'); setCkReady(false); recordingRef.current = false; setRecording(false); setProcessing(false); }}
          />
        ) : <View style={s.camera}/>
      )}

      <View style={[s.topControls, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <View style={s.cornerRow}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={returnTo==='feed'?'Back to post draft':'Close camera'} style={s.topBtn} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={24} color="#FFF" />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Flip camera" style={s.topBtn} onPress={() => { if (tab === 'lenses') ckRef.current?.flip(); else { setFacing(v => v === 'front' ? 'back' : 'front'); setPreviewSnapshot(null); } }} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={recording || processing}>
            <Feather name="refresh-cw" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
        <View style={s.tabSwitch}>
          <TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab==='filters'}} style={[s.tabBtn, tab === 'filters' && s.tabBtnOn]} onPress={() => setTab('filters')} disabled={recording || processing}>
            <Text style={[s.tabTxt, tab === 'filters' && s.tabTxtOn]}>Platinum effects</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab==='lenses'}} style={[s.tabBtn, tab === 'lenses' && s.tabBtnOn]} onPress={() => setTab('lenses')} disabled={recording || processing}>
            <Text style={[s.tabTxt, tab === 'lenses' && s.tabTxtOn]}>Snapchat lenses</Text>
          </TouchableOpacity>
        </View>
      </View>

      {tab === 'filters' ? (
        <View style={[s.filterBarWrap, { bottom: Math.max(insets.bottom + 200, 220) }]} pointerEvents={recording || processing ? 'none' : 'auto'}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.lensStrip} style={{width:'100%',marginBottom:12}}>
            {[{id:null,label:'Original'}, ...STORY_FILTERS.filter(effect => effect.family === 'platinum')].map(effect => <TouchableOpacity key={effect.id || 'original'} accessibilityRole="button" accessibilityLabel={effect.label} accessibilityState={{selected:filterId===effect.id}} onPress={() => setFilterId(effect.id)} style={s.lensItem}><View style={[s.lensCircle, {backgroundColor:'#8B948E'}, filterId===effect.id&&s.lensCircleOn]}><FilterLayer filterId={effect.id}/><Feather name={effect.id?'sun':'slash'} size={21} color="#FFF"/></View><Text numberOfLines={2} style={[s.lensLabel,filterId===effect.id&&s.lensLabelOn]}>{effect.label}</Text></TouchableOpacity>)}
          </ScrollView>
          <TouchableOpacity onPress={openFilters} activeOpacity={0.85} style={s.filterBtn} disabled={snapshotting}>
            {snapshotting ? <ActivityIndicator color="#FFF" size="small" /> : <Feather name="sliders" size={18} color="#FFF" />}
            <Text style={s.filterBtnTxt}>All effects</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View accessibilityLabel="Available lens controls" style={[s.lensStripWrap, { bottom: keyboardHeight ? (Platform.OS === 'ios' ? keyboardHeight + 12 : 12) : Math.max(insets.bottom + 200, 220) }]} pointerEvents={recording || processing ? 'none' : 'auto'}>
          {ckError || !apiToken || !lensGroupId || !webViewAvailable ? <View style={s.lensError}><Text accessibilityRole="alert" style={s.lensErrorText}>{ckError || 'Snapchat lenses are not available in this build.'}</Text><View style={{flexDirection:'row',gap:12}}>{apiToken&&lensGroupId&&webViewAvailable?<TouchableOpacity accessibilityRole="button" style={s.filterBtn} onPress={()=>setCkAttempt(n=>n+1)}><Text style={s.filterBtnTxt}>Retry lenses</Text></TouchableOpacity>:null}<TouchableOpacity accessibilityRole="button" style={s.filterBtn} onPress={()=>setTab('filters')}><Text style={s.filterBtnTxt}>Use effects</Text></TouchableOpacity></View></View> : !ckReady ? (
            <View style={s.lensError}><ActivityIndicator color="#FFF" /><Text style={s.lensErrorText}>Loading Snapchat lenses…</Text></View>
          ) : (
            <><View style={s.lensSearch}><Feather name="search" size={18} color="#EAE4DB"/><TextInput accessibilityLabel="Search available Snapchat lenses" placeholder="Search your lenses" placeholderTextColor="#CCC7C0" value={lensQuery} onChangeText={setLensQuery} autoCorrect={false} returnKeyType="done" onSubmitEditing={()=>Keyboard.dismiss()} style={s.lensSearchInput}/>{lensQuery?<TouchableOpacity accessibilityLabel="Clear lens search" onPress={()=>setLensQuery('')} style={s.topBtn}><Feather name="x" size={17} color="#FFF"/></TouchableOpacity>:null}</View><ScrollView horizontal keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsHorizontalScrollIndicator={false} contentContainerStyle={s.lensStrip}>
              <TouchableOpacity onPress={() => pickLens(null)} activeOpacity={0.85} style={s.lensItem}>
                <View style={[s.lensCircle, !ckSelectedLens && s.lensCircleOn]}><Feather name="slash" size={18} color="#FFF" /></View>
                <Text style={[s.lensLabel, !ckSelectedLens && s.lensLabelOn]}>None</Text>
              </TouchableOpacity>
              {ckLenses.filter(lens=>lens.name.toLowerCase().includes(lensQuery.trim().toLowerCase())).map((lens) => {
                const on = ckSelectedLens === lens.id;
                return (
                  <TouchableOpacity key={lens.id} accessibilityRole="button" accessibilityLabel={lens.name} accessibilityState={{selected:on}} onPress={() => pickLens(lens)} activeOpacity={0.85} style={s.lensItem}>
                    <View style={[s.lensCircle, on && s.lensCircleOn]}>
                      {lens.iconUrl ? <Image source={{ uri: lens.iconUrl }} style={s.lensThumbImg} /> : <Feather name="zap" size={18} color="#FFF" />}
                    </View>
                    <Text style={[s.lensLabel, on && s.lensLabelOn]} numberOfLines={1}>{lens.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>{!ckLenses.some(lens=>lens.name.toLowerCase().includes(lensQuery.trim().toLowerCase()))?<Text style={s.lensErrorText}>{lensQuery?'No available lens matches this search.':'No lenses are enabled for this camera yet.'}</Text>:null}</>
          )}
        </View>
      )}

      <View style={[s.bottomControls, { paddingBottom: Math.max(insets.bottom + 18, 32) }]}>
        <View style={[s.tabSwitch,{marginTop:0,marginBottom:12}]}>{(['photo','video'] as const).map(mode=><TouchableOpacity key={mode} accessibilityRole="tab" accessibilityLabel={mode==='photo'?'Photo capture':'Video capture'} accessibilityState={{selected:captureMode===mode}} disabled={recording||processing} style={[s.tabBtn,captureMode===mode&&s.tabBtnOn]} onPress={()=>setCaptureMode(mode)}><Text style={[s.tabTxt,captureMode===mode&&s.tabTxtOn]}>{mode==='photo'?'Photo':'Video'}</Text></TouchableOpacity>)}</View>
        <View style={s.captureRow}>
          <View style={{ width: 44 }} />
          <TouchableOpacity onPressIn={onPressIn} onPressOut={onPressOut} activeOpacity={1}
            accessibilityRole="button" accessibilityLabel={recording?'Stop recording':captureMode==='video'?'Record video':'Take photo'} disabled={processing || (tab==='lenses' && (!ckReady || !!ckError))}
            style={[s.captureWrap, { transform: [{ scale: recording ? 1.08 : 1 }] }]}>
            <View style={[s.captureRing, recording && s.captureRingRecording]} />
            <View style={[s.captureInner, recording && s.captureInnerRecording]}>
              {processing && <ActivityIndicator color="#000" size="small" />}
            </View>
          </TouchableOpacity>
          <View style={{ width: 44 }} />
        </View>
        <Text style={s.hintTxt}>{processing?'Preparing your capture…':recording ? (captureMode==='video'?'Tap to stop recording':'Release to stop') : captureMode==='video'?'Tap to record · up to 60 seconds':'Tap for photo · hold for video'}</Text>
        {returnTo==='feed'&&!recording&&!processing?<Text style={[s.hintTxt,{fontSize:12,marginTop:6}]}>Add a voice effect in Edit video after recording.</Text>:null}
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
  lensCircleOn: { borderColor: '#F4CDB9', backgroundColor: 'rgba(0,0,0,0.3)' },
  lensThumbImg: { width: '100%', height: '100%' },
  lensLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10.5, fontWeight: '600', marginTop: 4 },
  lensLabelOn: { color: '#F4CDB9', fontWeight: '800' },
  lensSearch: { flexDirection:'row',alignItems:'center',gap:8,marginHorizontal:20,marginBottom:14,paddingHorizontal:12,borderRadius:16,backgroundColor:'rgba(18,22,29,.88)' },
  lensSearchInput: { flex:1,minWidth:0,minHeight:48,paddingVertical:10,fontSize:16,color:'#FFF',includeFontPadding:false,textAlignVertical:'center' },
  lensError: { alignItems:'center',padding:18,marginHorizontal:20,gap:14,borderRadius:18,backgroundColor:'rgba(18,22,29,.9)' },
  lensErrorText: { color:'#EEE8DF',fontSize:13,lineHeight:19,textAlign:'center',paddingHorizontal:12 },

  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 16 },
  captureRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 },
  captureWrap: { width: CAPTURE_SIZE + 12, height: CAPTURE_SIZE + 12, alignItems: 'center', justifyContent: 'center' },
  captureRing: { position: 'absolute', width: CAPTURE_SIZE + 12, height: CAPTURE_SIZE + 12, borderRadius: (CAPTURE_SIZE + 12) / 2, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)' },
  captureRingRecording: { borderColor: '#FF3B30' },
  captureInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  captureInnerRecording: { width: 28, height: 28, borderRadius: 7, backgroundColor: '#FF3B30' },
  hintTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '500', marginTop: 12 },
});
