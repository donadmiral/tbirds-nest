// src/components/SplashLoader.tsx
/**
 * Full-screen loading view with PlatinumCircles logo.
 * Used in AppNavigator while auth session loads.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import PlatinumCirclesLogo from './PlatinumCirclesLogo';

export default function SplashLoader() {
  const pulse = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.06,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <View style={s.container}>
      <Animated.View style={{ opacity: fade, transform: [{ scale: pulse }] }}>
        <PlatinumCirclesLogo size={120} />
      </Animated.View>
      <Animated.View style={{ opacity: fade }}>
        <Text style={s.name}>
          Platinum<Text style={s.accent}>Circles</Text>
        </Text>
        <Text style={s.tagline}>Your exclusive community platform</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1E3D',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  name: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  accent: {
    color: '#D8DAE5',
  },
  tagline: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    marginTop: 6,
    letterSpacing: 0.3,
  },
});