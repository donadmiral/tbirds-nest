import React, { useState } from 'react';
import { Dimensions, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { memoryStoryLayerVisible, memoryStoryRecipe, memoryStoryStickers } from '../../../shared/memoryStoryPresentation';
import StickerOverlay from '../stories/StickerOverlay';
import { DrawingLayer } from '../stories/DrawLayer';
import { FilterLayer } from '../stories/StoryFilters';
import { AdjustLayer, BackgroundLayer } from '../stories/storyPanels';

export type MemoryStoryPage = {
  media_transform?: unknown; filter_id?: string | null; stickers?: unknown;
  media_url?: string | null; media_type?: string; duration_sec?: number | null;
  text_background?: unknown;
};

/** Keep the author's layers with the media, including in the enlarged reader. */
export default function MemoryStoryFrame({ page, clock = null, children }: {
  page?: MemoryStoryPage | null; clock?: number | null;
  children: (presentation: { fit: 'cover' | 'contain'; style: ViewStyle }) => React.ReactNode;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const recipe = memoryStoryRecipe(page?.media_transform);
  const stickers = memoryStoryStickers(page?.stickers).filter(sticker => sticker.kind !== 'post' && memoryStoryLayerVisible(sticker, clock));
  const scale = size.width / Dimensions.get('window').width;
  const bg: any = page?.text_background;
  const background = bg && typeof bg === 'object' ? bg.color || bg.colors?.[0] : typeof bg === 'string' && bg.startsWith('#') ? bg : null;
  return <View style={{ flex: 1, overflow: 'hidden', backgroundColor: background || '#0B1E3D' }}
    onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(old => old.width === width && old.height === height ? old : { width, height }); }}>
    {Array.isArray(bg?.colors) && bg.colors.length >= 2 && <LinearGradient colors={[bg.colors[0], bg.colors[1]]} start={bg.direction === 'diagonal' ? { x: 0, y: 0 } : { x: .5, y: 0 }} end={bg.direction === 'diagonal' ? { x: 1, y: 1 } : { x: .5, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />}
    {recipe.bg && recipe.fit === 'contain' && <BackgroundLayer bg={recipe.bg as any} mediaUrl={page?.media_type === 'image' ? page.media_url : null} />}
    {children({ fit: recipe.fit, style: { ...StyleSheet.absoluteFillObject, transform: [{ translateX: recipe.x * size.width }, { translateY: recipe.y * size.height }, { scale: recipe.scale }] } })}
    <FilterLayer filterId={page?.filter_id ?? null} amt={recipe.filterAmt} zIndex={1} />
    <AdjustLayer adjust={recipe.adjust} zIndex={2} />
    <DrawingLayer strokes={stickers.find(sticker => sticker.kind === 'drawing')?.strokes?.map((stroke: any) => ({ ...stroke, width: stroke.width * scale })) ?? null} width={size.width} height={size.height} zIndex={3} />
    <StickerOverlay stickers={stickers.map(sticker => ({ ...sticker, scale: (sticker.scale ?? 1) * (sticker.kind === 'photo' && sticker.photoShape === 'cell' ? 1 : scale) }))} containerW={size.width} containerH={size.height} interactive={false} storyPaused clockSec={clock} />
  </View>;
}
