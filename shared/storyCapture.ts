export type StoryCaptureAsset = {
  uri?: string; localUri?: string; type?: string | null; mediaType?: string | null;
  width?: number; height?: number; duration?: number | null; durationSec?: number | null; filterId?: string | null;
};

/** A batch can contain both photos and videos. The first item never sets the type of the rest. */
export function normalizeStoryCapture(asset: StoryCaptureAsset, fallback = 'image') {
  const uri = asset.localUri || asset.uri || '';
  const explicit = asset.mediaType || asset.type;
  const video = explicit ? explicit === 'video' : /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i.test(uri) || fallback === 'video';
  const duration = asset.durationSec ?? (asset.duration != null ? asset.duration / 1000 : null);
  return {
    localUri: uri,
    mediaType: video ? 'video' as const : 'image' as const,
    width: asset.width || 0,
    height: asset.height || 0,
    durationSec: video && duration != null && Number.isFinite(duration) ? Math.max(.25, duration) : null,
    filterId: asset.filterId || null,
  };
}

export const STORY_CAPTURE_VIDEO_QUALITY = '1080p' as const;
export const STORY_CAPTURE_VIDEO_BITRATE = 8_000_000;
export const STORY_CLIP_LIMIT = 10;
