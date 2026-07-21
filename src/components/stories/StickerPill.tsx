import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';

type StickerPillProps = {
  label: string;
  kind: 'link' | 'location' | 'mention';
  onPress?: () => void;
};

const PILL_CONFIG = {
  link: {
    iconName: 'link' as const,
    iconColor: '#FFF',
    iconBg: 'rgba(255,255,255,0.15)',
    showChevron: true,
  },
  location: {
    iconName: 'map-pin' as const,
    iconColor: '#FF6B6B',
    iconBg: 'rgba(255,107,107,0.2)',
    showChevron: false,
  },
  mention: {
    iconName: 'at-sign' as const,
    iconColor: '#60A5FA',
    iconBg: 'rgba(96,165,250,0.2)',
    showChevron: false,
  },
} as const;

export default function StickerPill({ label, kind, onPress }: StickerPillProps) {
  const config = PILL_CONFIG[kind];

  const content = (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: 'rgba(0,0,0,0.75)',
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.15)',
    }}>
      <View style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: config.iconBg,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Feather name={config.iconName} size={12} color={config.iconColor} />
      </View>
      <Text style={{
        color: '#FFF',
        fontSize: 13,
        fontWeight: '700',
        maxWidth: 110,
      }} numberOfLines={1}>
        {label}
      </Text>
      {config.showChevron && (
        <Feather name="chevron-right" size={12} color="rgba(255,255,255,0.4)" />
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}