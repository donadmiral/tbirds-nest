import { normalizeStoryCapture, STORY_CAPTURE_VIDEO_QUALITY, STORY_CAPTURE_VIDEO_BITRATE } from '../../../shared/storyCapture';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraLife } from '../../hooks/useCameraLife';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  StatusBar,
  Platform,
  Alert,
  Image,
  Dimensions,
  ActivityIndicator,
  Animated,
  PanResponder,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { ensureUploadSafe } from '../../utils/uploadSafe';
import Svg, { Circle } from 'react-native-svg';
import { PinchGestureHandler, TapGestureHandler, State as GHState } from 'react-native-gesture-handler';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const SCREEN_W = Dimensions.get('window').width;
const MAX_VIDEO_SEC = 60;
const CAPTURE_SIZE = 78;
const RING_R = 36;
const RING_C = 2 * Math.PI * RING_R;

// Safe import: expo-camera may not be in the dev client binary
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

// Safe import: expo-media-library for the last-photo gallery thumbnail
let MediaLibrary: any = null;
try {
  MediaLibrary = require('expo-media-library');
} catch {}

// Safe import: expo-av Audio — the call system's WebRTC configures the iOS audio
// session, which breaks AVCaptureSession recording unless we claim recording rights.
let ExpoAVAudio: any = null;
try { ExpoAVAudio = require('expo-av').Audio; } catch {}
function resetAudioMode() {
  try { if (ExpoAVAudio) ExpoAVAudio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
}


// A hook is always called, whichever module the binary has: the fallback
// hook returns the same shape and keeps hook order constant.
const useMicFallback = (): any[] => [null, null];
const useMic: () => any[] = useMicrophonePermissions || useMicFallback;

export default function StoryCameraScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();

  if (!cameraAvailable) {
    return (
      <View style={s.fallback}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={s.fallbackInner} edges={['top', 'bottom']}>
          <Feather name="camera-off" size={48} color="rgba(255,255,255,0.4)" />
          <Text style={s.fallbackTitle}>Camera not available</Text>
          <Text style={s.fallbackSub}>
            The camera is unavailable in this app version. You can still create a story with text.
          </Text>
          <TouchableOpacity accessibilityRole="button" style={s.fallbackBtn} onPress={() => navigation.navigate('StoryComposer', { mode: 'text', assets: [] })} activeOpacity={0.8}>
            <Text style={s.fallbackBtnTxt}>Create with text</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return <CameraScreenInner navigation={navigation} insets={insets} />;
}

function CameraScreenInner({ navigation, insets }: { navigation: any; insets: any }) {
  const [permission, requestPermission] = useCameraPermissions();
  const micPair = useMic();
  const micPerm = micPair[0];
  const requestMicPerm = micPair[1];
  useEffect(() => {
    if (micPerm && !micPerm.granted && micPerm.canAskAgain && requestMicPerm) requestMicPerm();
  }, [micPerm, requestMicPerm]);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [handsFree, setHandsFree] = useState(false);
  const [timerSec, setTimerSec] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const handsFreeRef = useRef(false);
  const timerSecRef = useRef<0 | 3 | 10>(0);
  const countdownTimerRef = useRef<any>(null);
  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);
  useEffect(() => { timerSecRef.current = timerSec; }, [timerSec]);
  useEffect(() => () => { if (countdownTimerRef.current) clearInterval(countdownTimerRef.current); }, []);
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>('photo');
  const captureModeRef = useRef<'photo' | 'video'>('photo');
  const captureGeneration = useRef(0);
  const mountedRef = useRef(true);
  const photoLock = useRef(false);
  const cameraReadyRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [camMode, setCamMode] = useState<'picture' | 'video'>('picture');
  const pendingRecordRef = useRef(false);
  const recordStartRef = useRef(0);
  const [lastThumb, setLastThumb] = useState<string | null>(null);

  const cameraRef = useRef<any>(null);
  const cam = useCameraLife();
  const recordingRef = useRef(false);
  const zoomBaseRef = useRef(0);
  const holdTimerRef = useRef<any>(null);
  const pressStartRef = useRef(0);
  const zoomStartRef = useRef(0);
  const captureCbRef = useRef<any>({});
  const capturefns = { takePhoto: null as any, requestRecord: null as any, stopRecording: null as any };
  const capturePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pressStartRef.current = Date.now();
        zoomStartRef.current = zoomBaseRef.current;
        if (captureModeRef.current === 'photo' && !handsFreeRef.current) holdTimerRef.current = setTimeout(() => { captureCbRef.current.requestRecord?.(); }, 250);
      },
      onPanResponderMove: (_e: any, g: any) => {
        if (!recordingRef.current) return;
        // Instagram's gesture: the recording finger slides up to zoom in and
        // back down to zoom out. The curve is eased, so the first stop of
        // travel moves 1x to 2x with fine control and the top of the travel
        // reaches the lens's limit, and the value is smoothed frame to frame
        // so the lens never jumps.
        const travel = 260;
        const raw = Math.max(0, Math.min(1, zoomStartRef.current + (-g.dy) / travel));
        const eased = raw * raw * (3 - 2 * raw);
        const prev = zoomBaseRef.current;
        const z = prev + (eased - prev) * 0.35;
        zoomBaseRef.current = z;
        setZoom(z);
      },
      onPanResponderRelease: () => {
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
        if (captureModeRef.current === 'video' || handsFreeRef.current) { if (recordingRef.current) { captureCbRef.current.stopRecording?.(); } else { captureCbRef.current.timedFire?.('video'); } return; }
        const held = Date.now() - pressStartRef.current;
        if (held < 250 && !recordingRef.current) { captureCbRef.current.timedFire?.('photo'); return; }
        captureCbRef.current.stopRecording?.();
      },
      onPanResponderTerminate: () => {
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
        captureCbRef.current.stopRecording?.();
      },
    })
  ).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  captureCbRef.current = { takePhoto: (...a: any[]) => takePhotoRef.current(...a), requestRecord: (...a: any[]) => requestRecordRef.current(...a), stopRecording: (...a: any[]) => stopRecordingRef.current(...a), timedFire: (kind2: 'photo' | 'video') => { const t = timerSecRef.current; const fire = () => { if (kind2 === 'photo') takePhotoRef.current?.(); else requestRecordRef.current?.(); }; if (!t) { fire(); return; } if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; setCountdown(null); return; } let left = t; setCountdown(left); countdownTimerRef.current = setInterval(() => { left -= 1; if (left <= 0) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; setCountdown(null); fire(); } else { setCountdown(left); } }, 1000); } };
  const takePhotoRef = useRef<any>(() => {});
  const requestRecordRef = useRef<any>(() => {});
  const stopRecordingRef = useRef<any>(() => {});
  const progressTimerRef = useRef<any>(null);
  const [progressPct, setProgressPct] = useState(0);
  const startProgress = useCallback(() => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    const t0 = Date.now();
    setProgressPct(0);
    progressTimerRef.current = setInterval(() => {
      if (!recordingRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
        setProgressPct(0);
        return;
      }
      setProgressPct(Math.min(1, (Date.now() - t0) / (MAX_VIDEO_SEC * 1000)));
    }, 100);
  }, []);
  useEffect(() => () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); }, []);
  const doubleTapRef = useRef<any>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Last-photo thumbnail for the gallery shortcut (best-effort)
  useEffect(() => {
    (async () => {
      try {
        if (!MediaLibrary) return;
        const perm = await MediaLibrary.getPermissionsAsync();
        if (!perm.granted) return;
        const res = await MediaLibrary.getAssetsAsync({ first: 1, sortBy: [['creationTime', false]], mediaType: ['photo'] });
        if (res?.assets?.[0]?.uri) setLastThumb(res.assets[0].uri);
      } catch {}
    })();
  }, []);

  const goToComposer = useCallback((uri: string, type: 'image' | 'video', width?: number, height?: number) => {
    navigation.navigate('StoryComposer', {
      assets: [{ uri, localUri: uri, type, mediaType: type, width, height }],
      mode: type,
    });
  }, [navigation]);

  // ── Instagram capture: tap = photo, hold = video ──
  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || !cameraReadyRef.current || photoLock.current || processing || recordingRef.current) return;
    const generation = captureGeneration.current;
    photoLock.current = true;
    setProcessing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: false,
      });
      if (mountedRef.current && generation === captureGeneration.current) goToComposer(photo.uri, 'image', photo.width, photo.height);
    } catch (e) {
      if (!mountedRef.current || generation !== captureGeneration.current) return;
      console.error('[Camera] photo error:', e);
      Alert.alert('Error', 'Could not take photo.');
    } finally {
      if (mountedRef.current && generation === captureGeneration.current) { photoLock.current = false; setProcessing(false); }
    }
  }, [processing, goToComposer]);

  const doRecord = useCallback(async (attempt: number = 0) => {
    if (!cameraRef.current || recordingRef.current || processing || !pendingRecordRef.current) return;
    const generation = captureGeneration.current;
    recordingRef.current = true;
    setRecording(true);
    progressAnim.setValue(0);
    Animated.timing(progressAnim, { toValue: 1, duration: MAX_VIDEO_SEC * 1000, useNativeDriver: false }).start();
    startProgress();
    try {
      recordStartRef.current = Date.now();
      console.log('[Camera] recordAsync starting, attempt', attempt);
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_SEC, codec: 'avc1' });
      if (!mountedRef.current || generation !== captureGeneration.current) return;
      pendingRecordRef.current = false;
      recordingRef.current = false;
      setRecording(false);
      progressAnim.stopAnimation();
      progressAnim.setValue(0);
      setCamMode(captureModeRef.current === 'video' ? 'video' : 'picture');
      resetAudioMode();
      console.log('[Camera] recorded OK:', video?.uri ? 'uri received' : 'NO URI');
      if (video?.uri) {
        setProcessing(true);
        try {
          let safeUri = video.uri;
          try { safeUri = (await ensureUploadSafe(video.uri, 'video')).uri; }
          catch (e: any) { console.log('[Camera] uploadSafe unavailable, using raw file:', e?.message || e); }
          if (mountedRef.current && generation === captureGeneration.current) goToComposer(safeUri, 'video');
        } finally { if (mountedRef.current && generation === captureGeneration.current) setProcessing(false); }
        return;
      }
      Alert.alert('Recording failed', 'No video was captured. Try again.');
    } catch (e: any) {
      if (!mountedRef.current || generation !== captureGeneration.current) return;
      const msg = e?.message || '';
      recordingRef.current = false;
      setRecording(false);
      progressAnim.stopAnimation();
      progressAnim.setValue(0);
      if (msg.toLowerCase().includes('not ready') && pendingRecordRef.current && attempt < 20) {
        setTimeout(() => { if (mountedRef.current && generation === captureGeneration.current && pendingRecordRef.current) doRecord(attempt + 1); }, 150);
        return;
      }
      pendingRecordRef.current = false;
      setCamMode(captureModeRef.current === 'video' ? 'video' : 'picture');
      resetAudioMode();
      console.error('[Camera] video error:', e);
      if (!msg.toLowerCase().includes('not ready')) Alert.alert('Recording failed', msg || 'Unknown error');
      else Alert.alert('Camera busy', 'The camera did not become ready. Try again.');
    }
  }, [processing, goToComposer, progressAnim]);


  const requestRecord = useCallback(async () => {
    if (recordingRef.current || pendingRecordRef.current || processing || photoLock.current || !cameraReadyRef.current) return;
    const generation = captureGeneration.current;
    pendingRecordRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('[Camera] requestRecord, mic status:', micPerm ? micPerm.status : 'hook unavailable');
    if (micPerm && micPerm.granted === false && micPerm.canAskAgain === false) {
      pendingRecordRef.current = false;
      Alert.alert('Microphone blocked', 'Enable Microphone for Platinum Circles in iOS Settings to record video.');
      return;
    }
    if (micPerm && !micPerm.granted && requestMicPerm) {
      try { const result = await requestMicPerm(); if (!result?.granted) { if (generation === captureGeneration.current) pendingRecordRef.current = false; return; } }
      catch { if (generation === captureGeneration.current) pendingRecordRef.current = false; return; }
    }
    if (!mountedRef.current || generation !== captureGeneration.current || !pendingRecordRef.current) return;
    try {
      if (ExpoAVAudio) await ExpoAVAudio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      console.log('[Camera] audio session set for recording');
    } catch (e: any) { console.log('[Camera] audio session error:', e?.message); }
    if (!mountedRef.current || generation !== captureGeneration.current || !pendingRecordRef.current) { if (!recordingRef.current && !pendingRecordRef.current) resetAudioMode(); return; }
    setCamMode('video');
    setTimeout(() => { if (mountedRef.current && generation === captureGeneration.current && pendingRecordRef.current) doRecord(0); }, 300);
  }, [processing, micPerm, requestMicPerm, doRecord]);



  const stopRecording = useCallback(() => {
    pendingRecordRef.current = false;
    if (!recordingRef.current) { setCamMode(captureModeRef.current === 'video' ? 'video' : 'picture'); resetAudioMode(); return; }
    const generation = captureGeneration.current, recordStart = recordStartRef.current;
    const current = () => mountedRef.current && generation === captureGeneration.current && recordStart === recordStartRef.current;
    const elapsed = Date.now() - recordStartRef.current;
    const wait = Math.max(0, 800 - elapsed);
    setTimeout(() => {
      if (!current()) return;
      console.log('[Camera] stopRecording (1st)');
      try { cameraRef.current?.stopRecording(); } catch {}
      setTimeout(() => {
        if (current() && recordingRef.current) {
          console.log('[Camera] second stop attempt (expo#2837 workaround)');
          try { cameraRef.current?.stopRecording(); } catch {}
        }
      }, 700);
      setTimeout(() => {
        if (current() && recordingRef.current) {
          console.log('[Camera] watchdog reset — recordAsync never resolved');
          recordingRef.current = false;
          setRecording(false);
          progressAnim.stopAnimation();
          progressAnim.setValue(0);
          pendingRecordRef.current = false;
          setCamMode(captureModeRef.current === 'video' ? 'video' : 'picture');
          resetAudioMode();
          captureGeneration.current += 1;
        }
      }, 2600);
    }, wait);
  }, [progressAnim]);


  takePhotoRef.current = takePhoto;
  requestRecordRef.current = requestRecord;
  stopRecordingRef.current = stopRecording;
  const toggleFacing = useCallback(() => {
    if (recordingRef.current || pendingRecordRef.current || photoLock.current) return;
    Haptics.selectionAsync();
    setFacing(f => (f === 'back' ? 'front' : 'back'));
  }, []);

  useEffect(() => { cameraReadyRef.current = false; setCameraReady(false); }, [camMode, facing, cam.epoch]);
  useEffect(() => {
    mountedRef.current = true;
    const cancel = () => {
      captureGeneration.current += 1; pendingRecordRef.current = false; photoLock.current = false;
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
      if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
      if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
      try { cameraRef.current?.stopRecording(); } catch {}
      recordingRef.current = false; progressAnim.stopAnimation(); progressAnim.setValue(0); resetAudioMode();
      if (mountedRef.current) { setRecording(false); setProcessing(false); setCountdown(null); setProgressPct(0); setCamMode(captureModeRef.current === 'video' ? 'video' : 'picture'); }
    };
    const off = navigation.addListener?.('blur', cancel);
    return () => { mountedRef.current = false; cancel(); off?.(); };
  }, [navigation]);

  // ── Gallery shortcut ──
  const openGallery = useCallback(async () => {
    const generation = captureGeneration.current;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!mountedRef.current || generation !== captureGeneration.current) return;
    if (!perm.granted) {
      Alert.alert('Permission required', 'Allow photo library access in Settings.');
      return;
    }
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        preferredAssetRepresentationMode: "compatible" as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
        mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        orderedSelection: true,
        quality: 1,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        if (!mountedRef.current || generation !== captureGeneration.current) return;
        const assets = res.assets.map(asset => normalizeStoryCapture(asset));
        navigation.navigate('StoryComposer', { mode: 'media', assets });
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('cancelled') || msg.includes('canceled')) return;
      Alert.alert('Could not open gallery', msg || 'Please try again.');
    }
  }, [navigation]);

  // ── Pinch zoom ──
  const onPinch = useCallback((e: any) => {
    const scale = e.nativeEvent.scale;
    const next = Math.max(0, Math.min(1, zoomBaseRef.current + (scale - 1) * 0.35));
    setZoom(next);
  }, []);
  const onPinchState = useCallback((e: any) => {
    if (e.nativeEvent.state === GHState.END || e.nativeEvent.state === GHState.CANCELLED) {
      zoomBaseRef.current = Math.max(0, Math.min(1, zoomBaseRef.current + (e.nativeEvent.scale - 1) * 0.35));
    }
  }, []);
  const onDoubleTap = useCallback((e: any) => {
    if (e.nativeEvent.state === GHState.ACTIVE) toggleFacing();
  }, [toggleFacing]);

  if (!permission) {
    return (
      <View style={s.fallback}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="#FFF" size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={s.fallback}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={s.fallbackInner} edges={['top', 'bottom']}>
          <Feather name="camera-off" size={48} color="rgba(255,255,255,0.4)" />
          <Text style={s.fallbackTitle}>Camera access needed</Text>
          <Text style={s.fallbackSub}>Allow camera access in Settings to take photos and videos for your stories.</Text>
          <TouchableOpacity style={s.fallbackBtn} onPress={requestPermission} activeOpacity={0.8}>
            <Text style={s.fallbackBtnTxt}>Allow camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.fallbackBtn, { backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 10 }]} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={[s.fallbackBtnTxt, { color: '#FFF' }]}>Go back</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const progressOffset = progressAnim.interpolate({ inputRange: [0, 1], outputRange: [RING_C, 0] });

  return (
    <View style={s.root}>
      <StatusBar hidden />

      <TapGestureHandler ref={doubleTapRef} numberOfTaps={2} onHandlerStateChange={onDoubleTap}>
        <View style={{ flex: 1 }}>
          <PinchGestureHandler onGestureEvent={onPinch} onHandlerStateChange={onPinchState}>
            <View style={{ flex: 1 }}>
              <CameraView key={camMode + ':' + cam.epoch} active={cam.active} ref={cameraRef} style={s.camera} facing={facing} flash={flash} zoom={zoom} mode={camMode} videoQuality={STORY_CAPTURE_VIDEO_QUALITY} videoBitrate={STORY_CAPTURE_VIDEO_BITRATE} onCameraReady={() => { cameraReadyRef.current = true; setCameraReady(true); if (pendingRecordRef.current && camMode === 'video') { doRecord(0); } }} />
            </View>
          </PinchGestureHandler>
        </View>
      </TapGestureHandler>

      {countdown != null && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#FFF', fontSize: 110, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 16 }}>{countdown}</Text>
        </View>
      )}

      {/* Top controls */}
      <View style={[s.topControls, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close story camera" style={s.topBtn} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Camera timer: ${timerSec ? timerSec + ' seconds' : 'off'}`} style={s.topBtn} onPress={() => setTimerSec(t => (t === 0 ? 3 : t === 3 ? 10 : 0))} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="clock" size={20} color={timerSec ? '#E8D3B6' : '#FFF'} />
          {timerSec > 0 && <Text style={{ position: 'absolute', bottom: 2, right: 2, color: '#E8D3B6', fontSize: 9, fontWeight: '800' }}>{timerSec}</Text>}
        </TouchableOpacity>
        {zoom > 0.02 && !recording ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 64, alignItems: 'center', zIndex: 20 }} testID="zoomReadout">
            <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
              <Text style={{ color: '#FFF', fontSize: 12.5, fontWeight: '700' }}>{(1 + zoom * 9).toFixed(1)}x</Text>
            </View>
          </View>
        ) : null}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Hands-free recording" accessibilityState={{ selected: handsFree }} style={s.topBtn} onPress={() => setHandsFree(h => !h)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="video" size={20} color={handsFree ? '#E8D3B6' : '#FFF'} />
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Flash ${flash}`} style={s.topBtn} onPress={() => setFlash(f => (f === 'off' ? 'on' : 'off'))} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name={flash === 'on' ? 'zap' : 'zap-off'} size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* Bottom controls: gallery | capture | flip */}
      <View style={[s.bottomControls, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
        {!recording ? <View style={s.captureModes}>{(['photo', 'video'] as const).map(mode => <TouchableOpacity key={mode} accessibilityRole="tab" accessibilityLabel={mode === 'photo' ? 'Photo capture' : 'Video capture'} accessibilityState={{ selected: captureMode === mode }} disabled={processing || countdown != null} onPress={() => { captureModeRef.current = mode; setCaptureMode(mode); setCamMode(mode === 'video' ? 'video' : 'picture'); }} style={[s.captureMode, captureMode === mode && s.captureModeOn]}><Text style={[s.captureModeText, captureMode === mode && { color: '#171B1E' }]}>{mode === 'photo' ? 'Photo' : 'Video'}</Text></TouchableOpacity>)}</View> : null}
        <View style={s.captureRow}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose story photo or video" style={s.galleryBtn} onPress={openGallery} activeOpacity={0.8} disabled={recording}>
            {lastThumb ? (
              <Image source={{ uri: lastThumb }} style={s.galleryThumb} />
            ) : (
              <Feather name="image" size={20} color="#FFF" />
            )}
          </TouchableOpacity>

          <View accessible accessibilityRole="button" accessibilityLabel={recording ? "Stop recording story" : captureMode === "photo" ? "Take story photo" : "Record story video"} accessibilityState={{ disabled: processing || !cameraReady }} onAccessibilityTap={() => { if (recordingRef.current) stopRecording(); else if (captureMode === "video") requestRecord(); else takePhoto(); }} {...capturePan.panHandlers} style={[s.captureWrap, { opacity: processing || !cameraReady ? .5 : 1 }, { transform: [{ scale: recording ? 1.08 : 1 }] }]}>

            <Svg width={CAPTURE_SIZE + 12} height={CAPTURE_SIZE + 12} style={StyleSheet.absoluteFill as any}>
              <Circle cx={(CAPTURE_SIZE + 12) / 2} cy={(CAPTURE_SIZE + 12) / 2} r={RING_R + 5} stroke={recording ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.9)'} strokeWidth={4} fill="none" />
              {recording && (
                <Circle
                  cx={(CAPTURE_SIZE + 12) / 2}
                  cy={(CAPTURE_SIZE + 12) / 2}
                  r={RING_R + 5}
                  stroke="#FF3B30"
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={RING_C}
                  strokeDashoffset={RING_C * (1 - progressPct)}
                  transform={'rotate(-90 ' + ((CAPTURE_SIZE + 12) / 2) + ' ' + ((CAPTURE_SIZE + 12) / 2) + ')'}
                />
              )}
            </Svg>
            <View style={[s.captureInner, recording && s.captureInnerRecording]}>
              {processing && <ActivityIndicator color="#000" size="small" />}
            </View>
          </View>

          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Switch story camera" style={s.flipBtn} onPress={toggleFacing} activeOpacity={0.7} disabled={recording}>
            <Feather name="refresh-cw" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
        <Text style={s.hintTxt}>{recording ? (zoom > 0.02 ? 'Slide up to zoom · ' + Math.round(zoom * 100) + '%' : 'Release to stop · slide up to zoom') : (handsFree ? (timerSec ? `Hands-free · ${timerSec}s timer — tap to record` : 'Hands-free — tap to start and stop') : (timerSec ? `Timer ${timerSec}s — tap for photo, hold for video` : captureMode === 'video' ? 'Tap to start and stop · up to 60s' : 'Tap for photo · hold for video'))}</Text>
        {!recording && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false} style={s.modeScroll} contentContainerStyle={s.modeRow}>
            <TouchableOpacity onPress={() => navigation.navigate('StoryComposer', { mode: 'text', assets: [] })} activeOpacity={0.7} style={s.modeItem}>
              <Text style={s.modeRowTxt}>TEXT</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: true }} activeOpacity={1} style={[s.modeItem, { backgroundColor: '#E8D3B6' }]}>
              <Text style={[s.modeRowTxt, s.modeRowTxtOn]}>STORY</Text>

            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('StoryDualCapture')} activeOpacity={0.7} style={s.modeItem}>
              <Text style={s.modeRowTxt}>DUAL</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('StoryFunCamera')} activeOpacity={0.7} style={s.modeItem}>
              <Text style={s.modeRowTxt}>LENSES</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('StoryLayout')} activeOpacity={0.7} style={s.modeItem}>
              <Text style={s.modeRowTxt}>LAYOUT</Text>
            </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('StoryBoomerang')} activeOpacity={0.7} style={s.modeItem}>
            <Text style={s.modeRowTxt}>BOOM</Text>
          </TouchableOpacity>
          </ScrollView>
        )}
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

  topControls: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 7, zIndex: 10 },
  topBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },

  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 20, backgroundColor: 'rgba(17,21,24,0.76)', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  captureModes: { flexDirection: 'row', borderRadius: 24, backgroundColor: '#141719D9', padding: 3, marginBottom: 14 },
  captureMode: { minWidth: 91, minHeight: 38, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  captureModeOn: { backgroundColor: '#F1DFC5' },
  captureModeText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  captureRow: { width: SCREEN_W, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 36 },

  galleryBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' },
  galleryThumb: { width: '100%', height: '100%' },

  captureWrap: { width: CAPTURE_SIZE + 12, height: CAPTURE_SIZE + 12, alignItems: 'center', justifyContent: 'center' },
  captureInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  captureInnerRecording: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#FF3B30' },

  flipBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

  modeScroll: { marginTop: 14, alignSelf: 'stretch', flexGrow: 0 },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, flexGrow: 1 },
  modeItem: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 12, borderRadius: 23, paddingVertical: 7 },
  modeRowTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  modeRowTxtOn: { color: '#171B1E' },
  modeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF', marginTop: 5 },
  hintTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '500', marginTop: 12 },
});
