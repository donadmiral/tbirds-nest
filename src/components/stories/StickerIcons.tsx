/**
 * StickerIcons - hand-drawn sticker tray glyphs.
 * One 24x24 grid, solid shapes, details knocked out in the tile colour
 * so each icon reads with weight instead of thin outlines.
 */
import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

export type StickerIconName =
  | 'poll' | 'question' | 'quiz' | 'slider'
  | 'mention' | 'location' | 'link' | 'emoji';

type Props = { name: StickerIconName; size?: number; color?: string; bg?: string };

export default function StickerIcon({ name, size = 22, color = '#FFFFFF', bg = '#141414' }: Props) {
  const p = { width: size, height: size, viewBox: '0 0 24 24' };

  switch (name) {
    case 'poll':
      return (
        <Svg {...p}>
          <Rect x="3.5" y="12" width="4.5" height="8.5" rx="1.6" fill={color} />
          <Rect x="9.75" y="6" width="4.5" height="14.5" rx="1.6" fill={color} />
          <Rect x="16" y="9.5" width="4.5" height="11" rx="1.6" fill={color} />
        </Svg>
      );
    case 'question':
      return (
        <Svg {...p}>
          <Path d="M5 3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-6l-4.6 4.1V18H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" fill={color} />
          <Path d="M9.4 8.6a2.6 2.6 0 1 1 3.4 2.5c-.9.35-1.3.9-1.3 1.8v.3" stroke={bg} strokeWidth="2" strokeLinecap="round" fill="none" />
          <Circle cx="11.5" cy="15.6" r="1.15" fill={bg} />
        </Svg>
      );
    case 'quiz':
      return (
        <Svg {...p}>
          <Rect x="3" y="3" width="18" height="18" rx="5.4" fill={color} />
          <Path d="M7.6 12.4l3 3 6-6.5" stroke={bg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      );
    case 'slider':
      return (
        <Svg {...p}>
          <Rect x="2.5" y="10.5" width="19" height="3" rx="1.5" fill={color} opacity="0.35" />
          <Rect x="2.5" y="10.5" width="11.5" height="3" rx="1.5" fill={color} />
          <Circle cx="14" cy="12" r="4.7" fill={color} />
          <Circle cx="14" cy="12" r="2" fill={bg} />
        </Svg>
      );
    case 'mention':
      return (
        <Svg {...p}>
          <Path d="M18.4 18.6A9 9 0 1 1 21 12v1.4a2.5 2.5 0 0 1-5 0V12" stroke={color} strokeWidth="2.1" strokeLinecap="round" fill="none" />
          <Circle cx="12" cy="12" r="3.7" stroke={color} strokeWidth="2.1" fill="none" />
        </Svg>
      );
    case 'location':
      return (
        <Svg {...p}>
          <Path d="M12 2.4c-4.2 0-7.6 3.3-7.6 7.3 0 5.4 6.7 11.2 7.2 11.6a.6.6 0 0 0 .8 0c.5-.4 7.2-6.2 7.2-11.6 0-4-3.4-7.3-7.6-7.3z" fill={color} />
          <Circle cx="12" cy="9.6" r="2.95" fill={bg} />
        </Svg>
      );
    case 'link':
      return (
        <Svg {...p}>
          <Path d="M10.2 13.8a4.6 4.6 0 0 0 6.5 0l2.6-2.6a4.6 4.6 0 0 0-6.5-6.5l-1.5 1.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <Path d="M13.8 10.2a4.6 4.6 0 0 0-6.5 0l-2.6 2.6a4.6 4.6 0 0 0 6.5 6.5l1.5-1.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </Svg>
      );
    case 'emoji':
    default:
      return (
        <Svg {...p}>
          <Circle cx="12" cy="12" r="9.3" fill={color} />
          <Circle cx="9" cy="10" r="1.5" fill={bg} />
          <Circle cx="15" cy="10" r="1.5" fill={bg} />
          <Path d="M7.9 14.1a4.7 4.7 0 0 0 8.2 0" stroke={bg} strokeWidth="2" strokeLinecap="round" fill="none" />
        </Svg>
      );
  }
}