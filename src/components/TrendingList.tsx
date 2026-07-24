/**
 * TrendingList - X/Twitter style vertical trends.
 * Ranked rows: context line, topic, post count. Uses the same
 * get_trending_topics scoring the strip already relies on.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { supabase } from '../services/supabase';

type Topic = { tag: string; post_count: number; total_comments: number; score: number; unique_users: number; velocity: number; acceleration: number; rep_post_id: string | null; rep_content: string | null; rep_author: string | null };

function compact(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
  return String(n);
}

export default function TrendingList({ onOpenTag }: { onOpenTag?: (tag: string) => void }) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_trending_topics', { p_limit: 25 });
      if (!error && data) setTopics(data as Topic[]);
    } catch (e) { console.log('[TrendingList]', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const dismiss = useCallback(async (tag: string) => {
    setTopics(prev => prev.filter(x => x.tag !== tag));
    try {
      const { data: me } = await supabase.auth.getUser();
      if (me?.user) await supabase.from('trend_dismissals').upsert({ user_id: me.user.id, tag });
    } catch (e) { console.log('[dismiss]', e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={s.center}><ActivityIndicator color="#0B1E3D" /></View>;

  if (!topics.length) {
    return (
      <View style={s.center}>
        <Text style={s.emptyTitle}>Nothing trending yet</Text>
        <Text style={s.emptySub}>Post something and start a conversation.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      contentContainerStyle={{ paddingBottom: 120 }}
    >
      <Text style={s.heading}>Trends for you</Text>
      {topics.map((t, i) => {
        const rising = (t.acceleration ?? 0) > 0;
        return (
          <TouchableOpacity key={t.tag + i} style={s.row} activeOpacity={0.7} onPress={() => onOpenTag?.(t.tag)}>
            <View style={{ flex: 1 }}>
              <Text style={s.context}>
                {i + 1} · Trending in Zimbabwe{rising ? '  ·  Rising' : ''}
              </Text>
              <Text style={s.tag} numberOfLines={1}>#{t.tag}</Text>
              <Text style={s.count}>
                {compact(t.post_count)} {t.post_count === 1 ? 'post' : 'posts'}
                {t.unique_users > 1 ? '  ·  ' + compact(t.unique_users) + ' people' : ''}
              </Text>
              {!!t.rep_content && (
                <Text style={s.rep} numberOfLines={2}>
                  {t.rep_author ? t.rep_author + ': ' : ''}{t.rep_content}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => dismiss(t.tag)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.more}>···</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { paddingVertical: 60, alignItems: 'center', gap: 6 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#0A0A0A' },
  emptySub: { fontSize: 14, color: '#8E8E93' },
  heading: { fontSize: 20, fontWeight: '800', color: '#0A0A0A', letterSpacing: -0.5, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EFEFF4' },
  context: { fontSize: 13, color: '#8E8E93', fontWeight: '500' },
  tag: { fontSize: 15.5, fontWeight: '700', color: '#0A0A0A', marginTop: 2, letterSpacing: -0.2 },
  count: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  more: { fontSize: 16, color: '#C7C7CC', paddingLeft: 10, paddingTop: 2 },
  rep: { fontSize: 13.5, color: '#4B5563', marginTop: 6, lineHeight: 18 },
});