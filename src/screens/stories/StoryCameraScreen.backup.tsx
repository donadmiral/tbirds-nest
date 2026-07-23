import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
  Alert,
  Image,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const MAX_VIDEO_SEC = 30;

// Safe import: expo-camera may not be in the dev client binary
let CameraView: any = null;
let useCameraPermissions: any = null;
let cameraAvailable = false;

try {
  const mod = require('expo-camera');
  CameraView = mod.CameraView;
  useCameraPermissions = mod.useCameraPermissions;
  cameraAvailable = !!CameraView;
} catch {
  cameraAvailable = false;
}

// Safe import: expo-video for video preview
let VideoView: any = null;
let useVideoPlayerHook: any = null;
try {
  const videoMod = require('expo-video');
  VideoView = videoMod.VideoView;
  useVideoPlayerHook = videoMod.useVideoPlayer;
} catch {}

type CapturedMedia = {
  uri: string;
  type: 'image' | 'video';
  width?: number;
  height?: number;
};

export default function StoryCameraScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();

  // If camera module not available, show fallback
  if (!cameraAvailable) {
    return (
      <View style={s.fallback}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={s.fallbackInner} edges={['top', 'bottom']}>
          <Feather name="camera-off" size={48} color="rgba(255,255,255,0.4)" />
          <Text style={s.fallbackTitle}>Camera not available</Text>
          <Text style={s.fallbackSub}>
            This feature requires a new app build. Run:{'\n'}
            eas build --profile development --platform ios
          </Text>
          <TouchableOpacity
            style={s.fallbackBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Text style={s.fallbackBtnTxt}>Go back</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return <CameraScreenInner navigation={navigation} insets={insets} />;
}

function CameraScreenInner({ navigation, insets }: { navigation: any; insets: any }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [captured, setCaptured] = useState<CapturedMedia | null>(null);
  const [processing, setProcessing] = useState(false);

  const cameraRef = useRef<any>(null);
  const recordTimerRef = useRef<any>(null);
  const recordingRef = useRef(false);

  // Request permission on mount
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Clean up timer
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, []);

  // Permission not granted
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
          <Text style={s.fallbackSub}>
            Allow camera access in Settings to take photos and videos for your stories.
          </Text>
          <TouchableOpacity
            style={s.fallbackBtn}
            onPress={requestPermission}
            activeOpacity={0.8}
          >
            <Text style={s.fallbackBtnTxt}>Allow camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.fallbackBtn, { backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 10 }]}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Text style={[s.fallbackBtnTxt, { color: '#FFF' }]}>Go back</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  // ── Capture photo ──
  const takePhoto = async () => {
    if (!cameraRef.current || processing) return;
    setProcessing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: Platform.OS === 'android',
      });
      setCaptured({ uri: photo.uri, type: 'image', width: photo.width, height: photo.height });
    } catch (e) {
      console.error('[Camera] photo error:', e);
      Alert.alert('Error', 'Could not take photo.');
    } finally {
      setProcessing(false);
    }
  };

  // ── Record video ──
  const startRecording = async () => {
    if (!cameraRef.current || recordingRef.current || processing) return;
    setRecording(true);
    recordingRef.current = true;
    setRecordSeconds(0);

    recordTimerRef.current = setInterval(() => {
      setRecordSeconds(prev => {
        if (prev >= MAX_VIDEO_SEC - 1) {
          // Stop via ref to avoid stale closure
          if (recordTimerRef.current) {
            clearInterval(recordTimerRef.current);
            recordTimerRef.current = null;
          }
          recordingRef.current = false;
          setRecording(false);
          try { cameraRef.current?.stopRecording(); } catch {}
          return MAX_VIDEO_SEC;
        }
        return prev + 1;
      });
    }, 1000);

    try {
      const video = await cameraRef.current.recordAsync({
        maxDuration: MAX_VIDEO_SEC,
      });
      setCaptured({ uri: video.uri, type: 'video' });
    } catch (e) {
      console.error('[Camera] video error:', e);
    } finally {
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      recordingRef.current = false;
      setRecording(false);
      setRecordSeconds(0);
    }
  };

  const stopRecording = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    recordingRef.current = false;
    setRecording(false);
    setRecordSeconds(0);
    try {
      cameraRef.current?.stopRecording();
    } catch {}
  };

  // ── Use captured media ──
  const useMedia = () => {
    if (!captured) return;
    navigation.navigate('StoryComposer', {
      assets: [{
        uri: captured.uri,
        type: captured.type,
        width: captured.width,
        height: captured.height,
      }],
      mode: captured.type,
    });
  };

  const retake = () => {
    setCaptured(null);
  };

  const toggleFacing = () => {
    setFacing(f => f === 'back' ? 'front' : 'back');
  };

  const toggleFlash = () => {
    setFlash(f => f === 'off' ? 'on' : 'off');
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Preview captured media ──
  if (captured) {
    return (
      <View style={s.root}>
        <StatusBar hidden />
        {captured.type === 'video' && VideoView && useVideoPlayerHook ? (
          <VideoPreview uri={captured.uri} />
        ) : (
          <Image
            source={{ uri: captured.uri }}
            style={s.previewImage}
            resizeMode="contain"
          />
        )}
        <SafeAreaView style={s.previewControls} edges={['bottom']}>
          <TouchableOpacity
            style={s.previewBtn}
            onPress={retake}
            activeOpacity={0.8}
          >
            <Feather name="refresh-cw" size={18} color="#FFF" />
            <Text style={s.previewBtnTxt}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.previewBtn, s.previewUseBtn]}
            onPress={useMedia}
            activeOpacity={0.85}
          >
            <Text style={s.previewUseTxt}>Use {captured.type === 'video' ? 'video' : 'photo'}</Text>
            <Feather name="arrow-right" size={18} color="#000" />
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  // ── Camera view ──
  return (
    <View style={s.root}>
      <StatusBar hidden />

      <CameraView
        ref={cameraRef}
        style={s.camera}
        facing={facing}
        flash={flash}
        mode={mode}
      />

      {/* Top controls */}
      <SafeAreaView style={s.topControls} edges={['top']}>
        <TouchableOpacity
          style={s.topBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="x" size={24} color="#FFF" />
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        <TouchableOpacity
          style={s.topBtn}
          onPress={toggleFlash}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name={flash === 'on' ? 'zap' : 'zap-off'} size={20} color="#FFF" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* Recording timer */}
      {recording && (
        <View style={s.timerWrap}>
          <View style={s.timerDot} />
          <Text style={s.timerTxt}>{formatTime(recordSeconds)}</Text>
        </View>
      )}

      {/* Bottom controls */}
      <View style={[s.bottomControls, { paddingBottom: Math.max(insets.bottom + 16, 30) }]}>
        {/* Mode toggle */}
        <View style={s.modeRow}>
          <TouchableOpacity
            onPress={() => setMode('photo')}
            style={[s.modeBtn, mode === 'photo' && s.modeBtnActive]}
            activeOpacity={0.7}
          >
            <Text style={[s.modeTxt, mode === 'photo' && s.modeTxtActive]}>Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode('video')}
            style={[s.modeBtn, mode === 'video' && s.modeBtnActive]}
            activeOpacity={0.7}
          >
            <Text style={[s.modeTxt, mode === 'video' && s.modeTxtActive]}>Video</Text>
          </TouchableOpacity>
        </View>

        {/* Capture row */}
        <View style={s.captureRow}>
          {/* Gallery shortcut placeholder */}
          <View style={{ width: 44 }} />

          {/* Capture button */}
          {mode === 'photo' ? (
            <TouchableOpacity
              style={s.captureOuter}
              onPress={takePhoto}
              activeOpacity={0.85}
              disabled={processing}
            >
              <View style={s.captureInner}>
                {processing && <ActivityIndicator color="#000" size="small" />}
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.captureOuter, recording && s.captureOuterRecording]}
              onPress={recording ? stopRecording : startRecording}
              activeOpacity={0.85}
              disabled={processing}
            >
              <View style={[s.captureInner, recording && s.captureInnerRecording]} />
            </TouchableOpacity>
          )}

          {/* Flip camera */}
          <TouchableOpacity
            style={s.flipBtn}
            onPress={toggleFacing}
            activeOpacity={0.7}
            disabled={recording}
          >
            <Feather name="refresh-cw" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// Video preview: safe wrapper that avoids conditional hook calls
