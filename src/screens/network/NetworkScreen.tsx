import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet, useTheme } from '../../theme/useTheme';
import { KeyboardAvoidingView ,
  View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, StatusBar, ScrollView, Alert, Modal, Platform,
} from 'react-native';
import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
import { handleTabBarScroll } from '../../components/AdaptiveTabBar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import * as Haptics from 'expo-haptics';
import { profileRead } from '../../utils/profileRead';
import { readNetworkDirectory } from '../../../shared/networkDirectory';
import { useFocusEffect } from '@react-navigation/native';

type Profile = {
  id: string;
  full_name?: string | null;
  username?: string | null;
  bio?: string | null;
  location?: string | null;
  degree_program?: string | null;
  graduation_year?: number | null;
  avatar_url?: string | null;
  email?: string | null;
  role?: string | null;
  workplace?: string | null;
  school?: string | null;
  headline?: string | null;
};

type Group = {
  id: string;
  name: string;
  emoji?: string;
  is_member?: boolean;
  has_pending?: boolean;
  my_role?: string | null;
  cover_color?: string;
  icon_url?: string | null;
  description?: string | null;
  member_count: number;
};

type TabId = 'all' | 'communities' | 'clubs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'communities', label: 'Communities' },
  { id: 'clubs', label: 'Clubs' },
];

