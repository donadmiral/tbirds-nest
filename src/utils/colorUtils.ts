/**
 * Determine if a hex color is light (for choosing text contrast).
 * Extracted from StoryComposerScreen + StoryViewerScreen (identical in both).
 */
export function isColorLight(hex: string): boolean {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

/**
 * Get initials from a display name.
 * Extracted from StoryViewerScreen + StoryStrip (identical in both).
 */
export function initials(name?: string | null): string {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}