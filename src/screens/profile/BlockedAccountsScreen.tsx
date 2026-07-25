/**
 * BlockedAccountsScreen
 *
 * Blocking was one-way. The post menu wrote to blocked_users and no screen
 * anywhere listed or removed a block, so a user who blocked by accident was
 * stuck permanently. This is the missing half.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  Image, Alert, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { light, typeSize, fontWeight, radius, space } from '../../constants/tokens';

type Blocked = {
  blocked_id: string;
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

export default function BlockedAccountsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = (profile as any)?.id ?? null;

  const [rows, setRows] = useState<Blocked[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setError(null);
    const { data, error: err } = await supabase
      .from('blocked_users')
      .select('blocked_id, created_at')
      .eq('blocker_id', userId)
      .order('created_at', { ascending: false });

    if (err) { setError(err.message); setLoading(false); return; }

    const ids = (data ?? []).map((r: any) => r.blocked_id);
    if (ids.length === 0) { setRows([]); setLoading(false); return; }

    const { data: people, error: pErr } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .in('id', ids);
    if (pErr) { setError(pErr.message); setLoading(false); return; }

    const byId = new Map((people ?? []).map((p: any) => [p.id, p]));
    setRows((data ?? []).map((r: any) => ({
      blocked_id: r.blocked_id,
      created_at: r.created_at,
      full_name: byId.get(r.blocked_id)?.full_name ?? null,
      username: byId.get(r.blocked_id)?.username ?? null,
      avatar_url: byId.get(r.blocked_id)?.avatar_url ?? null,
    })));
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const unblock = (row: Blocked) => {
    const name = row.full_name || (row.username ? `@${row.username}` : 'this person');
    Alert.alert(
      'Unblock?',
      `${name} will be able to see your posts and message you again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            setBusy(b => ({ ...b, [row.blocked_id]: true }));
            const before = rows;
            setRows(r => r.filter(x => x.blocked_id !== row.blocked_id));
            const { error: err } = await supabase
              .from('blocked_users')
              .delete()
              .eq('blocker_id', userId)
              .eq('blocked_id', row.blocked_id);
            setBusy(b => { const n = { ...b }; delete n[row.blocked_id]; return n; });
            if (err) {
              setRows(before);
              Alert.alert('Could not unblock', err.message);
            }
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
          <Feather name="chevron-left" size={26} color={light.ink.primary} />
        </TouchableOpacity>
        <Text style={s.title}>Blocked accounts</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={light.brand.base} /></View>
      ) : error ? (
        <View style={s.centered}>
          <Feather name="alert-circle" size={30} color={light.ink.faint} />
          <Text style={s.emptyTitle}>Could not load blocked accounts</Text>
          <Text style={s.emptySub}>{error}</Text>
          <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); load(); }}>
            <Text style={s.retryTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.centered}>
          <Feather name="slash" size={30} color={light.ink.faint} />
          <Text style={s.emptyTitle}>Nobody is blocked</Text>
          <Text style={s.emptySub}>
            When you block someone they cannot see your posts or message you. You can undo it here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.blocked_id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: space.sm, paddingBottom: insets.bottom + 40 }}
          renderItem={({ item }) => (
            <View style={s.row}>
              {item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Text style={s.avatarTxt}>{initials(item.full_name)}</Text>
                </View>
              )}
              <View style={s.rowText}>
                <Text style={s.name} numberOfLines={1}>{item.full_name || 'User'}</Text>
                {item.username ? <Text style={s.handle} numberOfLines={1}>@{item.username}</Text> : null}
              </View>
              <TouchableOpacity
                style={s.unblockBtn}
                onPress={() => unblock(item)}
                disabled={!!busy[item.blocked_id]}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${item.full_name || 'user'}`}
              >
                {busy[item.blocked_id]
                  ? <ActivityIndicator size="small" color={light.ink.primary} />
                  : <Text style={s.unblockTxt}>Unblock</Text>}
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: light.surface.canvas },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: light.surface.hairline,
  },
  title: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: light.ink.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: space.xs },
  emptyTitle: { fontSize: typeSize.emphasis, fontWeight: fontWeight.bold, color: light.ink.primary, marginTop: space.xs },
  emptySub: { fontSize: typeSize.caption, color: light.ink.muted, textAlign: 'center', lineHeight: 19 },
  retry: {
    marginTop: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs,
    borderRadius: radius.full, backgroundColor: light.brand.base,
  },
  retryTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: light.surface.sunken },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: light.brand.base },
  avatarTxt: { color: light.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },
  rowText: { flex: 1 },
  name: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: light.ink.primary },
  handle: { fontSize: typeSize.caption, color: light.ink.muted, marginTop: 1 },
  unblockBtn: {
    minWidth: 78, alignItems: 'center',
    paddingHorizontal: space.sm, paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: light.surface.hairline,
  },
  unblockTxt: { fontSize: typeSize.caption, fontWeight: fontWeight.bold, color: light.ink.primary },
});