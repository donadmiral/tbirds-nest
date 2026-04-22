import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  ActivityIndicator, StatusBar, Alert, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import MediaRenderer, { PostMedia } from '../../components/MediaRenderer';

const SCREEN_W = Dimensions.get('window').width;

type UserProfile = {
  id: string; full_name: string; username: string; bio: string;
  location: string; degree_program: string; graduation_year: number | null;
  avatar_url: string | null; role: string;
};
type Stats = { posts: number; connections: number; followers: number };
type Post = {
  id: string;
  content: string;
  likes_count: number;
  comments_count: number;
  created_at: string;
  media_url: string | null;
  media: PostMedia[];
};
type ConnectionStatus = 'none' | 'pending_sent' | 'pending_received' | 'connected';

function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}
function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`; if (dy < 7) return `${dy}d`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function UserProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile: authProfile } = useAuthStore();
  const myId = authProfile?.id ?? null;

  const targetId: string = route.params?.userId ?? route.params?.user?.id;

  const [profile, setProfile] = useState<UserProfile | null>(route.params?.user ?? null);
  const [stats, setStats] = useState<Stats>({ posts: 0, connections: 0, followers: 0 });
  const [posts, setPosts] = useState<Post[]>([]);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('none');
  const [connRequestId, setConnRequestId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    if (!targetId) return;
    try {
      const { data: pd } = await supabase.from('profiles').select('*').eq('id', targetId).single();
      if (pd) setProfile({
        id: pd.id, full_name: pd.full_name || '', username: pd.username || '',
        bio: pd.bio || '', location: pd.location || '', degree_program: pd.degree_program || '',
        graduation_year: pd.graduation_year ?? null, avatar_url: pd.avatar_url || null, role: pd.role || 'student',
      });

      const [postsR, connR, followR] = await Promise.all([
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', targetId),
        supabase.from('connections').select('id', { count: 'exact', head: true })
          .or(`requester_id.eq.${targetId},recipient_id.eq.${targetId}`).eq('status', 'accepted'),
        supabase.from('orbits').select('id', { count: 'exact', head: true }).eq('following_id', targetId),
      ]);
      setStats({ posts: postsR.count ?? 0, connections: connR.count ?? 0, followers: followR.count ?? 0 });

      // Posts with media array, matching Profile and Feed shape.
      let postsData: any[] = [];
      try {
        const { data } = await supabase
          .from('posts')
          .select('id, content, likes_count, comments_count, created_at, media_url, post_media(id, url, media_type, width, height, sort_order)')
          .eq('user_id', targetId)
          .order('created_at', { ascending: false })
          .limit(20);
        postsData = data || [];
      } catch {
        const { data } = await supabase
          .from('posts')
          .select('id, content, likes_count, comments_count, created_at, media_url')
          .eq('user_id', targetId)
          .order('created_at', { ascending: false })
          .limit(20);
        postsData = data || [];
      }
      const shaped: Post[] = postsData.map((p: any) => {
        const mediaArr: PostMedia[] = Array.isArray(p.post_media) && p.post_media.length > 0
          ? (p.post_media as PostMedia[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          : (p.media_url ? [{ id: '0', url: p.media_url, media_type: 'image', sort_order: 0 }] : []);
        return {
          id: p.id,
          content: p.content || '',
          likes_count: p.likes_count ?? 0,
          comments_count: p.comments_count ?? 0,
          created_at: p.created_at,
          media_url: p.media_url || null,
          media: mediaArr,
        };
      });
      setPosts(shaped);

      if (myId && myId !== targetId) {
        const { data: conn } = await supabase.from('connections')
          .select('id, requester_id, recipient_id, status')
          .or(`and(requester_id.eq.${myId},recipient_id.eq.${targetId}),and(requester_id.eq.${targetId},recipient_id.eq.${myId})`)
          .maybeSingle();
        if (!conn) { setConnStatus('none'); setConnRequestId(null); }
        else if (conn.status === 'accepted') { setConnStatus('connected'); setConnRequestId(conn.id); }
        else if (conn.requester_id === myId) { setConnStatus('pending_sent'); setConnRequestId(conn.id); }
        else { setConnStatus('pending_received'); setConnRequestId(conn.id); }

        const { data: orb } = await supabase.from('orbits').select('id')
          .eq('follower_id', myId).eq('following_id', targetId).maybeSingle();
        setFollowing(!!orb);
      }
    } catch (e) { console.log('USER_PROFILE_LOAD', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [targetId, myId]);

  useEffect(() => { load(); }, [load]);

  const handleConnect = async () => {
    if (!myId || actionBusy) return;
    setActionBusy(true);
    try {
      if (connStatus === 'none') {
        const { data, error } = await supabase.from('connections')
          .insert({ requester_id: myId, recipient_id: targetId, status: 'pending' })
          .select('id').single();
        if (error) throw error;
        setConnStatus('pending_sent');
        setConnRequestId(data?.id ?? null);
      } else if (connStatus === 'pending_sent' && connRequestId) {
        const { error } = await supabase.from('connections').delete().eq('id', connRequestId);
        if (error) throw error;
        setConnStatus('none');
        setConnRequestId(null);
      } else if (connStatus === 'pending_received' && connRequestId) {
        const { error } = await supabase.from('connections')
          .update({ status: 'accepted', updated_at: new Date().toISOString() })
          .eq('id', connRequestId);
        if (error) throw error;
        setConnStatus('connected');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not update connection.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleFollow = async () => {
    if (!myId || actionBusy) return;
    setActionBusy(true);
    const was = following;
    try {
      setFollowing(!was);
      if (was) {
        const { error } = await supabase.from('orbits').delete()
          .eq('follower_id', myId).eq('following_id', targetId);
        if (error) { setFollowing(true); throw error; }
      } else {
        const { error } = await supabase.from('orbits')
          .insert({ follower_id: myId, following_id: targetId });
        if (error) { setFollowing(false); throw error; }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not update follow.');
    } finally {
      setActionBusy(false);
    }
  };

  const connectLabel = () => {
    if (connStatus === 'connected') return 'Connected';
    if (connStatus === 'pending_sent') return 'Requested';
    if (connStatus === 'pending_received') return 'Accept';
    return 'Connect';
  };

  const isOwnProfile = myId === targetId;

  if (loading) return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.loader}><ActivityIndicator color="#007AFF" size="large" /></View>
    </SafeAreaView>
  );

  if (!profile) return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.loader}>
        <Feather name="user-x" size={40} color="#E5E5EA" />
        <Text style={s.notFoundTxt}>Profile not found</Text>
        <TouchableOpacity style={s.goBackBtn} onPress={() => navigation.goBack()}>
          <Text style={s.goBackBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text>
          <Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{profile.full_name || 'Profile'}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#007AFF" />}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 40, 60) }}
      >
        <View style={s.identityCard}>
          <View style={s.avatarRow}>
            {profile.avatar_url
              ? <Image source={{ uri: profile.avatar_url }} style={s.avatar} />
              : <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarFbTxt}>{initials(profile.full_name)}</Text></View>}
            <View style={s.statsRow}>
              {[
                { label: 'Posts', v: stats.posts },
                { label: 'Connections', v: stats.connections },
                { label: 'Followers', v: stats.followers },
              ].map(stat => (
                <View key={stat.label} style={s.statItem}>
                  <Text style={s.statValue}>{stat.v}</Text>
                  <Text style={s.statLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={s.name}>{profile.full_name || 'Member'}</Text>
          {profile.username ? <Text style={s.handle}>@{profile.username}</Text> : null}
          {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}

          <View style={s.metaRow}>
            {profile.degree_program ? (
              <View style={s.metaItem}>
                <Feather name="book" size={13} color="#8E8E93" />
                <Text style={s.metaTxt}>{profile.degree_program}{profile.graduation_year ? ` · ${profile.graduation_year}` : ''}</Text>
              </View>
            ) : null}
            {profile.location ? (
              <View style={s.metaItem}>
                <Feather name="map-pin" size={13} color="#8E8E93" />
                <Text style={s.metaTxt}>{profile.location}</Text>
              </View>
            ) : null}
            {profile.role ? (
              <View style={s.rolePill}>
                <Text style={s.rolePillTxt}>{profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}</Text>
              </View>
            ) : null}
          </View>

          {!isOwnProfile && (
            <View style={s.actions}>
              <TouchableOpacity
                style={[
                  s.connectBtn,
                  connStatus === 'connected' && s.connectedBtn,
                  connStatus === 'pending_sent' && s.pendingSentBtn,
                  connStatus === 'pending_received' && s.acceptBtn,
                ]}
                onPress={handleConnect} activeOpacity={0.8} disabled={actionBusy}
              >
                <Feather
                  name={connStatus === 'connected' ? 'user-check' : connStatus === 'pending_sent' ? 'clock' : 'user-plus'}
                  size={15}
                  color={connStatus === 'connected' ? '#16A34A' : connStatus === 'pending_sent' ? '#7C3AED' : '#FFF'}
                />
                <Text style={[
                  s.connectBtnTxt,
                  connStatus === 'connected' && s.connectedBtnTxt,
                  connStatus === 'pending_sent' && s.pendingSentBtnTxt,
                ]}>{connectLabel()}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.followBtn, following && s.followingBtn]}
                onPress={handleFollow} activeOpacity={0.8} disabled={actionBusy}
              >
                <Feather name={following ? 'user-check' : 'user-plus'} size={15} color={following ? '#7C3AED' : '#8E8E93'} />
                <Text style={[s.followBtnTxt, following && s.followingBtnTxt]}>{following ? 'Following' : 'Follow'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.messageBtn}
                onPress={() => navigation.navigate('Chat', {
                  userId: targetId,
                  userName: profile.full_name,
                  otherUser: {
                    id: profile.id,
                    full_name: profile.full_name,
                    username: profile.username,
                    avatar_url: profile.avatar_url,
                    bio: profile.bio,
                    location: profile.location,
                    degree_program: profile.degree_program,
                    graduation_year: profile.graduation_year,
                  },
                })}
                activeOpacity={0.8}
              >
                <Feather name="message-circle" size={15} color="#007AFF" />
                <Text style={s.messageBtnTxt}>Message</Text>
              </TouchableOpacity>
            </View>
          )}
          {isOwnProfile && (
            <TouchableOpacity
              style={s.editOwnBtn}
              onPress={() => navigation.navigate('Profile', { screen: 'ProfileMain', params: { edit: true } })}
              activeOpacity={0.8}
            >
              <Text style={s.editOwnBtnTxt}>Edit Profile</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={s.postsSection}>
          <Text style={s.postsSectionTitle}>Posts</Text>
          {posts.length === 0 ? (
            <View style={s.emptyPosts}>
              <Feather name="edit-3" size={32} color="#E5E5EA" />
              <Text style={s.emptyPostsTxt}>No posts yet</Text>
            </View>
          ) : (
            posts.map(post => (
              <TouchableOpacity key={post.id} style={s.postCard} activeOpacity={0.88} onPress={() => navigation.navigate('Post', { postId: post.id })}>
                {post.media.length > 0 ? (
                  <View style={{ marginBottom: 10 }}>
                    <MediaRenderer
                      media={post.media}
                      containerWidth={SCREEN_W - 32}
                      maxHeight={380}
                    />
                  </View>
                ) : null}
                <Text style={s.postContent} numberOfLines={3}>{post.content}</Text>
                <View style={s.postFooter}>
                  <View style={s.postFooterItem}><Feather name="heart" size={13} color="#8E8E93" /><Text style={s.postFooterTxt}>{post.likes_count}</Text></View>
                  <View style={s.postFooterItem}><Feather name="message-circle" size={13} color="#8E8E93" /><Text style={s.postFooterTxt}>{post.comments_count}</Text></View>
                  <Text style={s.postTime}>{relTime(post.created_at)}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFoundTxt: { fontSize: 18, fontWeight: '600', color: '#3C3C43' },
  goBackBtn: { backgroundColor: '#007AFF', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  goBackBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginRight: 1 },
  backLbl: { fontSize: 17, color: '#007AFF' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000', flex: 1, textAlign: 'center' },
  identityCard: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: { width: 80, height: 80, borderRadius: 40, marginRight: 20 },
  avatarFb: { backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  avatarFbTxt: { fontSize: 28, fontWeight: '700', color: '#1D4ED8' },
  statsRow: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#000' },
  statLabel: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  name: { fontSize: 20, fontWeight: '700', color: '#000', marginBottom: 2 },
  handle: { fontSize: 14, color: '#007AFF', fontWeight: '500', marginBottom: 6 },
  bio: { fontSize: 15, color: '#3C3C43', lineHeight: 21, marginBottom: 10 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaTxt: { fontSize: 13, color: '#8E8E93' },
  rolePill: { backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  rolePillTxt: { fontSize: 12, fontWeight: '600', color: '#3C3C43' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  connectBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#1D4ED8' },
  connectedBtn: { backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0' },
  pendingSentBtn: { backgroundColor: '#F5F3FF', borderWidth: 1, borderColor: '#DDD6FE' },
  acceptBtn: { backgroundColor: '#16A34A' },
  connectBtnTxt: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  connectedBtnTxt: { color: '#16A34A', fontWeight: '700' },
  pendingSentBtnTxt: { color: '#7C3AED', fontWeight: '600' },
  followBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#E5E5EA', backgroundColor: '#FAFAFA' },
  followingBtn: { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' },
  followBtnTxt: { fontSize: 14, fontWeight: '500', color: '#8E8E93' },
  followingBtnTxt: { color: '#7C3AED', fontWeight: '600' },
  messageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#007AFF', backgroundColor: '#EFF6FF' },
  messageBtnTxt: { fontSize: 14, fontWeight: '600', color: '#007AFF' },
  editOwnBtn: { paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5EA', alignItems: 'center' },
  editOwnBtnTxt: { fontSize: 15, fontWeight: '600', color: '#000' },
  postsSection: { paddingTop: 8 },
  postsSectionTitle: { fontSize: 15, fontWeight: '700', color: '#000', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5' },
  emptyPosts: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyPostsTxt: { fontSize: 15, color: '#8E8E93' },
  postCard: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  postContent: { fontSize: 15, color: '#1A1A1A', lineHeight: 22, marginBottom: 10 },
  postFooter: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  postFooterItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  postFooterTxt: { fontSize: 13, color: '#8E8E93' },
  postTime: { fontSize: 13, color: '#C7C7CC', marginLeft: 'auto' },
});