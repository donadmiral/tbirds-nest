/**
 * EnhancerModal.tsx
 *
 * Pure presentation layer for cinematic memory enhancement.
 * Receives ALL state and callbacks from useEnhancementController.
 * Zero fetches. Zero polling. Zero provider logic.
 *
 * Design: PlatinumCircles base tokens + elevated cinematic layer.
 * The photo is the hero. UI disappears emotionally.
 *
 * Comparison: press-and-hold dissolve to original.
 * Loading: atmospheric pulse with emotional text progression.
 * Variations: horizontal picker, natural-first ranking.
 * Failure: calm, premium, trustworthy messaging.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
  Animated,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ReferenceFacePicker } from './ReferenceFacePicker';
import { CompareSlider } from './CompareSlider';

import {
  palette, surface, text as textColor, accent,
  space, typeSize, fontWeight,
} from '../../constants/tokens';
import {
  SPRING_ARRANGEMENT_ENTER,
  SPRING_BUBBLE_SETTLE,
  EASE_CINEMATIC,
  EASE_SOFT_EXIT,
  FADE_ARRANGEMENT_DIM,
  FADE_COMPOSER_ENTRY,
} from '../../constants/motionDualMemory';
import type { EnhancementState, CachedVariation } from '../../controllers/stories/useEnhancementController';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// â”€â”€ Cinematic layer tokens (elevated above base system) â”€â”€

const cinema = {
  bgDeep: 'rgb(4, 6, 12)',
  bgAtmospheric: 'rgba(8, 12, 22, 0.97)',
  glowPlatinum: 'rgba(196, 186, 168, 0.12)',
  glowPlatinumStrong: 'rgba(196, 186, 168, 0.25)',
  accentPlatinum: '#C4BAA8',
  accentPlatinumSoft: 'rgba(196, 186, 168, 0.6)',
  textHero: '#F5F0E8',
  textWhisper: 'rgba(245, 240, 232, 0.4)',
  textCalm: 'rgba(245, 240, 232, 0.65)',
  surfaceGlass: 'rgba(255, 255, 255, 0.06)',
  surfaceGlassActive: 'rgba(255, 255, 255, 0.12)',
  borderSubtle: 'rgba(196, 186, 168, 0.15)',
  borderActive: 'rgba(196, 186, 168, 0.5)',
  vignetteColors: ['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.6)'] as const,
};

// â”€â”€ Emotional loading messages (timed to generation phases) â”€â”€

const LOADING_MESSAGES = [
  'Reading your moment...',
  'Finding the best light...',
  'Perfecting the details...',
  'Almost there...',
];

// â”€â”€ Tone labels for variation picker â”€â”€

const TONE_LABELS: Record<string, string> = {
  natural: 'Natural',
  warm: 'Golden',
  platinum: 'Platinum',
  mood: 'Evening',
};

// â”€â”€ Props (pure presentation contract) â”€â”€

interface EnhancerModalProps {
  visible: boolean;
  state: EnhancementState;
  variations: CachedVariation[];
  selectedIndex: number;
  failureMessage: string | null;
  faceDetected: boolean;
  originalUri: string | null;
  localUri: string | null;
  isDual: boolean;
  enhancingFront: boolean;

  onGenerate: () => void;
  onCancel: () => void;
  onSelect: (index: number) => void;
  onApply: () => void;
  onDiscard: () => void;
  onRetry: () => void;
  onClose: () => void;
  userId?: string;
  selectedReferenceUrl?: string | null;
  onSelectReference?: (url: string) => void;
  stableOriginalUri?: string | null;
  intensity?: number;
  onIntensityChange?: (val: number) => void;
}


// ── Intensity Slider (own component to satisfy Rules of Hooks) ──
function IntensitySlider({ intensity, onIntensityChange }: { intensity: number; onIntensityChange: (val: number) => void }) {
  const trackRef = React.useRef<View>(null);
  const trackW = React.useRef(0);
  const update = React.useCallback((pageX: number) => {
    if (!trackRef.current) return;
    trackRef.current.measure((_x: number, _y: number, w: number, _h: number, px: number) => {
      if (w <= 0) return;
      const pct = Math.max(0, Math.min(1, (pageX - px) / w));
      onIntensityChange(+(0.2 + pct * 0.6).toFixed(2));
    });
  }, [onIntensityChange]);
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Enhanced</Text>
        <Text style={{ color: '#C4A96C', fontSize: 13, fontWeight: '600' }}>{Math.round((1 - intensity) * 100)}%</Text>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Subtle</Text>
      </View>
      <View
        ref={trackRef}
        style={{ height: 44, justifyContent: 'center' }}
        onLayout={(e: any) => { trackW.current = e.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e: any) => update(e.nativeEvent.pageX)}
        onResponderMove={(e: any) => update(e.nativeEvent.pageX)}
      >
        <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 2 }}>
          <View style={{ height: 4, backgroundColor: '#C4A96C', borderRadius: 2, width: ((intensity - 0.2) / 0.6 * 100) + '%' }} />
        </View>
        <View style={{
          position: 'absolute', left: ((intensity - 0.2) / 0.6 * 100) + '%',
          marginLeft: -12, width: 24, height: 24, borderRadius: 12,
          backgroundColor: '#C4A96C', top: 10,
          shadowColor: '#C4A96C', shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.5, shadowRadius: 6, elevation: 4,
        }} />
      </View>
    </View>
  );
}

export default function EnhancerModal({
  visible,
  state,
  variations,
  selectedIndex,
  failureMessage,
  faceDetected,
  originalUri,
  localUri,
  isDual,
  enhancingFront,
  onGenerate,
  onCancel,
  onSelect,
  onApply,
  onDiscard,
  onRetry,
  onClose,
  userId,
  selectedReferenceUrl,
  onSelectReference,
  stableOriginalUri,
  intensity = 0.5,
  onIntensityChange,
}: EnhancerModalProps) {
  const insets = useSafeAreaInsets();
  const [compareMode, setCompareMode] = useState(false);

  // â”€â”€ Animated values â”€â”€
  const entryOpacity = useRef(new Animated.Value(0)).current;
  const previewScale = useRef(new Animated.Value(0.97)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const compareOpacity = useRef(new Animated.Value(0)).current;
  const variationRevealAnim = useRef(new Animated.Value(0)).current;

  // â”€â”€ Loading message rotation â”€â”€
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const loadingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // â”€â”€ Entry animation â”€â”€
  useEffect(() => {
    if (visible) {
      entryOpacity.setValue(0);
      previewScale.setValue(0.97);
      variationRevealAnim.setValue(0);

      Animated.parallel([
        Animated.timing(entryOpacity, {
          toValue: 1,
          duration: FADE_COMPOSER_ENTRY,
          easing: EASE_CINEMATIC,
          useNativeDriver: true,
        }),
        Animated.spring(previewScale, {
          toValue: 1,
          ...SPRING_ARRANGEMENT_ENTER,
        }),
      ]).start();
    }
  }, [visible]);

  // â”€â”€ Pulse animation during generation â”€â”€
  useEffect(() => {
    if (state === 'generating' || state === 'downloading') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.015,
            duration: 1800,
            easing: EASE_SOFT_EXIT,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1800,
            easing: EASE_SOFT_EXIT,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state]);

  // â”€â”€ Loading message progression â”€â”€
  useEffect(() => {
    if (state === 'generating' || state === 'downloading' || state === 'analyzing') {
      setLoadingMsgIndex(0);
      loadingIntervalRef.current = setInterval(() => {
        setLoadingMsgIndex(prev =>
          prev < LOADING_MESSAGES.length - 1 ? prev + 1 : prev
        );
      }, 2200);
      return () => {
        if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
      };
    }
  }, [state]);

  // â”€â”€ Variation reveal animation â”€â”€
  useEffect(() => {
    if (state === 'ready' && variations.length > 0) {
      variationRevealAnim.setValue(0);
      Animated.spring(variationRevealAnim, {
        toValue: 1,
        ...SPRING_BUBBLE_SETTLE,
      }).start();
    }
  }, [state, variations.length]);

  // â”€â”€ Press-and-hold comparison â”€â”€
  const onCompareIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.timing(compareOpacity, {
      toValue: 1,
      duration: 280,
      easing: EASE_CINEMATIC,
      useNativeDriver: true,
    }).start();
  }, []);

  const onCompareOut = useCallback(() => {
    Animated.timing(compareOpacity, {
      toValue: 0,
      duration: 350,
      easing: EASE_SOFT_EXIT,
      useNativeDriver: true,
    }).start();
  }, []);

  // â”€â”€ Derive display URIs â”€â”€
  const sourceUri = originalUri || localUri;
  const selectedVariation = variations[selectedIndex] || null;
  const previewUri = state === 'ready' && selectedVariation
    ? selectedVariation.localUri
    : sourceUri;

  const isProcessing = state === 'analyzing' || state === 'generating' || state === 'downloading';
  const showVariationPicker = state === 'ready' && variations.length > 0;
  const showGenerateButton = state === 'idle' && faceDetected;
  const showFailure = state === 'failed';

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      <Animated.View style={[st.root, { opacity: entryOpacity }]}>
        {/* Deep cinematic background */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: cinema.bgDeep }]} />

        {/* Top safe area + header */}
        <View style={[st.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
          <TouchableOpacity
            style={st.headerBtn}
            onPress={isProcessing ? onCancel : onClose}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Feather
              name={isProcessing ? 'x' : 'arrow-left'}
              size={20}
              color={cinema.textCalm}
            />
          </TouchableOpacity>

          <View style={st.headerCenter}>
            <Text style={st.headerTitle}>Enhance</Text>
            {isDual && (
              <Text style={st.headerSubtitle}>
                {enhancingFront ? 'Front camera' : 'Rear camera'}
              </Text>
            )}
          </View>

          <View style={st.headerBtn} />
        </View>

        {/* â”€â”€ Main preview â”€â”€ */}
        <View style={st.previewContainer}>
          {/* Vignette overlay for depth */}
          <LinearGradient
            colors={['transparent', 'rgba(4,6,12,0.15)', 'rgba(4,6,12,0.5)']}
            style={st.vignette}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['rgba(4,6,12,0.4)', 'transparent', 'transparent']}
            style={st.vignetteTop}
            pointerEvents="none"
          />

          {/* Enhanced preview (or source during loading) */}
          {previewUri && compareMode && originalUri ? (
            <View style={{ flex: 1 }}>
              <CompareSlider
                originalUri={stableOriginalUri || originalUri || ""}
                enhancedUri={previewUri || ""}
                height={450}
              />
            </View>
          ) : previewUri ? (
            <TouchableWithoutFeedback
              onPressIn={state === 'ready' ? onCompareIn : undefined}
              onPressOut={state === 'ready' ? onCompareOut : undefined}
            >
              <Animated.View style={[st.previewFrame, { transform: [{ scale: isProcessing ? pulseAnim : previewScale }] }]}>
                <Image
                  source={{ uri: previewUri }}
                  style={st.previewImage}
                  resizeMode="cover"
                />

                {/* Original overlay for comparison (dissolves in on hold) */}
                {state === 'ready' && sourceUri && sourceUri !== previewUri && (
                  <Animated.View style={[st.compareOverlay, { opacity: compareOpacity }]}>
                    <Image
                      source={{ uri: sourceUri }}
                      style={st.previewImage}
                      resizeMode="cover"
                    />
                    <View style={st.compareBadge}>
                      <Text style={st.compareBadgeText}>Original</Text>
                    </View>
                  </Animated.View>
                )}
              </Animated.View>
            </TouchableWithoutFeedback>
          ) : null}

          {/* Processing overlay */}
          {isProcessing && (
            <View style={st.processingOverlay} pointerEvents="none">
              <View style={st.processingContent}>
                <View style={st.processingDot}>
                  <Animated.View style={[st.processingDotInner, {
                    transform: [{ scale: pulseAnim }],
                    opacity: pulseAnim.interpolate({
                      inputRange: [1, 1.015],
                      outputRange: [0.6, 1],
                    }),
                  }]} />
                </View>
                <Text style={st.processingText}>
                  {LOADING_MESSAGES[loadingMsgIndex]}
                </Text>
              </View>
            </View>
          )}

          {/* Compare hint + toggle */}
          {state === 'ready' && !compareMode && (
            <View style={st.compareHint} pointerEvents="none">
              <Text style={st.compareHintText}>Hold to see original</Text>
            </View>
          )}
          {state === 'ready' && originalUri && (
            <TouchableOpacity
              style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', marginVertical: 8, backgroundColor: compareMode ? '#C4A96C' : 'rgba(0,0,0,0.5)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, gap: 6 }}
              onPress={() => setCompareMode(!compareMode)}
              activeOpacity={0.7}
            >
              <Feather name="columns" size={14} color={compareMode ? '#000' : '#fff'} />
              <Text style={{ color: compareMode ? '#000' : '#fff', fontSize: 11, fontWeight: '600' }}>{compareMode ? 'Single View' : 'Before / After'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* â”€â”€ Bottom controls â”€â”€ */}
        <View style={[st.controls, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>

          {/* Intensity slider (visible in idle state before generating) */}
          {onIntensityChange && (state === 'idle') && (
            <IntensitySlider intensity={intensity} onIntensityChange={onIntensityChange} />
          )}

          {/* Reference face picker (visible in idle/ready state) */}
          {userId && onSelectReference && (state === 'idle' || state === 'ready') && (
            <ReferenceFacePicker
              userId={userId}
              onSelect={onSelectReference}
              selectedUrl={selectedReferenceUrl}
            />
          )}

          {/* Variation picker (visible in ready state) */}
          {showVariationPicker && (
            <Animated.View style={[st.variationRow, {
              opacity: variationRevealAnim,
              transform: [{
                translateY: variationRevealAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              }],
            }]}>
              {variations.map((v, i) => (
                <TouchableOpacity
                  key={i}
                  style={[
                    st.variationThumb,
                    selectedIndex === i && st.variationThumbActive,
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onSelect(i);
                  }}
                  activeOpacity={0.8}
                >
                  <Image
                    source={{ uri: v.localUri }}
                    style={st.variationImage}
                    resizeMode="cover"
                  />
                  <Text style={[
                    st.variationLabel,
                    selectedIndex === i && st.variationLabelActive,
                  ]}>
                    {TONE_LABELS[v.tone] || v.tone}
                  </Text>
                </TouchableOpacity>
              ))}
            </Animated.View>
          )}

          {/* Initial state: generate button */}
          {state === 'idle' && !faceDetected && (
            <View style={st.messageContainer}>
              <Feather name="eye-off" size={20} color={cinema.textWhisper} />
              <Text style={st.messageText}>
                Enhancement works best when a face is visible.
              </Text>
              <TouchableOpacity style={st.secondaryBtn} onPress={onClose} activeOpacity={0.7}>
                <Text style={st.secondaryBtnText}>Go back</Text>
              </TouchableOpacity>
            </View>
          )}

          {showGenerateButton && (
            <TouchableOpacity
              style={st.primaryBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onGenerate();
              }}
              activeOpacity={0.85}
            >
              <Feather name="sun" size={16} color={cinema.bgDeep} />
              <Text style={st.primaryBtnText}>Enhance this moment</Text>
            </TouchableOpacity>
          )}

          {/* Processing: cancel option */}
          {isProcessing && (
            <TouchableOpacity style={st.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={st.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          )}

          {/* Ready: apply and discard */}
          {state === 'ready' && variations.length > 0 && (
            <View style={st.actionRow}>
              <TouchableOpacity style={st.discardBtn} onPress={onDiscard} activeOpacity={0.7}>
                <Text style={st.discardBtnText}>Use original</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={st.applyBtn}
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  onApply();
                }}
                activeOpacity={0.85}
              >
                <Text style={st.applyBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Failure state */}
          {showFailure && (
            <View style={st.messageContainer}>
              <Text style={st.failureText}>
                {failureMessage || "Enhancement isn't available right now."}
              </Text>
              <Text style={st.failureSubtext}>Your original photo is ready to post.</Text>
              <View style={st.failureActions}>
                <TouchableOpacity style={st.secondaryBtn} onPress={() => { onRetry(); onGenerate(); }} activeOpacity={0.7}>
                  <Text style={st.secondaryBtnText}>Try again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.secondaryBtn} onPress={onClose} activeOpacity={0.7}>
                  <Text style={st.secondaryBtnText}>Use original</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

// â”€â”€ Styles â”€â”€

const PREVIEW_HORIZONTAL_INSET = 12;
const PREVIEW_WIDTH = SCREEN_W - PREVIEW_HORIZONTAL_INSET * 2;
const PREVIEW_HEIGHT = PREVIEW_WIDTH * 1.25; // 4:5 aspect
const THUMB_SIZE = Math.floor((SCREEN_W - 48 - 24) / 4); // 4 thumbs with gaps

const st = StyleSheet.create({
  root: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingBottom: 12,
    zIndex: 10,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: cinema.textHero,
    fontSize: typeSize.body,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
  },
  headerSubtitle: {
    color: cinema.textWhisper,
    fontSize: typeSize.micro,
    fontWeight: fontWeight.medium,
    marginTop: 2,
  },

  // Preview
  previewContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: PREVIEW_HORIZONTAL_INSET,
  },
  previewFrame: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(20,20,30,0.5)',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  vignette: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: PREVIEW_HEIGHT * 0.4,
    zIndex: 2,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  vignetteTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 80,
    zIndex: 2,
  },

  // Comparison overlay
  compareOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  compareBadge: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  compareBadgeText: {
    color: cinema.textCalm,
    fontSize: typeSize.micro,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.3,
  },

  // Compare hint
  compareHint: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    zIndex: 5,
  },
  compareHintText: {
    color: cinema.textWhisper,
    fontSize: 11,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.2,
  },

  // Processing overlay
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,6,12,0.35)',
    borderRadius: 20,
    zIndex: 4,
  },
  processingContent: {
    alignItems: 'center',
    gap: 16,
  },
  processingDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cinema.accentPlatinumSoft,
  },
  processingText: {
    color: cinema.textHero,
    fontSize: typeSize.caption,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.3,
  },

  // Controls area
  controls: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },

  // Variation picker
  variationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  variationThumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  variationThumbActive: {
    borderColor: cinema.borderActive,
  },
  variationImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  variationLabel: {
    position: 'absolute',
    bottom: 4,
    color: cinema.textWhisper,
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  variationLabelActive: {
    color: cinema.textHero,
  },

  // Primary button (generate)
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: cinema.accentPlatinumSoft,
  },
  primaryBtnText: {
    color: cinema.bgDeep,
    fontSize: typeSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.3,
  },

  // Apply button
  applyBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: accent.warm,
  },
  applyBtnText: {
    color: '#FFF',
    fontSize: typeSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.3,
  },

  // Discard button
  discardBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: cinema.surfaceGlass,
    borderWidth: 0.5,
    borderColor: cinema.borderSubtle,
  },
  discardBtnText: {
    color: cinema.textCalm,
    fontSize: typeSize.caption,
    fontWeight: fontWeight.medium,
  },

  // Action row (apply + discard side by side)
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },

  // Cancel button (during processing)
  cancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  cancelBtnText: {
    color: cinema.textWhisper,
    fontSize: typeSize.caption,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.2,
  },

  // Secondary button
  secondaryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: cinema.surfaceGlass,
    borderWidth: 0.5,
    borderColor: cinema.borderSubtle,
  },
  secondaryBtnText: {
    color: cinema.textCalm,
    fontSize: typeSize.caption,
    fontWeight: fontWeight.medium,
  },

  // Message container (no face, failure)
  messageContainer: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  messageText: {
    color: cinema.textCalm,
    fontSize: typeSize.caption,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Failure
  failureText: {
    color: cinema.textCalm,
    fontSize: typeSize.caption,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
    lineHeight: 20,
  },
  failureSubtext: {
    color: cinema.textWhisper,
    fontSize: typeSize.micro,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
  failureActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
});



