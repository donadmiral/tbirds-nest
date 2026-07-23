/**
 * StorySettingsSheet - per-story controls for the owner.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Switch, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';

let MediaLibrary: any = null;
try { MediaLibrary = require('expo-media-library'); } catch {}
let FS: any = null;
try { FS = require('expo-file-system/legacy'); } catch { try { FS = require('expo-file-system'); } catch {} }

type Props = {
  visible: boolean;
  onClose: () => void;
  mediaUrl?: string | null;
  allowReplies: boolean;
  allowReactions: boolean;
  allowSharing: boolean;
  onChange: (patch: { allow_replies?: boolean; allow_reactions?: boolean; allow_sharing?: boolean }) => void;
};

export default function StorySettingsSheet({
  visible, onClose, mediaUrl, allowReplies, allowReactions, allowSharing, onChange,
}: Props) {
  const [saving, setSaving] = useState(false);

  const saveToCameraRoll = async () => {
    if (!mediaUrl || !MediaLibrary || !FS) { Alert.alert('Unavailable', 'Saving is not available in this build.'); return; }
    setSaving(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access in Settings.'); return; }
      const name = 'story_' + Date.now() + (mediaUrl.includes('.mp4') ? '.mp4' : '.jpg');
      const target = (FS.cacheDirectory || FS.documentDirectory) + name;
      const res = await FS.downloadAsync(mediaUrl, target);
      await MediaLibrary.saveToLibraryAsync(res.uri || target);
      Alert.alert('Saved', 'Story saved to your camera roll.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const Row = ({ icon, label, value, onToggle }: any) => (
    <View style={s.row}>
      <View style={s.rowIcon}><Feather name={icon} size={17} color="rgba(255,255,255,0.85)" /></View>
      <Text style={s.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onToggle} trackColor={{ true: '#3797F0', false: 'rgba(255,255,255,0.18)' }} thumbColor="#FFFFFF" />
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.title}>Story settings</Text>

            <Text style={s.section}>Who can interact</Text>
            <Row icon="message-circle" label="Allow replies" value={allowReplies} onToggle={(v: boolean) => onChange({ allow_replies: v })} />
            <Row icon="heart" label="Allow reactions" value={allowReactions} onToggle={(v: boolean) => onChange({ allow_reactions: v })} />
            <Row icon="send" label="Allow sharing" value={allowSharing} onToggle={(v: boolean) => onChange({ allow_sharing: v })} />

            <Text style={s.section}>This story</Text>
            <TouchableOpacity style={s.action} activeOpacity={0.7} onPress={saveToCameraRoll} disabled={saving}>
              <View style={s.rowIcon}>{saving ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="download" size={17} color="rgba(255,255,255,0.85)" />}</View>
              <Text style={s.rowLabel}>Save to camera roll</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: '#141414', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center', marginBottom: 14 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: -0.4, paddingBottom: 6 },
  section: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', paddingTop: 16, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  rowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.09)', alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, color: '#FFFFFF', fontSize: 15.5, fontWeight: '500', letterSpacing: -0.2 },
});