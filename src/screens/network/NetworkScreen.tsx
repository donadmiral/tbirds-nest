import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, StatusBar, ScrollView, Alert, Modal, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  cohort?: string | null;
  workplace?: string | null;
  school?: string | null;
  headline?: string | null;
};

function generateCohorts(): string[] {
  const cohorts: string[] = [];
  const startYear = 1980;
  const endYear = new Date().getFullYear() + 3;
  for (let y = endYear; y >= startYear; y--) {
    cohorts.push(`Spring ${y}`);
    cohorts.push(`Fall ${y - 1}`);
  }
  return cohorts;
}
const ALL_COHORTS = generateCohorts();

type ConnectionStatus = 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined';

type Group = {
  id: string;
  name: string;
  emoji: string;
  description?: string | null;
  member_count: number;
};

type TabId = 'all' | 'cohort' | 'communities' | 'clubs' | 'faculty' | 'alumni';

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'cohort', label: 'Cohort' },
  { id: 'communities', label: 'Communities' },
  { id: 'clubs', label: 'Clubs' },
  { id: 'faculty', label: 'Faculty' },
  { id: 'alumni', label: 'Alumni' },
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
  const [connectionMap, setConnectionMap] = useState<Record<string, ConnectionStatus>>({});
  const [orbitMap, setOrbitMap] = useState<Record<string, boolean>>({});
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});

  const [communities, setCommunities] = useState<Group[]>([]);
  const [clubs, setClubs] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<{ table: 'communities' | 'clubs'; group: Group } | null>(null);
  const [groupMembers, setGroupMembers] = useState<Profile[]>([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [myCommIds, setMyCommIds] = useState<Set<string>>(new Set());
  const [myClubIds, setMyClubIds] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCohort, setSelectedCohort]   = useState<string | null>(null);
  const [showCohortModal, setShowCohortModal] = useState(false);

  const [createType, setCreateType] = useState<'communities' | 'clubs'>('communities');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEmoji, setNewGroupEmoji] = useState('🌐');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  const [recommendations, setRecommendations] = useState<Profile[]>([]);

  const [affiliationCount, setAffiliationCount] = useState<number | null>(null);

  const loadRecommendations = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const { data: me } = await supabase.from('profiles')
        .select('cohort, graduation_year').eq('id', currentUserId).single();

      const { data: connData } = await supabase.from('connections')
        .select('requester_id, recipient_id').or(`requester_id.eq.${currentUserId},recipient_id.eq.${currentUserId}`);
      const connectedIds = new Set((connData || []).map((c: any) =>
        c.requester_id === currentUserId ? c.recipient_id : c.requester_id
      ));
      connectedIds.add(currentUserId);

      const { data: candidates } = await supabase.from('profiles')
        .select('id, full_name, username, bio, avatar_url, role, cohort, graduation_year, workplace, school, headline, degree_program')
        .not('id', 'in', `(${Array.from(connectedIds).join(',')})`)
        .eq('cohort', me?.cohort || '')
        .limit(10);

      setRecommendations((candidates || []) as Profile[]);
    } catch (e) {
      console.log('RECS_LOAD', e);
    }
  }, [currentUserId]);

  const loadAffiliationCount = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const { count } = await supabase
        .from('profile_affiliations')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', currentUserId)
        .is('left_at', null);
      setAffiliationCount(count ?? 0);
    } catch (e) {
      console.log('[AFF_COUNT]', e);
      setAffiliationCount(0);
    }
  }, [currentUserId]);

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
        .select('id, full_name, username, bio, location, degree_program, graduation_year, avatar_url, email, role, cohort, workplace, school, headline')
        .neq('id', currentUserId)
        .order('full_name', { ascending: true });

      if (profileError) {
        const { data: fallbackData } = await supabase
          .from('profiles')
          .select('id, full_name, username, bio, location, degree_program, graduation_year, avatar_url, email, cohort, workplace, school')
          .neq('id', currentUserId)
          .order('full_name', { ascending: true });
        setUsers((fallbackData || []) as Profile[]);
      } else {
        setUsers((profileData || []) as Profile[]);
      }

      const { data: connData } = await supabase
        .from('connections')
        .select('requester_id, recipient_id, status')
        .or(`requester_id.eq.${currentUserId},recipient_id.eq.${currentUserId}`);

      const cMap: Record<string, ConnectionStatus> = {};
      (connData || []).forEach((c: any) => {
        const otherId = c.requester_id === currentUserId ? c.recipient_id : c.requester_id;
        if (c.status === 'accepted') cMap[otherId] = 'connected';
        else if (c.status === 'pending') {
          cMap[otherId] = c.requester_id === currentUserId ? 'pending_sent' : 'pending_received';
        } else if (c.status === 'declined') cMap[otherId] = 'declined';
      });
      setConnectionMap(cMap);

      const { data: orbitData } = await supabase
        .from('orbits')
        .select('following_id')
        .eq('follower_id', currentUserId);

      const oMap: Record<string, boolean> = {};
      (orbitData || []).forEach((o: any) => { oMap[o.following_id] = true; });
      setOrbitMap(oMap);

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
    loadRecommendations();
    loadAffiliationCount();
  }, [loadAll, loadRecommendations, loadAffiliationCount]);

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

  const sendRequest = async (userId: string) => {
    if (!currentUserId || busyMap[userId]) return;
    setBusy(userId, true);
    try {
      const { data: existing } = await supabase
        .from('connections')
        .select('id, status')
        .or(`and(requester_id.eq.${currentUserId},recipient_id.eq.${userId}),and(requester_id.eq.${userId},recipient_id.eq.${currentUserId})`)
        .maybeSingle();

      if (existing) {
        if (existing.status === 'accepted') setConnectionMap((p) => ({ ...p, [userId]: 'connected' }));
        else if (existing.status === 'pending') setConnectionMap((p) => ({ ...p, [userId]: 'pending_sent' }));
        return;
      }

      const { error } = await supabase
        .from('connections')
        .insert({ requester_id: currentUserId, recipient_id: userId, status: 'pending' });

      if (error) {
        console.log('SEND_REQUEST_ERROR', error.message);
        Alert.alert('Error', 'Could not send connection request: ' + error.message);
        return;
      }
      setConnectionMap((p) => ({ ...p, [userId]: 'pending_sent' }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      console.log('SEND_REQUEST_CATCH', e);
    } finally {
      setBusy(userId, false);
    }
  };

  const acceptRequest = async (userId: string) => {
    if (!currentUserId || busyMap[userId]) return;
    setBusy(userId, true);
    try {
      await supabase.from('connections')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('requester_id', userId)
        .eq('recipient_id', currentUserId);
      setConnectionMap((p) => ({ ...p, [userId]: 'connected' }));
    } catch (e) {
      console.log('ACCEPT_REQUEST_ERROR', e);
    } finally {
      setBusy(userId, false);
    }
  };

  const declineRequest = async (userId: string) => {
    if (!currentUserId || busyMap[userId]) return;
    setBusy(userId, true);
    try {
      await supabase.from('connections')
        .update({ status: 'declined', updated_at: new Date().toISOString() })
        .eq('requester_id', userId)
        .eq('recipient_id', currentUserId);
      setConnectionMap((p) => ({ ...p, [userId]: 'declined' }));
    } catch (e) {
      console.log('DECLINE_REQUEST_ERROR', e);
    } finally {
      setBusy(userId, false);
    }
  };

  const withdrawRequest = async (userId: string) => {
    if (!currentUserId || busyMap[userId]) return;
    setBusy(userId, true);
    try {
      await supabase.from('connections')
        .delete()
        .eq('requester_id', currentUserId)
        .eq('recipient_id', userId);
      setConnectionMap((p) => ({ ...p, [userId]: 'none' }));
    } catch (e) {
      console.log('WITHDRAW_REQUEST_ERROR', e);
    } finally {
      setBusy(userId, false);
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
    if (!currentUserId || busyMap[`orb-${userId}`]) return;
    const was = !!orbitMap[userId];
    setBusy(`orb-${userId}`, true);
    try {
      setOrbitMap((p) => ({ ...p, [userId]: !was }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (was) {
        await supabase.from('orbits').delete().eq('follower_id', currentUserId).eq('following_id', userId);
      } else {
        await supabase.from('orbits').insert({ follower_id: currentUserId, following_id: userId });
      }
    } catch (e) {
      setOrbitMap((p) => ({ ...p, [userId]: was }));
    } finally {
      setBusy(`orb-${userId}`, false);
    }
  };

  const filteredUsers = useMemo(() => {
    let list = users;
    const term = search.trim().toLowerCase();

    if (tab === 'cohort') {
      const myGradYear = profile?.graduation_year;
      list = list.filter((u) => {
        if (selectedCohort) {
          return (u as any).cohort === selectedCohort;
        }
        return u.graduation_year != null && u.graduation_year === myGradYear;
      });
    } else if (tab === 'faculty') {
      list = list.filter((u) => u.role === 'faculty' || u.role === 'staff');
    } else if (tab === 'alumni') {
      const curYear = new Date().getFullYear();
      list = list.filter((u) => u.role === 'alumni' || (u.graduation_year != null && u.graduation_year < curYear));
    }

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
  }, [users, tab, search, profile, selectedCohort]);

  const AvatarView = ({ user, size = 52 }: { user: Profile; size?: number }) =>
    user.avatar_url
      ? <Image source={{ uri: user.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} fadeDuration={200} />
      : <View style={[s.avatarFb, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[s.avatarFbTxt, { fontSize: size * 0.33 }]}>{initials(user.full_name || user.username)}</Text>
        </View>;

  const ConnectButton = ({ user }: { user: Profile }) => {
    const status = connectionMap[user.id] || 'none';
    const busy = !!busyMap[user.id];

    if (status === 'connected') return (
      <View style={s.btnRow}>
        <View style={s.btnConnected}>
          <Text style={s.btnConnectedTxt}>✓ Connected</Text>
        </View>
        <TouchableOpacity style={s.btnMessage} onPress={() => navigation.navigate('Chat', {
          userId: user.id,
          userName: user.full_name || user.username || 'User',
          otherUser: {
            id: user.id,
            full_name: user.full_name || 'Member',
            username: user.username || null,
            avatar_url: user.avatar_url || null,
            bio: user.bio || null,
            location: user.location || null,
            degree_program: user.degree_program || null,
            graduation_year: user.graduation_year || null,
          },
        })}>
          <Text style={s.btnMessageTxt}>Message</Text>
        </TouchableOpacity>
      </View>
    );

    if (status === 'pending_sent') return (
      <TouchableOpacity style={s.btnPending} onPress={() => withdrawRequest(user.id)} disabled={busy}>
        <Text style={s.btnPendingTxt}>Requested ×</Text>
      </TouchableOpacity>
    );

    if (status === 'pending_received') return (
      <View style={s.btnRow}>
        <TouchableOpacity style={s.btnAccept} onPress={() => acceptRequest(user.id)} disabled={busy}>
          <Text style={s.btnAcceptTxt}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnDecline} onPress={() => declineRequest(user.id)} disabled={busy}>
          <Text style={s.btnDeclineTxt}>Decline</Text>
        </TouchableOpacity>
      </View>
    );

    return (
      <TouchableOpacity style={s.btnConnect} onPress={() => sendRequest(user.id)} disabled={busy}>
        {busy ? <ActivityIndicator color="#FFF" size={12} /> : <Text style={s.btnConnectTxt}>+ Connect</Text>}
      </TouchableOpacity>
    );
  };

  const FollowButton = ({ userId }: { userId: string }) => {
    const isFollowing = !!orbitMap[userId];
    return (
      <TouchableOpacity
        style={[s.orbitBtn, isFollowing && s.orbitBtnActive]}
        onPress={() => toggleFollow(userId)}
        disabled={!!busyMap[`orb-${userId}`]}
      >
        <Text style={[s.orbitBtnTxt, isFollowing && s.orbitBtnTxtActive]}>
          {isFollowing ? '● Following' : '+ Follow'}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderUserCard = ({ item }: { item: Profile }) => (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.88}
      onPress={() => navigation.push('UserProfile', { userId: item.id, user: item })}
    >
      <View style={s.cardTop}>
        <AvatarView user={item} />
        <View style={s.cardInfo}>
          <Text style={s.cardName} numberOfLines={1}>{item.full_name || 'Member'}</Text>
          {item.username ? <Text style={s.cardHandle}>@{item.username}</Text> : null}
          {(item as any).workplace
            ? <Text style={s.cardWorkplace} numberOfLines={1}>💼 {(item as any).workplace}</Text>
            : null}
          {(item as any).school
            ? <Text style={s.cardSchool} numberOfLines={1}>
                🎓 {(item as any).school}
              </Text>
            : null}
          {(item.degree_program || (item as any).cohort)
            ? <Text style={s.cardMeta} numberOfLines={1}>
                {[item.degree_program, (item as any).cohort].filter(Boolean).join(' · ')}
              </Text>
            : null}
          {(item as any).headline
            ? <Text style={s.cardHeadline} numberOfLines={2}>{(item as any).headline}</Text>
            : (item.bio ? <Text style={s.cardHeadline} numberOfLines={2}>{item.bio}</Text> : null)}
          {item.location ? <Text style={s.cardMeta} numberOfLines={1}>📍 {item.location}</Text> : null}
        </View>
        <FollowButton userId={item.id} />
      </View>
      {item.bio ? <Text style={s.cardBio} numberOfLines={2}>{item.bio}</Text> : null}
      <View style={s.cardActions}>
        <ConnectButton user={item} />
      </View>
    </TouchableOpacity>
  );

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
  const pendingCount = Object.values(connectionMap).filter((v) => v === 'pending_received').length;
  const connectedCount = Object.values(connectionMap).filter((v) => v === 'connected').length;

  const AffiliationsEntryCard = () => (
    <TouchableOpacity
      style={s.affCard}
      onPress={() => navigation.navigate('Affiliations')}
      activeOpacity={0.9}
    >
      <View style={s.affIcon}>
        <Text style={{ fontSize: 22 }}>🌐</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.affTitle}>Communities</Text>
        <Text style={s.affSub}>
          {affiliationCount !== null && affiliationCount > 0
            ? `You're in ${affiliationCount} ${affiliationCount === 1 ? 'community' : 'communities'} · Browse all`
            : 'Find clubs, cohorts and organizations to join'}
        </Text>
      </View>
      <Text style={s.affChevron}>→</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F4F6F9" />
      <View style={s.container}>

        <View style={s.header}>
          <View style={s.headerRow}>
            <View>
              <Text style={s.title}>Network</Text>
              <Text style={s.subtitle}>
                {connectedCount} connections{pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
              </Text>
            </View>
            {pendingCount > 0 && (
              <View style={s.badge}><Text style={s.badgeTxt}>{pendingCount}</Text></View>
            )}
          </View>

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search people, programs, locations..."
            placeholderTextColor="#9CA3AF"
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

        {!loading && tab === 'cohort' && (
          <TouchableOpacity
            style={s.cohortDropdownBtn}
            onPress={() => setShowCohortModal(true)}
            activeOpacity={0.8}
          >
            <Text style={s.cohortDropdownLabel}>
              {selectedCohort || 'My cohort'}
            </Text>
            <Text style={s.cohortDropdownCaret}>▾</Text>
          </TouchableOpacity>
        )}

        {loading ? (
          <View style={s.loader}>
            <ActivityIndicator size="large" color="#2563EB" />
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
            contentContainerStyle={[s.list, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}
            ListHeaderComponent={
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 4 }}>
                <Text style={s.sectionLabel}>
                  {tab === 'communities' ? `${communities.length} communities` : `${clubs.length} clubs`}
                </Text>
                <TouchableOpacity
                  style={{ backgroundColor: '#2563EB', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                  onPress={() => { setCreateType(tab as 'communities' | 'clubs'); setShowCreateModal(true); }}
                >
                  <Text style={{ color: '#FFF', fontSize: 18, lineHeight: 20 }}>+</Text>
                  <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>Create</Text>
                </TouchableOpacity>
              </View>
            }
            ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>No groups found.</Text></View>}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(false); }} tintColor="#2563EB" />}
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
              <View style={s.loader}><ActivityIndicator color="#2563EB" /></View>
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
                contentContainerStyle={[s.list, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}
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
            contentContainerStyle={[s.list, filteredUsers.length === 0 && s.listEmpty, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}
            ListHeaderComponent={
              <>
                {tab === 'all' && <AffiliationsEntryCard />}
                <Text style={s.sectionLabel}>
                  {filteredUsers.length} {filteredUsers.length === 1 ? 'person' : 'people'}
                </Text>
              </>
            }
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={s.emptyTitle}>
                  {tab === 'cohort' ? 'No cohort members found' : tab === 'faculty' ? 'No faculty found' : tab === 'alumni' ? 'No alumni found' : 'No results'}
                </Text>
                <Text style={s.emptyTxt}>{search ? 'Try a different search term.' : 'Check back later.'}</Text>
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(false); loadAffiliationCount(); }} tintColor="#2563EB" />}
          />
        )}
      </View>

      <Modal visible={showCreateModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreateModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E2E8F0' }}>
            <TouchableOpacity onPress={() => setShowCreateModal(false)}>
              <Text style={{ fontSize: 17, color: '#64748B' }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#0F172A' }}>
              Create {createType === 'communities' ? 'Community' : 'Club'}
            </Text>
            <TouchableOpacity onPress={createGroup} disabled={creatingGroup}>
              {creatingGroup
                ? <ActivityIndicator color="#2563EB" size="small" />
                : <Text style={{ fontSize: 17, fontWeight: '700', color: '#2563EB' }}>Create</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }} keyboardShouldPersistTaps="handled">
            <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Icon</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {['🌐','🎓','💼','🌍','🤝','💡','🚀','🎯','📚','🏆','🌱','❤️','⚡','🎉','🔬','🏛️','🌏','💰','🎨','🏅'].map(e => (
                    <TouchableOpacity
                      key={e}
                      onPress={() => setNewGroupEmoji(e)}
                      style={{ width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: newGroupEmoji === e ? '#EFF6FF' : '#F8FAFC', borderWidth: 2, borderColor: newGroupEmoji === e ? '#2563EB' : 'transparent' }}
                    >
                      <Text style={{ fontSize: 24 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
            <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Name *</Text>
              <TextInput
                value={newGroupName}
                onChangeText={setNewGroupName}
                placeholder={createType === 'communities' ? 'e.g. African Alumni Network' : 'e.g. Investment Club'}
                placeholderTextColor="#94A3B8"
                style={{ backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#0F172A' }}
                autoCapitalize="words"
                maxLength={60}
              />
            </View>
            <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Description</Text>
              <TextInput
                value={newGroupDesc}
                onChangeText={setNewGroupDesc}
                placeholder="What is this group about?"
                placeholderTextColor="#94A3B8"
                style={{ backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#0F172A', minHeight: 100, textAlignVertical: 'top' }}
                multiline
                maxLength={300}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showCohortModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCohortModal(false)}
      >
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCohortModal(false)}
        />
        <View style={s.cohortModalSheet}>
          <View style={s.cohortModalHandle} />
          <Text style={s.cohortModalTitle}>Select Cohort</Text>

          <FlatList
            data={[null, ...ALL_COHORTS]}
            keyExtractor={(item, i) => item ?? `null-${i}`}
            style={s.cohortModalList}
            initialScrollIndex={0}
            getItemLayout={(_, i) => ({ length: 52, offset: 52 * i, index: i })}
            renderItem={({ item: c }) => {
              const active = c === null ? !selectedCohort : selectedCohort === c;
              return (
                <TouchableOpacity
                  style={[s.cohortModalItem, active && s.cohortModalItemActive]}
                  onPress={() => { setSelectedCohort(c ?? null); setShowCohortModal(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.cohortModalItemTxt, active && s.cohortModalItemTxtActive]}>
                    {c || 'My cohort (default)'}
                  </Text>
                  {active && <Text style={s.cohortModalCheck}>✓</Text>}
                </TouchableOpacity>
              );
            }}
          />

          <TouchableOpacity
            style={s.cohortModalClose}
            onPress={() => setShowCohortModal(false)}
          >
            <Text style={s.cohortModalCloseTxt}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6F9' },
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#F4F6F9' },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: '#F4F6F9' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '800', color: '#0F172A', letterSpacing: -0.5 },
  subtitle: { marginTop: 3, fontSize: 13, color: '#64748B', fontWeight: '500' },
  badge: { backgroundColor: '#EF4444', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginTop: 4 },
  badgeTxt: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  search: {
    backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#0F172A', marginBottom: 10,
  },
  tabScroll: { marginBottom: 8 },
  tabContent: { paddingRight: 8, gap: 6 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#E2E8F0' },
  tabActive: { backgroundColor: '#0F172A' },
  tabTxt: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  tabTxtActive: { color: '#FFF' },
  list: { paddingHorizontal: 14 },
  listEmpty: { flexGrow: 1 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  affCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF', borderRadius: 18,
    borderWidth: 1, borderColor: '#E2E8F0',
    padding: 14, marginBottom: 10, marginTop: 4,
  },
  affIcon: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center',
  },
  affTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  affSub: { fontSize: 12, color: '#64748B', marginTop: 2, lineHeight: 16 },
  affChevron: { fontSize: 20, color: '#9CA3AF', fontWeight: '500' },
  card: {
    backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0',
    padding: 14, marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatarFb: { backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  avatarFbTxt: { fontWeight: '700', color: '#1D4ED8' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  cardHandle: { fontSize: 12, color: '#2563EB', fontWeight: '600', marginTop: 1 },
  cardMeta: { fontSize: 12, color: '#64748B', marginTop: 3 },
  cardBio: { fontSize: 13, color: '#475569', lineHeight: 18, marginTop: 8 },
  cardActions: { marginTop: 10, flexDirection: 'row', gap: 8 },
  btnRow: { flexDirection: 'row', gap: 6 },
  btnConnect:     { backgroundColor: '#2563EB', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', minWidth: 96 },
  btnConnectTxt:  { color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  btnConnected:   { backgroundColor: '#DCFCE7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: '#86EFAC' },
  btnConnectedTxt:{ color: '#15803D', fontSize: 13, fontWeight: '700' },
  btnPending:     { backgroundColor: '#FFF7ED', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#FED7AA' },
  btnPendingTxt:  { color: '#C2410C', fontSize: 13, fontWeight: '600' },
  btnAccept:      { backgroundColor: '#2563EB', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  btnAcceptTxt:   { color: '#FFF', fontSize: 13, fontWeight: '700' },
  btnDecline:     { backgroundColor: '#F1F5F9', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: '#CBD5E1' },
  btnDeclineTxt:  { color: '#475569', fontSize: 13, fontWeight: '600' },
  btnMessage:     { backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#BFDBFE' },
  btnMessageTxt:  { color: '#1D4ED8', fontSize: 13, fontWeight: '700' },
  orbitBtn: { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  orbitBtnActive: { borderColor: '#7C3AED', backgroundColor: '#F5F3FF' },
  orbitBtnTxt: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  orbitBtnTxtActive: { color: '#7C3AED' },
  groupCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0',
    padding: 14, marginBottom: 10,
  },
  groupEmoji: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  groupEmojiTxt: { fontSize: 24 },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  groupDesc: { fontSize: 12, color: '#64748B', lineHeight: 16, marginTop: 3 },
  groupCount: { fontSize: 12, color: '#94A3B8', marginTop: 4, fontWeight: '500' },
  joinBtn: { backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#BFDBFE' },
  joinBtnActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  joinBtnTxt: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  joinBtnTxtActive: { color: '#FFF' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', marginBottom: 8 },
  backBtn: { paddingVertical: 4, paddingRight: 6 },
  backTxt: { fontSize: 14, color: '#2563EB', fontWeight: '600' },
  groupHeaderEmoji: { fontSize: 22 },
  groupHeaderInfo: { flex: 1 },
  groupHeaderName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  groupHeaderCount: { fontSize: 12, color: '#64748B' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  cardWorkplace: { fontSize: 12, color: '#374151', fontWeight: '500', marginTop: 2 },
  cardSchool: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  cardHeadline: { fontSize: 12, color: '#6B7280', marginTop: 3, lineHeight: 17 },
  cohortDropdownBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginVertical: 10,
    backgroundColor: '#EFF6FF', borderRadius: 12, borderWidth: 1, borderColor: '#BFDBFE',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  cohortDropdownLabel: { fontSize: 14, fontWeight: '600', color: '#1D4ED8', flex: 1 },
  cohortDropdownCaret: { fontSize: 16, color: '#1D4ED8', marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  cohortModalSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 40, maxHeight: '75%',
  },
  cohortModalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB',
    alignSelf: 'center', marginTop: 12, marginBottom: 8,
  },
  cohortModalTitle: { fontSize: 17, fontWeight: '700', color: '#111', textAlign: 'center', marginBottom: 8, paddingHorizontal: 16 },
  cohortModalList: { flex: 1 },
  cohortModalItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0',
  },
  cohortModalItemActive: { backgroundColor: '#EFF6FF' },
  cohortModalItemTxt: { fontSize: 15, color: '#1F2937', fontWeight: '500' },
  cohortModalItemTxtActive: { color: '#1D4ED8', fontWeight: '700' },
  cohortModalCheck: { fontSize: 16, color: '#1D4ED8', fontWeight: '700' },
  cohortModalClose: {
    marginHorizontal: 16, marginTop: 12, backgroundColor: '#F3F4F6',
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  cohortModalCloseTxt: { fontSize: 15, fontWeight: '700', color: '#374151' },
  loaderTxt: { marginTop: 12, fontSize: 14, color: '#64748B' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A', textAlign: 'center' },
  emptyTxt: { marginTop: 6, fontSize: 14, color: '#64748B', textAlign: 'center' },
});