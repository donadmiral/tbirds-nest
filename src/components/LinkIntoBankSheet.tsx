import { themedSheet } from '../theme/useTheme';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { paymentsService } from '../services/paymentsService';
import { useAuthStore } from '../stores/authStore';

const NAVY = '#0B1E3D';

type Props = {
  visible: boolean;
  onClose: () => void;
  onLinked?: () => void;
};

export default function LinkIntoBankSheet({ visible, onClose, onLinked }: Props) {
  const ownerId = useAuthStore(st => st.session?.user?.id || '');
  const operationRef = useRef(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setCode('');
  }, [visible, ownerId]);

  const submit = useCallback(async () => {
    if (operationRef.current) return;
    if (!code.trim()) { Alert.alert('Approval code needed', 'Approve Platinum Circles in IntoBank, then enter the connection code.'); return; }
    operationRef.current = true; setBusy(true);
    try {
      await paymentsService.linkAccount(code, ownerId);
      if (useAuthStore.getState().session?.user?.id !== ownerId) return;
      setCode('');
      onLinked?.();
      onClose();
      Alert.alert('Connected', 'Your IntoBank account is linked.');
    } catch (e: any) {
      Alert.alert('Could not connect', e?.message || 'Check the approval code and try again.');
    } finally { operationRef.current = false; setBusy(false); }
  }, [code, ownerId, onLinked, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={s.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <View style={s.grabber} />
            <View style={s.markRow}>
              <View style={s.mark}><Text style={s.markTxt}>I</Text></View>
              <Text style={s.title}>Link IntoBank</Text>
            </View>
            <Text style={s.sub}>
              In IntoBank, open Profile, Connected apps, then Platinum Circles. Review the wallet access and payment permissions. Generate a connection code and paste it here.
            </Text>
            <TextInput
              style={s.input}
              value={code}
              onChangeText={setCode}
              placeholder="8-character approval code"
              placeholderTextColor="#9A9AA0"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              accessibilityLabel="IntoBank approval code"
            />
            <TouchableOpacity style={[s.cta, busy && s.off]} onPress={submit} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.ctaTxt}>Connect approved account</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} disabled={busy} activeOpacity={0.7}>
              <Text style={s.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = themedSheet((t) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 12, 22, 0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: t.surface.canvas, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 34 },
  grabber: { alignSelf: 'center', width: 40, height: 4.5, borderRadius: 3, backgroundColor: '#E3E3E8', marginBottom: 14 },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  mark: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#0A3D2E', alignItems: 'center', justifyContent: 'center' },
  markTxt: { color: '#C8963E', fontSize: 16, fontWeight: '900' },
  title: { fontSize: 19, fontWeight: '800', color: NAVY },
  sub: { fontSize: 13.5, color: '#5C5C66', lineHeight: 19, marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#E3E3E8', borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, color: NAVY, marginBottom: 10 },
  cta: { backgroundColor: NAVY, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  off: { opacity: 0.55 },
  ctaTxt: { color: t.ink.inverse, fontSize: 15.5, fontWeight: '800' },
  alt: { textAlign: 'center', color: NAVY, fontSize: 13.5, fontWeight: '700', marginTop: 14 },
  cancel: { textAlign: 'center', color: '#8E8E93', fontSize: 14, fontWeight: '600', marginTop: 12 },
}));
