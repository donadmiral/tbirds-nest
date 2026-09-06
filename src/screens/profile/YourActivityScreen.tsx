/**
 * Your activity: likes, comments, reposts and saves, newest first, each with
 * the post it happened on. Instagram's page of the same name.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StatusBar, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { themedSheet, useTheme } from '../../theme/useTheme';

type Kind = 'likes' | 'comments' | 'reposts' | 'saved';
type Item = { key: string; post_id: string; when: string; note: string | null; text: string; image: string | null };
const TABS: { key: Kind; label: string; table: string }[] = [
  { key: 'likes', label: 'Likes', table: 'post_likes' }, { key: 'comments', label: 'Comments', table: 'post_comments' },
  { key: 'reposts', label: 'Reposts', table: 'post_reposts' }, { key: 'saved', label: 'Saved', table: 'post_bookmarks' },
];

function ago(iso: string): string { const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); if (m < 1) return 'Just now'; if (m < 60) return m + 'm'; const h = Math.floor(m / 60); if (h < 24) return h + 'h'; const d = Math.floor(h / 24); return d < 7 ? d + 'd' : new Date(iso).toLocaleDateString(); }

export default function YourActivityScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const { profile } = useAuthStore();
  const [kind, setKind] = useState<Kind>('likes');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const tab = TABS.find((x) => x.key === kind)!;
    const sel = kind === 'comments' ? 'id, post_id, created_at, body, content' : 'post_id, created_at';
    const { data: rows } = await supabase.from(tab.table).select(sel).eq('user_id', profile.id).order('created_at', { ascending: false }).limit(60);
    const list = (rows as any[]) || [];
    const ids = Array.from(new Set(list.map((r) => r.post_id).filter(Boolean)));
    const posts: Record<string, any> = {};
    if (ids.length) {
      const { data: ps } = await supabase.from('posts').select('id, content, body, article_title, post_media(url, media_type)').in('id', ids);
      (ps || []).forEach((p: any) => { posts[p.id] = p; });
    }
    setItems(list.filter((r) => posts[r.post_id]).map((r, i) => {
      const p = posts[r.post_id];
      return { key: (r.id || r.post_id) + ':' + i, post_id: r.post_id, when: r.created_at, note: kind === 'comments' ? (r.body || r.content || '') : null, text: p.article_title || p.content || p.body || 'Post', image: (p.post_media || []).find((m: any) => m.media_type === 'image')?.url || null };
    }));
    setLoading(false);
  }, [profile?.id, kind]);
  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="chevron-left" size={26} color={t.ink.primary} /></TouchableOpacity>
        <Text style={s.title}>Your activity</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={s.tabs}>
        {TABS.map((x) => (
          <TouchableOpacity key={x.key} onPress={() => setKind(x.key)} style={[s.tab, kind === x.key && s.tabOn]} activeOpacity={0.8}><Text style={[s.tabTxt, kind === x.key && s.tabTxtOn]}>{x.label}</Text></TouchableOpacity>
        ))}
      </View>
      {loading ? <ActivityIndicator color={t.ink.primary} style={{ marginTop: 30 }} /> : (
        <FlatList data={items} keyExtractor={(i) => i.key} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
          ListEmptyComponent={<Text style={s.empty}>Nothing here yet.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={s.row} activeOpacity={0.75} onPress={() => (navigation as any).navigate('Post', { postId: item.post_id })}>
              {item.image ? <Image source={{ uri: item.image }} style={s.thumb} /> : <View style={[s.thumb, { backgroundColor: t.surface.sunken }]} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                {item.note ? <Text style={s.note} numberOfLines={2}>{item.note}</Text> : null}
                <Text style={[s.text, item.note ? { color: t.ink.muted, fontWeight: '500' } : null]} numberOfLines={item.note ? 1 : 2}>{item.text}</Text>
              </View>
              <Text style={s.when}>{ago(item.when)}</Text>
            </TouchableOpacity>
          )} />
      )}
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: t.ink.primary },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: t.surface.hairline, backgroundColor: t.surface.canvas },
  tabOn: { backgroundColor: t.brand.base, borderColor: t.brand.base },
  tabTxt: { fontSize: 13, fontWeight: '700', color: t.ink.primary },
  tabTxtOn: { color: t.ink.inverse },
  empty: { fontSize: 13.5, color: t.ink.muted, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  thumb: { width: 48, height: 48, borderRadius: 10 },
  note: { fontSize: 14, fontWeight: '600', color: t.ink.primary },
  text: { fontSize: 14, fontWeight: '600', color: t.ink.primary },
  when: { fontSize: 12, color: t.ink.muted },
}));