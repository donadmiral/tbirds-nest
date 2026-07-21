/**
 * useKeyboardOrchestrator.ts
 *
 * Owns: keyboard height tracking, caption bottom animation, controls opacity.
 * Does NOT own: bloom state (receives closeBloom as stable callback).
 *
 * Source of truth: keyboardHeight.
 * Animation owner: captionBottomAnim, controlsOpacityAnim.
 * Cleanup: keyboard listeners removed on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Platform } from 'react-native';

export interface KeyboardOrchestratorInput {
  closeBloom: () => void;
}

export interface KeyboardOrchestratorOutput {
  keyboardHeight: number;
  captionBottomAnim: Animated.Value;
  controlsOpacityAnim: Animated.Value;
}

export function useKeyboardOrchestrator(input: KeyboardOrchestratorInput): KeyboardOrchestratorOutput {
  const { closeBloom } = input;

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const captionBottomAnim = useRef(new Animated.Value(56)).current;
  const controlsOpacityAnim = useRef(new Animated.Value(1)).current;

  // Store closeBloom in a ref so the keyboard listener doesn't stale-close
  const closeBloomRef = useRef(closeBloom);
  useEffect(() => { closeBloomRef.current = closeBloom; }, [closeBloom]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: any) => {
      const kbHeight = e.endCoordinates.height;
      setKeyboardHeight(kbHeight);
      closeBloomRef.current();

      const captionTarget = kbHeight + 16;
      const iosDuration = e.duration || 250;

      Animated.parallel([
        Animated.timing(captionBottomAnim, {
          toValue: captionTarget,
          duration: Platform.OS === 'ios' ? iosDuration : 200,
          useNativeDriver: false,
        }),
        Animated.timing(controlsOpacityAnim, {
          toValue: 0.75,
          duration: 200,
          useNativeDriver: false,
        }),
      ]).start();
    };

    const onHide = () => {
      setKeyboardHeight(0);
      Animated.parallel([
        Animated.timing(captionBottomAnim, {
          toValue: 56,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.timing(controlsOpacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: false,
        }),
      ]).start();
    };

    const sub1 = Keyboard.addListener(showEvent, onShow);
    const sub2 = Keyboard.addListener(hideEvent, onHide);
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, [captionBottomAnim, controlsOpacityAnim]);

  return {
    keyboardHeight,
    captionBottomAnim,
    controlsOpacityAnim,
  };
}
