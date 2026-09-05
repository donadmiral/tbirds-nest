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
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../services/supabase';
import PlatinumRing from './stories/PlatinumRing';
import { light } from '../constants/tokens';

type Hot = { story_id: string; user_id: string; full_name: string; username: string; avatar_url: string | null; views: number; reactions: number; heat: number; thumb?: string | null; media_type?: string | null };

export default function TrendingStoriesRail() {
  const nav = useNavigation<any>();
  const [rows, setRows] = useState<Hot[]>([]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    supabase.rpc('get_trending_stories', { p_limit: 8 })
      .then(async ({ data }) => {
        const hot = (data || []) as Hot[];
        // The rail shows the story itself, not just a face: fetch each story's
        // preview so a tile reads like the trending post cards next to it.
        try {
          const ids = hot.map(h => h.story_id).filter(Boolean);
          if (ids.length) {
            const { data: st } = await supabase.from('stories').select('id, media_url, thumbnail_url, media_type').in('id', ids);
            const by = new Map<string, any>(); ((st ?? []) as any[]).forEach(x => by.set(x.id, x));
            hot.forEach(h => { const x = by.get(h.story_id); if (x) { h.thumb = x.thumbnail_url || (x.media_type === 'image' ? x.media_url : null); h.media_type = x.media_type; } });
          }
        } catch {}
        if (alive) setRows(hot);
      });
    return () => { alive = false; };
  }, []));

  if (rows.length === 0) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Trending stories</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
        {rows.map((r) => (
          <TouchableOpacity key={r.story_id} style={s.tile} activeOpacity={0.85}
            onPress={() => nav.navigate('StoryViewer', { userIds: rows.map(x => x.user_id), startUserId: r.user_id })}>
            {r.thumb ? (
              <ExpoImage source={{ uri: r.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={[StyleSheet.absoluteFill, s.tileFallback]}><View style={s.ringSvg} pointerEvents="none"><PlatinumRing userId={r.user_id} size={66} active /></View></View>
            )}
            <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={s.tileShade} />
            <View style={s.tileFlame}><Text style={s.flameTxt}>{'\u{1F525}'}</Text></View>
            <View style={s.tileFoot}>
              <View style={s.tileAvatarWrap}>
                {r.avatar_url ? (
                  <ExpoImage source={{ uri: r.avatar_url }} style={s.tileAvatar} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <View style={[s.tileAvatar, s.fallback]}><Text style={[s.fallbackTxt, { fontSize: 13 }]}>{(r.full_name || '?').slice(0, 1)}</Text></View>
                )}
              </View>
              <Text style={s.tileName} numberOfLines={1}>{r.full_name}</Text>
              <Text style={s.tileViews}>{r.views} views</Text>
            </View>
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
  tile: { width: 112, height: 176, borderRadius: 16, overflow: 'hidden', backgroundColor: light.surface.sunken },
  tileFallback: { backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center' },
  tileShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 96 },
  tileFlame: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  tileFoot: { position: 'absolute', left: 8, right: 8, bottom: 8 },
  tileAvatarWrap: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#FFFFFF', overflow: 'hidden', marginBottom: 4, backgroundColor: light.surface.sunken },
  tileAvatar: { width: '100%', height: '100%' },
  tileName: { fontSize: 11.5, fontWeight: '700', color: '#FFFFFF' },
  tileViews: { fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 1 },
});