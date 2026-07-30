/**
 * EmptyState - what a screen says when it has nothing to show. A blank
 * list reads as broken; a sentence reads as calm. Used wherever a list
 * can legitimately be empty.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

const NAVY = '#0B1E3D';

export default function EmptyState({ icon = 'inbox', title, line }: { icon?: any; title: string; line?: string }) {
  return (
    <View style={s.wrap}>
      <View style={s.ring}>
        <Feather name={icon} size={22} color="rgba(11,30,61,0.35)" />
      </View>
      <Text style={s.title}>{title}</Text>
      {line ? <Text style={s.line}>{line}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 64, paddingHorizontal: 44 },
  ring: {
    width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(11,30,61,0.12)', backgroundColor: 'rgba(11,30,61,0.03)', marginBottom: 14,
  },
  title: { fontSize: 15.5, fontWeight: '700', color: NAVY, textAlign: 'center' },
  line: { fontSize: 13, lineHeight: 19, color: 'rgba(11,30,61,0.5)', textAlign: 'center', marginTop: 6 },
});