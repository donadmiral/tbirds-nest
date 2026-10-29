import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { marketplacePrice, marketplaceReputation, type MarketplaceRecommendation } from '../../../shared/marketplaceRecommendations';

export default function MarketplaceShelf({ items, onOpen, onExplore, onGesture }: {
  items: MarketplaceRecommendation[];
  onOpen: (id: string) => void;
  onExplore: () => void;
  onGesture: (active: boolean) => void;
}) {
  const { t } = useTheme();
  if (!items.length) return null;
  return <View style={{ paddingVertical: 16, borderBottomWidth: 1, borderColor: t.surface.hairline, backgroundColor: t.surface.canvas }}>
    <View style={{ paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <View style={{ flex: 1 }}><Text style={{ color: t.ink.primary, fontSize: 16, fontWeight: '700' }}>From the marketplace</Text><Text style={{ color: t.ink.secondary, fontSize: 12, marginTop: 4 }}>Discover sellers and their latest finds</Text></View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Explore the marketplace" onPress={onExplore} style={{ minWidth: 64, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: t.ink.primary, fontSize: 13, fontWeight: '700' }}>Explore</Text></TouchableOpacity>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} directionalLockEnabled nestedScrollEnabled
      contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      onTouchStart={() => onGesture(true)} onTouchEnd={() => onGesture(false)} onTouchCancel={() => onGesture(false)}
      onScrollBeginDrag={() => onGesture(true)} onMomentumScrollEnd={() => onGesture(false)} onScrollEndDrag={() => onGesture(false)}>
      {items.map(item => <TouchableOpacity key={item.id} accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${marketplacePrice(item)}, ${marketplaceReputation(item)}`}
        onPress={() => onOpen(item.id)} activeOpacity={0.85}
        style={{ width: 160, overflow: 'hidden', borderRadius: 14, borderWidth: 1, borderColor: t.surface.hairline, backgroundColor: t.surface.sunken }}>
        <Image source={{ uri: item.image_url }} contentFit="cover" recyclingKey={item.id} style={{ width: 158, height: 124 }} />
        <View style={{ padding: 12, gap: 6 }}>
          <Text numberOfLines={1} style={{ color: t.ink.primary, fontSize: 14, fontWeight: '700' }}>{marketplacePrice(item)}</Text>
          <Text numberOfLines={2} style={{ color: t.ink.primary, fontSize: 12, lineHeight: 18, minHeight: 36 }}>{item.title}</Text>
          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            {Number(item.review_count) > 0 ? <Feather name="star" size={12} color={t.ink.secondary} /> : item.seller_verified ? <Feather name="shield" size={12} color={t.ink.secondary} /> : null}
            <Text style={{ color: t.ink.secondary, fontSize: 12 }}>{marketplaceReputation(item)}</Text>
          </View>
          <Text numberOfLines={1} style={{ color: t.ink.secondary, fontSize: 11 }}>{item.seller_name}</Text>
        </View>
      </TouchableOpacity>)}
    </ScrollView>
  </View>;
}
