"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { MemoryPage } from '@/lib/memoryAlbum';
import { memoryStoryLayerVisible, memoryStoryRecipe, memoryStoryStickers } from '../../../shared/memoryStoryPresentation';
import { StoryPixelGrade } from '../StoryPixelGrade';
import { storyPhotoSpatialAdjust } from '../../../shared/storyColorMatrix';
import { AdjustOverlay, BgLayer, DrawSvg, EngineSticker, STICKER_ANIM_CSS } from '../StoryEngine';
import { StoryStickerPreview } from '../StoryStickerPreview';

/** Replays the same saved layers as the story studio, with no interactive polls or media duplication. */
export function MemoryStoryFrame({ page, clock = null, layer = 'all', children }: {
  page: MemoryPage; clock?: number | null; layer?: 'all' | 'background' | 'overlay';
  children: (style: CSSProperties) => ReactNode;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(390);
  useEffect(() => {
    const node = root.current; if (!node) return;
    const measure = () => { if (node.clientWidth > 0) setWidth(node.clientWidth); };
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const observer = new ResizeObserver(measure); observer.observe(node); return () => observer.disconnect();
  }, []);
  const recipe = memoryStoryRecipe(page.media_transform);
  const stickers = memoryStoryStickers(page.stickers).filter(sticker => sticker.kind !== 'post' && memoryStoryLayerVisible(sticker, clock));
  const bg: any = page.text_background;
  const background = bg && typeof bg === 'object' ? bg.colors?.length > 1 ? `linear-gradient(${bg.direction === 'diagonal' ? '135deg' : '180deg'},${bg.colors.join(',')})` : bg.color || bg.colors?.[0] : typeof bg === 'string' && bg.startsWith('#') ? bg : null;
  return <div ref={root} className="relative h-full w-full overflow-hidden" style={{ background: layer === 'overlay' ? 'transparent' : background || '#0B1E3D' }}>
    <style>{STICKER_ANIM_CSS}</style>
    {layer !== 'overlay' && recipe.bg && recipe.fit === 'contain' && <BgLayer bg={recipe.bg as any} mediaUrl={page.media_type === 'image' ? page.media_url : null} />}
    {layer !== 'overlay' && <StoryPixelGrade className="relative h-full w-full" look={{ filterId: page.filter_id, filterAmt: recipe.filterAmt, adjust: recipe.adjust }}>{children({ objectFit: recipe.fit, transform: `translate(${recipe.x * 100}%, ${recipe.y * 100}%) scale(${recipe.scale})` })}</StoryPixelGrade>}
    {layer !== 'background' && <><AdjustOverlay adjust={storyPhotoSpatialAdjust(recipe.adjust)} />
    <DrawSvg stickers={stickers} />
    <div className="pointer-events-none absolute inset-0 z-[4]">{stickers.filter(sticker => sticker.kind !== 'drawing').map(sticker => {
      const cell = sticker.kind === 'photo' && sticker.photoShape === 'cell';
      return <div key={sticker.id} style={{ position: 'absolute', left: `${sticker.nx * 100}%`, top: `${sticker.ny * 100}%`, width: cell ? `${(sticker.photoFw || .4) * 100}%` : undefined, height: cell ? `${(sticker.photoFh || .3) * 100}%` : undefined, maxWidth: cell ? undefined : 332, transform: `translate(-50%,-50%) rotate(${sticker.rotation || 0}rad) scale(${(sticker.scale || 1) * (cell ? 1 : width / 390)})`, transformOrigin: 'center' }}>
        {['photo','gif','time','date','weather','entity'].includes(sticker.kind) ? <EngineSticker st={sticker} /> : <StoryStickerPreview sticker={sticker} />}
      </div>;
    })}</div></>}
  </div>;
}
