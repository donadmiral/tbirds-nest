import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList,
  Image, ActivityIndicator, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import {
  Affiliation, AffiliationBrowseMode,
  listAffiliations, searchAffiliations,
  requestToJoinAffiliation, leaveAffiliation,
} from '../../services/affiliationsService';

const KIND_LABEL: Record<string, string> = {
  fraternity: 'Fraternity', sorority: 'Sorority', club: 'Club',
  cohort: 'Cohort', organization: 'Organization', team: 'Team',
  honor_society: 'Honor Society', other: 'Community',
};

const KIND_ICON: Record<string, any> = {
  fraternity: 'users', sorority: 'users', club: 'star',
  cohort: 'calendar', organization: 'briefcase', team: 'flag',
  honor_society: 'award', other: 'globe',
};

function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

const COLORS = ['#1D4ED8','#065F46','#7C2D12','#5856D6','#C2410C','#0F766E','#7C3AED','#0B1E3D'];
function colorFor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  return COLORS[Math.abs(h) % COLORS.length];
}

export default function AffiliationsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [mode, setMode] = useState<AffiliationBrowseMode>('my-school');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Affiliation[]>([]);
  const [searchResults, setSearchResults] = useState<Affiliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listAffiliations(mode, userId);
    setRows(data);
    setLoading(false);
  }, [mode, userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const data = await searchAffiliations(trimmed, userId);
      if (!cancelled) {
        setSearchResults(data);
        setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, userId]);

  const setBusy = (id: string, v: boolean) =>
    setBusyIds(p => { const n = { ...p }; if (v) n[id] = true; else delete n[id]; return n; });

  const handleJoin = async (a: Affiliation) => {
    if (!userId || busyIds[a.id]) return;
    setBusy(a.id, true);
    try {
      const result = await requestToJoinAffiliation(a.id);
      if (result === 'joined') {
        const apply = (list: Affiliation[]) => list.map(x =>
          x.id === a.id
            ? { ...x, is_member: true, my_role: 'member' as const, member_count: x.member_count + 1 }
            : x
        );
        setRows(apply);
        setSearchResults(apply);
      } else if (result === 'requested') {
        Alert.alert('Request sent', 'An admin will review your request.');
      } else if (result === 'already_requested') {
        Alert.alert('Already requested', 'Your request is pending review.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not join.');
    } finally {
      setBusy(a.id, false);
    }
  };

  const handleLeave = async (a: Affiliation) => {
    if (!userId || busyIds[a.id]) return;
    if (a.my_role === 'founder') {
      Alert.alert(
        'You are the founder',
        'Founders cannot leave their own affiliation.',
      );
      return;
    }
    Alert.alert(`Leave ${a.name}?`, 'You can rejoin later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive',
        onPress: async () => {
          setBusy(a.id, true);
          try {
            await leaveAffiliation(a.id, userId);
            const apply = (list: Affiliation[]) => list.map(x =>
              x.id === a.id
                ? { ...x, is_member: false, my_role: null, member_count: Math.max(0, x.member_count - 1) }
                : x
            );
            setRows(apply);
            setSearchResults(apply);
            if (mode === 'joined') setRows(prev => prev.filter(x => x.id !== a.id));
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Could not leave.');
          } finally {
            setBusy(a.id, false);
          }
        },
      },
    ]);
  };

  const openDetail = (a: Affiliation) => {
    navigation.navigate('AffiliationDetail', { affiliationId: a.id });
  };

  const renderItem = ({ item }: { item: Affiliation }) => {
    const busy = !!busyIds[item.id];
    const scopeLabel = item.institution_name || 'Global';
    const kindIcon = KIND_ICON[item.kind] || 'star';
    const kindLabel = KIND_LABEL[item.kind] || 'Community';

    return (
      <TouchableOpacity
        style={s.card}
        onPress={() => openDetail(item)}
        activeOpacity={0.85}
      >
        <View style={s.cardTop}>
          {item.logo_url ? (
            <Image source={{ uri: item.logo_url }} style={s.logo} />
          ) : (
            <View style={[s.logo, { backgroundColor: colorFor(item.id) }]}>
              <Text style={s.logoTxt}>{initials(item.name)}</Text>
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.name} numberOfLines={1}>{item.name}</Text>
            <View style={s.metaRow}>
              <Feather name={kindIcon} size={11} color="#6B7280" />
              <Text style={s.meta}>{kindLabel}</Text>
              <Text style={s.dot}>·</Text>
              <Feather
                name={item.institution_name ? 'award' : 'globe'}
                size={11}
                color={item.institution_name ? '#1D4ED8' : '#059669'}
              />
              <Text style={[s.meta, { color: item.institution_name ? '#1D4ED8' : '#059669' }]} numberOfLines={1}>
                {scopeLabel}
              </Text>
            </View>
            <Text style={s.count}>
              {item.member_count} {item.member_count === 1 ? 'member' : 'members'}
              {item.join_mode === 'request' ? ' · By request' : ''}
              {item.post_mode === 'informative' ? ' · Announcements only' : ''}
            </Text>
          </View>
          <TouchableOpacity
            style={[s.joinBtn, item.is_member && s.joinBtnJoined]}
            onPress={() => item.is_member ? handleLeave(item) : handleJoin(item)}
            disabled={busy}
            activeOpacity={0.8}
          >
            {busy ? (
              <ActivityIndicator color={item.is_member ? '#000' : '#FFF'} size={14} />
            ) : item.is_member ? (
              <Text style={s.joinBtnJoinedTxt}>Joined</Text>
            ) : (
              <Text style={s.joinBtnTxt}>{item.join_mode === 'request' ? 'Request' : 'Join'}</Text>
            )}
          </TouchableOpacity>
        </View>
        {item.description ? (
          <Text style={s.desc} numberOfLines={2}>{item.description}</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  const isSearching = query.trim().length >= 2;
  const displayRows = isSearching ? searchResults : rows;

  const noExactMatch = useMemo(() => {
    if (!isSearching) return false;
    const q = query.trim().toLowerCase();
    return !searchResults.some(r => r.name.toLowerCase() === q);
  }, [isSearching, query, searchResults]);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={s.title}>Communities</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={s.searchWrap}>
        <Feather name="search" size={15} color="#8E8E93" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search clubs, communities, cohorts"
          placeholderTextColor="#8E8E93"
          style={s.searchInput}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Feather name="x" size={15} color="#8E8E93" />
          </TouchableOpacity>
        )}
      </View>

      {!isSearching && (
        <View style={s.scopeRow}>
          {(['my-school', 'global', 'joined'] as const).map(m => (
            <TouchableOpacity
              key={m}
              style={[s.scopeTab, mode === m && s.scopeTabActive]}
              onPress={() => setMode(m)}
              activeOpacity={0.8}
            >
              <Feather
                name={m === 'my-school' ? 'award' : m === 'global' ? 'globe' : 'check-circle'}
                size={12}
                color={mode === m ? '#FFF' : '#6B7280'}
              />
              <Text style={[s.scopeTabTxt, mode === m && s.scopeTabTxtActive]}>
                {m === 'my-school' ? 'My School' : m === 'global' ? 'Global' : 'Joined'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading || (isSearching && searching) ? (
        <View style={s.loader}>
          <ActivityIndicator color="#000" />
        </View>
      ) : (
        <FlatList
          data={displayRows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 90 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="users" size={44} color="#E5E5EA" />
              <Text style={s.emptyTitle}>
                {isSearching
                  ? 'No exact matches'
                  : mode === 'joined'
                  ? 'Nothing joined yet'
                  : 'No communities yet'}
              </Text>
              <Text style={s.emptySub}>
                {isSearching
                  ? 'Be the first to start this one.'
                  : mode === 'joined'
                  ? 'Browse My School or Global tabs to find communities.'
                  : 'Tap Create to start the first one for your school.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            isSearching && noExactMatch && query.trim().length >= 2 ? (
              <TouchableOpacity
                style={s.createSuggestion}
                onPress={() => navigation.navigate('CreateAffiliation', { prefillName: query.trim() })}
                activeOpacity={0.85}
              >
                <View style={s.createSuggestionIcon}>
                  <Feather name="plus" size={18} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.createSuggestionTitle}>Create "{query.trim()}"</Text>
                  <Text style={s.createSuggestionSub}>Start a new community</Text>
                </View>
                <Feather name="chevron-right" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      <TouchableOpacity
        style={[s.fab, { bottom: insets.bottom + 18 }]}
        onPress={() => navigation.navigate('CreateAffiliation', { prefillName: '' })}
        activeOpacity={0.9}
      >
        <Feather name="plus" size={22} color="#FFF" />
        <Text style={s.fabTxt}>Create</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: '#000' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 14, marginTop: 14, marginBottom: 10,
    backgroundColor: '#F2F2F7', borderRadius: 13,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#000', padding: 0 },

  scopeRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, marginBottom: 8 },
  scopeTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#F5F5F5',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E8E8E8',
  },
  scopeTabActive: { backgroundColor: '#000', borderColor: '#000' },
  scopeTabTxt: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  scopeTabTxtActive: { color: '#FFF' },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  card: { backgroundColor: '#F7F7F7', borderRadius: 16, padding: 14, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  logo: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  logoTxt: { fontSize: 16, fontWeight: '800', color: '#FFF' },
  name: { fontSize: 15, fontWeight: '700', color: '#000' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  meta: { fontSize: 11, color: '#6B7280', fontWeight: '600', maxWidth: 140 },
  dot: { fontSize: 11, color: '#C7C7CC' },
  count: { fontSize: 12, color: '#8E8E93', marginTop: 3 },
  desc: { fontSize: 13, color: '#3C3C43', lineHeight: 18 },

  joinBtn: {
    backgroundColor: '#000',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
    minWidth: 78, alignItems: 'center',
  },
  joinBtnJoined: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB' },
  joinBtnTxt: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  joinBtnJoinedTxt: { color: '#000', fontSize: 13, fontWeight: '700' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10, paddingHorizontal: 30 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  emptySub: { fontSize: 13, color: '#8E8E93', textAlign: 'center', lineHeight: 18 },

  createSuggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#EFF6FF', borderRadius: 14,
    padding: 14, marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#BFDBFE',
  },
  createSuggestionIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#1D4ED8',
    alignItems: 'center', justifyContent: 'center',
  },
  createSuggestionTitle: { fontSize: 14, fontWeight: '700', color: '#1E3A8A' },
  createSuggestionSub: { fontSize: 12, color: '#3B82F6', marginTop: 1 },

  fab: {
    position: 'absolute', right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#000', borderRadius: 28,
    paddingHorizontal: 18, paddingVertical: 14,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabTxt: { color: '#FFF', fontSize: 14, fontWeight: '800' },
});