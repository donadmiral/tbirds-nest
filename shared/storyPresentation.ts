/** Geometry shared by the native and web story renderers. No media is cropped. */
export function sharedPostFrame(input: {
  stageWidth: number; stageHeight: number; mediaWidth?: number | null; mediaHeight?: number | null;
  caption?: string | null; title?: string | null; hasMedia?: boolean;
}) {
  const stageWidth = Math.max(160, input.stageWidth || 390);
  const stageHeight = Math.max(320, input.stageHeight || 844);
  const ratio = input.mediaWidth && input.mediaHeight && input.mediaWidth > 0 && input.mediaHeight > 0
    ? Math.max(.2, Math.min(5, input.mediaWidth / input.mediaHeight)) : .8;
  const captionLines = input.caption ? Math.min(3, Math.max(1, Math.ceil(input.caption.length / 36))) : 0;
  const titleLines = input.title ? Math.min(2, Math.max(1, Math.ceil(input.title.length / 34))) : 0;
  const captionHeight = (captionLines + titleLines) * 22 + (captionLines || titleLines ? 14 : 0);
  const footerHeight = 54;
  const maxHeight = Math.max(140, stageHeight - 210 - captionHeight - footerHeight);
  const width = input.hasMedia === false ? Math.min(stageWidth * .9, 440) : Math.min(stageWidth * .9, 440, maxHeight * ratio);
  const mediaHeight = input.hasMedia === false ? 0 : width / ratio;
  return { width, mediaHeight, captionHeight, height: captionHeight + mediaHeight + footerHeight };
}

/** A timed layer is always at least a quarter second and stays inside its clip. */
export function storyLayerWindow(start: number | null | undefined, end: number | null | undefined, duration: number) {
  const limit = Math.max(.25, Number.isFinite(duration) ? duration : 15);
  const from = Math.max(0, Math.min(limit - .25, typeof start === 'number' && Number.isFinite(start) ? start : 0));
  const to = Math.max(from + .25, Math.min(limit, typeof end === 'number' && Number.isFinite(end) ? end : limit));
  return { start: Math.round(from * 100) / 100, end: Math.round(to * 100) / 100 };
}
