/**
 * Photo filter previews use the same pixel grade as the published photo.
 * Legacy video and text backdrops retain their stored translucent layers.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from '../SafeArea';
import StoryPixelImage from './StoryPixelImage';

import { STORY_FILTERS, STORY_FILTER_FAMILIES, type StoryFilterFamily } from '../../../shared/storyFilterAppearance';
export { STORY_FILTERS, STORY_FILTER_FAMILIES, type StoryFilterFamily, type StoryFilterDef } from '../../../shared/storyFilterAppearance';

export function FilterLayer({ filterId, zIndex, amt }: { filterId: string | null; zIndex?: number; amt?: number | null }) {
  if (!filterId) return null;
  const f = STORY_FILTERS.find(x => x.id === filterId);
  if (!f) return null;
  // Creative engine: filterAmt (0-100) scales the look's planes; default 100 keeps the look as designed.
  const k = Math.max(0, Math.min(1, (typeof amt === 'number' ? amt : 100) / 100));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, zIndex != null ? { zIndex } : null]}>
      {f.layers.map((l, i) => (
        <View key={i} pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: l.color, opacity: l.opacity * k }]} />
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
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const families = STORY_FILTER_FAMILIES;
  const tilesFor = (fam: StoryFilterFamily): { id: string | null; label: string }[] => STORY_FILTERS.filter(f => f.family === fam).map(f => ({ id: f.id as string | null, label: f.label }));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={fs.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={[fs.sheet, { maxHeight: height - insets.top - 16, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={fs.handle} />
            <Text style={fs.title}>Filters</Text>
{(() => {
              const renderTile = (t: { id: string | null; label: string }) => {
                const isOn = selected === t.id || (!selected && t.id === null);
                return (
                  <TouchableOpacity key={t.id || 'none'} style={fs.tileWrap} activeOpacity={0.8} onPress={() => onSelect(t.id)}>
                    <View style={[fs.tile, isOn && fs.tileOn]}>
                      {previewUri ? (
                        <StoryPixelImage uri={previewUri} style={fs.tileImg} fit="cover" look={{ filterId: t.id }} />
                      ) : (
                        <View style={[fs.tileImg, { backgroundColor: '#1B2233' }]} />
                      )}
                      {!previewUri ? <FilterLayer filterId={t.id} /> : null}
                    </View>
                    <Text style={[fs.tileLabel, isOn && fs.tileLabelOn]} numberOfLines={1}>{t.label}</Text>
                  </TouchableOpacity>
                );
              };
              return (
                <ScrollView style={{ maxHeight: height * .62 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {families.map(fam => (
                    <View key={fam.key} style={{ marginBottom: 10 }}>
                      <Text style={fs.famLabel}>{fam.label}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={fs.row}>
                        {(fam.key === 'platinum' ? [{ id: null, label: 'None' }, ...tilesFor(fam.key)] : tilesFor(fam.key)).map(renderTile)}
                      </ScrollView>
                    </View>
                  ))}
                </ScrollView>
              );
            })()}
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
  famLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', marginLeft: 14, marginBottom: 6 },
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
