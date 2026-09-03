/**
 * ManageMentionsSheet
 *
 * Opened from the story ... menu on your own story. Lists everyone you
 * mentioned (visible tags and hidden mentions alike), lets you switch
 * resharing on or off per person, and remove a mention entirely.
 *
 * Honest limit: a visible @tag is drawn into the story's stickers at publish
 * time. Removing the mention here revokes story access, resharing and the
 * mention record, but the drawn tag stays on the media until the story is
 * deleted. The remove confirmation says so.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, Alert, ActivityIndicator,
  FlatList, Image, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import VerifiedBadge from '../VerifiedBadge';

type MentionRow = {
  id: string;
  mentioned_user_id: string;
  visible: boolean;
  allow_reshare: boolean;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  verified_tier: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  storyId: string;
};

const TIER_COLORS: Record<string, string> = { public_figure: '#22C55E', business: '#8E8E93', official: '#C9BFB0' };

const initials = (name?: string | null) =>
  (name || 'U').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

export default function ManageMentionsSheet({ visible, onClose, storyId }: Props) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<MentionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('story_mentions')
        .select('id, mentioned_user_id, visible, allow_reshare')
        .eq('story_id', storyId);
      if (error) throw error;
      const base = (data ?? []) as { id: string; mentioned_user_id: string; visible: boolean; allow_reshare: boolean }[];
      if (base.length === 0) { setRows([]); return; }
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, is_verified, verified_tier')
        .in('id', base.map(r => r.mentioned_user_id));
      const byId = new Map(((profs ?? []) as { id: string; full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean | null; verified_tier: string | null }[]).map(p => [p.id, p]));
      setRows(base.map(r => {
        const p = byId.get(r.mentioned_user_id);
        return { ...r, full_name: p?.full_name ?? null, username: p?.username ?? null, avatar_url: p?.avatar_url ?? null, verified_tier: p?.is_verified ? (p?.verified_tier || 'business') : null };
      }));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const toggleReshare = async (row: MentionRow, next: boolean) => {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, allow_reshare: next } : r));
    const { error } = await supabase.from('story_mentions').update({ allow_reshare: next }).eq('id', row.id);
    if (error) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, allow_reshare: !next } : r));
      Alert.alert('Could not update', error.message);
    }
  };

  const removeMention = (row: MentionRow) => {
    const name = row.full_name || (row.username ? '@' + row.username : 'this person');
    Alert.alert(
      'Remove mention?',
      row.visible
        ? name + ' loses story access and resharing. The @tag drawn on the story stays until the story is deleted.'
        : name + ' loses story access and resharing.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('story_mentions').delete().eq('id', row.id);
          if (error) { Alert.alert('Could not remove', error.message); return; }
          setRows(prev => prev.filter(r => r.id !== row.id));
        } },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={s.handle} />
          <Text style={s.title}>Mentions</Text>
          <Text style={s.sub}>People you mentioned in this story.</Text>
          {loading ? (
            <View style={s.busy}><ActivityIndicator color="#FFFFFF" /></View>
          ) : rows.length === 0 ? (
            <View style={s.busy}><Text style={s.emptyTxt}>No one is mentioned in this story.</Text></View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={r => r.id}
              style={{ maxHeight: 380 }}
              renderItem={({ item }) => (
                <View style={s.row}>
                  {item.avatar_url ? (
                    <Image source={{ uri: item.avatar_url }} style={s.avatar} />
                  ) : (
                    <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{initials(item.full_name)}</Text></View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[s.name, { flexShrink: 1 }, item.verified_tier ? { color: TIER_COLORS[item.verified_tier] || TIER_COLORS.business } : null]} numberOfLines={1}>{item.full_name || 'User'}</Text>
                      <VerifiedBadge userId={item.mentioned_user_id} size={12} />
                    </View>
                    <Text style={s.meta} numberOfLines={1}>
                      {(item.username ? '@' + item.username + ' - ' : '') + (item.visible ? 'On story' : 'Hidden')}
                    </Text>
                  </View>
                  <View style={s.reshareWrap}>
                    <Text style={s.reshareLbl}>Reshare</Text>
                    <Switch
                      value={item.allow_reshare}
                      onValueChange={(v) => toggleReshare(item, v)}
                      trackColor={{ false: 'rgba(255,255,255,0.18)', true: '#C9BFB0' }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                  <TouchableOpacity style={s.removeBtn} onPress={() => removeMention(item)} activeOpacity={0.7}>
                    <Feather name="x" size={16} color="#FF453A" />
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
          <TouchableOpacity style={s.cancel} onPress={onClose} activeOpacity={0.7}>
            <Text style={s.cancelTxt}>Done</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#16181C', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', alignSelf: 'center', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  sub: { fontSize: 12.5, color: 'rgba(255,255,255,0.55)', textAlign: 'center', marginTop: 3, marginBottom: 8 },
  busy: { paddingVertical: 30, alignItems: 'center' },
  emptyTxt: { fontSize: 14, color: 'rgba(255,255,255,0.6)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 11 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFb: { backgroundColor: '#2A2E36', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  name: { fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' },
  meta: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  reshareWrap: { alignItems: 'center', marginRight: 2 },
  reshareLbl: { fontSize: 9.5, fontWeight: '700', color: 'rgba(255,255,255,0.45)', marginBottom: 1, textTransform: 'uppercase', letterSpacing: 0.4 },
  removeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,69,58,0.12)', alignItems: 'center', justifyContent: 'center' },
  cancel: { marginTop: 8, marginHorizontal: 16, paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' },
  cancelTxt: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
});
