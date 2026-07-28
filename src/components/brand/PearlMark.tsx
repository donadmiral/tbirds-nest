/**
 * PearlMark - The Setting.
 * The brand mark: a pearl set in a platinum ring. Static vector, no filters,
 * so it renders identically everywhere react-native-svg does.
 */
import React from 'react';
import Svg, { Circle, Ellipse, Path, Defs, RadialGradient, LinearGradient, Stop, G } from 'react-native-svg';

export default function PearlMark({ size = 96 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Defs>
        <RadialGradient id="pmBody" cx="36%" cy="30%" r="85%">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.32" stopColor="#F0F1F7" />
          <Stop offset="0.6" stopColor="#D9DDE8" />
          <Stop offset="0.84" stopColor="#BCC2D2" />
          <Stop offset="1" stopColor="#A2A9BC" />
        </RadialGradient>
        <RadialGradient id="pmRose" cx="30%" cy="72%" r="55%">
          <Stop offset="0" stopColor="#F3D9DF" stopOpacity="0.5" />
          <Stop offset="1" stopColor="#F3D9DF" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="pmBlue" cx="74%" cy="30%" r="60%">
          <Stop offset="0" stopColor="#D6E4F4" stopOpacity="0.45" />
          <Stop offset="1" stopColor="#D6E4F4" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="pmSpec" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <Stop offset="0.6" stopColor="#FFFFFF" stopOpacity="0.35" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id="pmRing" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F5F0E8" />
          <Stop offset="0.5" stopColor="#C9BFB0" />
          <Stop offset="1" stopColor="#A89F91" />
        </LinearGradient>
      </Defs>
      <G rotation={-18} origin="512, 512">
        <Path d="M 96 512 A 416 216 0 0 1 928 512" fill="none" stroke="url(#pmRing)" strokeWidth={24} opacity={0.5} />
      </G>
      <Circle cx={512} cy={512} r={280} fill="url(#pmBody)" />
      <Circle cx={512} cy={512} r={280} fill="url(#pmRose)" />
      <Circle cx={512} cy={512} r={280} fill="url(#pmBlue)" />
      <Ellipse cx={424} cy={392} rx={110} ry={66} fill="url(#pmSpec)" />
      <G rotation={-18} origin="512, 512">
        <Path d="M 96 512 A 416 216 0 0 0 928 512" fill="none" stroke="url(#pmRing)" strokeWidth={30} />
        <Path d="M 300 700 A 416 216 0 0 0 620 726" fill="none" stroke="#F5F0E8" strokeWidth={13} strokeLinecap="round" opacity={0.95} />
      </G>
    </Svg>
  );
}