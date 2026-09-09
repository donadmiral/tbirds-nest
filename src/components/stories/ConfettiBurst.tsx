/** A small burst of confetti, for a right answer. No library, twelve pieces, one second. */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
const COLORS = ['#C9BFB0', '#0B1E3D', '#34C759', '#F59E0B', '#FF7A90', '#7DB1FF'];
export default function ConfettiBurst({ play }: { play: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (!play) return; t.setValue(0); Animated.timing(t, { toValue: 1, duration: 1000, useNativeDriver: true }).start(); }, [play, t]);
  if (!play) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * Math.PI * 2; const dist = 70 + (i % 3) * 22;
        return <Animated.View key={i} style={{ position: 'absolute', left: '50%', top: '40%', width: 8, height: 12, borderRadius: 2, backgroundColor: COLORS[i % COLORS.length], opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }), transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * dist] }) }, { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * dist + 40] }) }, { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', (i % 2 ? 360 : -360) + 'deg'] }) }] }} />;
      })}
    </View>
  );
}