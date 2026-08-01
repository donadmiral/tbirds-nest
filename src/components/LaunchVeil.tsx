/**
 * LaunchVeil - the app renders beneath from the first frame; this brand
 * veil fades and scales away the moment auth resolves, hard-capped at
 * 2.5 seconds so a trapped launch is structurally impossible.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Image, Animated, StyleSheet } from 'react-native';

export default function LaunchVeil({ busy }: { busy: boolean }) {
  const fade = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const [gone, setGone] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    const lift = () => {
      if (fired.current) return;
      fired.current = true;
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: 420, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.06, duration: 420, useNativeDriver: true }),
      ]).start(() => setGone(true));
    };
    if (!busy) lift();
    const cap = setTimeout(lift, 2500);
    return () => clearTimeout(cap);
  }, [busy, fade, scale]);

  if (gone) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, s.wrap, { opacity: fade }]}>
      <Animated.Image source={require('../../assets/splash.png')} style={[s.art, { transform: [{ scale }] }]} resizeMode="contain" />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999 },
  art: { width: '78%', height: '60%' },
});