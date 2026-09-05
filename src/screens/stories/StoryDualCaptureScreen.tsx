/**
 * StoryDualCaptureScreen.tsx
 * 
 * "Capture the world. Then capture your reaction."
 * 
 * Sequential cinematic dual capture using expo-camera.
 * Premium motion, freeze-frame confirmation, atmospheric countdown,
 * spring-animated bubble reveal, cancel at any phase.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraLife } from '../../hooks/useCameraLife';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, Alert, Animated, Image, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { prepareDualAsset } from '../../components/stories/DualCameraComposerBridge';
import { DEFAULT_LAYOUT } from '../../components/stories/dual/dualCaptureTypes';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const BUBBLE_W = 120;
const BUBBLE_H = 160;
const BUBBLE_RADIUS = 28;
const MAX_RETRIES = 8;
// Front lens needs time for auto-exposure to meter the face after the flip.
const FRONT_SETTLE_MS = 350;
const RETRY_MS = 250;

type Phase =
  | 'idle'           // camera preview, waiting for shutter
  | 'rear_freeze'    // rear captured, showing freeze-frame confirmation
  | 'countdown'      // 3-2-1 emotional anticipation
  | 'flipping'       // camera switching to front
  | 'awaiting_front' // retry loop waiting for front camera readiness
  | 'front_freeze'   // front captured, showing brief result
  | 'processing';    // preparing asset for composer

export default function StoryDualCaptureScreen() {
  try {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const extraParams = route.params || {};

  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [phase, setPhase] = useState<Phase>('idle');
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [countdown, setCountdown] = useState(3);
  const [rearPhotoUri, setRearPhotoUri] = useState<string | null>(null);
  const [frontPhotoUri, setFrontPhotoUri] = useState<string | null>(null);
  const [mediaMode, setMediaMode] = useState<'photo' | 'video'>('photo');
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);

  const cameraRef = useRef<CameraView>(null);
  const cam = useCameraLife();
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rearPhotoUriRef = useRef<string | null>(null);
  const rearDurationRef = useRef(0);
  const recStartRef = useRef(0);
  const recTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── ANIMATION VALUES ───────────────────────────────────────
  const uiOpacity = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const freezeOpacity = useRef(new Animated.Value(0)).current;
  const bubbleScale = useRef(new Animated.Value(0)).current;
  const bubbleOpacity = useRef(new Animated.Value(0)).current;
  const countdownNumScale = useRef(new Animated.Value(0.5)).current;
  const countdownNumOpacity = useRef(new Animated.Value(0)).current;
  const shutterScale = useRef(new Animated.Value(1)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const resultScale = useRef(new Animated.Value(0.95)).current;
  const resultOpacity = useRef(new Animated.Value(0)).current;

  // ── LIFECYCLE ──────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(uiOpacity, { toValue: 1, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (permission && !permission.granted) requestPermission();
  }, [permission]);

  useEffect(() => {
    if (mediaMode === 'video' && micPermission && !micPermission.granted) requestMicPermission();
  }, [mediaMode, micPermission]);

  // ── CANCEL (works in ALL phases) ───────────────────────────
  const handleCancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (recTickRef.current) clearInterval(recTickRef.current);
    try { cameraRef.current?.stopRecording(); } catch {}
    mountedRef.current = false;
    navigation.goBack();
  }, [navigation]);

  // ── SCREEN FLASH ───────────────────────────────────────────
  const triggerFlash = useCallback(() => {
    flashOpacity.setValue(0.7);
    Animated.timing(flashOpacity, { toValue: 0, duration: 250, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, []);

  // ── REAR CAPTURE ───────────────────────────────────────────
  const captureRear = useCallback(async () => {
    if (!cameraRef.current || phase !== 'idle') return;

    if (mediaMode === 'video') {
      if (recording) { try { cameraRef.current.stopRecording(); } catch {} return; }
      setRecording(true); setRecSeconds(0);
      recStartRef.current = Date.now();
      if (recTickRef.current) clearInterval(recTickRef.current);
      recTickRef.current = setInterval(() => { if (mountedRef.current) setRecSeconds(Math.floor((Date.now() - recStartRef.current) / 1000)); }, 250);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      try {
        const recordWithRetry = async (attempt: number): Promise<any> => {
          try {
            return await cameraRef.current!.recordAsync({ maxDuration: 15, codec: 'avc1' });
          } catch (e: any) {
            const msg = String(e?.message || '').toLowerCase();
            if (msg.includes('not ready') && attempt < 20) {
              await new Promise(r => setTimeout(r, 150));
              return recordWithRetry(attempt + 1);
            }
            throw e;
          }
        };
        const video = await recordWithRetry(0);
        if (recTickRef.current) { clearInterval(recTickRef.current); recTickRef.current = null; }
        setRecording(false);
        if (!video?.uri || !mountedRef.current) return;
        rearDurationRef.current = Math.max(1, Math.min(15, Math.round((Date.now() - recStartRef.current) / 1000)));
        setRearPhotoUri(video.uri);
        rearPhotoUriRef.current = video.uri;
        setPhase('rear_freeze');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        timerRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          setCountdown(3);
          setPhase('countdown');
        }, 450);
      } catch (err: any) {
        if (recTickRef.current) { clearInterval(recTickRef.current); recTickRef.current = null; }
        setRecording(false);
        if (mountedRef.current) Alert.alert('Recording failed', err?.message || 'Could not record video.');
      }
      return;
    }

    // Shutter press animation
    Animated.sequence([
      Animated.timing(shutterScale, { toValue: 0.82, duration: 50, useNativeDriver: true }),
      Animated.spring(shutterScale, { toValue: 1, damping: 10, stiffness: 200, useNativeDriver: true }),
    ]).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    triggerFlash();

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo?.uri || !mountedRef.current) {
        Alert.alert('Capture failed', 'Could not take photo.');
        return;
      }

      setRearPhotoUri(photo.uri);
      rearPhotoUriRef.current = photo.uri;
      setPhase('rear_freeze');

      // Show freeze-frame confirmation for 800ms
      freezeOpacity.setValue(1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Bubble springs in
      bubbleScale.setValue(0);
      bubbleOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(bubbleScale, { toValue: 1, damping: 12, stiffness: 160, delay: 300, useNativeDriver: true }),
        Animated.timing(bubbleOpacity, { toValue: 1, duration: 200, delay: 300, useNativeDriver: true }),
      ]).start();

      // After freeze, transition to countdown
      timerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        Animated.timing(freezeOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start();
        setCountdown(3);
        setPhase('countdown');
      }, 450);

    } catch (err: any) {
      if (mountedRef.current) {
        Alert.alert('Capture failed', err?.message || 'Could not take photo.');
      }
    }
  }, [phase, mediaMode, recording]);

  // ── COUNTDOWN ──────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'countdown') return;

    if (countdown <= 0) {
      // Countdown complete: flip camera
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setPhase('flipping');
      setFacing('front');

      // Overlay dims during flip
      Animated.timing(overlayOpacity, { toValue: 0.6, duration: 200, useNativeDriver: true }).start();

      timerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          Animated.timing(overlayOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
          setPhase('awaiting_front');
        }
      }, 400);
      return;
    }

    // Animate each countdown number: scale up from small, fade in
    countdownNumScale.setValue(0.5);
    countdownNumOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(countdownNumScale, { toValue: 1, damping: 8, stiffness: 120, useNativeDriver: true }),
      Animated.timing(countdownNumOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    timerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      // Fade out current number before next
      Animated.timing(countdownNumOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        if (mountedRef.current) setCountdown(prev => prev - 1);
      });
    }, 900);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [phase, countdown]);

  // ── FRONT CAPTURE (retry loop) ─────────────────────────────
  const frontCapturedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'awaiting_front') return;
    let retries = 0;
    frontCapturedRef.current = false;

    const attempt = async () => {
      await wait(FRONT_SETTLE_MS);
      while (retries < MAX_RETRIES && !frontCapturedRef.current && mountedRef.current) {
        try {
          if (cameraRef.current) {
            const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
            if (photo?.uri && mountedRef.current && !frontCapturedRef.current) {
              frontCapturedRef.current = true;
              triggerFlash();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              setFrontPhotoUri(photo.uri);
              setPhase('front_freeze');

              // Brief result reveal
              resultScale.setValue(0.95);
              resultOpacity.setValue(0);
              Animated.parallel([
                Animated.spring(resultScale, { toValue: 1, damping: 14, stiffness: 150, useNativeDriver: true }),
                Animated.timing(resultOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
              ]).start();

              // Process after memory imprint moment (1200ms to let it breathe)
              timerRef.current = setTimeout(() => {
                if (mountedRef.current) {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  processCapture(photo.uri);
                }
              }, 1200);
              return;
            }
          }
        } catch (err) {
          console.log(`[DualCapture] front retry ${retries + 1}/${MAX_RETRIES}`);
        }
        retries++;
        await wait(RETRY_MS);
      }
      if (mountedRef.current && !frontCapturedRef.current) {
        Alert.alert('Capture failed', 'Front camera did not respond. Please try again.');
        resetToIdle();
      }
    };

    attempt();
  }, [phase]);

  // ── PROCESS AND NAVIGATE TO ARRANGEMENT ────────────────────
  const processCapture = useCallback(async (frontUri: string) => {
    const rearUri = rearPhotoUriRef.current;
    if (!rearUri || !mountedRef.current) return;
    setPhase('processing');

    try {
      const asset = await prepareDualAsset({
        frontPath: frontUri,
        rearPath: rearUri,
        mode: mediaMode,
        layout: DEFAULT_LAYOUT,
        durationSec: mediaMode === 'video' ? rearDurationRef.current : undefined,
      });
      if (mountedRef.current) {
        if (mediaMode === 'video') {
          navigation.navigate('StoryComposer', { mode: 'dual', assets: [asset], ...extraParams });
        } else {
          navigation.navigate('MemoryArrangement', { asset, extraParams });
        }
      }
    } catch (err: any) {
      if (mountedRef.current) {
        Alert.alert('Processing failed', err?.message || 'Could not prepare dual capture.');
        resetToIdle();
      }
    }
  }, [extraParams, mediaMode]);

  // ── RESET ──────────────────────────────────────────────────
  const resetToIdle = useCallback(() => {
    setPhase('idle');
    setFacing('back');
    setRecording(false);
    setRecSeconds(0);
    rearDurationRef.current = 0;
    if (recTickRef.current) { clearInterval(recTickRef.current); recTickRef.current = null; }
    try { cameraRef.current?.stopRecording(); } catch {}
    setRearPhotoUri(null);
    rearPhotoUriRef.current = null;
    setFrontPhotoUri(null);
    setCountdown(3);
    bubbleScale.setValue(0);
    bubbleOpacity.setValue(0);
    freezeOpacity.setValue(0);
    overlayOpacity.setValue(0);
    resultOpacity.setValue(0);
  }, []);

  // Returning to this screen must always show a live camera, never a spent capture.
  useFocusEffect(
    useCallback(() => {
      resetToIdle();
      return undefined;
    }, [resetToIdle])
  );

  // ── PERMISSION SCREENS ─────────────────────────────────────
  if (!permission) return <View style={s.loading}><ActivityIndicator color="#FFF" size="large" /></View>;
  if (!permission.granted) {
    return (
      <View style={s.loading}>
        <Feather name="camera-off" size={40} color="rgba(255,255,255,0.4)" />
        <Text style={s.permTxt}>Camera access is required for dual capture.</Text>
        <TouchableOpacity style={s.permBtn} onPress={requestPermission} activeOpacity={0.7}>
          <Text style={s.permBtnTxt}>Grant Access</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleCancel} style={{ marginTop: 16 }}>
          <Text style={s.permBtnTxt}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── DERIVED STATE ──────────────────────────────────────────
  const isIdle = phase === 'idle';
  const showCountdown = phase === 'countdown';
  const isBusy = phase === 'flipping' || phase === 'awaiting_front' || phase === 'processing';

  return (
    <View style={s.root}>
      {/* Live camera preview */}
      <CameraView key={'dual:' + cam.epoch} active={cam.active} ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode={mediaMode === 'video' ? 'video' : 'picture'} videoQuality="720p" />

      {/* Atmospheric top gradient (always visible, gives depth) */}
      <LinearGradient colors={['rgba(0,0,0,0.4)', 'rgba(0,0,0,0)']} style={s.topGradient} pointerEvents="none" />

      {/* Atmospheric bottom gradient */}
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)']} style={s.bottomGradient} pointerEvents="none" />

      {/* Freeze-frame overlay (shows captured rear photo briefly) */}
      {rearPhotoUri && mediaMode === 'photo' && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: freezeOpacity, zIndex: 25 }]} pointerEvents="none">
          <Image source={{ uri: rearPhotoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </Animated.View>
      )}

      {/* Flash */}
      <Animated.View style={[s.flash, { opacity: flashOpacity }]} pointerEvents="none" />

      {/* Flip transition overlay */}
      <Animated.View style={[s.flipOverlay, { opacity: overlayOpacity }]} pointerEvents="none" />

      {/* MEMORY REVEAL: rear scene fullscreen + front reaction as bubble */}
      {frontPhotoUri && mediaMode === 'photo' && (phase === 'front_freeze' || phase === 'processing') && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: resultOpacity, transform: [{ scale: resultScale }], zIndex: 26 }]} pointerEvents="none">
          {/* Rear scene stays dominant (the world) */}
          {rearPhotoUri && <Image source={{ uri: rearPhotoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
          {/* Front reaction as bubble (your reaction is secondary) */}
          <View style={[s.resultBubble, { top: insets.top + 60 }]}>
            <Image source={{ uri: frontPhotoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <View style={s.bubbleIcon}>
              <Feather name="smile" size={10} color="#FFF" />
            </View>
          </View>
          {/* Memory imprint label */}
          <View style={s.imprintWrap}>
            <Text style={s.imprintTxt}>Memory captured</Text>
          </View>
        </Animated.View>
      )}

      {/* Rear photo bubble (visible during countdown and after) */}
      {rearPhotoUri && mediaMode === 'photo' && (phase === 'countdown' || phase === 'flipping' || phase === 'awaiting_front') && (
        <Animated.View style={[s.bubble, { top: insets.top + 60, opacity: bubbleOpacity, transform: [{ scale: bubbleScale }] }]}>
          <Image source={{ uri: rearPhotoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={s.bubbleIcon}>
            <Feather name="globe" size={10} color="#FFF" />
          </View>
        </Animated.View>
      )}

      {/* Countdown overlay */}
      {showCountdown && (
        <View style={s.countdownWrap} pointerEvents="none">
          <Text style={s.countdownPrompt}>Your reaction</Text>
          <Animated.Text style={[s.countdownNum, { opacity: countdownNumOpacity, transform: [{ scale: countdownNumScale }] }]}>
            {countdown}
          </Animated.Text>
        </View>
      )}

      {/* Processing overlay */}
      {phase === 'processing' && !frontPhotoUri && (
        <View style={s.processingWrap}>
          <ActivityIndicator color="#FFF" size="large" />
          <Text style={s.processingTxt}>Composing memory...</Text>
        </View>
      )}

      {recording && (
        <View style={[s.recPill, { top: insets.top + 64 }]} pointerEvents="none">
          <View style={s.recDot} />
          <Text style={s.recTxt}>{recSeconds}s / 15s</Text>
        </View>
      )}

      {/* ── TOP BAR (always visible, cancel always works) ──── */}
      <Animated.View style={[s.topBar, { opacity: uiOpacity, paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={s.cancelBtn} onPress={handleCancel} activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <View style={s.cancelBtnInner}>
            <Feather name="x" size={18} color="#FFF" />
          </View>
        </TouchableOpacity>

        <Text style={s.titleTxt}>
          {isIdle ? (mediaMode === 'video' ? (recording ? '' : 'Record the scene') : 'Capture the scene') : showCountdown ? '' : isBusy ? '' : ''}
        </Text>

        <View style={{ width: 44 }} />
      </Animated.View>

      {/* ── BOTTOM BAR ──────────────────────────────────────── */}
      {isIdle && (
        <Animated.View style={[s.bottomBar, { opacity: uiOpacity, paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
          <Text style={s.instructionTxt}>{mediaMode === 'video' ? (recording ? 'Tap to stop' : 'Tap to record the world (max 15s)') : 'Tap to capture the world around you'}</Text>

          {!recording && (
            <View style={s.modeRow}>
              <TouchableOpacity style={[s.modePill, mediaMode === 'photo' && s.modePillActive]} onPress={() => setMediaMode('photo')} activeOpacity={0.8}>
                <Text style={[s.modePillTxt, mediaMode === 'photo' && s.modePillTxtActive]}>Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modePill, mediaMode === 'video' && s.modePillActive]} onPress={() => setMediaMode('video')} activeOpacity={0.8}>
                <Text style={[s.modePillTxt, mediaMode === 'video' && s.modePillTxtActive]}>Video</Text>
              </TouchableOpacity>
            </View>
          )}

          <Animated.View style={{ transform: [{ scale: shutterScale }] }}>
            <TouchableOpacity style={s.shutter} onPress={captureRear} activeOpacity={0.9}>
              <View style={s.shutterRing}>
                <View style={[s.shutterInner, recording && s.shutterInnerRec]} />
              </View>
            </TouchableOpacity>
          </Animated.View>

          <Text style={s.labelTxt}>Dual Capture</Text>
        </Animated.View>
      )}
    </View>
  );
  } catch (err: any) {
    console.log('[DUALSCREEN] CRASH', err?.message, err?.stack);
    return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  loading: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 16 },
  permTxt: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },
  permBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)' },
  permBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '600' },

  // Atmospheric gradients
  topGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 140, zIndex: 5 },
  bottomGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 200, zIndex: 5 },

  // Flash + overlays
  flash: { ...StyleSheet.absoluteFillObject, backgroundColor: '#FFF', zIndex: 30 },
  flipOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 24 },

  // Rear photo bubble during countdown
  bubble: {
    position: 'absolute', left: 16, zIndex: 15,
    width: BUBBLE_W, height: BUBBLE_H, borderRadius: BUBBLE_RADIUS, overflow: 'hidden',
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 10,
  },
  bubbleIcon: {
    position: 'absolute', bottom: 8, right: 8,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },

  // Result preview bubble (front reaction on the reveal)
  resultBubble: {
    position: 'absolute', left: 16,
    width: BUBBLE_W, height: BUBBLE_H, borderRadius: BUBBLE_RADIUS, overflow: 'hidden',
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },

  // Memory imprint label
  imprintWrap: {
    position: 'absolute', bottom: 80, left: 0, right: 0, alignItems: 'center',
  },
  imprintTxt: {
    color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600',
    letterSpacing: 0.5, backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20,
    overflow: 'hidden',
  },

  // Countdown
  countdownWrap: {
    ...StyleSheet.absoluteFillObject, zIndex: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  countdownPrompt: {
    color: 'rgba(255,255,255,0.7)', fontSize: 16, fontWeight: '600',
    letterSpacing: 0.5, marginBottom: 4,
  },
  countdownNum: {
    color: '#FFF', fontSize: 88, fontWeight: '800',
    letterSpacing: -3, includeFontPadding: false,
  },

  // Processing
  processingWrap: {
    ...StyleSheet.absoluteFillObject, zIndex: 28,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  processingTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '500', marginTop: 12 },

  // Top bar
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  cancelBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelBtnInner: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  titleTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 40,
    alignItems: 'center', gap: 14,
  },
  instructionTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '500', letterSpacing: 0.1 },

  // Shutter button
  shutter: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  shutterRing: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFF' },
  shutterInnerRec: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#EF4444' },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 2 },
  modePill: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' },
  modePillActive: { backgroundColor: 'rgba(255,255,255,0.92)' },
  modePillTxt: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  modePillTxtActive: { color: '#0B0B0F' },
  recPill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, zIndex: 40 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  recTxt: { color: '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

  labelTxt: { color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: '500', letterSpacing: 0.3 },
});