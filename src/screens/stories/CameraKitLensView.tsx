// src/screens/stories/CameraKitLensView.tsx
// Wraps the Camera Kit web engine (cameraKitEngine.ts) inside a WebView and
// exposes it as a normal RN camera-like ref: applyLens, flip, capturePhoto,
// startVideo, stopVideo. Talks to the engine entirely over postMessage.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import type { WebView as WebViewType } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';

// Safe import: react-native-webview needs a native module that only exists
// after a real build. A static import crashes the whole app on startup on
// any client built before this dependency existed.
let WebViewComp: any = null;
export let webViewAvailable = false;
try {
  WebViewComp = require('react-native-webview').WebView;
  webViewAvailable = !!WebViewComp;
} catch {
  webViewAvailable = false;
}
import { CAMERA_KIT_ENGINE_HTML } from './cameraKitEngine';
import { cameraKitCaptureData, createCameraKitCaptureBridge } from './cameraKitBridge';

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

async function dataUrlToFile(dataUrl: unknown, kind: 'photo' | 'video', requestId: string): Promise<string> {
  const { base64, extension } = cameraKitCaptureData(dataUrl, kind);
  if (!FileSystem.cacheDirectory) throw new Error('The device cannot save this capture.');
  const path = FileSystem.cacheDirectory + 'ck_' + requestId.replace(/[^a-z0-9-]/gi, '') + '.' + extension;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  return path;
}

export const CameraKitLensView = forwardRef<CameraKitLensViewHandle, Props>(function CameraKitLensView(
  { apiToken, lensGroupId, onReady, onLenses, onError },
  ref
) {
  const webRef = useRef<WebViewType>(null);
  const bridge = useRef(createCameraKitCaptureBridge());
  const ready = useRef(false);
  const alive = useRef(true);
  const initTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onReady, onLenses, onError }); callbacks.current = { onReady, onLenses, onError };
  const clearInit = useCallback(() => { if (initTimer.current) clearTimeout(initTimer.current); initTimer.current = null; }, []);

  const send = useCallback((msg: any) => {
    if (!webRef.current || !alive.current) throw new Error('The Lens camera is closed. Reopen it to capture.');
    webRef.current.postMessage(JSON.stringify(msg));
  }, []);
  const fail = useCallback((message: string) => { ready.current = false; clearInit(); bridge.current.fail(message); if (alive.current) callbacks.current.onError?.(message); }, [clearInit]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; ready.current = false; clearInit(); bridge.current.fail('The Lens camera was closed.'); try { webRef.current?.postMessage(JSON.stringify({ type: 'dispose' })); } catch {} }; }, [clearInit]);

  useImperativeHandle(ref, () => ({
    applyLens: (lensId, groupId) => send({ type: 'applyLens', lensId, groupId }),
    flip: () => send({ type: 'flip' }),
    capturePhoto: () => !ready.current ? Promise.reject(new Error('The Lens camera is still loading.')) : bridge.current.request('photo', requestId => send({ type: 'capturePhoto', requestId })),
    startVideo: () => { if (!ready.current) throw new Error('The Lens camera is still loading.'); send({ type: 'startVideo' }); },
    stopVideo: () => !ready.current ? Promise.reject(new Error('The Lens camera is unavailable.')) : bridge.current.request('video', requestId => send({ type: 'stopVideo', requestId })),
  }), [send]);

  const onMessage = useCallback(async (event: any) => {
    let msg: any;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (!alive.current || !msg || !msg.type) return;
    if (msg.type === 'ready') { clearInit(); ready.current = true; callbacks.current.onReady?.(); }
    else if (msg.type === 'lenses') { callbacks.current.onLenses?.(Array.isArray(msg.lenses) ? msg.lenses.filter((lens: any) => typeof lens?.id === 'string' && typeof lens?.name === 'string') : []); }
    else if (msg.type === 'error') {
      const message = typeof msg.message === 'string' ? msg.message : 'The Lens camera could not finish. Please try again.';
      bridge.current.fail(message, msg.requestId);
      if (msg.operation === 'init' || msg.operation === 'dispose') { ready.current = false; clearInit(); }
      callbacks.current.onError?.(message);
    } else if ((msg.type === 'photo' || msg.type === 'video') && typeof msg.requestId === 'string') {
      await bridge.current.complete(msg.requestId, msg.type, () => dataUrlToFile(msg.dataUrl, msg.type, msg.requestId), uri => { void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}); });
    }
  }, [clearInit]);

  const onLoadEnd = useCallback(() => {
    clearInit(); ready.current = false;
    initTimer.current = setTimeout(() => fail('The Lens camera took too long to load. Retry or choose a color style.'), 25000);
    try { send({ type: 'init', apiToken, lensGroupId, facing: 'user' }); } catch (error) { fail(error instanceof Error ? error.message : 'The Lens camera could not start.'); }
  }, [send, apiToken, lensGroupId, clearInit, fail]);

  if (!webViewAvailable || !WebViewComp) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebViewComp
        ref={webRef}
        source={{ html: CAMERA_KIT_ENGINE_HTML, baseUrl: 'https://platinumcircles.app/' }}
        style={StyleSheet.absoluteFill}
        onLoadEnd={onLoadEnd}
        onLoadStart={() => { ready.current = false; bridge.current.fail('The Lens camera restarted. Please capture again.'); }}
        onMessage={onMessage}
        onError={() => fail('The Lens camera could not load. Retry or choose a color style.')}
        onContentProcessDidTerminate={() => fail('The Lens camera was interrupted. Reopen it to continue.')}
        onRenderProcessGone={() => { fail('The Lens camera was interrupted. Reopen it to continue.'); return true; }}
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
