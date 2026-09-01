/**
 * PostMediaEditSheet - the edit stage between picking media and posting.
 * Reuses the story engine (MediaCanvas transform + fit, filter with strength,
 * Adjust, trim strip, mute) and returns a non-destructive PostMediaEdit recipe
 * stored on post_media.edit. The original file is never touched.
 */
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Animated, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import MediaCanvas from './stories/MediaCanvas';
import type { MediaTransform, MediaFit } from '../services/storiesService';
import { FilterPickerSheet, FilterLayer } from './stories/StoryFilters';
import { AdjustPanel, AdjustLayer, type StoryAdjust } from './stories/storyPanels';
import TrimStrip from './stories/TrimStrip';

export type PostMediaEdit = {
  scale?: number; translateNX?: number; translateNY?: number; fit?: 'cover' | 'contain';
  filterId?: string | null; filterAmt?: number; adjust?: StoryAdjust | null;
  trimStart?: number | null; trimEnd?: number | null; muted?: boolean;
};

const SCREEN_W = Dimensions.get('window').width;

export default function PostMediaEditSheet({ visible, uri, mediaType, width, height, durationSec, initial, onDone, onCancel }: {
  visible: boolean; uri: string | null; mediaType: 'image' | 'video'; width?: number; height?: number; durationSec?: number;
  initial?: PostMediaEdit | null; onDone: (edit: PostMediaEdit) => void; onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [edit, setEdit] = useState<PostMediaEdit>(initial || {});
  const [filterOpen, setFilterOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [player, setPlayer] = useState<any>(null);
  const [dur, setDur] = useState(durationSec || 0);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  React.useEffect(() => { if (visible) { setEdit(initial || {}); setDur(durationSec || 0); } }, [visible]);
  const ratio = width && height && width > 0 && height > 0 ? width / height : 4 / 5;
  const canvasW = SCREEN_W;
  const canvasH = Math.max(240, Math.min(SCREEN_W * 1.25, canvasW / ratio));
  const tx: MediaTransform = { scale: edit.scale ?? 1, translateNX: edit.translateNX ?? 0, translateNY: edit.translateNY ?? 0 } as MediaTransform;
  const fit: MediaFit = (edit.fit || 'cover') as MediaFit;
  const setTx = useCallback((t: MediaTransform) => setEdit(e => ({ ...e, scale: t.scale, translateNX: t.translateNX, translateNY: t.translateNY })), []);
  const isVideo = mediaType === 'video';
  const trimEnd = edit.trimEnd ?? (dur > 0 ? dur : null);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <View style={[st.root, { paddingTop: insets.top }]}>
        <View style={st.top}>
          <TouchableOpacity onPress={onCancel} style={st.topBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="x" size={22} color="#FFF" /></TouchableOpacity>
          <Text style={st.title}>Edit</Text>
          <TouchableOpacity onPress={() => onDone(edit)} style={st.done} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={st.doneTxt}>Done</Text></TouchableOpacity>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ width: canvasW, height: canvasH, backgroundColor: '#000', overflow: 'hidden' }}>
            <MediaCanvas localUri={uri} mediaType={mediaType} uploadState="idle" onRetry={() => {}} onLayout={() => {}} scaleAnim={scaleAnim} opacityAnim={opacityAnim}
              imageW={width} imageH={height} mediaFit={fit} mediaTransform={tx} onTransformChange={setTx}
              onFitToggle={() => setEdit(e => ({ ...e, fit: (e.fit || 'cover') === 'cover' ? 'contain' : 'cover' }))} interactive
              videoMuted={!!edit.muted} videoVolume={edit.muted ? 0 : 1} trimStart={edit.trimStart ?? null} trimEnd={edit.trimEnd ?? null} onVideoPlayer={setPlayer}>
              <FilterLayer filterId={edit.filterId || null} amt={edit.filterAmt ?? 100} />
              <AdjustLayer adjust={edit.adjust || null} />
            </MediaCanvas>
          </View>
          {isVideo && !!uri && (
            <View style={{ alignItems: 'center', marginTop: 12 }}>
              <TrimStrip uri={uri} durationSec={dur || 15} start={edit.trimStart ?? 0} end={trimEnd ?? Math.min(dur || 15, 600)}
                onChange={(s2, e2) => setEdit(e => ({ ...e, trimStart: Math.round(s2 * 10) / 10, trimEnd: Math.round(e2 * 10) / 10 }))}
                onDuration={(d) => setDur(d)} player={player} width={SCREEN_W - 24} />
            </View>
          )}
        </View>
        <View style={[st.tools, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          {([
            { id: 'filter', label: 'Filter', icon: 'droplet', on: !!edit.filterId, run: () => setFilterOpen(true) },
            { id: 'adjust', label: 'Adjust', icon: 'sliders', on: !!edit.adjust, run: () => setAdjustOpen(true) },
            { id: 'fit', label: fit === 'contain' ? 'Fill' : 'Fit', icon: 'crop', on: fit === 'contain', run: () => setEdit(e => ({ ...e, fit: (e.fit || 'cover') === 'cover' ? 'contain' : 'cover' })) },
            ...(isVideo ? [{ id: 'mute', label: edit.muted ? 'Unmute' : 'Mute', icon: edit.muted ? 'volume-x' : 'volume-2', on: !!edit.muted, run: () => setEdit(e => ({ ...e, muted: !e.muted })) }] : []),
            { id: 'reset', label: 'Reset', icon: 'rotate-ccw', on: false, run: () => setEdit({}) },
          ] as { id: string; label: string; icon: any; on: boolean; run: () => void }[]).map(t => (
            <TouchableOpacity key={t.id} style={st.tool} onPress={t.run} activeOpacity={0.75}>
              <View style={[st.toolIcon, t.on && st.toolIconOn]}><Feather name={t.icon} size={20} color="#FFF" /></View>
              <Text style={st.toolLabel}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <FilterPickerSheet visible={filterOpen} onClose={() => setFilterOpen(false)} selected={edit.filterId || null} onSelect={(id: string | null) => setEdit(e => ({ ...e, filterId: id }))} previewUri={uri} />
        <AdjustPanel visible={adjustOpen} onClose={() => setAdjustOpen(false)} adjust={edit.adjust || {}} onChange={(a) => setEdit(e => ({ ...e, adjust: Object.keys(a).some(k => (a as any)[k] != null) ? a : null }))}
          filterOn={!!edit.filterId} filterAmt={edit.filterAmt ?? 100} onFilterAmt={(v) => setEdit(e => ({ ...e, filterAmt: v }))} />
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0D12' },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 48 },
  topBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  title: { flex: 1, textAlign: 'center', color: '#FFF', fontSize: 16, fontWeight: '800' },
  done: { backgroundColor: '#C9BFB0', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8 },
  doneTxt: { color: '#0B1E3D', fontSize: 14, fontWeight: '800' },
  tools: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 12, paddingHorizontal: 8 },
  tool: { alignItems: 'center', width: 64 },
  toolIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  toolIconOn: { backgroundColor: 'rgba(201,191,176,0.35)' },
  toolLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '600' },
});
