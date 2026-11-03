import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

/** Camera + recording dot. Intentionally different from the Channels radio icon. */
export function LiveIcon({ size = 20, color = '#12203F' }: { size?: number; color?: string }) {
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ width: size + 3, height: size + 3, alignItems: 'center', justifyContent: 'center' }}>
    <Feather name="video" size={size} color={color} />
    <View style={[s.dot, { width: Math.max(4, size * .24), height: Math.max(4, size * .24) }]} />
  </View>;
}
const s = StyleSheet.create({ dot: { position: 'absolute', top: 0, right: 0, borderRadius: 8, backgroundColor: '#C72C41' } });
