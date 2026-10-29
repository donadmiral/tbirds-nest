type PostGeometry = { nx: number; ny: number; scale: number; rotation: number };

export const samePostGeometry = (a: PostGeometry, b: PostGeometry) =>
  (['nx', 'ny', 'scale', 'rotation'] as const).every(key => Math.abs(a[key] - b[key]) < 0.00001);

/** Fit a fresh card, including its caption and footer, between measured controls. */
export function fitStoryEditorPost(input: {
  stageWidth: number; stageHeight: number; cardWidth: number; cardHeight: number;
  top: number; bottom: number;
}): PostGeometry | null {
  const { stageWidth, stageHeight, cardWidth, cardHeight } = input;
  if (![stageWidth, stageHeight, cardWidth, cardHeight, input.top, input.bottom].every(Number.isFinite)
    || Math.min(stageWidth, stageHeight, cardWidth, cardHeight) <= 0) return null;
  const clearance = 12;
  const top = Math.max(0, input.top) + clearance;
  const bottom = Math.min(stageHeight, input.bottom) - clearance;
  const width = stageWidth - clearance * 2;
  if (bottom <= top || width <= 0) return null;
  const scale = Math.min(1, width / cardWidth, (bottom - top) / cardHeight);
  const halfHeight = cardHeight * scale / 2;
  const centerY = Math.max(top + halfHeight, Math.min(stageHeight / 2, bottom - halfHeight));
  return { nx: 0.5, ny: centerY / stageHeight, scale, rotation: 0 };
}
