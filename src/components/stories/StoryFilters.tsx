/**
 * StoryFilters - overlay-based photo looks for stories.
 * Filters are stored as an id on the story (stories.filter_id) and
 * rendered as stacked translucent layers over the media, so the same
 * definitions replicate exactly on web with rgba layers. No pixel
 * processing, no native dependencies.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Image, StyleSheet } from 'react-native';

export type StoryFilterFamily = 'classic' | 'modern' | 'film';
export type StoryFilterDef = {
  id: string;
  label: string;
  family: StoryFilterFamily;
  layers: { color: string; opacity: number }[];
};
export const STORY_FILTER_FAMILIES: { key: StoryFilterFamily; label: string }[] = [
  { key: 'classic', label: 'Classic' }, { key: 'modern', label: 'Modern' }, { key: 'film', label: 'Film' },
];

// The same catalogue as web/lib/stories.ts, look for look. Ids are stored on
// stories.filter_id; never rename one. Web adds a CSS grade beneath these
// planes for contrast and black-and-white; here the planes carry the look.
export const STORY_FILTERS: StoryFilterDef[] = [
  { id: 'warm', label: 'Warm', family: 'classic', layers: [{ color: '#FF9A3C', opacity: 0.14 }, { color: '#3B2000', opacity: 0.08 }] },
  { id: 'golden', label: 'Golden', family: 'classic', layers: [{ color: '#FFC94D', opacity: 0.18 }] },
  { id: 'cool', label: 'Cool', family: 'classic', layers: [{ color: '#3C7DFF', opacity: 0.12 }, { color: '#001A3B', opacity: 0.08 }] },
  { id: 'rose', label: 'Rose', family: 'classic', layers: [{ color: '#FF5E8A', opacity: 0.12 }] },
  { id: 'fade', label: 'Fade', family: 'modern', layers: [{ color: '#FFFFFF', opacity: 0.16 }, { color: '#000000', opacity: 0.05 }] },
  { id: 'dusk', label: 'Dusk', family: 'classic', layers: [{ color: '#5B3B8F', opacity: 0.14 }, { color: '#000000', opacity: 0.10 }] },
  { id: 'sepia', label: 'Sepia', layers: [{ color: '#8A6A3B', opacity: 0.2 }, { color: '#2B1D07', opacity: 0.1 }] },
  { id: 'mint', label: 'Mint', layers: [{ color: '#3ECF8E', opacity: 0.1 }, { color: '#02291A', opacity: 0.07 }] },
  { id: 'berry', label: 'Berry', layers: [{ color: '#B33771', opacity: 0.13 }, { color: '#1B0210', opacity: 0.09 }] },
  { id: 'noir', label: 'Noir', layers: [{ color: '#000000', opacity: 0.22 }, { color: '#1C2B4A', opacity: 0.12 }] },
  { id: 'fade_warm', label: 'Fade warm', family: 'modern', layers: [{ color: '#FFE0B8', opacity: 0.18 }, { color: '#000000', opacity: 0.04 }] },
  { id: 'fade_cool', label: 'Fade cool', family: 'modern', layers: [{ color: '#C8DBFF', opacity: 0.18 }, { color: '#000000', opacity: 0.04 }] },
  { id: 'simple', label: 'Simple', family: 'modern', layers: [{ color: '#FFFFFF', opacity: 0.06 }] },
  { id: 'boost', label: 'Boost', family: 'modern', layers: [{ color: '#FFF3D6', opacity: 0.06 }] },
  { id: 'boost_warm', label: 'Boost warm', family: 'modern', layers: [{ color: '#FFB86B', opacity: 0.12 }] },
  { id: 'boost_cool', label: 'Boost cool', family: 'modern', layers: [{ color: '#7FA8FF', opacity: 0.12 }] },
  { id: 'graphite', label: 'Graphite', family: 'modern', layers: [{ color: '#2A2E36', opacity: 0.22 }, { color: '#FFFFFF', opacity: 0.04 }] },
  { id: 'hyper', label: 'Hyper', family: 'modern', layers: [{ color: '#FF3D9A', opacity: 0.08 }, { color: '#2AF0FF', opacity: 0.06 }] },
  { id: 'rosy', label: 'Rosy', family: 'modern', layers: [{ color: '#FF8FB3', opacity: 0.16 }] },
  { id: 'emerald', label: 'Emerald', family: 'modern', layers: [{ color: '#1DB47A', opacity: 0.14 }, { color: '#003322', opacity: 0.06 }] },
  { id: 'midnight', label: 'Midnight', family: 'modern', layers: [{ color: '#0B1E3D', opacity: 0.22 }, { color: '#000000', opacity: 0.14 }] },
  { id: 'soft_light', label: 'Soft light', family: 'modern', layers: [{ color: '#FFFFFF', opacity: 0.12 }, { color: '#FFE9C9', opacity: 0.08 }] },
  { id: 'clarendon', label: 'Clarendon', family: 'film', layers: [{ color: '#7FBFFF', opacity: 0.10 }] },
  { id: 'gingham', label: 'Gingham', family: 'film', layers: [{ color: '#FFFFFF', opacity: 0.14 }, { color: '#E6E1D6', opacity: 0.08 }] },
  { id: 'moon', label: 'Moon', family: 'film', layers: [{ color: '#DDE3EA', opacity: 0.10 }] },
  { id: 'lark', label: 'Lark', family: 'film', layers: [{ color: '#E8F4FF', opacity: 0.10 }] },
  { id: 'reyes', label: 'Reyes', family: 'film', layers: [{ color: '#EFE3CF', opacity: 0.20 }, { color: '#000000', opacity: 0.03 }] },
  { id: 'juno', label: 'Juno', family: 'film', layers: [{ color: '#FFD8B0', opacity: 0.10 }, { color: '#FF7A3C', opacity: 0.05 }] },
  { id: 'slumber', label: 'Slumber', family: 'film', layers: [{ color: '#5D4A2A', opacity: 0.16 }, { color: '#000000', opacity: 0.06 }] },
  { id: 'crema', label: 'Crema', family: 'film', layers: [{ color: '#F3E4CE', opacity: 0.16 }] },
  { id: 'ludwig', label: 'Ludwig', family: 'film', layers: [{ color: '#FFF1DE', opacity: 0.08 }] },
  { id: 'aden', label: 'Aden', family: 'film', layers: [{ color: '#FFB07A', opacity: 0.14 }, { color: '#66271E', opacity: 0.06 }] },
  { id: 'perpetua', label: 'Perpetua', family: 'film', layers: [{ color: '#7FC4B3', opacity: 0.14 }, { color: '#0F3A2E', opacity: 0.06 }] },
  { id: 'amaro', label: 'Amaro', family: 'film', layers: [{ color: '#FFFFFF', opacity: 0.10 }, { color: '#FFD9A8', opacity: 0.08 }] },
  { id: 'mayfair', label: 'Mayfair', family: 'film', layers: [{ color: '#FFD0E8', opacity: 0.10 }, { color: '#000000', opacity: 0.06 }] },
  { id: 'rise', label: 'Rise', family: 'film', layers: [{ color: '#FFE0B0', opacity: 0.16 }, { color: '#000000', opacity: 0.04 }] },
  { id: 'hudson', label: 'Hudson', family: 'film', layers: [{ color: '#7AA6FF', opacity: 0.14 }, { color: '#002050', opacity: 0.06 }] },
  { id: 'valencia', label: 'Valencia', family: 'film', layers: [{ color: '#FFD9A0', opacity: 0.14 }, { color: '#3A2A10', opacity: 0.04 }] },
  { id: 'xpro', label: 'X-Pro II', family: 'film', layers: [{ color: '#FFC46B', opacity: 0.10 }, { color: '#000000', opacity: 0.16 }] },
  { id: 'sierra', label: 'Sierra', family: 'film', layers: [{ color: '#F5E6C8', opacity: 0.16 }, { color: '#000000', opacity: 0.08 }] },
  { id: 'willow', label: 'Willow', family: 'film', layers: [{ color: '#E9DFD0', opacity: 0.12 }] },
  { id: 'lofi', label: 'Lo-Fi', family: 'film', layers: [{ color: '#000000', opacity: 0.10 }] },
  { id: 'inkwell', label: 'Inkwell', family: 'film', layers: [{ color: '#000000', opacity: 0.04 }] },
  { id: 'hefe', label: 'Hefe', family: 'film', layers: [{ color: '#FFC97A', opacity: 0.12 }, { color: '#000000', opacity: 0.12 }] },
  { id: 'nashville', label: 'Nashville', family: 'film', layers: [{ color: '#FFD1B8', opacity: 0.18 }, { color: '#3C5A99', opacity: 0.10 }] },
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
  const families = STORY_FILTER_FAMILIES;
  const tilesFor = (fam: StoryFilterFamily): { id: string | null; label: string }[] => STORY_FILTERS.filter(f => f.family === fam).map(f => ({ id: f.id as string | null, label: f.label }));
  const tiles: { id: string | null; label: string }[] = [{ id: null, label: 'None' }, ...STORY_FILTERS.map(f => ({ id: f.id as string | null, label: f.label }))];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={fs.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={fs.sheet}>
            <View style={fs.handle} />
            <Text style={fs.title}>Filters</Text>
{(() => {
              const renderTile = (t: { id: string | null; label: string }) => {
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
              };
              return (
                <View>
                  {families.map(fam => (
                    <View key={fam.key} style={{ marginBottom: 10 }}>
                      <Text style={fs.famLabel}>{fam.label}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={fs.row}>
                        {(fam.key === 'classic' ? [{ id: null, label: 'None' }, ...tilesFor(fam.key)] : tilesFor(fam.key)).map(renderTile)}
                      </ScrollView>
                    </View>
                  ))}
                </View>
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