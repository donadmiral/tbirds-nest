import { KeyboardAvoidingView, Platform } from 'react-native';
/**
 * ReportListingSheet - Facebook-style report reasons for a marketplace listing.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';

const REASONS = [
  { key: 'scam', label: 'Scam or fraud', sub: 'Asking for payment upfront, fake item' },
  { key: 'prohibited', label: 'Prohibited item', sub: 'Weapons, drugs, counterfeit goods' },
  { key: 'misleading', label: 'Misleading listing', sub: 'Wrong photos, price or description' },
  { key: 'inappropriate', label: 'Inappropriate content', sub: 'Offensive or explicit' },
  { key: 'duplicate', label: 'Spam or duplicate', sub: 'Posted many times' },
  { key: 'other', label: 'Something else', sub: '' },
];

export default function ReportListingSheet({ visible, onClose, listingId, reporterId }: any) {
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason || !reporterId) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('listing_reports').upsert({
        listing_id: listingId, reporter_id: reporterId, reason, detail: detail.trim() || null,
      }, { onConflict: 'listing_id,reporter_id' });
      if (error) { Alert.alert('Could not report', error.message); return; }
      setReason(null); setDetail('');
      onClose();
      Alert.alert('Thanks for telling us', 'We will review this listing.');
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.title}>Report listing</Text>
            <Text style={s.sub}>Your report stays anonymous.</Text>
            {REASONS.map(r => (
              <TouchableOpacity key={r.key} style={s.row} activeOpacity={0.75} onPress={() => setReason(r.key)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{r.label}</Text>
                  {!!r.sub && <Text style={s.rowSub}>{r.sub}</Text>}
                </View>
                <View style={[s.radio, reason === r.key && s.radioOn]}>
                  {reason === r.key ? <Feather name="check" size={13} color="#FFF" /> : null}
                </View>
              </TouchableOpacity>
            ))}
            {!!reason && (
              <TextInput style={s.input} value={detail} onChangeText={setDetail}
                placeholder="Add detail (optional)" placeholderTextColor="#B0B0B5" multiline />
            )}
            <TouchableOpacity style={[s.cta, (!reason || busy) && { opacity: 0.4 }]} onPress={submit} disabled={!reason || busy}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.ctaTxt}>Submit report</Text>}
            </TouchableOpacity>
          </View>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D8D8DC', alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '800', color: '#0A0A0A', letterSpacing: -0.4 },
  sub: { fontSize: 13.5, color: '#8E8E93', marginTop: 3, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EFEFF4' },
  rowTitle: { fontSize: 15.5, fontWeight: '600', color: '#0A0A0A' },
  rowSub: { fontSize: 12.5, color: '#8E8E93', marginTop: 1 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  input: { marginTop: 12, backgroundColor: '#F2F2F7', borderRadius: 12, padding: 12, minHeight: 60, fontSize: 14.5, color: '#0A0A0A', textAlignVertical: 'top' },
  cta: { marginTop: 16, height: 48, borderRadius: 14, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});