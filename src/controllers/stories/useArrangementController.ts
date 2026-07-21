/**
 * useArrangementController.ts
 *
 * Owns: arrangementOpen, canvasInteractive, primaryCamera, selectedPreset.
 * Does NOT own: bubble position/animation (delegates to BubbleController).
 * Does NOT own: draft state (writes via updateDraft callback).
 *
 * Source of truth: arrangementOpen, primaryCamera, selectedPreset.
 * Persistence owner: commits DualLayout to draft on close via updateDraft.
 * Cleanup: gesture restore timeout cleared on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  DELAY_GESTURE_RESTORE,
  HAPTIC_SWAP,
} from '../../constants/motionDualMemory';
import type { BubbleTransform, DualLayout } from '../../types/dualMemoryTransform';
import type { CompositionPreset } from '../../components/stories/DualArrangementOverlay';

export interface ArrangementControllerInput {
  isDual: boolean;
  openOnMount: boolean;
  screenW: number;
  screenH: number;
  updateDraft: (patch: Record<string, any>) => void;
  animateToPreset: (preset: CompositionPreset) => void;
  getBubbleTransform: () => BubbleTransform;
}

export interface ArrangementControllerOutput {
  arrangementOpen: boolean;
  canvasInteractive: boolean;
  primaryCamera: 'front' | 'rear';
  selectedPreset: string | null;
  openArrangement: () => void;
  closeArrangement: () => void;
  handleSwap: () => void;
  handlePresetSelect: (preset: CompositionPreset) => void;
  setSelectedPreset: (id: string | null) => void;
}

export function useArrangementController(input: ArrangementControllerInput): ArrangementControllerOutput {
  const { isDual, openOnMount, screenW, screenH, updateDraft, animateToPreset, getBubbleTransform } = input;

  const [arrangementOpen, setArrangementOpen] = useState(openOnMount);
  const [canvasInteractive, setCanvasInteractive] = useState(!openOnMount);
  const [primaryCamera, setPrimaryCamera] = useState<'front' | 'rear'>('rear');
  const [selectedPreset, setSelectedPreset] = useState<string | null>('corner');

  const mountedRef = useRef(true);
  const restoreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);
    };
  }, []);

  // ── Open arrangement ──
  const openArrangement = useCallback(() => {
    if (!isDual) return;
    if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);
    setArrangementOpen(true);
    setCanvasInteractive(false);
  }, [isDual]);

  // ── Close arrangement: commit layout, restore gestures ──
  const closeArrangement = useCallback(() => {
    const bubble = getBubbleTransform();
    const layout: DualLayout = {
      mode: 'pip_front_small',
      primaryCamera,
      bubble: {
        x: bubble.x,
        y: bubble.y,
        scale: bubble.scale,
      },
      presetId: selectedPreset,
    };

    updateDraft({ dualLayout: layout });
    setArrangementOpen(false);

    // Delayed gesture restoration to prevent accidental canvas interaction
    if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);
    restoreTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) setCanvasInteractive(true);
    }, DELAY_GESTURE_RESTORE);
  }, [primaryCamera, selectedPreset, updateDraft, getBubbleTransform]);

  // ── Swap cameras ──
  const handleSwap = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle[HAPTIC_SWAP]);
    setPrimaryCamera(prev => prev === 'rear' ? 'front' : 'rear');
  }, []);

  // ── Preset selection: delegates animation to BubbleController ──
  const handlePresetSelect = useCallback((preset: CompositionPreset) => {
    setSelectedPreset(preset.id);
    animateToPreset(preset);
  }, [animateToPreset]);

  return {
    arrangementOpen,
    canvasInteractive,
    primaryCamera,
    selectedPreset,
    openArrangement,
    closeArrangement,
    handleSwap,
    handlePresetSelect,
    setSelectedPreset,
  };
}
