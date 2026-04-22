import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Share, Alert, StatusBar, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

type BusinessDetails = {
  id: string;
  business_name: string;
  category: string;
  location: string;
  description: string;
  offering: string;
  contact_info: string | null;
  website_url: string | null;
  owner_id: string;
  owner_name: string;
  owner_username: string | null;
  owner_avatar: string | null;
  created_at: string;
};

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const dy = Math.floor(diff / 86400000);
  if (dy === 0) return 'Today';
  if (dy === 1) return 'Yesterday';
  if (dy < 7) return `${dy} days ago`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BirdsBusinessDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile: authProfile } = useAuthStore();

  const postId = route.params?.postId ?? null;
  const currentUserId = authProfile?.id ?? null;

  const [post, setPost] = useState<BusinessDetails | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPost = useCallback(async () => {
    if (!postId) { setLoading(false); return; }
    try {
      const { data, error } = await supabase
        .from('birds_business_posts')
        .select('*')
        .eq('id', postId)
        .single();
      if (error || !data) { setPost(null); return; }
      const { data: ownerProfile } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .eq('id', data.owner_id)
        .single();
      setPost({
        ...data,
        owner_name: ownerProfile?.full_name?.trim() || 'User',
        owner_username: ownerProfile?.username || null,
        owner_avatar: ownerProfile?.avatar_url || null,
      });
    } catch (e) {
      console.log('BIRDS_BUSINESS_DETAILS_CATCH', e);
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => { loadPost(); }, [loadPost]);

  const handleContact = async () => {
    if (!post) return;
    if (post.owner_id === currentUserId) {
      Alert.alert('This is your listing', 'You cannot contact yourself.');
      return;
    }
    navigation.navigate('Chat', {
          userId: post.owner_id,
          userName: post.owner_name,
          otherUser: {
            id: post.owner_id,
            full_name: post.owner_name,
            username: null,
            avatar_url: null,
          },
        });
  };

  const handleShare = async () => {
    if (!post) return;
    try {
      await Share.share({
        message: `${post.business_name} on TBirds Nest Bird's Business\n\n${post.offering}\n📍 ${post.location}\n\n${post.description}`,
      });
    } catch {}
  };

  const handleWebsite = () => {
    if (!post?.website_url) return;
    let url = post.website_url.trim();
    if (!url.startsWith('http')) url = `https://${url}`;
    Linking.openURL(url).catch(() => Alert.alert('Could not open link'));
  };

  const handleDelete = () => {
    if (!post || post.owner_id !== currentUserId) return;
    Alert.alert('Delete listing?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('birds_business_posts').delete().eq('id', post.id);
        navigation.goBack();
      }},
    ]);
  };

  if (loading) return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.loader}><ActivityIndicator size="large" color="#007AFF" /><Text style={s.loaderTxt}>Loading...</Text></View>
    </SafeAreaView>
  );

  if (!post) return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.loader}>
        <Feather name="alert-circle" size={40} color="#E5E5EA" />
        <Text style={s.notFoundTxt}>Business not found</Text>
        <TouchableOpacity style={s.goBackBtn} onPress={() => navigation.goBack()}>
          <Text style={s.goBackBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const isOwn = post.owner_id === currentUserId;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text>
          <Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>Business Details</Text>
        <View style={s.headerRight}>
          <TouchableOpacity onPress={handleShare} style={s.headerIconBtn} activeOpacity={0.75}>
            <Feather name="share-2" size={18} color="#000" />
          </TouchableOpacity>
          {isOwn && (
            <TouchableOpacity onPress={handleDelete} style={s.headerIconBtn} activeOpacity={0.75}>
              <Feather name="trash-2" size={18} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom + 32, 60) }]}
      >
        {/* Category + date */}
        <View style={s.topRow}>
          <View style={s.categoryPill}><Text style={s.categoryTxt}>{post.category}</Text></View>
          <Text style={s.dateTxt}>{relTime(post.created_at)}</Text>
        </View>

        {/* Business name */}
        <Text style={s.bizName}>{post.business_name}</Text>

        {/* Owner row */}
        <TouchableOpacity
          style={s.ownerRow}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('UserProfile', { userId: post.owner_id })}
        >
          <View style={s.ownerAvatar}>
            <Text style={s.ownerAvatarTxt}>
              {post.owner_name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={s.ownerName}>{post.owner_name}</Text>
            {post.owner_username && <Text style={s.ownerHandle}>@{post.owner_username}</Text>}
          </View>
          <Feather name="chevron-right" size={16} color="#C7C7CC" style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>

        {/* Key details */}
        <View style={s.detailsCard}>
          {[
            { icon: 'map-pin', label: 'Location', value: post.location },
            { icon: 'briefcase', label: 'Offering', value: post.offering },
            { icon: 'phone', label: 'Contact', value: post.contact_info || 'Not provided' },
          ].map(row => (
            <View key={row.label} style={s.detailRow}>
              <View style={s.detailIconWrap}><Feather name={row.icon as any} size={16} color="#007AFF" /></View>
              <View style={s.detailText}>
                <Text style={s.detailLabel}>{row.label}</Text>
                <Text style={s.detailValue}>{row.value}</Text>
              </View>
            </View>
          ))}
          {post.website_url && (
            <TouchableOpacity style={s.detailRow} onPress={handleWebsite} activeOpacity={0.8}>
              <View style={s.detailIconWrap}><Feather name="globe" size={16} color="#007AFF" /></View>
              <View style={s.detailText}>
                <Text style={s.detailLabel}>Website</Text>
                <Text style={[s.detailValue, s.detailLink]}>{post.website_url}</Text>
              </View>
              <Feather name="external-link" size={14} color="#007AFF" />
            </TouchableOpacity>
          )}
        </View>

        {/* Description */}
        <Text style={s.sectionLabel}>About this business</Text>
        <Text style={s.description}>{post.description}</Text>

        {/* Action buttons */}
        {!isOwn && (
          <View style={s.actions}>
            <TouchableOpacity style={s.supportBtn} activeOpacity={0.85} onPress={() => Alert.alert('Support', `Show your support for ${post.business_name} by spreading the word or collaborating with them.`)}>
              <Feather name="heart" size={16} color="#000" />
              <Text style={s.supportBtnTxt}>Show Support</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.contactBtn} activeOpacity={0.85} onPress={handleContact}>
              <Feather name="message-circle" size={16} color="#FFF" />
              <Text style={s.contactBtnTxt}>Contact</Text>
            </TouchableOpacity>
          </View>
        )}

        {isOwn && (
          <View style={s.ownBanner}>
            <Feather name="info" size={14} color="#007AFF" />
            <Text style={s.ownBannerTxt}>This is your listing. Manage it from your Profile screen.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderTxt: { fontSize: 14, color: '#8E8E93' },
  notFoundTxt: { fontSize: 18, fontWeight: '600', color: '#3C3C43' },
  goBackBtn: { backgroundColor: '#007AFF', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  goBackBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginRight: 1 },
  backLbl: { fontSize: 17, color: '#007AFF' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000', flex: 1, textAlign: 'center' },
  headerRight: { flexDirection: 'row', gap: 4, minWidth: 60, justifyContent: 'flex-end' },
  headerIconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  categoryPill: { backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  categoryTxt: { fontSize: 13, fontWeight: '700', color: '#007AFF' },
  dateTxt: { fontSize: 13, color: '#8E8E93' },
  bizName: { fontSize: 26, fontWeight: '700', color: '#000', marginBottom: 14, lineHeight: 32 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F5F5F5', borderRadius: 14, padding: 12, marginBottom: 18 },
  ownerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  ownerAvatarTxt: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  ownerName: { fontSize: 15, fontWeight: '600', color: '#000' },
  ownerHandle: { fontSize: 13, color: '#8E8E93', marginTop: 1 },
  detailsCard: { backgroundColor: '#F5F5F5', borderRadius: 14, padding: 4, marginBottom: 20 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EBEBEB' },
  detailIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  detailText: { flex: 1 },
  detailLabel: { fontSize: 12, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.3 },
  detailValue: { fontSize: 15, color: '#000', marginTop: 2 },
  detailLink: { color: '#007AFF' },
  sectionLabel: { fontSize: 15, fontWeight: '700', color: '#000', marginBottom: 8 },
  description: { fontSize: 15, color: '#3C3C43', lineHeight: 24, marginBottom: 28 },
  actions: { flexDirection: 'row', gap: 10 },
  supportBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 15, borderRadius: 14, borderWidth: 1.5, borderColor: '#E5E5EA', backgroundColor: '#FFF' },
  supportBtnTxt: { fontSize: 15, fontWeight: '600', color: '#000' },
  contactBtn: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 15, borderRadius: 14, backgroundColor: '#007AFF' },
  contactBtnTxt: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  ownBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12 },
  ownBannerTxt: { flex: 1, fontSize: 13, color: '#007AFF', lineHeight: 18 },
});