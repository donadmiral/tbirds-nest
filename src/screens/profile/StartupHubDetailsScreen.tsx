import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, StatusBar, Alert, TextInput, Share, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

type Startup = {
  id: string; founder_id: string; founder_name: string; startup_name: string;
  industry: string; stage: string; location: string; one_liner: string;
  description: string; funding_need: string | null; website: string | null;
  created_at: string; interest_count: number; interested: boolean;
};

export default function StartupHubDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile, session } = useAuthStore();
  const myId = profile?.id ?? session?.user?.id ?? null;
  const postId = route.params?.postId;

  const [post, setPost] = useState<Startup | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!postId) { setLoading(false); return; }
    try {
      const { data, error } = await supabase.from('startup_posts').select('*').eq('id', postId).single();
      if (error || !data) { setPost(null); return; }
      const { data: fp } = await supabase.from('profiles').select('id, full_name').eq('id', data.founder_id).single();
      const { data: allInt } = await supabase.from('startup_interest').select('investor_id').eq('startup_id', postId);
      const myInt = (allInt || []).find((r: any) => r.investor_id === myId);
      setPost({ ...data, founder_name: fp?.full_name || 'Founder', interest_count: (allInt || []).length, interested: !!myInt });
      if (myInt) {
        const { data: myIntData } = await supabase.from('startup_interest').select('note').eq('startup_id', postId).eq('investor_id', myId).maybeSingle();
        setNote(myIntData?.note || '');
      }
    } catch (e) { console.log('SH_DETAILS_LOAD', e); }
    finally { setLoading(false); }
  }, [postId, myId]);

  useEffect(() => { load(); }, [load]);

  const toggleInterest = async () => {
    if (!post || !myId || busy) return;
    setBusy(true);
    try {
      if (post.interested) {
        await supabase.from('startup_interest').delete().eq('startup_id', post.id).eq('investor_id', myId);
        setPost(p => p ? { ...p, interested: false, interest_count: p.interest_count - 1 } : p);
        Alert.alert('Removed', 'Your interest has been removed.');
      } else {
        const { error } = await supabase.from('startup_interest').insert({ startup_id: post.id, investor_id: myId, note: note.trim() || null });
        if (error) { Alert.alert('Error', error.message); return; }
        setPost(p => p ? { ...p, interested: true, interest_count: p.interest_count + 1 } : p);
        Alert.alert('Interested!', `${post.founder_name} will be notified of your interest.`);
      }
    } catch { Alert.alert('Error', 'Could not update interest.'); }
    finally { setBusy(false); }
  };

  const handleDelete = () => {
    if (!post || post.founder_id !== myId) return;
    Alert.alert('Delete startup?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('startup_posts').delete().eq('id', post.id);
        navigation.goBack();
      }},
    ]);
  };

  if (loading) return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.loader}><ActivityIndicator size="large" color="#007AFF" /></View>
    </SafeAreaView>
  );
  if (!post) return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.loader}>
        <Text style={s.notFound}>Startup not found</Text>
        <TouchableOpacity style={s.goBackBtn} onPress={() => navigation.goBack()}><Text style={s.goBackTxt}>Go back</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const isOwn = post.founder_id === myId;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text><Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>Startup</Text>
        <View style={s.headerRight}>
          <TouchableOpacity onPress={async () => { await Share.share({ message: `${post.startup_name}\n${post.one_liner}\n\nSee it on TBirds Nest Startup Hub.` }); }} style={s.iconBtn}><Feather name="share-2" size={18} color="#000" /></TouchableOpacity>
          {isOwn && <TouchableOpacity onPress={handleDelete} style={s.iconBtn}><Feather name="trash-2" size={18} color="#FF3B30" /></TouchableOpacity>}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}>
        <View style={s.topRow}>
          <View style={s.stagePill}><Text style={s.stagePillTxt}>{post.stage}</Text></View>
          <View style={s.industryPill}><Text style={s.industryPillTxt}>{post.industry}</Text></View>
        </View>

        <Text style={s.name}>{post.startup_name}</Text>
        <Text style={s.oneLiner}>{post.one_liner}</Text>

        <TouchableOpacity style={s.founderRow} onPress={() => navigation.navigate('UserProfile', { userId: post.founder_id })} activeOpacity={0.8}>
          <View style={s.founderAvatar}><Text style={s.founderAvatarTxt}>{post.founder_name.charAt(0).toUpperCase()}</Text></View>
          <View><Text style={s.founderName}>{post.founder_name}</Text><Text style={s.founderLabel}>Founder</Text></View>
          <Feather name="chevron-right" size={16} color="#C7C7CC" style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>

        <View style={s.infoCard}>
          {[
            { icon: 'map-pin', label: 'Location', value: post.location },
            { icon: 'trending-up', label: 'Stage', value: post.stage },
            { icon: 'dollar-sign', label: 'Funding Need', value: post.funding_need || 'Not specified' },
          ].map(row => (
            <View key={row.label} style={s.infoRow}>
              <View style={s.infoIcon}><Feather name={row.icon as any} size={15} color="#007AFF" /></View>
              <View><Text style={s.infoLabel}>{row.label}</Text><Text style={s.infoValue}>{row.value}</Text></View>
            </View>
          ))}
          {post.website && (
            <TouchableOpacity style={s.infoRow} onPress={() => Linking.openURL(post.website!.startsWith('http') ? post.website! : `https://${post.website!}`)} activeOpacity={0.8}>
              <View style={s.infoIcon}><Feather name="globe" size={15} color="#007AFF" /></View>
              <View style={{ flex: 1 }}><Text style={s.infoLabel}>Website</Text><Text style={[s.infoValue, { color: '#007AFF' }]}>{post.website}</Text></View>
              <Feather name="external-link" size={14} color="#007AFF" />
            </TouchableOpacity>
          )}
        </View>

        <Text style={s.sectionLabel}>About</Text>
        <Text style={s.description}>{post.description}</Text>

        <View style={s.interestHeader}>
          <Text style={s.sectionLabel}>Investor Interest</Text>
          <View style={s.interestCount}><Feather name="zap" size={14} color="#FF9500" /><Text style={s.interestCountTxt}>{post.interest_count}</Text></View>
        </View>

        {!isOwn && !post.interested && (
          <View style={s.noteSection}>
            <Text style={s.noteSectionLabel}>Add a note (optional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="What excites you about this startup? What can you offer?" placeholderTextColor="#C7C7CC" style={s.noteInput} multiline textAlignVertical="top" />
          </View>
        )}

        {!isOwn && (
          <View style={s.actions}>
            <TouchableOpacity
              style={[s.interestBtn, post.interested && s.interestedBtn]}
              onPress={toggleInterest} disabled={busy} activeOpacity={0.85}
            >
              {busy ? <ActivityIndicator color={post.interested ? '#FFF' : '#FF9500'} size={16} /> : (
                <><Feather name="zap" size={16} color={post.interested ? '#FFF' : '#FF9500'} /><Text style={[s.interestBtnTxt, post.interested && s.interestedBtnTxt]}>{post.interested ? 'Interested ✓' : 'Express Interest'}</Text></>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={s.contactBtn} onPress={() => navigation.navigate('Chat', {
          userId: post.founder_id,
          userName: post.founder_name,
          otherUser: {
            id: post.founder_id,
            full_name: post.founder_name,
            username: null,
            avatar_url: null,
          },
        })} activeOpacity={0.85}>
              <Feather name="message-circle" size={16} color="#007AFF" />
              <Text style={s.contactBtnTxt}>Contact Founder</Text>
            </TouchableOpacity>
          </View>
        )}

        {isOwn && (
          <View style={s.ownBanner}>
            <Feather name="info" size={14} color="#007AFF" />
            <Text style={s.ownBannerTxt}>{post.interest_count} investors have expressed interest in your startup.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFound: { fontSize: 18, fontWeight: '600', color: '#3C3C43' },
  goBackBtn: { backgroundColor: '#007AFF', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  goBackTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginRight: 1 },
  backLbl: { fontSize: 17, color: '#007AFF' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000', flex: 1, textAlign: 'center' },
  headerRight: { flexDirection: 'row', gap: 6, minWidth: 60, justifyContent: 'flex-end' },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16 },
  topRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  stagePill: { backgroundColor: '#FFF9EE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#FEECC0' },
  stagePillTxt: { fontSize: 12, fontWeight: '700', color: '#FF9500' },
  industryPill: { backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  industryPillTxt: { fontSize: 12, fontWeight: '700', color: '#007AFF' },
  name: { fontSize: 28, fontWeight: '700', color: '#000', marginBottom: 6, lineHeight: 34 },
  oneLiner: { fontSize: 16, color: '#3C3C43', lineHeight: 24, marginBottom: 16 },
  founderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F5F5F5', borderRadius: 14, padding: 14, marginBottom: 18 },
  founderAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  founderAvatarTxt: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  founderName: { fontSize: 15, fontWeight: '600', color: '#000' },
  founderLabel: { fontSize: 12, color: '#8E8E93', marginTop: 1 },
  infoCard: { backgroundColor: '#F5F5F5', borderRadius: 14, padding: 4, marginBottom: 20 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EBEBEB' },
  infoIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontSize: 12, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.3 },
  infoValue: { fontSize: 15, color: '#000', marginTop: 2 },
  sectionLabel: { fontSize: 15, fontWeight: '700', color: '#000', marginBottom: 8 },
  description: { fontSize: 15, color: '#3C3C43', lineHeight: 24, marginBottom: 24 },
  interestHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  interestCount: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF9EE', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  interestCountTxt: { fontSize: 14, fontWeight: '700', color: '#FF9500' },
  noteSection: { marginBottom: 16 },
  noteSectionLabel: { fontSize: 13, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  noteInput: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 15, color: '#000', minHeight: 100 },
  actions: { gap: 10 },
  interestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14, borderWidth: 1.5, borderColor: '#FEECC0', backgroundColor: '#FFF9EE' },
  interestedBtn: { backgroundColor: '#FF9500', borderColor: '#FF9500' },
  interestBtnTxt: { fontSize: 15, fontWeight: '700', color: '#FF9500' },
  interestedBtnTxt: { color: '#FFF' },
  contactBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14, borderWidth: 1.5, borderColor: '#007AFF', backgroundColor: '#EFF6FF' },
  contactBtnTxt: { fontSize: 15, fontWeight: '700', color: '#007AFF' },
  ownBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14 },
  ownBannerTxt: { flex: 1, fontSize: 14, color: '#007AFF', lineHeight: 20 },
});