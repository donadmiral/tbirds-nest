import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';

type StickerPillProps = {
  label: string;
  kind: 'link' | 'location' | 'mention';
  onPress?: () => void;
};

// Instagram construction: solid white pill, black bold label, small dark glyph.
const PILL_CONFIG = {
  link: { iconName: 'link-2' as const, prefix: '' },
  location: { iconName: 'map-pin' as const, prefix: '' },
  mention: { iconName: null, prefix: '@' },
} as const;

export default function StickerPill({ label, kind, onPress }: StickerPillProps) {
  const config = PILL_CONFIG[kind];
  const text = kind === 'mention' && !label.startsWith('@') ? '@' + label : label;

  const content = (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: '#FFFFFF',
      borderRadius: 9,
      paddingHorizontal: 11,
      paddingVertical: 7,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    }}>
      {config.iconName ? (
        <Feather name={config.iconName} size={13} color="#0A0A0A" />
      ) : null}
      <Text
        style={{
          color: '#0A0A0A',
          fontSize: 15,
          fontWeight: '700',
          letterSpacing: -0.3,
          maxWidth: 190,
        }}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}