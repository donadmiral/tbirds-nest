/**
 * StudioRail - the right-hand tool rail of the Bottom Sheet Studio layout.
 * Four primary tools always visible, the rest behind the chevron. The rail
 * only calls handlers the composer already owns; it holds no editing state.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import StickerIcon, { type StickerIconName } from './StickerIcons';

export type RailItem = { id: string; label: string; feather?: React.ComponentProps<typeof Feather>['name']; icon?: StickerIconName; on?: boolean; run: () => void; primary?: boolean };

export default function StudioRail({ items, top, maxHeight }: { items: RailItem[]; top: number; maxHeight: number }) {
  const [open, setOpen] = useState(false);
  const primary = items.filter(i => i.primary).slice(0, 3);
  const rest = items.filter(i => !primary.includes(i));
  return (
    <View style={[r.wrap, { top }]} pointerEvents="box-none">
      <View style={r.primary}>
        {primary.map(it => <TouchableOpacity key={it.id} accessibilityRole="button" accessibilityLabel={it.label} accessibilityState={{ selected: !!it.on }} style={[r.iconWrap, it.on && r.iconWrapOn]} onPress={it.run}>{it.icon ? <StickerIcon name={it.icon} size={21} color="#FFFFFF" bg="transparent" /> : <Feather name={it.feather || 'circle'} size={21} color="#FFFFFF" />}</TouchableOpacity>)}
        {rest.length > 0 ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={open ? "Show fewer story tools" : "Show more story tools"} accessibilityState={{ expanded: open }} style={r.iconWrap} onPress={() => setOpen(o => !o)}><Feather name={open ? 'x' : 'more-horizontal'} size={22} color="#FFFFFF" /></TouchableOpacity> : null}
      </View>
      {open ? <ScrollView style={[r.rail, { maxHeight: Math.max(120, maxHeight) }]} contentContainerStyle={r.railContent} showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled">
        {rest.map(it => <TouchableOpacity accessibilityRole="button" accessibilityLabel={it.label} accessibilityState={{ selected: !!it.on }} key={it.id} style={[r.btn, it.on && r.selected]} onPress={() => { setOpen(false); it.run(); }} activeOpacity={0.7}>
          {it.icon ? <StickerIcon name={it.icon} size={19} color="#FFFFFF" bg="transparent" /> : <Feather name={it.feather || 'circle'} size={19} color="#FFFFFF" />}
          <Text style={r.label} numberOfLines={1}>{it.label}</Text>
        </TouchableOpacity>)}
      </ScrollView> : null}
    </View>
  );
}

const r = StyleSheet.create({
  wrap: { position: 'absolute', right: 14, zIndex: 30, alignItems: 'flex-end' },
  primary: { flexDirection: 'row', gap: 8 },
  rail: { width: 174, marginTop: 10, backgroundColor: 'rgba(25,28,31,0.98)', borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
  railContent: { padding: 8, gap: 3 },
  btn: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44, paddingHorizontal: 10, borderRadius: 14 },
  selected: { backgroundColor: 'rgba(232,211,182,0.2)' },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(25,28,31,0.62)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  iconWrapOn: { backgroundColor: 'rgba(232,211,182,0.35)' },
  label: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
