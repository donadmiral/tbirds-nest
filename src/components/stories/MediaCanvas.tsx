import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  LayoutChangeEvent,
} from 'react-native';
import {
  PinchGestureHandler,
  PanGestureHandler,
  TapGestureHandler,
  State as GHState,
} from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import type { MediaFit, MediaTransform } from '../../services/storiesService';

// ── Video layer: plays the recorded/selected clip (Instagram behaviour) ──
let ExpoVideoView: any = null;
let useExpoVideoPlayer: any = null;
try {
  const vm = require('expo-video');
  ExpoVideoView = vm.VideoView;
  useExpoVideoPlayer = vm.useVideoPlayer;
} catch {}

function StoryVideoLayer({ uri }: { uri: string }) {
  const player = useExpoVideoPlayer(uri, (p: any) => { p.loop = true; p.muted = false; p.play(); });
  return <ExpoVideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />;
}

// ── Constants ──
const MIN_SCALE = 1.0;
const MAX_SCALE = 5.0;
const DOUBLE_TAP_ZOOM = 2.5;

// ── Bounds math ──

function computeBaseSize(
  imageW: number,
  imageH: number,
  containerW: number,
  containerH: number,
  fit: MediaFit,
): { baseW: number; baseH: number } {
  const imageAspect = imageW / imageH;
  const containerAspect = containerW / containerH;

  if (fit === 'cover') {
    if (imageAspect > containerAspect) {
      const baseH = containerH;
      return { baseW: baseH * imageAspect, baseH };
    }
    const baseW = containerW;
    return { baseW, baseH: baseW / imageAspect };
  }
  // contain
  if (imageAspect > containerAspect) {
    const baseW = containerW;
    return { baseW, baseH: baseW / imageAspect };
  }
  const baseH = containerH;
  return { baseW: baseH * imageAspect, baseH };
}

