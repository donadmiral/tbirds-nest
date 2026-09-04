// src/screens/stories/CameraKitLensView.tsx
// Wraps the Camera Kit web engine (cameraKitEngine.ts) inside a WebView and
// exposes it as a normal RN camera-like ref: applyLens, flip, capturePhoto,
// startVideo, stopVideo. Talks to the engine entirely over postMessage.
import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import { CAMERA_KIT_ENGINE_HTML } from './cameraKitEngine';

export type CKLens = { id: string; groupId: string; name: string; iconUrl: string | null };

export type CameraKitLensViewHandle = {
  applyLens: (lensId: string | null, groupId: string) => void;
  flip: () => void;
  capturePhoto: () => Promise<string>;
  startVideo: () => void;
  stopVideo: () => Promise<string>;
};

type Props = {
  apiToken: string;
  lensGroupId: string;
  onReady?: () => void;
  onLenses?: (lenses: CKLens[]) => void;
  onError?: (message: string) => void;
};

async function dataUrlToFile(dataUrl: string, ext: string): Promise<string> {
  const comma = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(comma + 1);
  const path = FileSystem.cacheDirectory + 'ck_' + Date.now() + '.' + ext;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  return path;
}

export const CameraKitLensView = forwardRef<CameraKitLensViewHandle, Props>(function CameraKitLensView(
  { apiToken, lensGroupId, onReady, onLenses, onError },
  ref
) {
  const webRef = useRef<WebView>(null);
  const photoResolveRef = useRef<((uri: string) => void) | null>(null);
  const videoResolveRef = useRef<((uri: string) => void) | null>(null);

  const send = useCallback((msg: any) => {
    webRef.current?.postMessage(JSON.stringify(msg));
  }, []);

  useImperativeHandle(ref, () => ({
    applyLens: (lensId, groupId) => send({ type: 'applyLens', lensId, groupId }),
    flip: () => send({ type: 'flip' }),
    capturePhoto: () => new Promise<string>((resolve) => { photoResolveRef.current = resolve; send({ type: 'capturePhoto' }); }),
    startVideo: () => send({ type: 'startVideo' }),
    stopVideo: () => new Promise<string>((resolve) => { videoResolveRef.current = resolve; send({ type: 'stopVideo' }); }),
  }), [send]);

  const onMessage = useCallback(async (event: any) => {
    let msg: any;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (!msg || !msg.type) return;
    if (msg.type === 'ready') { onReady?.(); }
    else if (msg.type === 'lenses') { onLenses?.(msg.lenses || []); }
    else if (msg.type === 'error') { console.log('[CameraKit]', msg.message); onError?.(msg.message); }
    else if (msg.type === 'photo') {
      const uri = await dataUrlToFile(msg.dataUrl, 'jpg');
      photoResolveRef.current?.(uri);
      photoResolveRef.current = null;
    } else if (msg.type === 'video') {
      const ext = msg.mime === 'video/mp4' ? 'mp4' : 'webm';
      const uri = await dataUrlToFile(msg.dataUrl, ext);
      videoResolveRef.current?.(uri);
      videoResolveRef.current = null;
    }
  }, [onReady, onLenses, onError]);

  const onLoadEnd = useCallback(() => {
    send({ type: 'init', apiToken, lensGroupId, facing: 'user' });
  }, [send, apiToken, lensGroupId]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={webRef}
        source={{ html: CAMERA_KIT_ENGINE_HTML }}
        style={StyleSheet.absoluteFill}
        onLoadEnd={onLoadEnd}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
      />
    </View>
  );
});
