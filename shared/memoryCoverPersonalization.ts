import type {MemoryCoverArtwork, MemoryCoverStroke} from './memoryBookCreative';
import {memoryCoverMedia, type MemoryCoverPage} from './memoryBookDesign';

/** Source IDs are resolved only against pages returned by the authorized reader. */
export function memoryCoverSelectedPages(artwork: MemoryCoverArtwork, pages: readonly MemoryCoverPage[]): MemoryCoverPage[] {
  if (artwork.version !== 2 || !artwork.storyIds.length) return [];
  const byId = new Map(pages.filter(page => page.story_id).map(page => [page.story_id!.toLowerCase(), page]));
  return artwork.storyIds.map(id => byId.get(id)).filter((page): page is MemoryCoverPage => !!page);
}

export function memoryCoverSources(artwork: MemoryCoverArtwork, pages: readonly MemoryCoverPage[]) {
  return memoryCoverSelectedPages(artwork, pages).map(memoryCoverMedia);
}

export type MemoryCoverCell = {left: number; top: number; width: number; height: number};
/** Percentages allow the same collage to render on the shelf and in the editor. */
export function memoryCoverCollageCells(count: number): MemoryCoverCell[] {
  if (count <= 1) return [{left: 0, top: 0, width: 100, height: 100}];
  if (count === 2) return [{left: 0, top: 0, width: 50, height: 100}, {left: 50, top: 0, width: 50, height: 100}];
  if (count === 3) return [{left: 0, top: 0, width: 58, height: 100}, {left: 58, top: 0, width: 42, height: 50}, {left: 58, top: 50, width: 42, height: 50}];
  return [{left: 0, top: 0, width: 50, height: 50}, {left: 50, top: 0, width: 50, height: 50}, {left: 0, top: 50, width: 50, height: 50}, {left: 50, top: 50, width: 50, height: 50}];
}

export function memoryCoverScaledStrokes(strokes: readonly MemoryCoverStroke[], width: number): MemoryCoverStroke[] {
  return strokes.map(stroke => ({...stroke, width: stroke.width * width / 200}));
}

export function memoryCoverStrokePath(points: MemoryCoverStroke['points'], width: number, height: number): string {
  if (!points.length) return '';
  let path = `M ${points[0].x * width} ${points[0].y * height}`;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1], current = points[index];
    path += ` Q ${previous.x * width} ${previous.y * height} ${(previous.x + current.x) * width / 2} ${(previous.y + current.y) * height / 2}`;
  }
  const last = points[points.length - 1];
  return path + ` L ${last.x * width} ${last.y * height}`;
}
