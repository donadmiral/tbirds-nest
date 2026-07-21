/**
 * MemoryCaption.tsx
 *
 * Environmental narrative text. No container.
 * Positioned with sufficient clearance above identity and reply zones.
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import ReAnimated, { SharedValue, useAnimatedStyle, interpolate } from 'react-native-reanimated';

type MemoryCaptionProps = {
  caption: string | null | undefined;
  chromeOpacity: SharedValue<number>;
  bottomOffset: number;
};

const MemoryCaption = React.memo(function MemoryCaption({
  caption, chromeOpacity, bottomOffset,
}: MemoryCaptionProps) {
  const captionStyle = useAnimatedStyle(() => {
    const opacity = interpolate(chromeOpacity.value, [0.45, 0.65, 1], [0.6, 0.8, 0.92]);
    return { opacity };
  });

  if (!caption) return null;

  return (
    <ReAnimated.View
      style={[s.container, { bottom: bottomOffset }, captionStyle]}
      pointerEvents="none"
    >
      <Text style={s.text}>{caption}</Text>
    </ReAnimated.View>
  );
});

export default MemoryCaption;

const s = StyleSheet.create({
  container: { position: 'absolute', left: 20, right: 52, zIndex: 10 },
  text: {
    color: 'rgba(245,240,235,0.92)',
    fontSize: 15.5, lineHeight: 22, fontWeight: '500', letterSpacing: -0.1,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
});