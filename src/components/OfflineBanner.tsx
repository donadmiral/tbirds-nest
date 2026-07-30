/**
 * OfflineBanner - one quiet line of truth at the top of the app when the
 * network is gone, with the outbox count when messages are waiting.
 * Mounting it also starts the connection listener.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNetStore, initNet } from '../stores/netStore';

export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const online = useNetStore((s) => s.online);
  const waiting = useNetStore((s) => s.outbox.length);
  useEffect(() => { initNet(); }, []);
  if (online) return null;
  return (
    <View style={[s.wrap, { top: insets.top + 4 }]} pointerEvents="none">
      <Feather name="wifi-off" size={12} color="#FFFFFF" />
      <Text style={s.txt}>
        No connection{waiting > 0 ? ' - ' + waiting + (waiting === 1 ? ' message waits to send' : ' messages wait to send') : ' - showing what is already loaded'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute', alignSelf: 'center', zIndex: 9999,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(11,30,61,0.92)', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  txt: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' },
});