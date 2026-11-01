import React, {useEffect, useRef, useState} from 'react';
import {View, Text, TouchableOpacity, ScrollView, PanResponder, StyleSheet, useWindowDimensions} from 'react-native';
import {Image} from 'expo-image';
import {Feather} from '@expo/vector-icons';
import {useTheme} from '../../theme/useTheme';
import {DrawingLayer} from '../stories/DrawLayer';
import VideoThumb from '../VideoThumb';
import MemoryBookCover, {type MemoryBookCoverProps} from './MemoryBookCover';
import {memoryCoverMedia, type MemoryCoverPage} from '../../../shared/memoryBookDesign';
import {
  personalizeMemoryCover, MEMORY_COVER_DRAWING_COLORS, MEMORY_COVER_MAX_PHOTOS,
  MEMORY_COVER_MAX_STROKES, MEMORY_COVER_MAX_POINTS, MEMORY_COVER_MAX_STROKE_POINTS,
  type MemoryCoverArtwork, type MemoryCoverStroke,
} from '../../../shared/memoryBookCreative';
import {memoryCoverScaledStrokes} from '../../../shared/memoryCoverPersonalization';

type Props = Omit<MemoryBookCoverProps, 'artwork'|'width'|'height'> & {
  value: MemoryCoverArtwork;
  onChange: (value: MemoryCoverArtwork) => void;
  coverPages: readonly MemoryCoverPage[];
  selectedCoverId?: string | null;
  onSelectCover: (id: string) => void;
  disabled?: boolean;
  onDragStateChange?: (dragging: boolean) => void;
};
const PAPER_COLORS = ['#F5F0E4', '#FBE3EA', '#E4EEE2', '#E2EEF6', '#ECE7F7', '#F5E5A5', '#24272A'];

function SourceTile({page}: {page: MemoryCoverPage}) {
  const media = memoryCoverMedia(page), [failed, setFailed] = useState<string[]>([]);
  const photo = [media.photoUrl, media.fallbackPhotoUrl].find(url => url && !failed.includes(url));
  return photo ? <Image source={{uri: photo}} contentFit="cover" style={{width: '100%', height: '100%'}} onError={() => setFailed(old => [...old.slice(-3), photo])}/>
    : media.videoUrl ? <VideoThumb uri={media.videoUrl} fill chip={false}/>
    : <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#142642', padding: 8}}><Text numberOfLines={4} style={{color: '#FFFFFF', fontSize: 12}}>{page.caption || page.story_caption || 'Memory'}</Text></View>;
}

function DrawCapture({strokes, onChange, width, height, tool, color, size, onDragStateChange, onLimit}: {
  strokes: MemoryCoverStroke[]; onChange: (strokes: MemoryCoverStroke[]) => void;
  width: number; height: number; tool: 'pen'|'marker'|'eraser'; color: string; size: number;
  onDragStateChange?: (dragging: boolean) => void; onLimit: (message: string) => void;
}) {
  const [live, setLive] = useState<MemoryCoverStroke | null>(null);
  const current = useRef({strokes, onChange, width, height, tool, color, size, onDragStateChange, onLimit});
  current.current = {strokes, onChange, width, height, tool, color, size, onDragStateChange, onLimit};
  const liveRef = useRef<MemoryCoverStroke | null>(null);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: event => {
      const c = current.current;
      c.onDragStateChange?.(true);
      const point = {x: Math.max(0, Math.min(1, event.nativeEvent.locationX / c.width)), y: Math.max(0, Math.min(1, event.nativeEvent.locationY / c.height))};
      if (c.tool === 'eraser') {
        c.onChange(c.strokes.filter(stroke => !stroke.points.some(p => Math.hypot((p.x - point.x) * c.width, (p.y - point.y) * c.height) < 18)));
        return;
      }
      if (c.strokes.length >= MEMORY_COVER_MAX_STROKES || c.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) >= MEMORY_COVER_MAX_POINTS) {
        c.onLimit('This cover has reached its drawing limit. Undo or erase a stroke to keep drawing.'); return;
      }
      c.onLimit('');
      liveRef.current = {tool: c.tool, color: c.color, width: c.size, points: [point]};
      setLive(liveRef.current);
    },
    onPanResponderMove: event => {
      const c = current.current, stroke = liveRef.current;
      const point = {x: Math.max(0, Math.min(1, event.nativeEvent.locationX / c.width)), y: Math.max(0, Math.min(1, event.nativeEvent.locationY / c.height))};
      if (c.tool === 'eraser') {
        c.onChange(c.strokes.filter(item => !item.points.some(p => Math.hypot((p.x - point.x) * c.width, (p.y - point.y) * c.height) < 18)));
        return;
      }
      if (!stroke || stroke.points.length >= MEMORY_COVER_MAX_STROKE_POINTS || c.strokes.reduce((sum, item) => sum + item.points.length, 0) + stroke.points.length >= MEMORY_COVER_MAX_POINTS) return;
      const last = stroke.points[stroke.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) < .003) return;
      liveRef.current = {...stroke, points: [...stroke.points, point]};
      setLive(liveRef.current);
    },
    onPanResponderRelease: () => {
      const c = current.current, stroke = liveRef.current;
      if (stroke) c.onChange([...c.strokes, stroke]);
      liveRef.current = null; setLive(null); c.onDragStateChange?.(false);
    },
    onPanResponderTerminate: () => {
      liveRef.current = null; setLive(null); current.current.onDragStateChange?.(false);
    },
  })).current;
  useEffect(() => () => current.current.onDragStateChange?.(false), []);
  return <View testID="memory-cover-drawing-canvas" accessibilityLabel="Draw or write on the cover with your finger" style={StyleSheet.absoluteFill} {...pan.panHandlers}>
    {live && <DrawingLayer strokes={memoryCoverScaledStrokes([live], width)} width={width} height={height}/>}
  </View>;
}

