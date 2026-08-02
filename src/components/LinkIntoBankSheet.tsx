import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
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
  const myEmail = useAuthStore(st => st.session?.user?.email || '');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) { setEmail(myEmail); setOtp(''); setOtpSent(false); setBusy(false); }
  }, [visible, myEmail]);

  const submit = useCallback(async () => {
    const addr = email.trim().toLowerCase();
    if (!addr) { Alert.alert('Email needed', 'Enter your IntoBank email.'); return; }
    setBusy(true);
    try {
      if (!otpSent) {
        await paymentsService.sendOtp(addr);
        setOtpSent(true);
        Alert.alert('Code sent', 'Check your IntoBank email for the 6-digit code.');
      } else {
        if (!otp.trim()) { Alert.alert('Code needed', 'Enter the 6-digit code.'); setBusy(false); return; }
        await paymentsService.verifyOtp(addr, otp.trim());
        Alert.alert('Connected', 'Your IntoBank account is linked. Chat payments are ready.');
        onLinked?.();
        onClose();
      }
    } catch (e: any) {
      Alert.alert(otpSent ? 'Could not connect' : 'Could not send code', e?.message || 'Please try again.');
    } finally { setBusy(false); }
  }, [email, otp, otpSent, onLinked, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <View style={s.grabber} />
            <View style={s.markRow}>
              <View style={s.mark}><Text style={s.markTxt}>I</Text></View>
              <Text style={s.title}>Link IntoBank</Text>
            </View>
            <Text style={s.sub}>
              {otpSent
                ? 'Enter the 6-digit code we emailed you.'
                : 'Connect your IntoBank account to send and receive money in chats.'}
            </Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="IntoBank email"
              placeholderTextColor="#9A9AA0"
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!otpSent && !busy}
            />
            {otpSent && (
              <TextInput
                style={s.input}
                value={otp}
                onChangeText={setOtp}
                placeholder="6-digit code"
                placeholderTextColor="#9A9AA0"
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
            )}
            <TouchableOpacity style={[s.cta, busy && s.off]} onPress={submit} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.ctaTxt}>{otpSent ? 'Verify and connect' : 'Send code'}</Text>}
            </TouchableOpacity>
            {otpSent && !busy ? (
              <TouchableOpacity onPress={() => { setOtpSent(false); setOtp(''); }} activeOpacity={0.7}>
                <Text style={s.alt}>Use a different email</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onClose} disabled={busy} activeOpacity={0.7}>
              <Text style={s.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 12, 22, 0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 34 },
  grabber: { alignSelf: 'center', width: 40, height: 4.5, borderRadius: 3, backgroundColor: '#E3E3E8', marginBottom: 14 },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  mark: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#0A3D2E', alignItems: 'center', justifyContent: 'center' },
  markTxt: { color: '#C8963E', fontSize: 16, fontWeight: '900' },
  title: { fontSize: 19, fontWeight: '800', color: NAVY },
  sub: { fontSize: 13.5, color: '#5C5C66', lineHeight: 19, marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#E3E3E8', borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, color: NAVY, marginBottom: 10 },
  cta: { backgroundColor: NAVY, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  off: { opacity: 0.55 },
  ctaTxt: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '800' },
  alt: { textAlign: 'center', color: NAVY, fontSize: 13.5, fontWeight: '700', marginTop: 14 },
  cancel: { textAlign: 'center', color: '#8E8E93', fontSize: 14, fontWeight: '600', marginTop: 12 },
});
