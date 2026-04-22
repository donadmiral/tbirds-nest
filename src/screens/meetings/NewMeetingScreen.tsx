/**
 * NewMeetingScreen.tsx
 * Modal to create a new Video Con meeting or see your active ones.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, Alert, StatusBar, Switch, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { meetingService, MyActiveMeeting } from '../../services/meetingService';

export default function NewMeetingScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [duration, setDuration] = useState<1 | 6 | 12 | 24>(24);
  const [creating, setCreating] = useState(false);
  const [myMeetings, setMyMeetings] = useState<MyActiveMeeting[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const load = useCallback(async () => {
    const list = await meetingService.listMyActive();
    setMyMeetings(list);
    setLoadingList(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startMeeting = async () => {
    if (!title.trim()) {
      Alert.alert('Add a title', 'Give your meeting a name so others recognize it.');
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      const { meeting } = await meetingService.create({
        title: title.trim(),
        isPublic,
        durationHours: duration,
      });
      nav.replace('Meeting', {
        roomName: meeting.room_name,
        meetingId: meeting.id,
        isHost: true,
      });
    } catch (e: any) {
      Alert.alert('Could not create', e?.message || 'Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const rejoinMeeting = (m: MyActiveMeeting) => {
    nav.replace('Meeting', {
      roomName: m.room_name,
      meetingId: m.id,
      isHost: true,
    });
  };

  const shareLink = async (m: MyActiveMeeting) => {
    const link = meetingService.shareLink(m.room_name);
    await Share.share({
      message: `Join my meeting on TBirds Nest: ${m.title}\n\n${link}`,
    });
  };

  const copyLink = async (m: MyActiveMeeting) => {
    const link = meetingService.shareLink(m.room_name);
    await Clipboard.setStringAsync(link);
    Alert.alert('Copied', 'Meeting link copied to clipboard.');
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={s.backBtn}>
          <Feather name="chevron-down" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>New meeting</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

        <View style={s.section}>
          <Text style={s.sectionLabel}>MEETING TITLE</Text>
          <TextInput
            value={title}
            onChangeText={t => t.length <= 120 && setTitle(t)}
            placeholder="Thunderbird study session"
            placeholderTextColor="#9CA3AF"
            style={s.input}
            autoFocus
          />
        </View>

        <View style={s.section}>
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchTitle}>Public meeting</Text>
              <Text style={s.switchSub}>
                {isPublic
                  ? 'Anyone at Thunderbird with the link can join.'
                  : 'Only people you invite directly can join.'}
              </Text>
            </View>
            <Switch value={isPublic} onValueChange={setIsPublic} />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>LINK ACTIVE FOR</Text>
          <View style={s.durRow}>
            {([1, 6, 12, 24] as const).map(h => (
              <TouchableOpacity
                key={h}
                style={[s.durBtn, duration === h && s.durBtnSel]}
                onPress={() => setDuration(h)}
                activeOpacity={0.8}
              >
                <Text style={[s.durTxt, duration === h && s.durTxtSel]}>
                  {h === 1 ? '1 hour' : `${h} hours`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[s.startBtn, (!title.trim() || creating) && { opacity: 0.4 }]}
          onPress={startMeeting}
          disabled={!title.trim() || creating}
          activeOpacity={0.85}
        >
          {creating
            ? <ActivityIndicator color="#FFF" />
            : (
              <>
                <Feather name="video" size={18} color="#FFF" />
                <Text style={s.startBtnTxt}>Start meeting</Text>
              </>
            )}
        </TouchableOpacity>

        {/* Active meetings */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>YOUR ACTIVE MEETINGS</Text>
          {loadingList ? (
            <ActivityIndicator color="#000" style={{ paddingVertical: 20 }} />
          ) : myMeetings.length === 0 ? (
            <Text style={s.empty}>No active meetings. Start one above.</Text>
          ) : (
            myMeetings.map(m => (
              <View key={m.id} style={s.mCard}>
                <TouchableOpacity
                  style={s.mCardInner}
                  onPress={() => rejoinMeeting(m)}
                  activeOpacity={0.8}
                >
                  <View style={s.mIconWrap}>
                    <Feather name="video" size={16} color="#1D4ED8" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.mTitle} numberOfLines={1}>{m.title}</Text>
                    <Text style={s.mMeta}>
                      {m.participant_count} active · {m.is_public ? 'Public' : 'Invite-only'}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color="#C7C7CC" />
                </TouchableOpacity>
                <View style={s.mActions}>
                  <TouchableOpacity style={s.mActionBtn} onPress={() => copyLink(m)}>
                    <Feather name="link-2" size={14} color="#007AFF" />
                    <Text style={s.mActionTxt}>Copy link</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.mActionBtn} onPress={() => shareLink(m)}>
                    <Feather name="share" size={14} color="#007AFF" />
                    <Text style={s.mActionTxt}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },

  section: { paddingHorizontal: 16, paddingTop: 18 },
  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: '#8E8E93',
    letterSpacing: 0.7, marginBottom: 10,
  },
  input: {
    backgroundColor: '#F9FAFB', borderRadius: 12,
    padding: 14, fontSize: 16, color: '#000',
  },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchTitle: { fontSize: 15, fontWeight: '700', color: '#000' },
  switchSub: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 16 },

  durRow: { flexDirection: 'row', gap: 8 },
  durBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  durBtnSel: { backgroundColor: '#000' },
  durTxt: { fontSize: 13, fontWeight: '700', color: '#374151' },
  durTxtSel: { color: '#FFF' },

  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 22,
    backgroundColor: '#000', paddingVertical: 16, borderRadius: 14,
  },
  startBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '800' },

  empty: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 20 },

  mCard: {
    backgroundColor: '#F9FAFB', borderRadius: 14,
    marginBottom: 10, overflow: 'hidden',
  },
  mCardInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  mIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  mTitle: { fontSize: 14, fontWeight: '700', color: '#000' },
  mMeta: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  mActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB' },
  mActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  mActionTxt: { fontSize: 12, fontWeight: '700', color: '#007AFF' },
});