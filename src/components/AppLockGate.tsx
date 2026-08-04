/**
 * AppLockGate - full-screen Face ID cover when the app lock is on.
 * Locks at cold launch and after more than a minute in the background.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState, Image } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLockStore } from '../stores/lockStore';

const NAVY = '#18294C';
const LOCK_AFTER_MS = 60000;

export default function AppLockGate() {
  const enabled = useLockStore(st => st.enabled);
  const locked = useLockStore(st => st.locked);
  const unlock = useLockStore(st => st.unlock);
  const relock = useLockStore(st => st.relock);
  const init = useLockStore(st => st.init);
  const busyRef = useRef(false);
  const awayAt = useRef<number | null>(null);

  useEffect(() => { init(); }, [init]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') awayAt.current = Date.now();
      if (s === 'active') {
        if (awayAt.current && Date.now() - awayAt.current > LOCK_AFTER_MS) relock();
        awayAt.current = null;
      }
    });
    return () => sub.remove();
  }, [relock]);

  const prompt = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Platinum Circles', fallbackLabel: 'Use passcode' });
      if (r.success) unlock();
    } catch {} finally { busyRef.current = false; }
  }, [unlock]);

  useEffect(() => { if (enabled === true && locked) prompt(); }, [enabled, locked, prompt]);

  if (enabled !== true || !locked) return null;
  return (
    <View style={s.cover} pointerEvents="auto">
      <Image source={require('../../assets/icon.png')} style={s.mark} />
      <Text style={s.title}>Platinum Circles is locked</Text>
      <TouchableOpacity style={s.btn} onPress={prompt} activeOpacity={0.85}>
        <Text style={s.btnTxt}>Unlock with Face ID</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999 },
  mark: { width: 96, height: 96, borderRadius: 22, marginBottom: 18 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 26 },
  btn: { backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 30 },
  btnTxt: { color: NAVY, fontSize: 15.5, fontWeight: '800' },
});
