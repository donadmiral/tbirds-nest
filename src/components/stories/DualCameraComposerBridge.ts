/**
 * DualCameraComposerBridge.ts
 * Prepares dual-captured media for handoff to StoryComposerScreen.
 */
import { Image } from 'react-native';
import type { DualCaptureAsset, LayoutConfig, CaptureMode } from './dual/dualCaptureTypes';
import { DEFAULT_LAYOUT } from './dual/dualCaptureTypes';

interface CapturedMedia {
  frontPath: string;
  rearPath: string;
  mode: CaptureMode;
  layout: LayoutConfig;
  durationSec?: number;
}

function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    Image.getSize(
      uri.startsWith('file://') ? uri : `file://${uri}`,
      (width, height) => resolve({ width, height }),
      () => resolve({ width: 0, height: 0 }),
    );
  });
}

export async function prepareDualAsset(media: CapturedMedia): Promise<DualCaptureAsset> {
  const frontUri = media.frontPath.startsWith('file://') ? media.frontPath : `file://${media.frontPath}`;
  const rearUri = media.rearPath.startsWith('file://') ? media.rearPath : `file://${media.rearPath}`;

  const [frontDim, rearDim] = await Promise.all([
    getImageDimensions(frontUri),
    media.mode === 'photo' ? getImageDimensions(rearUri) : Promise.resolve({ width: 1920, height: 1080 }),
  ]);

  return {
    frontUri,
    rearUri,
    frontType: 'image',
    rearType: media.mode === 'photo' ? 'image' : 'video',
    layout: media.layout || DEFAULT_LAYOUT,
    frontDimensions: frontDim,
    rearDimensions: rearDim,
    durationSec: media.durationSec,
    capturedAt: Date.now(),
  };
}

export function buildComposerParams(asset: DualCaptureAsset, extraParams?: Record<string, any>) {
  return {
    mode: 'dual',
    assets: [asset],
    ...(extraParams || {}),
  };
}