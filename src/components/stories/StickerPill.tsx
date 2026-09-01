import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

type StickerPillProps = {
  label: string;
  kind: 'link' | 'location' | 'mention' | 'hashtag';
  onPress?: () => void;
  /** Tap cycles the look: 0 white, 1 ink, 2 gradient, 3 glass. Stored on the sticker. */
  variant?: number;
};

/**
 * StickerPill - the tappable pills (link, location, mention, hashtag).
 * Four looks, cycled by tapping in the composer and replayed by both viewers.
 * Type sizing and the leading glyph follow the same grid across all four so a
 * story reads the same whichever look is chosen.
 */
const CONFIG = {
  link: { icon: 'link-2' as const, prefix: '' },
  location: { icon: 'map-pin' as const, prefix: '' },
  mention: { icon: null, prefix: '@' },
  hashtag: { icon: null, prefix: '#' },
} as const;

const GRADIENTS: Record<string, [string, string]> = {
  link: ['#3C7DFF', '#00C2FF'],
  location: ['#FF6B4A', '#FFB03A'],
  mention: ['#7C5CFF', '#B96BFF'],
  hashtag: ['#0EA5E9', '#22D3EE'],
};

export default function StickerPill({ label, kind, onPress, variant = 0 }: StickerPillProps) {
  const cfg = CONFIG[kind];
  const text =
    kind === 'mention' && !label.startsWith('@') ? '@' + label
    : kind === 'hashtag' && !label.startsWith('#') ? '#' + label
    : label;
  const v = ((variant % 4) + 4) % 4;
  const fg = v === 0 ? '#0A0A0A' : '#FFFFFF';

  const inner = (
    <View style={s.row}>
      {cfg.icon ? <Feather name={cfg.icon} size={14} color={fg} style={{ marginRight: 5 }} /> : null}
      <Text style={[s.label, { color: fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );

  let content: React.ReactNode;
  if (v === 2) {
    content = (
      <LinearGradient colors={GRADIENTS[kind] || ['#3C7DFF', '#00C2FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.pill, s.shadow]}>
        {inner}
      </LinearGradient>
    );
  } else {
    const bg = v === 0 ? { backgroundColor: '#FFFFFF' }
      : v === 1 ? { backgroundColor: '#0B1E3D' }
      : { backgroundColor: 'rgba(10,12,18,0.42)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.5)' };
    content = <View style={[s.pill, bg, v !== 3 && s.shadow]}>{inner}</View>;
  }

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        {content}
      </TouchableOpacity>
    );
  }
  return <>{content}</>;
}

const s = StyleSheet.create({
  pill: { borderRadius: 11, paddingHorizontal: 13, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 15.5, fontWeight: '800', letterSpacing: -0.3, maxWidth: 200 },
  shadow: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 9, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
});
