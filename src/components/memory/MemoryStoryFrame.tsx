import React, { useContext, useEffect, useId, useState } from 'react';
import { Dimensions, StyleSheet, View, type ViewStyle } from 'react-native';
import {Image} from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memoryStoryLayerVisible, memoryStoryRecipe, memoryStoryStickers } from '../../../shared/memoryStoryPresentation';
import StickerOverlay from '../stories/StickerOverlay';
import { DrawingLayer, type DrawStroke } from '../stories/DrawLayer';
import { FilterLayer } from '../stories/StoryFilters';
import { StoryPhotoLookContext, StoryPhotoReadinessContext } from '../stories/StoryPixelImage';
import { storyVideoPreviewAvailable } from '../../../modules/boomerang/storyComposition';
import { storyPhotoSpatialAdjust } from '../../../shared/storyColorMatrix';
import { AdjustLayer, BackgroundLayer, type StoryBg } from '../stories/storyPanels';

export type MemoryStoryPage = {
  media_transform?: unknown; filter_id?: string | null; stickers?: unknown;
  media_url?: string | null; media_type?: string; duration_sec?: number | null;
  text_background?: unknown;
};

/** Keep the author's layers with the media, including in the enlarged reader. */
export default function MemoryStoryFrame({ page, clock = null, layer='all', exporting=false, children }: {
  page?: MemoryStoryPage | null; clock?: number | null;layer?:'all'|'background'|'overlay';exporting?:boolean;
  children: (presentation: { fit: 'cover' | 'contain'; style: ViewStyle }) => React.ReactNode;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const recipe = memoryStoryRecipe(page?.media_transform);
  const sourceStickers = memoryStoryStickers(page?.stickers);
  const photo = page?.media_type === 'image' || !page?.media_url && sourceStickers.some(sticker => sticker.kind === 'post' && sticker.postMediaUrl && sticker.postMediaType !== 'video');
  const stickers = sourceStickers.filter(sticker => sticker.kind !== 'post' && memoryStoryLayerVisible(sticker, clock));
  const scale = size.width / Dimensions.get('window').width;
  const bg=page?.text_background,object=bg&&typeof bg==='object'?bg as {color?:unknown;colors?:unknown;direction?:unknown}:null;
  const colors=Array.isArray(object?.colors)?object.colors.filter((color):color is string=>typeof color==='string'):[];
  const background = typeof object?.color==='string'?object.color:colors[0]??(typeof bg==='string'&&bg.startsWith('#')?bg:null);
  const authoredBg=recipe.bg as StoryBg|null;
  return <View style={{ flex: 1, overflow: 'hidden', backgroundColor: layer==='overlay'?'transparent':background || '#0B1E3D' }}
    onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(old => old.width === width && old.height === height ? old : { width, height }); }}>
    {layer!=='overlay'&&<>{colors.length>=2&&<LinearGradient colors={[colors[0],colors[1]]} start={object?.direction === 'diagonal' ? { x: 0, y: 0 } : { x: .5, y: 0 }} end={object?.direction === 'diagonal' ? { x: 1, y: 1 } : { x: .5, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />}
    {authoredBg && (recipe.fit === 'contain' || !page?.media_url) && (exporting&&authoredBg.kind==='blur'&&page?.media_type==='image'&&page.media_url?<MemoryExportBlur uri={page.media_url}/>:<BackgroundLayer bg={authoredBg} mediaUrl={page?.media_type === 'image' ? page.media_url : null} />)}
    <StoryPhotoLookContext.Provider value={photo || storyVideoPreviewAvailable ? { adjust: recipe.adjust, filterId: page?.filter_id, filterAmt: recipe.filterAmt } : null}>{children({ fit: recipe.fit, style: { ...StyleSheet.absoluteFillObject, transform: [{ translateX: recipe.x * size.width }, { translateY: recipe.y * size.height }, { scale: recipe.scale }] } })}</StoryPhotoLookContext.Provider></>}
    {layer!=='background'&&<>{!photo && !storyVideoPreviewAvailable && !exporting && <FilterLayer filterId={page?.filter_id ?? null} amt={recipe.filterAmt} zIndex={1} />}
    <AdjustLayer adjust={photo || storyVideoPreviewAvailable || exporting ? storyPhotoSpatialAdjust(recipe.adjust) : recipe.adjust} zIndex={2} />
    <DrawingLayer strokes={stickers.find(sticker => sticker.kind === 'drawing')?.strokes?.map((stroke: DrawStroke) => ({ ...stroke, width: stroke.width * scale })) ?? null} width={size.width} height={size.height} zIndex={3} />
    <StickerOverlay stickers={stickers.map(sticker => ({ ...sticker, scale: (sticker.scale ?? 1) * (sticker.kind === 'photo' && sticker.photoShape === 'cell' ? 1 : scale) }))} containerW={size.width} containerH={size.height} interactive={false} storyPaused clockSec={clock} />
    </>}
  </View>;
}

function MemoryExportBlur({uri}:{uri:string}){
 const report=useContext(StoryPhotoReadinessContext),id=useId();
 useEffect(()=>{report?.(id,'loading');return()=>report?.(id,'removed');},[uri,id,report]);
 return <Image source={{uri}} cachePolicy="none" style={[StyleSheet.absoluteFill,{opacity:.22}]} contentFit="cover" blurRadius={35} transition={0} onLoad={()=>report?.(id,'ready')} onError={()=>report?.(id,'error')}/>;
}
