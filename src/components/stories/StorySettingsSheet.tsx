/**
 * StorySettingsSheet - per-story controls for the owner.
 */
import React, { useEffect, useRef, useState } from 'react';
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
  updating?: boolean;
  onChange: (patch: { allow_replies?: boolean; allow_reactions?: boolean; allow_sharing?: boolean }) => void;
};

function StorySettingRow({ icon, label, value, onToggle, disabled }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; value: boolean; onToggle: (next: boolean) => void; disabled: boolean }) {
  return <View style={s.row}>
    <View style={s.rowIcon}><Feather name={icon} size={17} color="rgba(255,255,255,0.85)" /></View>
    <Text style={s.rowLabel}>{label}</Text>
    <Switch accessibilityLabel={label} disabled={disabled} value={value} onValueChange={onToggle} trackColor={{ true: '#3797F0', false: 'rgba(255,255,255,0.18)' }} thumbColor="#FFFFFF" />
  </View>;
}

export default function StorySettingsSheet({
  visible, onClose, mediaUrl, allowReplies, allowReactions, allowSharing, onChange, updating = false,
}: Props) {
  const [saving, setSaving] = useState(false);
  const saveBusy = useRef(false);
  const scope = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { scope.current++; setSaving(saveBusy.current); return () => { scope.current++; }; }, [mediaUrl, visible]);

  const saveToCameraRoll = async () => {
    if (saveBusy.current) return;
    if (!mediaUrl || !MediaLibrary || !FS) { Alert.alert('Unavailable', 'There is no original media to save.'); return; }
    const version = scope.current;
    saveBusy.current = true; setSaving(true);
    let localUri: string | null = null;
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (scope.current !== version) return;
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access in Settings.'); return; }
      const name = 'story_' + Date.now() + (mediaUrl.includes('.mp4') ? '.mp4' : '.jpg');
      const target = (FS.cacheDirectory || FS.documentDirectory) + name;
      const res = await FS.downloadAsync(mediaUrl, target);
      localUri = res.uri || target;
      if (scope.current !== version) return;
      if (res.status && (res.status < 200 || res.status >= 300)) throw new Error('The original media could not download. Please retry.');
      await MediaLibrary.saveToLibraryAsync(localUri);
      if (scope.current === version) Alert.alert('Original media saved', 'The original photo or video was saved. To save an edited story image with stickers, use Save story image in the story editor.');
    } catch (e: any) {
      if (scope.current === version) Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      if (localUri) await FS.deleteAsync(localUri, { idempotent: true }).catch(() => {});
      saveBusy.current = false;
      if (mounted.current) setSaving(false);
    }
  };



  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.title}>Story settings</Text>

            <Text style={s.section}>Who can interact</Text>
            <StorySettingRow disabled={updating} icon="message-circle" label="Allow replies" value={allowReplies} onToggle={(v: boolean) => onChange({ allow_replies: v })} />
            <StorySettingRow disabled={updating} icon="heart" label="Allow reactions" value={allowReactions} onToggle={(v: boolean) => onChange({ allow_reactions: v })} />
            <StorySettingRow disabled={updating} icon="send" label="Allow sharing" value={allowSharing} onToggle={(v: boolean) => onChange({ allow_sharing: v })} />

            <Text style={s.section}>This story</Text>
            {mediaUrl ? <TouchableOpacity style={s.action} activeOpacity={0.7} onPress={saveToCameraRoll} disabled={saving}>
              <View style={s.rowIcon}>{saving ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="download" size={17} color="rgba(255,255,255,0.85)" />}</View>
              <Text style={s.rowLabel}>Save original media</Text>
            </TouchableOpacity> : <Text style={s.saveHint}>Text stories have no original media. Save an edited story image from the story editor.</Text>}
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
  saveHint: { color: '#C4C4C7', fontSize: 13, lineHeight: 19, paddingVertical: 12 },
});
