/**
 * Frame: a Polaroid. In a story the photo sits blurred under the film until
 * the viewer shakes the phone or taps it; then it develops. The caption and
 * the date it was taken print under the photo, like the real thing.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Animated } from 'react-native';
export default function FrameStickerCard({ uri, caption, takenAt, interactive }: { uri?: string | null; caption?: string; takenAt?: string | null; interactive?: boolean }) {
  const [revealed, setRevealed] = useState(!interactive);
  const develop = useRef(new Animated.Value(interactive ? 0 : 1)).current;
  const reveal = () => { if (revealed) return; setRevealed(true); Animated.timing(develop, { toValue: 1, duration: 900, useNativeDriver: true }).start(); };
  useEffect(() => {
    if (!interactive || revealed) return;
    let sub: any = null;
    try {
      // Only load the sensor library when the app on this phone was built with it.
      const mods = (globalThis as any).expo?.modules; if (!mods || !mods.ExponentAccelerometer) return;
      const sensors = require('expo-sensors');
      if (sensors?.Accelerometer) { sensors.Accelerometer.isAvailableAsync().then((ok: boolean) => { if (!ok || revealed) return; try { sensors.Accelerometer.setUpdateInterval(120); sub = sensors.Accelerometer.addListener((a: any) => { const g = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); if (g > 2.2) reveal(); }); } catch {} }).catch(() => {}); }
    } catch {}
    return () => { try { sub?.remove?.(); } catch {} };
  }, [interactive, revealed]);
  const date = takenAt ? new Date(takenAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={reveal} disabled={!interactive} style={cs.frame}>
      <View style={cs.photo}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={revealed ? 0 : 22} /> : null}
        {uri && !revealed ? <View style={cs.film}><Text style={cs.filmTxt}>Shake to reveal</Text></View> : null}
        {uri ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#0E0F13', opacity: develop.interpolate({ inputRange: [0, 1], outputRange: [interactive ? 0.55 : 0, 0] }) }]} /> : null}
      </View>
      <Text style={cs.caption} numberOfLines={1}>{caption || ' '}</Text>
      {date ? <Text style={cs.date}>{date}</Text> : null}
    </TouchableOpacity>
  );
}
const cs = StyleSheet.create({
  frame: { width: 200, backgroundColor: '#FFFFFF', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12, borderRadius: 4, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  photo: { width: 180, height: 180, backgroundColor: '#111', overflow: 'hidden' },
  film: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  filmTxt: { color: 'rgba(255,255,255,0.9)', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  caption: { color: '#0B1E3D', fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  date: { color: 'rgba(11,30,61,0.5)', fontSize: 10.5, fontWeight: '700', textAlign: 'center', marginTop: 2, letterSpacing: 0.3 },
});