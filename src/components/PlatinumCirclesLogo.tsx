// src/components/PlatinumCirclesLogo.tsx
/**
 * Reusable PlatinumCircles logo mark.
 * Option F: Double orbit rings with platinum sphere.
 * Use size prop to scale. Works on any background.
 */
import React from 'react';
import Svg, {
  Defs, LinearGradient, Stop, ClipPath,
  Circle, Ellipse, G,
} from 'react-native-svg';

type Props = {
  size?: number;
};

export default function PlatinumCirclesLogo({ size = 64 }: Props) {
  const s = size / 100;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="pcSphere" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0%" stopColor="#F0F0F5" />
          <Stop offset="25%" stopColor="#D8DAE5" />
          <Stop offset="50%" stopColor="#E8EAF0" />
          <Stop offset="75%" stopColor="#B8BCC8" />
          <Stop offset="100%" stopColor="#9CA0B0" />
        </LinearGradient>
        <LinearGradient id="pcHighlight" x1="0.25" y1="0.05" x2="0.75" y2="0.95">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
          <Stop offset="40%" stopColor="#E0E2EC" stopOpacity="0.5" />
          <Stop offset="100%" stopColor="#C0C4D0" stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id="pcRing" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#C8CCD8" />
          <Stop offset="50%" stopColor="#E8EAF0" />
          <Stop offset="100%" stopColor="#A0A8B8" />
        </LinearGradient>
        <ClipPath id="pcClip">
          <Circle cx="50" cy="50" r="33" />
        </ClipPath>
      </Defs>

      {/* Orbit ring 1 */}
      <Ellipse
        cx="50" cy="50" rx="46" ry="12"
        fill="none" stroke="url(#pcRing)" strokeWidth="1.8"
        opacity="0.7" rotation="-25" origin="50,50"
      />
      {/* Orbit ring 2 */}
      <Ellipse
        cx="50" cy="50" rx="46" ry="12"
        fill="none" stroke="url(#pcRing)" strokeWidth="1.8"
        opacity="0.7" rotation="25" origin="50,50"
      />

      {/* Main sphere */}
      <Circle cx="50" cy="50" r="33" fill="url(#pcSphere)" />

      {/* Depth highlight */}
      <Circle cx="46" cy="46" r="33" fill="url(#pcHighlight)" clipPath="url(#pcClip)" />

      {/* Primary specular */}
      <Ellipse cx="40" cy="40" rx="14" ry="9" fill="white" opacity="0.5" />
      <Ellipse cx="41" cy="38" rx="7" ry="4.5" fill="white" opacity="0.65" />
      <Ellipse cx="42" cy="37" rx="3" ry="1.8" fill="white" opacity="0.8" />

      {/* Rim light */}
      <Circle cx="50" cy="50" r="32" fill="none" stroke="white" strokeWidth="0.8" opacity="0.25" />

      {/* Inner etched ring */}
      <Circle cx="50" cy="50" r="22" fill="none" stroke="#B8BCC8" strokeWidth="0.5" opacity="0.3" />

      {/* Bottom reflection */}
      <Ellipse cx="53" cy="68" rx="10" ry="3.5" fill="white" opacity="0.1" />
    </Svg>
  );
}