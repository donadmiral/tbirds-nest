import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, PanResponder } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { storyLayerWindow } from '../../../shared/storyPresentation';
import type { StoryTextSticker } from '../../services/storiesService';
import TrimStrip from './TrimStrip';

function LayerTimingRow({ sticker, duration, width, onChange, onSeek }: {
  sticker: StoryTextSticker; duration: number; width: number;
  onChange: (id: string, start: number, end: number) => void; onSeek: (time: number) => void;
}) {
  const window = storyLayerWindow(sticker.startSec, sticker.endSec, duration);
  const current = useRef({ sticker, duration, width, onChange, onSeek, window });
  current.current = { sticker, duration, width, onChange, onSeek, window };
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  const origin = useRef(window);
  const live = useRef(window);
  const handle = (edge: 'start' | 'end') => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { origin.current = current.current.window; live.current = origin.current; setDrag(origin.current); },
    onPanResponderMove: (_e, g) => {
      const c = current.current, shift = g.dx / c.width * c.duration;
      const next = edge === 'start'
        ? storyLayerWindow(Math.min(origin.current.end - .25, origin.current.start + shift), origin.current.end, c.duration)
        : storyLayerWindow(origin.current.start, Math.max(origin.current.start + .25, origin.current.end + shift), c.duration);
      live.current = next; setDrag(next); c.onSeek(edge === 'start' ? next.start : next.end);
    },
    onPanResponderRelease: () => { const c = current.current; c.onChange(c.sticker.id, live.current.start, live.current.end); setDrag(null); },
    onPanResponderTerminate: () => { setDrag(null); },
  });
  const start = useRef(handle('start')).current;
  const end = useRef(handle('end')).current;
  const value = drag || window;
  const isText = !sticker.kind || sticker.kind === 'text';
  const adjust = (edge: 'start' | 'end', delta: number) => {
    const next = storyLayerWindow(edge === 'start' ? Math.min(window.end - .25, window.start + delta) : window.start, edge === 'end' ? Math.max(window.start + .25, window.end + delta) : window.end, duration);
    onChange(sticker.id, next.start, next.end);
  };
  return <View style={s.layerRow}>
    <Text numberOfLines={1} style={s.layerLabel}>{isText ? 'Text' : 'Sticker'}</Text>
    <View style={[s.layerTrack, { width }]}>
      <View style={[s.layer, { left: value.start / duration * width, width: Math.max(12, (value.end - value.start) / duration * width), backgroundColor: isText ? '#CDBBA2' : '#9BA58E' }]}>
        <Text numberOfLines={1} style={s.layerText}>{sticker.text || sticker.kind}</Text>
        <View {...start.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={`Start of ${sticker.text || sticker.kind}`} accessibilityValue={{ min: 0, max: duration, now: value.start, text: value.start.toFixed(1) + ' seconds' }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={e => adjust('start', e.nativeEvent.actionName === 'increment' ? .5 : -.5)} style={[s.layerHandle, { left: -3 }]} hitSlop={12}><View style={s.grip} /></View>
        <View {...end.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={`End of ${sticker.text || sticker.kind}`} accessibilityValue={{ min: 0, max: duration, now: value.end, text: value.end.toFixed(1) + ' seconds' }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={e => adjust('end', e.nativeEvent.actionName === 'increment' ? .5 : -.5)} style={[s.layerHandle, { right: -3 }]} hitSlop={12}><View style={s.grip} /></View>
      </View>
    </View>
  </View>;
}

/** One overlay on the existing canvas/player; opening timing never stacks native modals. */
export default function StoryTimingPanel({ visible, uri, duration, trimStart, trimEnd, player, width, topInset, bottomInset, stickers, audioTitle, onClose, onTrim, onDuration, onLayerChange }: {
  visible: boolean; uri: string | null; duration: number; trimStart: number; trimEnd: number; player: any; width: number;
  topInset: number; bottomInset: number; stickers: StoryTextSticker[]; audioTitle?: string | null;
  onClose: () => void; onTrim: (start: number, end: number) => void; onDuration: (duration: number) => void;
  onLayerChange: (id: string, start: number, end: number) => void;
}) {
  if (!visible) return null;
  const trackWidth = Math.max(120, width - 96);
  const seek = (time: number) => { try { player?.pause(); if (player) player.currentTime = time; } catch {} };
  return <View pointerEvents="box-none" accessibilityViewIsModal style={[StyleSheet.absoluteFill, { zIndex: 82 }]}>
    <View style={[s.header, { paddingTop: Math.max(topInset, 12) }]}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to story editing" onPress={onClose} style={s.back}><Feather name="chevron-left" size={24} color="#FFFFFF" /></TouchableOpacity><Text style={s.title}>Timing</Text><TouchableOpacity accessibilityRole="button" onPress={onClose} style={s.done}><Text style={s.doneText}>Done</Text></TouchableOpacity></View>
    <View style={[s.panel, { paddingBottom: Math.max(bottomInset, 18) }]}>
      {uri ? <TrimStrip uri={uri} durationSec={duration} start={trimStart} end={trimEnd} onChange={onTrim} onDuration={onDuration} player={player} width={width - 32} expanded /> : null}
      <View style={[s.ruler, { paddingLeft: 65 }]}>{[0, .25, .5, .75, 1].map(p => <Text key={p} style={s.tick}>{Math.round(duration * p)}s</Text>)}</View>
      <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ gap: 12, paddingVertical: 8 }} showsVerticalScrollIndicator={false}>
        {stickers.filter(s => s.kind !== 'drawing').map(sticker => <LayerTimingRow key={sticker.id} sticker={sticker} duration={duration} width={trackWidth} onChange={onLayerChange} onSeek={seek} />)}
        {audioTitle ? <View style={s.layerRow}><Text style={s.layerLabel}>Audio</Text><View style={[s.audio, { width: trackWidth }]}><Feather name="music" size={16} color="#DFE4ED" /><Text numberOfLines={1} style={{ color: '#DFE4ED', flex: 1 }}>{audioTitle}</Text></View></View> : null}
      </ScrollView>
      <Text style={s.hint}>{stickers.length ? 'Drag the ends to set when each layer appears.' : 'Add text or stickers to set their timing here.'}</Text>
    </View>
  </View>;
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: '#15191DCC' },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { color: '#FFF', fontSize: 19, fontWeight: '600', flex: 1, textAlign: 'center' },
  done: { minHeight: 44, borderRadius: 24, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1DFC5' }, doneText: { color: '#16191B', fontWeight: '700', fontSize: 15 },
  panel: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#15191DF5', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  ruler: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }, tick: { color: '#C8C9CA', fontSize: 11 },
  layerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }, layerLabel: { width: 52, color: '#F8F6F1', fontSize: 12 },
  layerTrack: { height: 44, backgroundColor: '#292D30', borderRadius: 8 }, layer: { position: 'absolute', height: 44, borderRadius: 8, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: '#FFF9' },
  layerText: { color: '#16191B', fontSize: 12, fontWeight: '600' }, layerHandle: { position: 'absolute', top: 0, bottom: 0, width: 13, borderRadius: 6, backgroundColor: '#FAF6EE', justifyContent: 'center', alignItems: 'center' }, grip: { width: 2, height: 18, borderRadius: 1, backgroundColor: '#6B6B65' },
  audio: { flexDirection: 'row', gap: 10, alignItems: 'center', height: 44, borderRadius: 8, paddingHorizontal: 12, backgroundColor: '#343E4D', borderWidth: 1, borderColor: '#617087' }, hint: { color: '#D0D1D1', fontSize: 12, textAlign: 'center', marginTop: 18 },
});
