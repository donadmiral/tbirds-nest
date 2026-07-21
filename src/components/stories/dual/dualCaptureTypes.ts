/**
 * dualCaptureTypes.ts
 * Shared types for the Dual Camera Story System.
 */

export type DualLayout =
  | 'pip_front_small'
  | 'pip_rear_small'
  | 'split_vertical'
  | 'split_horizontal'
  | 'floating_bubble';

export interface LayoutConfig {
  mode: DualLayout;
  primaryCamera: 'front' | 'rear';
  bubblePosition: { nx: number; ny: number };
  bubbleSize: { width: number; height: number };
  bubbleCornerRadius: number;
  splitRatio: number;
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  mode: 'pip_front_small',
  primaryCamera: 'rear',
  bubblePosition: { nx: 0.05, ny: 0.06 },
  bubbleSize: { width: 120, height: 160 },
  bubbleCornerRadius: 28,
  splitRatio: 0.5,
};

export type CaptureMode = 'photo' | 'video';

export type CaptureState =
  | 'INITIALIZING'
  | 'READY'
  | 'CAPTURING_PHOTO'
  | 'RECORDING'
  | 'STOPPING'
  | 'PROCESSING'
  | 'COMPLETE'
  | 'ERROR';

export interface DualCaptureSync {
  frontReady: boolean;
  rearReady: boolean;
  recordingStartTime: number | null;
  frontFile: string | null;
  rearFile: string | null;
}

export interface DualCaptureAsset {
  frontUri: string;
  rearUri: string;
  frontType: 'image' | 'video';
  rearType: 'image' | 'video';
  layout: LayoutConfig;
  frontDimensions: { width: number; height: number };
  rearDimensions: { width: number; height: number };
  durationSec?: number;
  capturedAt: number;
}

export const DUAL_VIDEO_LIMIT_SEC = 30;
export const DUAL_MIN_DISK_MB = 500;