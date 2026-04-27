/**
 * UserProfileScreen.tsx
 * Design A — Classic iOS Style contact info, Clean Premium language.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  ActivityIndicator, StatusBar, Alert, Share, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import MediaRenderer, { PostMedia } from '../../components/MediaRenderer';
import { Image as ExpoImage } from 'expo-image';

const SCREEN_W = Dimensions.get('window').width;

const NAVY = '#0B1E3D';
const NAVY_SOFT = '#1A3560';
const BG_GREY = '#F7F7F9';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

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

  const openMessage = () => {
    if (!profile) return;
    navigation.navigate('Chat', {
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
    });
  };

  const isOwnProfile = myId === targetId;

  if (loading) return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.loader}><ActivityIndicator color={NAVY} size="large" /></View>
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{profile.full_name || 'Profile'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={NAVY} />}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 40, 60) }}
      >
        <View style={s.hero}>
          {profile.avatar_url
            ? <Image source={{ uri: profile.avatar_url }} style={s.avatar} />
            : <View style={[s.avatar, s.avatarFb]}><Text style={s.avatarFbTxt}>{initials(profile.full_name)}</Text></View>}

          <Text style={s.name}>{profile.full_name || 'Member'}</Text>
          {profile.username ? <Text style={s.handle}>@{profile.username}</Text> : null}

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

          {!isOwnProfile && (
            <View style={s.heroActions}>
              <TouchableOpacity style={s.heroAction} activeOpacity={0.7} onPress={openMessage}>
                <View style={s.heroActionInner}><Feather name="message-circle" size={20} color={NAVY} /></View>
                <Text style={s.heroActionLbl}>Message</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.heroAction} activeOpacity={0.7}
                onPress={handleConnect} disabled={actionBusy}
              >
                <View style={[s.heroActionInner, connStatus === 'connected' && s.heroActionInnerActive]}>
                  <Feather
                    name={connStatus === 'connected' ? 'user-check' : connStatus === 'pending_sent' ? 'clock' : 'user-plus'}
                    size={20}
                    color={connStatus === 'connected' ? '#FFF' : NAVY}
                  />
                </View>
                <Text style={s.heroActionLbl}>
                  {connStatus === 'connected' ? 'Connected' : connStatus === 'pending_sent' ? 'Requested' : connStatus === 'pending_received' ? 'Accept' : 'Connect'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.heroAction} activeOpacity={0.7}
                onPress={handleFollow} disabled={actionBusy}
              >
                <View style={[s.heroActionInner, following && s.heroActionInnerActive]}>
                  <Feather name={following ? 'check' : 'plus'} size={20} color={following ? '#FFF' : NAVY} />
                </View>
                <Text style={s.heroActionLbl}>{following ? 'Following' : 'Follow'}</Text>
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

        {(profile.bio || profile.degree_program || profile.location) && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>About</Text>
            {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}
            {profile.degree_program ? (
              <View style={s.itm}>
                <View style={s.itmIconBg}>
                  <Feather name="book" size={16} color={NAVY} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.itmTxt}>{profile.degree_program}</Text>
                  {profile.graduation_year ? <Text style={s.itmSub}>Class of {profile.graduation_year}</Text> : null}
                </View>
              </View>
            ) : null}
            {profile.location ? (
              <View style={s.itm}>
                <View style={s.itmIconBg}>
                  <Feather name="map-pin" size={16} color={NAVY} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.itmTxt}>{profile.location}</Text>
                </View>
              </View>
            ) : null}
            {profile.role ? (
              <View style={s.itm}>
                <View style={s.itmIconBg}>
                  <Feather name="briefcase" size={16} color={NAVY} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.itmTxt}>{profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        <View style={s.section}>
          <View style={s.sectionHeaderRow}>
            <Text style={s.sectionTitle}>Posts</Text>
            {posts.length > 0 && <Text style={s.sectionMeta}>{posts.length}</Text>}
          </View>
          {posts.length === 0 ? (
            <View style={s.emptyPosts}>
              <Feather name="edit-3" size={28} color="#E5E5EA" />
              <Text style={s.emptyPostsTxt}>No posts yet</Text>
            </View>
          ) : (
            posts.map((post, idx) => (
              <View
                key={post.id}
                style={[s.postCard, idx === posts.length - 1 && { borderBottomWidth: 0 }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.85} onPress={() => navigation.navigate('Post', { postId: post.id })}>
                    <Text style={{ fontSize: 12, color: TEXT_SECONDARY }}>{relTime(post.created_at)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      const buttons: any[] = [];
                      if (isOwnProfile) {
                        buttons.push({
                          text: 'Delete post',
                          style: 'destructive' as const,
                          onPress: () => {
                            Alert.alert('Delete post?', 'This will permanently remove your post.', [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: async () => {
                                await supabase.from('posts').delete().eq('id', post.id);
                                load();
                              }},
                            ]);
                          },
                        });
                      }
                      buttons.push({
                        text: 'Share post',
                        onPress: async () => {
                          await Share.share({ message: post.content || 'Check out this post on PlatinumCircles' });
                        },
                      });
                      buttons.push({ text: 'Cancel', style: 'cancel' as const });
                      Alert.alert(undefined as any, undefined, buttons);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={{ padding: 4 }}
                  >
                    <Feather name="more-horizontal" size={18} color={TEXT_SECONDARY} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('Post', { postId: post.id })}>
                  {post.media.length > 0 ? (
                    <View style={{ marginBottom: 10 }}>
                      {post.media.map((m, mIdx) => (
                        <View key={m.id || mIdx} style={{ width: SCREEN_W - 64, aspectRatio: 4/5, borderRadius: 14, overflow: 'hidden', marginBottom: post.media.length > 1 ? 4 : 0 }}>
                          {m.media_type === 'video' ? (
                            <MediaRenderer media={[m]} containerWidth={SCREEN_W - 64} maxHeight={(SCREEN_W - 64) * 1.25} />
                          ) : (
                            <ExpoImage
                              source={{ uri: m.url }}
                              style={{ width: '100%', height: '100%' }}
                              contentFit="cover"
                              cachePolicy="memory-disk"
                              transition={200}
                            />
                          )}
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {post.content ? <Text style={s.postContent} numberOfLines={4}>{post.content}</Text> : null}
                  <View style={s.postFooter}>
                    <View style={s.postFooterItem}>
                      <Feather name="heart" size={13} color={TEXT_SECONDARY} />
                      <Text style={s.postFooterTxt}>{post.likes_count}</Text>
                    </View>
                    <View style={s.postFooterItem}>
                      <Feather name="message-circle" size={13} color={TEXT_SECONDARY} />
                      <Text style={s.postFooterTxt}>{post.comments_count}</Text>
                    </View>
                    <Text style={s.postTime}>{relTime(post.created_at)}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG_GREY },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#FFFFFF' },
  notFoundTxt: { fontSize: 16, fontWeight: '600', color: '#3C3C43' },
  goBackBtn: { backgroundColor: NAVY, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  goBackBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '600' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY, flex: 1, textAlign: 'center' },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  hero: {
    alignItems: 'center',
    paddingTop: 28, paddingHorizontal: 20, paddingBottom: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 12, backgroundColor: '#EFF6FF' },
  avatarFb: { alignItems: 'center', justifyContent: 'center', backgroundColor: NAVY },
  avatarFbTxt: { fontSize: 36, fontWeight: '700', color: '#FFF' },
  name: { fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY, letterSpacing: -0.4 },
  handle: { fontSize: 14, color: NAVY, fontWeight: '500', marginTop: 4 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', paddingHorizontal: 20, marginTop: 20, paddingVertical: 14, backgroundColor: BG_GREY, borderRadius: 16 },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
  statLabel: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 2, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.3 },

  heroActions: { flexDirection: 'row', gap: 20, marginTop: 22 },
  heroAction: { alignItems: 'center', gap: 6, minWidth: 70 },
  heroActionInner: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  heroActionInnerActive: { backgroundColor: NAVY },
  heroActionLbl: { fontSize: 11, fontWeight: '500', color: TEXT_PRIMARY },

  editOwnBtn: { marginTop: 18, paddingVertical: 11, paddingHorizontal: 28, borderRadius: 22, borderWidth: 1, borderColor: HAIRLINE },
  editOwnBtnTxt: { fontSize: 14, fontWeight: '600', color: TEXT_PRIMARY },

  section: {
    backgroundColor: '#FFFFFF',
    marginTop: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE, borderBottomColor: HAIRLINE,
  },
  sectionTitle: { fontSize: 11, fontWeight: '600', color: TEXT_SECONDARY, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionMeta: { fontSize: 12, color: TEXT_SECONDARY, fontWeight: '500' },

  bio: { fontSize: 14, color: '#3C3C43', lineHeight: 21, marginBottom: 12 },

  itm: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  itmIconBg: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.08)', alignItems: 'center', justifyContent: 'center' },
  itmTxt: { fontSize: 14, color: TEXT_PRIMARY, fontWeight: '500' },
  itmSub: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 1 },

  emptyPosts: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyPostsTxt: { fontSize: 14, color: TEXT_SECONDARY },
  postCard: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  postContent: { fontSize: 14, color: '#1A1A1A', lineHeight: 20, marginBottom: 10 },
  postFooter: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  postFooterItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  postFooterTxt: { fontSize: 12, color: TEXT_SECONDARY },
  postTime: { fontSize: 12, color: '#C7C7CC', marginLeft: 'auto' },
});