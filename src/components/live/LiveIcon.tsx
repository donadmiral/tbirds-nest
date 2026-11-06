import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/** The LIVE lettering is part of the camera, so every entry uses one compact mark. */
export function LiveIcon({ size = 20, color = '#12203F' }: { size?: number; color?: string }) {
  return <Svg width={Math.round(size * 44 / 24)} height={size} viewBox="0 0 44 24" fill="none"
    stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
    accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Rect x={1} y={2} width={33} height={20} rx={5} />
    <Path d="m34 9 8-4v14l-8-4" />
    <Path d="M6 8v8h4M13 8v8M17 8l3 8 3-8M31 8h-5v8h5M26 12h4" strokeWidth={1.6} />
  </Svg>;
}
