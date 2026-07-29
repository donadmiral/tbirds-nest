/**
 * TrendingStoriesRail - a handful of the hottest public stories right now.
 * One bubble per person: their best story of the last 24h, ranked by views
 * plus double-weighted reactions, floor of 3 views, capped at 8. The flame
 * says why they are here.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../services/supabase';
import PlatinumRing from './stories/PlatinumRing';
import { light } from '../constants/tokens';

type Hot = { story_id: string; user_id: string; full_name: string; username: string; avatar_url: string | null; views: number; reactions: number; heat: number };

export default function TrendingStoriesRail() {
  const nav = useNavigation<any>();
  const [rows, setRows] = useState<Hot[]>([]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    supabase.rpc('get_trending_stories', { p_limit: 8 })
      .then(({ data }) => { if (alive) setRows((data || []) as Hot[]); });
    return () => { alive = false; };
  }, []));

  if (rows.length === 0) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Trending stories</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
        {rows.map((r) => (
          <TouchableOpacity key={r.story_id} style={s.bubble} activeOpacity={0.85}
            onPress={() => nav.navigate('StoryViewer', { userId: r.user_id })}>
            <View style={s.ringHolder}>
              <View style={s.ringSvg} pointerEvents="none"><PlatinumRing userId={r.user_id} size={66} active /></View>
              {r.avatar_url ? (
                <ExpoImage source={{ uri: r.avatar_url }} style={s.avatar} contentFit="cover" cachePolicy="memory-disk" />
              ) : (
                <View style={[s.avatar, s.fallback]}><Text style={s.fallbackTxt}>{(r.full_name || '?').slice(0, 1)}</Text></View>
              )}
              <View style={s.flame}><Text style={s.flameTxt}>{'\u{1F525}'}</Text></View>
            </View>
            <Text style={s.name} numberOfLines={1}>{r.full_name}</Text>
            <Text style={s.views}>{r.views} views</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingTop: 10, paddingBottom: 4 },
  title: { fontSize: 13, fontWeight: '800', color: light.ink.primary, letterSpacing: 0.3, paddingHorizontal: 14, marginBottom: 8, textTransform: 'uppercase' },
  rail: { paddingHorizontal: 12, gap: 14 },
  bubble: { alignItems: 'center', width: 76 },
  ringHolder: { width: 66, height: 66, alignItems: 'center', justifyContent: 'center' },
  ringSvg: { position: 'absolute', top: 0, left: 0 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: light.surface.sunken },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackTxt: { fontSize: 20, fontWeight: '700', color: light.ink.muted },
  flame: { position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: light.surface.canvas, alignItems: 'center', justifyContent: 'center' },
  flameTxt: { fontSize: 12 },
  name: { fontSize: 11, fontWeight: '600', color: light.ink.primary, marginTop: 5, maxWidth: 74 },
  views: { fontSize: 10, color: light.ink.muted, marginTop: 1 },
});