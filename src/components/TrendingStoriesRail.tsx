import { privateImageCachePolicy } from '../../shared/mediaDelivery';
/**
 * TrendingStoriesRail - a handful of the hottest public stories right now.
 * One bubble per person: their best story of the last 24h, ranked by views
 * plus double-weighted reactions, resolved against current visibility. The flame
 * says why they are here.
 */
import VerifiedBadge from './VerifiedBadge';
import TierName from './TierName';
import { themedSheet } from '../theme/useTheme';
import React, { useCallback, useState } from 'react';
import { AppState, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { hydrateStoryMedia } from '../services/contentMedia';
import { supabase } from '../services/supabase';
import PlatinumRing from './stories/PlatinumRing';
import { loadTrendingStories, type TrendingStory } from '../../shared/trendingStories';

type Hot = TrendingStory;

export default function TrendingStoriesRail() {
  const nav = useNavigation<any>();
  const [rows, setRows] = useState<Hot[]>([]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    let generation = 0;
    let viewer: string | null | undefined;
    const refresh = async () => {
      const request = ++generation;
      try {
        const hot = await loadTrendingStories({
            session: () => supabase.auth.getSession(),
            ranked: limit => supabase.rpc('get_trending_stories', { p_limit: limit }),
            stories: ids => supabase.from('stories').select('id,user_id,media_url,thumbnail_url,media_type,expires_at,created_at').in('id', ids),
          }, hydrateStoryMedia, 8);
        if (alive && request === generation) setRows(hot);
      } catch {
        // A failed access/media check must never leave a stale visible tile.
        if (alive && request === generation) setRows([]);
      }
    };
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 30000);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
      else { generation++; setRows([]); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (next === viewer) return;
      viewer = next; generation++; setRows([]);
      queueMicrotask(() => { if (alive) void refresh(); });
    });
    return () => { alive = false; generation++; clearInterval(timer); appState.remove(); subscription.unsubscribe(); };
  }, []));

  if (rows.length === 0) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Trending stories</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
        {rows.map((r) => (
          <TouchableOpacity key={r.story_id} style={s.tile} activeOpacity={0.85}
            onPress={() => nav.navigate('StoryViewer', { userIds: rows.map(x => x.user_id), startUserId: r.user_id, startStoryId: r.story_id })}>
            {r.thumb ? (
              <ExpoImage source={{ uri: r.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy={privateImageCachePolicy(r.thumb)} />
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
              <Text style={s.tileName} numberOfLines={1}><TierName userId={((r) as any)?.id ?? ((r) as any)?.user_id} baseStyle={s.tileName} text={r.full_name || ''} numberOfLines={1} /> <VerifiedBadge userId={((r) as any)?.id ?? ((r) as any)?.user_id} size={12} /></Text>
              <Text style={s.tileViews}>{r.views} views</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = themedSheet((t) => ({
  wrap: { paddingTop: 10, paddingBottom: 4 },
  title: { fontSize: 13, fontWeight: '800', color: t.ink.primary, letterSpacing: 0.3, paddingHorizontal: 14, marginBottom: 8, textTransform: 'uppercase' },
  rail: { paddingHorizontal: 12, gap: 14 },
  bubble: { alignItems: 'center', width: 76 },
  ringHolder: { width: 66, height: 66, alignItems: 'center', justifyContent: 'center' },
  ringSvg: { position: 'absolute', top: 0, left: 0 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: t.surface.sunken },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackTxt: { fontSize: 20, fontWeight: '700', color: t.ink.muted },
  flame: { position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: t.surface.canvas, alignItems: 'center', justifyContent: 'center' },
  flameTxt: { fontSize: 12 },
  name: { fontSize: 11, fontWeight: '600', color: t.ink.primary, marginTop: 5, maxWidth: 74 },
  views: { fontSize: 10, color: t.ink.muted, marginTop: 1 },
  tile: { width: 112, height: 176, borderRadius: 16, overflow: 'hidden', backgroundColor: t.surface.sunken },
  tileFallback: { backgroundColor: t.brand.base, alignItems: 'center', justifyContent: 'center' },
  tileShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 96 },
  tileFlame: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  tileFoot: { position: 'absolute', left: 8, right: 8, bottom: 8 },
  tileAvatarWrap: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: t.ink.inverse, overflow: 'hidden', marginBottom: 4, backgroundColor: t.surface.sunken },
  tileAvatar: { width: '100%', height: '100%' },
  tileName: { fontSize: 11.5, fontWeight: '700', color: t.ink.inverse },
  tileViews: { fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 1 },
}));