function VideoPreview({ uri }: { uri: string }) {
  if (!useVideoPlayerHook || !VideoView) {
    return <Image source={{ uri }} style={s.previewImage} resizeMode="contain" />;
  }
  return <ExpoVideoPreview uri={uri} />;
}

// Inner component: always calls useVideoPlayer unconditionally
function ExpoVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayerHook(uri, (p: any) => {
    p.loop = true;
    p.play();
  });
  return (
    <VideoView
      style={s.previewImage}
      player={player}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },

  // Fallback
  fallback: { flex: 1, backgroundColor: '#000' },
  fallbackInner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  fallbackTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', marginTop: 16 },
  fallbackSub: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  fallbackBtn: { marginTop: 20, backgroundColor: '#FFF', borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14, alignItems: 'center', width: '100%' },
  fallbackBtnTxt: { color: '#000', fontSize: 15, fontWeight: '700' },

  // Top controls
  topControls: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, zIndex: 10 },
  topBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },

  // Timer
  timerWrap: { position: 'absolute', top: 100, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, zIndex: 10 },
  timerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30' },
  timerTxt: { color: '#FFF', fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // Bottom controls
  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 16 },

  // Mode toggle
  modeRow: { flexDirection: 'row', gap: 4, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: 3, marginBottom: 24 },
  modeBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 18 },
  modeBtnActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  modeTxt: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '700' },
  modeTxtActive: { color: '#FFF' },

  // Capture button
  captureRow: { flexDirection: 'row', alignItems: 'center', gap: 30 },
  captureOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  captureOuterRecording: { borderColor: '#FF3B30' },
  captureInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  captureInnerRecording: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#FF3B30' },

  // Flip button
  flipBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

  // Preview
  previewImage: { flex: 1, backgroundColor: '#000' },
  previewControls: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 20 },
  previewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' },
  previewBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  previewUseBtn: { backgroundColor: '#FFF' },
  previewUseTxt: { color: '#000', fontSize: 15, fontWeight: '700' },
});