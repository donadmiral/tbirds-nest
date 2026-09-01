/**
 * StudioRail - the right-hand tool rail of the Bottom Sheet Studio layout.
 * Four primary tools always visible, the rest behind the chevron. The rail
 * only calls handlers the composer already owns; it holds no editing state.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import StickerIcon, { type StickerIconName } from './StickerIcons';

export type RailItem = { id: string; label: string; feather?: React.ComponentProps<typeof Feather>['name']; icon?: StickerIconName; on?: boolean; run: () => void; primary?: boolean };

export default function StudioRail({ items, top }: { items: RailItem[]; top: number }) {
  const [open, setOpen] = useState(false);
  const primary = items.filter(i => i.primary);
  const rest = items.filter(i => !i.primary);
  const shown = open ? [...primary, ...rest] : primary;
  return (
    <View style={[r.wrap, { top }]} pointerEvents="box-none">
      <View style={r.rail}>
        {shown.map(it => (
          <TouchableOpacity key={it.id} style={r.btn} onPress={it.run} activeOpacity={0.7} hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}>
            <View style={[r.iconWrap, it.on && r.iconWrapOn]}>
              {it.icon ? <StickerIcon name={it.icon} size={20} color="#FFFFFF" bg="transparent" /> : <Feather name={it.feather || 'circle'} size={20} color="#FFFFFF" />}
            </View>
            <Text style={r.label} numberOfLines={1}>{it.label}</Text>
          </TouchableOpacity>
        ))}
        {rest.length > 0 && (
          <TouchableOpacity style={r.chev} onPress={() => setOpen(o => !o)} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}>
            <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const r = StyleSheet.create({
  wrap: { position: 'absolute', right: 10, zIndex: 30 },
  rail: { backgroundColor: 'rgba(12,16,26,0.58)', borderRadius: 24, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  btn: { alignItems: 'center', width: 52, paddingVertical: 5 },
  iconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  iconWrapOn: { backgroundColor: 'rgba(201,191,176,0.28)' },
  label: { color: 'rgba(255,255,255,0.92)', fontSize: 10, fontWeight: '600', marginTop: 1 },
  chev: { width: 32, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 2, backgroundColor: 'rgba(255,255,255,0.1)' },
});
