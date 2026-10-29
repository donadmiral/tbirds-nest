/** A count of new posts returned by the active feed, held until requested. */
import { themedSheet, getTheme } from '../theme/useTheme';
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from './SafeArea';
import { Feather } from '@expo/vector-icons';

export default function NewPostsPill({ count, onPress }: { count: number; onPress: () => void }) {
  const insets = useSafeAreaInsets();
  if (count <= 0) return null;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Load new posts"
      onPress={onPress}
      style={[s.pill, { top: insets.top + 8 }]}
    >
      <Feather name="arrow-up" size={13} color={getTheme().ink.inverse} />
      <Text style={s.txt}>{count === 1 ? 'New post' : count + ' new posts'}</Text>
    </TouchableOpacity>
  );
}

const s = themedSheet((t) => ({
  pill: {
    position: 'absolute', alignSelf: 'center', zIndex: 50,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: t.brand.base, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  txt: { color: t.ink.inverse, fontSize: 13, fontWeight: '700' },
}));
