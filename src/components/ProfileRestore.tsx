/**
 * ProfileRestore - the honest replacement for the silent white gate.
 * Signed in but the profile has not arrived: auto-retries every 4s,
 * offers Retry and Sign out. Never silent, never infinite.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Image, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuthStore } from '../stores/authStore';

export default function ProfileRestore() {
  const healProfile = useAuthStore(s => s.healProfile);
  const signOut = useAuthStore(s => s.signOut);
  const [tries, setTries] = useState(0);
  const timer = useRef<any>(null);

  useEffect(() => {
    healProfile();
    timer.current = setInterval(() => { setTries(t => t + 1); healProfile(); }, 4000);
    return () => clearInterval(timer.current);
  }, [healProfile]);

  return (
    <View style={s.wrap}>
      <Image source={require('../../assets/splash.png')} style={s.art} resizeMode="contain" />
      <ActivityIndicator size="small" color="#0B1E3D" style={{ marginTop: 8 }} />
      <Text style={s.title}>Restoring your profile</Text>
      <Text style={s.sub}>{tries < 2 ? 'One moment...' : 'Your connection seems slow. Retrying automatically.'}</Text>
      <TouchableOpacity style={s.btn} onPress={() => healProfile()}>
        <Text style={s.btnText}>Retry now</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => signOut()} style={{ marginTop: 14 }}>
        <Text style={s.out}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  art: { width: '58%', height: '30%' },
  title: { marginTop: 10, fontSize: 16.5, fontWeight: '700', color: '#0B1E3D' },
  sub: { marginTop: 6, fontSize: 13, color: '#8A8F98', textAlign: 'center' },
  btn: { marginTop: 18, backgroundColor: '#0B1E3D', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 34 },
  btnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  out: { color: '#A32D2D', fontSize: 13.5, fontWeight: '600' },
});