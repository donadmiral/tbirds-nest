/**
 * composerTheme.ts
 *
 * Bloom geometry, tool definitions, and touch target sizes.
 * Colors, motion, spacing, haptics come from constants/tokens and motionDualMemory.
 *
 * Tool definitions include: identity, geometry, priority, category,
 * accessibility, haptic feedback, and mode availability.
 *
 * The Layout tool is dual-mode-only: it reopens the arrangement overlay.
 * The Enhance tool is image/dual-mode-only: it opens cinematic AI enhancement.
 */
import { Dimensions } from 'react-native';
import { HAPTIC_PRESET } from '../../constants/motionDualMemory';

const SCREEN_W = Dimensions.get('window').width;

// ── BLOOM GEOMETRY ──
// Radius adapts to device width for consistent arc coverage.

export const BLOOM_RADIUS = SCREEN_W < 375 ? 76 : SCREEN_W > 414 ? 96 : 88;

// Angle tokens: named positions on the bloom arc (degrees, 0 = right, CCW)
const ARC_R3_TOP = 240;
const ARC_R3_MID = 210;
const ARC_R3_BOT = 180;
const ARC_R4_TOP = 250;
const ARC_R4_MID2 = 220;
const ARC_R4_MID3 = 190;
const ARC_R4_BOT = 160;
// 5-tool arc: wider spread for image+enhance and dual+enhance+layout
const ARC_R5_1 = 255;
const ARC_R5_2 = 230;
const ARC_R5_3 = 205;
const ARC_R5_4 = 180;
const ARC_R5_5 = 155;
const ARC_L3_TOP = 300;
const ARC_L3_MID = 330;
const ARC_L3_BOT = 0;
const ARC_L4_TOP = 290;
const ARC_L4_MID2 = 320;
const ARC_L4_MID3 = 350;
const ARC_L4_BOT = 20;
// 5-tool left arc
const ARC_L5_1 = 285;
const ARC_L5_2 = 310;
const ARC_L5_3 = 335;
const ARC_L5_4 = 0;
const ARC_L5_5 = 25;

// ── TOOL TYPE ──

export type BloomToolId = 'text' | 'sticker' | 'more' | 'layout' | 'enhance';
export type BloomCategory = 'creative' | 'layout' | 'interactive' | 'ai';

export interface BloomToolDef {
  readonly id: BloomToolId;
  readonly icon: string;
  readonly label: string;
  readonly angle: number;
  readonly priority: number;
  readonly category: BloomCategory;
  readonly accessibilityLabel: string;
  readonly haptic: string;
  readonly enabledInImage: boolean;
  readonly enabledInDual: boolean;
  readonly enabledInVideo: boolean;
  readonly enabledInText: boolean;
}

// ── TOOL DEFINITIONS ──
// Right-hand mode: + button bottom-right, tools bloom LEFT and UP.

// Image mode: 4 tools (text, sticker, enhance, more)
export const BLOOM_TOOLS_RIGHT: readonly BloomToolDef[] = [
  { id: 'text', icon: 'type', label: 'Text', angle: ARC_R4_TOP, priority: 1, category: 'creative', accessibilityLabel: 'Add text overlay', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: true, enabledInText: true },
  { id: 'sticker', icon: 'smile', label: 'Sticker', angle: ARC_R4_MID2, priority: 2, category: 'creative', accessibilityLabel: 'Add emoji sticker', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: true, enabledInText: true },
  { id: 'enhance', icon: 'sun', label: 'Enhance', angle: ARC_R4_MID3, priority: 3, category: 'ai', accessibilityLabel: 'AI enhance this moment', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: false, enabledInText: false },
  { id: 'more', icon: 'more-horizontal', label: 'More', angle: ARC_R4_BOT, priority: 4, category: 'interactive', accessibilityLabel: 'More creative tools', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: true, enabledInText: true },
] as const;

// Left-hand mode
export const BLOOM_TOOLS_LEFT: readonly BloomToolDef[] = [
  { id: 'text', icon: 'type', label: 'Text', angle: ARC_L4_TOP, priority: 1, category: 'creative', accessibilityLabel: 'Add text overlay', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: true, enabledInText: true },
  { id: 'sticker', icon: 'smile', label: 'Sticker', angle: ARC_L4_MID2, priority: 2, category: 'creative', accessibilityLabel: 'Add emoji sticker', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: true, enabledInText: true },
  { id: 'enhance', icon: 'sun', label: 'Enhance', angle: ARC_L4_MID3, priority: 3, category: 'ai', accessibilityLabel: 'AI enhance this moment', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: false, enabledInText: false },
  { id: 'more', icon: 'more-horizontal', label: 'More', angle: ARC_L4_BOT, priority: 4, category: 'interactive', accessibilityLabel: 'More creative tools', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: true, enabledInText: true },
] as const;

