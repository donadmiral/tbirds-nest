import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  ActivityIndicator, StatusBar, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import {
  Affiliation, AffiliationMember, AffiliationRole,
  getAffiliationById, getAffiliationMembers, getPendingJoinRequestCount,
  setAffiliationPostMode, setAffiliationJoinMode,
  kickAffiliationMember, setAffiliationMemberRole,
  isAdminRole,
} from '../../services/affiliationsService';

const ROLE_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  founder: { label: 'Founder',  color: '#B45309', bg: '#FEF3C7' },
  admin:   { label: 'Admin',    color: '#1E3A8A', bg: '#DBEAFE' },
  officer: { label: 'Officer',  color: '#065F46', bg: '#D1FAE5' },
  member:  { label: 'Member',   color: '#374151', bg: '#F3F4F6' },
  alumni:  { label: 'Alumni',   color: '#6B21A8', bg: '#EDE9FE' },
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

export default function AffiliationAdminScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const affiliationId: string = route.params?.affiliationId;

  const [aff, setAff] = useState<Affiliation | null>(null);
  const [members, setMembers] = useState<AffiliationMember[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingMode, setSavingMode] = useState<null | 'post' | 'join'>(null);

  const loadAll = useCallback(async () => {
    if (!affiliationId) return;
    const [a, m, pc] = await Promise.all([
      getAffiliationById(affiliationId, userId),
      getAffiliationMembers(affiliationId),
      getPendingJoinRequestCount(affiliationId),
    ]);
    setAff(a);
    setMembers(m);
    setPendingCount(pc);
    setLoading(false);
    setRefreshing(false);
  }, [affiliationId, userId]);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const togglePostMode = async () => {
    if (!aff || savingMode) return;
    const next = aff.post_mode === 'interactive' ? 'informative' : 'interactive';
    setSavingMode('post');
    // Optimistic
    setAff({ ...aff, post_mode: next });
    try {
      await setAffiliationPostMode(aff.id, next);
    } catch (e: any) {
      setAff({ ...aff });
      Alert.alert('Error', e?.message || 'Could not change posting mode.');
      await loadAll();
    } finally {
      setSavingMode(null);
    }
  };

  const toggleJoinMode = async () => {
    if (!aff || savingMode) return;
    const next = aff.join_mode === 'open' ? 'request' : 'open';
    setSavingMode('join');
    setAff({ ...aff, join_mode: next });
    try {
      await setAffiliationJoinMode(aff.id, next);
    } catch (e: any) {
      setAff({ ...aff });
      Alert.alert('Error', e?.message || 'Could not change join mode.');
      await loadAll();
    } finally {
      setSavingMode(null);
    }
  };

  const handleMemberAction = (m: AffiliationMember) => {
    if (!aff) return;
    if (m.profile_id === userId) {
      Alert.alert('Can\'t manage yourself', 'Admins cannot perform actions on their own account.');
      return;
    }
    if (m.role === 'founder') {
      Alert.alert('Founder', 'The founder\'s role cannot be changed.');
      return;
    }

    const options = [];

    if (m.role === 'member') {
      options.push({ text: 'Promote to Officer', onPress: () => changeRole(m, 'officer') });
      options.push({ text: 'Promote to Admin', onPress: () => changeRole(m, 'admin') });
    } else if (m.role === 'officer') {
      options.push({ text: 'Promote to Admin', onPress: () => changeRole(m, 'admin') });
      options.push({ text: 'Demote to Member', onPress: () => changeRole(m, 'member') });
    } else if (m.role === 'admin') {
      options.push({ text: 'Demote to Officer', onPress: () => changeRole(m, 'officer') });
      options.push({ text: 'Demote to Member', onPress: () => changeRole(m, 'member') });
    }

    options.push({
      text: 'Remove from community',
      style: 'destructive' as const,
      onPress: () => confirmKick(m),
    });
    options.push({ text: 'Cancel', style: 'cancel' as const });

    Alert.alert(
      m.full_name || 'Member',
      `${ROLE_STYLE[m.role]?.label || 'Member'} · Joined ${new Date(m.joined_at).toLocaleDateString()}`,
      options,
    );
  };

  const changeRole = async (m: AffiliationMember, newRole: 'member' | 'officer' | 'admin') => {
    if (!aff) return;
    try {
      await setAffiliationMemberRole(aff.id, m.profile_id, newRole);
      setMembers(prev => prev.map(x => x.profile_id === m.profile_id ? { ...x, role: newRole as AffiliationRole } : x));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not change role.');
    }
  };

  const confirmKick = (m: AffiliationMember) => {
    Alert.alert(
      'Remove member?',
      `${m.full_name || 'This member'} will be removed from the community. They can rejoin later if the community is open.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!aff) return;
            try {
              await kickAffiliationMember(aff.id, m.profile_id);
              setMembers(prev => prev.filter(x => x.profile_id !== m.profile_id));
              setAff({ ...aff, member_count: Math.max(0, aff.member_count - 1) });
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not remove.');
            }
          },
        },
      ]
    );
  };

  if (loading || !aff) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loader}>
          <ActivityIndicator color="#000" />
        </View>
      </SafeAreaView>
    );
  }

  if (!isAdminRole(aff.my_role)) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Feather name="chevron-left" size={26} color="#000" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Admin</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.loader}>
          <Feather name="lock" size={36} color="#D1D5DB" />
          <Text style={s.emptyTitle}>Not an admin</Text>
          <Text style={s.emptySub}>Only admins, officers, and the founder can manage this community.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isFounder = aff.my_role === 'founder';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>Manage community</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadAll(); }}
            tintColor="#000"
          />
        }
      >
        <View style={s.heroRow}>
          {aff.logo_url ? (
            <Image source={{ uri: aff.logo_url }} style={s.heroLogo} />
          ) : (
            <View style={[s.heroLogo, { backgroundColor: colorFor(aff.id) }]}>
              <Text style={s.heroLogoTxt}>{initials(aff.name)}</Text>
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={s.heroName} numberOfLines={1}>{aff.name}</Text>
            <Text style={s.heroMeta}>{aff.member_count} {aff.member_count === 1 ? 'member' : 'members'}</Text>
          </View>
        </View>

        {/* Pending join requests */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>REQUESTS</Text>
          <TouchableOpacity
            style={s.requestsRow}
            onPress={() => navigation.navigate('AffiliationJoinRequests', { affiliationId: aff.id })}
            activeOpacity={0.7}
          >
            <View style={[s.rowIcon, { backgroundColor: pendingCount > 0 ? '#FEF3C7' : '#F3F4F6' }]}>
              <Feather name="user-plus" size={16} color={pendingCount > 0 ? '#B45309' : '#6B7280'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Join requests</Text>
              <Text style={s.rowSub}>
                {pendingCount > 0
                  ? `${pendingCount} pending · tap to review`
                  : aff.join_mode === 'open' ? 'Community is open. Anyone can join.' : 'No pending requests.'}
              </Text>
            </View>
            {pendingCount > 0 && (
              <View style={s.badge}><Text style={s.badgeTxt}>{pendingCount}</Text></View>
            )}
            <Feather name="chevron-right" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        </View>

        {/* Posting mode */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>POSTING</Text>

          <TouchableOpacity
            style={[s.modeCard, aff.post_mode === 'interactive' && s.modeCardActive]}
            onPress={() => aff.post_mode === 'informative' && togglePostMode()}
            disabled={savingMode === 'post' || aff.post_mode === 'interactive'}
            activeOpacity={0.8}
          >
            <View style={s.modeHead}>
              <View style={s.modeIconWrap}>
                <Feather name="message-circle" size={16} color={aff.post_mode === 'interactive' ? '#1D4ED8' : '#6B7280'} />
              </View>
              <Text style={[s.modeTitle, aff.post_mode === 'interactive' && s.modeTitleActive]}>
                Interactive
              </Text>
              {aff.post_mode === 'interactive' && <View style={s.activeDot} />}
            </View>
            <Text style={s.modeDesc}>All members can post messages.</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.modeCard, aff.post_mode === 'informative' && s.modeCardActive]}
            onPress={() => aff.post_mode === 'interactive' && togglePostMode()}
            disabled={savingMode === 'post' || aff.post_mode === 'informative'}
            activeOpacity={0.8}
          >
            <View style={s.modeHead}>
              <View style={s.modeIconWrap}>
                <Feather name="radio" size={16} color={aff.post_mode === 'informative' ? '#7C3AED' : '#6B7280'} />
              </View>
              <Text style={[s.modeTitle, aff.post_mode === 'informative' && s.modeTitleActive]}>
                Announcements only
              </Text>
              {aff.post_mode === 'informative' && <View style={[s.activeDot, { backgroundColor: '#7C3AED' }]} />}
            </View>
            <Text style={s.modeDesc}>Only admins and officers can post. Members can read along.</Text>
          </TouchableOpacity>

          {savingMode === 'post' && (
            <View style={s.savingRow}>
              <ActivityIndicator size="small" color="#000" />
              <Text style={s.savingTxt}>Saving...</Text>
            </View>
          )}
        </View>

        {/* Joining mode */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>JOINING</Text>

          <TouchableOpacity
            style={[s.modeCard, aff.join_mode === 'open' && s.modeCardActive]}
            onPress={() => aff.join_mode === 'request' && toggleJoinMode()}
            disabled={savingMode === 'join' || aff.join_mode === 'open'}
            activeOpacity={0.8}
          >
            <View style={s.modeHead}>
              <View style={s.modeIconWrap}>
                <Feather name="unlock" size={16} color={aff.join_mode === 'open' ? '#059669' : '#6B7280'} />
              </View>
              <Text style={[s.modeTitle, aff.join_mode === 'open' && s.modeTitleActive]}>
                Open
              </Text>
              {aff.join_mode === 'open' && <View style={[s.activeDot, { backgroundColor: '#059669' }]} />}
            </View>
            <Text style={s.modeDesc}>Anyone can join instantly.</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.modeCard, aff.join_mode === 'request' && s.modeCardActive]}
            onPress={() => aff.join_mode === 'open' && toggleJoinMode()}
            disabled={savingMode === 'join' || aff.join_mode === 'request'}
            activeOpacity={0.8}
          >
            <View style={s.modeHead}>
              <View style={s.modeIconWrap}>
                <Feather name="shield" size={16} color={aff.join_mode === 'request' ? '#B45309' : '#6B7280'} />
              </View>
              <Text style={[s.modeTitle, aff.join_mode === 'request' && s.modeTitleActive]}>
                By request
              </Text>
              {aff.join_mode === 'request' && <View style={[s.activeDot, { backgroundColor: '#B45309' }]} />}
            </View>
            <Text style={s.modeDesc}>Admins approve each request before the user joins.</Text>
          </TouchableOpacity>

          {savingMode === 'join' && (
            <View style={s.savingRow}>
              <ActivityIndicator size="small" color="#000" />
              <Text style={s.savingTxt}>Saving...</Text>
            </View>
          )}
        </View>

        {/* Members */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>MEMBERS · {members.length}</Text>
          {members.map(m => {
            const roleStyle = ROLE_STYLE[m.role] || ROLE_STYLE.member;
            const isSelf = m.profile_id === userId;
            return (
              <TouchableOpacity
                key={m.profile_id}
                style={s.memberRow}
                onPress={() => handleMemberAction(m)}
                activeOpacity={0.7}
                disabled={isSelf}
              >
                {m.avatar_url ? (
                  <Image source={{ uri: m.avatar_url }} style={s.memberAvatar} />
                ) : (
                  <View style={[s.memberAvatar, { backgroundColor: colorFor(m.profile_id) }]}>
                    <Text style={s.memberAvatarTxt}>{initials(m.full_name)}</Text>
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.memberName} numberOfLines={1}>
                    {m.full_name || 'Member'}{isSelf ? ' (you)' : ''}
                  </Text>
                  {m.username ? (
                    <Text style={s.memberHandle} numberOfLines={1}>@{m.username}</Text>
                  ) : null}
                </View>
                <View style={[s.roleBadge, { backgroundColor: roleStyle.bg }]}>
                  <Text style={[s.roleBadgeTxt, { color: roleStyle.color }]}>{roleStyle.label}</Text>
                </View>
                {!isSelf && m.role !== 'founder' && (
                  <Feather name="more-vertical" size={16} color="#9CA3AF" style={{ marginLeft: 6 }} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Founder-only danger zone */}
        {isFounder && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>DANGER ZONE</Text>
            <TouchableOpacity
              style={s.dangerBtn}
              onPress={() => {
                Alert.alert(
                  'Delete community?',
                  `"${aff.name}" and all its messages will be permanently removed. This cannot be undone.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => {
                        Alert.alert('Not yet available', 'Community deletion ships in the next update.');
                      },
                    },
                  ]
                );
              }}
              activeOpacity={0.8}
            >
              <Feather name="trash-2" size={15} color="#DC2626" />
              <Text style={s.dangerTxt}>Delete community</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 30 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#000', textAlign: 'center' },

  heroRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14,
  },
  heroLogo: {
    width: 56, height: 56, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  heroLogoTxt: { fontSize: 20, fontWeight: '800', color: '#FFF' },
  heroName: { fontSize: 17, fontWeight: '800', color: '#000' },
  heroMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  section: {
    paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: '#8E8E93',
    letterSpacing: 0.7, marginBottom: 10,
  },

  requestsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F7F7F7', borderRadius: 14,
    padding: 14,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#000' },
  rowSub: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 16 },
  badge: {
    backgroundColor: '#B45309', borderRadius: 10,
    minWidth: 22, height: 22, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 4,
  },
  badgeTxt: { color: '#FFF', fontSize: 11, fontWeight: '800' },

  modeCard: {
    backgroundColor: '#F7F7F7', borderRadius: 12,
    padding: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  modeCardActive: {
    backgroundColor: '#FFF',
    borderColor: '#000',
  },
  modeHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  modeIconWrap: {
    width: 28, height: 28, borderRadius: 9,
    backgroundColor: '#FFF',
    alignItems: 'center', justifyContent: 'center',
  },
  modeTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: '#374151' },
  modeTitleActive: { color: '#000' },
  activeDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#1D4ED8',
  },
  modeDesc: { fontSize: 12, color: '#6B7280', lineHeight: 17, marginLeft: 36 },

  savingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  savingTxt: { fontSize: 12, color: '#6B7280' },

  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F3F4F6',
  },
  memberAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  memberAvatarTxt: { fontSize: 14, fontWeight: '800', color: '#FFF' },
  memberName: { fontSize: 14, fontWeight: '600', color: '#000' },
  memberHandle: { fontSize: 12, color: '#8E8E93', marginTop: 1 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  roleBadgeTxt: { fontSize: 11, fontWeight: '700' },

  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    backgroundColor: '#FEF2F2', borderRadius: 12,
    paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#FECACA',
  },
  dangerTxt: { fontSize: 14, fontWeight: '700', color: '#DC2626' },

  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#000' },
  emptySub: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 18 },
});