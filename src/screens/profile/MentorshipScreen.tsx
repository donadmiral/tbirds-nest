import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, StatusBar, Image, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  getMyMentorProfile, getIncomingRequests, listMyMentorships, getOutgoingRequests,
  MyMentorProfile, MyMentorship, IncomingRequest, OutgoingRequest,
  MENTOR_KIND_LABEL,
} from '../../services/mentorshipService';

function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

const COLORS = ['#1D4ED8','#065F46','#7C2D12','#5856D6','#C2410C','#0F766E','#7C3AED','#0B1E3D'];
function colorFor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  return COLORS[Math.abs(h) % COLORS.length];
}

function relTime(iso?: string | null) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

export default function MentorshipScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [mentorProfile, setMentorProfile] = useState<MyMentorProfile | null>(null);
  const [mentorships, setMentorships] = useState<MyMentorship[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [mp, mine, inc, out] = await Promise.all([
      getMyMentorProfile(),
      listMyMentorships('active'),
      getIncomingRequests(),
      getOutgoingRequests(),
    ]);
    setMentorProfile(mp);
    setMentorships(mine);
    setIncoming(inc);
    setOutgoing(out.filter(r => r.status === 'pending'));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isMentor = !!mentorProfile?.is_active;

  // Navigate to screens registered on the NetworkStack. Because Mentorship
  // lives in ProfileStack, we jump over to NetworkStack using nested nav.
  const goNetwork = (screen: string, params?: any) => {
    nav.navigate('Main', { screen: 'Network', params: { screen, params } });
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loader}><ActivityIndicator color="#000" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Mentorship</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <View style={s.hero}>
          <Text style={s.heroTitle}>Learn from your community</Text>
          <Text style={s.heroSub}>
            Get paired with alumni, faculty, and senior students at your school. Real career guidance, not just networking.
          </Text>
        </View>

        <View style={s.ctaRow}>
          <TouchableOpacity style={[s.ctaCard, s.ctaFind]} onPress={() => goNetwork('MentorList')} activeOpacity={0.85}>
            <View style={s.ctaIcon}><Feather name="search" size={20} color="#FFF" /></View>
            <Text style={s.ctaTitle}>Find a mentor</Text>
            <Text style={s.ctaSub}>Browse your school</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.ctaCard, isMentor ? s.ctaManage : s.ctaBecome]}
            onPress={() => goNetwork('BecomeMentor')}
            activeOpacity={0.85}
          >
            <View style={s.ctaIcon}>
              <Feather name={isMentor ? 'settings' : 'award'} size={20} color="#FFF" />
            </View>
            <Text style={s.ctaTitle}>{isMentor ? 'Manage mentoring' : 'Become a mentor'}</Text>
            <Text style={s.ctaSub}>
              {isMentor ? `${MENTOR_KIND_LABEL[mentorProfile!.mentor_kind]} · up to ${mentorProfile!.max_active_mentees}` : 'Help students grow'}
            </Text>
          </TouchableOpacity>
        </View>

        {isMentor && incoming.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Incoming requests</Text>
              <View style={s.countPill}><Text style={s.countPillTxt}>{incoming.length}</Text></View>
            </View>
            {incoming.slice(0, 3).map(r => (
              <TouchableOpacity
                key={r.request_id}
                style={s.reqRow}
                activeOpacity={0.7}
                onPress={() => goNetwork('MentorshipRequests')}
              >
                {r.avatar_url ? (
                  <Image source={{ uri: r.avatar_url }} style={s.reqAvatar} />
                ) : (
                  <View style={[s.reqAvatar, { backgroundColor: colorFor(r.mentee_id) }]}>
                    <Text style={s.reqAvatarTxt}>{initials(r.full_name)}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.reqName} numberOfLines={1}>{r.full_name || 'User'}</Text>
                  <Text style={s.reqMsg} numberOfLines={2}>{r.message}</Text>
                </View>
                <Text style={s.reqTime}>{relTime(r.requested_at)}</Text>
              </TouchableOpacity>
            ))}
            {incoming.length > 3 && (
              <TouchableOpacity style={s.viewMoreBtn} onPress={() => goNetwork('MentorshipRequests')}>
                <Text style={s.viewMoreTxt}>See all {incoming.length} requests</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>My mentorships</Text>
            {mentorships.length > 0 && (
              <View style={s.countPill}><Text style={s.countPillTxt}>{mentorships.length}</Text></View>
            )}
          </View>

          {mentorships.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="users" size={28} color="#D1D5DB" />
              <Text style={s.emptyTxt}>No active mentorships yet</Text>
              <Text style={s.emptySub}>
                {isMentor
                  ? 'Accept a request to start your first mentorship.'
                  : 'Find a mentor to begin your journey.'}
              </Text>
            </View>
          ) : (
            mentorships.map(m => (
              <TouchableOpacity
                key={m.mentorship_id}
                style={s.mentorshipCard}
                activeOpacity={0.8}
                onPress={() => goNetwork('MentorshipDetail', { mentorshipId: m.mentorship_id })}
              >
                {m.partner_avatar ? (
                  <Image source={{ uri: m.partner_avatar }} style={s.mAvatar} />
                ) : (
                  <View style={[s.mAvatar, { backgroundColor: colorFor(m.partner_id) }]}>
                    <Text style={s.mAvatarTxt}>{initials(m.partner_name)}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={s.mTopRow}>
                    <Text style={s.mName} numberOfLines={1}>{m.partner_name || 'User'}</Text>
                    <View style={[s.rolePill, m.role === 'mentor' ? s.roleMentor : s.roleMentee]}>
                      <Text style={[s.rolePillTxt, m.role === 'mentor' ? s.roleMentorTxt : s.roleMenteeTxt]}>
                        {m.role === 'mentor' ? 'Mentoring' : 'Mentee'}
                      </Text>
                    </View>
                  </View>
                  {m.partner_headline ? (
                    <Text style={s.mHeadline} numberOfLines={1}>{m.partner_headline}</Text>
                  ) : null}
                  <View style={s.mStats}>
                    <Feather name="target" size={11} color="#6B7280" />
                    <Text style={s.mStatTxt}>{m.goals_open} open</Text>
                    <Text style={s.mDot}>·</Text>
                    <Feather name="check-circle" size={11} color="#6B7280" />
                    <Text style={s.mStatTxt}>{m.goals_completed} done</Text>
                    {m.meetings_upcoming > 0 && (
                      <>
                        <Text style={s.mDot}>·</Text>
                        <Feather name="calendar" size={11} color="#059669" />
                        <Text style={[s.mStatTxt, { color: '#059669' }]}>{m.meetings_upcoming} upcoming</Text>
                      </>
                    )}
                  </View>
                </View>
                <Feather name="chevron-right" size={18} color="#C7C7CC" />
              </TouchableOpacity>
            ))
          )}
        </View>

        {outgoing.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Your pending requests</Text>
            {outgoing.map(r => (
              <View key={r.request_id} style={s.outRow}>
                {r.avatar_url ? (
                  <Image source={{ uri: r.avatar_url }} style={s.outAvatar} />
                ) : (
                  <View style={[s.outAvatar, { backgroundColor: colorFor(r.mentor_id) }]}>
                    <Text style={s.outAvatarTxt}>{initials(r.full_name)}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.outName} numberOfLines={1}>{r.full_name || 'User'}</Text>
                  <Text style={s.outMeta}>Waiting for response · {relTime(r.requested_at)}</Text>
                </View>
                <View style={s.pendingDot} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },

  hero: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 16 },
  heroTitle: { fontSize: 24, fontWeight: '800', color: '#000' },
  heroSub: { fontSize: 14, color: '#6B7280', marginTop: 6, lineHeight: 20 },

  ctaRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10 },
  ctaCard: {
    flex: 1, borderRadius: 16, padding: 14, minHeight: 110, justifyContent: 'space-between',
  },
  ctaFind: { backgroundColor: '#0B1E3D' },
  ctaBecome: { backgroundColor: '#F59E0B' },
  ctaManage: { backgroundColor: '#065F46' },
  ctaIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  ctaTitle: { fontSize: 15, fontWeight: '800', color: '#FFF', marginTop: 8 },
  ctaSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  section: { paddingHorizontal: 16, paddingTop: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#000' },
  countPill: {
    backgroundColor: '#F59E0B', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 10, minWidth: 22, alignItems: 'center',
  },
  countPillTxt: { color: '#FFF', fontSize: 11, fontWeight: '800' },

  reqRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F3F4F6',
  },
  reqAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  reqAvatarTxt: { fontSize: 14, fontWeight: '800', color: '#FFF' },
  reqName: { fontSize: 14, fontWeight: '700', color: '#000' },
  reqMsg: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 16 },
  reqTime: { fontSize: 11, color: '#9CA3AF' },

  viewMoreBtn: {
    paddingVertical: 12, alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F3F4F6',
  },
  viewMoreTxt: { fontSize: 13, fontWeight: '700', color: '#1D4ED8' },

  emptyBox: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 30, paddingHorizontal: 24,
    backgroundColor: '#F9FAFB', borderRadius: 14, gap: 6,
  },
  emptyTxt: { fontSize: 14, fontWeight: '700', color: '#374151' },
  emptySub: { fontSize: 12, color: '#6B7280', textAlign: 'center', lineHeight: 17 },

  mentorshipCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F9FAFB', borderRadius: 14,
    padding: 12, marginBottom: 8,
  },
  mAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  mAvatarTxt: { fontSize: 14, fontWeight: '800', color: '#FFF' },
  mTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mName: { flex: 1, fontSize: 14, fontWeight: '700', color: '#000' },
  rolePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  roleMentor: { backgroundColor: '#D1FAE5' },
  roleMentee: { backgroundColor: '#DBEAFE' },
  rolePillTxt: { fontSize: 10, fontWeight: '800' },
  roleMentorTxt: { color: '#065F46' },
  roleMenteeTxt: { color: '#1E3A8A' },
  mHeadline: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  mStats: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  mStatTxt: { fontSize: 11, color: '#6B7280' },
  mDot: { fontSize: 11, color: '#D1D5DB' },

  outRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F3F4F6',
  },
  outAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  outAvatarTxt: { fontSize: 13, fontWeight: '800', color: '#FFF' },
  outName: { fontSize: 14, fontWeight: '700', color: '#000' },
  outMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  pendingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F59E0B' },
});