// Dual-mode: 5 tools (text, sticker, enhance, more, layout)
export const BLOOM_TOOLS_RIGHT_DUAL: readonly BloomToolDef[] = [
  { id: 'text', icon: 'type', label: 'Text', angle: ARC_R5_1, priority: 1, category: 'creative', accessibilityLabel: 'Add text overlay', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: false, enabledInText: false },
  { id: 'sticker', icon: 'smile', label: 'Sticker', angle: ARC_R5_2, priority: 2, category: 'creative', accessibilityLabel: 'Add emoji sticker', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: false, enabledInText: false },
  { id: 'enhance', icon: 'sun', label: 'Enhance', angle: ARC_R5_3, priority: 3, category: 'ai', accessibilityLabel: 'AI enhance this moment', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: false, enabledInText: false },
  { id: 'more', icon: 'more-horizontal', label: 'More', angle: ARC_R5_4, priority: 4, category: 'interactive', accessibilityLabel: 'More creative tools', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: false, enabledInText: false },
  { id: 'layout', icon: 'grid', label: 'Layout', angle: ARC_R5_5, priority: 5, category: 'layout', accessibilityLabel: 'Adjust memory layout', haptic: HAPTIC_PRESET, enabledInImage: false, enabledInDual: true, enabledInVideo: false, enabledInText: false },
] as const;

export const BLOOM_TOOLS_LEFT_DUAL: readonly BloomToolDef[] = [
  { id: 'text', icon: 'type', label: 'Text', angle: ARC_L5_1, priority: 1, category: 'creative', accessibilityLabel: 'Add text overlay', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: false, enabledInText: false },
  { id: 'sticker', icon: 'smile', label: 'Sticker', angle: ARC_L5_2, priority: 2, category: 'creative', accessibilityLabel: 'Add emoji sticker', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: false, enabledInText: false },
  { id: 'enhance', icon: 'sun', label: 'Enhance', angle: ARC_L5_3, priority: 3, category: 'ai', accessibilityLabel: 'AI enhance this moment', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: false, enabledInText: false },
  { id: 'more', icon: 'more-horizontal', label: 'More', angle: ARC_L5_4, priority: 4, category: 'interactive', accessibilityLabel: 'More creative tools', haptic: HAPTIC_PRESET, enabledInImage: true, enabledInDual: true, enabledInVideo: false, enabledInText: false },
  { id: 'layout', icon: 'grid', label: 'Layout', angle: ARC_L5_5, priority: 5, category: 'layout', accessibilityLabel: 'Adjust memory layout', haptic: HAPTIC_PRESET, enabledInImage: false, enabledInDual: true, enabledInVideo: false, enabledInText: false },
] as const;

// ── BLOOM SPRING CONFIGS ──
// Organic micro-variance per tool position for living feel.

export const BLOOM_OPEN_SPRINGS = [
  { damping: 13.5, stiffness: 160, mass: 0.8 },
  { damping: 14, stiffness: 160, mass: 0.8 },
  { damping: 14.5, stiffness: 160, mass: 0.8 },
  { damping: 15, stiffness: 160, mass: 0.8 },
  { damping: 15.5, stiffness: 160, mass: 0.8 },
];
export const BLOOM_CLOSE_SPRING = { damping: 18, stiffness: 200, mass: 0.8 };
export const BLOOM_STAGGERS = [50, 80, 115, 150, 185];

// ── TOUCH TARGETS ──

export const INVOKE_SIZE = 48;
export const BLOOM_TOOL_SIZE = 44;

// ── TOOL VISIBILITY RESOLVER ──

export type StoryMode = 'image' | 'video' | 'text' | 'dual';

export function getBloomTools(mode: StoryMode, handedness: 'right' | 'left' = 'right'): readonly BloomToolDef[] {
  const isDual = mode === 'dual';
  const base = handedness === 'right'
    ? (isDual ? BLOOM_TOOLS_RIGHT_DUAL : BLOOM_TOOLS_RIGHT)
    : (isDual ? BLOOM_TOOLS_LEFT_DUAL : BLOOM_TOOLS_LEFT);

  return [...base]
    .filter(tool => isToolVisible(tool, mode))
    .sort((a, b) => a.priority - b.priority);
}

function isToolVisible(tool: BloomToolDef, mode: StoryMode): boolean {
  switch (mode) {
    case 'image': return tool.enabledInImage;
    case 'dual': return tool.enabledInDual;
    case 'video': return tool.enabledInVideo;
    case 'text': return tool.enabledInText;
    default: return true;
  }
}
