/**
 * EmptyState - what a screen says when it has nothing to show. A blank
 * list reads as broken; a sentence reads as calm. Used wherever a list
 * can legitimately be empty.
 */
import { themedSheet, useTheme } from '../theme/useTheme';
import React from 'react';
import { View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';


export default function EmptyState({ icon = 'inbox', title, line }: { icon?: any; title: string; line?: string }) {
  const { t } = useTheme();
  return (
    <View style={s.wrap}>
      <View style={s.ring}>
        <Feather name={icon} size={22} color={t.ink.muted} />
      </View>
      <Text style={s.title}>{title}</Text>
      {line ? <Text style={s.line}>{line}</Text> : null}
    </View>
  );
}

const s = themedSheet((t) => ({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 64, paddingHorizontal: 44 },
  ring: {
    width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: t.surface.hairline, backgroundColor: t.surface.raised, marginBottom: 14,
  },
  title: { fontSize: 15.5, fontWeight: '700', color: t.ink.primary, textAlign: 'center' },
  line: { fontSize: 13, lineHeight: 19, color: t.ink.secondary, textAlign: 'center', marginTop: 6 },
}));