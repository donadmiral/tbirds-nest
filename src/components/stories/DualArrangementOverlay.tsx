/**
 * DualArrangementOverlay.tsx
 *
 * "Shape the memory before you decorate it."
 *
 * Cinematic arrangement UI overlay rendered INSIDE StoryComposerScreen.
 * This is NOT a screen. It is an animated layer that appears above the media
 * canvas and below the composer chrome when arrangement mode is active.
 *
 * Contains: atmospheric dim, preset strip, swap button, Done button, snap guides.
 * Does NOT contain: the bubble itself or its gesture handlers.
 * The bubble lives in the composer's DualBubbleLayer and is controlled
 * by the arrangementOpen flag.
 *
 * Layer position: zIndex Z_ARRANGEMENT (30), above stickers, below chrome.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  Z_ARRANGEMENT,
  FADE_ARRANGEMENT_DIM,
  FADE_ARRANGEMENT_GUIDES,
  SPRING_ARRANGEMENT_ENTER,
  OPACITY_ARRANGEMENT_DIM,
  OPACITY_GUIDES,
  HAPTIC_PRESET,
  HAPTIC_DONE,
  HAPTIC_SWAP,
  SHADOW_POST,
} from '../../constants/motionDualMemory';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

// ── PRESET DEFINITIONS ────────────────────────────────────

export interface CompositionPreset {
  id: string;
  label: string;
  nx: number;
  ny: number;
  scale: number;
  icon: string;
}

export const PRESETS: CompositionPreset[] = [
  { id: 'corner', label: 'Corner', nx: 0.85, ny: 0.72, scale: 0.8, icon: 'corner-down-right' },
  { id: 'centered', label: 'Center', nx: 0.5, ny: 0.5, scale: 1.0, icon: 'crosshair' },
  { id: 'dramatic', label: 'Bold', nx: 0.15, ny: 0.18, scale: 1.5, icon: 'maximize' },
  { id: 'cinematic', label: 'Cinema', nx: 0.5, ny: 0.78, scale: 1.0, icon: 'film' },
  { id: 'minimal', label: 'Minimal', nx: 0.88, ny: 0.12, scale: 0.7, icon: 'minimize-2' },
];

// ── PROPS ─────────────────────────────────────────────────

export interface DualArrangementOverlayProps {
  visible: boolean;
  selectedPreset: string | null;
  primaryCamera: 'front' | 'rear';
  onPresetSelect: (preset: CompositionPreset) => void;
  onSwap: () => void;
  onDone: () => void;
  safeTop: number;
  safeBottom: number;
  reduceMotion: boolean;
}

// ── COMPONENT ─────────────────────────────────────────────

export default function DualArrangementOverlay({
  visible,
  selectedPreset,
  primaryCamera,
  onPresetSelect,
  onSwap,
  onDone,
  safeTop,
  safeBottom,
  reduceMotion,
}: DualArrangementOverlayProps) {

  // ── Animation values ──
  const dimOpacity = useRef(new Animated.Value(0)).current;
  const controlsOpacity = useRef(new Animated.Value(0)).current;
  const controlsTransY = useRef(new Animated.Value(30)).current;
  const guidesOpacity = useRef(new Animated.Value(0)).current;
  const doneOpacity = useRef(new Animated.Value(0)).current;

  // ── Entry / Exit choreography ──
  useEffect(() => {
    if (visible) {
      if (reduceMotion) {
        dimOpacity.setValue(1);
        controlsOpacity.setValue(1);
        controlsTransY.setValue(0);
        guidesOpacity.setValue(1);
        doneOpacity.setValue(1);
        return;
      }
      Animated.parallel([
        Animated.timing(dimOpacity, {
          toValue: 1,
          duration: FADE_ARRANGEMENT_DIM,
          useNativeDriver: true,
        }),
        Animated.spring(controlsTransY, {
          toValue: 0,
          ...SPRING_ARRANGEMENT_ENTER,
        }),
        Animated.timing(controlsOpacity, {
          toValue: 1,
          duration: FADE_ARRANGEMENT_DIM,
          useNativeDriver: true,
        }),
        Animated.timing(guidesOpacity, {
          toValue: 1,
          duration: FADE_ARRANGEMENT_GUIDES,
          delay: 100,
          useNativeDriver: true,
        }),
        Animated.timing(doneOpacity, {
          toValue: 1,
          duration: 220,
          delay: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      if (reduceMotion) {
        dimOpacity.setValue(0);
        controlsOpacity.setValue(0);
        controlsTransY.setValue(30);
        guidesOpacity.setValue(0);
        doneOpacity.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.timing(dimOpacity, {
          toValue: 0,
          duration: FADE_ARRANGEMENT_DIM,
          useNativeDriver: true,
        }),
        Animated.timing(controlsOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(controlsTransY, {
          toValue: 30,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(guidesOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(doneOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, reduceMotion]);

  // ── Handlers ──
  const handlePresetTap = useCallback((preset: CompositionPreset) => {
    
    onPresetSelect(preset);
  }, [onPresetSelect]);

  const handleSwap = useCallback(() => {
    
    onSwap();
  }, [onSwap]);

  const handleDone = useCallback(() => {
    
    onDone();
  }, [onDone]);

  if (!visible) return null;

  // ── Snap guide positions ──
  const centerX = SCREEN_W / 2;
  const centerY = SCREEN_H / 2;
  const thirdX1 = SCREEN_W / 3;
  const thirdX2 = (SCREEN_W * 2) / 3;
  const thirdY1 = SCREEN_H / 3;
  const thirdY2 = (SCREEN_H * 2) / 3;

  return (
    <View style={s.root} pointerEvents="box-none">
      {/* ── Atmospheric dim ── */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${OPACITY_ARRANGEMENT_DIM})`, opacity: dimOpacity }]}
        pointerEvents="none"
      />

      {/* ── Top gradient for depth ── */}
      <LinearGradient
        colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']}
        style={s.topGradient}
        pointerEvents="none"
      />

      {/* ── Bottom gradient for depth ── */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']}
        style={s.bottomGradient}
        pointerEvents="none"
      />

      {/* ── Snap guides (rule of thirds + center) ── */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: guidesOpacity }]} pointerEvents="none">
        <View style={[s.guideVertical, { left: centerX }]} />
        <View style={[s.guideHorizontal, { top: centerY }]} />
        <View style={[s.guideVerticalWeak, { left: thirdX1 }]} />
        <View style={[s.guideVerticalWeak, { left: thirdX2 }]} />
        <View style={[s.guideHorizontalWeak, { top: thirdY1 }]} />
        <View style={[s.guideHorizontalWeak, { top: thirdY2 }]} />
      </Animated.View>

      {/* ── Title hint ── */}
      <Animated.View style={[s.titleWrap, { top: safeTop + 4, opacity: controlsOpacity }]}>
        <Text style={s.titleTxt}>Compose your memory</Text>
      </Animated.View>

      {/* ── Bottom controls ── */}
      <Animated.View
        style={[
          s.bottomControls,
          {
            paddingBottom: Math.max(safeBottom, 16) + 8,
            opacity: controlsOpacity,
            transform: [{ translateY: controlsTransY }],
          },
        ]}
      >
        {/* Preset strip (scrollable for future expansion and smaller devices) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.presetStripContent}
          style={s.presetStrip}
        >
          {PRESETS.map(preset => {
            const isActive = selectedPreset === preset.id;
            return (
              <TouchableOpacity
                key={preset.id}
                style={s.presetItem}
                onPress={() => handlePresetTap(preset)}
                activeOpacity={0.7}
              >
                <View style={[s.presetIcon, isActive && s.presetIconActive]}>
                  <Feather
                    name={preset.icon as any}
                    size={16}
                    color={isActive ? '#FFF' : 'rgba(255,255,255,0.5)'}
                  />
                </View>
                <Text style={[s.presetLabel, isActive && s.presetLabelActive]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Swap + Done row */}
        <View style={s.actionRow}>
          <TouchableOpacity style={s.swapBtn} onPress={handleSwap} activeOpacity={0.7}>
            <Feather name="repeat" size={14} color="rgba(255,255,255,0.6)" />
            <Text style={s.swapBtnTxt}>Swap</Text>
            <View style={s.cameraIndicator}>
              <Text style={s.cameraIndicatorTxt}>{primaryCamera === 'rear' ? 'R' : 'F'}</Text>
            </View>
          </TouchableOpacity>

          <Animated.View style={{ opacity: doneOpacity }}>
            <TouchableOpacity style={s.doneBtn} onPress={handleDone} activeOpacity={0.85}>
              <Text style={s.doneBtnTxt}>Done</Text>
              <Feather name="arrow-right" size={14} color="#FFF" />
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

// ── STYLES ────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: Z_ARRANGEMENT,
  },

  // Gradients
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
  },

  // Snap guides
  guideVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: `rgba(255,255,255,${OPACITY_GUIDES * 0.2})`,
  },
  guideHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: `rgba(255,255,255,${OPACITY_GUIDES * 0.2})`,
  },
  guideVerticalWeak: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  guideHorizontalWeak: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  // Title
  titleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  titleTxt: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // Bottom controls
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },

  // Preset strip (ScrollView container)
  presetStrip: {
    marginBottom: 20,
  },
  presetStripContent: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 16,
  },
  presetItem: {
    alignItems: 'center',
    gap: 6,
  },
  presetIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  presetIconActive: {
    borderColor: '#FFF',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  presetLabel: {
    fontSize: 11,
    fontWeight: '600' as any,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 0.1,
  },
  presetLabelActive: {
    color: '#FFF',
  },

  // Action row
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  swapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  swapBtnTxt: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600' as any,
  },
  cameraIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  cameraIndicatorTxt: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700' as any,
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 26,
    backgroundColor: '#C9A96E',
    ...SHADOW_POST,
  },
  doneBtnTxt: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700' as any,
  },
});