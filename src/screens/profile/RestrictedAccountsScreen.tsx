/**
 * RestrictedAccountsScreen
 *
 * Restrict is the quiet alternative to a block: a restricted person's comments on
 * your posts stay hidden until you approve them, their messages wait in Message
 * requests, and nothing they do notifies you. They are never told. This screen
 * lists them and undoes it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  Image, Alert, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { typeSize, fontWeight, radius, space } from '../../constants/tokens';
import VerifiedBadge from '../../components/VerifiedBadge';
import TierName from '../../components/TierName';
import { themedSheet, getTheme } from '../../theme/useTheme';

type Restricted = {
  user_id: string;
  created_at: string | null;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

export default function RestrictedAccountsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Restricted[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('get_restricted_accounts');
    if (err) { setError(err.message); setLoading(false); return; }
    setRows(((data ?? []) as any[]).map((r) => ({
      user_id: r.user_id, created_at: r.created_at ?? null,
      full_name: r.full_name ?? null, username: r.username ?? null, avatar_url: r.avatar_url ?? null,
    })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const unrestrict = (row: Restricted) => {
    const name = row.full_name || (row.username ? `@${row.username}` : 'this person');
    Alert.alert(
      'Unrestrict?',
      `${name}'s comments will show on your posts as usual and their messages will come straight to your chats.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unrestrict',
          onPress: async () => {
            setBusy(b => ({ ...b, [row.user_id]: true }));
            const before = rows;
            setRows(r => r.filter(x => x.user_id !== row.user_id));
            const { error: err } = await supabase.rpc('set_restriction', { p_user: row.user_id, p_on: false });
            setBusy(b => { const n = { ...b }; delete n[row.user_id]; return n; });
            if (err) { setRows(before); Alert.alert('Could not unrestrict', err.message); }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button" accessibilityLabel="Go back"
        >
          <Feather name="chevron-left" size={26} color={getTheme().ink.primary} />
        </TouchableOpacity>
        <Text style={s.title}>Restricted accounts</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={getTheme().brand.base} /></View>
      ) : error ? (
        <View style={s.centered}>
          <Feather name="alert-circle" size={30} color={getTheme().ink.faint} />
          <Text style={s.emptyTitle}>Could not load restricted accounts</Text>
          <Text style={s.emptySub}>{error}</Text>
          <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); load(); }}>
            <Text style={s.retryTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.centered}>
          <Feather name="user-minus" size={30} color={getTheme().ink.faint} />
          <Text style={s.emptyTitle}>Nobody is restricted</Text>
          <Text style={s.emptySub}>
            Restrict someone from their profile or from one of their comments. Their comments on your posts then wait for your approval, their messages go to Message requests, and they are not told.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.user_id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: space.sm, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
          renderItem={({ item }) => (
            <View style={s.row}>
              <TouchableOpacity onPress={() => navigation.navigate('UserProfile', { userId: item.user_id })} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`Open ${item.full_name || 'profile'}`}>
                {item.avatar_url ? (
                  <Image source={{ uri: item.avatar_url }} style={s.avatar} />
                ) : (
                  <View style={[s.avatar, s.avatarFallback]}>
                    <Text style={s.avatarTxt}>{initials(item.full_name)}</Text>
                  </View>
                )}
              </TouchableOpacity>
              <View style={s.rowText}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <TierName userId={item.user_id} baseStyle={s.name} text={item.full_name || 'User'} numberOfLines={1} />
                  <VerifiedBadge userId={item.user_id} size={12} />
                </View>
                {item.username ? <Text style={s.handle} numberOfLines={1}>@{item.username}</Text> : null}
              </View>
              <TouchableOpacity
                style={s.undoBtn}
                onPress={() => unrestrict(item)}
                disabled={!!busy[item.user_id]}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Unrestrict ${item.full_name || 'user'}`}
              >
                {busy[item.user_id]
                  ? <ActivityIndicator size="small" color={getTheme().ink.primary} />
                  : <Text style={s.undoTxt}>Unrestrict</Text>}
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline,
  },
  title: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: t.ink.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: space.xs },
  emptyTitle: { fontSize: typeSize.emphasis, fontWeight: fontWeight.bold, color: t.ink.primary, marginTop: space.xs },
  emptySub: { fontSize: typeSize.caption, color: t.ink.muted, textAlign: 'center', lineHeight: 19 },
  retry: {
    marginTop: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs,
    borderRadius: radius.full, backgroundColor: t.brand.base,
  },
  retryTxt: { color: t.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: t.surface.sunken },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.brand.base },
  avatarTxt: { color: t.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },
  rowText: { flex: 1 },
  name: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: t.ink.primary },
  handle: { fontSize: typeSize.caption, color: t.ink.muted, marginTop: 1 },
  undoBtn: {
    minWidth: 92, alignItems: 'center',
    paddingHorizontal: space.sm, paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline,
  },
  undoTxt: { fontSize: typeSize.caption, fontWeight: fontWeight.bold, color: t.ink.primary },
}));
