import type { CSSProperties } from 'react';
import { storyAdjustmentLayers, type StoryAdjust } from '../../shared/storyAdjustAppearance';
export type { StoryAdjust } from '../../shared/storyAdjustAppearance';

export function AdjustOverlay({ adjust }: { adjust: StoryAdjust | null | undefined }) {
  const layers = storyAdjustmentLayers(adjust);
  if (!layers.length) return null;
  return <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}>
    {layers.map((layer, index) => <div key={index} style={layer as CSSProperties} />)}
  </div>;
}
