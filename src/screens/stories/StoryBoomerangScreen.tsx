// src/screens/stories/StoryBoomerangScreen.tsx
// BOOM capture. Records a short forward clip and hands it to StoryComposer
// exactly like a normal video capture. The bounce playback (forward-back-forward)
// and the boomerang marker on the published story are a later slice, the same
// staged order StoryDualCaptureScreen went through.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const MAX_BOOM_SEC = 4;
const CAPTURE_SIZE = 78;

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
  React.useEffect(() => {
    if (micPerm && !micPerm.granted && micPerm.canAskAgain && requestMicPerm) requestMicPerm();
  }, [micPerm, requestMicPerm]);

  const cameraRef = useRef<any>(null);
  const recordingRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [cameraReady, setCameraReady] = useState(false);

  const startRecord = useCallback(async () => {
    if (!cameraRef.current || recordingRef.current || !cameraReady) return;
    recordingRef.current = true;
    setRecording(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const recordWithRetry = async (attempt: number): Promise<any> => {
        try {
          return await cameraRef.current.recordAsync({ maxDuration: MAX_BOOM_SEC, codec: 'avc1' });
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
      recordingRef.current = false;
      setRecording(false);
      resetAudioMode();
      if (!video?.uri) return;
      setProcessing(true);
      navigation.navigate('StoryComposer', {
        assets: [{ uri: video.uri, localUri: video.uri, type: 'video', mediaType: 'video' }],
        mode: 'video',
      });
      setProcessing(false);
    } catch (e: any) {
      recordingRef.current = false;
      setRecording(false);
      resetAudioMode();
      Alert.alert('Could not record', e?.message || 'Please try again.');
    }
  }, [navigation]);

  const stopRecord = useCallback(() => {
    if (!recordingRef.current) return;
    try { cameraRef.current?.stopRecording(); } catch {}
  }, []);

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

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode="video" videoQuality="720p" onCameraReady={() => setCameraReady(true)} />
      <SafeAreaView style={s.topBar} edges={['top']}>
        <TouchableOpacity style={s.topBtn} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={s.title}>BOOM</Text>
        <TouchableOpacity style={s.topBtn} onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="repeat" size={22} color="#FFF" />
        </TouchableOpacity>
      </SafeAreaView>
      <View style={[s.bottomControls, { paddingBottom: Math.max(insets.bottom + 18, 32) }]}>
        <Text style={s.hintTxt}>{recording ? 'Recording, release to finish' : 'Hold to capture a Boomerang'}</Text>
        <TouchableOpacity
          activeOpacity={1}
          onPressIn={startRecord}
          onPressOut={stopRecord}
          style={[s.captureWrap, { transform: [{ scale: recording ? 1.08 : 1 }] }]}
        >
          <View style={[s.captureInner, recording && s.captureInnerRecording]}>
            {processing && <ActivityIndicator color="#000" size="small" />}
          </View>
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
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  topBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  title: { color: '#FFF', fontSize: 14, fontWeight: '800', letterSpacing: 1.5 },
  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: 14 },
  hintTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '600' },
  captureWrap: { width: CAPTURE_SIZE, height: CAPTURE_SIZE, borderRadius: CAPTURE_SIZE / 2, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  captureInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFF' },
  captureInnerRecording: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#FF3B30' },
});