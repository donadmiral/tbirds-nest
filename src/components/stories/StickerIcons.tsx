/**
 * StickerIcons - hand-drawn sticker tray glyphs.
 * One 24x24 grid, solid shapes, details knocked out in the tile colour
 * so each icon reads with weight instead of thin outlines.
 */
import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

export type StickerIconName =
  | 'poll' | 'question' | 'quiz' | 'slider'
  | 'mention' | 'location' | 'link' | 'emoji' | 'hashtag' | 'music' | 'filter' | 'countdown'
  | 'gif' | 'photo' | 'time' | 'date' | 'weather' | 'entity' | 'draw' | 'adjust' | 'trim' | 'mix' | 'bg' | 'preview' | 'save';

type Props = { name: StickerIconName; size?: number; color?: string; bg?: string };

export default function StickerIcon({ name, size = 22, color = '#FFFFFF', bg = '#141414' }: Props) {
  const p = { width: size, height: size, viewBox: '0 0 24 24' };

  switch (name) {
    case 'countdown':
      return (
        <Svg {...p}>
          <Circle cx="12" cy="13" r="8.5" fill={color} />
          <Path d="M12 9v4.2l2.8 1.8" stroke={bg} strokeWidth="2" strokeLinecap="round" fill="none" />
          <Path d="M9.5 3h5" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
        </Svg>
      );
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
    case 'music':
      return (
        <Svg {...p}>
          <Path d="M9.3 6.2l10-2.1V14" stroke={color} strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <Circle cx="6.9" cy="17" r="3.1" fill={color} />
          <Circle cx="16.9" cy="14.4" r="3.1" fill={color} />
        </Svg>
      );
    case 'filter':
      return (
        <Svg {...p}>
          <Path d="M12 2.6s6.6 7.2 6.6 11.6a6.6 6.6 0 0 1-13.2 0C5.4 9.8 12 2.6 12 2.6z" fill={color} />
          <Path d="M9.1 14.6a3.2 3.2 0 0 0 2.6 3" stroke={bg} strokeWidth="1.9" strokeLinecap="round" fill="none" />
        </Svg>
      );
    case 'hashtag':
      return (
        <Svg {...p}>
          <Rect x="3" y="3" width="18" height="18" rx="5.4" fill={color} />
          <Path d="M9.4 7.6l-1.5 8.8M16.1 7.6l-1.5 8.8M7.3 10.5h9.8M6.9 13.9h9.8" stroke={bg} strokeWidth="1.9" strokeLinecap="round" fill="none" />
        </Svg>
      );
    case 'gif':
      return (<Svg {...p}><Rect x="3" y="6" width="18" height="12" rx="3" stroke={color} strokeWidth="2" fill="none" /><Path d="M7.5 10.5v3M10.5 9.5v5M13.5 9.5h3M13.5 12h2.2M13.5 9.5v5" stroke={color} strokeWidth="1.7" strokeLinecap="round" fill="none" /></Svg>);
    case 'photo':
      return (<Svg {...p}><Rect x="4" y="4" width="16" height="16" rx="3.5" stroke={color} strokeWidth="2" fill="none" /><Circle cx="9" cy="9.5" r="1.6" fill={color} /><Path d="M5 17l4.2-4.2 3 3 2.6-2.6L19 17" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></Svg>);
    case 'time':
      return (<Svg {...p}><Circle cx="12" cy="12" r="8.4" stroke={color} strokeWidth="2" fill="none" /><Path d="M12 7.6V12l3 2" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" /></Svg>);
    case 'date':
      return (<Svg {...p}><Rect x="4" y="5.5" width="16" height="14" rx="3" stroke={color} strokeWidth="2" fill="none" /><Path d="M4 10h16M8.5 3.8v3M15.5 3.8v3" stroke={color} strokeWidth="2" strokeLinecap="round" /></Svg>);
    case 'weather':
      return (<Svg {...p}><Circle cx="9" cy="10" r="3.4" stroke={color} strokeWidth="2" fill="none" /><Path d="M9 4.4v-1.6M4.4 10H2.8M5.7 6.7L4.6 5.6M14 15.5a4 4 0 1 1 3.4 6H8.6a3.2 3.2 0 1 1 .9-6.3A4.6 4.6 0 0 1 14 15.5z" stroke={color} strokeWidth="1.8" strokeLinecap="round" fill="none" /></Svg>);
    case 'entity':
      return (<Svg {...p}><Path d="M12 3l2.5 5.3 5.8.6-4.3 3.9 1.2 5.7L12 15.6l-5.2 2.9 1.2-5.7-4.3-3.9 5.8-.6z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" fill="none" /></Svg>);
    case 'draw':
      return (<Svg {...p}><Path d="M4 20c3.4-.6 4.6-1.6 5.4-3.4L18 8l-2-2-8.6 8.6C5.6 15.4 4.6 16.6 4 20z" stroke={color} strokeWidth="2" strokeLinejoin="round" fill="none" /><Path d="M15 5l4 4" stroke={color} strokeWidth="2" strokeLinecap="round" /></Svg>);
    case 'adjust':
      return (<Svg {...p}><Path d="M5 6h14M5 12h14M5 18h14" stroke={color} strokeWidth="2" strokeLinecap="round" /><Circle cx="9" cy="6" r="2" fill={color} /><Circle cx="15" cy="12" r="2" fill={color} /><Circle cx="8" cy="18" r="2" fill={color} /></Svg>);
    case 'trim':
      return (<Svg {...p}><Circle cx="7" cy="7.5" r="2.4" stroke={color} strokeWidth="2" fill="none" /><Circle cx="7" cy="16.5" r="2.4" stroke={color} strokeWidth="2" fill="none" /><Path d="M9 9l11 7.5M9 15l11-7.5" stroke={color} strokeWidth="2" strokeLinecap="round" /></Svg>);
    case 'mix':
      return (<Svg {...p}><Path d="M5 9.5a7 7 0 0 1 14 0M5 9.5v5a2 2 0 0 0 2 2h1v-6H5zM19 9.5v5a2 2 0 0 1-2 2h-1v-6h3z" stroke={color} strokeWidth="2" strokeLinejoin="round" fill="none" /></Svg>);
    case 'bg':
      return (<Svg {...p}><Rect x="4" y="4" width="16" height="16" rx="3.5" stroke={color} strokeWidth="2" fill="none" /><Rect x="8.4" y="8.4" width="7.2" height="7.2" rx="1.6" fill={color} /></Svg>);
    case 'preview':
      return (<Svg {...p}><Path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" stroke={color} strokeWidth="2" strokeLinejoin="round" fill="none" /><Circle cx="12" cy="12" r="2.6" fill={color} /></Svg>);
    case 'save':
      return (<Svg {...p}><Path d="M12 4v10M12 14l-3.6-3.6M12 14l3.6-3.6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /><Path d="M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" /></Svg>);
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