function computeMaxTranslate(
  imageW: number,
  imageH: number,
  containerW: number,
  containerH: number,
  fit: MediaFit,
  scale: number,
): { maxTxPx: number; maxTyPx: number } {
  const { baseW, baseH } = computeBaseSize(imageW, imageH, containerW, containerH, fit);
  const scaledW = baseW * scale;
  const scaledH = baseH * scale;
  return {
    maxTxPx: Math.max(0, (scaledW - containerW) / 2),
    maxTyPx: Math.max(0, (scaledH - containerH) / 2),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ── Props ──

type MediaCanvasProps = {
  localUri: string | null;
  mediaType: 'image' | 'video';
  uploadState: 'idle' | 'uploading' | 'done' | 'error';
  errorMsg?: string | null;
  onRetry: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
  children?: React.ReactNode;
  scaleAnim: Animated.Value;
  opacityAnim: Animated.Value;
  // Phase 2 props
  imageW?: number;
  imageH?: number;
  mediaFit: MediaFit;
  mediaTransform: MediaTransform;
  onTransformChange: (transform: MediaTransform) => void;
  onFitToggle: () => void;
  interactive: boolean;
};

export default function MediaCanvas({
  localUri,
  mediaType,
  uploadState,
  errorMsg,
  onRetry,
  onLayout,
  children,
  scaleAnim,
  opacityAnim,
  imageW = 0,
  imageH = 0,
  mediaFit,
  mediaTransform,
  onTransformChange,
  onFitToggle,
  interactive,
}: MediaCanvasProps) {
  const gesturesEnabled = interactive && mediaType === 'image' && imageW > 0 && imageH > 0;

  // Container dimensions
  const containerW = useRef(0);
  const containerH = useRef(0);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    containerW.current = e.nativeEvent.layout.width;
    containerH.current = e.nativeEvent.layout.height;
    onLayout(e);
  }, [onLayout]);

  // ── Gesture animated values ──
  const imgScale = useRef(new Animated.Value(mediaTransform.scale)).current;
  const imgTx = useRef(new Animated.Value(0)).current;
  const imgTy = useRef(new Animated.Value(0)).current;

  // ── Gesture refs ──
  const pinchBaseScale = useRef(mediaTransform.scale);
  const panBaseTxPx = useRef(0);
  const panBaseTyPx = useRef(0);

  // Sync from props when transform changes externally (draft switch, fit toggle)
  const prevTransformRef = useRef(mediaTransform);
  useEffect(() => {
    const prev = prevTransformRef.current;
    if (
      prev.scale !== mediaTransform.scale ||
      prev.translateNX !== mediaTransform.translateNX ||
      prev.translateNY !== mediaTransform.translateNY ||
      prev.fit !== mediaTransform.fit
    ) {
      prevTransformRef.current = mediaTransform;
      const cw = containerW.current;
      const ch = containerH.current;
      const txPx = mediaTransform.translateNX * cw;
      const tyPx = mediaTransform.translateNY * ch;

      imgScale.setValue(mediaTransform.scale);
      imgTx.setValue(txPx);
      imgTy.setValue(tyPx);
      pinchBaseScale.current = mediaTransform.scale;
      panBaseTxPx.current = txPx;
      panBaseTyPx.current = tyPx;
    }
  }, [mediaTransform]);

  // ── Persist helper ──
  const persistTransform = useCallback((scale: number, txPx: number, tyPx: number) => {
    const cw = containerW.current;
    const ch = containerH.current;
    if (cw === 0 || ch === 0) return;
    const t: MediaTransform = {
      scale,
      translateNX: txPx / cw,
      translateNY: tyPx / ch,
      fit: mediaFit,
    };
    prevTransformRef.current = t;
    onTransformChange(t);
  }, [mediaFit, onTransformChange]);

  // ── Gesture handler refs for simultaneousHandlers ──
  const pinchRef = useRef<PinchGestureHandler>(null);
  const panRef = useRef<PanGestureHandler>(null);
  const doubleTapRef = useRef<TapGestureHandler>(null);

  // ── Pinch ──
  const onPinchEvent = useCallback((e: any) => {
    if (!gesturesEnabled) return;
    const { scale } = e.nativeEvent;
    const newScale = clamp(pinchBaseScale.current * scale, MIN_SCALE, MAX_SCALE);
    imgScale.setValue(newScale);

    // Re-clamp translation at new scale
    const cw = containerW.current;
    const ch = containerH.current;
    if (cw > 0 && ch > 0) {
      const { maxTxPx, maxTyPx } = computeMaxTranslate(imageW, imageH, cw, ch, mediaFit, newScale);
      const clampedTx = clamp(panBaseTxPx.current, -maxTxPx, maxTxPx);
      const clampedTy = clamp(panBaseTyPx.current, -maxTyPx, maxTyPx);
      imgTx.setValue(clampedTx);
      imgTy.setValue(clampedTy);
    }
  }, [gesturesEnabled, imageW, imageH, mediaFit, imgScale, imgTx, imgTy]);

  const onPinchStateChange = useCallback((e: any) => {
    if (!gesturesEnabled) return;
    const { state, scale } = e.nativeEvent;
    if (state === GHState.END || state === GHState.CANCELLED) {
      const finalScale = clamp(pinchBaseScale.current * scale, MIN_SCALE, MAX_SCALE);
      pinchBaseScale.current = finalScale;
      imgScale.setValue(finalScale);

      const cw = containerW.current;
      const ch = containerH.current;
      if (cw > 0 && ch > 0) {
        const { maxTxPx, maxTyPx } = computeMaxTranslate(imageW, imageH, cw, ch, mediaFit, finalScale);
        const clampedTx = clamp(panBaseTxPx.current, -maxTxPx, maxTxPx);
        const clampedTy = clamp(panBaseTyPx.current, -maxTyPx, maxTyPx);
        panBaseTxPx.current = clampedTx;
        panBaseTyPx.current = clampedTy;
        imgTx.setValue(clampedTx);
        imgTy.setValue(clampedTy);
        persistTransform(finalScale, clampedTx, clampedTy);
      }
    }
  }, [gesturesEnabled, imageW, imageH, mediaFit, imgScale, imgTx, imgTy, persistTransform]);

  // ── Pan ──
  const onPanEvent = useCallback((e: any) => {
    if (!gesturesEnabled) return;
    const { translationX, translationY } = e.nativeEvent;
    const cw = containerW.current;
    const ch = containerH.current;
    if (cw === 0 || ch === 0) return;

    const currentScale = pinchBaseScale.current;
    const { maxTxPx, maxTyPx } = computeMaxTranslate(imageW, imageH, cw, ch, mediaFit, currentScale);
    const rawTx = panBaseTxPx.current + translationX;
    const rawTy = panBaseTyPx.current + translationY;
    imgTx.setValue(clamp(rawTx, -maxTxPx, maxTxPx));
    imgTy.setValue(clamp(rawTy, -maxTyPx, maxTyPx));
  }, [gesturesEnabled, imageW, imageH, mediaFit, imgTx, imgTy]);

  const onPanStateChange = useCallback((e: any) => {
    if (!gesturesEnabled) return;
    const { state, translationX, translationY } = e.nativeEvent;
    if (state === GHState.END || state === GHState.CANCELLED) {
      const cw = containerW.current;
      const ch = containerH.current;
      if (cw === 0 || ch === 0) return;

      const currentScale = pinchBaseScale.current;
      const { maxTxPx, maxTyPx } = computeMaxTranslate(imageW, imageH, cw, ch, mediaFit, currentScale);
      const finalTx = clamp(panBaseTxPx.current + translationX, -maxTxPx, maxTxPx);
      const finalTy = clamp(panBaseTyPx.current + translationY, -maxTyPx, maxTyPx);
      panBaseTxPx.current = finalTx;
      panBaseTyPx.current = finalTy;
      imgTx.setValue(finalTx);
      imgTy.setValue(finalTy);
      persistTransform(currentScale, finalTx, finalTy);
    }
  }, [gesturesEnabled, imageW, imageH, mediaFit, imgTx, imgTy, persistTransform]);

  // ── Double tap ──
  const onDoubleTapStateChange = useCallback((e: any) => {
    if (!gesturesEnabled) return;
    if (e.nativeEvent.state !== GHState.ACTIVE) return;

    const cw = containerW.current;
    const ch = containerH.current;
    if (cw === 0 || ch === 0) return;

    const currentScale = pinchBaseScale.current;

    if (currentScale > 1.05) {
      // Reset to 1.0
      pinchBaseScale.current = 1;
      panBaseTxPx.current = 0;
      panBaseTyPx.current = 0;
      Animated.parallel([
        Animated.spring(imgScale, { toValue: 1, useNativeDriver: true, friction: 6 }),
        Animated.spring(imgTx, { toValue: 0, useNativeDriver: true, friction: 6 }),
        Animated.spring(imgTy, { toValue: 0, useNativeDriver: true, friction: 6 }),
      ]).start(() => persistTransform(1, 0, 0));
    } else {
      // Zoom to tapped point
      const tapX = e.nativeEvent.x;
      const tapY = e.nativeEvent.y;
      const offsetX = tapX - cw / 2;
      const offsetY = tapY - ch / 2;

      const { maxTxPx, maxTyPx } = computeMaxTranslate(imageW, imageH, cw, ch, mediaFit, DOUBLE_TAP_ZOOM);
      const targetTx = clamp(-offsetX, -maxTxPx, maxTxPx);
      const targetTy = clamp(-offsetY, -maxTyPx, maxTyPx);

      pinchBaseScale.current = DOUBLE_TAP_ZOOM;
      panBaseTxPx.current = targetTx;
      panBaseTyPx.current = targetTy;

      Animated.parallel([
        Animated.spring(imgScale, { toValue: DOUBLE_TAP_ZOOM, useNativeDriver: true, friction: 6 }),
        Animated.spring(imgTx, { toValue: targetTx, useNativeDriver: true, friction: 6 }),
        Animated.spring(imgTy, { toValue: targetTy, useNativeDriver: true, friction: 6 }),
      ]).start(() => persistTransform(DOUBLE_TAP_ZOOM, targetTx, targetTy));
    }
  }, [gesturesEnabled, imageW, imageH, mediaFit, imgScale, imgTx, imgTy, persistTransform]);

  // ── Fit/fill toggle button visibility ──
  const showFitToggle = interactive && mediaType === 'image' && imageW > 0 && imageH > 0;

  // ── Image resizeMode ──
  const resizeMode = mediaFit === 'contain' ? 'contain' : 'cover';

  // ── Blur background (only in contain mode when image doesn't fill) ──
  const showBlurBg = mediaFit === 'contain' && mediaType === 'image' && localUri;

  // ── Render ──

  const imageContent = localUri ? (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          transform: [
            { translateX: imgTx },
            { translateY: imgTy },
            { scale: imgScale },
          ],
        },
      ]}
    >
      <Image
        source={{ uri: localUri }}
        style={styles.media}
        resizeMode={resizeMode}
      />
    </Animated.View>
  ) : null;

  const gestureWrappedContent = gesturesEnabled ? (
    <TapGestureHandler
      ref={doubleTapRef}
      numberOfTaps={2}
      maxDelayMs={250}
      simultaneousHandlers={[pinchRef, panRef]}
      onHandlerStateChange={onDoubleTapStateChange}
    >
      <Animated.View style={StyleSheet.absoluteFill}>
        <PanGestureHandler
          ref={panRef}
          simultaneousHandlers={[pinchRef, doubleTapRef]}
          minDist={5}
          onGestureEvent={onPanEvent}
          onHandlerStateChange={onPanStateChange}
        >
          <Animated.View style={StyleSheet.absoluteFill}>
            <PinchGestureHandler
              ref={pinchRef}
              simultaneousHandlers={[panRef, doubleTapRef]}
              onGestureEvent={onPinchEvent}
              onHandlerStateChange={onPinchStateChange}
            >
              <Animated.View style={StyleSheet.absoluteFill}>
                {showBlurBg && (
                  <Image
                    source={{ uri: localUri! }}
                    style={styles.blurBg}
                    resizeMode="cover"
                    blurRadius={25}
                  />
                )}
                {showBlurBg && <View style={styles.blurOverlay} />}
                {imageContent}
              </Animated.View>
            </PinchGestureHandler>
          </Animated.View>
        </PanGestureHandler>
      </Animated.View>
    </TapGestureHandler>
  ) : (
    <>
      {showBlurBg && (
        <Image
          source={{ uri: localUri! }}
          style={styles.blurBg}
          resizeMode="cover"
          blurRadius={25}
        />
      )}
      {showBlurBg && <View style={styles.blurOverlay} />}
      {imageContent}
    </>
  );

  return (
    <Animated.View
      style={[styles.wrap, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}
      onLayout={handleLayout}
    >
      {/* Base media layer */}
      {mediaType === 'image' && localUri ? gestureWrappedContent : null}

      {/* Video layer */}
      {mediaType === 'video' && localUri && ExpoVideoView && useExpoVideoPlayer ? (
        <StoryVideoLayer key={localUri} uri={localUri} />
      ) : mediaType === 'video' && uploadState === 'idle' ? (
        <View style={styles.videoOverlay}>
          <View style={styles.playCircle}>
            <Feather name="play" size={32} color="#FFF" />
          </View>
          <Text style={styles.videoLabel}>Video story</Text>
        </View>
      ) : null}

      {/* Upload states */}
      {uploadState === 'uploading' && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#FFF" />
          <Text style={styles.overlayTxt}>Uploading...</Text>
        </View>
      )}
      {uploadState === 'done' && (
        <View style={styles.overlay}>
          <Feather name="check-circle" size={40} color="#34C759" />
          <Text style={styles.overlayTxt}>Posted</Text>
        </View>
      )}
      {uploadState === 'error' && (
        <View style={styles.overlay}>
          <Feather name="alert-circle" size={40} color="#FF3B30" />
          <Text style={styles.overlayTxt}>{errorMsg || 'Upload failed'}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.7}>
            <Text style={styles.retryTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Fit/fill toggle */}
      {showFitToggle && uploadState === 'idle' && (
        <TouchableOpacity style={styles.fitToggle} onPress={onFitToggle} activeOpacity={0.75}>
          <Feather name={mediaFit === 'cover' ? 'minimize-2' : 'maximize-2'} size={16} color="#FFF" />
        </TouchableOpacity>
      )}

      {/* Children: stickers, poll badge */}
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  media: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  blurBg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  videoLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  overlayTxt: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryTxt: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  fitToggle: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
});