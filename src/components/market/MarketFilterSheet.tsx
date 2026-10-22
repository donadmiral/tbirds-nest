import { themedSheet, useTheme } from '../../theme/useTheme';
import { KeyboardAvoidingView, Platform } from 'react-native';
/**
 * MarketFilterSheet - Facebook Marketplace filter panel.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { MARKET_CONDITIONS } from '../../services/marketService';

const NAVY = '#0B1E3D';

export type MarketFilters = {
  minPrice: string;
  maxPrice: string;
  condition: string | null;
  city: string;
  sort: 'recent' | 'price_low' | 'price_high';
};

export const EMPTY_FILTERS: MarketFilters = { minPrice: '', maxPrice: '', condition: null, city: '', sort: 'recent' };

const SORTS: { id: MarketFilters['sort']; label: string }[] = [
  { id: 'recent', label: 'Newest first' },
  { id: 'price_low', label: 'Price: low to high' },
  { id: 'price_high', label: 'Price: high to low' },
];

export default function MarketFilterSheet({ visible, onClose, value, onApply }: {
  visible: boolean; onClose: () => void; value: MarketFilters; onApply: (f: MarketFilters) => void;
}) {
  const { t } = useTheme();
  const [f, setF] = useState<MarketFilters>(value);
  useEffect(() => { if (visible) setF(value); }, [visible, value]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <View style={s.handle} />
            <View style={s.head}>
              <TouchableOpacity onPress={() => setF(EMPTY_FILTERS)}><Text style={s.clear}>Clear all</Text></TouchableOpacity>
              <Text style={s.title}>Filters</Text>
              <TouchableOpacity onPress={() => { onApply(f); onClose(); }}><Text style={s.apply}>Apply</Text></TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              <Text style={s.label}>Price</Text>
              <View style={s.priceRow}>
                <TextInput style={s.input} value={f.minPrice} onChangeText={t => setF(p => ({ ...p, minPrice: t.replace(/[^0-9.]/g, '') }))} accessibilityLabel="Minimum price" placeholder="Min" placeholderTextColor={t.ink.secondary} keyboardType="decimal-pad" />
                <Text style={s.dash}>to</Text>
                <TextInput style={s.input} value={f.maxPrice} onChangeText={t => setF(p => ({ ...p, maxPrice: t.replace(/[^0-9.]/g, '') }))} accessibilityLabel="Maximum price" placeholder="Max" placeholderTextColor={t.ink.secondary} keyboardType="decimal-pad" />
              </View>

              <Text style={s.label}>Condition</Text>
              <View style={s.chips}>
                {MARKET_CONDITIONS.map((c: string) => (
                  <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: f.condition === c }} key={c} style={[s.chip, f.condition === c && s.chipOn]} onPress={() => setF(p => ({ ...p, condition: p.condition === c ? null : c }))}>
                    <Text style={[s.chipTxt, f.condition === c && s.chipTxtOn]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.label}>Location</Text>
              <TextInput style={[s.input, { width: '100%' }]} value={f.city} onChangeText={t => setF(p => ({ ...p, city: t }))} accessibilityLabel="Location" placeholder="e.g. Harare" placeholderTextColor={t.ink.secondary} />

              <Text style={s.label}>Sort by</Text>
              {SORTS.map(o => (
                <TouchableOpacity accessibilityRole="radio" accessibilityState={{ checked: f.sort === o.id }} key={o.id} style={s.sortRow} onPress={() => setF(p => ({ ...p, sort: o.id }))}>
                  <Text style={s.sortTxt}>{o.label}</Text>
                  <View style={[s.radio, f.sort === o.id && s.radioOn]} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = themedSheet((t) => ({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: t.surface.canvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 30 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D8D8DC', alignSelf: 'center', marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  title: { fontSize: 17, fontWeight: '800', color: t.ink.primary },
  clear: { fontSize: 14.5, color: t.ink.secondary, fontWeight: '600' },
  apply: { fontSize: 14.5, color: t.ink.primary, fontWeight: '800' },
  label: { fontSize: 13, fontWeight: '700', color: t.ink.primary, marginTop: 16, marginBottom: 8 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, backgroundColor: t.surface.raised, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15, color: t.ink.primary },
  dash: { fontSize: 14, color: t.ink.secondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 48, borderRadius: 24, backgroundColor: t.surface.raised, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: t.brand.base },
  chipTxt: { fontSize: 13.5, fontWeight: '600', color: t.ink.primary },
  chipTxtOn: { color: t.ink.inverse },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  sortTxt: { fontSize: 15, color: t.ink.primary },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: t.ink.muted },
  radioOn: { borderColor: t.ink.primary, borderWidth: 6 },
}));