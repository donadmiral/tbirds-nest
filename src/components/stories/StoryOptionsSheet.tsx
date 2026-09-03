/**
 * StoryOptionsSheet
 *
 * The three-dot menu the viewer never had. What it offers depends on whose
 * story it is: your own story gets insights and delete, someone else's gets
 * mute, report and block.
 *
 * Reporting matters more than parity here. There was previously no way to
 * report a story at all, and a public network where you can only block and
 * never report is half a safety story.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, Alert, ActivityIndicator, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';

type Props = {
  visible: boolean;
  onClose: () => void;
  isMine: boolean;
  storyId: string | null;
  authorId: string | null;
  authorName: string;
  mediaUrl?: string | null;
  onDeleted?: () => void;
  onManageMentions?: () => void;
  onOpenInsights?: () => void;
};

const REPORT_REASONS = [
  { id: 'spam', label: 'Spam' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'scam', label: 'Scam or fraud' },
  { id: 'impersonation', label: 'Pretending to be someone else' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'other', label: 'Something else' },
];

export default function StoryOptionsSheet({
  visible, onClose, isMine, storyId, authorId, authorName, mediaUrl,
  onDeleted, onOpenInsights, onManageMentions,
}: Props) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const deleteStory = () =>
    Alert.alert('Delete this story?', 'It disappears for everyone straight away.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(async () => {
        if (!storyId) return;
        const { error } = await supabase.from('stories').delete().eq('id', storyId);
        if (error) { Alert.alert('Could not delete', error.message); return; }
        onClose();
        onDeleted?.();
      })},
    ]);

  const muteAuthor = () => run(async () => {
    if (!authorId) return;
    const { data: me } = await supabase.auth.getUser();
    const uid = me?.user?.id;
    if (!uid) return;
    const { error } = await supabase.from('muted_stories')
      .upsert({ user_id: uid, muted_id: authorId }, { onConflict: 'user_id,muted_id' });
    if (error) { Alert.alert('Could not mute', error.message); return; }
    onClose();
    Alert.alert('Muted', `You will not see ${authorName}'s stories. Their posts are unaffected.`);
  });

  const reportStory = () =>
    Alert.alert(`Report ${authorName}?`, 'Pick what is happening. Reports are private.', [
      ...REPORT_REASONS.map(r => ({
        text: r.label,
        onPress: () => run(async () => {
          if (!authorId) return;
          const { data: me } = await supabase.auth.getUser();
          const uid = me?.user?.id;
          if (!uid) return;
          const { error } = await supabase.from('user_reports').insert({
            reporter_id: uid, reported_id: authorId, reason: r.id,
          });
          if (error) {
            Alert.alert(
              error.message.includes('duplicate') ? 'Already reported' : 'Could not report',
              error.message.includes('duplicate')
                ? 'You have an open report about this person already.'
                : error.message);
            return;
          }
          onClose();
          Alert.alert('Reported', 'Thank you. We will look into it.');
        }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  const shareStory = () => run(async () => {
    if (!mediaUrl) { Alert.alert('Nothing to share', 'This story has no shareable media.'); return; }
    onClose();
    await Share.share({ message: mediaUrl });
  });

  const rows = isMine
    ? [
        { icon: 'bar-chart-2', label: 'View insights', tone: 'normal', run: () => { onClose(); onOpenInsights?.(); } },
        { icon: 'at-sign', label: 'Manage mentions', tone: 'normal', run: () => { onClose(); onManageMentions?.(); } },
        { icon: 'share', label: 'Share', tone: 'normal', run: shareStory },
        { icon: 'trash-2', label: 'Delete story', tone: 'danger', run: deleteStory },
      ]
    : [
        { icon: 'share', label: 'Share', tone: 'normal', run: shareStory },
        { icon: 'bell-off', label: `Mute ${authorName}`, tone: 'normal', run: muteAuthor },
        { icon: 'flag', label: 'Report', tone: 'danger', run: reportStory },
      ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={s.handle} />
          {busy ? (
            <View style={s.busy}><ActivityIndicator color="#FFFFFF" /></View>
          ) : (
            rows.map(r => (
              <TouchableOpacity key={r.label} style={s.row} onPress={r.run} activeOpacity={0.7}>
                <Feather name={r.icon as any} size={19} color={r.tone === 'danger' ? '#FF453A' : '#FFFFFF'} />
                <Text style={[s.rowTxt, r.tone === 'danger' && s.rowTxtDanger]}>{r.label}</Text>
              </TouchableOpacity>
            ))
          )}
          <TouchableOpacity style={s.cancel} onPress={onClose} activeOpacity={0.7}>
            <Text style={s.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#16181C', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', alignSelf: 'center', marginBottom: 10 },
  busy: { paddingVertical: 34, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 22, paddingVertical: 16 },
  rowTxt: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  rowTxtDanger: { color: '#FF453A' },
  cancel: { marginTop: 6, marginHorizontal: 16, paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' },
  cancelTxt: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
});