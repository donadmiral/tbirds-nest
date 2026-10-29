import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/useTheme';

export function StudioLoadError({ message, onRetry, busy = false }: { message: string | null; onRetry: () => void; busy?: boolean }) {
  const { t } = useTheme();
  if (!message) return null;
  return <View accessibilityRole="alert" style={{ margin: 16, padding: 16, borderRadius: 12, backgroundColor: t.surface.raised, borderWidth: 1, borderColor: t.surface.hairline }}>
    <Text style={{ color: t.ink.primary, fontSize: 14, lineHeight: 21 }}>{message}</Text>
    <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={onRetry} style={{ alignSelf: 'flex-start', paddingVertical: 12, paddingRight: 16, opacity: busy ? .5 : 1 }}><Text style={{ color: t.status.link, fontWeight: '700' }}>{busy ? 'Refreshing…' : 'Try again'}</Text></TouchableOpacity>
  </View>;
}
