"use client";
import { createContext, useContext, useId, type CSSProperties, type ReactNode } from 'react';
import { hasStoryPhotoLook, storyPhotoColorMatrix, type StoryPhotoLook } from '../../shared/storyColorMatrix';

export const StoryPhotoLookContext = createContext<StoryPhotoLook | null>(null);
/** SVG and Skia apply the same sRGB matrix to the pixels, not a translucent veil. */
export function StoryPixelGrade({ children, look: explicit, style, className }: { children: ReactNode; look?: StoryPhotoLook | null; style?: CSSProperties; className?: string }) {
  const inherited = useContext(StoryPhotoLookContext), id = 'story-grade-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const look = explicit === undefined ? inherited : explicit;
  if (!hasStoryPhotoLook(look)) return <div className={className} style={style}>{children}</div>;
  return <><svg aria-hidden width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}><defs><filter id={id} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={storyPhotoColorMatrix(look).join(' ')} /></filter></defs></svg><div className={className} style={{ ...style, filter: `url(#${id})` }}>{children}</div></>;
}
