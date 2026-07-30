import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
import { handleTabBarScroll } from '../../components/AdaptiveTabBar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, StatusBar, ScrollView, Alert, Modal, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import * as Haptics from 'expo-haptics';

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
  emoji: string;
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
  const { profile } = useAuthStore();
  const currentUserId = profile?.id ?? null;

  const [tab, setTab] = useState<TabId>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
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
    if (!currentUserId) return;
    try {
      if (showLoader) setLoading(true);

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, username, bio, location, degree_program, graduation_year, avatar_url, email, role, workplace, school, headline')
        .neq('id', currentUserId)
        .order('full_name', { ascending: true });

      if (profileError) {
        const { data: fallbackData } = await supabase
          .from('profiles')
          .select('id, full_name, username, bio, location, degree_program, graduation_year, avatar_url, email, workplace, school')
          .neq('id', currentUserId)
          .order('full_name', { ascending: true });
        setUsers((fallbackData || []) as Profile[]);
      } else {
        setUsers((profileData || []) as Profile[]);
      }

      const { data: followData } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUserId);

      const oMap: Record<string, boolean> = {};
      (followData || []).forEach((o: any) => { oMap[o.following_id] = true; });
      setFollowMap(oMap);
      const { data: reqData } = await supabase.from('follow_requests').select('target_id').eq('requester_id', currentUserId).eq('status', 'pending');
      const rMap: Record<string, boolean> = {};
      (reqData || []).forEach((r: any) => { rMap[r.target_id] = true; });
      setRequestedMap(rMap);

      const [{ data: commData }, { data: clubData }] = await Promise.all([
        supabase.from('communities').select('id, name, emoji, description, member_count').order('name'),
        supabase.from('clubs').select('id, name, emoji, description, member_count').order('name'),
      ]);
      setCommunities((commData || []) as Group[]);
      setClubs((clubData || []) as Group[]);

      const [{ data: myComms }, { data: myClubs }] = await Promise.all([
        supabase.from('community_members').select('community_id').eq('user_id', currentUserId),
        supabase.from('club_members').select('club_id').eq('user_id', currentUserId),
      ]);
      setMyCommIds(new Set((myComms || []).map((m: any) => m.community_id)));
      setMyClubIds(new Set((myClubs || []).map((m: any) => m.club_id)));

    } catch (e) {
      console.log('LOAD_NETWORK_ERROR', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadAll(true);

  }, [loadAll]);

  const openGroup = async (table: 'communities' | 'clubs', group: Group) => {
    setSelectedGroup({ table, group });
    setGroupLoading(true);
    try {
      const joinTable = table === 'communities' ? 'community_members' : 'club_members';
      const fkCol = table === 'communities' ? 'community_id' : 'club_id';
      const { data: memberIds } = await supabase.from(joinTable).select('user_id').eq(fkCol, group.id);
      const ids = (memberIds || []).map((m: any) => m.user_id);
      if (ids.length > 0) {
        const { data: members } = await supabase
          .from('profiles')
          .select('id, full_name, username, bio, location, degree_program, avatar_url, role')
          .in('id', ids);
        setGroupMembers((members || []) as Profile[]);
      } else {
        setGroupMembers([]);
      }
    } catch (e) {
      console.log('OPEN_GROUP_ERROR', e);
    } finally {
      setGroupLoading(false);
    }
  };

  const toggleGroupMembership = async (table: 'communities' | 'clubs', groupId: string) => {
    if (!currentUserId || busyMap[`grp-${groupId}`]) return;
    setBusy(`grp-${groupId}`, true);
    const joinTable = table === 'communities' ? 'community_members' : 'club_members';
    const fkCol    = table === 'communities' ? 'community_id' : 'club_id';
    const isMember = table === 'communities' ? myCommIds.has(groupId) : myClubIds.has(groupId);
    const setFn    = table === 'communities' ? setMyCommIds : setMyClubIds;
    try {
      if (isMember) {
        await supabase.from(joinTable).delete().eq(fkCol, groupId).eq('user_id', currentUserId);
        setFn((s) => { const n = new Set(s); n.delete(groupId); return n; });
      } else {
        const { error } = await supabase.from(joinTable)
          .insert({ [fkCol]: groupId, user_id: currentUserId });
        if (error) { console.log('JOIN_GROUP_ERR', error.message); throw error; }
        setFn((s) => new Set([...s, groupId]));
        const groups = table === 'communities' ? communities : clubs;
        const grp = groups.find(g => g.id === groupId);
        if (grp) {
          try {
            const { error: rpcErr } = await supabase.rpc('get_or_create_group_conversation', {
              p_group_type:  table === 'communities' ? 'community' : 'club',
              p_group_id:    groupId,
              p_group_name:  grp.name,
              p_group_emoji: grp.emoji || '💬',
              p_user_id:     currentUserId,
            });
            if (rpcErr) console.log('[GRP_CONV_RPC non-fatal]', rpcErr.message);
          } catch (rpcEx: any) {
            console.log('[GRP_CONV_RPC non-fatal]', rpcEx?.message);
          }
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not update membership');
    } finally {
      setBusy(`grp-${groupId}`, false);
    }
  };

  const createGroup = async () => {
    if (!currentUserId || creatingGroup) return;
    if (!newGroupName.trim()) { Alert.alert('Required', 'Enter a group name.'); return; }
    setCreatingGroup(true);
    try {
      const table = createType;
      const { data, error } = await supabase.from(table).insert({
        name: newGroupName.trim(),
        emoji: newGroupEmoji,
        description: newGroupDesc.trim() || null,
        created_by: currentUserId,
        member_count: 1,
      }).select().single();

      if (error) { Alert.alert('Error', error.message); return; }

      const joinTable = createType === 'communities' ? 'community_members' : 'club_members';
      const fkCol = createType === 'communities' ? 'community_id' : 'club_id';
      await supabase.from(joinTable).insert({ [fkCol]: data.id, user_id: currentUserId });

      setNewGroupName('');
      setNewGroupDesc('');
      setNewGroupEmoji('🌐');
      setShowCreateModal(false);
      await loadAll(false);
      Alert.alert('Created!', `${data.name} is now live.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not create group.');
    } finally {
      setCreatingGroup(false);
    }
  };

  const toggleFollow = async (userId: string) => {
    if (!currentUserId || busyMap[`follow-${userId}`]) return;
    const was = !!followMap[userId];
    setBusy(`follow-${userId}`, true);
    try {
      if (was) setFollowMap((p) => ({ ...p, [userId]: false }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const { data, error } = await supabase.rpc('handle_follow_action', { p_target_id: userId });
      if (error) throw error;
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
    } catch (e) {
      setFollowMap((p) => ({ ...p, [userId]: was }));
    } finally {
      setBusy(`follow-${userId}`, false);
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


  const AvatarView = ({ user, size = 52 }: { user: Profile; size?: number }) =>
    user.avatar_url
      ? <Image source={{ uri: user.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} fadeDuration={200} />
      : <View style={[s.avatarFb, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[s.avatarFbTxt, { fontSize: size * 0.33 }]}>{initials(user.full_name || user.username)}</Text>
        </View>;

  const FollowButton = ({ userId }: { userId: string }) => {
    const isFollowing = !!followMap[userId];
    const isRequested = !!requestedMap[userId];
    return (
      <TouchableOpacity
        style={[s.followBtn, (isFollowing || isRequested) && s.followBtnActive]}
        onPress={() => toggleFollow(userId)}
        disabled={!!busyMap[`follow-${userId}`]}
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
                 backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.10)' }}
      >
        <AvatarView user={item} size={46} />
        <View style={{ flex: 1, marginLeft: 12, marginRight: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TierName userId={item.id} baseStyle={{ fontSize: 15.5, fontWeight: '700', color: '#0B1E3D', flexShrink: 1 }} text={item.full_name || 'Member'} /><VerifiedBadge userId={item.id} size={13} />
          </View>
          {sub ? (
            <Text style={{ fontSize: 13, color: '#5C6B82', marginTop: 2 }} numberOfLines={1}>{sub}</Text>
          ) : null}
        </View>
        <FollowButton userId={item.id} />
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
          onPress={() => toggleGroupMembership(table, item.id)}
          disabled={!!busyMap[`grp-${item.id}`]}
        >
          <Text style={[s.joinBtnTxt, isMember && s.joinBtnTxtActive]}>{isMember ? 'Joined' : 'Join'}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const showGroupList = (tab === 'communities' || tab === 'clubs') && !selectedGroup;
  const showGroupMembers = (tab === 'communities' || tab === 'clubs') && !!selectedGroup;
  const followingCount = Object.values(followMap).filter(Boolean).length;


  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F7" />
      <View style={s.container}>

        <View style={s.header}>
          <View style={s.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              {navigation.canGoBack() && (
                <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 10 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name="chevron-left" size={26} color="#0B1E3D" />
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
            placeholder="Search people"
            placeholderTextColor="rgba(11,30,61,0.35)"
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
                onPress={() => { setTab(t.id); setSelectedGroup(null); setSearch(''); }}
              >
                <Text style={[s.tabTxt, tab === t.id && s.tabTxtActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {loading ? (
          <View style={s.loader}>
            <ActivityIndicator size="large" color="#0B1E3D" />
            <Text style={s.loaderTxt}>Loading network...</Text>
          </View>
        ) : showGroupList ? (
          <FlatList
            data={tab === 'communities' ? communities : clubs}
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
                  {tab === 'communities' ? `${communities.length} communities` : `${clubs.length} clubs`}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={{ borderWidth: 1.5, borderColor: '#0B1E3D', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                  onPress={() => (navigation as any).navigate('Messages', { screen: 'CreateGroup' })}
                >
                  <Text style={{ color: '#0B1E3D', fontSize: 13, fontWeight: '700' }}>Group chat</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ backgroundColor: '#0B1E3D', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                  onPress={() => { setCreateType(tab as 'communities' | 'clubs'); setShowCreateModal(true); }}
                >
                  <Text style={{ color: '#FFF', fontSize: 18, lineHeight: 20 }}>+</Text>
                  <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>Create</Text>
                </TouchableOpacity>
                </View>
              </View>
            }
            ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>No groups found.</Text></View>}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(false); }} tintColor="#0B1E3D" />}
          />
        ) : showGroupMembers && selectedGroup ? (
          <View style={s.flex}>
            <View style={s.groupHeader}>
              <TouchableOpacity onPress={() => setSelectedGroup(null)} style={s.backBtn}>
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
                  {(selectedGroup.table === 'communities' ? myCommIds : myClubIds).has(selectedGroup.group.id) ? 'Joined' : 'Join'}
                </Text>
              </TouchableOpacity>
            </View>
            {groupLoading ? (
              <View style={s.loader}><ActivityIndicator color="#0B1E3D" /></View>
            ) : (
              <FlatList
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
                ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>No members yet. Join to be the first!</Text></View>}
              />
            )}
          </View>
        ) : (
          <FlatList
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
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={s.emptyTitle}>
                  
                </Text>
                <Text style={s.emptyTxt}>{search ? 'Try a different search term.' : 'Check back later.'}</Text>
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(false); }} tintColor="#0B1E3D" />}
          />
        )}
      </View>

      <Modal visible={showCreateModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreateModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.1)' }}>
            <TouchableOpacity onPress={() => setShowCreateModal(false)}>
              <Text style={{ fontSize: 17, color: 'rgba(11,30,61,0.5)' }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#0B1E3D' }}>
              Create {createType === 'communities' ? 'Community' : 'Club'}
            </Text>
            <TouchableOpacity onPress={createGroup} disabled={creatingGroup}>
              {creatingGroup
                ? <ActivityIndicator color="#0B1E3D" size="small" />
                : <Text style={{ fontSize: 17, fontWeight: '700', color: '#0B1E3D' }}>Create</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }} keyboardShouldPersistTaps="handled">
            <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: 'rgba(11,30,61,0.5)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Icon</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {['🌐','🎓','💼','🌍','🤝','💡','🚀','🎯','📚','🏆','🌱','❤️','⚡','🎉','🔬','🏛️','🌏','💰','🎨','🏅'].map(e => (
                    <TouchableOpacity
                      key={e}
                      onPress={() => setNewGroupEmoji(e)}
                      style={{ width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: newGroupEmoji === e ? 'rgba(176,141,63,0.1)' : '#F5F5F7', borderWidth: 2, borderColor: newGroupEmoji === e ? '#0B1E3D' : 'transparent' }}
                    >
                      <Text style={{ fontSize: 24 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
            <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: 'rgba(11,30,61,0.5)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Name *</Text>
              <TextInput
                value={newGroupName}
                onChangeText={setNewGroupName}
                placeholder={createType === 'communities' ? 'e.g. Harare Creatives' : 'e.g. Chess Club'}
                placeholderTextColor="rgba(11,30,61,0.35)"
                style={{ backgroundColor: '#F5F5F7', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(11,30,61,0.1)', paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#0B1E3D' }}
                autoCapitalize="words"
                maxLength={60}
              />
            </View>
            <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: 'rgba(11,30,61,0.5)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Description</Text>
              <TextInput
                value={newGroupDesc}
                onChangeText={setNewGroupDesc}
                placeholder="What is this group about?"
                placeholderTextColor="rgba(11,30,61,0.35)"
                style={{ backgroundColor: '#F5F5F7', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(11,30,61,0.1)', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#0B1E3D', minHeight: 100, textAlignVertical: 'top' }}
                multiline
                maxLength={300}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F5F7' },
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: '#F5F5F7' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '800', color: '#0B1E3D', letterSpacing: -0.5 },
  subtitle: { marginTop: 3, fontSize: 13, color: 'rgba(11,30,61,0.5)', fontWeight: '500' },
  badge: { backgroundColor: '#FF3B30', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginTop: 4 },
  badgeTxt: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  search: {
    backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(11,30,61,0.1)',
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#0B1E3D', marginBottom: 10,
  },
  tabScroll: { marginBottom: 8 },
  tabContent: { paddingRight: 8, gap: 6 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(11,30,61,0.1)' },
  tabActive: { backgroundColor: '#0B1E3D' },
  tabTxt: { fontSize: 13, fontWeight: '600', color: 'rgba(11,30,61,0.5)' },
  tabTxtActive: { color: '#FFF' },
  list: { paddingHorizontal: 14 },
  listEmpty: { flexGrow: 1 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(11,30,61,0.35)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  affCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(11,30,61,0.1)',
    padding: 14, marginBottom: 10, marginTop: 4,
  },
  affIcon: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: 'rgba(176,141,63,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  affTitle: { fontSize: 14, fontWeight: '700', color: '#0B1E3D' },
  affSub: { fontSize: 12, color: 'rgba(11,30,61,0.5)', marginTop: 2, lineHeight: 16 },
  affChevron: { fontSize: 20, color: 'rgba(11,30,61,0.35)', fontWeight: '500' },
  card: {
    backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(11,30,61,0.1)',
    padding: 14, marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatarFb: { backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  avatarFbTxt: { fontWeight: '700', color: '#0B1E3D' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '700', color: '#0B1E3D' },
  cardHandle: { fontSize: 12, color: '#0B1E3D', fontWeight: '600', marginTop: 1 },
  cardMeta: { fontSize: 12, color: 'rgba(11,30,61,0.5)', marginTop: 3 },
  cardBio: { fontSize: 13, color: 'rgba(11,30,61,0.6)', lineHeight: 18, marginTop: 8 },
  cardActions: { marginTop: 10, flexDirection: 'row', gap: 8 },
  btnRow: { flexDirection: 'row', gap: 6 },
  btnConnect:     { backgroundColor: '#0B1E3D', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', minWidth: 96 },
  btnConnectTxt:  { color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  btnConnected:   { backgroundColor: '#DCFCE7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: '#86EFAC' },
  btnConnectedTxt:{ color: '#15803D', fontSize: 13, fontWeight: '700' },
  btnPending:     { backgroundColor: '#FAF6EC', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#E8DFC8' },
  btnPendingTxt:  { color: '#C2410C', fontSize: 13, fontWeight: '600' },
  btnAccept:      { backgroundColor: '#0B1E3D', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  btnAcceptTxt:   { color: '#FFF', fontSize: 13, fontWeight: '700' },
  btnDecline:     { backgroundColor: '#F5F5F7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: 'rgba(11,30,61,0.12)' },
  btnDeclineTxt:  { color: 'rgba(11,30,61,0.6)', fontSize: 13, fontWeight: '600' },
  btnMessage:     { backgroundColor: 'rgba(176,141,63,0.1)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#C9D3E2' },
  btnMessageTxt:  { color: '#0B1E3D', fontSize: 13, fontWeight: '700' },
  followBtn: { borderWidth: 1.5, borderColor: 'rgba(11,30,61,0.12)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  followBtnActive: { borderColor: '#B08D3F', backgroundColor: '#F5F3FF' },
  followBtnTxt: { fontSize: 12, fontWeight: '600', color: 'rgba(11,30,61,0.5)' },
  followBtnTxtActive: { color: '#B08D3F' },
  groupCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(11,30,61,0.1)',
    padding: 14, marginBottom: 10,
  },
  groupEmoji: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F5F5F7', alignItems: 'center', justifyContent: 'center' },
  groupEmojiTxt: { fontSize: 24 },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 14, fontWeight: '700', color: '#0B1E3D' },
  groupDesc: { fontSize: 12, color: 'rgba(11,30,61,0.5)', lineHeight: 16, marginTop: 3 },
  groupCount: { fontSize: 12, color: 'rgba(11,30,61,0.35)', marginTop: 4, fontWeight: '500' },
  joinBtn: { backgroundColor: 'rgba(176,141,63,0.1)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#C9D3E2' },
  joinBtnActive: { backgroundColor: '#0B1E3D', borderColor: '#0B1E3D' },
  joinBtnTxt: { fontSize: 12, fontWeight: '700', color: '#0B1E3D' },
  joinBtnTxtActive: { color: '#FFF' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: 'rgba(11,30,61,0.1)', marginBottom: 8 },
  backBtn: { paddingVertical: 4, paddingRight: 6 },
  backTxt: { fontSize: 14, color: '#0B1E3D', fontWeight: '600' },
  groupHeaderEmoji: { fontSize: 22 },
  groupHeaderInfo: { flex: 1 },
  groupHeaderName: { fontSize: 14, fontWeight: '700', color: '#0B1E3D' },
  groupHeaderCount: { fontSize: 12, color: 'rgba(11,30,61,0.5)' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  cardWorkplace: { fontSize: 12, color: '#24344D', fontWeight: '500', marginTop: 2 },
  cardSchool: { fontSize: 12, color: '#5C6B82', marginTop: 1 },
  cardHeadline: { fontSize: 12, color: '#5C6B82', marginTop: 3, lineHeight: 17 },
  loaderTxt: { marginTop: 12, fontSize: 14, color: 'rgba(11,30,61,0.5)' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#0B1E3D', textAlign: 'center' },
  emptyTxt: { marginTop: 6, fontSize: 14, color: 'rgba(11,30,61,0.5)', textAlign: 'center' },
});
