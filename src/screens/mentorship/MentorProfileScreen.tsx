import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  ActivityIndicator, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import {
  getMentorProfile, withdrawMentorshipRequest,
  MentorProfileDetail, MENTOR_KIND_LABEL,
} from '../../services/mentorshipService';
import RequestMentorshipModal from '../../components/mentorship/RequestMentorshipModal';

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

export default function MentorProfileScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const mentorId: string = route.params?.mentorId;

  const [mentor, setMentor] = useState<MentorProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestOpen, setRequestOpen] = useState(false);

  const load = useCallback(async () => {
    if (!mentorId) return;
    const data = await getMentorProfile(mentorId);
    setMentor(data);
    setLoading(false);
  }, [mentorId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loader}><ActivityIndicator color="#000" /></View>
      </SafeAreaView>
    );
  }

  if (!mentor) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => nav.goBack()} style={s.backBtn}>
            <Feather name="chevron-left" size={26} color="#000" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Mentor</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.empty}>
          <Feather name="user-x" size={32} color="#D1D5DB" />
          <Text style={s.emptyTitle}>Mentor unavailable</Text>
          <Text style={s.emptySub}>This mentor may no longer be accepting requests or is at a different institution.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasActive = !!mentor.my_mentorship_id;
  const pending = mentor.my_request_status === 'pending';
  const canRequest = !hasActive && !pending && mentor.has_capacity;

  const primaryCta = () => {
    if (hasActive) {
      return (
        <TouchableOpacity
          style={[s.cta, s.ctaActive]}
          onPress={() => nav.navigate('MentorshipDetail', { mentorshipId: mentor.my_mentorship_id })}
          activeOpacity={0.85}
        >
          <Feather name="users" size={16} color="#FFF" />
          <Text style={s.ctaTxt}>Open mentorship</Text>
        </TouchableOpacity>
      );
    }
    if (pending) {
      return (
        <TouchableOpacity
          style={[s.cta, s.ctaPending]}
          activeOpacity={0.7}
          onPress={() => {
            Alert.alert(
              'Request pending',
              'Your request is waiting for review. Withdraw it?',
              [
                { text: 'Keep waiting', style: 'cancel' },
                {
                  text: 'Withdraw', style: 'destructive',
                  onPress: async () => {
                    try {
                      // We don't have request id here; redirect to hub
                      Alert.alert('Go to Mentorship', 'Open Mentorship Hub to manage pending requests.');
                    } catch (e: any) {
                      Alert.alert('Error', e?.message || 'Could not withdraw.');
                    }
                  },
                },
              ]
            );
          }}
        >
          <Feather name="clock" size={16} color="#B45309" />
          <Text style={[s.ctaTxt, { color: '#B45309' }]}>Request pending</Text>
        </TouchableOpacity>
      );
    }
    if (!mentor.has_capacity) {
      return (
        <View style={[s.cta, s.ctaFull]}>
          <Feather name="x-circle" size={16} color="#991B1B" />
          <Text style={[s.ctaTxt, { color: '#991B1B' }]}>At capacity</Text>
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={[s.cta, s.ctaOpen]}
        activeOpacity={0.85}
        onPress={() => setRequestOpen(true)}
      >
        <Feather name="send" size={16} color="#FFF" />
        <Text style={s.ctaTxt}>Request mentorship</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Mentor</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
        <View style={s.hero}>
          {mentor.avatar_url ? (
            <Image source={{ uri: mentor.avatar_url }} style={s.heroAvatar} />
          ) : (
            <View style={[s.heroAvatar, { backgroundColor: colorFor(mentor.profile_id) }]}>
              <Text style={s.heroAvatarTxt}>{initials(mentor.full_name)}</Text>
            </View>
          )}
          <Text style={s.heroName}>{mentor.full_name || 'Mentor'}</Text>
          {mentor.username ? (
            <Text style={s.heroHandle}>@{mentor.username}</Text>
          ) : null}
          <View style={s.kindPill}>
            <Text style={s.kindPillTxt}>{MENTOR_KIND_LABEL[mentor.mentor_kind]}</Text>
          </View>
          {mentor.headline ? (
            <Text style={s.heroHeadline}>{mentor.headline}</Text>
          ) : null}
        </View>

        <View style={s.capBanner}>
          <View style={s.capBlock}>
            <Text style={s.capNum}>{mentor.active_mentees}</Text>
            <Text style={s.capLabel}>Current mentees</Text>
          </View>
          <View style={s.capDivider} />
          <View style={s.capBlock}>
            <Text style={s.capNum}>{mentor.max_active_mentees}</Text>
            <Text style={s.capLabel}>Capacity</Text>
          </View>
          <View style={s.capDivider} />
          <View style={s.capBlock}>
            <Text style={[s.capNum, { color: mentor.has_capacity ? '#065F46' : '#991B1B' }]}>
              {mentor.max_active_mentees - mentor.active_mentees}
            </Text>
            <Text style={s.capLabel}>Open slots</Text>
          </View>
        </View>

        {mentor.bio ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>ABOUT</Text>
            <Text style={s.bioTxt}>{mentor.bio}</Text>
          </View>
        ) : null}

        {mentor.help_with.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>CAN HELP WITH</Text>
            <View style={s.tagRow}>
              {mentor.help_with.map(t => (
                <View key={t} style={s.helpTag}>
                  <Feather name="check" size={11} color="#065F46" />
                  <Text style={s.helpTagTxt}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {mentor.expertise_tags.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>EXPERTISE</Text>
            <View style={s.tagRow}>
              {mentor.expertise_tags.map(t => (
                <View key={t} style={s.expTag}>
                  <Text style={s.expTagTxt}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {mentor.availability_note ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>AVAILABILITY</Text>
            <Text style={s.bioTxt}>{mentor.availability_note}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[s.ctaWrap, { paddingBottom: insets.bottom + 12 }]}>
        {primaryCta()}
      </View>

      {requestOpen && (
        <RequestMentorshipModal
          mentorId={mentor.profile_id}
          mentorName={mentor.full_name || 'Mentor'}
          helpWithOptions={mentor.help_with}
          onClose={() => setRequestOpen(false)}
          onSuccess={() => { setRequestOpen(false); load(); }}
        />
      )}
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

  hero: { alignItems: 'center', paddingVertical: 24 },
  heroAvatar: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  heroAvatarTxt: { fontSize: 32, fontWeight: '800', color: '#FFF' },
  heroName: { fontSize: 22, fontWeight: '800', color: '#000', marginTop: 12 },
  heroHandle: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  kindPill: { marginTop: 10, backgroundColor: '#FEF3C7', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  kindPillTxt: { fontSize: 12, fontWeight: '800', color: '#B45309' },
  heroHeadline: { fontSize: 14, color: '#374151', textAlign: 'center', marginTop: 10, paddingHorizontal: 32, lineHeight: 20 },

  capBanner: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: '#F9FAFB', borderRadius: 14,
    paddingVertical: 14,
  },
  capBlock: { flex: 1, alignItems: 'center' },
  capNum: { fontSize: 22, fontWeight: '800', color: '#000' },
  capLabel: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  capDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: '#E5E7EB' },

  section: { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: '#8E8E93',
    letterSpacing: 0.7, marginBottom: 10,
  },
  bioTxt: { fontSize: 14, color: '#111827', lineHeight: 21 },

  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  helpTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#D1FAE5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  helpTagTxt: { fontSize: 12, fontWeight: '700', color: '#065F46' },
  expTag: {
    backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  expTagTxt: { fontSize: 12, fontWeight: '600', color: '#374151' },

  ctaWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFF',
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB',
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14,
  },
  ctaOpen: { backgroundColor: '#000' },
  ctaActive: { backgroundColor: '#065F46' },
  ctaPending: { backgroundColor: '#FEF3C7' },
  ctaFull: { backgroundColor: '#FEE2E2' },
  ctaTxt: { fontSize: 15, fontWeight: '800', color: '#FFF' },

  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 6 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#000', marginTop: 8 },
  emptySub: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 18 },
});