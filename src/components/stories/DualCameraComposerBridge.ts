/**
 * DualCameraComposerBridge.ts
 * Prepares dual-captured media for handoff to StoryComposerScreen.
 */
import { Image } from 'react-native';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import type { DualCaptureAsset, LayoutConfig, CaptureMode } from './dual/dualCaptureTypes';
import { DEFAULT_LAYOUT } from './dual/dualCaptureTypes';

interface CapturedMedia {
  frontPath: string;
  rearPath: string;
  mode: CaptureMode;
  layout: LayoutConfig;
  durationSec?: number;
}

export function normalizeCaptureUri(uri: string): string {
  if (!uri?.trim()) throw new Error('The captured media file is missing.');
  return /^[a-z][a-z0-9+.-]*:/i.test(uri) ? uri : `file://${uri}`;
}

function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      normalizeCaptureUri(uri),
      (width, height) => resolve({ width, height }),
      () => reject(new Error('The captured photo could not be opened. Please capture it again.')),
    );
  });
}

export async function prepareDualAsset(media: CapturedMedia): Promise<DualCaptureAsset> {
  const frontUri = normalizeCaptureUri(media.frontPath);
  const rearUri = normalizeCaptureUri(media.rearPath);

  const [frontDim, rearDim] = await Promise.all([
    getImageDimensions(frontUri),
    media.mode === 'photo' ? getImageDimensions(rearUri) : getThumbnailAsync(rearUri, { time: 0, quality: .1 }).then(({ width, height }) => ({ width, height })),
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
    ...(extraParams || {}),
    mode: 'dual',
    assets: [asset],
  };
}