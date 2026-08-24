/**
 * StoryFilters - overlay-based photo looks for stories.
 * Filters are stored as an id on the story (stories.filter_id) and
 * rendered as stacked translucent layers over the media, so the same
 * definitions replicate exactly on web with rgba layers. No pixel
 * processing, no native dependencies.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Image, StyleSheet } from 'react-native';

export type StoryFilterDef = {
  id: string;
  label: string;
  layers: { color: string; opacity: number }[];
};

export const STORY_FILTERS: StoryFilterDef[] = [
  { id: 'warm', label: 'Warm', layers: [{ color: '#FF9A3C', opacity: 0.14 }, { color: '#3B2000', opacity: 0.08 }] },
  { id: 'golden', label: 'Golden', layers: [{ color: '#FFC94D', opacity: 0.18 }] },
  { id: 'cool', label: 'Cool', layers: [{ color: '#3C7DFF', opacity: 0.12 }, { color: '#001A3B', opacity: 0.08 }] },
  { id: 'rose', label: 'Rose', layers: [{ color: '#FF5E8A', opacity: 0.12 }] },
  { id: 'fade', label: 'Fade', layers: [{ color: '#FFFFFF', opacity: 0.16 }, { color: '#000000', opacity: 0.05 }] },
  { id: 'dusk', label: 'Dusk', layers: [{ color: '#5B3B8F', opacity: 0.14 }, { color: '#000000', opacity: 0.1 }] },
];

export function FilterLayer({ filterId, zIndex }: { filterId: string | null; zIndex?: number }) {
  if (!filterId) return null;
  const f = STORY_FILTERS.find(x => x.id === filterId);
  if (!f) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, zIndex != null ? { zIndex } : null]}>
      {f.layers.map((l, i) => (
        <View key={i} pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: l.color, opacity: l.opacity }]} />
      ))}
    </View>
  );
}

type PickerProps = {
  visible: boolean;
  onClose: () => void;
  selected: string | null;
  onSelect: (filterId: string | null) => void;
  previewUri: string | null;
};

export function FilterPickerSheet({ visible, onClose, selected, onSelect, previewUri }: PickerProps) {
  const tiles: { id: string | null; label: string }[] = [{ id: null, label: 'None' }, ...STORY_FILTERS.map(f => ({ id: f.id as string | null, label: f.label }))];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={fs.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={fs.sheet}>
            <View style={fs.handle} />
            <Text style={fs.title}>Filters</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={fs.row}>
              {tiles.map(t => {
                const isOn = selected === t.id || (!selected && t.id === null);
                return (
                  <TouchableOpacity key={t.id || 'none'} style={fs.tileWrap} activeOpacity={0.8} onPress={() => onSelect(t.id)}>
                    <View style={[fs.tile, isOn && fs.tileOn]}>
                      {previewUri ? (
                        <Image source={{ uri: previewUri }} style={fs.tileImg} resizeMode="cover" fadeDuration={0} />
                      ) : (
                        <View style={[fs.tileImg, { backgroundColor: '#1B2233' }]} />
                      )}
                      <FilterLayer filterId={t.id} />
                    </View>
                    <Text style={[fs.tileLabel, isOn && fs.tileLabelOn]} numberOfLines={1}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={fs.doneBtn} activeOpacity={0.8} onPress={onClose}>
              <Text style={fs.doneTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const fs = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: '#0C0C10', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingBottom: 34, paddingHorizontal: 16 },
  handle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.24)', marginBottom: 12 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 14, textAlign: 'center' },
  row: { gap: 12, paddingHorizontal: 4 },
  tileWrap: { alignItems: 'center', width: 68 },
  tile: { width: 64, height: 86, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)' },
  tileOn: { borderColor: '#FFFFFF' },
  tileImg: { width: '100%', height: '100%' },
  tileLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 6, fontWeight: '600' },
  tileLabelOn: { color: '#FFFFFF' },
  doneBtn: { marginTop: 18, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 34, paddingVertical: 11 },
  doneTxt: { color: '#020408', fontSize: 15, fontWeight: '700' },
});