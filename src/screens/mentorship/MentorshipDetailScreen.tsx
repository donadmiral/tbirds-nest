import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  ActivityIndicator, StatusBar, Alert, Modal, TextInput, FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import {
  getMentorshipDetail, listGoals, listMeetings,
  createGoal, updateGoalStatus, deleteGoal,
  createMeeting, updateMeetingStatus, deleteMeeting,
  endMentorship,
  MentorshipDetail, Goal, Meeting, GoalStatus, MeetingKind, EndReason,
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

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' +
         d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

type Tab = 'goals' | 'meetings';

export default function MentorshipDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const mentorshipId: string = route.params?.mentorshipId;

  const [detail, setDetail] = useState<MentorshipDetail | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('goals');

  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDesc, setGoalDesc] = useState('');

  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingWhen, setMeetingWhen] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingKind, setMeetingKind] = useState<MeetingKind>('video');

  const load = useCallback(async () => {
    if (!mentorshipId) return;
    const [d, g, m] = await Promise.all([
      getMentorshipDetail(mentorshipId),
      listGoals(mentorshipId),
      listMeetings(mentorshipId),
    ]);
    setDetail(d);
    setGoals(g);
    setMeetings(m);
    setLoading(false);
  }, [mentorshipId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !detail) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loader}><ActivityIndicator color="#000" /></View>
      </SafeAreaView>
    );
  }

  const partner = {
    id: detail.my_role === 'mentor' ? detail.mentee_id : detail.mentor_id,
    name: detail.my_role === 'mentor' ? detail.mentee_name : detail.mentor_name,
    avatar: detail.my_role === 'mentor' ? detail.mentee_avatar : detail.mentor_avatar,
    username: detail.my_role === 'mentor' ? detail.mentee_username : detail.mentor_username,
  };

  const openChat = () => {
    if (!detail.conversation_id) {
      Alert.alert('No conversation', 'Chat is not available for this mentorship.');
      return;
    }
    nav.navigate('Chat', { conversationId: detail.conversation_id });
  };

  const openUserProfile = () => {
    nav.navigate('UserProfile', { userId: partner.id });
  };

  const submitGoal = async () => {
    if (!goalTitle.trim()) return;
    try {
      await createGoal({
        mentorshipId,
        title: goalTitle.trim(),
        description: goalDesc.trim() || undefined,
      });
      setGoalTitle(''); setGoalDesc('');
      setGoalModalOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not create goal.');
    }
  };

  const toggleGoal = (goal: Goal) => {
    const next: GoalStatus =
      goal.status === 'open' ? 'in_progress' :
      goal.status === 'in_progress' ? 'completed' :
      goal.status === 'completed' ? 'open' : 'open';
    updateGoalStatus(goal.id, next).then(load).catch(e => Alert.alert('Error', e?.message));
  };

  const removeGoal = (goal: Goal) => {
    Alert.alert('Delete goal?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => deleteGoal(goal.id).then(load).catch(e => Alert.alert('Error', e?.message)),
      },
    ]);
  };

  const submitMeeting = async () => {
    if (!meetingTitle.trim() || !meetingWhen.trim()) {
      Alert.alert('Missing info', 'Please add a title and date/time.');
      return;
    }
    // Parse simple ISO-ish strings. User writes "2026-05-12 14:30" format.
    const parsed = new Date(meetingWhen.replace(' ', 'T'));
    if (isNaN(parsed.getTime())) {
      Alert.alert('Invalid date', 'Use format like 2026-05-12 14:30');
      return;
    }
    try {
      await createMeeting({
        mentorshipId,
        title: meetingTitle.trim(),
        scheduledAt: parsed.toISOString(),
        kind: meetingKind,
        location: meetingLocation.trim() || undefined,
      });
      setMeetingTitle(''); setMeetingWhen(''); setMeetingLocation(''); setMeetingKind('video');
      setMeetingModalOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not schedule.');
    }
  };

  const markMeetingDone = (meeting: Meeting) => {
    updateMeetingStatus(meeting.id, 'completed').then(load).catch(e => Alert.alert('Error', e?.message));
  };

  const cancelMeeting = (meeting: Meeting) => {
    Alert.alert('Cancel meeting?', '', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel', style: 'destructive',
        onPress: () => updateMeetingStatus(meeting.id, 'cancelled').then(load).catch(e => Alert.alert('Error', e?.message)),
      },
    ]);
  };

  const confirmEnd = () => {
    if (detail.status === 'ended') return;
    Alert.alert(
      'End mentorship?',
      'Both parties keep their messages and history, but the relationship will be marked as ended.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End', style: 'destructive',
          onPress: async () => {
            try {
              const reason: EndReason = detail.my_role === 'mentor' ? 'mentor_ended' : 'mentee_ended';
              await endMentorship(mentorshipId, reason);
              nav.goBack();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not end.');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Mentorship</Text>
        <TouchableOpacity onPress={confirmEnd} style={s.backBtn}>
          <Feather name="more-vertical" size={20} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

        <TouchableOpacity style={s.partnerRow} onPress={openUserProfile} activeOpacity={0.8}>
          {partner.avatar ? (
            <Image source={{ uri: partner.avatar }} style={s.partnerAvatar} />
          ) : (
            <View style={[s.partnerAvatar, { backgroundColor: colorFor(partner.id) }]}>
              <Text style={s.partnerAvatarTxt}>{initials(partner.name)}</Text>
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.partnerName}>{partner.name || 'User'}</Text>
            <View style={s.partnerMeta}>
              <View style={[s.rolePill, detail.my_role === 'mentor' ? s.rolePillMentor : s.rolePillMentee]}>
                <Text style={s.rolePillTxt}>
                  {detail.my_role === 'mentor' ? 'You mentor them' : 'They mentor you'}
                </Text>
              </View>
              <Text style={s.startedTxt}>Started {fmtDate(detail.started_at)}</Text>
            </View>
          </View>
        </TouchableOpacity>

        <View style={s.actionRow}>
          <TouchableOpacity style={[s.actionBtn, s.actionPrimary]} onPress={openChat} activeOpacity={0.85}>
            <Feather name="message-circle" size={15} color="#FFF" />
            <Text style={s.actionPrimaryTxt}>Open chat</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, s.actionSecondary]}
            onPress={() => setMeetingModalOpen(true)}
            activeOpacity={0.85}
          >
            <Feather name="calendar" size={15} color="#000" />
            <Text style={s.actionSecondaryTxt}>Schedule</Text>
          </TouchableOpacity>
        </View>

        <View style={s.tabRow}>
          <TouchableOpacity
            style={[s.tab, tab === 'goals' && s.tabActive]}
            onPress={() => setTab('goals')}
          >
            <Text style={[s.tabTxt, tab === 'goals' && s.tabTxtActive]}>Goals</Text>
            {goals.length > 0 && (
              <View style={s.tabBadge}><Text style={s.tabBadgeTxt}>{goals.length}</Text></View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, tab === 'meetings' && s.tabActive]}
            onPress={() => setTab('meetings')}
          >
            <Text style={[s.tabTxt, tab === 'meetings' && s.tabTxtActive]}>Meetings</Text>
            {meetings.length > 0 && (
              <View style={s.tabBadge}><Text style={s.tabBadgeTxt}>{meetings.length}</Text></View>
            )}
          </TouchableOpacity>
        </View>

        {tab === 'goals' ? (
          <View style={{ padding: 14 }}>
            <TouchableOpacity style={s.addCard} onPress={() => setGoalModalOpen(true)} activeOpacity={0.85}>
              <Feather name="plus-circle" size={18} color="#000" />
              <Text style={s.addCardTxt}>Add a goal</Text>
            </TouchableOpacity>

            {goals.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="target" size={28} color="#D1D5DB" />
                <Text style={s.emptyTxt}>No goals yet</Text>
                <Text style={s.emptySub}>Add accountability by setting goals together.</Text>
              </View>
            ) : goals.map(g => (
              <View key={g.id} style={s.goalRow}>
                <TouchableOpacity
                  style={[s.goalCheck, g.status === 'completed' && s.goalCheckDone, g.status === 'in_progress' && s.goalCheckProgress]}
                  onPress={() => toggleGoal(g)}
                >
                  {g.status === 'completed' && <Feather name="check" size={14} color="#FFF" />}
                  {g.status === 'in_progress' && <View style={s.goalCheckDot} />}
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={[s.goalTitle, g.status === 'completed' && s.goalTitleDone]}>{g.title}</Text>
                  {g.description ? (
                    <Text style={s.goalDesc} numberOfLines={2}>{g.description}</Text>
                  ) : null}
                  <Text style={s.goalMeta}>
                    {g.status === 'open' ? 'Open' :
                     g.status === 'in_progress' ? 'In progress' :
                     g.status === 'completed' ? 'Completed' : 'Abandoned'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => removeGoal(g)} style={s.goalDelete}>
                  <Feather name="x" size={14} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ padding: 14 }}>
            <TouchableOpacity style={s.addCard} onPress={() => setMeetingModalOpen(true)} activeOpacity={0.85}>
              <Feather name="plus-circle" size={18} color="#000" />
              <Text style={s.addCardTxt}>Schedule a meeting</Text>
            </TouchableOpacity>

            {meetings.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="calendar" size={28} color="#D1D5DB" />
                <Text style={s.emptyTxt}>No meetings yet</Text>
                <Text style={s.emptySub}>Schedule your first call or in-person session.</Text>
              </View>
            ) : meetings.map(m => {
              const past = new Date(m.scheduled_at).getTime() < Date.now();
              return (
                <View key={m.id} style={[s.meetingCard, m.status === 'cancelled' && { opacity: 0.5 }]}>
                  <View style={s.meetingTop}>
                    <View style={s.meetingIcon}>
                      <Feather
                        name={m.kind === 'video' ? 'video' : m.kind === 'phone' ? 'phone' : 'map-pin'}
                        size={14}
                        color="#1D4ED8"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.meetingTitle}>{m.title}</Text>
                      <Text style={s.meetingWhen}>{fmtDateTime(m.scheduled_at)}</Text>
                      {m.location ? (
                        <Text style={s.meetingLoc} numberOfLines={1}>{m.location}</Text>
                      ) : null}
                    </View>
                    <View style={[
                      s.statusPill,
                      m.status === 'completed' && s.statusDone,
                      m.status === 'cancelled' && s.statusCancelled,
                      m.status === 'scheduled' && past && s.statusPast,
                    ]}>
                      <Text style={[
                        s.statusPillTxt,
                        m.status === 'completed' && { color: '#065F46' },
                        m.status === 'cancelled' && { color: '#991B1B' },
                        m.status === 'scheduled' && past && { color: '#B45309' },
                      ]}>
                        {m.status === 'completed' ? 'Done' :
                         m.status === 'cancelled' ? 'Cancelled' :
                         past ? 'Past' : 'Scheduled'}
                      </Text>
                    </View>
                  </View>
                  {m.status === 'scheduled' && (
                    <View style={s.meetingActions}>
                      <TouchableOpacity style={s.meetingBtn} onPress={() => markMeetingDone(m)}>
                        <Text style={s.meetingBtnTxt}>Mark done</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.meetingBtn, s.meetingBtnDanger]} onPress={() => cancelMeeting(m)}>
                        <Text style={[s.meetingBtnTxt, { color: '#DC2626' }]}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={goalModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGoalModalOpen(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>New goal</Text>
            <TextInput
              value={goalTitle}
              onChangeText={t => t.length <= 120 && setGoalTitle(t)}
              placeholder="Goal title"
              placeholderTextColor="#9CA3AF"
              style={s.modalInput}
            />
            <TextInput
              value={goalDesc}
              onChangeText={t => t.length <= 400 && setGoalDesc(t)}
              placeholder="Description (optional)"
              placeholderTextColor="#9CA3AF"
              style={[s.modalInput, { minHeight: 80 }]}
              multiline
              textAlignVertical="top"
            />
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.modalBtn, s.modalCancel]} onPress={() => setGoalModalOpen(false)}>
                <Text style={s.modalCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, s.modalConfirm]} onPress={submitGoal}>
                <Text style={s.modalConfirmTxt}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={meetingModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMeetingModalOpen(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Schedule meeting</Text>
            <TextInput
              value={meetingTitle}
              onChangeText={t => t.length <= 120 && setMeetingTitle(t)}
              placeholder="Meeting title"
              placeholderTextColor="#9CA3AF"
              style={s.modalInput}
            />
            <TextInput
              value={meetingWhen}
              onChangeText={setMeetingWhen}
              placeholder="2026-05-12 14:30"
              placeholderTextColor="#9CA3AF"
              style={s.modalInput}
            />
            <Text style={s.hintTxt}>Format: YYYY-MM-DD HH:MM (24-hour)</Text>

            <View style={s.kindRow}>
              {(['video', 'in_person', 'phone'] as MeetingKind[]).map(k => (
                <TouchableOpacity
                  key={k}
                  style={[s.kindPill, meetingKind === k && s.kindPillSel]}
                  onPress={() => setMeetingKind(k)}
                >
                  <Feather
                    name={k === 'video' ? 'video' : k === 'phone' ? 'phone' : 'map-pin'}
                    size={13}
                    color={meetingKind === k ? '#FFF' : '#374151'}
                  />
                  <Text style={[s.kindPillTxt, meetingKind === k && { color: '#FFF' }]}>
                    {k === 'video' ? 'Video' : k === 'phone' ? 'Phone' : 'In person'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              value={meetingLocation}
              onChangeText={t => t.length <= 200 && setMeetingLocation(t)}
              placeholder={meetingKind === 'video' ? 'Meeting link (optional)' : meetingKind === 'in_person' ? 'Address' : 'Phone number (optional)'}
              placeholderTextColor="#9CA3AF"
              style={s.modalInput}
            />

            <View style={s.modalActions}>
              <TouchableOpacity style={[s.modalBtn, s.modalCancel]} onPress={() => setMeetingModalOpen(false)}>
                <Text style={s.modalCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, s.modalConfirm]} onPress={submitMeeting}>
                <Text style={s.modalConfirmTxt}>Schedule</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },

  partnerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16 },
  partnerAvatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  partnerAvatarTxt: { fontSize: 16, fontWeight: '800', color: '#FFF' },
  partnerName: { fontSize: 17, fontWeight: '800', color: '#000' },
  partnerMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  rolePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  rolePillMentor: { backgroundColor: '#D1FAE5' },
  rolePillMentee: { backgroundColor: '#DBEAFE' },
  rolePillTxt: { fontSize: 11, fontWeight: '800', color: '#065F46' },
  startedTxt: { fontSize: 11, color: '#6B7280' },

  actionRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16, gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12,
  },
  actionPrimary: { backgroundColor: '#000' },
  actionPrimaryTxt: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  actionSecondary: { backgroundColor: '#F3F4F6' },
  actionSecondaryTxt: { fontSize: 14, fontWeight: '700', color: '#000' },

  tabRow: {
    flexDirection: 'row', marginTop: 18, marginHorizontal: 14,
    backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3,
  },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 8 },
  tabActive: { backgroundColor: '#FFF' },
  tabTxt: { fontSize: 13, fontWeight: '700', color: '#6B7280' },
  tabTxtActive: { color: '#000' },
  tabBadge: { backgroundColor: '#000', borderRadius: 9, paddingHorizontal: 6, minWidth: 18, alignItems: 'center' },
  tabBadgeTxt: { color: '#FFF', fontSize: 10, fontWeight: '800' },

  addCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F9FAFB', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 14,
    marginBottom: 10,
  },
  addCardTxt: { fontSize: 14, fontWeight: '700', color: '#000' },

  emptyBox: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 40, paddingHorizontal: 24, gap: 6,
  },
  emptyTxt: { fontSize: 14, fontWeight: '700', color: '#374151' },
  emptySub: { fontSize: 12, color: '#6B7280', textAlign: 'center' },

  goalRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F3F4F6',
  },
  goalCheck: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#D1D5DB',
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  goalCheckProgress: { borderColor: '#F59E0B' },
  goalCheckDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F59E0B' },
  goalCheckDone: { backgroundColor: '#065F46', borderColor: '#065F46' },
  goalTitle: { fontSize: 14, fontWeight: '700', color: '#000' },
  goalTitleDone: { textDecorationLine: 'line-through', color: '#9CA3AF' },
  goalDesc: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 17 },
  goalMeta: { fontSize: 11, color: '#9CA3AF', marginTop: 4 },
  goalDelete: { padding: 6 },

  meetingCard: {
    backgroundColor: '#F9FAFB', borderRadius: 12,
    padding: 12, marginBottom: 10,
  },
  meetingTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meetingIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: '#DBEAFE',
    alignItems: 'center', justifyContent: 'center',
  },
  meetingTitle: { fontSize: 14, fontWeight: '700', color: '#000' },
  meetingWhen: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  meetingLoc: { fontSize: 11, color: '#8E8E93', marginTop: 1 },
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
    backgroundColor: '#DBEAFE',
  },
  statusPillTxt: { fontSize: 10, fontWeight: '800', color: '#1E40AF' },
  statusDone: { backgroundColor: '#D1FAE5' },
  statusCancelled: { backgroundColor: '#FEE2E2' },
  statusPast: { backgroundColor: '#FEF3C7' },
  meetingActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  meetingBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#FFF', alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB',
  },
  meetingBtnDanger: { borderColor: '#FECACA' },
  meetingBtnTxt: { fontSize: 12, fontWeight: '700', color: '#000' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, paddingBottom: 32,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0',
    alignSelf: 'center', marginBottom: 14,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#000', marginBottom: 14 },
  modalInput: {
    backgroundColor: '#F9FAFB', borderRadius: 12,
    padding: 12, marginBottom: 10,
    fontSize: 14, color: '#111', lineHeight: 19,
  },
  hintTxt: { fontSize: 11, color: '#9CA3AF', marginTop: -6, marginBottom: 10 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  modalBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  modalCancel: { backgroundColor: '#F3F4F6' },
  modalCancelTxt: { fontSize: 14, fontWeight: '700', color: '#374151' },
  modalConfirm: { backgroundColor: '#000' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '700', color: '#FFF' },

  kindRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  kindPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, borderRadius: 10, backgroundColor: '#F3F4F6',
  },
  kindPillSel: { backgroundColor: '#000' },
  kindPillTxt: { fontSize: 12, fontWeight: '700', color: '#374151' },
});