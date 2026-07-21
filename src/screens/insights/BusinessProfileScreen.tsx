/**
 * BusinessProfileScreen.tsx
 * Full business profile: cover, stats, bio, contact, adverts tab, reviews tab.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  ActivityIndicator, StatusBar, Alert, Linking, Share, TextInput,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

type Business = {
  id: string; owner_id: string; name: string; bio: string | null;
  category: string; location: string | null; address: string | null;
  phone: string | null; email: string | null; website: string | null;
  social_links: any; logo_url: string | null; cover_url: string | null;
  avg_rating: number; review_count: number; advert_count: number; view_count: number;
  is_verified: boolean; created_at: string;
};
type Advert = {
  id: string; body: string | null; media_url: string | null; media_type: string | null;
  link_url: string | null; link_title: string | null; cta_label: string;
  likes_count: number; comments_count: number; is_promoted: boolean; created_at: string;
};
type Review = {
  id: string; user_id: string; rating: number; body: string | null;
  helpful_count: number; created_at: string;
  reviewer_name?: string; reviewer_avatar?: string | null;
};
type ProfileTab = 'adverts' | 'reviews';

function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}
function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return m + 'm';
  if (h < 24) return h + 'h'; if (dy < 7) return dy + 'd';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function renderStars(rating: number, size = 14) {
  const full = Math.round(rating);
  const stars = [];
  for (let i = 0; i < 5; i++) {
    stars.push(
      <Text key={i} style={{ fontSize: size, color: i < full ? '#FFB800' : '#E5E5EA' }}>★</Text>
    );
  }
  return <View style={{ flexDirection: 'row', gap: 1 }}>{stars}</View>;
}

export default function BusinessProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const businessId = route.params?.businessId ?? null;

  const [business, setBusiness] = useState<Business | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [adverts, setAdverts] = useState<Advert[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('adverts');

  // Review form
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [myExistingReview, setMyExistingReview] = useState<Review | null>(null);

  const loadBusiness = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    try {
      const { data } = await supabase.from('business_profiles').select('*').eq('id', businessId).single();
      if (!data) { setLoading(false); return; }
      setBusiness(data as Business);

      // Owner name
      const { data: ownerData } = await supabase.from('profiles').select('full_name').eq('id', data.owner_id).single();
      setOwnerName(ownerData?.full_name || 'Member');

      // Increment view count
      await supabase.from('business_profiles').update({ view_count: (data.view_count || 0) + 1 }).eq('id', businessId);

      // Adverts
      const { data: advData } = await supabase.from('business_posts')
        .select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(30);
      setAdverts((advData || []) as Advert[]);

      // Reviews
      const { data: revData } = await supabase.from('business_reviews')
        .select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50);
      if (revData && revData.length > 0) {
        const reviewerIds = Array.from(new Set(revData.map((r: any) => r.user_id)));
        const { data: reviewers } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', reviewerIds);
        const revMap: Record<string, any> = {};
        (reviewers || []).forEach((p: any) => { revMap[p.id] = p; });
        setReviews(revData.map((r: any) => ({
          ...r,
          reviewer_name: revMap[r.user_id]?.full_name || 'Member',
          reviewer_avatar: revMap[r.user_id]?.avatar_url || null,
        })));
        // Check if I already reviewed
        if (userId) {
          const mine = revData.find((r: any) => r.user_id === userId);
          if (mine) setMyExistingReview(mine as Review);
        }
      } else {
        setReviews([]);
      }
    } catch (e) { console.log('[BIZ_PROFILE]', e); }
    finally { setLoading(false); }
  }, [businessId, userId]);

  useEffect(() => { loadBusiness(); }, [loadBusiness]);

  const handleShare = async () => {
    if (!business) return;
    await Share.share({
      message: `${business.name} on PlatinumCircles Insights\n\n${business.bio || ''}\n📍 ${business.location || ''}\n⭐ ${business.avg_rating} (${business.review_count} reviews)`,
    });
  };

  const handleContact = () => {
    if (!business || !userId) return;
    if (business.owner_id === userId) { Alert.alert('This is your business'); return; }
    navigation.navigate('Chat', {
      userId: business.owner_id,
      userName: ownerName,
      otherUser: { id: business.owner_id, full_name: ownerName, username: null, avatar_url: null },
    });
  };

  const handleDelete = () => {
    if (!business || business.owner_id !== userId) return;
    Alert.alert('Delete business?', 'This will permanently remove your business profile, all adverts, and reviews.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('business_profiles').delete().eq('id', business.id);
        navigation.goBack();
      }},
    ]);
  };

  const submitReview = async () => {
    if (!business || !userId || reviewRating === 0) { Alert.alert('Please select a rating'); return; }
    setSubmittingReview(true);
    try {
      if (myExistingReview) {
        await supabase.from('business_reviews').update({
          rating: reviewRating, body: reviewText.trim() || null, updated_at: new Date().toISOString(),
        }).eq('id', myExistingReview.id);
      } else {
        const { error } = await supabase.from('business_reviews').insert({
          business_id: business.id, user_id: userId,
          rating: reviewRating, body: reviewText.trim() || null,
        });
        if (error) {
          if (error.code === '23505') { Alert.alert('Already reviewed', 'You can only leave one review per business.'); return; }
          throw error;
        }
      }
      setShowReviewForm(false);
      setReviewRating(0);
      setReviewText('');
      await loadBusiness();
    } catch (e: any) { Alert.alert('Error', e?.message || 'Could not submit review'); }
    finally { setSubmittingReview(false); }
  };

  const openWebsite = () => {
    if (!business?.website) return;
    let url = business.website.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    Linking.openURL(url).catch(() => Alert.alert('Could not open link'));
  };

  if (loading) return <SafeAreaView style={st.safe}><View style={st.center}><ActivityIndicator color={NAVY} size="large" /></View></SafeAreaView>;
  if (!business) return (
    <SafeAreaView style={st.safe}>
      <View style={st.center}>
        <Feather name="alert-circle" size={40} color="#E5E5EA" />
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#3C3C43', marginTop: 12 }}>Business not found</Text>
        <TouchableOpacity style={st.goBackBtn} onPress={() => navigation.goBack()}>
          <Text style={st.goBackBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const isOwner = business.owner_id === userId;

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={24} color={NAVY} />
        </TouchableOpacity>
        <Text style={st.headerTitle} numberOfLines={1}>Insights</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity style={st.hdrIcon} onPress={handleShare} activeOpacity={0.7}>
            <Feather name="share-2" size={16} color={TEXT_PRIMARY} />
          </TouchableOpacity>
          {isOwner && (
            <TouchableOpacity style={st.hdrIcon} onPress={handleDelete} activeOpacity={0.7}>
              <Feather name="trash-2" size={16} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}>
        {/* Cover */}
        <View style={st.cover}>
          {business.cover_url
            ? <Image source={{ uri: business.cover_url }} style={st.coverImg} />
            : <View style={st.coverGradient} />}
          <View style={st.logoFloat}>
            {business.logo_url
              ? <Image source={{ uri: business.logo_url }} style={st.logoImg} />
              : <Text style={st.logoTxt}>{initials(business.name)}</Text>}
          </View>
        </View>

        {/* Info */}
        <View style={st.infoSection}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={st.bizName}>{business.name}</Text>
            {business.is_verified && <View style={st.verifiedBadge}><Text style={st.verifiedTxt}>Verified</Text></View>}
          </View>
          <Text style={st.bizCat}>{business.category} · {business.location || 'Global'}</Text>
        </View>

        {/* Stats */}
        <View style={st.statsRow}>
          <View style={st.stat}>
            <View style={st.statIcon}><Text style={{ fontSize: 14 }}>⭐</Text></View>
            <View><Text style={st.statVal}>{business.avg_rating > 0 ? business.avg_rating.toFixed(1) : 'New'}</Text><Text style={st.statLbl}>Rating</Text></View>
          </View>
          <View style={st.stat}>
            <View style={st.statIcon}><Text style={{ fontSize: 14 }}>💬</Text></View>
            <View><Text style={st.statVal}>{business.review_count}</Text><Text style={st.statLbl}>Reviews</Text></View>
          </View>
          <View style={st.stat}>
            <View style={st.statIcon}><Text style={{ fontSize: 14 }}>📢</Text></View>
            <View><Text style={st.statVal}>{business.advert_count}</Text><Text style={st.statLbl}>Adverts</Text></View>
          </View>
          <View style={st.stat}>
            <View style={st.statIcon}><Text style={{ fontSize: 14 }}>👁</Text></View>
            <View><Text style={st.statVal}>{business.view_count}</Text><Text style={st.statLbl}>Views</Text></View>
          </View>
        </View>

        {/* About */}
        {business.bio && (
          <View style={st.section}>
            <Text style={st.secTitle}>About</Text>
            <Text style={st.bioText}>{business.bio}</Text>
          </View>
        )}

        {/* Contact & Links */}
        <View style={st.section}>
          <Text style={st.secTitle}>Contact & Links</Text>
          {business.address && <DetailRow icon="📍" label="Address" value={business.address} />}
          {business.location && !business.address && <DetailRow icon="📍" label="Location" value={business.location} />}
          {business.phone && <DetailRow icon="📞" label="Phone" value={business.phone} />}
          {business.email && <DetailRow icon="📧" label="Email" value={business.email} isLink onPress={() => Linking.openURL('mailto:' + business.email)} />}
          {business.website && <DetailRow icon="🌐" label="Website" value={business.website} isLink onPress={openWebsite} />}
          {business.social_links && Object.keys(business.social_links).length > 0 && (
            Object.entries(business.social_links).map(([key, val]) => (
              <DetailRow key={key} icon="📱" label={key} value={String(val)} />
            ))
          )}
          <DetailRow icon="👤" label="Owner" value={ownerName} onPress={() => navigation.navigate('UserProfile', { userId: business.owner_id })} isLink />
        </View>

        {/* Actions */}
        <View style={st.actionsRow}>
          {!isOwner && (
            <>
              <TouchableOpacity style={st.btnSecondary} onPress={handleContact} activeOpacity={0.7}>
                <Feather name="message-circle" size={16} color={NAVY} />
                <Text style={st.btnSecondaryTxt}>Contact</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.btnPrimary} onPress={handleShare} activeOpacity={0.7}>
                <Feather name="share-2" size={16} color="#FFF" />
                <Text style={st.btnPrimaryTxt}>Share</Text>
              </TouchableOpacity>
            </>
          )}
          {isOwner && (
            <TouchableOpacity
              style={[st.btnPrimary, { flex: 1 }]}
              onPress={() => navigation.navigate('CreateAdvert' as any, { businessId: business.id, businessName: business.name })}
              activeOpacity={0.7}
            >
              <Feather name="plus" size={16} color="#FFF" />
              <Text style={st.btnPrimaryTxt}>Create Advert</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Tabs */}
        <View style={st.tabs}>
          <TouchableOpacity style={[st.tab, activeTab === 'adverts' && st.tabOn]} onPress={() => setActiveTab('adverts')} activeOpacity={0.7}>
            <Text style={[st.tabTxt, activeTab === 'adverts' && st.tabTxtOn]}>Adverts ({business.advert_count})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.tab, activeTab === 'reviews' && st.tabOn]} onPress={() => setActiveTab('reviews')} activeOpacity={0.7}>
            <Text style={[st.tabTxt, activeTab === 'reviews' && st.tabTxtOn]}>Reviews ({business.review_count})</Text>
          </TouchableOpacity>
        </View>

        {/* Adverts tab */}
        {activeTab === 'adverts' && (
          adverts.length === 0 ? (
            <View style={st.tabEmpty}>
              <Feather name="volume-2" size={28} color="#C7C7CC" />
              <Text style={st.tabEmptyTitle}>No adverts yet</Text>
              {isOwner && (
                <TouchableOpacity style={st.tabEmptyBtn} onPress={() => navigation.navigate('CreateAdvert' as any, { businessId: business.id, businessName: business.name })}>
                  <Text style={st.tabEmptyBtnTxt}>Create your first advert</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            adverts.map(adv => (
              <View key={adv.id} style={st.advCard}>
                <View style={st.advTop}>
                  <View style={st.advLogo}><Text style={{ fontSize: 11, fontWeight: '700', color: NAVY }}>{initials(business.name)}</Text></View>
                  <Text style={st.advName}>{business.name}</Text>
                  <View style={st.advBadge}><Text style={st.advBadgeTxt}>{adv.is_promoted ? 'Promoted' : 'Advert'}</Text></View>
                  <Text style={{ fontSize: 11, color: '#C7C7CC', marginLeft: 'auto' }}>{relTime(adv.created_at)}</Text>
                </View>
                {adv.body && <Text style={st.advBody}>{adv.body}</Text>}
                {adv.link_url && (
                  <TouchableOpacity style={st.advLink} onPress={() => { let u = adv.link_url!; if (!u.startsWith('http')) u = 'https://' + u; Linking.openURL(u).catch(() => {}); }} activeOpacity={0.7}>
                    <Feather name="link" size={13} color={NAVY} />
                    <Text style={st.advLinkTxt} numberOfLines={1}>{adv.link_title || adv.link_url}</Text>
                    <Text style={{ fontSize: 12, color: TEXT_SECONDARY }}>Visit</Text>
                  </TouchableOpacity>
                )}
                {adv.cta_label && adv.link_url && (
                  <TouchableOpacity style={st.advCta} onPress={() => { let u = adv.link_url!; if (!u.startsWith('http')) u = 'https://' + u; Linking.openURL(u).catch(() => {}); }} activeOpacity={0.7}>
                    <Text style={st.advCtaTxt}>{adv.cta_label}</Text>
                  </TouchableOpacity>
                )}
                {isOwner && (
                  <TouchableOpacity style={{ marginTop: 10, alignSelf: 'flex-end' }} onPress={() => {
                    Alert.alert('Delete advert?', 'This cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: async () => {
                        await supabase.from('business_posts').delete().eq('id', adv.id);
                        loadBusiness();
                      }},
                    ]);
                  }}>
                    <Feather name="trash-2" size={14} color="#FF3B30" />
                  </TouchableOpacity>
                )}
              </View>
            ))
          )
        )}

        {/* Reviews tab */}
        {activeTab === 'reviews' && (
          <>
            <View style={st.reviewHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={st.reviewBigNum}>{business.avg_rating > 0 ? business.avg_rating.toFixed(1) : '0'}</Text>
                <View>
                  {renderStars(business.avg_rating, 16)}
                  <Text style={st.reviewCountTxt}>{business.review_count} reviews</Text>
                </View>
              </View>
              {!isOwner && (
                <TouchableOpacity style={st.writeBtn} onPress={() => {
                  if (myExistingReview) { setReviewRating(myExistingReview.rating); setReviewText(myExistingReview.body || ''); }
                  setShowReviewForm(true);
                }} activeOpacity={0.7}>
                  <Feather name="edit-2" size={14} color="#FFF" />
                  <Text style={st.writeBtnTxt}>{myExistingReview ? 'Edit Review' : 'Write Review'}</Text>
                </TouchableOpacity>
              )}
            </View>

            {reviews.length === 0 ? (
              <View style={st.tabEmpty}>
                <Feather name="star" size={28} color="#C7C7CC" />
                <Text style={st.tabEmptyTitle}>No reviews yet</Text>
                <Text style={{ fontSize: 13, color: TEXT_SECONDARY }}>Be the first to share your experience.</Text>
              </View>
            ) : (
              reviews.map(rev => (
                <View key={rev.id} style={st.reviewCard}>
                  <View style={st.reviewTop}>
                    {rev.reviewer_avatar
                      ? <Image source={{ uri: rev.reviewer_avatar }} style={st.reviewAvatar} />
                      : <View style={[st.reviewAvatar, { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' }]}>
                          <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>{initials(rev.reviewer_name)}</Text>
                        </View>}
                    <View style={{ flex: 1 }}>
                      <Text style={st.reviewName}>{rev.reviewer_name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {renderStars(rev.rating, 13)}
                        <Text style={st.reviewTime}>{relTime(rev.created_at)}</Text>
                      </View>
                    </View>
                  </View>
                  {rev.body && <Text style={st.reviewText}>{rev.body}</Text>}
                  {rev.helpful_count > 0 && (
                    <Text style={st.reviewHelpful}>👍 {rev.helpful_count} found this helpful</Text>
                  )}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Write review modal */}
      <Modal visible={showReviewForm} transparent animationType="slide" onRequestClose={() => setShowReviewForm(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowReviewForm(false)} />
          <View style={st.reviewSheet}>
            <View style={st.reviewSheetHandle} />
            <Text style={st.reviewSheetTitle}>{myExistingReview ? 'Edit your review' : 'Write a review'}</Text>
            <Text style={{ fontSize: 14, color: TEXT_SECONDARY, marginBottom: 14 }}>{business.name}</Text>

            <View style={st.starPicker}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setReviewRating(n)} activeOpacity={0.6}>
                  <Text style={{ fontSize: 32, color: n <= reviewRating ? '#FFB800' : '#E5E5EA' }}>★</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              value={reviewText}
              onChangeText={setReviewText}
              placeholder="Share your experience..."
              placeholderTextColor="#C7C7CC"
              style={st.reviewInput}
              multiline
              maxLength={1000}
            />

            <TouchableOpacity
              style={[st.reviewSubmit, (reviewRating === 0 || submittingReview) && { opacity: 0.4 }]}
              onPress={submitReview}
              disabled={reviewRating === 0 || submittingReview}
              activeOpacity={0.7}
            >
              {submittingReview
                ? <ActivityIndicator color="#FFF" size={14} />
                : <Text style={st.reviewSubmitTxt}>{myExistingReview ? 'Update Review' : 'Submit Review'}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({ icon, label, value, isLink, onPress }: { icon: string; label: string; value: string; isLink?: boolean; onPress?: () => void }) {
  const content = (
    <View style={st.detailRow}>
      <View style={st.detailIcon}><Text style={{ fontSize: 14 }}>{icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={st.detailLabel}>{label}</Text>
        <Text style={[st.detailValue, isLink && { color: NAVY, fontWeight: '500' }]}>{value}</Text>
      </View>
      {isLink && <Feather name="chevron-right" size={16} color="#C7C7CC" />}
    </View>
  );
  if (onPress) return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>;
  return content;
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  goBackBtn: { marginTop: 16, backgroundColor: NAVY, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  goBackBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY, flex: 1, textAlign: 'center' },
  hdrIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  cover: { height: 160, backgroundColor: '#F2F2F7', position: 'relative' },
  coverImg: { width: '100%', height: '100%' },
  coverGradient: { width: '100%', height: '100%', backgroundColor: NAVY },
  logoFloat: { position: 'absolute', bottom: -28, left: 16, width: 56, height: 56, borderRadius: 16, backgroundColor: '#FFF', borderWidth: 3, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  logoImg: { width: 50, height: 50, borderRadius: 13 },
  logoTxt: { fontSize: 20, fontWeight: '700', color: NAVY },
  infoSection: { paddingTop: 36, paddingHorizontal: 16, paddingBottom: 4 },
  bizName: { fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY },
  verifiedBadge: { backgroundColor: NAVY, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  verifiedTxt: { fontSize: 10, fontWeight: '700', color: '#FFF' },
  bizCat: { fontSize: 13, color: TEXT_SECONDARY, marginTop: 4 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE, marginTop: 12 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' },
  statVal: { fontSize: 16, fontWeight: '700', color: TEXT_PRIMARY },
  statLbl: { fontSize: 11, color: TEXT_SECONDARY },
  section: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  secTitle: { fontSize: 15, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 10 },
  bioText: { fontSize: 14, color: '#3C3C43', lineHeight: 21 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F8F8F8' },
  detailIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' },
  detailLabel: { fontSize: 11, color: TEXT_SECONDARY, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  detailValue: { fontSize: 14, color: TEXT_PRIMARY, marginTop: 1 },
  actionsRow: { flexDirection: 'row', gap: 10, padding: 16 },
  btnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: NAVY },
  btnPrimaryTxt: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  btnSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: '#F2F2F7', borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  btnSecondaryTxt: { fontSize: 14, fontWeight: '600', color: NAVY },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: NAVY },
  tabTxt: { fontSize: 13, fontWeight: '600', color: TEXT_SECONDARY },
  tabTxtOn: { color: NAVY },
  tabEmpty: { alignItems: 'center', paddingVertical: 50, gap: 8 },
  tabEmptyTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY },
  tabEmptyBtn: { marginTop: 10, backgroundColor: NAVY, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  tabEmptyBtnTxt: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  advCard: { padding: 14, marginHorizontal: 16, marginTop: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0F0F0' },
  advTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  advLogo: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  advName: { fontSize: 13, fontWeight: '600', color: TEXT_PRIMARY },
  advBadge: { backgroundColor: '#F2F2F7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  advBadgeTxt: { fontSize: 10, fontWeight: '600', color: TEXT_SECONDARY },
  advBody: { fontSize: 14, color: '#1A1A1A', lineHeight: 20, marginBottom: 8 },
  advLink: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  advLinkTxt: { fontSize: 13, color: NAVY, fontWeight: '500', flex: 1 },
  advCta: { alignSelf: 'flex-start', backgroundColor: NAVY, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  advCtaTxt: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  reviewBigNum: { fontSize: 36, fontWeight: '700', lineHeight: 40 },
  reviewCountTxt: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 4 },
  writeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: NAVY, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  writeBtnTxt: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  reviewCard: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5' },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  reviewAvatar: { width: 36, height: 36, borderRadius: 18 },
  reviewName: { fontSize: 14, fontWeight: '600', color: TEXT_PRIMARY },
  reviewTime: { fontSize: 12, color: TEXT_SECONDARY },
  reviewText: { fontSize: 14, color: '#3C3C43', lineHeight: 20 },
  reviewHelpful: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 8 },
  reviewSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 40 },
  reviewSheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0', alignSelf: 'center', marginBottom: 16 },
  reviewSheetTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 4 },
  starPicker: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  reviewInput: { backgroundColor: '#F2F2F7', borderRadius: 12, padding: 14, fontSize: 15, color: TEXT_PRIMARY, minHeight: 90, textAlignVertical: 'top' },
  reviewSubmit: { marginTop: 14, backgroundColor: NAVY, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  reviewSubmitTxt: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});