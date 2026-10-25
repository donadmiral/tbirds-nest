export const clampStoryPosition = (n: number) => Math.min(.95, Math.max(.05, Number.isFinite(n) ? n : .5));

/** Preserve the grab offset and snap within eight display pixels of centre. */
export function moveStorySticker(start: { nx: number; ny: number }, deltaX: number, deltaY: number, width: number, height: number) {
  const nx = clampStoryPosition(start.nx + deltaX / Math.max(width, 1));
  const ny = clampStoryPosition(start.ny + deltaY / Math.max(height, 1));
  const vertical = Math.abs(nx - .5) * width <= 8 + 1e-6;
  const horizontal = Math.abs(ny - .5) * height <= 8 + 1e-6;
  return { nx: vertical ? .5 : nx, ny: horizontal ? .5 : ny, vertical, horizontal };
}

/** Labels and interaction payloads must change together in saved drafts. */
export function storyStickerLabel(kind: string | undefined, text: string): Record<string, string> {
  const patch: Record<string, string> = { text };
  const field: Record<string, string> = { question: 'questionPrompt', quiz: 'quizQuestion', slider: 'sliderLabel', countdown: 'countdownTitle', addyours: 'addYoursPrompt', location: 'locationName', hashtag: 'hashtag' };
  if (kind && field[kind]) patch[field[kind]] = kind === 'hashtag' ? text.replace(/^#/, '') : text;
  if (kind === 'location') patch.locationDisplayName = text;
  return patch;
}
