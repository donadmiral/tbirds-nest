import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

// Keep chrome still and opaque until the platform preferences are known.
export function useNavigationAccessibility() {
  const [preferences, setPreferences] = useState({ reduceMotion: true, reduceTransparency: true, screenReader: true, highContrast: true });

  useEffect(() => {
    let active = true;
    const versions = { reduceMotion: 0, reduceTransparency: 0, screenReader: 0, highContrast: 0 };
    type Key = keyof typeof versions;
    const update = (key: Key, value: boolean) => {
      if (active) setPreferences(previous => ({ ...previous, [key]: value }));
    };
    const changed = (key: Key) => (value: boolean) => {
      versions[key] += 1;
      update(key, value);
    };
    const subscriptions = [
      AccessibilityInfo.addEventListener('reduceMotionChanged', changed('reduceMotion')),
      AccessibilityInfo.addEventListener('screenReaderChanged', changed('screenReader')),
    ];
    if (Platform.OS === 'ios') {
      subscriptions.push(AccessibilityInfo.addEventListener('reduceTransparencyChanged', changed('reduceTransparency')));
      subscriptions.push(AccessibilityInfo.addEventListener('darkerSystemColorsChanged', changed('highContrast')));
    } else if (Platform.OS === 'android') {
      subscriptions.push(AccessibilityInfo.addEventListener('highTextContrastChanged', changed('highContrast')));
    }
    const read = (key: Key, query: () => Promise<boolean>) => {
      const version = versions[key];
      Promise.resolve().then(query).then(value => {
        // A live preference event takes precedence over an earlier async read.
        if (versions[key] === version) update(key, value);
      }).catch(() => { /* Retain the accessible fallback when a native read fails. */ });
    };
    read('reduceMotion', () => AccessibilityInfo.isReduceMotionEnabled());
    read('screenReader', () => AccessibilityInfo.isScreenReaderEnabled());
    if (Platform.OS === 'ios') {
      read('reduceTransparency', () => AccessibilityInfo.isReduceTransparencyEnabled());
      read('highContrast', () => AccessibilityInfo.isDarkerSystemColorsEnabled());
    } else if (Platform.OS === 'android') {
      read('highContrast', () => AccessibilityInfo.isHighTextContrastEnabled());
    }
    return () => {
      active = false;
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, []);

  return preferences;
}