export default function NetworkScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t, isDark } = useTheme();
  const { profile } = useAuthStore();
  const currentUserId = profile?.id ?? null;

  const [tab, setTab] = useState<TabId>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [visibleUserId, setVisibleUserId] = useState(currentUserId);
  const [refreshing, setRefreshing] = useState(false);

  const [users, setUsers] = useState<Profile[]>([]);

  const [followMap, setFollowMap] = useState<Record<string, boolean>>({});
  const [requestedMap, setRequestedMap] = useState<Record<string, boolean>>({});
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});

  const [communities, setCommunities] = useState<Group[]>([]);
  const [clubs, setClubs] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<{ table: 'communities' | 'clubs'; group: Group } | null>(null);
  const [groupMembers, setGroupMembers] = useState<Profile[]>([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [myCommIds, setMyCommIds] = useState<Set<string>>(new Set());
  const [myClubIds, setMyClubIds] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loadErrors, setLoadErrors] = useState<Partial<Record<TabId, string>>>({});
  const [groupError, setGroupError] = useState('');
  const request = useRef(0), memberRequest = useRef(0), mounted = useRef(true);
  const locks = useRef(new Set<string>());
  const identity = useRef({ currentUserId });
  if (identity.current.currentUserId !== currentUserId) identity.current = { currentUserId };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; memberRequest.current++; }; }, []);

  const [createType, setCreateType] = useState<'communities' | 'clubs'>('communities');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEmoji, setNewGroupEmoji] = useState('🌐');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);



  const setBusy = (id: string, val: boolean) =>
    setBusyMap((p) => { const n = { ...p }; if (val) n[id] = true; else delete n[id]; return n; });

  const initials = (name?: string | null) => {
    if (!name) return 'U';
    const p = name.trim().split(' ').filter(Boolean);
    return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
  };

  const loadAll = useCallback(async (showLoader = true) => {
    const owner = identity.current, version = ++request.current;
    const current = () => mounted.current && owner === identity.current && version === request.current;
    if (!currentUserId) { setLoading(false); setRefreshing(false); return; }
    if (showLoader) setLoading(true);
    try {
      const data = await readNetworkDirectory(supabase, currentUserId, profileRead);
      if (!current()) return;
      if (data.people) setUsers(data.people);
      if (data.follows) setFollowMap(Object.fromEntries(data.follows.map(row => [row.following_id, true])));
      if (data.requests) setRequestedMap(Object.fromEntries(data.requests.map(row => [row.target_id, true])));
      if (data.communities) {
        setCommunities(data.communities);
        setMyCommIds(new Set(data.communities.filter(row => row.is_member).map(row => row.id)));
      }
      if (data.clubs) setClubs(data.clubs);
      if (data.clubMembers) setMyClubIds(new Set(data.clubMembers.map(row => row.club_id)));
      setLoadErrors(data.errors);
    } catch {
      if (current()) setLoadErrors({ all: 'Network could not load. Please retry.', communities: 'Communities could not load. Please retry.', clubs: 'Clubs could not load. Please retry.' });
    } finally {
      if (current()) { setLoading(false); setRefreshing(false); }
    }
  }, [currentUserId]);

  useEffect(() => {
    request.current++; memberRequest.current++; locks.current.clear();
    setVisibleUserId(currentUserId); setUsers([]); setFollowMap({}); setRequestedMap({}); setCommunities([]); setClubs([]);
    setMyCommIds(new Set()); setMyClubIds(new Set()); setSelectedGroup(null); setGroupMembers([]);
    setBusyMap({}); setShowCreateModal(false); setNewGroupName(''); setNewGroupDesc(''); setCreatingGroup(false);
    setLoadErrors({}); setLoading(!!currentUserId);
  }, [currentUserId]);
  useFocusEffect(useCallback(() => { void loadAll(false); }, [loadAll]));

  const openGroup = async (table: 'communities' | 'clubs', group: Group) => {
    if (table === 'communities') {
      navigation.navigate('Community', { communityId: group.id, name: group.name,
        coverColor: group.cover_color, iconUrl: group.icon_url || null, memberCount: group.member_count,
        myRole: group.my_role || null, isMember: myCommIds.has(group.id) });
      return;
    }
    const owner = identity.current, version = ++memberRequest.current;
    const current = () => mounted.current && owner === identity.current && version === memberRequest.current;
    setSelectedGroup({ table, group }); setGroupLoading(true); setGroupError(''); setGroupMembers([]);
    try {
      const { data: memberIds, error } = await profileRead(supabase.from('club_members').select('user_id').eq('club_id', group.id));
      if (error) throw error;
      if (!current()) return;
      const ids = (memberIds || []).map((row: any) => row.user_id);
      if (ids.length) {
        const result = await profileRead(supabase.from('profiles').select('id, full_name, username, bio, location, degree_program, avatar_url').in('id', ids));
        if (result.error) throw result.error;
        if (current()) setGroupMembers(result.data || []);
      }
    } catch { if (current()) setGroupError('Members could not load. Please retry.'); }
    finally { if (current()) setGroupLoading(false); }
  };

  const toggleGroupMembership = async (table: 'communities' | 'clubs', groupId: string) => {
    const key = `grp-${groupId}`, owner = identity.current;
    if (!currentUserId || locks.current.has(key)) return;
    locks.current.add(key); setBusy(key, true);
    const current = () => mounted.current && owner === identity.current;
    const isMember = (table === 'communities' ? myCommIds : myClubIds).has(groupId);
    try {
      if (table === 'communities') {
        const group = communities.find(row => row.id === groupId);
        const rpc = isMember ? 'leave_community' : group?.has_pending ? 'cancel_join_request' : 'join_community';
        const { data, error } = await supabase.rpc(rpc, { p_community: groupId });
        if (error) throw error;
        if (!current()) return;
        const joined = rpc === 'join_community' && data === 'joined';
        setCommunities(rows => rows.map(row => row.id === groupId ? { ...row, is_member: joined,
          has_pending: rpc === 'join_community' && !joined, member_count: Math.max(0, row.member_count + (isMember ? -1 : joined ? 1 : 0)) } : row));
        setMyCommIds(ids => { const next = new Set(ids); if (joined) next.add(groupId); else next.delete(groupId); return next; });
      } else {
        const query = isMember ? supabase.from('club_members').delete().eq('club_id', groupId).eq('user_id', currentUserId)
          : supabase.from('club_members').insert({ club_id: groupId, user_id: currentUserId });
        const { error } = await query;
        if (error) throw error;
        if (!current()) return;
        setMyClubIds(ids => { const next = new Set(ids); if (isMember) next.delete(groupId); else next.add(groupId); return next; });
        setClubs(rows => rows.map(row => row.id === groupId ? { ...row, member_count: Math.max(0, row.member_count + (isMember ? -1 : 1)) } : row));
      }
    } catch (error: any) { if (current()) Alert.alert('Could not update membership', error?.message || 'Please try again.'); }
    finally { if (current()) { locks.current.delete(key); setBusy(key, false); } }
  };

  const createGroup = async () => {
    if (!currentUserId || locks.current.has('create')) return;
    const name = newGroupName.trim();
    if (name.length < 3) { Alert.alert('Group name', 'Enter at least three characters.'); return; }
    const owner = identity.current, current = () => mounted.current && owner === identity.current;
    locks.current.add('create'); setCreatingGroup(true);
    let createdClub: string | null = null;
    try {
      let id: string;
      if (createType === 'communities') {
        const { data, error } = await supabase.rpc('create_community', { p_name: name,
          p_description: newGroupDesc.trim() || null, p_category: null, p_join_mode: 'open', p_cover_color: 'sky', p_rules: null });
        if (error) throw error;
        if (typeof data !== 'string' || !data) throw new Error('Creation was not confirmed. Refresh the directory before retrying.');
        id = data;
      } else {
        const { data, error } = await supabase.from('clubs').insert({ name, emoji: newGroupEmoji,
          description: newGroupDesc.trim() || null, created_by: currentUserId, member_count: 0 }).select('id').single();
        if (error) throw error;
        if (!data?.id) throw new Error('Creation was not confirmed. Refresh the directory before retrying.');
        id = data.id; createdClub = id;
        if (!current()) return;
        const joined = await supabase.from('club_members').insert({ club_id: id, user_id: currentUserId });
        if (joined.error) throw joined.error;
      }
      if (!current()) return;
      setNewGroupName(''); setNewGroupDesc(''); setNewGroupEmoji('🌐'); setShowCreateModal(false);
      void loadAll(false);
      if (createType === 'communities') navigation.navigate('Community', { communityId: id, name,
        coverColor: 'sky', iconUrl: null, memberCount: 1, myRole: 'owner', isMember: true });
      else Alert.alert('Club created', `${name} is ready.`);
    } catch (error: any) {
      if (current()) {
        if (createdClub) { setShowCreateModal(false); void loadAll(false); Alert.alert('Club created; join still needed', 'The club was created, but your membership could not be added. Find it in Clubs and tap Join.'); }
        else Alert.alert('Could not create group', error?.message || 'Refresh the directory before retrying.');
      }
    } finally { if (current()) { locks.current.delete('create'); setCreatingGroup(false); } }
  };

  const toggleFollow = async (userId: string) => {
    const key = `follow-${userId}`, owner = identity.current;
    if (!currentUserId || loadErrors.all || locks.current.has(key)) return;
    const current = () => mounted.current && owner === identity.current;
    locks.current.add(key);
    const was = !!followMap[userId];
    setBusy(`follow-${userId}`, true);
    try {
      if (was) setFollowMap((p) => ({ ...p, [userId]: false }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const { data, error } = await supabase.rpc('handle_follow_action', { p_target_id: userId });
      if (error) throw error;
      if (!current()) return;
      const action = (data as any)?.action;
      if (action === 'followed') {
        setFollowMap((p) => ({ ...p, [userId]: true }));
        setRequestedMap((p) => ({ ...p, [userId]: false }));
      } else if (action === 'requested') {
        setFollowMap((p) => ({ ...p, [userId]: false }));
        setRequestedMap((p) => ({ ...p, [userId]: true }));
      } else if (action === 'unfollowed' || action === 'request_cancelled') {
        setFollowMap((p) => ({ ...p, [userId]: false }));
        setRequestedMap((p) => ({ ...p, [userId]: false }));
      }
    } catch {
      if (current()) { setFollowMap((p) => ({ ...p, [userId]: was })); Alert.alert('Could not update follow', 'Please try again.'); }
    } finally {
      if (current()) { locks.current.delete(key); setBusy(`follow-${userId}`, false); }
    }
  };

  const filteredUsers = useMemo(() => {
    let list = users;
    const term = search.trim().toLowerCase();

    if (term) {
      list = list.filter((u) =>
        (u.full_name || '').toLowerCase().includes(term) ||
        (u.username || '').toLowerCase().includes(term) ||
        (u.degree_program || '').toLowerCase().includes(term) ||
        (u.location || '').toLowerCase().includes(term) ||
        (u.bio || '').toLowerCase().includes(term)
      );
    }
    return list;
  }, [users, tab, search]);


  const renderAvatar = (user: Profile, size = 52) =>
    user.avatar_url
      ? <Image source={{ uri: user.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} fadeDuration={200} />
      : <View style={[s.avatarFb, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[s.avatarFbTxt, { fontSize: size * 0.33 }]}>{initials(user.full_name || user.username)}</Text>
        </View>;

  const renderFollowButton = (userId: string) => {
    const isFollowing = !!followMap[userId];
    const isRequested = !!requestedMap[userId];
    return (
      <TouchableOpacity
        style={[s.followBtn, (isFollowing || isRequested) && s.followBtnActive]}
        onPress={() => toggleFollow(userId)}
        disabled={!!busyMap[`follow-${userId}`] || !!loadErrors.all}
      >
        <Text style={[s.followBtnTxt, (isFollowing || isRequested) && s.followBtnTxtActive]}>
          {isFollowing ? '● Following' : isRequested ? 'Requested' : '+ Follow'}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderUserCard = ({ item }: { item: Profile }) => {
    const sub = (item as any).headline || item.bio || (item as any).workplace || item.location
      || (item.username ? `@${item.username}` : '');
    return (
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => navigation.push('UserProfile', { userId: item.id, user: item })}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11,
                 backgroundColor: t.surface.raised, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline }}
      >
        {renderAvatar(item, 46)}
        <View style={{ flex: 1, marginLeft: 12, marginRight: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TierName userId={item.id} baseStyle={{ fontSize: 15.5, fontWeight: '700', color: t.ink.primary, flexShrink: 1 }} text={item.full_name || 'Member'} /><VerifiedBadge userId={item.id} size={13} />
          </View>
          {sub ? (
            <Text style={{ fontSize: 13, color: t.ink.secondary, marginTop: 2 }} numberOfLines={1}>{sub}</Text>
          ) : null}
        </View>
        {renderFollowButton(item.id)}
      </TouchableOpacity>
    );
  };
  const renderGroupCard = ({ item, table }: { item: Group; table: 'communities' | 'clubs' }) => {
    const isMember = table === 'communities' ? myCommIds.has(item.id) : myClubIds.has(item.id);
    return (
      <TouchableOpacity style={s.groupCard} activeOpacity={0.88} onPress={() => openGroup(table, item)}>
        <View style={s.groupEmoji}><Text style={s.groupEmojiTxt}>{item.emoji || '🌐'}</Text></View>
        <View style={s.groupInfo}>
          <Text style={s.groupName}>{item.name}</Text>
          {item.description ? <Text style={s.groupDesc} numberOfLines={2}>{item.description}</Text> : null}
          <Text style={s.groupCount}>{item.member_count} {item.member_count === 1 ? 'member' : 'members'}</Text>
        </View>
        <TouchableOpacity
          style={[s.joinBtn, isMember && s.joinBtnActive]}
          accessibilityRole="button"
          accessibilityLabel={`${isMember ? 'Leave' : item.has_pending ? 'Cancel request to join' : 'Join'} ${item.name}`}
          onPress={() => toggleGroupMembership(table, item.id)}
          disabled={!!busyMap[`grp-${item.id}`]}
        >
          <Text style={[s.joinBtnTxt, isMember && s.joinBtnTxtActive]}>{isMember ? 'Leave' : item.has_pending ? 'Cancel request' : 'Join'}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const showGroupList = (tab === 'communities' || tab === 'clubs') && !selectedGroup;
  const showGroupMembers = (tab === 'communities' || tab === 'clubs') && !!selectedGroup;
  const filteredGroups = (tab === 'communities' ? communities : clubs).filter(group => !search.trim() || `${group.name} ${group.description || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const followingCount = Object.values(followMap).filter(Boolean).length;


  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={t.surface.canvas} />
      <View style={s.container}>

        <View style={s.header}>
          <View style={s.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              {navigation.canGoBack() && (
                <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 10 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name="chevron-left" size={26} color={t.ink.primary} />
                </TouchableOpacity>
              )}
              <View>
              <Text style={s.title}>Network</Text>
              <Text style={s.subtitle}>
                {followingCount > 0 ? `Following ${followingCount}` : 'Find people to follow or message'}
              </Text>
              </View>
            </View>

          </View>

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={tab === 'all' ? 'Search people' : tab === 'communities' ? 'Search communities' : 'Search clubs'}
            placeholderTextColor={t.ink.muted}
            keyboardAppearance={isDark ? "dark" : "light"}
            style={s.search}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabScroll} contentContainerStyle={s.tabContent}>
            {TABS.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[s.tab, tab === t.id && s.tabActive]}
                onPress={() => { memberRequest.current++; setTab(t.id); setSelectedGroup(null); setSearch(''); }}
              >
                <Text style={[s.tabTxt, tab === t.id && s.tabTxtActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {!!loadErrors[tab] && <TouchableOpacity accessibilityRole="button" onPress={() => void loadAll(false)} style={s.error}><Text accessibilityRole="alert" style={s.emptyTxt}>{loadErrors[tab]}</Text><Text style={s.retryTxt}>Retry</Text></TouchableOpacity>}
        {loading || visibleUserId !== currentUserId ? (
          <View style={s.loader}>
            <ListRowSkeleton />
            <Text style={s.loaderTxt}>Loading network...</Text>
          </View>
        ) : showGroupList ? (
          <FlatList automaticallyAdjustKeyboardInsets={true}
            data={filteredGroups}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => renderGroupCard({ item, table: tab as 'communities' | 'clubs' })}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={7}
            removeClippedSubviews={Platform.OS === 'android'}
            onScroll={handleTabBarScroll} scrollEventThrottle={16} contentContainerStyle={[s.list, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
            ListHeaderComponent={
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 4 }}>
                <Text style={s.sectionLabel}>
                  {tab === 'communities' ? `${filteredGroups.length} communities` : `${filteredGroups.length} clubs`}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={{ borderWidth: 1.5, borderColor: t.ink.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                  onPress={() => (navigation as any).navigate('Messages', { screen: 'CreateGroup' })}
                >
                  <Text style={{ color: t.ink.primary, fontSize: 13, fontWeight: '700' }}>Group chat</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ backgroundColor: t.brand.base, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                  onPress={() => { setCreateType(tab as 'communities' | 'clubs'); setShowCreateModal(true); }}
                >
                  <Text style={{ color: t.ink.inverse, fontSize: 18, lineHeight: 20 }}>+</Text>
                  <Text style={{ color: t.ink.inverse, fontSize: 13, fontWeight: '700' }}>Create</Text>
                </TouchableOpacity>
                </View>
              </View>
            }
            ListEmptyComponent={loadErrors[tab] ? null : <View style={s.empty}><Text style={s.emptyTxt}>No groups found.</Text></View>}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(false); }} tintColor={t.ink.primary} />}
          />
        ) : showGroupMembers && selectedGroup ? (
          <View style={s.flex}>
            <View style={s.groupHeader}>
              <TouchableOpacity onPress={() => { memberRequest.current++; setSelectedGroup(null); }} style={s.backBtn}>
                <Text style={s.backTxt}>← Back</Text>
              </TouchableOpacity>
              <Text style={s.groupHeaderEmoji}>{selectedGroup.group.emoji}</Text>
              <View style={s.groupHeaderInfo}>
                <Text style={s.groupHeaderName} numberOfLines={1}>{selectedGroup.group.name}</Text>
                <Text style={s.groupHeaderCount}>{selectedGroup.group.member_count} members</Text>
              </View>
              <TouchableOpacity
                style={[s.joinBtn, (selectedGroup.table === 'communities' ? myCommIds : myClubIds).has(selectedGroup.group.id) && s.joinBtnActive]}
                onPress={() => toggleGroupMembership(selectedGroup.table, selectedGroup.group.id)}
              >
                <Text style={[s.joinBtnTxt, (selectedGroup.table === 'communities' ? myCommIds : myClubIds).has(selectedGroup.group.id) && s.joinBtnTxtActive]}>
                  {(selectedGroup.table === 'communities' ? myCommIds : myClubIds).has(selectedGroup.group.id) ? 'Leave' : 'Join'}
                </Text>
              </TouchableOpacity>
            </View>
            {groupLoading ? (
              <View style={s.loader}><ActivityIndicator color={t.ink.primary} /></View>
            ) : (
              <FlatList automaticallyAdjustKeyboardInsets={true}
                data={groupMembers}
                keyExtractor={(item) => item.id}
                renderItem={renderUserCard}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                initialNumToRender={10}
                maxToRenderPerBatch={8}
                windowSize={7}
                removeClippedSubviews={Platform.OS === 'android'}
                onScroll={handleTabBarScroll} scrollEventThrottle={16} contentContainerStyle={[s.list, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
                ListEmptyComponent={groupError ? <TouchableOpacity accessibilityRole="button" onPress={() => void openGroup(selectedGroup.table, selectedGroup.group)} style={s.error}><Text accessibilityRole="alert" style={s.emptyTxt}>{groupError}</Text><Text style={s.retryTxt}>Retry</Text></TouchableOpacity> : <View style={s.empty}><Text style={s.emptyTxt}>No members to show.</Text></View>}
              />
            )}
          </View>
        ) : (
          <FlatList automaticallyAdjustKeyboardInsets={true}
            data={filteredUsers}
            keyExtractor={(item) => item.id}
            renderItem={renderUserCard}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={7}
            removeClippedSubviews={Platform.OS === 'android'}
            onScroll={handleTabBarScroll} scrollEventThrottle={16} contentContainerStyle={[s.list, filteredUsers.length === 0 && s.listEmpty, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
            ListHeaderComponent={
              <>
                
                <Text style={s.sectionLabel}>
                  {filteredUsers.length} {filteredUsers.length === 1 ? 'person' : 'people'}
                </Text>
              </>
            }
            ListEmptyComponent={loadErrors.all ? null :
              <View style={s.empty}>
                <Text style={s.emptyTitle}>
                  {search ? 'No people found' : 'No people to show'}
                </Text>
                <Text style={s.emptyTxt}>{search ? 'Try a different search term.' : 'Check back later.'}</Text>
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(false); }} tintColor={t.ink.primary} />}
          />
        )}
      </View>

      <Modal visible={showCreateModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!creatingGroup) setShowCreateModal(false); }}>
        <View style={{ flex: 1, backgroundColor: t.surface.canvas }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline }}>
            <TouchableOpacity disabled={creatingGroup} onPress={() => setShowCreateModal(false)}>
              <Text style={{ fontSize: 17, color: t.ink.secondary }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 17, fontWeight: '700', color: t.ink.primary }}>
              Create {createType === 'communities' ? 'Community' : 'Club'}
            </Text>
            <TouchableOpacity onPress={createGroup} disabled={creatingGroup}>
              {creatingGroup
                ? <ActivityIndicator color={t.ink.primary} size="small" />
                : <Text style={{ fontSize: 17, fontWeight: '700', color: t.ink.primary }}>Create</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }} keyboardShouldPersistTaps="handled">
            {createType === 'clubs' && <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Icon</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {['🌐','🎓','💼','🌍','🤝','💡','🚀','🎯','📚','🏆','🌱','❤️','⚡','🎉','🔬','🏛️','🌏','💰','🎨','🏅'].map(e => (
                    <TouchableOpacity
                      disabled={creatingGroup}
                      key={e}
                      onPress={() => setNewGroupEmoji(e)}
                      style={{ width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: newGroupEmoji === e ? t.brand.tintBg : t.surface.sunken, borderWidth: 2, borderColor: newGroupEmoji === e ? t.ink.primary : 'transparent' }}
                    >
                      <Text style={{ fontSize: 24 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>}
            <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Name *</Text>
              <TextInput
                editable={!creatingGroup}
                value={newGroupName}
                onChangeText={setNewGroupName}
                placeholder={createType === 'communities' ? 'e.g. Harare Creatives' : 'e.g. Chess Club'}
                placeholderTextColor={t.ink.muted}
                keyboardAppearance={isDark ? "dark" : "light"}
                style={{ backgroundColor: t.surface.sunken, borderRadius: 12, borderWidth: 1, borderColor: t.surface.hairline, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: t.ink.primary }}
                autoCapitalize="words"
                maxLength={60}
              />
            </View>
            <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Description</Text>
              <TextInput
                editable={!creatingGroup}
                value={newGroupDesc}
                onChangeText={setNewGroupDesc}
                placeholder="What is this group about?"
                placeholderTextColor={t.ink.muted}
                keyboardAppearance={isDark ? "dark" : "light"}
                style={{ backgroundColor: t.surface.sunken, borderRadius: 12, borderWidth: 1, borderColor: t.surface.hairline, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.ink.primary, minHeight: 100, textAlignVertical: 'top' }}
                multiline
                maxLength={300}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  error: { padding: 16, marginHorizontal: 14, marginVertical: 8, borderRadius: 12, backgroundColor: t.surface.raised },
  retryTxt: { color: t.ink.primary, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  safe: { flex: 1, backgroundColor: t.surface.sunken },
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: t.surface.sunken },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: t.surface.sunken },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '800', color: t.ink.primary, letterSpacing: -0.5 },
  subtitle: { marginTop: 3, fontSize: 13, color: t.ink.secondary, fontWeight: '500' },
  badge: { backgroundColor: '#FF3B30', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginTop: 4 },
  badgeTxt: { fontSize: 13, fontWeight: '700', color: t.ink.inverse },
  search: {
    backgroundColor: t.surface.canvas, borderRadius: 14, borderWidth: 1, borderColor: t.surface.hairline,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: t.ink.primary, marginBottom: 10,
  },
  tabScroll: { marginBottom: 8 },
  tabContent: { paddingRight: 8, gap: 6 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: t.surface.hairline },
  tabActive: { backgroundColor: t.brand.base },
  tabTxt: { fontSize: 13, fontWeight: '600', color: t.ink.secondary },
  tabTxtActive: { color: t.ink.inverse },
  list: { paddingHorizontal: 14 },
  listEmpty: { flexGrow: 1 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: t.ink.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  affCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.surface.canvas, borderRadius: 18,
    borderWidth: 1, borderColor: t.surface.hairline,
    padding: 14, marginBottom: 10, marginTop: 4,
  },
  affIcon: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: t.brand.tintBg,
    alignItems: 'center', justifyContent: 'center',
  },
  affTitle: { fontSize: 14, fontWeight: '700', color: t.ink.primary },
  affSub: { fontSize: 12, color: t.ink.secondary, marginTop: 2, lineHeight: 16 },
  affChevron: { fontSize: 20, color: t.ink.muted, fontWeight: '500' },
  card: {
    backgroundColor: t.surface.canvas, borderRadius: 18, borderWidth: 1, borderColor: t.surface.hairline,
    padding: 14, marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatarFb: { backgroundColor: t.status.linkBg, alignItems: 'center', justifyContent: 'center' },
  avatarFbTxt: { fontWeight: '700', color: t.ink.primary },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '700', color: t.ink.primary },
  cardHandle: { fontSize: 12, color: t.ink.primary, fontWeight: '600', marginTop: 1 },
  cardMeta: { fontSize: 12, color: t.ink.secondary, marginTop: 3 },
  cardBio: { fontSize: 13, color: t.ink.secondary, lineHeight: 18, marginTop: 8 },
  cardActions: { marginTop: 10, flexDirection: 'row', gap: 8 },
  btnRow: { flexDirection: 'row', gap: 6 },
  btnConnect:     { backgroundColor: t.brand.base, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', minWidth: 96 },
  btnConnectTxt:  { color: t.ink.inverse, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  btnConnected:   { backgroundColor: t.brand.tintBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: t.status.success },
  btnConnectedTxt:{ color: t.status.success, fontSize: 13, fontWeight: '700' },
  btnPending:     { backgroundColor: t.status.innovationBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: t.surface.hairline },
  btnPendingTxt:  { color: t.ink.primary, fontSize: 13, fontWeight: '600' },
  btnAccept:      { backgroundColor: t.brand.base, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  btnAcceptTxt:   { color: t.ink.inverse, fontSize: 13, fontWeight: '700' },
  btnDecline:     { backgroundColor: t.surface.sunken, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: t.surface.hairline },
  btnDeclineTxt:  { color: t.ink.secondary, fontSize: 13, fontWeight: '600' },
  btnMessage:     { backgroundColor: t.brand.tintBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: t.surface.hairline },
  btnMessageTxt:  { color: t.ink.primary, fontSize: 13, fontWeight: '700' },
  followBtn: { minHeight: 44, justifyContent: 'center', borderWidth: 1.5, borderColor: t.surface.hairline, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  followBtnActive: { borderColor: t.brand.warm, backgroundColor: t.brand.tintBg },
  followBtnTxt: { fontSize: 12, fontWeight: '600', color: t.ink.secondary },
  followBtnTxtActive: { color: t.ink.primary },
  groupCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.surface.canvas, borderRadius: 18, borderWidth: 1, borderColor: t.surface.hairline,
    padding: 14, marginBottom: 10,
  },
  groupEmoji: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  groupEmojiTxt: { fontSize: 24 },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 14, fontWeight: '700', color: t.ink.primary },
  groupDesc: { fontSize: 12, color: t.ink.secondary, lineHeight: 16, marginTop: 3 },
  groupCount: { fontSize: 12, color: t.ink.muted, marginTop: 4, fontWeight: '500' },
  joinBtn: { minHeight: 44, justifyContent: 'center', backgroundColor: t.brand.tintBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: t.surface.hairline },
  joinBtnActive: { backgroundColor: t.brand.base, borderColor: t.ink.primary },
  joinBtnTxt: { fontSize: 12, fontWeight: '700', color: t.ink.primary },
  joinBtnTxtActive: { color: t.ink.inverse },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: t.surface.canvas, borderBottomWidth: 1, borderBottomColor: t.surface.hairline, marginBottom: 8 },
  backBtn: { paddingVertical: 4, paddingRight: 6 },
  backTxt: { fontSize: 14, color: t.ink.primary, fontWeight: '600' },
  groupHeaderEmoji: { fontSize: 22 },
  groupHeaderInfo: { flex: 1 },
  groupHeaderName: { fontSize: 14, fontWeight: '700', color: t.ink.primary },
  groupHeaderCount: { fontSize: 12, color: t.ink.secondary },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  cardWorkplace: { fontSize: 12, color: t.ink.secondary, fontWeight: '500', marginTop: 2 },
  cardSchool: { fontSize: 12, color: t.ink.secondary, marginTop: 1 },
  cardHeadline: { fontSize: 12, color: t.ink.secondary, marginTop: 3, lineHeight: 17 },
  loaderTxt: { marginTop: 12, fontSize: 14, color: t.ink.secondary },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: t.ink.primary, textAlign: 'center' },
  emptyTxt: { marginTop: 6, fontSize: 14, color: t.ink.secondary, textAlign: 'center' },
}));
