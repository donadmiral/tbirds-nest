import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  FlatList, ActivityIndicator, StatusBar, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import {
  Affiliation, AffiliationMember,
  getAffiliationById, getAffiliationMembers,
  requestToJoinAffiliation, leaveAffiliation,
  isAdminRole,
} from '../../services/affiliationsService';

const KIND_LABEL: Record<string, string> = {
  fraternity: 'Fraternity', sorority: 'Sorority', club: 'Club',
  cohort: 'Cohort', organization: 'Organization', team: 'Team',
  honor_society: 'Honor Society', other: 'Community',
};

const ROLE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
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

type Tab = 'feed' | 'members' | 'about';

export default function AffiliationDetailScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const affiliationId: string = route.params?.affiliationId;

  const [aff, setAff] = useState<Affiliation | null>(null);
  const [members, setMembers] = useState<AffiliationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('feed');

  const loadAll = useCallback(async () => {
    if (!affiliationId) return;
    const [a, m] = await Promise.all([
      getAffiliationById(affiliationId, userId),
      getAffiliationMembers(affiliationId),
    ]);
    setAff(a);
    setMembers(m);
    setLoading(false);
    setRefreshing(false);
  }, [affiliationId, userId]);

  useFocusEffect(useCallback(() => {
    loadAll();
  }, [loadAll]));

  const handleJoin = async () => {
    if (!aff || !userId || busy) return;
    setBusy(true);
    try {
      const result = await requestToJoinAffiliation(aff.id);
      if (result === 'joined') {
        await loadAll();
      } else if (result === 'requested') {
        Alert.alert('Request sent', 'An admin will review your request shortly.');
      } else if (result === 'already_member') {
        await loadAll();
      } else if (result === 'already_requested') {
        Alert.alert('Already requested', 'Your request is pending review.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not join.');
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = () => {
    if (!aff || !userId || busy) return;
    if (aff.my_role === 'founder') {
      Alert.alert(
        'You are the founder',
        'Founders cannot leave. Delete the community from the admin panel if you want to remove it.',
      );
      return;
    }
    Alert.alert(
      `Leave ${aff.name}?`,
      'You can rejoin later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await leaveAffiliation(aff.id, userId);
              await loadAll();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not leave.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const openChat = () => {
    if (!aff?.conversation_id) return;
    navigation.getParent()?.navigate('Chat', {
      conversationId: aff.conversation_id,
      isGroup: true,
      groupName: aff.name,
      groupEmoji: '💬',
      userName: aff.name,
      affiliationId: aff.id,
    });
  };

  const openAdmin = () => {
    if (!aff) return;
    navigation.navigate('AffiliationAdmin', { affiliationId: aff.id });
  };

  const openMember = (m: AffiliationMember) => {
    navigation.getParent()?.navigate('UserProfile', {
      userId: m.profile_id,
      user: {
        id: m.profile_id,
        full_name: m.full_name,
        username: m.username,
        avatar_url: m.avatar_url,
      },
    });
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

  const iAmAdmin = isAdminRole(aff.my_role);
  const scopeLabel = aff.institution_name || 'Global';
  const kindLabel = KIND_LABEL[aff.kind] || 'Community';

  const renderHeader = () => (
    <View>
      <View style={s.hero}>
        {aff.logo_url ? (
          <Image source={{ uri: aff.logo_url }} style={s.heroLogo} />
        ) : (
          <View style={[s.heroLogo, { backgroundColor: colorFor(aff.id) }]}>
            <Text style={s.heroLogoTxt}>{initials(aff.name)}</Text>
          </View>
        )}
        <Text style={s.heroName}>{aff.name}</Text>
        <View style={s.heroMeta}>
          <View style={s.metaPill}>
            <Feather name="users" size={11} color="#6B7280" />
            <Text style={s.metaTxt}>{kindLabel}</Text>
          </View>
          <View style={s.metaPill}>
            <Feather
              name={aff.institution_name ? 'award' : 'globe'}
              size={11}
              color={aff.institution_name ? '#1D4ED8' : '#059669'}
            />
            <Text style={[s.metaTxt, { color: aff.institution_name ? '#1D4ED8' : '#059669' }]}>
              {scopeLabel}
            </Text>
          </View>
          {aff.post_mode === 'informative' && (
            <View style={s.infoModePill}>
              <Feather name="radio" size={11} color="#7C3AED" />
              <Text style={s.infoModeTxt}>Announcements only</Text>
            </View>
          )}
        </View>
        <Text style={s.heroCount}>
          {aff.member_count} {aff.member_count === 1 ? 'member' : 'members'}
        </Text>

        <View style={s.heroActions}>
          {aff.is_member ? (
            <>
              <TouchableOpacity style={s.primaryBtn} onPress={openChat} activeOpacity={0.85}>
                <Feather name="message-square" size={15} color="#FFF" />
                <Text style={s.primaryBtnTxt}>Open chat</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.secondaryBtn} onPress={handleLeave} disabled={busy} activeOpacity={0.8}>
                {busy ? <ActivityIndicator color="#000" size={14} /> : <Text style={s.secondaryBtnTxt}>Leave</Text>}
              </TouchableOpacity>
              {iAmAdmin && (
                <TouchableOpacity style={s.iconBtn} onPress={openAdmin} activeOpacity={0.8}>
                  <Feather name="settings" size={18} color="#000" />
                </TouchableOpacity>
              )}
            </>
          ) : (
            <TouchableOpacity
              style={[s.primaryBtn, { flex: 1 }]}
              onPress={handleJoin}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" size={14} />
              ) : (
                <>
                  <Feather name={aff.join_mode === 'request' ? 'send' : 'plus'} size={15} color="#FFF" />
                  <Text style={s.primaryBtnTxt}>
                    {aff.join_mode === 'request' ? 'Request to join' : 'Join'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={s.tabs}>
        {(['feed', 'members', 'about'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tab, tab === t && s.tabActive]}
            onPress={() => setTab(t)}
            activeOpacity={0.8}
          >
            <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
              {t === 'feed' ? 'Chat' : t === 'members' ? `Members · ${aff.member_count}` : 'About'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderMemberRow = ({ item }: { item: AffiliationMember }) => {
    const roleStyle = ROLE_LABEL[item.role] || ROLE_LABEL.member;
    return (
      <TouchableOpacity style={s.memberRow} onPress={() => openMember(item)} activeOpacity={0.7}>
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={s.memberAvatar} />
        ) : (
          <View style={[s.memberAvatar, { backgroundColor: colorFor(item.profile_id) }]}>
            <Text style={s.memberAvatarTxt}>{initials(item.full_name)}</Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.memberName} numberOfLines={1}>{item.full_name || 'Member'}</Text>
          {item.username ? (
            <Text style={s.memberHandle} numberOfLines={1}>@{item.username}</Text>
          ) : null}
        </View>
        <View style={[s.roleBadge, { backgroundColor: roleStyle.bg }]}>
          <Text style={[s.roleBadgeTxt, { color: roleStyle.color }]}>{roleStyle.label}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const tabContent = () => {
    if (tab === 'feed') {
      return (
        <View style={s.feedStub}>
          {aff.is_member ? (
            <>
              <View style={s.feedIcon}>
                <Feather name="message-square" size={26} color="#1D4ED8" />
              </View>
              <Text style={s.feedTitle}>Community chat</Text>
              <Text style={s.feedSub}>
                {aff.post_mode === 'informative'
                  ? 'Admins post announcements here. Members can read along.'
                  : 'Talk with the other members of this community.'}
              </Text>
              <TouchableOpacity style={s.feedBtn} onPress={openChat} activeOpacity={0.85}>
                <Feather name="arrow-right" size={15} color="#FFF" />
                <Text style={s.feedBtnTxt}>Open chat</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.feedIcon}>
                <Feather name="lock" size={24} color="#6B7280" />
              </View>
              <Text style={s.feedTitle}>Members only</Text>
              <Text style={s.feedSub}>
                Join this community to see its chat.
              </Text>
            </>
          )}
        </View>
      );
    }

    if (tab === 'members') {
      return members.length === 0 ? (
        <View style={s.feedStub}>
          <Feather name="users" size={26} color="#9CA3AF" />
          <Text style={s.feedTitle}>No members yet</Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 14, paddingTop: 6 }}>
          {members.map(m => (
            <View key={m.profile_id}>{renderMemberRow({ item: m })}</View>
          ))}
        </View>
      );
    }

    // about
    return (
      <View style={s.about}>
        {aff.description ? (
          <View style={s.aboutCard}>
            <Text style={s.aboutLabel}>Description</Text>
            <Text style={s.aboutTxt}>{aff.description}</Text>
          </View>
        ) : null}
        <View style={s.aboutCard}>
          <Text style={s.aboutLabel}>Scope</Text>
          <Text style={s.aboutTxt}>
            {aff.institution_name
              ? `Institution-specific · ${aff.institution_name}`
              : 'Global · Open to all schools'}
          </Text>
        </View>
        <View style={s.aboutCard}>
          <Text style={s.aboutLabel}>Joining</Text>
          <Text style={s.aboutTxt}>
            {aff.join_mode === 'request'
              ? 'By request · Admins approve new members'
              : 'Open · Anyone can join'}
          </Text>
        </View>
        <View style={s.aboutCard}>
          <Text style={s.aboutLabel}>Posting</Text>
          <Text style={s.aboutTxt}>
            {aff.post_mode === 'informative'
              ? 'Announcements only · Only admins can post messages'
              : 'Interactive · All members can post'}
          </Text>
        </View>
        <View style={s.aboutCard}>
          <Text style={s.aboutLabel}>Type</Text>
          <Text style={s.aboutTxt}>{kindLabel}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{aff.name}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadAll(); }}
            tintColor="#000"
          />
        }
      >
        {renderHeader()}
        {tabContent()}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#000', textAlign: 'center' },

  hero: { alignItems: 'center', paddingTop: 22, paddingHorizontal: 20, paddingBottom: 18 },
  heroLogo: {
    width: 82, height: 82, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  heroLogoTxt: { fontSize: 30, fontWeight: '800', color: '#FFF' },
  heroName: { fontSize: 22, fontWeight: '800', color: '#000', textAlign: 'center' },
  heroMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, justifyContent: 'center' },
  metaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F5F5F5', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  metaTxt: { fontSize: 11, fontWeight: '600', color: '#374151' },
  infoModePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F3E8FF', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  infoModeTxt: { fontSize: 11, fontWeight: '700', color: '#7C3AED' },
  heroCount: { fontSize: 13, color: '#6B7280', marginTop: 10 },

  heroActions: {
    flexDirection: 'row', gap: 8, marginTop: 18,
    alignSelf: 'stretch',
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#000', borderRadius: 12,
    paddingVertical: 12,
  },
  primaryBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB',
    alignItems: 'center', justifyContent: 'center',
    minWidth: 70,
  },
  secondaryBtnTxt: { fontSize: 14, fontWeight: '700', color: '#000' },
  iconBtn: {
    width: 44, height: 44, borderRadius: 12,
    borderWidth: 1, borderColor: '#E5E7EB',
    alignItems: 'center', justifyContent: 'center',
  },

  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
    paddingHorizontal: 14, paddingTop: 4,
  },
  tab: { paddingVertical: 12, paddingHorizontal: 14, marginRight: 4 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#000' },
  tabTxt: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  tabTxtActive: { color: '#000', fontWeight: '700' },

  feedStub: {
    alignItems: 'center', paddingHorizontal: 30, paddingTop: 48, gap: 10,
  },
  feedIcon: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  feedTitle: { fontSize: 16, fontWeight: '700', color: '#000' },
  feedSub: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 18 },
  feedBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#000', borderRadius: 12,
    paddingHorizontal: 18, paddingVertical: 11,
    marginTop: 8,
  },
  feedBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F3F4F6',
  },
  memberAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  memberAvatarTxt: { fontSize: 14, fontWeight: '800', color: '#FFF' },
  memberName: { fontSize: 14, fontWeight: '600', color: '#000' },
  memberHandle: { fontSize: 12, color: '#8E8E93', marginTop: 1 },
  roleBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8,
  },
  roleBadgeTxt: { fontSize: 11, fontWeight: '700' },

  about: { padding: 14, gap: 10 },
  aboutCard: {
    backgroundColor: '#F7F7F7', borderRadius: 14,
    padding: 14, gap: 4,
  },
  aboutLabel: { fontSize: 11, fontWeight: '800', color: '#8E8E93', letterSpacing: 0.6 },
  aboutTxt: { fontSize: 14, color: '#000', lineHeight: 19 },
});