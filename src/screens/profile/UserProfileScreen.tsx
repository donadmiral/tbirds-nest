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
import ProfileHeader from '../../components/ProfileHeader';
import { BusinessProducts, BusinessReviews, SellerListings } from '../../components/BusinessTabs';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import MediaRenderer, { PostMedia } from '../../components/MediaRenderer';
import { Image as ExpoImage } from 'expo-image';
import VerifiedBadge from '../../components/VerifiedBadge';

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
  avatar_url: string | null; role: string; profile_visibility: string;
  is_verified_school_user: boolean;
  banner_url?: string | null; headline?: string | null; workplace?: string | null;
  account_type?: string; is_verified?: boolean; created_at?: string;
  business?: any; can_view_content?: boolean;
};
type Stats = { posts: number; followers: number; following?: number };
type Post = {
  id: string;
  content: string;
  likes_count: number;
  comments_count: number;
  created_at: string;
  media_url: string | null;
  media: PostMedia[];
};

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
  const [stats, setStats] = useState<Stats>({ posts: 0, followers: 0 });
  const [posts, setPosts] = useState<Post[]>([]);
  const [following, setFollowing] = useState(false);
  const [followRequested, setFollowRequested] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bizTab, setBizTab] = useState('posts');
  const [listingCount, setListingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    if (!targetId) return;
    try {
      const { data: pj, error: pErr } = await supabase.rpc('get_profile', { p_profile_id: targetId });
      if (pErr) { console.log('USER_PROFILE_LOAD', pErr.message); setLoadError(pErr.message); return; }
      setLoadError(null);
      const pd: any = pj || {};
      setProfile({
        id: pd.id, full_name: pd.full_name || '', username: pd.username || '',
        bio: pd.bio || '', location: pd.location || '', degree_program: pd.degree_program || '',
        graduation_year: null, avatar_url: pd.avatar_url || null, role: pd.role || 'student',
        profile_visibility: pd.profile_visibility || 'public',
        is_verified_school_user: false,
        banner_url: pd.banner_url || null, headline: pd.headline || null,
        workplace: pd.workplace || null, account_type: pd.account_type || 'personal',
        is_verified: !!pd.is_verified, created_at: pd.created_at,
        business: pd.business || null, can_view_content: !!pd.can_view_content,
      });
      const c = pd.counts || {};
      setStats({ posts: c.posts ?? 0, followers: c.followers ?? 0, following: c.following ?? 0 });
      setFollowing(!!pd.viewer_follows);
      setFollowRequested(!!pd.viewer_requested);

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
        const { data: orb } = await supabase.from('follows').select('id')
          .eq('follower_id', myId).eq('following_id', targetId).maybeSingle();
        setFollowing(!!orb);

        if (!orb) {
          const { data: fr } = await supabase.from('follow_requests').select('id, status')
            .eq('requester_id', myId).eq('target_id', targetId).eq('status', 'pending').maybeSingle();
          setFollowRequested(!!fr);
        } else {
          setFollowRequested(false);
        }
      }
    } catch (e) { console.log('USER_PROFILE_LOAD', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [targetId, myId]);

  useEffect(() => { load(); }, [load]);

  const confirmBlock = () => {
    if (!myId || isOwnProfile) return;
    const who = profile?.full_name || (profile?.username ? '@' + profile.username : 'this person');
    Alert.alert(
      'Block ' + who + '?',
      'They will not be able to see your posts or message you. You can undo this in Settings, under Blocked accounts.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('blocked_users').insert({ blocker_id: myId, blocked_id: targetId });
          if (error) { Alert.alert('Could not block', error.message); return; }
          navigation.goBack();
        } },
      ],
    );
  };
  const handleFollow = async () => {
    if (!myId || actionBusy) return;
    setActionBusy(true);
    try {
      const { data, error } = await supabase.rpc('handle_follow_action', { p_target_id: targetId });
      if (error) throw error;
      const action = data?.action;
      if (action === 'followed') { setFollowing(true); setFollowRequested(false); }
      else if (action === 'unfollowed') { setFollowing(false); setFollowRequested(false); }
      else if (action === 'requested') { setFollowing(false); setFollowRequested(true); }
      else if (action === 'request_cancelled') { setFollowing(false); setFollowRequested(false); }
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
  const isPrivate = profile?.profile_visibility === 'private';
  const canViewContent = isOwnProfile || !isPrivate || following;

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
        <ProfileHeader
          profile={profile}
          stats={{ posts: stats.posts, followers: stats.followers, following: stats.following ?? 0 }}
          isSelf={isOwnProfile}
          tabs={[
            { key: 'posts', label: 'Posts' },
            ...(listingCount > 0 ? [{ key: 'listings', label: 'Listings' }] : []),
            ...(profile.account_type === 'business'
              ? [{ key: 'products', label: 'Products' }, { key: 'reviews', label: 'Reviews' }]
              : []),
          ].length > 1 ? [
            { key: 'posts', label: 'Posts' },
            ...(listingCount > 0 ? [{ key: 'listings', label: 'Listings' }] : []),
            ...(profile.account_type === 'business'
              ? [{ key: 'products', label: 'Products' }, { key: 'reviews', label: 'Reviews' }]
              : []),
          ] : []}
          activeTab={bizTab}
          onTabChange={setBizTab}
          onEdit={isOwnProfile ? () => navigation.navigate('Profile', { screen: 'EditProfile' }) : undefined}
          actions={isOwnProfile ? undefined : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <TouchableOpacity onPress={confirmBlock} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="More options" style={{ width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.08)', alignItems: 'center', justifyContent: 'center' }}><Feather name="more-horizontal" size={16} color={NAVY} /></TouchableOpacity>
              <TouchableOpacity
                onPress={openMessage}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Message"
                style={{ width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.08)', alignItems: 'center', justifyContent: 'center' }}
              >
                <Feather name="message-circle" size={16} color={NAVY} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleFollow}
                disabled={actionBusy}
                activeOpacity={0.85}
                accessibilityRole="button"
                style={{ paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999, backgroundColor: (following || followRequested) ? 'rgba(11,30,61,0.05)' : NAVY, borderWidth: StyleSheet.hairlineWidth, borderColor: (following || followRequested) ? 'rgba(11,30,61,0.08)' : NAVY }}
              >
                <Text style={{ fontSize: 13, fontWeight: '800', color: (following || followRequested) ? NAVY : '#FFFFFF' }}>
                  {following ? 'Following' : followRequested ? 'Requested' : 'Follow'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        />

        {canViewContent && bizTab === 'listings' ? (
          <SellerListings sellerId={targetId} navigation={navigation} isSelf={isOwnProfile} />
        ) : canViewContent && profile.account_type === 'business' && bizTab === 'products' ? (
          <BusinessProducts businessId={targetId} navigation={navigation} />
        ) : canViewContent && profile.account_type === 'business' && bizTab === 'reviews' ? (
          <BusinessReviews businessId={targetId} canReview={!isOwnProfile} />
        ) : canViewContent ? (
          <>
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
          </>
        ) : (
          <View style={s.lockedSection}>
            <View style={s.lockedIcon}>
              <Feather name="lock" size={32} color="#C7C7CC" />
            </View>
            <Text style={s.lockedTitle}>This account is private</Text>
            <Text style={s.lockedSub}>Follow this account to see their posts and activity.</Text>
          </View>
        )}
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
  privateBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, backgroundColor: '#F2F2F7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  privateBadgeTxt: { fontSize: 12, color: TEXT_SECONDARY, fontWeight: '500' },

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

  lockedSection: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: 32, gap: 10 },
  lockedIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  lockedTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
  lockedSub: { fontSize: 14, color: TEXT_SECONDARY, textAlign: 'center', lineHeight: 20 },
});