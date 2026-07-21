/**
 * dualMemoryTransform.ts
 *
 * Canonical transform types for the dual memory system.
 * Every controller reads from and writes to these shapes.
 * No parallel transform state anywhere in the codebase.
 */

export interface BubbleTransform {
  /** Horizontal position in pixels, center-anchored */
  x: number;
  /** Vertical position in pixels, center-anchored */
  y: number;
  /** Scale multiplier. 1.0 = base size (150×200) */
  scale: number;
}

export interface DualLayout {
  mode: 'pip_front_small';
  primaryCamera: 'front' | 'rear';
  bubble: BubbleTransform;
  presetId: string | null;
}
