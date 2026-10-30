import { themedSheet, getTheme } from '../../theme/useTheme';
import EmptyState from '../../components/EmptyState';
import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
/**
 * BusinessesScreen
 *
 * The businesses you run. Empty for almost everyone, so the empty state has to
 * explain what a business is rather than just say there are none.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image, StatusBar, Alert, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { typeSize, fontWeight, radius, space } from '../../constants/tokens';
import { BusinessSessionError, businessSessionMessage, businessSessionStep, installBusinessSession, isBusinessSessionHandoff, prepareBusinessSession, type BusinessSessionHandoff } from '../../services/businessSessionService';

type Row = {
  business_id: string; full_name: string | null; username: string | null;
  avatar_url: string | null; role: string; category: string | null;
  is_verified: boolean; member_count: number; post_count: number;
};
type Confirmation = { businessId: string; owner: string; version: number };

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
  const [uid, setUid] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null), [installing, setInstalling] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const live = useRef(false), account = useRef<string | null | undefined>(undefined), generation = useRef(0), reads = useRef(0);
  const pending = useRef<AbortController | null>(null), readRequest = useRef<AbortController | null>(null);
  const handoff = useRef<BusinessSessionHandoff | null>(null), confirmation = useRef<Confirmation | null>(null);

  const applyAccount = useCallback((next: string | null) => {
    if (next === account.current) return;
    account.current = next; generation.current++; pending.current?.abort(); pending.current = null; handoff.current = null; confirmation.current = null;
    setUid(next); setRows([]); setOpening(null); setInstalling(false); setNotice(null);
  }, []);

  const load = useCallback(async () => {
    if (!live.current) return;
    const request = ++reads.current, abort = new AbortController(); readRequest.current?.abort(); readRequest.current = abort;
    const current = () => live.current && request === reads.current && !abort.signal.aborted;
    setError(null); setLoading(true);
    try {
      const auth = await businessSessionStep(supabase.auth.getUser(), abort.signal);
      if (!current()) return;
      if (auth.error && auth.error.name !== 'AuthSessionMissingError') throw auth.error;
      const owner = auth.data.user?.id ?? null; applyAccount(owner);
      if (!owner) return;
      const result = await businessSessionStep(supabase.rpc('get_my_businesses'), abort.signal);
      if (!current()) return;
      if (result.error || !Array.isArray(result.data)) throw result.error || new Error('Business list unavailable');
      setRows(result.data as Row[]);
    } catch { if (current()) setError('Your businesses could not be loaded. Confirm your personal account and try again.'); }
    finally { if (current()) setLoading(false); if (readRequest.current === abort) readRequest.current = null; abort.abort(); }
  }, [applyAccount]);

  useFocusEffect(useCallback(() => {
    live.current = true;
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !live.current || isBusinessSessionHandoff(handoff.current, session)) return;
      const next = session?.user.id ?? null;
      if (next === account.current) return;
      reads.current++; readRequest.current?.abort(); readRequest.current = null;
      applyAccount(next); setError(null); setLoading(!!next);
      const version = generation.current;
      queueMicrotask(() => { if (active && live.current && version === generation.current && next) void load(); });
    });
    void load();
    return () => {
      active = false; live.current = false; generation.current++; reads.current++;
      pending.current?.abort(); pending.current = null; readRequest.current?.abort(); readRequest.current = null; handoff.current = null; confirmation.current = null;
      subscription.unsubscribe();
    };
  }, [load, applyAccount]));

  const openStudio = async (businessId: string, approved?: Confirmation) => {
    const owner = account.current;
    if (!owner || !live.current || pending.current || !rows.some(row => row.business_id === businessId && row.role === 'owner')) return;
    if (approved && (confirmation.current !== approved || approved.owner !== owner || approved.version !== generation.current || approved.businessId !== businessId)) return;
    const version = generation.current, abort = new AbortController(); pending.current = abort; confirmation.current = null;
    const current = () => live.current && version === generation.current && pending.current === abort && !abort.signal.aborted;
    setOpening(businessId); setNotice(null);
    try {
      const destination = await prepareBusinessSession(supabase, { kind: 'owner', businessId, bootstrapOwner: !!approved }, owner, current, abort.signal, `${Platform.OS} app`);
      if (!current()) return;
      handoff.current = { businessId: destination.business_id, accessToken: destination.session.access_token }; setInstalling(true);
      await installBusinessSession(supabase, destination, current, abort.signal);
      if (current()) { setRows([]); setNotice('Business access confirmed. Opening your account…'); }
    } catch (failure) {
      if (!current()) return;
      if (failure instanceof BusinessSessionError && failure.code === 'OWNER_BOOTSTRAP_REQUIRED') {
        const approval = { businessId, owner, version }; confirmation.current = approval;
        const dismiss = () => { if (confirmation.current === approval) confirmation.current = null; };
        Alert.alert('Set up your owner access?', 'This creates your owner seat and registers this device as approved for your business. You can then add staff and review their devices in Studio → Team.', [
          { text: 'Cancel', style: 'cancel', onPress: dismiss },
          { text: 'Set up owner access', onPress: () => {
            if (live.current && account.current === owner && version === generation.current && confirmation.current === approval) void openStudio(businessId, approval);
          } },
        ], { cancelable: true, onDismiss: dismiss });
      } else Alert.alert('Business access', businessSessionMessage(failure));
    } finally {
      if (pending.current === abort) {
        pending.current = null; handoff.current = null; abort.abort();
        if (live.current && version === generation.current) { setOpening(null); setInstalling(false); }
      }
    }
  };

  const cancel = () => {
    if (handoff.current || !pending.current) return;
    generation.current++; pending.current.abort(); pending.current = null; confirmation.current = null;
    setOpening(null); setInstalling(false); setNotice('Business sign-in cancelled. Your personal account is unchanged.');
  };
  const leave = (screen?: string, params?: object) => {
    if (handoff.current) return;
    cancel();
    if (screen) navigation.navigate(screen, params); else navigation.goBack();
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => leave()} disabled={installing} accessibilityRole="button" accessibilityLabel="Back" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="chevron-left" size={26} color={getTheme().ink.primary} />
        </TouchableOpacity>
        <Text style={s.title}>Businesses</Text>
        <TouchableOpacity onPress={() => leave('CreateBusiness')} disabled={installing} accessibilityRole="button" style={s.newBtn}>
          <Text style={s.newTxt}>New</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.intro}>Open Studio to switch into a business account after its owner and device access are verified.</Text>
      {notice && <Text accessibilityLiveRegion="polite" style={s.intro}>{notice}</Text>}
      {opening && <View style={s.accessNotice}><Text accessibilityLiveRegion="polite" style={s.meta}>{installing ? 'Opening your business account…' : 'Checking owner and device access…'}</Text>{!installing && <TouchableOpacity onPress={cancel} accessibilityRole="button" accessibilityLabel="Cancel sign-in" style={s.secondary}><Text style={s.roleTxt}>Cancel sign-in</Text></TouchableOpacity>}</View>}

      {loading ? (
        <View style={s.centered}><ActivityIndicator color={getTheme().brand.base} /></View>
      ) : error ? (
        <View style={s.centered}>
          <Feather name="alert-circle" size={30} color={getTheme().ink.faint} />
          <Text style={s.emptyTitle}>Could not load your businesses</Text>
          <Text style={s.emptySub}>{error}</Text>
          <TouchableOpacity style={s.cta} onPress={() => { setLoading(true); load(); }}>
            <Text style={s.ctaTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.centered}>
          <Feather name="briefcase" size={30} color={getTheme().ink.faint} />
          <Text style={s.emptyTitle}>{uid ? 'No businesses yet' : 'Sign in to your personal account'}</Text>
          <Text style={s.emptySub}>
            A business gets its own profile, followers, posts and messages. Owners open its separate
            account from here. Staff use personal team access codes on approved devices.
          </Text>
          <TouchableOpacity style={s.cta} onPress={() => leave('CreateBusiness')}>
            <Text style={s.ctaTxt}>Create a business</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList ListEmptyComponent={<EmptyState icon="briefcase" title="No businesses here" line="Business accounts are separate now. They sign in through the business door on the login screen." />}
          data={rows}
          keyExtractor={r => r.business_id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: space.sm, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
          renderItem={({ item }) => (
            <View style={s.card}>
            <TouchableOpacity
              style={s.row}
              activeOpacity={0.75}
              disabled={installing}
              onPress={() => leave('BusinessManage', { businessId: item.business_id })}
              accessibilityRole="button"
              accessibilityLabel={`Manage ${item.full_name || 'business'}`}
            >
              {item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarTxt}>{initials(item.full_name)}</Text></View>
              )}
              <View style={s.rowText}>
                <View style={s.nameRow}>
                  <TierName userId={item.business_id} baseStyle={s.name} text={item.full_name || 'Business'} />
                  <VerifiedBadge userId={item.business_id} size={13} />
                </View>
                <Text style={s.meta} numberOfLines={1}>
                  {item.category ? `${item.category}  ·  ` : ''}
                  {item.post_count} post{item.post_count === 1 ? '' : 's'}
                  {`  ·  ${item.member_count} on the team`}
                </Text>
              </View>
              <View style={s.roleChip}><Text style={s.roleTxt}>{item.role}</Text></View>
              <Feather name="chevron-right" size={16} color={getTheme().ink.faint} />
            </TouchableOpacity>
            {item.role === 'owner' ? <TouchableOpacity onPress={() => void openStudio(item.business_id)} disabled={!!opening} accessibilityRole="button" accessibilityLabel={`Open ${item.full_name || 'business'} Studio`} style={[s.openButton, !!opening && { opacity: 0.5 }]}><Feather name="shield" size={16} color={getTheme().ink.inverse} /><Text style={s.ctaTxt}>Open Studio</Text></TouchableOpacity> : <Text style={s.teamHint}>Use your personal team access code at Business sign-in to open the business account.</Text>}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const HAIR = StyleSheet.hairlineWidth;

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: space.sm,
    borderBottomWidth: HAIR, borderBottomColor: t.surface.hairline,
  },
  title: { fontSize: typeSize.subhead, fontWeight: fontWeight.heavy, color: t.ink.primary },
  intro: { fontSize: typeSize.caption, lineHeight: 19, color: t.ink.muted, paddingHorizontal: 16, paddingVertical: 10 },
  accessNotice: { marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 12, backgroundColor: t.surface.sunken },
  secondary: { minHeight: 44, justifyContent: 'center' },
  card: { borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 14, padding: 12, marginBottom: 10 },
  openButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.brand.base, borderRadius: 10, paddingHorizontal: 12, marginTop: 6 },
  teamHint: { color: t.ink.muted, fontSize: typeSize.caption, lineHeight: 18, paddingTop: 8 },
  newBtn: { paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.full, backgroundColor: t.brand.base },
  newTxt: { color: t.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: space.xs },
  emptyTitle: { fontSize: typeSize.emphasis, fontWeight: fontWeight.bold, color: t.ink.primary, marginTop: space.xs },
  emptySub: { fontSize: typeSize.caption, color: t.ink.muted, textAlign: 'center', lineHeight: 19 },
  cta: { marginTop: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs, borderRadius: radius.full, backgroundColor: t.brand.base },
  ctaTxt: { color: t.ink.inverse, fontSize: typeSize.caption, fontWeight: fontWeight.bold },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: t.surface.sunken },
  avatarFb: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.brand.warm },
  avatarTxt: { color: t.brand.base, fontSize: typeSize.body, fontWeight: fontWeight.heavy },
  rowText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontSize: typeSize.body, fontWeight: fontWeight.semibold, color: t.ink.primary },
  meta: { fontSize: typeSize.micro, color: t.ink.muted, marginTop: 1 },
  roleChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, backgroundColor: t.brand.tintBg },
  roleTxt: { fontSize: typeSize.micro, fontWeight: fontWeight.bold, color: t.ink.primary, textTransform: 'capitalize' },
}));
