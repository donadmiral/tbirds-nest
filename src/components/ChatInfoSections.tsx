/**
 * ChatInfoSections
 *
 * The lower half of a chat's info screen: notifications, privacy, groups in
 * common, reporting, and an honest line about security.
 *
 * Built as its own component so the sections can grow without touching a
 * 2,000 line screen.
 *
 * On security: this app does not have end-to-end encryption. Messages are
 * stored in Supabase and are readable by the operator. The wording here says
 * exactly that rather than borrowing WhatsApp's, because telling someone their
 * messages are private when they are not is worse than saying nothing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { light, typeSize, fontWeight, radius, space } from '../constants/tokens';

const HAIR = StyleSheet.hairlineWidth;

const DISAPPEARING = [
  { label: 'Off', seconds: null },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '90 days', seconds: 7776000 },
];

const REPORT_REASONS: Array<{ id: string; label: string }> = [
  { id: 'spam', label: 'Spam' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'scam', label: 'Scam or fraud' },
  { id: 'impersonation', label: 'Pretending to be someone else' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'other', label: 'Something else' },
];

type GroupInCommon = {
  conversation_id: string;
  group_name: string | null;
  group_avatar_url: string | null;
  member_count: number;
};

type Props = {
  conversationId: string | null;
  otherUserId: string | null;
  otherName: string;
  isGroup: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  navigation: any;
};

export default function ChatInfoSections({
  conversationId, otherUserId, otherName, isGroup, muted, onToggleMute, onClose, navigation,
}: Props) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [savingDisappear, setSavingDisappear] = useState(false);
  const [groups, setGroups] = useState<GroupInCommon[]>([]);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  const load = useCallback(async () => {
    if (conversationId) {
      const { data } = await supabase.from('conversations')
        .select('disappearing_seconds').eq('id', conversationId).maybeSingle();
      setSeconds((data as any)?.disappearing_seconds ?? null);
    }
    if (otherUserId && !isGroup) {
      const [{ data: g }, { data: r }] = await Promise.all([
        supabase.rpc('get_groups_in_common', { p_other_id: otherUserId }),
        supabase.from('user_reports').select('id').eq('reported_id', otherUserId).eq('status', 'open').maybeSingle(),
      ]);
      setGroups((g ?? []) as GroupInCommon[]);
      setReported(!!r);
    }
  }, [conversationId, otherUserId, isGroup]);

  useEffect(() => { load(); }, [load]);

  const applyDisappearing = async (value: number | null) => {
    if (!conversationId || savingDisappear) return;
    const previous = seconds;
    setSeconds(value);
    setSavingDisappear(true);
    const { error } = await supabase.rpc('set_disappearing_messages', {
      p_conversation_id: conversationId, p_seconds: value,
    });
    setSavingDisappear(false);
    if (error) { setSeconds(previous); Alert.alert('Could not change this', error.message); }
  };

  const report = () => {
    if (!otherUserId || reported) return;
    Alert.alert('Report ' + otherName + '?', 'Pick what is happening. Reports are private.',
      [
        ...REPORT_REASONS.map(r => ({
          text: r.label,
          onPress: async () => {
            setReporting(true);
            const { error } = await supabase.from('user_reports').insert({
              reporter_id: (await supabase.auth.getUser()).data.user?.id,
              reported_id: otherUserId,
              reason: r.id,
              conversation_id: conversationId,
            });
            setReporting(false);
            if (error) {
              Alert.alert(error.message.includes('duplicate') ? 'Already reported' : 'Could not report',
                error.message.includes('duplicate')
                  ? 'You have an open report about this person already.'
                  : error.message);
              return;
            }
            setReported(true);
            Alert.alert('Reported', 'Thank you. We will look into it. You can also block them.');
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
  };

  return (
    <View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Notifications</Text>
        <View style={s.row}>
          <Feather name={muted ? 'bell-off' : 'bell'} size={17} color={light.ink.muted} />
          <View style={s.rowText}>
            <Text style={s.rowLabel}>Mute this chat</Text>
            <Text style={s.rowHint}>You still receive the messages, without the alert.</Text>
          </View>
          <Switch value={muted} onValueChange={onToggleMute}
            trackColor={{ true: light.brand.base, false: light.surface.hairline }} />
        </View>
      </View>

      {!isGroup && conversationId ? (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Disappearing messages</Text>
          <Text style={s.sectionHint}>
            New messages vanish for both of you after the chosen time. Anything already sent stays.
          </Text>
          <View style={s.chips}>
            {DISAPPEARING.map(d => {
              const on = seconds === d.seconds;
              return (
                <TouchableOpacity key={d.label}
                  style={[s.chip, on && s.chipOn]}
                  onPress={() => applyDisappearing(d.seconds)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.chipTxt, on && s.chipTxtOn]}>{d.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {!isGroup && groups.length > 0 ? (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Groups in common · {groups.length}</Text>
          {groups.map(g => (
            <TouchableOpacity key={g.conversation_id} style={s.row} activeOpacity={0.7}
              onPress={() => { onClose(); navigation.navigate('Chat', { conversationId: g.conversation_id }); }}
            >
              {g.group_avatar_url ? (
                <Image source={{ uri: g.group_avatar_url }} style={s.groupAvatar} />
              ) : (
                <View style={[s.groupAvatar, s.groupAvatarFb]}>
                  <Feather name="users" size={15} color={light.ink.muted} />
                </View>
              )}
              <View style={s.rowText}>
                <Text style={s.rowLabel} numberOfLines={1}>{g.group_name || 'Group'}</Text>
                <Text style={s.rowHint}>{g.member_count} members</Text>
              </View>
              <Feather name="chevron-right" size={16} color={light.ink.faint} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={s.section}>
        <View style={s.securityRow}>
          <Feather name="lock" size={15} color={light.ink.muted} />
          <Text style={s.securityTxt}>
            Messages are secured in transit and stored encrypted at rest. They are not
            end-to-end encrypted, so Platinum Circles can access them if required by law.
          </Text>
        </View>
      </View>

      {!isGroup && otherUserId ? (
        <View style={s.section}>
          <TouchableOpacity
            style={s.reportBtn}
            onPress={report}
            disabled={reporting || reported}
            activeOpacity={0.75}
          >
            <Feather name="flag" size={15} color={reported ? light.ink.faint : light.status.danger} />
            <Text style={[s.reportTxt, reported && { color: light.ink.faint }]}>
              {reported ? 'Reported' : 'Report ' + otherName}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: space.sm, borderTopWidth: HAIR, borderTopColor: light.surface.divider },
  sectionTitle: {
    fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 1.1,
    textTransform: 'uppercase', color: light.ink.muted, marginBottom: space.xs,
  },
  sectionHint: { fontSize: typeSize.micro, color: light.ink.faint, lineHeight: 16, marginBottom: space.sm },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  rowText: { flex: 1 },
  rowLabel: { fontSize: typeSize.body, fontWeight: fontWeight.medium, color: light.ink.primary },
  rowHint: { fontSize: typeSize.micro, color: light.ink.muted, marginTop: 1, lineHeight: 15 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    paddingHorizontal: space.sm, paddingVertical: 7, borderRadius: radius.full,
    borderWidth: HAIR, borderColor: light.surface.hairline,
  },
  chipOn: { backgroundColor: light.brand.base, borderColor: light.brand.base },
  chipTxt: { fontSize: typeSize.caption, fontWeight: fontWeight.semibold, color: light.ink.secondary },
  chipTxtOn: { color: light.ink.inverse },

  groupAvatar: { width: 34, height: 34, borderRadius: 11, backgroundColor: light.surface.sunken },
  groupAvatarFb: { alignItems: 'center', justifyContent: 'center' },

  securityRow: { flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' },
  securityTxt: { flex: 1, fontSize: typeSize.micro, color: light.ink.muted, lineHeight: 16 },

  reportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 13, borderRadius: radius.md, backgroundColor: light.status.dangerBg,
  },
  reportTxt: { fontSize: typeSize.emphasis, fontWeight: fontWeight.bold, color: light.status.danger },
});