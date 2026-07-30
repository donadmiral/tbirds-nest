import TierName from '../../../../../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
/**
 * BusinessesScreen
 *
 * The businesses you run. Empty for almost everyone, so the empty state has to
 * explain what a business is rather than just say there are none.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useActorStore } from '../../stores/actorStore';
import { light, typeSize, fontWeight, radius, space } from '../../constants/tokens';

type Row = {
  business_id: string; full_name: string | null; username: string | null;
  avatar_url: string | null; role: string; category: string | null;
  is_verified: boolean; member_count: number; post_count: number;
};

function initials(name?: string | null) {
  if (!name) return 'B';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

export default function BusinessesScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('get_my_businesses');
    if (err) { setError(err.message); setLoading(false); return; }
    setRows((data ?? []) as Row[]);
    setLoading(false);
    useActorStore.getState().loadActors();
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="chevron-left" size={26} color={light.ink.primary} />
        </TouchableOpacity>
        <Text style={s.title}>Businesses</Text>
        <TouchableOpacity onPress={() => navigation.navigate('CreateBusiness')} style={s.newBtn}>
          <Text style={s.newTxt}>New</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={light.brand.base} /></View>
      ) : error ? (
        <View style={s.centered}>
          <Feather name="alert-circle" size={30} color={light.ink.faint} />
          <Text style={s.emptyTitle}>Could not load your businesses</Text>
          <Text style={s.emptySub}>{error}</Text>
          <TouchableOpacity style={s.cta} onPress={() => { setLoading(true); load(); }}>
            <Text style={s.ctaTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.centered}>
          <Feather name="briefcase" size={30} color={light.ink.faint} />
          <Text style={s.emptyTitle}>No businesses yet</Text>
          <Text style={s.emptySub}>
            A business gets its own profile, followers, posts and chats. You stay signed in as
            yourself and choose who to post as. Your team gets access without sharing a password.
          </Text>
          <TouchableOpacity style={s.cta} onPress={() => navigation.navigate('CreateBusiness')}>
            <Text style={s.ctaTxt}>Create a business</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.business_id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: space.sm, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.row}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('BusinessManage', { businessId: item.business_id })}
            >
              {item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{initials(item.full_name)}</Text></View>
              )}
              <View style={s.rowText}>
                <View style={s.nameRow}>
                  <TierName userId={item.id} baseStyle={s.name} text={item.full_name || 'Business'} />
                  <VerifiedBadge userId={item.id} size={13} />
                </View>
                <Text style={s.meta} numberOfLines={1}>
                  {item.category ? `${item.category}  ·  ` : ''}
                  {item.post_count} post{item.post_count === 1 ? '' : 's'}
                  {`  ·  ${item.member_count} on the team`}
                </Text>
              </View>
              <View style={s.roleChip}><Text style={s.roleTxt}>{item.role}</Text></View>
              <Feather name="chevron-right" size={16} color={light.ink.faint} />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const HAIR = StyleSheet.hairlineWidth;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: light.surface.canvas },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: space.sm,
    borderBottomWidth: HAIR, borderBottomColor: light.surface.hairline,
  },
  title: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },
  newBtn: { paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.full, backgroundColor: light.brand.base },
  newTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: space.xs },
  emptyTitle: { fontSize: typeSize.emphasis, fontWeight: fontWeight.bold, color: light.ink.primary, marginTop: space.xs },
  emptySub: { fontSize: typeSize.caption, color: light.ink.muted, textAlign: 'center', lineHeight: 19 },
  cta: { marginTop: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs, borderRadius: radius.full, backgroundColor: light.brand.base },
  ctaTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: light.surface.sunken },
  avatarFb: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.warm },
  avatarTxt: { color: light.brand.base, fontSize: typeSize.body, fontWeight: fontWeight.heavy },
  rowText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: light.ink.primary },
  meta: { fontSize: typeSize.micro, color: light.ink.muted, marginTop: 1 },
  roleChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, backgroundColor: light.brand.tintBg },
  roleTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: light.ink.primary, textTransform: 'capitalize' },
});
