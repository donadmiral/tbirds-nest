/**
 * StartupHubDetailsScreen.tsx
 * Polished to match Option A gradient hero design language.
 * Existing design preserved. Production fixes added:
 * - true LinearGradient hero
 * - startup_interest realtime listener
 * - count reconciled from server after toggle
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, StatusBar, Alert, TextInput, Share, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

const STAGE_EMOJI: Record<string, string> = {
  'Idea': '💡', 'MVP': '🔧', 'Seed': '🌱', 'Series A+': '🚀', 'Profitable': '💰',
};

const HERO_GRADIENTS = [
  ['#0B1E3D', '#1A3560'],
  ['#065F46', '#10B981'],
  ['#7C2D12', '#D97706'],
  ['#5B21B6', '#8B5CF6'],
  ['#BE185D', '#F472B6'],
  ['#1E3A8A', '#3B82F6'],
];

function getGradientIndex(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % HERO_GRADIENTS.length;
  return Math.abs(h) % HERO_GRADIENTS.length;
}

function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

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

  useEffect(() => {
    if (!postId) return;
    const ch = supabase.channel(`startup_details_live_${postId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'startup_interest' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'startup_posts', filter: `id=eq.${postId}` }, () => load())
      .subscribe((status) => console.log('STARTUP_DETAILS_REALTIME', status));
    return () => { supabase.removeChannel(ch); };
  }, [postId, load]);

  const toggleInterest = async () => {
    if (!post || !myId || busy) return;
    setBusy(true);
    const wasInterested = post.interested;
    try {
      if (wasInterested) {
        const { error } = await supabase.from('startup_interest').delete().eq('startup_id', post.id).eq('investor_id', myId);
        if (error) throw error;
        setPost(p => p ? { ...p, interested: false } : p);
        Alert.alert('Removed', 'Your interest has been removed.');
      } else {
        const { error } = await supabase.from('startup_interest').insert({ startup_id: post.id, investor_id: myId, note: note.trim() || null });
        if (error && error.code !== '23505') { Alert.alert('Error', error.message); return; }
        setPost(p => p ? { ...p, interested: true } : p);
        Alert.alert('Interested!', `${post.founder_name} will be notified of your interest.`);
      }
      await load();
    } catch (e: any) { Alert.alert('Error', e?.message || 'Could not update interest.'); }
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

  if (loading) return <SafeAreaView style={st.safe}><View style={st.center}><ActivityIndicator color={NAVY} size="large" /></View></SafeAreaView>;
  if (!post) return (
    <SafeAreaView style={st.safe}>
      <View style={st.center}>
        <Feather name="alert-circle" size={40} color="#E5E5EA" />
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#3C3C43', marginTop: 12 }}>Startup not found</Text>
        <TouchableOpacity style={st.goBackBtn} onPress={() => navigation.goBack()}>
          <Text style={st.goBackBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const isOwn = post.founder_id === myId;
  const gi = getGradientIndex(post.id);
  const colors = HERO_GRADIENTS[gi];
  const stageEmoji = STAGE_EMOJI[post.stage] || '✨';

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={24} color={NAVY} />
        </TouchableOpacity>
        <Text style={st.headerTitle} numberOfLines={1}>Startup Hub</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity style={st.hdrIcon} onPress={async () => {
            await Share.share({ message: `${post.startup_name}\n${post.one_liner}\n\nSee it on PlatinumCircles Startup Hub.` });
          }} activeOpacity={0.7}>
            <Feather name="share-2" size={16} color={TEXT_PRIMARY} />
          </TouchableOpacity>
          {isOwn && (
            <TouchableOpacity style={st.hdrIcon} onPress={handleDelete} activeOpacity={0.7}>
              <Feather name="trash-2" size={16} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}>
        <LinearGradient colors={colors as any} style={st.hero}>
          <View style={st.heroBadgeRow}>
            <View style={st.stageBadge}><Text style={st.stageBadgeTxt}>{stageEmoji} {post.stage}</Text></View>
            <View style={st.industryBadge}><Text style={st.industryBadgeTxt}>{post.industry}</Text></View>
          </View>
          <View style={st.heroContent}>
            <Text style={st.heroName}>{post.startup_name}</Text>
            <Text style={st.heroLiner}>{post.one_liner}</Text>
          </View>
          <View style={st.logoFloat}>
            <Text style={st.logoTxt}>{initials(post.startup_name)}</Text>
          </View>
        </LinearGradient>

        <View style={st.statsRow}>
          <View style={st.stat}>
            <View style={st.statIcon}><Text style={{ fontSize: 14 }}>{stageEmoji}</Text></View>
            <View><Text style={st.statVal}>{post.stage}</Text><Text style={st.statLbl}>Stage</Text></View>
          </View>
          <View style={st.stat}>
            <View style={st.statIcon}><Text style={{ fontSize: 14 }}>⚡</Text></View>
            <View><Text style={st.statVal}>{post.interest_count}</Text><Text style={st.statLbl}>Interested</Text></View>
          </View>
          <View style={st.stat}>
            <View style={st.statIcon}><Text style={{ fontSize: 14 }}>💼</Text></View>
            <View><Text style={st.statVal}>{post.industry}</Text><Text style={st.statLbl}>Industry</Text></View>
          </View>
        </View>

        <TouchableOpacity style={st.founderRow} onPress={() => navigation.navigate('UserProfile', { userId: post.founder_id })} activeOpacity={0.8}>
          <View style={st.founderAvatar}><Text style={st.founderAvatarTxt}>{post.founder_name.charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}><Text style={st.founderName}>{post.founder_name}</Text><Text style={st.founderLabel}>Founder</Text></View>
          <Feather name="chevron-right" size={16} color="#C7C7CC" />
        </TouchableOpacity>

        <View style={st.section}>
          <Text style={st.secTitle}>Details</Text>
          <View style={st.detailsCard}>
            <DetailRow icon="map-pin" label="Location" value={post.location} />
            <DetailRow icon="target" label="Funding Need" value={post.funding_need || 'Not specified'} />
            {post.website && (
              <TouchableOpacity onPress={() => {
                let u = post.website!; if (!u.startsWith('http')) u = 'https://' + u;
                Linking.openURL(u).catch(() => {});
              }} activeOpacity={0.7}>
                <DetailRow icon="globe" label="Website" value={post.website} isLink />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={st.section}>
          <Text style={st.secTitle}>About</Text>
          <Text style={st.descText}>{post.description}</Text>
        </View>

        <View style={st.section}>
          <View style={st.intHeader}>
            <Text style={st.secTitle}>Investor Interest</Text>
            <View style={st.intCountBadge}>
              <Text style={{ fontSize: 13 }}>⚡</Text>
              <Text style={st.intCountTxt}>{post.interest_count}</Text>
            </View>
          </View>

          {!isOwn && !post.interested && (
            <View style={st.noteSection}>
              <Text style={st.noteLabel}>Add a note (optional)</Text>
              <TextInput value={note} onChangeText={setNote}
                placeholder="What excites you about this startup? What can you offer?"
                placeholderTextColor="#C7C7CC"
                style={st.noteInput} multiline textAlignVertical="top" />
            </View>
          )}

          {!isOwn && (
            <View style={st.actionsCol}>
              <TouchableOpacity
                style={[st.intBtn, post.interested && st.intBtnActive]}
                onPress={toggleInterest} disabled={busy} activeOpacity={0.85}
              >
                {busy
                  ? <ActivityIndicator color={post.interested ? '#FFF' : '#FF9500'} size={16} />
                  : <>
                      <Text style={{ fontSize: 16 }}>⚡</Text>
                      <Text style={[st.intBtnTxt, post.interested && st.intBtnTxtActive]}>
                        {post.interested ? 'Interested' : 'Express Interest'}
                      </Text>
                    </>
                }
              </TouchableOpacity>
              <TouchableOpacity style={st.contactBtn} onPress={() => navigation.navigate('Chat', {
                userId: post.founder_id, userName: post.founder_name,
                otherUser: { id: post.founder_id, full_name: post.founder_name, username: null, avatar_url: null },
              })} activeOpacity={0.85}>
                <Feather name="message-circle" size={16} color={NAVY} />
                <Text style={st.contactBtnTxt}>Contact Founder</Text>
              </TouchableOpacity>
            </View>
          )}

          {isOwn && (
            <View style={st.ownBanner}>
              <Feather name="info" size={14} color={NAVY} />
              <Text style={st.ownBannerTxt}>{post.interest_count} investors have expressed interest in your startup.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ icon, label, value, isLink }: { icon: string; label: string; value: string; isLink?: boolean }) {
  return (
    <View style={st.detailRow}>
      <View style={st.detailIcon}><Feather name={icon as any} size={15} color={NAVY} /></View>
      <View style={{ flex: 1 }}>
        <Text style={st.detailLabel}>{label}</Text>
        <Text style={[st.detailValue, isLink && { color: NAVY, fontWeight: '500' }]}>{value}</Text>
      </View>
      {isLink && <Feather name="external-link" size={14} color={NAVY} />}
    </View>
  );
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
  hero: { height: 180, padding: 16, justifyContent: 'flex-end', position: 'relative' },
  heroBadgeRow: { position: 'absolute', top: 14, left: 14, flexDirection: 'row', gap: 6 },
  stageBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  stageBadgeTxt: { fontSize: 12, fontWeight: '700', color: '#FFF' },
  industryBadge: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  industryBadgeTxt: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  heroContent: {},
  heroName: { fontSize: 26, fontWeight: '700', color: '#FFF', textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 }, marginBottom: 4 },
  heroLiner: { fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 20 },
  logoFloat: { position: 'absolute', bottom: -28, right: 16, width: 56, height: 56, borderRadius: 16, backgroundColor: '#FFF', borderWidth: 3, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  logoTxt: { fontSize: 20, fontWeight: '700', color: NAVY },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, paddingTop: 20, gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' },
  statVal: { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  statLbl: { fontSize: 10, color: TEXT_SECONDARY },
  founderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 16, backgroundColor: '#F9F9F9', borderRadius: 14, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  founderAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  founderAvatarTxt: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  founderName: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY },
  founderLabel: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 1 },
  section: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  secTitle: { fontSize: 15, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 10 },
  detailsCard: { backgroundColor: '#F9F9F9', borderRadius: 14, padding: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  detailIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' },
  detailLabel: { fontSize: 11, color: TEXT_SECONDARY, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  detailValue: { fontSize: 14, color: TEXT_PRIMARY, marginTop: 1 },
  descText: { fontSize: 15, color: '#3C3C43', lineHeight: 24 },
  intHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  intCountBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF9EE', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#FEECC0' },
  intCountTxt: { fontSize: 14, fontWeight: '700', color: '#FF9500' },
  noteSection: { marginBottom: 14 },
  noteLabel: { fontSize: 12, fontWeight: '600', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  noteInput: { backgroundColor: '#F2F2F7', borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 15, color: TEXT_PRIMARY, minHeight: 90 },
  actionsCol: { gap: 10 },
  intBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14, borderWidth: 1.5, borderColor: '#FEECC0', backgroundColor: '#FFF9EE' },
  intBtnActive: { backgroundColor: '#FF9500', borderColor: '#FF9500' },
  intBtnTxt: { fontSize: 15, fontWeight: '700', color: '#FF9500' },
  intBtnTxtActive: { color: '#FFF' },
  contactBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14, backgroundColor: '#F2F2F7', borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  contactBtnTxt: { fontSize: 15, fontWeight: '600', color: NAVY },
  ownBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F2F2F7', borderRadius: 14, padding: 14 },
  ownBannerTxt: { flex: 1, fontSize: 14, color: NAVY, lineHeight: 20 },
});
