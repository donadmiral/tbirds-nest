/**
 * useBloomOrchestrator.ts
 *
 * Owns: bloomOpen, tool animations, invoke rotation, breath loop.
 * Does NOT own: which tools exist (receives tools array).
 * Does NOT own: what happens when a tool is tapped (receives onToolTap callback).
 *
 * Source of truth: bloomOpen.
 * Animation owner: bloomToolAnims, bloomLabelOpacity, invokeRotation, invokeBreathOpacity.
 * Cleanup: breath loop stopped on unmount. Tool open timeout cleared on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  BLOOM_OPEN_SPRINGS,
  BLOOM_CLOSE_SPRING,
  BLOOM_STAGGERS,
} from '../../components/stories/composerTheme';
import { duration, easing as tokenEasing } from '../../constants/tokens';

export interface BloomOrchestratorInput {
  publishing: boolean;
  reduceMotion: boolean;
  toolCount: number;
  onToolTap: (toolId: string) => void;
}

export interface BloomOrchestratorOutput {
  bloomOpen: boolean;
  openBloom: () => void;
  closeBloom: () => void;
  handleBloomToolTap: (toolId: string) => void;
  bloomToolAnims: { progress: Animated.Value }[];
  bloomLabelOpacity: Animated.Value;
  invokeRotation: Animated.Value;
  invokeBreathOpacity: Animated.Value;
}

export function useBloomOrchestrator(input: BloomOrchestratorInput): BloomOrchestratorOutput {
  const { publishing, reduceMotion, toolCount, onToolTap } = input;

  const [bloomOpen, setBloomOpen] = useState(false);
  const mountedRef = useRef(true);
  const toolOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Animated values ──
  const animCount = Math.max(toolCount, 4);
  const bloomToolAnims = useRef(
    Array.from({ length: animCount }, () => ({ progress: new Animated.Value(0) }))
  ).current;
  const bloomLabelOpacity = useRef(new Animated.Value(0)).current;
  const invokeRotation = useRef(new Animated.Value(0)).current;
  const invokeBreathOpacity = useRef(new Animated.Value(0.1)).current;

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (toolOpenTimeoutRef.current) clearTimeout(toolOpenTimeoutRef.current);
    };
  }, []);

  // ── Breath animation loop ──
  useEffect(() => {
    if (reduceMotion) return;
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(invokeBreathOpacity, {
          toValue: 0.13,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(invokeBreathOpacity, {
          toValue: 0.1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    breathe.start();
    return () => breathe.stop();
  }, [reduceMotion, invokeBreathOpacity]);

  // ── Open bloom ──
  const openBloom = useCallback(() => {
    if (bloomOpen || publishing) return;
    setBloomOpen(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (reduceMotion) {
      bloomToolAnims.forEach(a => a.progress.setValue(1));
      bloomLabelOpacity.setValue(1);
      invokeRotation.setValue(1);
      return;
    }

    Animated.timing(invokeRotation, {
      toValue: 1,
      duration: duration.small,
      easing: tokenEasing.softSettle,
      useNativeDriver: true,
    }).start();

    bloomToolAnims.forEach((anim, i) => {
      const sp = BLOOM_OPEN_SPRINGS[i] || BLOOM_OPEN_SPRINGS[0];
      Animated.spring(anim.progress, {
        toValue: 1,
        ...sp,
        useNativeDriver: true,
        delay: BLOOM_STAGGERS[i] || 50,
      }).start();
    });

    Animated.timing(bloomLabelOpacity, {
      toValue: 1,
      duration: duration.micro,
      delay: 200,
      useNativeDriver: true,
    }).start();
  }, [bloomOpen, publishing, reduceMotion, bloomToolAnims, bloomLabelOpacity, invokeRotation]);

  // ── Close bloom ──
  const closeBloom = useCallback(() => {
    if (!bloomOpen) return;

    if (reduceMotion) {
      bloomToolAnims.forEach(a => a.progress.setValue(0));
      bloomLabelOpacity.setValue(0);
      invokeRotation.setValue(0);
      setBloomOpen(false);
      return;
    }

    Animated.timing(bloomLabelOpacity, {
      toValue: 0,
      duration: duration.micro,
      useNativeDriver: true,
    }).start();

    Animated.timing(invokeRotation, {
      toValue: 0,
      duration: duration.small,
      easing: tokenEasing.softSettle,
      useNativeDriver: true,
    }).start();

    const anims = bloomToolAnims.map(anim =>
      Animated.spring(anim.progress, {
        toValue: 0,
        ...BLOOM_CLOSE_SPRING,
        useNativeDriver: true,
      })
    );
    Animated.parallel(anims).start(() => {
      if (mountedRef.current) setBloomOpen(false);
    });
  }, [bloomOpen, reduceMotion, bloomToolAnims, bloomLabelOpacity, invokeRotation]);

  // ── Tool tap: close bloom, delay, then dispatch ──
  const handleBloomToolTap = useCallback((toolId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    closeBloom();

    // Clear any pending tool open
    if (toolOpenTimeoutRef.current) clearTimeout(toolOpenTimeoutRef.current);

    toolOpenTimeoutRef.current = setTimeout(() => {
      onToolTap(toolId);
    }, reduceMotion ? 50 : 200);
  }, [closeBloom, reduceMotion, onToolTap]);

  return {
    bloomOpen,
    openBloom,
    closeBloom,
    handleBloomToolTap,
    bloomToolAnims,
    bloomLabelOpacity,
    invokeRotation,
    invokeBreathOpacity,
  };
}
