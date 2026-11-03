import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { LiveIcon } from './LiveIcon';

type FeedMode = 'forYou' | 'latest' | 'discover' | 'trending';
const TABS = [['forYou', 'For You'], ['latest', 'Latest'], ['discover', 'Discover'], ['trending', 'Trending'], ['live', 'Live']] as const;

export function FeedNavigationTabs({ selected, onSelect, onLive }: {
  selected: FeedMode | 'live' | 'innovation'; onSelect(mode: FeedMode): void; onLive(): void;
}) {
  const { t } = useTheme();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.scroll}
    contentContainerStyle={s.row} accessibilityLabel="Feed navigation">
    {TABS.map(([id, label]) => {
      const active = id === selected;
      const color = active ? t.ink.primary : t.ink.secondary;
      return <TouchableOpacity key={id} testID={`feed-tab-${id}`} accessibilityRole="tab"
        accessibilityLabel={id === 'live' ? 'Live streams' : label} accessibilityState={{ selected: active }}
        onPress={() => id === 'live' ? onLive() : onSelect(id)} activeOpacity={.7} style={s.tab}>
        <View style={s.labelRow}>
          {id === 'live' ? <LiveIcon size={16} color={color} /> : null}
          <Text style={[s.label, { color, fontWeight: active ? '800' : '500' }]}>{label}</Text>
        </View>
        <View style={[s.underline, { backgroundColor: active ? id === 'discover' ? t.status.innovation : t.ink.primary : 'transparent' }]} />
      </TouchableOpacity>;
    })}
  </ScrollView>;
}
const s = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { flexGrow: 1, alignItems: 'stretch' },
  tab: { flexGrow: 1, flexShrink: 0, minWidth: 44, minHeight: 48, paddingHorizontal: 6, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  labelRow: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { fontSize: 15, lineHeight: 22, letterSpacing: -.2, includeFontPadding: false },
  underline: { height: 3, width: 20, borderRadius: 2, marginTop: 5 },
});
