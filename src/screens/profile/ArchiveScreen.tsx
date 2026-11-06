import SettingsExit from '../../components/SettingsExit';
import { settingsBack } from '../../navigation/settingsNavigation';
/**
 * Archive: posts you hid from everyone without deleting. Restore puts one
 * back exactly as it was, with its likes and comments.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StatusBar, Alert, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { themedSheet, useTheme } from '../../theme/useTheme';
import { createScreenReadGuard, isReadAccessDenied, requireReadRows } from '../../../shared/readContinuity';
import { orderTimeout } from '../../../shared/orderRequest';
import { hydratePostMedia, withoutPrivateMedia } from '../../services/contentMedia';

type Row = { id: string; content: string | null; body: string | null; article_title: string | null; archived_at: string; created_at: string; post_media: { url: string; media_type: string }[] | null };

export default function ArchiveScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t, isDark } = useTheme();
  const userId = useAuthStore(state => state.profile?.id ?? null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reads] = useState(() => createScreenReadGuard(userId));
  reads.setScope(userId);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const current = reads.begin(userId);
    if (!current()) return;
    setLoading(true); setLoadError(null);
    try {
      const { data, error } = await orderTimeout(supabase.from('posts').select('id, content, body, article_title, archived_at, created_at, post_media(url, media_type)').eq('user_id', userId).not('archived_at', 'is', null).order('archived_at', { ascending: false }), 15000, 'Your archive could not be loaded.');
      if (error) throw error;
      if (!current()) return;
      const secured = await hydratePostMedia(requireReadRows<Row>(data)).catch(() => {
        if (current()) setLoadError('Some archived images could not load. Tap to retry.');
        return withoutPrivateMedia(requireReadRows<Row>(data));
      });
      if (current()) setRows(secured);
    } catch (error) {
      if (current()) { if (isReadAccessDenied(error)) setRows([]); setLoadError('Your archive could not be refreshed. Tap to retry.'); }
    } finally { if (current()) setLoading(false); }
  }, [userId, reads]);
  useEffect(() => { setRows([]); setLoading(!!userId); setLoadError(null); void load(); return () => reads.invalidate(); }, [load, userId, reads]);

  const restore = (r: Row) => {
    Alert.alert('Restore post?', 'It returns to your profile and feeds as it was.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', onPress: async () => { const { error } = await supabase.from('posts').update({ archived_at: null }).eq('id', r.id); if (error) { Alert.alert('Not restored', error.message); return; } load(); } },
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => settingsBack(navigation, 'Settings')} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="chevron-left" size={26} color={t.ink.primary} /></TouchableOpacity>
        <Text style={s.title}>Archive</Text>
        <SettingsExit navigation={navigation} />
      </View>
      {loadError ? <TouchableOpacity accessibilityRole="button" onPress={() => { void load(); }}><Text accessibilityRole="alert" style={s.empty}>{loadError}</Text></TouchableOpacity> : null}
      {loading && rows.length === 0 ? <ActivityIndicator color={t.ink.primary} style={{ marginTop: 30 }} /> : (
        <FlatList data={rows} keyExtractor={(r) => r.id} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
          refreshing={loading} onRefresh={() => { void load(); }}
          ListEmptyComponent={loadError ? null : <Text style={s.empty}>Nothing archived. Archive a post from its menu to hide it without deleting it.</Text>}
          renderItem={({ item }) => {
            const img = (item.post_media || []).find((m) => m.media_type === 'image')?.url || null;
            return (
              <View style={s.row}>
                {img ? <Image source={{ uri: img }} style={s.thumb} /> : <View style={[s.thumb, { backgroundColor: t.surface.sunken }]} />}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.text} numberOfLines={2}>{item.article_title || item.content || item.body || 'Post'}</Text>
                  <Text style={s.when}>Archived {new Date(item.archived_at).toLocaleDateString()}</Text>
                </View>
                <TouchableOpacity style={s.restore} onPress={() => restore(item)} activeOpacity={0.85}><Text style={s.restoreTxt}>Restore</Text></TouchableOpacity>
              </View>
            );
          }} />
      )}
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: t.ink.primary },
  empty: { fontSize: 13.5, lineHeight: 19, color: t.ink.muted, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  thumb: { width: 52, height: 52, borderRadius: 10 },
  text: { fontSize: 14, fontWeight: '600', color: t.ink.primary },
  when: { fontSize: 12, color: t.ink.muted, marginTop: 2 },
  restore: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: t.brand.base },
  restoreTxt: { color: t.ink.inverse, fontSize: 13, fontWeight: '800' },
}));
