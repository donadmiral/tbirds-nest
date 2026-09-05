// src/hooks/useCameraLife.ts
// One live camera at a time. expo-camera on iOS runs a single capture
// session; a second CameraView mounted underneath (the story camera stays
// mounted while Dual, Boomerang or Fun sits on top) or a session that
// survives a trip to the background is what shows as a black preview.
// active follows screen focus and app state; epoch bumps on return from the
// background so the view remounts with a fresh session.
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

export function useCameraLife() {
  const focused = useIsFocused();
  const [fg, setFg] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [epoch, setEpoch] = useState(0);
  const wasBg = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        setFg(true);
        if (wasBg.current) { wasBg.current = false; setEpoch((e) => e + 1); }
      } else {
        if (s === 'background') wasBg.current = true;
        setFg(false);
      }
    });
    return () => { sub.remove(); };
  }, []);
  return { active: focused && fg, epoch };
}