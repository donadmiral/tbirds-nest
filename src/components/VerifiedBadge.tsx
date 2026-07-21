/**
 * VerifiedBadge.tsx
 * Displays a verified school badge next to a user's name.
 * Place at: src/components/VerifiedBadge.tsx
 *
 * Usage:
 *   import VerifiedBadge from '../../components/VerifiedBadge';
 *   {isVerified && <VerifiedBadge />}
 *   {isVerified && <VerifiedBadge size={16} />}
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

type Props = {
  size?: number;
  label?: string;
  showLabel?: boolean;
};

export default function VerifiedBadge({ size = 14, label = 'ASU Verified', showLabel = false }: Props) {
  return (
    <View style={st.wrap}>
      <View style={[st.circle, { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2 }]}>
        <Feather name="check" size={size - 2} color="#FFF" />
      </View>
      {showLabel && <Text style={st.label}>{label}</Text>}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  circle: { backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '600', color: '#2563EB' },
});