export default function MemoryCoverEditor({value, onChange, coverPages, selectedCoverId, onSelectCover, disabled = false, onDragStateChange, ...preview}: Props) {
  const {t} = useTheme(), {width: screenWidth} = useWindowDimensions();
  const [drawing, setDrawing] = useState(false), [tool, setTool] = useState<'pen'|'marker'|'eraser'>('pen');
  const [penColor, setPenColor] = useState<string>('#142642'), [size, setSize] = useState(2.5), [limit, setLimit] = useState('');
  const [redo, setRedo] = useState<MemoryCoverStroke[]>([]);
  const personal = personalizeMemoryCover(value), width = Math.min(screenWidth - 84, 288), height = width * 1.31;
  const requested = personal.storyIds.length ? personal.storyIds : selectedCoverId ? [selectedCoverId] : [];
  const candidates = coverPages.filter(page => !!page.story_id && !!(memoryCoverMedia(page).photoUrl || memoryCoverMedia(page).videoUrl));
  const selected = requested.filter(id => candidates.some(page => page.story_id === id));
  const changeStrokes = (strokes: MemoryCoverStroke[]) => {setRedo([]); onChange({...personal, strokes});};
  const chooseSource = (id: string) => {
    if (personal.layout === 'single') {onSelectCover(id); if (value.version === 2) onChange({...personal, storyIds: [id]}); return;}
    const next = selected.includes(id) ? selected.length > 1 ? selected.filter(item => item !== id) : selected : selected.length < MEMORY_COVER_MAX_PHOTOS ? [...selected, id] : selected;
    if (next.length) onSelectCover(next[0]);
    onChange({...personal, storyIds: next});
  };
  const button = (label: string, active: boolean, onPress: () => void, unavailable = false) => <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected: active, disabled: disabled || unavailable}} disabled={disabled || unavailable} onPress={onPress} style={{minHeight: 44, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderRadius: 12, borderColor: active ? t.ink.primary : t.surface.hairline, backgroundColor: active ? t.ink.primary : 'transparent', opacity: unavailable ? .4 : 1}}><Text style={{fontSize: 13, color: active ? t.surface.canvas : t.ink.primary}}>{label}</Text></TouchableOpacity>;
  return <View pointerEvents={disabled ? 'none' : 'auto'} accessibilityElementsHidden={disabled} importantForAccessibility={disabled ? 'no-hide-descendants' : 'auto'} style={{paddingVertical: 16, opacity: disabled ? .6 : 1}}>
    <View style={{alignItems: 'center', marginBottom: 14}}>
      <View style={{width, height}}><MemoryBookCover {...preview} artwork={value} coverPages={coverPages} width={width} height={height}/>
        {drawing && <DrawCapture strokes={personal.strokes} onChange={changeStrokes} width={width} height={height} tool={tool} color={penColor} size={size} onDragStateChange={onDragStateChange} onLimit={setLimit}/>}
      </View>
    </View>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center'}}>
      {button(drawing ? 'Done drawing' : 'Draw on cover', drawing, () => {setDrawing(!drawing); setLimit('');})}
    </View>
    {drawing && <View style={{marginTop: 12, padding: 12, backgroundColor: t.surface.hairline, borderRadius: 16}}>
      <Text style={{fontSize: 12, color: t.ink.secondary, marginBottom: 8}}>Write your own signature or sketch directly on the cover.</Text>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 7}}>{(['pen', 'marker', 'eraser'] as const).map(item => button(item === 'pen' ? 'Pen' : item === 'marker' ? 'Marker' : 'Eraser', tool === item, () => setTool(item)))}</View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 9}}>{MEMORY_COVER_DRAWING_COLORS.map(color => <TouchableOpacity key={color} accessibilityRole="button" accessibilityLabel={`Drawing color ${color}`} accessibilityState={{selected: penColor === color}} onPress={() => setPenColor(color)} style={{width: 38, height: 44, alignItems: 'center', justifyContent: 'center'}}><View style={{width: 28, height: 28, borderRadius: 14, backgroundColor: color, borderWidth: penColor === color ? 3 : 1, borderColor: penColor === color ? t.ink.primary : '#888888'}}/></TouchableOpacity>)}</View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 7}}>{[{label: 'Fine', value: 1}, {label: 'Medium', value: 2.5}, {label: 'Bold', value: 5}].map(item => button(item.label, size === item.value, () => setSize(item.value)))}</View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9}}>
        {button('Undo drawing', false, () => {const last = personal.strokes.at(-1); if (last) {setRedo(old => [...old, last]); onChange({...personal, strokes: personal.strokes.slice(0, -1)}); setLimit('');}}, !personal.strokes.length)}
        {button('Redo drawing', false, () => {const last = redo.at(-1); if (last) {setRedo(old => old.slice(0, -1)); onChange({...personal, strokes: [...personal.strokes, last]});}}, !redo.length)}
        {button('Clear drawing', false, () => {setRedo([]); onChange({...personal, strokes: []}); setLimit('');}, !personal.strokes.length)}
      </View>
      {!!limit && <Text accessibilityRole="alert" style={{color: t.ink.primary, fontSize: 12, marginTop: 8}}>{limit}</Text>}
    </View>}
    <Text style={{color: t.ink.secondary, fontSize: 12, fontWeight: '600', marginTop: 20, marginBottom: 8}}>Cover photos</Text>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
      {button('Single photo', personal.layout === 'single', () => {const first = selected[0]; if (first) onSelectCover(first); onChange({...personal, layout: 'single', storyIds: first ? [first] : []});})}
      {button('Photo collage', personal.layout === 'collage', () => {const ids = [...new Set([...selected, ...candidates.map(page => page.story_id!)])].slice(0, Math.max(2, selected.length)); if (ids[0]) onSelectCover(ids[0]); onChange({...personal, layout: 'collage', storyIds: ids.slice(0, MEMORY_COVER_MAX_PHOTOS)});}, candidates.length < 2)}
    </View>
    <Text style={{color: t.ink.secondary, fontSize: 12, lineHeight: 18, marginTop: 9}}>{personal.layout === 'collage' ? `Choose up to four thumbnails in the order you want them. ${selected.length}/4 selected.` : 'Choose a photo or video thumbnail from the memories in this book.'}</Text>
    {candidates.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 9, paddingVertical: 9}}>{candidates.map((page, index) => {const order = selected.indexOf(page.story_id!); return <TouchableOpacity key={page.story_id} accessibilityRole={personal.layout === 'collage' ? 'checkbox' : 'button'} accessibilityLabel={`Cover photo ${index + 1}${page.caption ? ': ' + page.caption : ''}`} accessibilityState={{selected: order >= 0, checked: order >= 0}} onPress={() => chooseSource(page.story_id!)} style={{width: 70, height: 90, overflow: 'hidden', borderRadius: 7, borderWidth: 3, borderColor: order >= 0 ? t.ink.primary : 'transparent'}}><SourceTile page={page}/>{order >= 0 && <View style={{position: 'absolute', top: 3, right: 3, backgroundColor: '#142642', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center'}}><Text style={{color: '#FFFFFF', fontSize: 12}}>{personal.layout === 'collage' ? order + 1 : '✓'}</Text></View>}</TouchableOpacity>;})}</ScrollView> : <Text style={{color: t.ink.secondary, fontSize: 12, marginTop: 8}}>Add photo or video memories to choose a cover thumbnail. You can still write and draw on your cover.</Text>}
    <Text style={{color: t.ink.secondary, fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 8}}>Cover title style</Text>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{([{id: 'design', label: 'Design title'}, {id: 'handwritten', label: 'Cursive title'}, {id: 'serif', label: 'Serif title'}, {id: 'sans', label: 'Simple title'}] as const).map(option => button(option.label, personal.titleStyle === option.id, () => onChange({...personal, titleStyle: option.id})))}</View>
    {([{key: 'paperColor', label: 'Cover background', colors: PAPER_COLORS}, {key: 'inkColor', label: 'Title color', colors: MEMORY_COVER_DRAWING_COLORS}] as const).map(group => <View key={group.key} style={{marginTop: 16}}><Text style={{color: t.ink.secondary, fontSize: 12, fontWeight: '600', marginBottom: 5}}>{group.label}</Text><View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Use design ${group.label.toLowerCase()}`} onPress={() => onChange({...personal, [group.key]: null})} style={{width: 40, height: 44, alignItems: 'center', justifyContent: 'center'}}><Feather name="rotate-ccw" size={20} color={t.ink.primary}/></TouchableOpacity>{group.colors.map(color => <TouchableOpacity key={color} accessibilityRole="button" accessibilityLabel={`${group.label} ${color}`} accessibilityState={{selected: personal[group.key] === color}} onPress={() => onChange({...personal, [group.key]: color})} style={{width: 38, height: 44, alignItems: 'center', justifyContent: 'center'}}><View style={{width: 28, height: 28, borderRadius: 14, backgroundColor: color, borderWidth: personal[group.key] === color ? 3 : 1, borderColor: personal[group.key] === color ? t.ink.primary : '#888888'}}/></TouchableOpacity>)}</View></View>)}
  </View>;
}
